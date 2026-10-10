import { unitCost } from "./unit-cost";
export { unitCost } from "./unit-cost";
import { activePlanet, withPlanet } from "./empire";
/**
 * Shipyard queue (design doc §7.1, P3). Ships and defenses are ordered in batches (unit × count) and built one
 * unit after another. The whole batch is charged on enqueue; cancelling refunds every unit not finished yet.
 * Unit time = (metal + crystal) / (2500 × (1 + shipyard) × 2^nanite) hours ÷ S, read from the current levels.
 * The shipyard stops while the shipyard or the nanite factory is being upgraded (OGame rule).
 */
import balance from "../data/balance.json";
import {
  SILO_SLOTS_PER_LEVEL,
  SHIP_IDS,
  emptyUnits,
  UNIT_IDS,
  isUnitId,
  unitById,
  type UnitDef,
  type UnitId,
  type ShipId,
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
import { coordinateKey, sameCoordinates } from "./galaxy";
import { cancelledPaidJob, creditPaidJob, preparePaidJob, refundPaidJob } from "./order-ledger";
import { multiplyOrderAmountInteger } from "./order-money";
import type { OrderMoney, PaidJobIdentity } from "./order-state";

export const SHIPYARD = balance.shipyard;
const EPS = 1e-9;

/** One shipyard batch. Index 0 is being built. */
export interface ShipyardOrder extends PaidJobIdentity {
  unit: UnitId;
  /** Units still to build in this batch, including the one in progress. */
  count: number;
  /** Original paid batch quantity, retained through partial completions. */
  orderedCount: number;
  /** Immutable unit quote; cancellation never reads a newer catalog price. */
  paidPerUnit: ResourceCost;
  /** Fraction of the current unit already built, 0 ≤ progress < 1. */
  progress: number;
  source: OrderSource;
}

export interface CompletedUnits {
  unit: UnitId;
  count: number;
}

export interface ShipyardResult {
  jobId?: number;
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

/** Seconds per unit at the current shipyard and nanite levels. */
export function unitSeconds(state: GameState, id: UnitId): number {
  const def = unitById(id);
  const b = activePlanet(state).buildings;
  const hours = (def.cost.metal + def.cost.crystal) / (2500 * (1 + b.shipyard) * Math.pow(2, b.nanite_factory));
  return Math.max(SHIPYARD.minUnitSeconds, (hours * 3600) / ECONOMY_SPEED);
}

/** Why the shipyard is not working right now ("" when it can work). */
export function shipyardPausedReason(state: GameState, fleetCensus?: ShipyardFleetCensus): string {
  const head = activePlanet(state).buildQueue[0];
  if (head && head.totalSeconds > 0) {
    if (head.building === "shipyard") return "造船厂升级中，暂停造船";
    if (head.building === "nanite_factory") return "纳米机器人工厂升级中，暂停造船";
  }
  const batch = activePlanet(state).shipyardQueue[0];
  if (batch && shipOutputCapacity(state, batch.unit, false, fleetCensus) < 1) return "舰船数量达到安全上限，已付费余量暂停";
  return "";
}

export const MAX_PLANET_UNITS = 1e15;

/** Sum bounded integers without first making an imprecise or overflowing addition. */
function addCount(total: number, count: number, limit: number): number | null {
  if (!Number.isSafeInteger(count) || count < 0 || count > limit - total) return null;
  return total + count;
}

/**
 * Fleet-only census for one synchronous tick segment. The source array and nested
 * fleet data must stay unchanged throughout its use; never retain it across actions.
 */
export interface ShipyardFleetCensus {
  readonly sourceFleets: GameState["fleets"];
  readonly capacity: (planet: PlanetState, id: ShipId, local: number, empire: number) => number;
}

/**
 * Planet inventories and queues remain live: earlier yards in a segment may consume
 * empire capacity. Only fleets stay fixed until advanceFleets at the segment boundary.
 * Build the census lazily so idle yards and defenses do not pay for a fleet scan.
 */
export function createShipyardFleetCensus(fleets: GameState["fleets"]): ShipyardFleetCensus {
  type Fleet = GameState["fleets"][number];
  type Ports = { origins: Map<string, Fleet[]>; deployments: Map<string, Fleet[]> };
  const empireCounts = new Map<ShipId, number | null>();
  let ports: Ports | undefined;
  return {
    sourceFleets: fleets,
    capacity(planet, id, local, empire) {
      let fleetTotal = empireCounts.get(id);
      if (fleetTotal === undefined) {
        fleetTotal = 0;
        for (const fleet of fleets) {
          fleetTotal = addCount(fleetTotal, fleet.ships[id] ?? 0, Number.MAX_SAFE_INTEGER);
          if (fleetTotal === null) break;
        }
        empireCounts.set(id, fleetTotal);
      }
      if (fleetTotal === null) return 0;
      const empireTotal = addCount(empire, fleetTotal, Number.MAX_SAFE_INTEGER);
      if (empireTotal === null) return 0;
      if (!ports) {
        ports = { origins: new Map(), deployments: new Map() };
        const append = (index: Map<string, Fleet[]>, key: string, fleet: Fleet): void => {
          const bucket = index.get(key);
          if (bucket) bucket.push(fleet);
          else index.set(key, [fleet]);
        };
        for (const fleet of fleets) {
          append(ports.origins, fleet.originId, fleet);
          if (!fleet.returning && fleet.mission === "deploy") append(ports.deployments, coordinateKey(fleet.target), fleet);
        }
      }
      for (const fleet of ports.origins.get(planet.id) ?? []) {
        const total = addCount(local, fleet.ships[id] ?? 0, MAX_PLANET_UNITS);
        if (total === null) return 0;
        local = total;
      }
      for (const fleet of ports.deployments.get(coordinateKey(planet.coordinates)) ?? []) {
        // A same-port deployment reserves that port once, just like the original OR.
        if (fleet.originId === planet.id) continue;
        const total = addCount(local, fleet.ships[id] ?? 0, MAX_PLANET_UNITS);
        if (total === null) return 0;
        local = total;
      }
      return Math.min(MAX_PLANET_UNITS - local, Number.MAX_SAFE_INTEGER - empireTotal);
    },
  };
}

/**
 * Prospective output capacity shared by manual, protocol, and plan orders. A fleet is
 * counted once in its per-ShipId empire total, and separately reserves its eventual landing world.
 * Every fleet reserves its home port while recall is possible; an outbound deployment
 * also reserves its destination. Those local reservations never duplicate empire stock.
 * Completion ignores queued reservations so already-paid work can make only the units
 * that still fit if an unrelated reward has consumed capacity since its payment.
 */
export function shipOutputCapacity(state: GameState, id: UnitId, includeQueued = true, fleetCensus?: ShipyardFleetCensus): number {
  const planet = activePlanet(state);
  let local = addCount(0, planet.units[id], MAX_PLANET_UNITS);
  if (local === null) return 0;
  if (includeQueued) for (const order of planet.shipyardQueue) {
    if (order.unit !== id) continue;
    local = addCount(local, order.count, MAX_PLANET_UNITS);
    if (local === null) return 0;
  }
  if (unitById(id).kind !== "ship") return MAX_PLANET_UNITS - local;
  let empire = 0;
  for (const world of state.planets) {
    const total = addCount(empire, world.units[id], Number.MAX_SAFE_INTEGER);
    if (total === null) return 0;
    empire = total;
    if (includeQueued) for (const order of world.shipyardQueue) {
      if (order.unit !== id) continue;
      const total = addCount(empire, order.count, Number.MAX_SAFE_INTEGER);
      if (total === null) return 0;
      empire = total;
    }
  }
  // A context cannot be reused after any fleet action replaces the source array.
  if (fleetCensus?.sourceFleets === state.fleets) return fleetCensus.capacity(planet, id as ShipId, local, empire);
  for (const fleet of state.fleets) {
    const fleetCount = fleet.ships[id as (typeof SHIP_IDS)[number]] ?? 0;
    const total = addCount(empire, fleetCount, Number.MAX_SAFE_INTEGER);
    if (total === null) return 0;
    empire = total;
    const reservesDeploymentTarget = !fleet.returning && fleet.mission === "deploy"
      && sameCoordinates(planet.coordinates, fleet.target);
    if (fleet.originId === planet.id || reservesDeploymentTarget) {
      local = addCount(local, fleetCount, MAX_PLANET_UNITS);
      if (local === null) return 0;
    }
  }
  return Math.min(MAX_PLANET_UNITS - local, Number.MAX_SAFE_INTEGER - empire);
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
  let most = Math.min(SHIPYARD.maxBatch, capLimit(activePlanet(state), def), shipOutputCapacity(state, id));
  for (const res of RESOURCE_IDS) {
    const price = def.cost[res];
    if (price > 0) most = Math.min(most, Math.floor(activePlanet(state).resources[res].toNumber() / price + 1e-9));
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
  if (activePlanet(state).buildings.shipyard < 1) return fail("需要造船厂 等级 1");
  const missing = unitMissing(state, id);
  if (missing.length > 0) return fail(`需要 ${missing.join("、")}`);
  if (!Number.isSafeInteger(n) || !(n >= 1)) return fail("数量至少 1 且必须在安全整数范围内");
  if (n > SHIPYARD.maxBatch) return fail(`单批最多 ${SHIPYARD.maxBatch.toLocaleString("zh-CN")}`);
  const queue = activePlanet(state).shipyardQueue;
  if (queue.length >= SHIPYARD.maxOrders) return fail(`造船队列已满（${queue.length}/${SHIPYARD.maxOrders}）`);
  const limit = capLimit(activePlanet(state), def);
  if (def.maxCount !== undefined && limit < n) return fail(`${def.nameZh}每颗星球最多 ${def.maxCount} 个`);
  if (def.siloSlots && limit < n) {
    const free = Math.max(0, siloCapacity(activePlanet(state)) - siloUsed(activePlanet(state)));
    return fail(activePlanet(state).buildings.missile_silo < 1 ? "需要导弹井" : `导弹井空位不足（剩 ${free} 格，每枚占 ${def.siloSlots} 格）`);
  }
  if (n > shipOutputCapacity(state, id)) return fail("舰船数量超过星球或帝国安全上限（含已付费排队与在途舰船）");
  const lack = shortfall(state, cost);
  if (lack) return fail(lack, { onlyResources: true });
  return { ok: true, reason: "", count: n, cost };
}

/** Charge the batch and append it to the shipyard queue. */
export function enqueueUnits(state: GameState, id: UnitId, count: number, source: OrderSource, taskId: number | null = null): ShipyardResult {
  const check = canBuildUnits(state, id, count);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const paidPerUnit = unitCost(unitById(id));
  const exactCost = exactUnitCost(paidPerUnit, check.count);
  if (source === "plan" && exactCost === null) return { state, ok: false, reason: "计划批次金额无法精确表示" };
  const cost = source === "plan" && exactCost ? moneyToCost(exactCost) : check.cost;
  const payment = preparePaidJob(state, {
    kind: "shipyard", planetId: state.activePlanetId, unit: id,
    quantity: check.count, source, taskId,
  }, cost, source === "plan" ? exactCost! : undefined);
  if (!payment.ok) return { state: payment.state, ok: false, reason: payment.reason };
  const planet: PlanetState = {
    ...activePlanet(payment.state),
    shipyardQueue: [...activePlanet(payment.state).shipyardQueue, {
      jobId: payment.jobId, taskId, unit: id, count: check.count,
      orderedCount: check.count, paidPerUnit, progress: 0, source,
    }],
  };
  const stats = source === "manual" ? { ...state.stats, manualActions: state.stats.manualActions + 1 } : state.stats;
  return {
    state: { ...withPlanet(payment.state, { planet }), stats },
    ok: true,
    jobId: payment.jobId,
    reason: `${unitById(id).nameZh} ×${check.count.toLocaleString("zh-CN")} 已入队`,
  };
}

export type UnitAmount = number | "max" | { fillTo: number };

/** Resolve "max" / fill-to into a count (0 when nothing is needed or affordable). */
export function resolveUnitAmount(state: GameState, id: UnitId, amount: UnitAmount): number {
  if (amount === "max") return maxBuildable(state, id);
  if (typeof amount === "number") return Math.floor(amount);
  return Math.max(0, Math.floor(amount.fillTo) - unitTotal(activePlanet(state), id));
}

/** Order units by count, "max" or fill-to-N (owned + queued count toward N). */
export function orderUnits(state: GameState, id: UnitId, amount: UnitAmount, source: OrderSource, taskId: number | null = null): ShipyardResult {
  const count = resolveUnitAmount(state, id, amount);
  const def = unitById(id);
  if (count < 1) {
    if (amount === "max") {
      const check = canBuildUnits(state, id, 1);
      return { state, ok: false, reason: check.ok ? "一个也造不起" : check.reason };
    }
    if (typeof amount === "object") {
      return { state, ok: false, reason: `${def.nameZh}已有 ${unitTotal(activePlanet(state), id).toLocaleString("zh-CN")}（含排队），不少于 ${amount.fillTo.toLocaleString("zh-CN")}` };
    }
  }
  return enqueueUnits(state, id, count, source, taskId);
}

/** Cancel a batch: every unit not finished yet is refunded in full (the one in progress too). */
export function cancelUnits(state: GameState, index: number): ShipyardResult {
  const order = activePlanet(state).shipyardQueue[index];
  if (!Number.isInteger(index) || !order) return { state, ok: false, reason: "造船队列中没有这一项" };
  let candidate = state;
  const ref = { kind: "shipyard" as const, planetId: state.activePlanetId, jobId: order.jobId, taskId: order.taskId };
  if (order.source === "plan") {
    const exact = exactUnitCost(order.paidPerUnit, order.count);
    if (exact === null) return { state, ok: false, reason: "计划退款金额无法精确表示" };
    const result = refundPaidJob(state, ref, exact);
    if (!result.ok) return { state, ok: false, reason: result.reason };
    candidate = result.state;
  } else {
    const resources = { ...activePlanet(state).resources };
    for (const res of RESOURCE_IDS) resources[res] = resources[res].add(order.paidPerUnit[res].mul(order.count));
    candidate = withPlanet(state, { resources });
  }
  candidate = cancelledPaidJob(candidate, ref);
  const shipyardQueue = activePlanet(candidate).shipyardQueue.filter((_, i) => i !== index);
  return {
    state: withPlanet(candidate, { planet: { ...activePlanet(candidate), shipyardQueue } }),
    ok: true,
    reason: `已取消 ${unitById(order.unit).nameZh} ×${order.count.toLocaleString("zh-CN")}，资源已全额退还`,
  };
}

/** Exact batch economics; unlike floating multiplication these quotes telescope on refund. */
export function exactUnitCost(paidPerUnit: ResourceCost, count: number): OrderMoney | null {
  const result: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
  for (const res of RESOURCE_IDS) {
    const amount = multiplyOrderAmountInteger(paidPerUnit[res].toString(), count);
    if (amount === null) return null;
    result[res] = amount;
  }
  return result;
}

function moneyToCost(money: OrderMoney): ResourceCost {
  return { metal: big(money.metal), crystal: big(money.crystal), deuterium: big(money.deuterium) };
}

/** Seconds left on the head batch (null when idle or paused). */
export function shipyardRemaining(state: GameState): number | null {
  const head = activePlanet(state).shipyardQueue[0];
  if (!head || shipyardPausedReason(state)) return null;
  return (head.count - head.progress) * unitSeconds(state, head.unit);
}

/** Whole queue time at the current levels (ignores pauses). */
export function shipyardQueueSeconds(state: GameState): number {
  return activePlanet(state).shipyardQueue.reduce((sum, order) => sum + (order.count - order.progress) * unitSeconds(state, order.unit), 0);
}

/**
 * Seconds until the next shipyard event for tick(): the end of the head batch, or, while solar satellites are
 * built, the next satellite (energy changes with each one; at least 1 s apart so tiny unit times do not explode
 * the number of segments).
 */
export function nextShipyardEvent(state: GameState, fleetCensus?: ShipyardFleetCensus): number {
  const head = activePlanet(state).shipyardQueue[0];
  if (!head || shipyardPausedReason(state, fleetCensus)) return Number.POSITIVE_INFINITY;
  const per = unitSeconds(state, head.unit);
  const safeCount = Math.min(head.count, shipOutputCapacity(state, head.unit, false, fleetCensus));
  const batch = (safeCount - head.progress) * per;
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
  fleetCensus?: ShipyardFleetCensus,
): { state: GameState; completed: CompletedUnits[] } {
  const completed: CompletedUnits[] = [];
  if (!(seconds > 0) || activePlanet(state).shipyardQueue.length === 0 || shipyardPausedReason(state, fleetCensus)) return { state, completed };
  let current = state;
  let left = seconds;
  while (left > EPS && activePlanet(current).shipyardQueue.length > 0) {
    const queue = activePlanet(current).shipyardQueue.map(o => ({ ...o }));
    const units = { ...activePlanet(current).units };
    const head = queue[0]!;
    const capacity = shipOutputCapacity(current, head.unit, false, fleetCensus);
    if (capacity < 1) break;
    const per = unitSeconds(current, head.unit);
    const batch = (head.count - head.progress) * per;
    const finishes = left + EPS * Math.max(1, per) >= batch;
    const built = head.progress + left / per;
    const requested = finishes ? head.count : Math.min(Math.floor(built + 1e-9), head.count - 1);
    const whole = Math.min(requested, capacity);
    const blocked = whole < requested || (whole === capacity && whole < head.count);
    if (whole > 0) {
      // Credit while the original real job and its old count are still present.
      const cumulative = head.orderedCount - head.count + whole;
      current = creditPaidJob(current, { kind: "shipyard", planetId: current.activePlanetId, jobId: head.jobId, taskId: head.taskId }, cumulative, whole === head.count);
      units[head.unit] += whole;
      completed.push({ unit: head.unit, count: whole });
    }
    head.count -= whole;
    if (head.count === 0) {
      queue.shift();
      left -= batch;
    } else {
      // Lost capacity suspends paid work; no overflowing inventory and no zero-time event.
      head.progress = blocked ? 0 : Math.max(0, Math.min(1 - 1e-12, built - whole));
      left = 0;
    }
    current = withPlanet(current, { planet: { ...activePlanet(current), units, shipyardQueue: queue } });
    if (!carry || blocked) break;
  }
  const merged = mergeCompleted(completed);
  const stats = { ...current.stats, unitsBuilt: current.stats.unitsBuilt + merged.reduce((s, u) => s + u.count, 0) };
  return { state: { ...current, stats }, completed: merged };
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
  return { units: { ...planet.units }, shipyardQueue: planet.shipyardQueue.map((o) => ({ ...o, paidPerUnit: { ...o.paidPerUnit } })) };
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
  const queued = queuedUnits(activePlanet(state), "solar_satellite") * satelliteEnergy(activePlanet(state)) * outputScale(state);
  return Math.max(0, eco.demand - eco.supply - queued);
}

export function unitLabel(id: UnitId, count: number): string {
  return `${unitById(id).nameZh} ×${formatAmount(big(count))}`;
}

export function isOrderSource(value: unknown): value is OrderSource {
  return value === "manual" || value === "protocol" || value === "plan";
}

export { emptyUnits, isUnitId, resourceName };
