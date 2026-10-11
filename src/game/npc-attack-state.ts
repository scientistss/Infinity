import { SHIP_IDS, type ShipId } from "../data/units";
import { big, isValidAmount } from "./decimal";
import type { BattleResult, BattleRound, CombatTech } from "./encounter-combat";
import { coordinateKey, SPACE, type Coordinates } from "./galaxy";
import { npcBattleSeed } from "./npc-battle";
import { isNpcCoordinates, isNpcGarrison } from "./npc-garrison";
import { allocateNpcLoot, isNpcResourceTuple, npcSurvivingWholeCapacity, type NpcResourceTuple, type NpcSurvivingShips } from "./npc-loot";
import { createNpcWallet, createNpcWalletContext, projectNpc, readNpcWalletState, NPC_WALLET_MODEL, type NpcWalletContext } from "./npc-wallet";
import { RESOURCE_IDS, type GameState } from "./types";

export const NPC_SITE_LIMIT = 512;
export const NPC_TERMINAL_REPORT_LIMIT = 60;
export const NPC_UNFINISHED_ATTACK_LIMIT = 64;
export const NPC_BATTLE_MODEL = "npc-battle-receipts-v1";
export type NpcAttackPhase =
  | { readonly kind: "outbound" }
  | { readonly kind: "returning"; readonly reason: "battle" | "recall" | "target-invalid"; readonly dockBlocked: boolean };
export interface NpcAttackContract {
  readonly seed: number;
  readonly cargoFactor: number;
  readonly phase: NpcAttackPhase;
}
export type NpcBattleSnapshot = Readonly<Omit<BattleResult, "rounds" | "attackerBefore" | "defenderBefore" | "attackerAfter" | "defenderAfter">> & {
  readonly rounds: readonly Readonly<BattleRound>[];
  readonly attackerBefore: NpcSurvivingShips;
  readonly defenderBefore: NpcSurvivingShips;
  readonly attackerAfter: NpcSurvivingShips;
  readonly defenderAfter: NpcSurvivingShips;
};
export interface NpcBattleReceipt {
  readonly fleetId: number;
  readonly originId: string;
  readonly target: Coordinates;
  readonly at: string;
  readonly seed: number;
  readonly cargoFactor: number;
  readonly attackerTech: Readonly<CombatTech>;
  readonly battle: NpcBattleSnapshot;
  readonly stockBefore: NpcResourceTuple;
  readonly loot: NpcResourceTuple;
  readonly delivery: "returning" | "delivered" | "destroyed" | "forfeited";
}
export interface NpcBattleState {
  readonly model: typeof NPC_BATTLE_MODEL;
  readonly reports: readonly NpcBattleReceipt[];
}
export function createNpcBattleState(): NpcBattleState {
  return Object.freeze({ model: NPC_BATTLE_MODEL, reports: Object.freeze([]) });
}

const fail = (): never => { throw Error("NPC 攻击状态或战报无效"); };
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Reflect.ownKeys(value).length === names.length && names.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return !!field && "value" in field && field.enumerable;
  });
}
function array(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    if (!field || !("value" in field) || !field.enumerable) return false;
  }
  return true;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
const cargoFactors = new Set(Array.from({ length: 1001 }, (_, level) => 1 + .05 * level));
function factor(value: unknown): value is number { return typeof value === "number" && cargoFactors.has(value); }
const tupleCopy = (value: NpcResourceTuple): NpcResourceTuple => Object.freeze([value[0], value[1], value[2]]);
const total = (ships: NpcSurvivingShips): number => Object.values(ships).reduce((sum, n) => sum + (n ?? 0), 0);
function sameShips(a: NpcSurvivingShips, b: NpcSurvivingShips): boolean {
  return SHIP_IDS.every(id => id === "solar_satellite" || (a[id] ?? 0) === (b[id] ?? 0));
}

