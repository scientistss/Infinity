import { storedRunLimit, chargeReservations, type ChargeReceipt } from "./deep-state";
import { activePlanet, withPlanet, selectPlanet } from "./empire";
/**
 * Deep-space ring machine, beacon version (design doc §8.6, P2; P3 opens the drifting-ships tile).
 *
 * Runs are rolled the moment they are granted (beacon, deuterium top-up, bonus) with the RNG state stored in
 * the save; revealing only plays them back. Prize sizes use the state at reveal time with the pre-rolled
 * uniform numbers. Pity changes where a run lands, never the public odds table.
 */
import { unitMissing, unitSpend } from "./shipyard";
import { DRIFTER_LADDER, unitById, type ShipId } from "../data/units";
import {
  ARCADE,
  ARCADE_PHASE,
  ARCADE_SYMBOL_DEFS,
  ARCADE_SYMBOLS,
  BET_SYMBOLS,
  BOARD,
  EMPTY_LINES,
  EMPTY_SYMBOLS,
  GOOD_SYMBOLS,
  LUCKY_EXCLUDED,
  LUCKY_TABLE,
  arcadeSymbolDef,
  type ArcadeSymbol,
  type BetSymbol,
  type LuckyKind,
} from "../data/arcade";
import { BUILDINGS } from "../data/buildings";
import { INVENTORY_IDS, INVENTORY_LABEL } from "../data/dark-matter";
import { RESEARCH } from "../data/research";
import { addInventory, freeStorage, grantDarkMatter } from "./dark-matter";
import { economy } from "./economy";
import { formatAmount, formatDm, formatDuration } from "./format";
import { cumulativeCost, researchCost } from "./formulas";
import { big } from "./decimal";
import { Rng, freshSeed } from "./rng";
import type { GameState, ResourceId } from "./types";

export type RunSource = "beacon" | "topup" | "bonus" | "charge";
export type RevealMode = "manual" | "auto";

export interface LightRoll {
  tile: number;
  big: boolean;
  /** Pre-rolled uniform numbers for the prize size and kind. */
  u: number;
  v: number;
}

export interface RunOutcome {
  main: LightRoll;
  lucky: { kind: LuckyKind; lights: LightRoll[] } | null;
  /** Which pity rule picked the tile, if any. */
  forced: "empty" | "jackpot" | null;
}

export interface PendingRun {
  source: RunSource;
  outcome: RunOutcome;
  /** Already resolved into a fleet. Revealing never grants its rewards twice. */
  receipt?: ChargeReceipt;
}

export interface ArcadeHistoryEntry {
  symbol: ArcadeSymbol;
  big: boolean;
  /** Game time (totalTime seconds) of the reveal. */
  at: number;
  auto: boolean;
  summary: string;
}

export interface ArcadeStats {
  runs: number;
  manualRuns: number;
  autoRuns: number;
  hits: Record<ArcadeSymbol, number>;
  darkMatter: number;
  /** Deuterium spent on bets and won back as metal equivalent. */
  betSpent: number;
  betWon: number;
}

export interface ArcadeState {
  seed: number;
  runs: PendingRun[];
  beaconProgress: number;
  beaconRequired: number;
  /** Game-time stamps of deuterium top-ups (last 24 h set the price). */
  topUps: number[];
  /** Standing bets in units, kept between runs and used by auto runs. */
  bets: Record<BetSymbol, number>;
  /** Pity counters at roll time (decide future rolls) and at reveal time (shown on screen). */
  rollPity: { empty: number; jackpot: number };
  pity: { empty: number; jackpot: number };
  /** Tile where the light last stopped. */
  position: number;
  history: ArcadeHistoryEntry[];
  stats: ArcadeStats;
}

export interface RunLight {
  tile: number;
  symbol: ArcadeSymbol;
  big: boolean;
  /** False when a train passed over a bad tile and ignored it. */
  paid: boolean;
}

export interface RunResult {
  source: RunSource;
  startTile: number;
  mainTile: number;
  symbol: ArcadeSymbol;
  big: boolean;
  luckyKind: LuckyKind | null;
  lights: RunLight[];
  lines: string[];
  forced: "empty" | "jackpot" | null;
}

export interface ArcadeResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

const EPS = 1e-9;
const RES_ZH: Record<ResourceId, string> = { metal: "金属", crystal: "晶体", deuterium: "重氢" };
/** Metal equivalent of one unit: 1 crystal = 2 metal, 1 deuterium = 3 metal. */
const ME_FACTOR: Record<ResourceId, number> = { metal: 1, crystal: 2, deuterium: 3 };

