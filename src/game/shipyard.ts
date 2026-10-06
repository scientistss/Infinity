/**
 * Shipyard queue (design doc §7.1, P3). Ships and defenses are ordered in batches (unit × count) and built one
 * unit after another. The whole batch is charged on enqueue; cancelling refunds every unit not finished yet.
 * Unit time = (metal + crystal) / (2500 × (1 + shipyard) × 2^nanite) hours ÷ S, read from the current levels.
 * The shipyard stops while the shipyard or the nanite factory is being upgraded (OGame rule).
 */
import balance from "../data/balance.json";
import {
  SILO_SLOTS_PER_LEVEL,
  emptyUnits,
  UNIT_IDS,
  isUnitId,
  unitById,
  type UnitDef,
  type UnitId,
} from "../data/units";
import { resourceName } from "./content";
import { big } from "./decimal";
import { economy } from "./economy";
import { outputScale } from "../prestige/tree";
import { formatAmount } from "./format";
import { ECONOMY_SPEED, satelliteEnergyPerUnit, type ResourceCost } from "./formulas";
import type { OrderSource, PlanetState } from "./planet";
import { shortfall } from "./queue";
import { missingRequirements } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";

export const SHIPYARD = balance.shipyard;
const EPS = 1e-9;

/** One shipyard batch. Index 0 is being built. */
export interface ShipyardOrder {
  unit: UnitId;
  /** Units still to build in this batch, including the one in progress. */
  count: number;
  /** Fraction of the current unit already built, 0 ≤ progress < 1. */
  progress: number;
  source: OrderSource;
}

export interface CompletedUnits {
  unit: UnitId;
  count: number;
}

export interface ShipyardResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export interface UnitCheck {
  ok: boolean;
  reason: string;
  /** Units this order would build (clamped to what is allowed when asked for "max"). */
  count: number;
  cost: ResourceCost;
  onlyResources?: boolean;
}

export function unitCost(def: UnitDef, count = 1): ResourceCost {
  return {
    metal: big(def.cost.metal).mul(count),
    crystal: big(def.cost.crystal).mul(count),
    deuterium: big(def.cost.deuterium).mul(count),
  };
}

/** Seconds per unit at the current shipyard and nanite levels. */
export function unitSeconds(state: GameState, id: UnitId): number {
  const def = unitById(id);
  const b = state.planet.buildings;
  const hours = (def.cost.metal + def.cost.crystal) / (2500 * (1 + b.shipyard) * Math.pow(2, b.nanite_factory));
  return Math.max(SHIPYARD.minUnitSeconds, (hours * 3600) / ECONOMY_SPEED);
}

/** Why the shipyard is not working right now ("" when it can work). */
export function shipyardPausedReason(state: GameState): string {
  const head = state.planet.buildQueue[0];
  if (!head || head.totalSeconds <= 0) return "";
  if (head.building === "shipyard") return "造船厂升级中，暂停造船";
  if (head.building === "nanite_factory") return "纳米机器人工厂升级中，暂停造船";
  return "";
}

export function queuedUnits(planet: PlanetState, id: UnitId): number {
  return planet.shipyardQueue.reduce((sum, order) => sum + (order.unit === id ? order.count : 0), 0);
}

/** Owned plus queued. */
export function unitTotal(planet: PlanetState, id: UnitId): number {
  return planet.units[id] + queuedUnits(planet, id);
}

export function siloCapacity(planet: PlanetState): number {
  return planet.buildings.missile_silo * SILO_SLOTS_PER_LEVEL;
}

/** Silo slots taken by built and queued missiles. */
export function siloUsed(planet: PlanetState): number {
  let used = 0;
  for (const id of UNIT_IDS) {
    const slots = unitById(id).siloSlots;
    if (slots) used += unitTotal(planet, id) * slots;
  }
  return used;
}

/** Energy from one solar satellite: ⌊(T_max + 140) / 6⌋ (OGame). */
export function satelliteEnergy(planet: PlanetState): number {
  return satelliteEnergyPerUnit(planet.tempMax);
}

/** Hard limits that do not depend on resources: shield domes (1 each) and silo slots. */
function capLimit(planet: PlanetState, def: UnitDef): number {
  let limit = Number.POSITIVE_INFINITY;
  if (def.maxCount !== undefined) limit = Math.max(0, def.maxCount - unitTotal(planet, def.id));
  if (def.siloSlots) limit = Math.min(limit, Math.floor(Math.max(0, siloCapacity(planet) - siloUsed(planet)) / def.siloSlots));
  return limit;
}

/** Most units of `id` the current stock pays for, within dome / silo limits and the batch cap. */
export function maxBuildable(state: GameState, id: UnitId): number {
  const def = unitById(id);
  let most = Math.min(SHIPYARD.maxBatch, capLimit(state.planet, def));
  for (const res of RESOURCE_IDS) {
    const price = def.cost[res];
    if (price > 0) most = Math.min(most, Math.floor(state.resources[res].toNumber() / price + 1e-9));
  }
  return Math.max(0, Number.isFinite(most) ? most : 0);
}