export function readNpcAttackContract(value: unknown, universeSeed: number, fleetId: number, target: Coordinates): NpcAttackContract {
  if (!fields(value, ["seed", "cargoFactor", "phase"]) || value.seed !== npcBattleSeed(universeSeed, fleetId, target)
    || !factor(value.cargoFactor)) return fail();
  const phase = value.phase;
  if (fields(phase, ["kind"]) && phase.kind === "outbound") {
    return Object.freeze({ seed: value.seed as number, cargoFactor: value.cargoFactor, phase: Object.freeze({ kind: "outbound" }) });
  }
  if (!fields(phase, ["kind", "reason", "dockBlocked"]) || phase.kind !== "returning"
    || !["battle", "recall", "target-invalid"].includes(phase.reason as string) || typeof phase.dockBlocked !== "boolean") return fail();
  return Object.freeze({ seed: value.seed as number, cargoFactor: value.cargoFactor,
    phase: Object.freeze({ kind: "returning", reason: phase.reason as "battle" | "recall" | "target-invalid", dockBlocked: phase.dockBlocked }) });
}
function readShips(value: unknown, allowZero = false): NpcSurvivingShips {
  if (!plain(value)) return fail();
  const ships: Partial<Record<ShipId, number>> = {};
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !SHIP_IDS.includes(key as ShipId) || key === "solar_satellite"
      || !field || !("value" in field) || !field.enumerable || !integer(field.value, allowZero ? 0 : 1, SPACE.maxShips)) return fail();
  }
  for (const id of SHIP_IDS) if (Object.hasOwn(value, id)) ships[id] = value[id] as number;
  if (!Number.isSafeInteger(total(ships))) return fail();
  return Object.freeze(ships);
}
function readTech(value: unknown): Readonly<CombatTech> {
  if (!fields(value, ["weapons", "shields", "armour"]) || !integer(value.weapons, 0, 1000)
    || !integer(value.shields, 0, 1000) || !integer(value.armour, 0, 1000)) return fail();
  return Object.freeze({ weapons: value.weapons, shields: value.shields, armour: value.armour });
}
function readBattle(value: unknown, seed: number, target: Coordinates): NpcBattleSnapshot {
  if (!fields(value, ["mode", "winner", "rounds", "attackerBefore", "defenderBefore", "attackerAfter", "defenderAfter"])
    || value.mode !== "squadron-v1" || !["attacker", "defender", "draw"].includes(value.winner as string)
    || !array(value.rounds, 6)) return fail();
  const attackerBefore = readShips(value.attackerBefore), defenderBefore = readShips(value.defenderBefore);
  const attackerAfter = readShips(value.attackerAfter), defenderAfter = readShips(value.defenderAfter);
  if (!total(attackerBefore)) return fail();
  for (const [before, after] of [[attackerBefore, attackerAfter], [defenderBefore, defenderAfter]]) {
    if (SHIP_IDS.some(id => id !== "solar_satellite" && (after[id] ?? 0) > (before[id] ?? 0))) return fail();
  }
  for (const ships of [defenderBefore, defenderAfter]) {
    if (Object.keys(ships).some(id => id !== "light_fighter" && id !== "heavy_fighter")
      || !isNpcGarrison({ light_fighter: ships.light_fighter ?? 0, heavy_fighter: ships.heavy_fighter ?? 0 }, seed, target)) return fail();
  }
  let attacker = total(attackerBefore), defender = total(defenderBefore);
  const rounds: Readonly<BattleRound>[] = value.rounds.map((round, index) => {
    if (!attacker || !defender || !fields(round, ["round", "attacker", "defender", "attackDamage", "defendDamage"])
      || round.round !== index + 1 || !integer(round.attacker, 0, attacker) || !integer(round.defender, 0, defender)
      || typeof round.attackDamage !== "number" || !Number.isFinite(round.attackDamage) || round.attackDamage < 0
      || typeof round.defendDamage !== "number" || !Number.isFinite(round.defendDamage) || round.defendDamage < 0) return fail();
    attacker = round.attacker; defender = round.defender;
    return Object.freeze({ round: index + 1, attacker, defender, attackDamage: round.attackDamage, defendDamage: round.defendDamage });
  });
  if (attacker !== total(attackerAfter) || defender !== total(defenderAfter)
    || (attacker && defender && rounds.length !== 6)
    || (total(defenderBefore) === 0 && (rounds.length !== 0 || !sameShips(attackerBefore, attackerAfter)))
    || (total(defenderBefore) > 0 && rounds.length === 0)) return fail();
  const winner = attacker && !defender ? "attacker" : defender && !attacker ? "defender" : "draw";
  if (value.winner !== winner) return fail();
  return Object.freeze({ mode: "squadron-v1", winner, rounds: Object.freeze(rounds), attackerBefore, defenderBefore, attackerAfter, defenderAfter });
}
function readReceipt(value: unknown, context: NpcWalletContext): NpcBattleReceipt {
  if (!fields(value, ["fleetId", "originId", "target", "at", "seed", "cargoFactor", "attackerTech", "battle", "stockBefore", "loot", "delivery"])
    || !integer(value.fleetId, 1, Number.MAX_SAFE_INTEGER - 1) || typeof value.originId !== "string"
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.originId) || !isNpcCoordinates(value.target)
    || typeof value.at !== "string" || value.at.length > 100 || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.at)
    || !isValidAmount(big(value.at)) || value.seed !== npcBattleSeed(context.seed, value.fleetId, value.target)
    || !factor(value.cargoFactor) || !isNpcResourceTuple(value.stockBefore) || !isNpcResourceTuple(value.loot)
    || !["returning", "delivered", "destroyed", "forfeited"].includes(value.delivery as string)) return fail();
  // Occupancy validation only; no wallet projection or materialization is adopted.
  projectNpc(createNpcWallet(), value.target, context);
  const battle = readBattle(value.battle, context.seed, value.target), attackerTech = readTech(value.attackerTech);
  const capacity = npcSurvivingWholeCapacity(battle.attackerAfter, value.cargoFactor, value.stockBefore);
  const loot = battle.winner === "attacker" ? allocateNpcLoot(value.stockBefore, capacity) : [0, 0, 0];
  if (value.loot.some((n, i) => !Number.isSafeInteger(n) || n !== loot[i])
    || (value.delivery === "destroyed") !== (total(battle.attackerAfter) === 0)) return fail();
  return Object.freeze({ fleetId: value.fleetId, originId: value.originId, target: Object.freeze({ ...value.target }), at: value.at,
    seed: value.seed as number, cargoFactor: value.cargoFactor, attackerTech, battle,
    stockBefore: tupleCopy(value.stockBefore), loot: tupleCopy(value.loot), delivery: value.delivery as NpcBattleReceipt["delivery"] });
}
/** Shape and mathematical validation only. Never replay the combat kernel while reading. */
export function readNpcBattleState(value: unknown, context: NpcWalletContext): NpcBattleState {
  if (!fields(value, ["model", "reports"]) || value.model !== NPC_BATTLE_MODEL
    || !array(value.reports, NPC_TERMINAL_REPORT_LIMIT + NPC_UNFINISHED_ATTACK_LIMIT)) return fail();
  const reports = value.reports.map(report => readReceipt(report, context));
  if (new Set(reports.map(report => report.fleetId)).size !== reports.length
    || reports.filter(report => report.delivery !== "returning").length > NPC_TERMINAL_REPORT_LIMIT
    || reports.filter(report => report.delivery === "returning").length > NPC_UNFINISHED_ATTACK_LIMIT) return fail();
  return Object.freeze({ model: NPC_BATTLE_MODEL, reports: Object.freeze(reports) });
}
/** Keep all live receipts, plus the latest terminal receipts in existing chronological order. */
export function trimNpcBattleReports(reports: readonly NpcBattleReceipt[]): NpcBattleState {
  let remaining = NPC_TERMINAL_REPORT_LIMIT;
  const keep = reports.map(report => report.delivery === "returning");
  for (let i = reports.length - 1; i >= 0; i--) if (!keep[i] && remaining > 0) { keep[i] = true; remaining--; }
  return Object.freeze({ model: NPC_BATTLE_MODEL, reports: Object.freeze(reports.filter((_, i) => keep[i])) });
}
/** Full bidirectional live authority and historical permanent-target validation. */
export function validateNpcAttackReferences(state: GameState): void {
  const coordinates = state.planets.map(planet => planet.coordinates);
  // Preserve the established save-boundary diagnostic before the NPC context rejects duplicates.
  if (new Set(coordinates.map(coordinateKey)).size !== coordinates.length) throw Error("星球坐标重复");
  const context = createNpcWalletContext(state.universe.seed, NPC_SITE_LIMIT, coordinates);
  const wallet = readNpcWalletState(state.npcEconomy, context), battles = readNpcBattleState(state.npcBattles, context);
  if (!integer(state.nextFleetId, 1, Number.MAX_SAFE_INTEGER)) return fail();
  const live = new Map(state.fleets.map(fleet => [fleet.id, fleet]));
  const reports = new Map(battles.reports.map(report => [report.fleetId, report]));
  if (live.size !== state.fleets.length || state.fleets.filter(fleet => fleet.mission === "attack").length > NPC_UNFINISHED_ATTACK_LIMIT) return fail();
  for (const fleet of state.fleets) {
    if (fleet.mission !== "attack") { if (Object.hasOwn(fleet, "npcAttack") || reports.has(fleet.id)) return fail(); continue; }
    if (!fields(fleet, ["id", "orderTransport", "originId", "target", "mission", "ships", "cargo", "duration", "remaining", "returning", "elapsed", "npcAttack"])
      || !integer(fleet.id, 1, state.nextFleetId - 1) || !total(readShips(fleet.ships, true))
      || !fields(fleet.cargo, RESOURCE_IDS)
      || typeof fleet.duration !== "number" || !Number.isFinite(fleet.duration) || fleet.duration < SPACE.minFlightSeconds || fleet.duration > 1e12
      || typeof fleet.remaining !== "number" || !Number.isFinite(fleet.remaining) || fleet.remaining < 0 || fleet.remaining > fleet.duration + 1e-8
      || typeof fleet.elapsed !== "number" || !Number.isFinite(fleet.elapsed) || fleet.elapsed < 0 || fleet.elapsed + fleet.remaining > fleet.duration + 1e-6
      || !fleet.returning && Math.abs(fleet.elapsed + fleet.remaining - fleet.duration) > 1e-6) return fail();
    const attack = readNpcAttackContract(fleet.npcAttack, state.universe.seed, fleet.id, fleet.target);
    if (fleet.orderTransport !== null || Object.hasOwn(fleet, "charge") || !wallet.sites[coordinateKey(fleet.target)]
      || !state.planets.some(planet => planet.id === fleet.originId)
      || fleet.returning !== (attack.phase.kind === "returning")) return fail();
    if (attack.phase.kind === "returning" && attack.phase.dockBlocked && fleet.remaining !== 0) return fail();
    const report = reports.get(fleet.id), battleReturn = attack.phase.kind === "returning" && attack.phase.reason === "battle";
    if (battleReturn !== !!report) return fail();
    for (let i = 0; i < RESOURCE_IDS.length; i++) {
      const amount = fleet.cargo[RESOURCE_IDS[i]];
      if (!isValidAmount(amount) || !amount.eq(battleReturn ? report!.loot[i] : 0)) return fail();
    }
    if (report && (report.delivery !== "returning" || report.originId !== fleet.originId
      || coordinateKey(report.target) !== coordinateKey(fleet.target) || report.seed !== attack.seed
      || report.cargoFactor !== attack.cargoFactor || !sameShips(report.battle.attackerAfter, fleet.ships))) return fail();
  }
  for (const report of battles.reports) {
    const site = wallet.sites[coordinateKey(report.target)];
    if (!site || report.fleetId >= state.nextFleetId || big(report.at).gt(state.totalTime)
      || (report.delivery === "returning") !== live.has(report.fleetId)
      || site.garrison.light_fighter > (report.battle.defenderAfter.light_fighter ?? 0)
      || site.garrison.heavy_fighter > (report.battle.defenderAfter.heavy_fighter ?? 0)) return fail();
  }
}