// ---------- odds ----------

function isOpen(symbol: ArcadeSymbol): boolean {
  return arcadeSymbolDef(symbol).opensIn <= ARCADE_PHASE;
}

function resolveMerge(symbol: ArcadeSymbol): ArcadeSymbol {
  let current = symbol;
  for (let guard = 0; guard < 8 && !isOpen(current); guard += 1) {
    const into = arcadeSymbolDef(current).mergeInto;
    if (!into) break;
    current = into;
  }
  return current;
}

function computeChances(): Record<ArcadeSymbol, number> {
  const chance = Object.fromEntries(ARCADE_SYMBOLS.map((id) => [id, 0])) as Record<ArcadeSymbol, number>;
  for (const def of ARCADE_SYMBOL_DEFS) chance[resolveMerge(def.id)] += def.beaconPct / 100;
  return chance;
}

/** Beacon-run probability of each symbol after closed tiles moved their weight (sums to 1). */
export const SYMBOL_CHANCE: Readonly<Record<ArcadeSymbol, number>> = computeChances();

/** Per-tile weights; closed tiles weigh 0. Same-symbol tiles share the symbol's chance. */
export const TILE_WEIGHTS: readonly number[] = BOARD.map((symbol) => {
  if (!isOpen(symbol)) return 0;
  const count = BOARD.filter((other) => other === symbol).length;
  return SYMBOL_CHANCE[symbol] / count;
});

export function tileOpen(index: number): boolean {
  return (TILE_WEIGHTS[index] ?? 0) > 0;
}

export function betOdds(symbol: BetSymbol): number {
  return ARCADE.betReturn / SYMBOL_CHANCE[symbol];
}

function pickWeighted(r: number, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  const target = r * total;
  let last = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const w = weights[i] ?? 0;
    if (w <= 0) continue;
    last = i;
    acc += w;
    if (target < acc) return i;
  }
  return last;
}

function maskWeights(keep: (symbol: ArcadeSymbol) => boolean): number[] {
  return TILE_WEIGHTS.map((w, i) => (keep(BOARD[i]!) ? w : 0));
}

const LUCKY_WEIGHTS = maskWeights((s) => !LUCKY_EXCLUDED.includes(s));
const GOOD_WEIGHTS = maskWeights((s) => GOOD_SYMBOLS.includes(s));
const JACKPOT_WEIGHTS = maskWeights((s) => s === "jackpot");

// ---------- state ----------

export function emptyHits(): Record<ArcadeSymbol, number> {
  return Object.fromEntries(ARCADE_SYMBOLS.map((id) => [id, 0])) as Record<ArcadeSymbol, number>;
}

export function createArcade(seed: number = freshSeed()): ArcadeState {
  return {
    seed: seed >>> 0,
    runs: [],
    beaconProgress: 0,
    beaconRequired: ARCADE.beaconSeconds,
    topUps: [],
    bets: { metal: 0, crystal: 0, deuterium: 0, drifter: 0 },
    rollPity: { empty: 0, jackpot: 0 },
    pity: { empty: 0, jackpot: 0 },
    position: 0,
    history: [],
    stats: { runs: 0, manualRuns: 0, autoRuns: 0, hits: emptyHits(), darkMatter: 0, betSpent: 0, betWon: 0 },
  };
}

export function cloneArcade(arcade: ArcadeState): ArcadeState {
  return structuredClone(arcade);
}

/** The ring machine opens with Astrophysics 1 (design doc §8.6.10). */
export function arcadeUnlocked(state: GameState): boolean {
  return state.research.levels.astrophysics >= 1;
}

function withArcade(state: GameState, patch: Partial<ArcadeState>): GameState {
  return { ...state, arcade: { ...state.arcade, ...patch } };
}

// ---------- rolling ----------

function rollLight(rng: Rng, weights: readonly number[]): LightRoll {
  const tile = pickWeighted(rng.next(), weights);
  const bigRoll = rng.next() < ARCADE.bigChance;
  return { tile, big: bigRoll, u: rng.next(), v: rng.next() };
}

function pickLucky(r: number): LuckyKind {
  let acc = 0;
  for (const row of LUCKY_TABLE) {
    acc += row.pct / 100;
    if (r < acc) return row.kind;
  }
  return LUCKY_TABLE[LUCKY_TABLE.length - 1]!.kind;
}

