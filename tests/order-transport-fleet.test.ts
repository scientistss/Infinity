import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { abandonColony, advanceFleets, emptyCargo, nextFleetEvent, quoteFlight, recallFleet, resolveFleetArrivals, retryOwnedFleetDock, sendFleet, type FleetRequest } from "../src/game/fleet";
import { canPayCurrentWork, grossShippedMoney, irreversibleFuelMoney, isOwnedDockBlocked, recordOwnedTripPhase, reservedOrderMoney, retireOwnedTripsForPrestige, validateOwnedFleetContext } from "../src/game/order-transport-ledger";
import type { OrderTask } from "../src/game/order-state";
import { createPlanet } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import { tick } from "../src/game/logic";
import type { GameState } from "../src/game/types";

const zero = () => ({ metal: "0", crystal: "0", deuterium: "0" });
function dispatched(): GameState {
  let state = createInitialState(42);
  state.protocols.slots.forEach(slot => { slot.card = null; });
  const donor = state.planets[0]!, target = createPlanet("transport-payer", { ...donor.coordinates, position: donor.coordinates.position === 15 ? 14 : donor.coordinates.position + 1 });
  donor.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  donor.units.small_cargo = 2;
  state.planets.push(target);
  state.research.levels.combustion_drive = 6;
  const cargo = { metal: "60", crystal: "15", deuterium: "0" };
  const request: FleetRequest = { mission: "transport", target: target.coordinates, ships: { small_cargo: 2 }, cargo: { metal: big(cargo.metal), crystal: big(cargo.crystal), deuterium: big(0) }, speedPercent: 100 };
  const quote = quoteFlight(state, request), sent = sendFleet(state, request);
  expect(sent.ok).toBe(true); expect(sent.fleetId).toBe(1);
  state = sent.state;
  const fleet = state.fleets[0]!;
  const task: OrderTask = {
    id: 1, kind: "building", planetId: target.id, building: "metal_mine", targetLevel: 1,
    status: "running", reason: "", budget: { metal: "10000", crystal: "10000", deuterium: "10000" }, charged: { ...zero(), deuterium: quote.fuel.toString() }, refunded: zero(), activeJob: null, completedUnits: 0,
    currentWork: { workId: 1, stage: "pending", shipmentFleetId: fleet.id, reserved: { ...cargo }, spec: { kind: "building", building: "metal_mine", targetLevel: 1, price: { ...cargo } } },
    transport: { authorization: { donorPlanetId: donor.id, ship: "small_cargo", count: 2, speedPercent: 100, maxTrips: 3, grossCargoCap: { metal: "10000", crystal: "10000", deuterium: "10000" } }, trips: [{ fleetId: fleet.id, workId: 1, targetPlanetId: target.id, target: { ...fleet.target }, cargo: { ...cargo }, fuel: quote.fuel.toString(), duration: fleet.duration, phase: { kind: "outbound" } }] },
  };
  state = { ...state, orders: { ...state.orders, nextTaskId: 2, nextWorkId: 2, tasks: [task] }, fleets: [{ ...fleet, orderTransport: { taskId: 1, workId: 1 } }] };
  expect(validateOwnedFleetContext(state, fleet.id).kind).toBe("owned");
  return state;
}
const task = (state: GameState) => state.orders.tasks[0]!;
const phase = (state: GameState) => task(state).transport!.trips[0]!.phase;
const target = (state: GameState) => state.planets.find(planet => planet.id === "transport-payer")!;
const dueArrival = (state: GameState) => advanceFleets(state, state.fleets[0]!.remaining);