/** Reserve only attack-specific names/models. Generic stock/phase/seed remain unrelated data. */
export function rejectNpcAttackFields(raw: unknown, legacy: boolean, envelope = false): void {
  const pending: Array<{ value: unknown; path: PropertyKey[]; ancestors: Set<object> }> = [{ value: raw, path: [], ancestors: new Set() }];
  while (pending.length) {
    const { value, path, ancestors } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    if (ancestors.has(value)) throw Error("NPC 存档格式不能包含循环对象");
    const ancestorsNext = new Set(ancestors); ancestorsNext.add(value);
    const statePath = envelope ? path.slice(1) : path;
    const inState = !envelope || path[0] === "state";
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw Error("NPC 存档格式不接受访问器字段");
      const child: unknown = descriptor.value;
      if (key === "npcAttack" && (legacy || !inState || statePath.length !== 2 || statePath[0] !== "fleets" || !/^\d+$/.test(String(statePath[1])))) return fail();
      if (key === "npcBattles" && (legacy || !inState || statePath.length !== 0)) return fail();
      if ((key === "model" && (child === NPC_WALLET_MODEL || child === NPC_BATTLE_MODEL)) && legacy) return fail();
      if (legacy && key === "mission" && child === "attack") return fail();
      if (child && typeof child === "object") pending.push({ value: child, path: [...path, key], ancestors: ancestorsNext });
    }
  }
}