/** Roll one run from the stored seed. Pure: returns the outcome and the arcade after the draw. */
export function rollOutcome(arcade: ArcadeState, minBig = false, customWeights?: readonly number[]): { outcome: RunOutcome; arcade: ArcadeState } {
  const rng = new Rng(arcade.seed);
  let forced: RunOutcome["forced"] = null;
  let weights: readonly number[] = customWeights ?? TILE_WEIGHTS;
  if (arcade.rollPity.jackpot >= ARCADE.jackpotPity - 1) {
    forced = "jackpot";
    weights = JACKPOT_WEIGHTS;
  } else if (arcade.rollPity.empty >= ARCADE.emptyPity) {
    forced = "empty";
    weights = GOOD_WEIGHTS;
  }
  const main = rollLight(rng, weights);
  if (minBig) main.big = true;
  let lucky: RunOutcome["lucky"] = null;
  const symbol = BOARD[main.tile]!;
  if (symbol === "lucky") {
    const kind = pickLucky(rng.next());
    const lights: LightRoll[] = [];
    if (kind === "two" || kind === "three") {
      for (let i = 0; i < (kind === "two" ? 2 : 3); i += 1) lights.push(rollLight(rng, LUCKY_WEIGHTS));
    } else if (kind === "small_three" || kind === "big_three") {
      for (const res of ["metal", "crystal", "deuterium"] as const) {
        const tiles = BOARD.map((s, i) => (s === res ? i : -1)).filter((i) => i >= 0);
        const tile = tiles[Math.min(tiles.length - 1, Math.floor(rng.next() * tiles.length))]!;
        lights.push({ tile, big: kind === "big_three", u: rng.next(), v: rng.next() });
      }
    } else {
      const length = 3 + Math.min(3, Math.floor(rng.next() * 4));
      for (let step = 1; step <= length; step += 1) {
        lights.push({ tile: (main.tile + step) % BOARD.length, big: rng.next() < ARCADE.bigChance, u: rng.next(), v: rng.next() });
      }
    }
    lucky = { kind, lights };
  }
  const rollPity = {
    empty: EMPTY_SYMBOLS.includes(symbol) ? arcade.rollPity.empty + 1 : 0,
    jackpot: symbol === "jackpot" ? 0 : arcade.rollPity.jackpot + 1,
  };
  return { outcome: { main, lucky, forced }, arcade: { ...arcade, seed: rng.seed, rollPity } };
}

/** Grant and pre-roll one run. Refused when the store is full. */
export function grantRun(state: GameState, source: RunSource, minBig = false): { state: GameState; granted: boolean } {
  if (source === "charge" || state.arcade.runs.length + chargeReservations(state) >= storedRunLimit(state)) return { state, granted: false };
  const rolled = rollOutcome(state.arcade, minBig);
  const arcade = { ...rolled.arcade, runs: [...state.arcade.runs, { source, outcome: rolled.outcome }] };
  return { state: { ...state, arcade }, granted: true };
}

// ---------- beacon ----------

/** Seconds until the next beacon run, or Infinity while locked or full (beacons stop at 3 stored runs). */
export function nextBeaconIn(state: GameState): number {
  if (!arcadeUnlocked(state) || state.arcade.runs.length >= ARCADE.beaconMax) return Number.POSITIVE_INFINITY;
  return Math.max(0, state.arcade.beaconRequired - state.arcade.beaconProgress);
}

function settleBeacon(state: GameState): { state: GameState; granted: number } {
  let current = state;
  let granted = 0;
  for (let guard = 0; guard < 8; guard += 1) {
    const arcade = current.arcade;
    if (arcade.runs.length >= ARCADE.beaconMax || arcade.beaconProgress + EPS < arcade.beaconRequired) break;
    const progress = Math.max(0, arcade.beaconProgress - arcade.beaconRequired);
    current = withArcade(current, { beaconProgress: progress, beaconRequired: ARCADE.beaconSeconds });
    const result = grantRun(current, "beacon");
    current = result.state;
    if (result.granted) granted += 1;
  }
  if (current.arcade.runs.length >= ARCADE.beaconMax && current.arcade.beaconProgress > 0) {
    current = withArcade(current, { beaconProgress: 0 });
  }
  return { state: current, granted };
}

/** Beacon accrual for `dt` seconds of game time (online and offline alike). */
export function accrueBeacons(state: GameState, dt: number): { state: GameState; granted: number } {
  if (!(dt > 0) || !arcadeUnlocked(state) || state.arcade.runs.length >= ARCADE.beaconMax) {
    return { state, granted: 0 };
  }
  return settleBeacon(withArcade(state, { beaconProgress: state.arcade.beaconProgress + dt }));
}