describe("real owned transport lifecycle", () => {
  it("delivers all actual cargo once and records real return separately", () => {
    const before = dispatched(), fuel = irreversibleFuelMoney(task(before));
    expect(canPayCurrentWork(before, task(before))).toBe(false);
    const arrival = dueArrival(before);
    expect(phase(arrival)).toEqual({ kind: "returning", dockBlocked: false, outcome: { kind: "delivered" } });
    expect(target(arrival).resources.metal.eq(60)).toBe(true);
    expect(target(arrival).resources.crystal.eq(15)).toBe(true);
    expect(arrival.fleets[0]!.cargo).toEqual(emptyCargo());
    expect(canPayCurrentWork(arrival, task(arrival))).toBe(true);
    expect(resolveFleetArrivals(arrival)).toBe(arrival);
    const returned = dueArrival(arrival);
    expect(phase(returned)).toEqual({ kind: "returned", outcome: { kind: "delivered" } });
    expect(returned.fleets).toHaveLength(0);
    expect(returned.planets[0]!.units.small_cargo).toBe(2);
    expect(irreversibleFuelMoney(task(returned))).toEqual(fuel);
    expect(task(returned).refunded).toEqual(zero());
    expect(resolveFleetArrivals(returned)).toBe(returned);
    expect(target(before).resources.metal.eq(0)).toBe(true);
  });
  it("recalls the real elapsed leg, pauses, and preserves the one-shipment identity", () => {
    const before = dispatched(), flight = advanceFleets(before, 0.5), recalled = recallFleet(flight, 1).state;
    expect(recalled.fleets[0]!.remaining).toBeCloseTo(0.5, 9);
    expect(phase(recalled)).toEqual({ kind: "returning", dockBlocked: false, outcome: { kind: "not-delivered", reason: "manual-recall" } });
    expect(task(recalled).status).toBe("paused");
    expect(task(recalled).currentWork).toEqual(task(before).currentWork);
    expect(canPayCurrentWork(recalled, task(recalled))).toBe(false);
    const returned = dueArrival(recalled);
    expect(returned.planets[0]!.resources.metal.eq(1e6)).toBe(true);
    expect(canPayCurrentWork(returned, task(returned))).toBe(true);
    expect(grossShippedMoney(task(returned))).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
    expect(task(returned).charged).toEqual(task(before).charged);
    expect(target(returned).resources.metal.eq(0)).toBe(true);
    expect(recallFleet(returned, 1).state).toBe(returned);
  });
  it("settles a zero-time recall only once", () => {
    const before = dispatched(), recalled = recallFleet(before, 1).state;
    expect(recalled.fleets).toHaveLength(0);
    expect(phase(recalled)).toEqual({ kind: "returned", outcome: { kind: "not-delivered", reason: "manual-recall" } });
    expect(recalled.planets[0]!.units.small_cargo).toBe(2);
    expect(recallFleet(recalled, 1).state).toBe(recalled);
  });
  it.each(["plan-cancel", "goal-satisfied"] as const)("records %s distinctly from a manual recall", reason => {
    const state = recallFleet(advanceFleets(dispatched(), 0.5), 1, reason).state;
    expect(phase(state)).toEqual({ kind: "returning", dockBlocked: false, outcome: { kind: "not-delivered", reason } });
    expect(task(state).status).toBe("running");
  });
  it("rejects a swallowed resource credit atomically and returns the full manifest", () => {
    const before = dispatched(); target(before).resources.crystal = big("1e100");
    const arrival = dueArrival(before);
    expect(target(arrival).resources.metal.eq(0)).toBe(true);
    expect(target(arrival).resources.crystal.eq("1e100")).toBe(true);
    expect(arrival.fleets[0]!.cargo.metal.eq(60)).toBe(true);
    expect(arrival.fleets[0]!.cargo.crystal.eq(15)).toBe(true);
    expect(phase(arrival)).toEqual({ kind: "returning", dockBlocked: false, outcome: { kind: "not-delivered", reason: "precision-rejected" } });
    expect(task(arrival).status).toBe("paused");
  });
  it("never unloads to a replacement planet at the original coordinates", () => {
    const before = dispatched(), replacement = { ...target(before), id: "replacement" };
    before.planets = [before.planets[0]!, replacement];
    const arrival = dueArrival(before);
    expect(arrival.planets[1]!.resources.metal.eq(0)).toBe(true);
    expect(arrival.fleets[0]!.cargo.metal.eq(60)).toBe(true);
    expect(phase(arrival)).toEqual({ kind: "returning", dockBlocked: false, outcome: { kind: "not-delivered", reason: "target-invalid" } });
    expect(task(arrival).status).toBe("cancelled");
    expect(task(arrival).currentWork).toBeNull();
    expect(dueArrival(arrival).fleets).toHaveLength(0);
  });
  it("pauses a displaced but still existing payer and returns cargo intact", () => {
    const before = dispatched(); target(before).coordinates = { galaxy: 2, system: 1, position: 8 };
    const arrival = dueArrival(before);
    expect(task(arrival).status).toBe("paused");
    expect(task(arrival).currentWork).not.toBeNull();
    expect(arrival.fleets[0]!.cargo.metal.eq(60)).toBe(true);
    expect(target(arrival).resources.metal.eq(0)).toBe(true);
  });
});

