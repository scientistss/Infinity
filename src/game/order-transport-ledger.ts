/** Pure receipt authority. Never dispatches, pays, credits wallets, or removes a fleet. */
import { SHIP_IDS } from "../data/units";
import { big, isValidAmount } from "./decimal";
import type { Fleet } from "./fleet";
import { sameCoordinates, SPACE, validCoordinates } from "./galaxy";
import { addOrderAmounts, compareOrderAmounts, isOrderAmount, subtractOrderAmounts } from "./order-money";
import { MAX_ORDER_REASON_LENGTH, MAX_ORDER_TRIPS, MAX_ORDER_TRIP_RECEIPTS, type OrderMoney, type OrderTask, type OrderTripPhase, type OrderTripReceipt } from "./order-state";
import { RESOURCE_IDS, type GameState } from "./types";

const zero = (): OrderMoney => ({ metal: "0", crystal: "0", deuterium: "0" });
const validId = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
function validMoney(value: OrderMoney): boolean { return !!value && Object.keys(value).length === 3 && RESOURCE_IDS.every(id => isOrderAmount(value[id])); }
export function reservedOrderMoney(task: OrderTask): OrderMoney | null {
  const work = task.currentWork;
  return work?.stage === "pending" ? validMoney(work.reserved) ? { ...work.reserved } : null : zero();
}
export function grossShippedMoney(task: OrderTask): OrderMoney | null {
  const result = zero();
  for (const trip of task.transport?.trips ?? []) {
    if (!validMoney(trip.cargo)) return null;
    for (const id of RESOURCE_IDS) {
      const amount = addOrderAmounts(result[id], trip.cargo[id]);
      if (amount === null) return null;
      result[id] = amount;
    }
  }
  return result;
}
export function irreversibleFuelMoney(task: OrderTask): OrderMoney | null {
  const result = zero();
  for (const trip of task.transport?.trips ?? []) {
    const amount = addOrderAmounts(result.deuterium, trip.fuel);
    if (amount === null) return null;
    result.deuterium = amount;
  }
  return result;
}
export function findOwnedTrip(task: OrderTask, fleetId: number): OrderTripReceipt | null {
  const matches = task.transport?.trips.filter(trip => trip.fleetId === fleetId) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}
export type OwnedFleetContext =
  | { kind: "unowned"; fleet: Fleet | null }
  | { kind: "invalid"; fleet: Fleet | null; reason: string }
  | { kind: "owned"; fleet: Fleet; task: OrderTask; trip: OrderTripReceipt };
export type ValidOwnedFleetContext = Extract<OwnedFleetContext, { kind: "owned" }>;
export const ORDER_FLEET_IDENTITY_REASON = "计划运输身份不一致，已暂停；舰船与货物保持原状";