// ---------- prizes ----------

/** OGame-style points: resources spent on every building and research level / 1000. */
export function empirePoints(state: GameState): number {
  let spent = 0;
  for (const planet of state.planets) for (const def of BUILDINGS) {
    const level = planet.buildings[def.id];
    if (level <= 0) continue;
    const cost = cumulativeCost(def, level);
    spent += cost.metal.add(cost.crystal).add(cost.deuterium).toNumber();
  }
  for (const def of RESEARCH) {
    const level = state.research.levels[def.id];
    for (let l = 1; l <= level; l += 1) {
      const cost = researchCost(def, l);
      spent += cost.metal.add(cost.crystal).add(cost.deuterium).toNumber();
    }
  }
  for (const planet of state.planets) spent += unitSpend(planet);
  return Math.floor(spent / 1000);
}

/**
 * Prize cap in metal equivalent: the OGame expedition ladder × S / fleet speed (600 / 120 = 5). P2 has no
 * leaderboard yet, so the ladder reads the empire's own points instead of the top player's.
 */
export function prizeCap(state: GameState): number {
  const points = empirePoints(state);
  for (const [limit, value] of ARCADE.capLadder) {
    if (!limit || points < limit!) return value! * ARCADE.fleetFactor;
  }
  return ARCADE.capLadder[ARCADE.capLadder.length - 1]![1]! * ARCADE.fleetFactor;
}

/** Empire gross production per second in metal equivalent. */
export function productionMe(state: GameState): number {
  return state.planets.reduce((sum, planet) => {
    const gross = economy(selectPlanet(state, planet.id)).gross;
    return sum + gross.metal + 2 * gross.crystal + 3 * gross.deuterium;
  }, 0);
}

interface PrizeContext {
  cap: number;
  window: number;
  jackpotWindow: number;
}

function prizeContext(state: GameState): PrizeContext {
  const perSecond = productionMe(state);
  return {
    cap: prizeCap(state),
    window: perSecond * ARCADE.prizeWindowSeconds,
    jackpotWindow: perSecond * ARCADE.jackpotWindowSeconds,
  };
}

function lerp(range: readonly number[], u: number): number {
  const lo = range[0] ?? 0;
  const hi = range[1] ?? lo;
  return lo + (hi - lo) * Math.min(1, Math.max(0, u));
}

/** Metal-equivalent value range of a resource tile right now (for the tooltip). */
export function resourceRange(state: GameState, bigTier: boolean): [number, number] {
  const ctx = prizeContext(state);
  const tier = bigTier ? ARCADE.tiers.big : ARCADE.tiers.normal;
  return [Math.min(ctx.window, ctx.cap * (tier[0] ?? 0)), Math.min(ctx.window, ctx.cap * (tier[1] ?? 0))];
}

function giveResource(state: GameState, res: ResourceId, amount: number): { state: GameState; text: string } {
  const whole = Math.floor(Math.max(0, amount));
  const room = Math.floor(freeStorage(state, res));
  const given = Math.min(whole, room);
  const lost = whole - given;
  const resources = { ...activePlanet(state).resources, [res]: activePlanet(state).resources[res].add(given) };
  const overflow = lost > 0 ? `（仓库满，溢出 ${formatAmount(big(lost))}）` : "";
  return { state: { ...withPlanet(state, { resources }) }, text: `${RES_ZH[res]} +${formatAmount(big(given))}${overflow}` };
}

// ---------- drifting ships (P3) ----------

/** Metal-equivalent value of one ship (crystal ×2, deuterium ×3). */
export function shipValueMe(id: ShipId): number {
  const c = unitById(id).cost;
  return c.metal + 2 * c.crystal + 3 * c.deuterium;
}

/**
 * Ships a drifter tile can hand out: every ladder ship whose requirements are met, plus one tier above the
 * best of them (design doc §8.6.2: "只出现已解锁及高一档的舰船，不出死星"). Without any, the first rung.
 */
export function drifterPool(state: GameState): ShipId[] {
  let top = -1;
  const pool: ShipId[] = [];
  DRIFTER_LADDER.forEach((id, index) => {
    if (unitMissing(state, id).length === 0) {
      pool.push(id);
      top = index;
    }
  });
  const above = DRIFTER_LADDER[top + 1];
  if (above && !pool.includes(above)) pool.push(above);
  return pool;
}

