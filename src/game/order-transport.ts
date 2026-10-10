/** Single-source coordinator. Only real queue/fleet primitives may move resources. */
import { SHIP_IDS, unitById } from "../data/units";
import { big } from "./decimal";
import { selectPlanet } from "./empire";
import { quoteFlight, recallFleet, sendFleet, type FleetRequest } from "./fleet";
import { SPACE, sameCoordinates } from "./galaxy";
import {
  committedOrderMoney, isOrderMoney, ORDER_BUDGET_REASON, ORDER_EXHAUSTED_REASON,
  ORDER_IDENTITY_REASON, ORDER_PRECISION_REASON, quoteOrderMoney, remainingOrderWorkMoney, validOwnedPaidJob, zeroOrderMoney,
} from "./order-ledger";
import { addOrderAmounts, compareOrderAmounts, multiplyOrderAmountInteger, normalizeOrderAmount, subtractOrderAmounts } from "./order-money";
import {
  MAX_ORDER_REASON_LENGTH, MAX_ORDER_SPEED_PERCENT, MAX_ORDER_TRIP_RECEIPTS,
  MAX_ORDER_TRIPS, MIN_ORDER_SPEED_PERCENT, ORDER_SPEED_STEP,
  type OrderMoney, type OrderResult, type OrderTask, type OrderTransportAuthorization, type OrderWorkSpec,
} from "./order-state";
import { canPayCurrentWork, grossShippedMoney, validateOwnedFleetContext } from "./order-transport-ledger";
import { checkedWalletTransfer } from "./order-wallet";
import { canEnqueue, cancel, enqueue } from "./queue";
import { canEnqueueResearch, cancelResearch, enqueueResearch } from "./research";
import { canBuildUnits, cancelUnits, enqueueUnits, SHIPYARD, unitCost } from "./shipyard";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";