export function unitMissing(state: GameState, id: UnitId): string[] {
  return missingRequirements(state, unitById(id).requires);
}

/** Can `count` units of `id` be ordered now? */
export function canBuildUnits(state: GameState, id: UnitId, count: number): UnitCheck {
  const def = unitById(id);
  const n = Math.floor(count);
  const cost = unitCost(def, Math.max(1, n));
  const fail = (reason: string, extra: Partial<UnitCheck> = {}): UnitCheck => ({ ok: false, reason, count: Math.max(0, n), cost, ...extra });
  if (state.planet.buildings.shipyard < 1) return fail("需要造船厂 等级 1");
  const missing = unitMissing(state, id);
  if (missing.length > 0) return fail(`需要 ${missing.join("、")}`);
  if (!(n >= 1)) return fail("数量至少 1");
  if (n > SHIPYARD.maxBatch) return fail(`单批最多 ${SHIPYARD.maxBatch.toLocaleString("zh-CN")}`);
  const queue = state.planet.shipyardQueue;
  if (queue.length >= SHIPYARD.maxOrders) return fail(`造船队列已满（${queue.length}/${SHIPYARD.maxOrders}）`);
  const limit = capLimit(state.planet, def);
  if (def.maxCount !== undefined && limit < n) return fail(`${def.nameZh}每颗星球最多 ${def.maxCount} 个`);
  if (def.siloSlots && limit < n) {
    const free = Math.max(0, siloCapacity(state.planet) - siloUsed(state.planet));
    return fail(state.planet.buildings.missile_silo < 1 ? "需要导弹井" : `导弹井空位不足（剩 ${free} 格，每枚占 ${def.siloSlots} 格）`);
  }
  const lack = shortfall(state, cost);
  if (lack) return fail(lack, { onlyResources: true });
  return { ok: true, reason: "", count: n, cost };
}

/** Charge the batch and append it to the shipyard queue. */
export function enqueueUnits(state: GameState, id: UnitId, count: number, source: OrderSource): ShipyardResult {
  const check = canBuildUnits(state, id, count);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const resources = { ...state.resources };
  for (const res of RESOURCE_IDS) resources[res] = resources[res].sub(check.cost[res]);
  const planet: PlanetState = {
    ...state.planet,
    shipyardQueue: [...state.planet.shipyardQueue.map((o) => ({ ...o })), { unit: id, count: check.count, progress: 0, source }],
  };
  const stats = source === "manual" ? { ...state.stats, manualActions: state.stats.manualActions + 1 } : state.stats;
  return {
    state: { ...state, resources, planet, stats },
    ok: true,
    reason: `${unitById(id).nameZh} ×${check.count.toLocaleString("zh-CN")} 已入队`,
  };
}

export type UnitAmount = number | "max" | { fillTo: number };

/** Resolve "max" / fill-to into a count (0 when nothing is needed or affordable). */
export function resolveUnitAmount(state: GameState, id: UnitId, amount: UnitAmount): number {
  if (amount === "max") return maxBuildable(state, id);
  if (typeof amount === "number") return Math.floor(amount);
  return Math.max(0, Math.floor(amount.fillTo) - unitTotal(state.planet, id));
}

/** Order units by count, "max" or fill-to-N (owned + queued count toward N). */
export function orderUnits(state: GameState, id: UnitId, amount: UnitAmount, source: OrderSource): ShipyardResult {
  const count = resolveUnitAmount(state, id, amount);
  const def = unitById(id);
  if (count < 1) {
    if (amount === "max") {
      const check = canBuildUnits(state, id, 1);
      return { state, ok: false, reason: check.ok ? "一个也造不起" : check.reason };
    }
    if (typeof amount === "object") {
      return { state, ok: false, reason: `${def.nameZh}已有 ${unitTotal(state.planet, id).toLocaleString("zh-CN")}（含排队），不少于 ${amount.fillTo.toLocaleString("zh-CN")}` };
    }
  }
  return enqueueUnits(state, id, count, source);
}

/** Cancel a batch: every unit not finished yet is refunded in full (the one in progress too). */
export function cancelUnits(state: GameState, index: number): ShipyardResult {
  const order = state.planet.shipyardQueue[index];
  if (!Number.isInteger(index) || !order) return { state, ok: false, reason: "造船队列中没有这一项" };
  const refund = unitCost(unitById(order.unit), order.count);
  const resources = { ...state.resources };
  for (const res of RESOURCE_IDS) resources[res] = resources[res].add(refund[res]);
  const shipyardQueue = state.planet.shipyardQueue.filter((_, i) => i !== index).map((o) => ({ ...o }));
  return {
    state: { ...state, resources, planet: { ...state.planet, shipyardQueue } },
    ok: true,
    reason: `已取消 ${unitById(order.unit).nameZh} ×${order.count.toLocaleString("zh-CN")}，资源已全额退还`,
  };
}