/**
 * Split a metal-equivalent value into ships: ~60% into a type picked by `v` from the pool, the rest into the
 * cheapest pool ship. Whatever is too small for one more ship comes as metal.
 */
export function drifterShips(state: GameState, valueMe: number, v: number): { ships: Array<{ id: ShipId; count: number }>; leftoverMe: number } {
  const pool = drifterPool(state);
  const cheapest = [...pool].sort((a, b) => shipValueMe(a) - shipValueMe(b))[0]!;
  const pick = pool[Math.min(pool.length - 1, Math.floor(Math.max(0, v) * pool.length))]!;
  let left = Math.max(0, valueMe);
  const ships: Array<{ id: ShipId; count: number }> = [];
  const add = (id: ShipId, count: number) => {
    if (count <= 0) return;
    const same = ships.find((entry) => entry.id === id);
    if (same) same.count += count;
    else ships.push({ id, count });
    left -= count * shipValueMe(id);
  };
  add(pick, Math.floor((left * 0.6) / shipValueMe(pick)));
  add(cheapest, Math.floor(left / shipValueMe(cheapest)));
  return { ships, leftoverMe: Math.max(0, left) };
}

function giveShips(state: GameState, valueMe: number, v: number): { state: GameState; text: string } {
  const split = drifterShips(state, valueMe, v);
  const units = { ...activePlanet(state).units };
  for (const { id, count } of split.ships) units[id] += count;
  let next: GameState = { ...withPlanet(state, { planet: { ...activePlanet(state), units } }) };
  const parts = split.ships.map(({ id, count }) => `${unitById(id).nameZh} ×${count.toLocaleString("zh-CN")}`);
  if (split.leftoverMe >= 1) {
    const metal = giveResource(next, "metal", split.leftoverMe);
    next = metal.state;
    parts.push(`零头折合${metal.text}`);
  }
  return { state: next, text: parts.length > 0 ? parts.join("、") : "空空如也" };
}

/** Metal-equivalent value range of a drifter tile right now: half the resource prize (for the tooltip). */
export function drifterRange(state: GameState, bigTier: boolean): [number, number] {
  const [lo, hi] = resourceRange(state, bigTier);
  return [lo / 2, hi / 2];
}

interface Applied {
  state: GameState;
  line: string;
  paid: boolean;
}

function applyLight(state: GameState, light: LightRoll, ctx: PrizeContext, train: boolean): Applied {
  const symbol = BOARD[light.tile]!;
  const name = arcadeSymbolDef(symbol).nameZh;
  const tierZh = light.big ? "（大）" : "";
  if (!tileOpen(light.tile) || (train && (symbol === "lucky" || symbol === "jackpot"))) {
    return { state, line: `${name}：跳过`, paid: false };
  }
  if (symbol === "metal" || symbol === "crystal" || symbol === "deuterium") {
    const tier = light.big ? ARCADE.tiers.big : ARCADE.tiers.normal;
    const valueMe = Math.min(ctx.cap * lerp(tier, light.u), ctx.window);
    const given = giveResource(state, symbol, valueMe / ME_FACTOR[symbol]);
    return { state: given.state, line: `${name}${tierZh}：${given.text}`, paid: true };
  }
  if (symbol === "drifter") {
    const tier = light.big ? ARCADE.tiers.big : ARCADE.tiers.normal;
    const valueMe = Math.min(ctx.cap * lerp(tier, light.u), ctx.window) / 2;
    const given = giveShips(state, valueMe, light.v);
    return { state: given.state, line: `${name}${tierZh}：${given.text}`, paid: true };
  }
  if (symbol === "dark_matter") {
    const amount = Math.round(lerp(light.big ? ARCADE.darkMatter.big : ARCADE.darkMatter.normal, light.u));
    const next = grantDarkMatter(state, amount);
    const stats = { ...next.arcade.stats, darkMatter: next.arcade.stats.darkMatter + amount };
    return { state: withArcade(next, { stats }), line: `${name}${tierZh}：+${formatDm(amount)} 暗物质`, paid: true };
  }
  if (symbol === "supply") {
    const item = INVENTORY_IDS[Math.min(INVENTORY_IDS.length - 1, Math.floor(light.u * INVENTORY_IDS.length))]!;
    const count = light.big ? 2 : 1;
    return {
      state: addInventory(state, item, count),
      line: `${name}${tierZh}：${INVENTORY_LABEL[item].name} ×${count} 放进背包`,
      paid: true,
    };
  }
  if (symbol === "empty") {
    if (train) return { state, line: `${name}：忽略`, paid: false };
    return { state, line: `${name}：${EMPTY_LINES[Math.floor(light.u * EMPTY_LINES.length) % EMPTY_LINES.length]}`, paid: true };
  }
  if (symbol === "turbulence") {
    if (train) return { state, line: `${name}：忽略`, paid: false };
    const base = ARCADE.beaconSeconds;
    const required = Math.min(base * 3, state.arcade.beaconRequired + (base * ARCADE.turbulencePct) / 100);
    const next = withArcade(state, { beaconRequired: required });
    return { state: next, line: `${name}：本次信标冷却 +${ARCADE.turbulencePct}%（共 ${formatDuration(required)}）`, paid: true };
  }
  if (symbol === "tailwind") {
    const arcade = state.arcade;
    if (arcade.runs.length >= ARCADE.beaconMax) {
      return { state, line: `${name}：信标已满，顺流没有效果`, paid: true };
    }
    const progress = Math.min(arcade.beaconRequired, arcade.beaconProgress + (arcade.beaconRequired * ARCADE.tailwindPct) / 100);
    const settled = settleBeacon(withArcade(state, { beaconProgress: progress }));
    const extra = settled.granted > 0 ? "，立刻攒满 1 次信标" : "";
    return { state: settled.state, line: `${name}：信标冷却退回 ${ARCADE.tailwindPct}%${extra}`, paid: true };
  }
  if (symbol === "jackpot") {
    const kind = jackpotKind(state, light.v);
    const valueMe = Math.min(ctx.cap * lerp(ARCADE.tiers.jackpot, light.u), ctx.jackpotWindow);
    const given = kind === "drifter" ? giveShips(state, valueMe / 2, light.v) : giveResource(state, kind, valueMe / ME_FACTOR[kind]);
    const dm = Math.round(lerp(ARCADE.darkMatter.jackpot, light.v));
    const next = grantDarkMatter(given.state, dm);
    const stats = { ...next.arcade.stats, darkMatter: next.arcade.stats.darkMatter + dm };
    return { state: withArcade(next, { stats }), line: `JACKPOT：${given.text}，暗物质 +${formatDm(dm)}`, paid: true };
  }
  if (symbol === "lucky") return { state, line: "LUCKY 送灯", paid: true };
  return { state, line: `${name}：没有效果`, paid: false };
}