function phaseOutcomeValid(phase: OrderTripPhase): boolean {
  if (phase.kind === "outbound") return true;
  const outcome = phase.outcome;
  return (phase.kind === "prestige-retired" && outcome === null) || !!outcome && (outcome.kind === "delivered" || outcome.kind === "not-delivered" && ["manual-recall", "plan-cancel", "goal-satisfied", "target-invalid", "precision-rejected"].includes(outcome.reason));
}
function economicBounds(task: OrderTask): boolean {
  if (!task.transport || !validMoney(task.budget) || !validMoney(task.charged) || !validMoney(task.refunded) || !validMoney(task.transport.authorization.grossCargoCap)) return false;
  const reserved = reservedOrderMoney(task), gross = grossShippedMoney(task), fuel = irreversibleFuelMoney(task);
  if (!reserved || !gross || !fuel) return false;
  for (const id of RESOURCE_IDS) {
    const net = subtractOrderAmounts(task.charged[id], task.refunded[id]);
    const occupied = net === null ? null : addOrderAmounts(net, reserved[id]);
    if (net === null || occupied === null || compareOrderAmounts(occupied, task.budget[id]) === 1 || compareOrderAmounts(net, fuel[id]) === -1 || compareOrderAmounts(gross[id], task.transport.authorization.grossCargoCap[id]) === 1) return false;
  }
  return true;
}
/** Validate identity and immutable history against the canonical real fleet, never messages. */
export function validateOwnedFleetContext(state: GameState, fleetId: number): OwnedFleetContext {
  const fleets = state.fleets.filter(value => value.id === fleetId), fleet = fleets[0] ?? null;
  const references = state.orders.tasks.flatMap(task => (task.transport?.trips ?? []).filter(trip => trip.fleetId === fleetId).map(trip => ({ task, trip })));
  const invalid = (): OwnedFleetContext => ({ kind: "invalid", fleet, reason: ORDER_FLEET_IDENTITY_REASON });
  if (!fleet?.orderTransport) return references.length ? invalid() : { kind: "unowned", fleet };
  if (fleets.length !== 1 || references.length !== 1) return invalid();
  const { task, trip } = references[0]!;
  const owner = fleet.orderTransport, auth = task.transport?.authorization;
  if (!auth || !validId(fleetId) || fleetId >= state.nextFleetId || !validId(owner.taskId) || task.id !== owner.taskId || state.orders.tasks.filter(value => value.id === task.id).length !== 1 || !validId(owner.workId) || owner.workId !== trip.workId || owner.workId >= state.orders.nextWorkId || task.id >= state.orders.nextTaskId) return invalid();
  if (!SHIP_IDS.includes(auth.ship) || auth.ship === ("solar_satellite" as string) || !Number.isSafeInteger(auth.count) || auth.count < 1 || auth.count > SPACE.maxShips || !Number.isInteger(auth.speedPercent) || auth.speedPercent < 10 || auth.speedPercent > 100 || auth.speedPercent % 10 || !Number.isInteger(auth.maxTrips) || auth.maxTrips < 1 || auth.maxTrips > MAX_ORDER_TRIPS) return invalid();
  if (task.transport!.trips.length > auth.maxTrips || state.orders.tasks.reduce((sum, value) => sum + (value.transport?.trips.length ?? 0), 0) > MAX_ORDER_TRIP_RECEIPTS || !economicBounds(task)) return invalid();
  if (state.orders.tasks.some(value => value.id !== task.id && (value.currentWork?.workId === owner.workId || value.transport?.trips.some(receipt => receipt.workId === owner.workId)))) return invalid();
  if (task.transport!.trips.filter(receipt => receipt.workId === trip.workId).length !== 1 || task.transport!.trips.filter(receipt => receipt.phase.kind === "outbound" || receipt.phase.kind === "returning").length !== 1) return invalid();
  if (fleet.mission !== "transport" || fleet.charge !== undefined || fleet.originId !== auth.donorPlanetId || auth.donorPlanetId === task.planetId || !state.planets.some(value => value.id === auth.donorPlanetId) || trip.targetPlanetId !== task.planetId || !validCoordinates(trip.target) || !sameCoordinates(fleet.target, trip.target)) return invalid();
  if (Object.keys(fleet.ships).length !== 1 || fleet.ships[auth.ship] !== auth.count) return invalid();
  if (!Number.isFinite(trip.duration) || trip.duration < SPACE.minFlightSeconds || trip.duration > 1e12 || fleet.duration !== trip.duration || !Number.isFinite(fleet.remaining) || !Number.isFinite(fleet.elapsed) || fleet.remaining < 0 || fleet.elapsed < 0 || fleet.remaining + fleet.elapsed > fleet.duration + 1e-6 || !isOrderAmount(trip.fuel) || !big(trip.fuel).gt(0) || compareOrderAmounts(big(trip.fuel).toString(), trip.fuel) !== 0 || !validMoney(trip.cargo) || !phaseOutcomeValid(trip.phase)) return invalid();
  if (trip.phase.kind !== "outbound" && trip.phase.kind !== "returning") return invalid();
  if ((trip.phase.kind === "returning") !== fleet.returning || trip.phase.kind === "returning" && (typeof trip.phase.dockBlocked !== "boolean" || trip.phase.dockBlocked && fleet.remaining !== 0)) return invalid();
  if (trip.phase.kind === "outbound") {
    if (task.status !== "running" && task.status !== "paused" || Math.abs(fleet.remaining + fleet.elapsed - fleet.duration) > 1e-6 || !task.currentWork || task.currentWork.stage !== "pending" || task.currentWork.workId !== trip.workId || task.currentWork.shipmentFleetId !== fleetId || task.activeJob !== null) return invalid();
  }
  if (task.currentWork?.workId === trip.workId && task.currentWork.shipmentFleetId !== fleetId) return invalid();
  const delivered = trip.phase.kind === "returning" && trip.phase.outcome.kind === "delivered";
  for (const id of RESOURCE_IDS) {
    if (!fleet.cargo[id] || !isValidAmount(fleet.cargo[id]) || compareOrderAmounts(big(trip.cargo[id]).toString(), trip.cargo[id]) !== 0 || compareOrderAmounts(fleet.cargo[id].toString(), delivered ? "0" : trip.cargo[id]) !== 0) return invalid();
  }
  return { kind: "owned", task, trip, fleet };
}
export function isOwnedDockBlocked(state: GameState, fleetId: number): boolean {
  const context = validateOwnedFleetContext(state, fleetId);
  return context.kind === "owned" && context.trip.phase.kind === "returning" && context.trip.phase.dockBlocked;
}
/** A receipt explicitly authorizes payment; returning/empty cargo alone never does. */
export function canPayCurrentWork(state: GameState, task: OrderTask): boolean {
  if (!task.transport) return task.currentWork === null;
  const work = task.currentWork;
  if (!work || work.stage !== "pending") return false;
  const ownTrips = task.transport.trips.filter(trip => trip.workId === work.workId);
  if (work.shipmentFleetId === null) return ownTrips.length === 0;
  if (ownTrips.length !== 1 || ownTrips[0]!.fleetId !== work.shipmentFleetId) return false;
  const trip = ownTrips[0]!;
  if (trip.phase.kind === "returned") return !state.fleets.some(fleet => fleet.id === trip.fleetId);
  if (trip.phase.kind !== "returning" || trip.phase.outcome.kind !== "delivered") return false;
  return validateOwnedFleetContext(state, trip.fleetId).kind === "owned";
}
function replaceTask(state: GameState, task: OrderTask): GameState {
  const tasks = state.orders.tasks.map(value => value.id === task.id ? task : value);
  return { ...state, orders: { ...state.orders, tasks, accumulator: tasks.some(value => value.status === "running") ? state.orders.accumulator : 0 } };
}
export function pauseOwnedFleetOwner(state: GameState, fleetId: number, reason: string): GameState {
  const owners = state.orders.tasks.filter(value => value.transport?.trips.some(trip => trip.fleetId === fleetId));
  const task = owners.length === 1 ? owners[0] : undefined;
  return task?.status === "running" ? replaceTask(state, { ...task, status: "paused", reason: reason.slice(0, MAX_ORDER_REASON_LENGTH) }) : state;
}
/** Returns only an immutable receipt/status patch. Caller commits it with the real economic event. */
export function recordOwnedTripPhase(state: GameState, context: ValidOwnedFleetContext, phase: OrderTripPhase, options: { pauseReason?: string; cancelMissingTarget?: boolean } = {}): GameState | null {
  const canonical = validateOwnedFleetContext(state, context.fleet.id);
  if (canonical.kind !== "owned" || canonical.fleet !== context.fleet || canonical.task !== context.task || canonical.trip !== context.trip) return null;
  const before = context.trip.phase;
  if (!phaseOutcomeValid(phase)) return null;
  if (before.kind === "outbound") {
    if (phase.kind !== "returning" || phase.dockBlocked) return null;
    const arrival = phase.outcome.kind === "delivered" || phase.outcome.reason === "target-invalid" || phase.outcome.reason === "precision-rejected";
    if (arrival && context.fleet.remaining > 1e-9) return null;
  } else if (before.kind === "returning") {
    if (phase.kind !== "returned" && phase.kind !== "returning" || JSON.stringify(before.outcome) !== JSON.stringify(phase.outcome) || context.fleet.remaining > 1e-9 || phase.kind === "returning" && !phase.dockBlocked) return null;
  } else return null;
  let task: OrderTask = { ...context.task, transport: { ...context.task.transport!, trips: context.task.transport!.trips.map(trip => trip.fleetId === context.fleet.id ? { ...trip, phase } : trip) } };
  if (options.cancelMissingTarget) {
    if (state.planets.some(planet => planet.id === task.planetId) || task.activeJob !== null || phase.kind !== "returning" || phase.outcome.kind !== "not-delivered" || phase.outcome.reason !== "target-invalid") return null;
    task = { ...task, status: "cancelled", currentWork: null, reason: "执行星球已不存在，计划已取消；原货正在返航" };
  } else if (options.pauseReason && (task.status === "running" || task.status === "paused")) {
    task = { ...task, status: "paused", reason: options.pauseReason.slice(0, MAX_ORDER_REASON_LENGTH) };
  }
  return replaceTask(state, task);
}
/** Call only inside the real prestige transaction which removes the old world and fleets. */
export function retireOwnedTripsForPrestige(state: GameState): GameState {
  let changed = false;
  const tasks = state.orders.tasks.map(task => {
    if (!task.transport) return task;
    const trips = task.transport.trips.map(trip => {
      if (trip.phase.kind !== "outbound" && trip.phase.kind !== "returning") return trip;
      changed = true;
      return { ...trip, phase: { kind: "prestige-retired" as const, outcome: trip.phase.kind === "outbound" ? null : trip.phase.outcome } };
    });
    return { ...task, transport: { ...task.transport, trips } };
  });
  return changed ? { ...state, orders: { ...state.orders, tasks } } : state;
}