const validId = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const sameMoney = (a: OrderMoney, b: OrderMoney): boolean => RESOURCE_IDS.every(id => compareOrderAmounts(a[id], b[id]) === 0);
const hasCargo = (money: OrderMoney): boolean => RESOURCE_IDS.some(id => compareOrderAmounts(money[id], "0") === 1);
function patchTask(state: GameState, taskId: number, patch: Partial<OrderTask>): GameState {
  const tasks = state.orders.tasks.map(task => task.id === taskId ? { ...task, ...patch, ...(patch.reason === undefined ? {} : { reason: patch.reason.slice(0, MAX_ORDER_REASON_LENGTH) }) } as OrderTask : task);
  return { ...state, orders: { ...state.orders, tasks, accumulator: tasks.some(task => task.status === "running") ? state.orders.accumulator : 0 } };
}
function wait(state: GameState, taskId: number, reason: string, pause = false): GameState {
  return patchTask(state, taskId, { reason, ...(pause ? { status: "paused" } : {}) });
}
function moneyToResources(money: OrderMoney): ResourceAmounts {
  return { metal: big(money.metal), crystal: big(money.crystal), deuterium: big(money.deuterium) };
}
function roundTrips(money: OrderMoney): boolean {
  return RESOURCE_IDS.every(id => compareOrderAmounts(big(money[id]).toString(), money[id]) === 0);
}
export function validOrderTransportAuthorization(state: GameState, planetId: string, value: unknown): value is OrderTransportAuthorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const auth = value as OrderTransportAuthorization;
  const keys = ["donorPlanetId", "ship", "count", "speedPercent", "maxTrips", "grossCargoCap"];
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
    && typeof auth.donorPlanetId === "string" && auth.donorPlanetId !== planetId
    && state.planets.some(planet => planet.id === auth.donorPlanetId)
    && (SHIP_IDS as readonly string[]).includes(auth.ship) && (auth.ship as string) !== "solar_satellite"
    && Number.isSafeInteger(auth.count) && auth.count > 0 && auth.count <= SPACE.maxShips
    && Number.isInteger(auth.speedPercent) && auth.speedPercent >= MIN_ORDER_SPEED_PERCENT && auth.speedPercent <= MAX_ORDER_SPEED_PERCENT && auth.speedPercent % ORDER_SPEED_STEP === 0
    && Number.isInteger(auth.maxTrips) && auth.maxTrips > 0 && auth.maxTrips <= MAX_ORDER_TRIPS
    && isOrderMoney(auth.grossCargoCap);
}
export function copyOrderTransportAuthorization(auth: OrderTransportAuthorization): OrderTransportAuthorization {
  return { ...auth, grossCargoCap: { metal: normalizeOrderAmount(auth.grossCargoCap.metal)!, crystal: normalizeOrderAmount(auth.grossCargoCap.crystal)!, deuterium: normalizeOrderAmount(auth.grossCargoCap.deuterium)! } };
}
function withinBudget(task: OrderTask, price: OrderMoney, fuel = "0"): boolean {
  const net = committedOrderMoney(task);
  return !!net && RESOURCE_IDS.every(id => {
    const reserved = addOrderAmounts(price[id], id === "deuterium" ? fuel : "0");
    const total = reserved === null ? null : addOrderAmounts(net[id], reserved);
    return total !== null && compareOrderAmounts(total, task.budget[id]) !== 1;
  });
}
function remainingQuantity(task: OrderTask): number {
  const spec = task.currentWork?.spec;
  return spec?.kind === "shipyard" ? spec.quantity - (task.completedUnits - spec.completedUnitsAtStart) : 1;
}
function exactUnitPrice(task: OrderTask & { kind: "shipyard" }, quantity: number): { price: OrderMoney; perUnit: OrderMoney } | null {
  const perUnit = quoteOrderMoney(unitCost(unitById(task.unit)));
  if (!perUnit) return null;
  const price = zeroOrderMoney();
  for (const id of RESOURCE_IDS) {
    const value = multiplyOrderAmountInteger(perUnit[id], quantity);
    if (value === null) return null;
    price[id] = value;
  }
  return roundTrips(price) ? { price, perUnit } : null;
}
function shortfall(state: GameState, task: OrderTask, price: OrderMoney): OrderMoney | null {
  const planet = state.planets.find(value => value.id === task.planetId);
  if (!planet) return null;
  const cargo = zeroOrderMoney();
  for (const id of RESOURCE_IDS) {
    if (compareOrderAmounts(price[id], "0") === 0 || planet.resources[id].gte(big(price[id]))) continue;
    const wallet = normalizeOrderAmount(planet.resources[id].toString());
    if (wallet === null) return null;
    if (compareOrderAmounts(price[id], wallet) === 1) {
      const value = subtractOrderAmounts(price[id], wallet);
      if (value === null) return null;
      cargo[id] = value;
    }
  }
  return roundTrips(cargo) ? cargo : null;
}
interface DispatchQuote { request: FleetRequest; cargo: OrderMoney; fuel: string; duration: number; }
type QuoteResult = { ok: true; quote: DispatchQuote } | { ok: false; reason: string; pause?: boolean };
/** Full gap only; separate exact cargo/fuel and individual wallet movements. Never merge wallets. */
function quoteDispatch(state: GameState, task: OrderTask, price: OrderMoney): QuoteResult {
  const transport = task.transport;
  if (!transport || !validOrderTransportAuthorization(state, task.planetId, transport.authorization)) return { ok: false, reason: ORDER_IDENTITY_REASON, pause: true };
  if (transport.trips.length >= transport.authorization.maxTrips) return { ok: false, reason: "已用尽授权运输次数，等待本地资源" };
  if (state.orders.tasks.reduce((count, value) => count + (value.transport?.trips.length ?? 0), 0) >= MAX_ORDER_TRIP_RECEIPTS) return { ok: false, reason: "运输回执记录已满，请先移除已结清记录" };
  const payer = state.planets.find(value => value.id === task.planetId);
  const donor = state.planets.find(value => value.id === transport.authorization.donorPlanetId);
  if (!payer || !donor) return { ok: false, reason: ORDER_IDENTITY_REASON, pause: true };
  const cargo = shortfall(state, task, price);
  const gross = grossShippedMoney(task);
  if (!cargo || !gross) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
  if (!hasCargo(cargo)) return { ok: false, reason: "本地资源已足够，无需运输" };
  for (const id of RESOURCE_IDS) {
    const total = addOrderAmounts(gross[id], cargo[id]);
    if (total === null) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
    if (compareOrderAmounts(total, transport.authorization.grossCargoCap[id]) === 1) return { ok: false, reason: "本次完整缺口超过累计货物上限，等待本地资源" };
  }
  const auth = transport.authorization;
  const request: FleetRequest = { mission: "transport", target: { ...payer.coordinates }, ships: { [auth.ship]: auth.count }, cargo: moneyToResources(cargo), speedPercent: auth.speedPercent };
  const flight = quoteFlight(selectPlanet(state, donor.id), request);
  if (!flight.ok) return { ok: false, reason: flight.reason };
  const fuel = normalizeOrderAmount(flight.fuel.toString());
  const capacity = normalizeOrderAmount(flight.capacity.toString());
  if (fuel === null || capacity === null || compareOrderAmounts(big(fuel).toString(), fuel) !== 0) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
  let load: string | null = fuel;
  for (const id of RESOURCE_IDS) load = load === null ? null : addOrderAmounts(load, cargo[id]);
  if (load === null) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
  if (compareOrderAmounts(load, capacity) === 1) return { ok: false, reason: "货舱不足（完整货物与往返燃料共用货舱）" };
  if (!withinBudget(task, price, fuel)) return { ok: false, reason: ORDER_BUDGET_REASON };
  for (const id of RESOURCE_IDS) {
    const afterCargo = checkedWalletTransfer(donor.resources[id], big(cargo[id]), false);
    if (!afterCargo || (id === "deuterium" && checkedWalletTransfer(afterCargo, big(fuel), false) === null)) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
  }
  return { ok: true, quote: { request, cargo, fuel, duration: flight.duration } };
}
export type NextOrderWorkQuote = { ok: true; spec: OrderWorkSpec; reserved: OrderMoney } | { ok: false; reason: string; pause?: boolean };
export function quoteNextOrderWork(state: GameState, task: OrderTask): NextOrderWorkQuote {
  const local = selectPlanet(state, task.planetId), planet = local.planets.find(value => value.id === task.planetId);
  if (!planet || !task.transport) return { ok: false, reason: ORDER_IDENTITY_REASON, pause: true };
  if (task.kind === "building" || task.kind === "research") {
    if (task.kind === "building" ? planet.buildQueue.some(job => job.building === task.building) : state.research.queue.some(job => job.tech === task.tech)) return { ok: false, reason: "已有同目标付费任务，等待实际完成" };
    const check = task.kind === "building" ? canEnqueue(local, task.building) : canEnqueueResearch(local, task.tech);
    if (!check.ok && !check.onlyResources) return { ok: false, reason: check.reason };
    const price = quoteOrderMoney(check.cost);
    if (!price || !roundTrips(price)) return { ok: false, reason: ORDER_PRECISION_REASON, pause: true };
    if (!withinBudget(task, price)) return { ok: false, reason: ORDER_BUDGET_REASON };
    return { ok: true, reserved: price, spec: task.kind === "building"
      ? { kind: "building", building: task.building, targetLevel: check.targetLevel, price }
      : { kind: "research", tech: task.tech, targetLevel: check.targetLevel, price } };
  }
  const one = canBuildUnits(local, task.unit, 1);
  if (!one.ok && !one.onlyResources) return { ok: false, reason: one.reason };
  const localOnly = one.ok;
  let lastReason = one.reason, unsafe = false;
  const candidate = (quantity: number): boolean => {
    const check = canBuildUnits(local, task.unit, quantity);
    if (!check.ok && (localOnly || !check.onlyResources)) { lastReason = check.reason; return false; }
    const exact = exactUnitPrice(task, quantity);
    if (!exact) { lastReason = ORDER_PRECISION_REASON; unsafe = true; return false; }
    if (!withinBudget(task, exact.price)) { lastReason = ORDER_BUDGET_REASON; return false; }
    if (check.ok) return true;
    const shipment = quoteDispatch(state, task, exact.price);
    if (!shipment.ok) { lastReason = shipment.reason; unsafe = !!shipment.pause; return false; }
    return true;
  };
  if (!candidate(1)) return { ok: false, reason: lastReason, pause: unsafe };
  let low = 1, high = Math.min(task.quantity - task.completedUnits, SHIPYARD.maxBatch);
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (candidate(middle)) low = middle; else high = middle - 1;
  }
  const exact = exactUnitPrice(task, low)!;
  return { ok: true, reserved: exact.price, spec: { kind: "shipyard", unit: task.unit, quantity: low, completedUnitsAtStart: task.completedUnits, paidPerUnit: exact.perUnit } };
}
function freezePendingOrderWork(state: GameState, taskId: number, quote: Extract<NextOrderWorkQuote, { ok: true }>): GameState {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!task || !task.transport || task.status !== "running" || task.currentWork || task.activeJob || task.transport.trips.some(trip => trip.phase.kind === "outbound" || trip.phase.kind === "returning")) return state;
  const workId = state.orders.nextWorkId;
  if (!validId(workId)) return wait(state, taskId, ORDER_EXHAUSTED_REASON, true);
  if (state.orders.tasks.some(value => value.currentWork?.workId === workId || value.transport?.trips.some(trip => trip.workId === workId))) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const spec: OrderWorkSpec = quote.spec.kind === "shipyard" ? { ...quote.spec, paidPerUnit: { ...quote.spec.paidPerUnit } } : { ...quote.spec, price: { ...quote.spec.price } };
  const next = patchTask(state, taskId, { currentWork: { workId, spec, shipmentFleetId: null, stage: "pending", reserved: { ...quote.reserved } }, reason: "子任务已固定并预留预算" });
  return { ...next, orders: { ...next.orders, nextWorkId: workId + 1 } };
}
/** Frozen work identity is authoritative even when a public primitive is called directly. */
function validPendingIdentity(state: GameState, task: OrderTask): boolean {
  const work = task.currentWork;
  if (!work || work.stage !== "pending" || !validId(work.workId) || work.workId >= state.orders.nextWorkId || work.spec.kind !== task.kind) return false;
  if (state.orders.tasks.some(other => other.id !== task.id && (other.currentWork?.workId === work.workId || other.transport?.trips.some(trip => trip.workId === work.workId)))) return false;
  const spec = work.spec;
  if (spec.kind === "building" && task.kind === "building") return spec.building === task.building && Number.isSafeInteger(spec.targetLevel) && spec.targetLevel > 0 && spec.targetLevel <= task.targetLevel;
  if (spec.kind === "research" && task.kind === "research") return spec.tech === task.tech && Number.isSafeInteger(spec.targetLevel) && spec.targetLevel > 0 && spec.targetLevel <= task.targetLevel;
  return spec.kind === "shipyard" && task.kind === "shipyard" && spec.unit === task.unit
    && Number.isSafeInteger(spec.quantity) && spec.quantity > 0 && spec.quantity <= task.quantity
    && Number.isSafeInteger(spec.completedUnitsAtStart) && spec.completedUnitsAtStart >= 0 && spec.completedUnitsAtStart <= task.completedUnits
    && spec.completedUnitsAtStart + spec.quantity <= task.quantity && remainingQuantity(task) > 0;
}
export function dispatchPendingOrderTransport(state: GameState, taskId: number): GameState {
  const task = state.orders.tasks.find(value => value.id === taskId), work = task?.currentWork;
  if (!task?.transport || task.status !== "running" || !work || work.stage !== "pending" || task.activeJob) return state;
  if (!validPendingIdentity(state, task)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  if (work.shipmentFleetId !== null || task.transport.trips.some(trip => trip.workId === work.workId || trip.phase.kind === "outbound" || trip.phase.kind === "returning")) return wait(state, taskId, "该子任务已使用唯一一次运输，等待本地资源");
  const price = remainingOrderWorkMoney(task);
  if (!price || !sameMoney(price, work.reserved)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const local = selectPlanet(state, task.planetId), planet = local.planets.find(value => value.id === task.planetId);
  if (!planet) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const spec = work.spec;
  if (spec.kind === "building" ? planet.buildQueue.some(job => job.building === spec.building) : spec.kind === "research" && state.research.queue.some(job => job.tech === spec.tech)) return wait(state, taskId, "已有同目标付费任务，等待实际完成");
  const check = spec.kind === "building" ? canEnqueue(local, spec.building) : spec.kind === "research" ? canEnqueueResearch(local, spec.tech) : canBuildUnits(local, spec.unit, remainingQuantity(task));
  if (!check.ok && !check.onlyResources) return wait(state, taskId, check.reason);
  if (spec.kind !== "shipyard") {
    const actualPrice = quoteOrderMoney(check.cost);
    if (!("targetLevel" in check) || check.targetLevel !== spec.targetLevel || !actualPrice || !sameMoney(actualPrice, price)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  }
  if (spec.kind === "shipyard") {
    const perUnit = quoteOrderMoney(unitCost(unitById(spec.unit)));
    if (!perUnit || !sameMoney(perUnit, spec.paidPerUnit)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  }
  const quote = quoteDispatch(state, task, price);
  if (!quote.ok) return wait(state, taskId, quote.reason, quote.pause);
  const sent = sendFleet(selectPlanet(state, task.transport.authorization.donorPlanetId), quote.quote.request);
  if (!sent.ok) return wait(state, taskId, sent.reason);
  const fleetId = sent.fleetId;
  if (fleetId === undefined || !validId(fleetId) || state.fleets.some(fleet => fleet.id === fleetId)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const fleet = sent.state.fleets.find(value => value.id === fleetId);
  if (!fleet || fleet.orderTransport !== null || fleet.mission !== "transport" || fleet.originId !== task.transport.authorization.donorPlanetId || !sameCoordinates(fleet.target, quote.quote.request.target)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const charged = { ...task.charged }, fuelCharge = addOrderAmounts(charged.deuterium, quote.quote.fuel);
  if (fuelCharge === null) return wait(state, taskId, ORDER_PRECISION_REASON, true);
  charged.deuterium = fuelCharge;
  let next = patchTask(sent.state, taskId, {
    charged, currentWork: { ...work, shipmentFleetId: fleetId },
    transport: { ...task.transport, trips: [...task.transport.trips, { fleetId, workId: work.workId, targetPlanetId: task.planetId, target: { ...fleet.target }, cargo: { ...quote.quote.cargo }, fuel: quote.quote.fuel, duration: quote.quote.duration, phase: { kind: "outbound" } }] },
    reason: "完整缺口已装船，等待真实到货",
  });
  next = { ...next, fleets: next.fleets.map(value => value.id === fleetId ? { ...value, orderTransport: { taskId, workId: work.workId } } : value) };
  if (validateOwnedFleetContext(next, fleetId).kind !== "owned") return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  return selectPlanet(next, state.activePlanetId);
}
function workSatisfied(state: GameState, task: OrderTask): boolean {
  const spec = task.currentWork?.spec;
  const planet = state.planets.find(value => value.id === task.planetId);
  return spec?.kind === "building" ? !!planet && planet.buildings[spec.building] >= spec.targetLevel
    : spec?.kind === "research" ? state.research.levels[spec.tech] >= spec.targetLevel
    : spec?.kind === "shipyard" ? remainingQuantity(task) === 0 : false;
}
function goalSatisfied(state: GameState, task: OrderTask): boolean {
  return task.kind === "building" ? !!state.planets.find(value => value.id === task.planetId && value.buildings[task.building] >= task.targetLevel)
    : task.kind === "research" ? state.research.levels[task.tech] >= task.targetLevel : task.completedUnits >= task.quantity;
}
function retireSatisfiedWork(state: GameState, task: OrderTask): GameState {
  let next = state;
  const outbound = task.transport?.trips.find(trip => trip.phase.kind === "outbound");
  if (outbound) {
    const recall = recallFleet(next, outbound.fleetId, "goal-satisfied");
    if (!recall.ok) return wait(state, task.id, recall.reason, true);
    next = recall.state;
  }
  return patchTask(next, task.id, { currentWork: null, ...(goalSatisfied(next, task) ? { status: "completed" } : {}), reason: goalSatisfied(next, task) ? "有限目标已完成" : "当前子目标已实际完成，等待旧舰返港" });
}
/** Recheck the real primitive and immutable quote, including shipment authority, immediately before paying. */
export function payPendingOrderWork(state: GameState, taskId: number): GameState {
  const task = state.orders.tasks.find(value => value.id === taskId), work = task?.currentWork;
  if (!task?.transport || task.status !== "running" || !work || work.stage !== "pending" || task.activeJob) return state;
  if (!validPendingIdentity(state, task)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  if (!canPayCurrentWork(state, task)) return wait(state, taskId, "等待真实运输裁决及返港；当前不可付款");
  const local = selectPlanet(state, task.planetId), planet = local.planets.find(value => value.id === task.planetId);
  if (!planet) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const spec = work.spec;
  if (spec.kind === "building" ? planet.buildQueue.some(job => job.building === spec.building) : spec.kind === "research" && state.research.queue.some(job => job.tech === spec.tech)) return wait(state, taskId, "已有同目标付费任务，等待实际完成");
  const count = remainingQuantity(task);
  const check = spec.kind === "building" ? canEnqueue(local, spec.building) : spec.kind === "research" ? canEnqueueResearch(local, spec.tech) : canBuildUnits(local, spec.unit, count);
  if (!check.ok) return wait(state, taskId, check.reason);
  if (spec.kind !== "shipyard" && (!("targetLevel" in check) || check.targetLevel !== spec.targetLevel)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const price = spec.kind === "shipyard" ? remainingOrderWorkMoney(task) : quoteOrderMoney(check.cost);
  if (!price || !sameMoney(price, work.reserved)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  const paid = spec.kind === "building" ? enqueue(local, spec.building, "plan", taskId) : spec.kind === "research" ? enqueueResearch(local, spec.tech, "plan", taskId) : enqueueUnits(local, spec.unit, count, "plan", taskId);
  return wait(selectPlanet(paid.state, state.activePlanetId), taskId, paid.reason);
}
export function advanceTransportOrder(state: GameState, taskId: number): GameState {
  let task = state.orders.tasks.find(value => value.id === taskId);
  if (!task?.transport || task.status !== "running") return state;
  if (task.activeJob) {
    if (task.currentWork?.stage !== "paid" || task.currentWork.jobId !== task.activeJob.jobId || !validOwnedPaidJob(state, task)) return wait(state, taskId, ORDER_IDENTITY_REASON, true);
    return state;
  }
  if (task.currentWork?.stage === "paid") return wait(state, taskId, ORDER_IDENTITY_REASON, true);
  if (goalSatisfied(state, task) || task.currentWork && workSatisfied(state, task)) return retireSatisfiedWork(state, task);
  let next = state;
  if (!task.currentWork) {
    if (task.transport.trips.some(trip => trip.phase.kind === "outbound" || trip.phase.kind === "returning")) return wait(state, taskId, "等待上一子任务的真实舰队返港");
    const quote = quoteNextOrderWork(next, task);
    if (!quote.ok) return wait(state, taskId, quote.reason, quote.pause);
    next = freezePendingOrderWork(next, taskId, quote);
    task = next.orders.tasks.find(value => value.id === taskId)!;
  }
  const work = task.currentWork;
  if (!work || work.stage !== "pending" || task.status !== "running") return next;
  const spec = work.spec, local = selectPlanet(next, task.planetId), planet = local.planets.find(value => value.id === task!.planetId);
  if (!planet) return wait(next, taskId, ORDER_IDENTITY_REASON, true);
  if (spec.kind === "building" ? planet.buildQueue.some(job => job.building === spec.building) : spec.kind === "research" && next.research.queue.some(job => job.tech === spec.tech)) return wait(next, taskId, "已有同目标付费任务，等待实际完成");
  const check = spec.kind === "building" ? canEnqueue(local, spec.building) : spec.kind === "research" ? canEnqueueResearch(local, spec.tech) : canBuildUnits(local, spec.unit, remainingQuantity(task));
  if (!check.ok && !check.onlyResources) return wait(next, taskId, check.reason);
  if (spec.kind !== "shipyard" && (!("targetLevel" in check) || check.targetLevel !== spec.targetLevel)) return wait(next, taskId, ORDER_IDENTITY_REASON, true);
  if (check.ok) return payPendingOrderWork(next, taskId);
  if (work.shipmentFleetId !== null) return wait(next, taskId, "该子任务已使用唯一一次运输，等待本地资源");
  return dispatchPendingOrderTransport(next, taskId);
}
/** Cancellation composes refund and recall on a disposable candidate; failures roll everything back. */
export function cancelTransportOrder(state: GameState, taskId: number): OrderResult {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!task?.transport || (task.status !== "running" && task.status !== "paused")) return { state, ok: false, reason: "该计划已经结束或不存在" };
  const fail = (reason: string): OrderResult => ({ state: wait(state, taskId, reason, true), ok: false, reason });
  let next = state;
  for (const trip of task.transport.trips) if ((trip.phase.kind === "outbound" || trip.phase.kind === "returning") && validateOwnedFleetContext(next, trip.fleetId).kind !== "owned") return fail(ORDER_IDENTITY_REASON);
  if (task.activeJob) {
    if (!validOwnedPaidJob(next, task)) return fail(ORDER_IDENTITY_REASON);
    const local = selectPlanet(next, task.planetId), planet = local.planets.find(value => value.id === task.planetId);
    if (!planet) return fail(ORDER_IDENTITY_REASON);
    const jobId = task.activeJob.jobId;
    const result = task.kind === "building" ? cancel(local, planet.buildQueue.findIndex(job => job.jobId === jobId))
      : task.kind === "research" ? cancelResearch(local, local.research.queue.findIndex(job => job.jobId === jobId && job.planetId === task.planetId))
      : cancelUnits(local, planet.shipyardQueue.findIndex(job => job.jobId === jobId));
    if (!result.ok) return fail(result.reason);
    next = selectPlanet(result.state, state.activePlanetId);
  }
  for (const trip of task.transport.trips) if (trip.phase.kind === "outbound") {
    const result = recallFleet(next, trip.fleetId, "plan-cancel");
    if (!result.ok) return fail(result.reason);
    next = result.state;
  }
  return { state: patchTask(next, taskId, { status: "cancelled", activeJob: null, currentWork: null, reason: "计划已取消；未交付货物真实返航，燃料不退，已卸货留在原处" }), ok: true, reason: "计划已取消" };
}