/** JACKPOT prize kind: the symbol with the most units bet (drifter = ships), else metal / crystal / deuterium 68 / 24 / 8. */
function jackpotKind(state: GameState, v: number): BetSymbol {
  let best: BetSymbol | null = null;
  for (const symbol of BET_SYMBOLS) {
    const units = state.arcade.bets[symbol];
    if (units > 0 && (best === null || units > state.arcade.bets[best])) best = symbol;
  }
  if (best) return best;
  const kinds = ARCADE.jackpotKinds;
  const total = kinds.metal + kinds.crystal + kinds.deuterium;
  const r = v * total;
  if (r < kinds.metal) return "metal";
  if (r < kinds.metal + kinds.crystal) return "crystal";
  return "deuterium";
}

// ---------- bets ----------

/** One bet unit = 5 minutes of empire deuterium production (at least 1,000). */
export function betUnitDeut(state: GameState): number {
  return Math.max(ARCADE.betUnitMin, Math.floor(economy(state).gross.deuterium * ARCADE.betUnitSeconds));
}

/** Total bet per run ≤ 1 hour of deuterium production = 12 units. */
export function maxBetUnits(): number {
  return Math.floor(ARCADE.betMaxSeconds / ARCADE.betUnitSeconds);
}

export function totalBetUnits(state: GameState): number {
  return BET_SYMBOLS.reduce((sum, symbol) => sum + state.arcade.bets[symbol], 0);
}

export function setBet(state: GameState, symbol: BetSymbol, units: number): ArcadeResult {
  if (!Number.isInteger(units) || units < 0) return { state, ok: false, reason: "注数无效" };
  const others = totalBetUnits(state) - state.arcade.bets[symbol];
  const allowed = Math.max(0, maxBetUnits() - others);
  const next = Math.min(units, allowed);
  const name = arcadeSymbolDef(symbol).nameZh;
  const bets = { ...state.arcade.bets, [symbol]: next };
  const capped = next < units ? `（合计上限 ${maxBetUnits()} 注）` : "";
  return { state: withArcade(state, { bets }), ok: true, reason: `押注${name} ${next} 注${capped}` };
}

// ---------- reveal ----------