describe("owned dock quarantine and receipt authority", () => {
  it("keeps a blocked returning fleet unchanged across automatic time and retries", () => {
    let state = advanceFleets(dispatched(), 0.5);
    state = recallFleet(state, 1).state;
    state.planets[0]!.resources.metal = big("1e100");
    state = dueArrival(state);
    expect(isOwnedDockBlocked(state, 1)).toBe(true);
    expect(nextFleetEvent(state)).toBe(Infinity);
    expect(state.fleets[0]!.remaining).toBe(0);
    const fleet = state.fleets[0]!, held = advanceFleets(state, 1e8);
    expect(held.fleets[0]).toBe(fleet);
    const offline = tick(state, 7200, "offline");
    expect(offline.fleets[0]).toEqual(fleet);
    expect(isOwnedDockBlocked(offline, 1)).toBe(true);
    expect(resolveFleetArrivals(state)).toBe(state);
    expect(retryOwnedFleetDock(state, 1, 1).state).toBe(state);
    expect(retryOwnedFleetDock(state, 2, 1).state).toBe(state);
    expect(retryOwnedFleetDock(state, 1, 2).state).toBe(state);
    const repaired = { ...state, planets: state.planets.map((planet, index) => index === 0 ? { ...planet, resources: { ...planet.resources, metal: big(100) } } : planet) };
    const result = retryOwnedFleetDock(repaired, 1, 1);
    expect(result.ok).toBe(true); expect(result.state.fleets).toHaveLength(0);
    expect(result.state.planets[0]!.resources.metal.eq(160)).toBe(true);
    expect(result.state.planets[0]!.units.small_cargo).toBe(2);
    expect(retryOwnedFleetDock(result.state, 1, 1).state).toBe(result.state);
  });
  it("blocks ship-only delivered returns at the actual save limit", () => {
    let state = dueArrival(dispatched());
    state.planets[0]!.units.small_cargo = 1e15;
    state = dueArrival(state);
    expect(isOwnedDockBlocked(state, 1)).toBe(true);
    expect(state.fleets[0]!.cargo).toEqual(emptyCargo());
    expect(target(state).resources.metal.eq(60)).toBe(true);
    state = { ...state, planets: state.planets.map((planet, index) => index === 0 ? { ...planet, units: { ...planet.units, small_cargo: 1e15 - 2 } } : planet) };
    const result = retryOwnedFleetDock(state, 1, 1);
    expect(result.ok).toBe(true);
    expect(result.state.planets[0]!.units.small_cargo).toBe(1e15);
  });
  it.each(["missing-tag", "wrong-tag", "fake-return", "fake-zero", "wrong-ships", "wrong-origin", "wrong-duration"])("quarantines %s without losing cargo or entering a zero-event loop", kind => {
    const state = dispatched(), fleet = state.fleets[0]!;
    if (kind === "missing-tag") fleet.orderTransport = null;
    if (kind === "wrong-tag") fleet.orderTransport = { taskId: 1, workId: 2 };
    if (kind === "fake-return") fleet.returning = true;
    if (kind === "fake-zero") fleet.cargo = emptyCargo();
    if (kind === "wrong-ships") fleet.ships.small_cargo = 1;
    if (kind === "wrong-origin") fleet.originId = "transport-payer";
    if (kind === "wrong-duration") fleet.duration++;
    expect(validateOwnedFleetContext(state, 1).kind).toBe("invalid");
    expect(nextFleetEvent(state)).toBe(Infinity);
    const next = advanceFleets(state, 1e5);
    expect(next.fleets[0]).toBe(fleet);
    expect(target(next).resources.metal.eq(0)).toBe(true);
    expect(canPayCurrentWork(next, task(next))).toBe(false);
  });
  it("rejects a fabricated receipt context and premature arrival hooks", () => {
    const state = dispatched(), context = validateOwnedFleetContext(state, 1);
    if (context.kind !== "owned") throw Error("expected real context");
    const returning = { kind: "returning" as const, dockBlocked: false, outcome: { kind: "not-delivered" as const, reason: "manual-recall" as const } };
    expect(recordOwnedTripPhase(state, { ...context, trip: { ...context.trip } }, returning)).toBeNull();
    expect(recordOwnedTripPhase(state, context, { ...returning, outcome: { kind: "delivered" } })).toBeNull();
    expect(recordOwnedTripPhase(state, context, { ...returning, outcome: { kind: "not-delivered", reason: "precision-rejected" } })).toBeNull();
    expect(phase(state)).toEqual({ kind: "outbound" });
  });
  it("does not use messages as delivery evidence", () => {
    const before = dispatched(); before.messages = [{ id: "arrival-1", at: 0, text: "delivered" }];
    expect(canPayCurrentWork(before, task(before))).toBe(false);
    const arrival = dueArrival(before); arrival.messages = [];
    expect(canPayCurrentWork(arrival, task(arrival))).toBe(true);
  });
  it("allows a settled terminal task to keep its real returning ship", () => {
    let state = dueArrival(dispatched());
    state = { ...state, orders: { ...state.orders, tasks: [{ ...task(state), currentWork: null, status: "completed" }] } };
    expect(validateOwnedFleetContext(state, 1).kind).toBe("owned");
    state.planets[0]!.units.small_cargo = 1e15;
    state = dueArrival(state);
    expect(task(state).status).toBe("completed");
    expect(isOwnedDockBlocked(state, 1)).toBe(true);
  });
  it("prestige retires receipt facts without inventing return or refund", () => {
    const outbound = dispatched(), retired = retireOwnedTripsForPrestige(outbound);
    expect(phase(retired)).toEqual({ kind: "prestige-retired", outcome: null });
    expect(task(retired).charged).toEqual(task(outbound).charged);
    expect(task(retired).refunded).toEqual(task(outbound).refunded);
    const returning = dueArrival(dispatched()), retiredReturn = retireOwnedTripsForPrestige(returning);
    expect(phase(retiredReturn)).toEqual({ kind: "prestige-retired", outcome: { kind: "delivered" } });
  });
  it("guards paused live payer/donor authorization without requiring an existing fleet", () => {
    const state = dispatched(), original = task(state);
    state.fleets = [];
    state.orders.tasks = [{ ...original, status: "paused", currentWork: null, transport: { ...original.transport!, trips: [] } }];
    expect(abandonColony(state, "transport-payer").ok).toBe(false);
    state.orders.tasks = [{ ...state.orders.tasks[0]!, planetId: state.planets[0]!.id, transport: { ...original.transport!, authorization: { ...original.transport!.authorization, donorPlanetId: "transport-payer" }, trips: [] } }];
    expect(abandonColony(state, "transport-payer").ok).toBe(false);
    state.orders.tasks[0]!.status = "cancelled";
    expect(abandonColony(state, "transport-payer").ok).toBe(true);
  });
  it("retains the previous permissive manual transport path", () => {
    const state = dispatched(); state.orders.tasks = []; state.fleets[0]!.orderTransport = null;
    target(state).resources.crystal = big("1e100");
    const arrival = dueArrival(state);
    expect(arrival.fleets[0]!.cargo).toEqual(emptyCargo());
    expect(target(arrival).resources.metal.eq(60)).toBe(true);
    expect(validateOwnedFleetContext(arrival, 1).kind).toBe("unowned");
  });
  it("preserves reservation while flights return and bounds retained sums", () => {
    const state = dispatched(), current = task(state);
    expect(reservedOrderMoney(current)).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
    current.transport!.trips[0]!.cargo.metal = "1e190";
    current.transport!.trips.push({ ...current.transport!.trips[0]!, fleetId: 2, workId: 2 });
    expect(grossShippedMoney(current)).toBeNull();
  });
});