/** Seconds left on the head batch (null when idle or paused). */
export function shipyardRemaining(state: GameState): number | null {
  const head = state.planet.shipyardQueue[0];
  if (!head || shipyardPausedReason(state)) return null;
  return (head.count - head.progress) * unitSeconds(state, head.unit);
}

/** Whole queue time at the current levels (ignores pauses). */
export function shipyardQueueSeconds(state: GameState): number {
  return state.planet.shipyardQueue.reduce((sum, order) => sum + (order.count - order.progress) * unitSeconds(state, order.unit), 0);
}

/**
 * Seconds until the next shipyard event for tick(): the end of the head batch, or, while solar satellites are
 * built, the next satellite (energy changes with each one; at least 1 s apart so tiny unit times do not explode
 * the number of segments).
 */
export function nextShipyardEvent(state: GameState): number {
  const head = state.planet.shipyardQueue[0];
  if (!head || shipyardPausedReason(state)) return Number.POSITIVE_INFINITY;
  const per = unitSeconds(state, head.unit);
  const batch = (head.count - head.progress) * per;
  if (head.unit !== "solar_satellite") return batch;
  return Math.min(batch, Math.max((1 - head.progress) * per, 1));
}

/**
 * Run the shipyard for `seconds`. With `carry` the time flows on into later batches (tick, DETROIT);
 * without it only the head batch is shortened (halve / finish).
 */
export function advanceShipyard(
  state: GameState,
  seconds: number,
  carry = true,
): { state: GameState; completed: CompletedUnits[] } {
  const completed: CompletedUnits[] = [];
  if (!(seconds > 0) || state.planet.shipyardQueue.length === 0 || shipyardPausedReason(state)) return { state, completed };
  const queue = state.planet.shipyardQueue.map((o) => ({ ...o }));
  const units = { ...state.planet.units };
  let left = seconds;
  while (left > EPS && queue.length > 0) {
    const head = queue[0]!;
    const per = unitSeconds(state, head.unit);
    const batch = (head.count - head.progress) * per;
    if (left + EPS * Math.max(1, per) >= batch) {
      units[head.unit] += head.count;
      completed.push({ unit: head.unit, count: head.count });
      queue.shift();
      left -= batch;
      if (!carry) break;
      continue;
    }
    const built = head.progress + left / per;
    let whole = Math.floor(built + 1e-9);
    whole = Math.min(whole, head.count - 1);
    if (whole > 0) {
      units[head.unit] += whole;
      completed.push({ unit: head.unit, count: whole });
    }
    head.count -= whole;
    head.progress = Math.max(0, Math.min(1 - 1e-12, built - whole));
    left = 0;
  }
  const merged = mergeCompleted(completed);
  const stats = { ...state.stats, unitsBuilt: state.stats.unitsBuilt + merged.reduce((s, u) => s + u.count, 0) };
  return { state: { ...state, stats, planet: { ...state.planet, units, shipyardQueue: queue } }, completed: merged };
}

export function mergeCompleted(list: readonly CompletedUnits[]): CompletedUnits[] {
  const out: CompletedUnits[] = [];
  for (const item of list) {
    const same = out.find((entry) => entry.unit === item.unit);
    if (same) same.count += item.count;
    else out.push({ ...item });
  }
  return out;
}

export function cloneShipyard(planet: PlanetState): Pick<PlanetState, "units" | "shipyardQueue"> {
  return { units: { ...planet.units }, shipyardQueue: planet.shipyardQueue.map((o) => ({ ...o })) };
}

/** Resources spent on everything standing on the planet's shipyard side (OGame fleet + defense points). */
export function unitSpend(planet: PlanetState): number {
  let spent = 0;
  for (const id of UNIT_IDS) {
    const n = planet.units[id];
    if (n <= 0) continue;
    const c = unitById(id).cost;
    spent += (c.metal + c.crystal + c.deuterium) * n;
  }
  return spent;
}

/** Energy deficit (demand − supply, ≥ 0) counting satellites already queued as supply. */
export function deficitAfterQueued(state: GameState): number {
  const eco = economy(state);
  const queued = queuedUnits(state.planet, "solar_satellite") * satelliteEnergy(state.planet) * outputScale(state);
  return Math.max(0, eco.demand - eco.supply - queued);
}

export function unitLabel(id: UnitId, count: number): string {
  return `${unitById(id).nameZh} ×${formatAmount(big(count))}`;
}

export function isOrderSource(value: unknown): value is OrderSource {
  return value === "manual" || value === "protocol";
}

export { emptyUnits, isUnitId, resourceName };