function settleBets(state: GameState, ctx: { unit: number; active: boolean }, symbol: ArcadeSymbol): { state: GameState; line: string } {
  if (!ctx.active || (symbol !== "metal" && symbol !== "crystal" && symbol !== "deuterium" && symbol !== "drifter")) return { state, line: "" };
  const units = state.arcade.bets[symbol];
  if (units <= 0) return { state, line: "" };
  const winMe = units * ctx.unit * ME_FACTOR.deuterium * betOdds(symbol);
  // A drifter bet pays ships of the same value (design doc §8.6.5).
  const given = symbol === "drifter" ? giveShips(state, winMe, 0.5) : giveResource(state, symbol, winMe / ME_FACTOR[symbol]);
  const stats = { ...given.state.arcade.stats, betWon: given.state.arcade.stats.betWon + winMe };
  return {
    state: withArcade(given.state, { stats }),
    line: `押中${arcadeSymbolDef(symbol).nameZh} ×${betOdds(symbol).toFixed(1)}：${given.text}`,
  };
}

/** Reveal the oldest stored run. Bets are charged in deuterium first; without enough deuterium the run goes unbet. */
export function revealRun(state: GameState, mode: RevealMode): ArcadeResult & { result: RunResult | null } {
  const run = state.arcade.runs[0];
  if (!run) return { state, ok: false, reason: "没有可用开奖次数", result: null };
  if (run.source === "charge") {
    if (!run.receipt) throw Error("充能回放缺少已结算凭证");
    const symbol=BOARD[run.outcome.main.tile]!,r=run.receipt;
    const lines=["深空事件回放：损失已结算，奖励随舰队返航；此处不会再次发奖。",...r.lines];
    const a=state.arcade;
    const stats={...a.stats,runs:a.stats.runs+1,manualRuns:a.stats.manualRuns+(mode==="manual"?1:0),autoRuns:a.stats.autoRuns+(mode==="auto"?1:0),hits:{...a.stats.hits,[symbol]:a.stats.hits[symbol]+1}};
    const next=withArcade(state,{runs:a.runs.slice(1),stats,position:run.outcome.main.tile,history:[...a.history,{symbol,big:run.outcome.main.big,at:state.totalTime.toNumber(),auto:mode==="auto",summary:lines.join("；")}].slice(-ARCADE.historySize)});
    return {state:next,ok:true,reason:lines.join("；"),result:{source:"charge",startTile:a.position,mainTile:run.outcome.main.tile,symbol,big:run.outcome.main.big,luckyKind:run.outcome.lucky?.kind??null,lights:r.lights,lines,forced:run.outcome.forced}};
  }
  let current = withArcade(state, { runs: state.arcade.runs.slice(1) });
  const lines: string[] = [];

  const unit = betUnitDeut(current);
  const units = totalBetUnits(current);
  let active = false;
  if (units > 0) {
    const cost = units * unit;
    if (activePlanet(current).resources.deuterium.gte(cost)) {
      active = true;
      const stats = { ...current.arcade.stats, betSpent: current.arcade.stats.betSpent + cost * ME_FACTOR.deuterium };
      current = withArcade(
        { ...withPlanet(current, { resources: { ...activePlanet(current).resources, deuterium: activePlanet(current).resources.deuterium.sub(cost) } }) },
        { stats },
      );
      lines.push(`押注 ${units} 注，花费重氢 ${formatAmount(big(cost))}`);
    } else {
      lines.push(`重氢不足 ${formatAmount(big(cost))}，本次未押注`);
    }
  }
  const betCtx = { unit, active };
  const ctx = prizeContext(current);
  const { main, lucky } = run.outcome;
  const mainSymbol = BOARD[main.tile]!;
  const lights: RunLight[] = [{ tile: main.tile, symbol: mainSymbol, big: main.big, paid: true }];

  const first = applyLight(current, main, ctx, false);
  current = first.state;
  lines.push(first.line);
  const firstBet = settleBets(current, betCtx, mainSymbol);
  current = firstBet.state;
  if (firstBet.line) lines.push(firstBet.line);

  if (lucky) {
    const row = LUCKY_TABLE.find((item) => item.kind === lucky.kind)!;
    lines.push(`送灯：${row.nameZh}`);
    for (const light of lucky.lights) {
      const symbol = BOARD[light.tile]!;
      const applied = applyLight(current, light, ctx, lucky.kind === "train");
      current = applied.state;
      lights.push({ tile: light.tile, symbol, big: light.big, paid: applied.paid });
      lines.push(`  ${applied.line}`);
      if (applied.paid) {
        const bet = settleBets(current, betCtx, symbol);
        current = bet.state;
        if (bet.line) lines.push(`  ${bet.line}`);
      }
    }
  }

  const arcade = current.arcade;
  const pity = {
    empty: EMPTY_SYMBOLS.includes(mainSymbol) ? arcade.pity.empty + 1 : 0,
    jackpot: mainSymbol === "jackpot" ? 0 : arcade.pity.jackpot + 1,
  };
  const hits = { ...arcade.stats.hits, [mainSymbol]: arcade.stats.hits[mainSymbol] + 1 };
  const stats: ArcadeStats = {
    ...arcade.stats,
    runs: arcade.stats.runs + 1,
    manualRuns: arcade.stats.manualRuns + (mode === "manual" ? 1 : 0),
    autoRuns: arcade.stats.autoRuns + (mode === "auto" ? 1 : 0),
    hits,
  };
  const summary = lines.filter((line) => !line.startsWith("押注 ") && !line.startsWith("重氢不足")).join("；");
  const entry: ArcadeHistoryEntry = {
    symbol: mainSymbol,
    big: main.big,
    at: current.totalTime.toNumber(),
    auto: mode === "auto",
    summary,
  };
  const history = [...arcade.history, entry].slice(-ARCADE.historySize);
  current = withArcade(current, { pity, stats, history, position: lights[lights.length - 1]!.tile });
  const result: RunResult = {
    source: run.source,
    startTile: state.arcade.position,
    mainTile: main.tile,
    symbol: mainSymbol,
    big: main.big,
    luckyKind: lucky?.kind ?? null,
    lights,
    lines,
    forced: run.outcome.forced,
  };
  return { state: current, ok: true, reason: summary, result };
}

/** Reveal every stored run. */
export function revealAll(state: GameState, mode: RevealMode): ArcadeResult & { results: RunResult[] } {
  let current = state;
  const results: RunResult[] = [];
  for (let guard = 0; guard < storedRunLimit(state) + 4 && current.arcade.runs.length > 0; guard += 1) {
    const step = revealRun(current, mode);
    if (!step.result) break;
    current = step.state;
    results.push(step.result);
  }
  if (results.length === 0) return { state, ok: false, reason: "没有可用开奖次数", results };
  return { state: current, ok: true, reason: summarizeResults(results), results };
}

export function summarizeResults(results: readonly RunResult[]): string {
  const counts = new Map<ArcadeSymbol, number>();
  for (const result of results) counts.set(result.symbol, (counts.get(result.symbol) ?? 0) + 1);
  const parts = [...counts.entries()].map(([symbol, count]) => `${arcadeSymbolDef(symbol).nameZh} ×${count}`);
  return `开奖 ${results.length} 次：${parts.join("、")}`;
}

// ---------- deuterium top-up ----------

function recentTopUps(state: GameState): number[] {
  const now = state.totalTime.toNumber();
  return state.arcade.topUps.filter((at) => now - at < ARCADE.topUpWindowSeconds);
}

/** Hourly deuterium production × 2^(top-ups in the last 24 h of game time), at least 5,000 × 2^n. */
export function topUpPrice(state: GameState): number {
  const hourly = Math.max(ARCADE.topUpMinDeut, economy(state).gross.deuterium * ARCADE.topUpHourSeconds);
  return Math.ceil(hourly) * 2 ** recentTopUps(state).length;
}

export function topUpReason(state: GameState): string {
  if (!arcadeUnlocked(state)) return "需要天体物理学 1 级";
  if (state.arcade.runs.length + chargeReservations(state) >= storedRunLimit(state)) return `开奖次数与在途预留已存满（${storedRunLimit(state)}）`;
  const price = topUpPrice(state);
  if (activePlanet(state).resources.deuterium.lt(price)) return `重氢不足（需要 ${formatAmount(big(price))}）`;
  return "";
}

export function topUp(state: GameState): ArcadeResult {
  const reason = topUpReason(state);
  if (reason) return { state, ok: false, reason };
  const price = topUpPrice(state);
  const paid: GameState = { ...withPlanet(state, { resources: { ...activePlanet(state).resources, deuterium: activePlanet(state).resources.deuterium.sub(price) } }), arcade: { ...state.arcade, topUps: [...recentTopUps(state), state.totalTime.toNumber()] } };
  const granted = grantRun(paid, "topup");
  return { state: granted.state, ok: true, reason: `重氢加注 ${formatAmount(big(price))}，多攒 1 次开奖` };
}
