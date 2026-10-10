import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { advanceFleets, recallFleet } from "../src/game/fleet";
import { committedOrderMoney, preparePaidJob } from "../src/game/order-ledger";
import { addOrderAmounts } from "../src/game/order-money";
import { MAX_ORDER_TRIP_RECEIPTS, type CreateOrderRequest, type OrderMoney, type OrderTransportAuthorization } from "../src/game/order-state";
import { advanceTransportOrder, dispatchPendingOrderTransport } from "../src/game/order-transport";
import { canPayCurrentWork, grossShippedMoney, irreversibleFuelMoney } from "../src/game/order-transport-ledger";
import { cancelOrderTask, cancelPaidJob, createOrderTask, dismissOrderTask, pauseOrderTask, resumeOrderTask, runDueOrderPass, terminateOrdersForPrestige } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { canEnqueue, cancel, completeActive, enqueue } from "../src/game/queue";
import { completeActiveResearch } from "../src/game/research";
import { advanceShipyard, unitSeconds } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

const budget: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
function worlds(): GameState {
  const state = withResearch(rich(stateWith(), 1e6), { combustion_drive: 2 });
  activePlanet(state).units.small_cargo = 1;
  const payer = createPlanet("payer", { galaxy: 1, system: 2, position: 8 });
  payer.resources = { metal: big(0), crystal: big(0), deuterium: big(0) };
  payer.buildings.research_lab = 1;
  payer.buildings.shipyard = 1;
  return { ...state, planets: [...state.planets, payer] };
}
function authorization(state: GameState): OrderTransportAuthorization {
  return { donorPlanetId: state.planets[0]!.id, ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 10, grossCargoCap: { ...budget } };
}
function makePlan(state = worlds(), target: Partial<CreateOrderRequest> = {}): GameState {
  return createOrderTask(state, { kind: "building", planetId: "payer", building: "metal_mine", targetLevel: 1, expectedNextTaskId: state.orders.nextTaskId, budget: { ...budget }, transport: authorization(state), ...target } as CreateOrderRequest).state;
}
function depart(state = makePlan()): GameState { return runDueOrderPass(state); }
function arrival(state: GameState): GameState { return advanceFleets(state, state.fleets[0]!.remaining); }
function payer(state: GameState) { return state.planets.find(planet => planet.id === "payer")!; }
function replenish(state: GameState, amount = 1e5): GameState {
  return { ...state, planets: state.planets.map(planet => planet.id === "payer" ? { ...planet, resources: { metal: big(amount), crystal: big(amount), deuterium: big(amount) } } : planet) };
}

describe("single-source transport authority", () => {
  it("copies fixed authorization with no economic side effects and rejects malformed authorization", () => {
    const state = worlds(), auth = authorization(state);
    const request: CreateOrderRequest = { kind: "building", planetId: "payer", building: "metal_mine", targetLevel: 1, budget, expectedNextTaskId: 1, transport: auth };
    const created = createOrderTask(state, request);
    expect(created.ok).toBe(true);
    expect(created.state.planets).toBe(state.planets);
    expect(created.state.fleets).toBe(state.fleets);
    expect(created.state.orders.nextWorkId).toBe(1);
    auth.grossCargoCap.metal = "0";
    expect(created.state.orders.tasks[0]!.transport!.authorization.grossCargoCap.metal).toBe("1000000");
    for (const patch of [{ donorPlanetId: "payer" }, { donorPlanetId: "missing" }, { ship: "solar_satellite" }, { ship: "rocket_launcher" }, { count: 0 }, { count: 0.5 }, { count: 1e13 }, { speedPercent: 15 }, { maxTrips: 101 }, { extra: true }, { grossCargoCap: { ...budget, metal: "1e191" } }]) {
      expect(createOrderTask(state, { ...request, transport: { ...authorization(state), ...patch } as OrderTransportAuthorization }).ok).toBe(false);
    }
  });
  it("reserves fixed work, dispatches the full real gap, and charges fuel exactly once", () => {
    const initial = makePlan(), state = depart(initial), task = state.orders.tasks[0]!, trip = task.transport!.trips[0]!;
    expect(task.currentWork).toMatchObject({ stage: "pending", workId: 1, shipmentFleetId: trip.fleetId, reserved: { metal: "60", crystal: "15", deuterium: "0" } });
    expect(state.orders.nextJobId).toBe(1);
    expect(payer(state).buildQueue).toHaveLength(0);
    expect(payer(state).resources.metal.eq(0)).toBe(true);
    expect(state.fleets[0]!.orderTransport).toEqual({ taskId: 1, workId: 1 });
    expect(state.planets[0]!.units.small_cargo).toBe(0);
    expect(state.planets[0]!.resources.metal.eq(initial.planets[0]!.resources.metal.sub(60))).toBe(true);
    expect(task.charged).toEqual({ metal: "0", crystal: "0", deuterium: trip.fuel });
    expect(runDueOrderPass(state).orders.tasks[0]!.charged).toEqual(task.charged);
    expect(grossShippedMoney(task)).toEqual(trip.cargo);
  });
  it("blocks payment both in coordinator and real ledger while outbound despite fresh local funds", () => {
    const state = replenish(depart()), task = state.orders.tasks[0]!;
    expect(canPayCurrentWork(state, task)).toBe(false);
    expect(runDueOrderPass(state).orders.tasks[0]!.activeJob).toBeNull();
    const local = selectPlanet(state, "payer"), quote = canEnqueue(local, "metal_mine");
    const payment = preparePaidJob(local, { kind: "building", planetId: "payer", building: "metal_mine", targetLevel: 1, quantity: 1, taskId: 1, source: "plan" }, quote.cost);
    expect(payment.ok).toBe(false);
    expect(payment.state.planets).toBe(local.planets);
    expect(payment.state.orders.nextJobId).toBe(1);
  });
  it.each(["building", "research", "shipyard"] as const)("uses actual arrival, paid queue and completion for %s", kind => {
    const target = kind === "research" ? { kind, tech: "energy_tech", targetLevel: 1 } : kind === "shipyard" ? { kind, unit: "rocket_launcher", quantity: 2 } : { kind };
    const outgoing = depart(makePlan(worlds(), target as Partial<CreateOrderRequest>));
    expect(outgoing.fleets).toHaveLength(1);
    let state = runDueOrderPass(arrival(outgoing));
    expect(state.orders.tasks[0]!.currentWork?.stage).toBe("paid");
    expect(state.fleets[0]!.returning).toBe(true);
    expect(state.orders.tasks[0]!.transport!.trips[0]!.phase).toMatchObject({ kind: "returning", outcome: { kind: "delivered" } });
    const local = selectPlanet(state, "payer");
    state = kind === "building" ? completeActive(local).state : kind === "research" ? completeActiveResearch(local).state : advanceShipyard(local, 1e6).state;
    expect(state.orders.tasks[0]!.status).toBe("completed");
    expect(state.orders.tasks[0]!.currentWork).toBeNull();
    expect(dismissOrderTask(state, 1).ok).toBe(false);
    state = arrival(state);
    expect(dismissOrderTask(state, 1).ok).toBe(true);
  });
  it("never transports the same work again when delivered resources are spent elsewhere", () => {
    let state = arrival(depart());
    const original = state.orders.tasks[0]!.currentWork!;
    state = { ...state, planets: state.planets.map(planet => planet.id === "payer" ? { ...planet, resources: { metal: big(0), crystal: big(0), deuterium: big(0) } } : planet) };
    state = arrival(state);
    for (let i = 0; i < 8; i++) state = runDueOrderPass(resumeOrderTask(pauseOrderTask(state, 1).state, 1).state);
    expect(state.orders.tasks[0]!.currentWork!.workId).toBe(original.workId);
    expect(state.orders.tasks[0]!.currentWork!.shipmentFleetId).toBe(original.shipmentFleetId);
    expect(state.orders.tasks[0]!.transport!.trips).toHaveLength(1);
    expect(state.fleets).toHaveLength(0);
    state = runDueOrderPass(replenish(state));
    expect(state.orders.tasks[0]!.currentWork?.stage).toBe("paid");
  });
  it("recall preserves work and budget usage, and only actual return unblocks local payment", () => {
    let state = depart();
    state = advanceFleets(state, state.fleets[0]!.remaining / 2);
    const fleetId = state.fleets[0]!.id, fuel = state.orders.tasks[0]!.charged.deuterium;
    state = recallFleet(state, fleetId).state;
    expect(state.orders.tasks[0]!.status).toBe("paused");
    state = replenish(resumeOrderTask(state, 1).state);
    expect(canPayCurrentWork(state, state.orders.tasks[0]!)).toBe(false);
    expect(runDueOrderPass(state).orders.tasks[0]!.activeJob).toBeNull();
    state = arrival(state);
    expect(canPayCurrentWork(state, state.orders.tasks[0]!)).toBe(true);
    state = runDueOrderPass(state);
    expect(state.orders.tasks[0]!.currentWork?.stage).toBe("paid");
    expect(state.orders.tasks[0]!.charged.deuterium).toBe(fuel);
    expect(state.orders.tasks[0]!.refunded.deuterium).toBe("0");
    expect(state.orders.tasks[0]!.transport!.trips).toHaveLength(1);
  });
  it("refunds partial ships into the original pending work and never replenishes its shipment", () => {
    let state = runDueOrderPass(arrival(depart(makePlan(worlds(), { kind: "shipyard", unit: "rocket_launcher", quantity: 2 }))));
    const before = state.orders.tasks[0]!.currentWork!, fuel = irreversibleFuelMoney(state.orders.tasks[0]!)!;
    state = advanceShipyard(selectPlanet(state, "payer"), unitSeconds(selectPlanet(state, "payer"), "rocket_launcher")).state;
    expect(state.orders.tasks[0]!.completedUnits).toBe(1);
    state = cancelPaidJob(state, { kind: "shipyard", planetId: "payer", jobId: state.orders.tasks[0]!.activeJob!.jobId }).state;
    expect(state.orders.tasks[0]!.currentWork).toMatchObject({ workId: before.workId, shipmentFleetId: before.shipmentFleetId, stage: "pending", reserved: { metal: "2000", crystal: "0", deuterium: "0" } });
    expect(committedOrderMoney(state.orders.tasks[0]!)!.deuterium).toBe(fuel.deuterium);
    state = runDueOrderPass(resumeOrderTask(state, 1).state);
    expect(state.orders.tasks[0]!.currentWork?.stage).toBe("paid");
    expect(payer(state).shipyardQueue[0]!.count).toBe(1);
    expect(state.orders.tasks[0]!.transport!.trips).toHaveLength(1);
    state = advanceShipyard(state, 1e6).state;
    expect(state.orders.tasks[0]!.completedUnits).toBe(2);
    expect(state.orders.tasks[0]!.status).toBe("completed");
  });
  it("blocks predecessors and waits for real manual coverage without changing the pending identity", () => {
    let state = makePlan();
    state = enqueue(selectPlanet(replenish(state), "payer"), "metal_mine", "manual").state;
    state = runDueOrderPass(state);
    expect(state.orders.tasks[0]!.currentWork).toBeNull();
    state = cancel(state, 0).state;
    state = { ...state, planets: state.planets.map(planet => planet.id === "payer" ? { ...planet, resources: { metal: big(0), crystal: big(0), deuterium: big(0) } } : planet) };
    state = depart(state);
    const workId = state.orders.tasks[0]!.currentWork!.workId;
    state = enqueue(selectPlanet(replenish(state), "payer"), "metal_mine", "manual").state;
    expect(runDueOrderPass(state).orders.tasks[0]!.currentWork!.workId).toBe(workId);
    state = completeActive(state).state;
    state = runDueOrderPass(state);
    expect(state.orders.tasks[0]!.status).toBe("completed");
    expect(state.orders.tasks[0]!.transport!.trips[0]!.phase).toMatchObject({ outcome: { kind: "not-delivered", reason: "goal-satisfied" } });
  });
  it("does not spend or dispatch when fuel plus reservation exceeds budget or full gap exceeds cargo cap", () => {
    for (const patch of [{ budget: { metal: "60", crystal: "15", deuterium: "0" } }, { transport: { ...authorization(worlds()), grossCargoCap: { metal: "59", crystal: "15", deuterium: "100" } } }]) {
      const initial = makePlan(worlds(), patch), state = depart(initial);
      expect(state.fleets).toHaveLength(0);
      expect(state.planets).toBe(initial.planets);
      expect(state.orders.nextJobId).toBe(1);
      expect(state.orders.tasks[0]!.charged).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    }
  });
  it("cancels outbound via real recall without refunding fuel and retires prestige trips honestly", () => {
    const outgoing = depart();
    const cancelled = cancelOrderTask(outgoing, 1);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.orders.tasks[0]!.currentWork).toBeNull();
    expect(cancelled.state.orders.tasks[0]!.charged).toEqual(outgoing.orders.tasks[0]!.charged);
    expect(cancelled.state.orders.tasks[0]!.transport!.trips[0]!.phase).toMatchObject({ outcome: { kind: "not-delivered", reason: "plan-cancel" } });
    const retired = terminateOrdersForPrestige(outgoing);
    expect(retired.tasks[0]!.transport!.trips[0]!.phase).toEqual({ kind: "prestige-retired", outcome: null });
    expect(retired.nextWorkId).toBe(outgoing.orders.nextWorkId);
    expect(retired.tasks[0]!.charged).toEqual(outgoing.orders.tasks[0]!.charged);
  });
  it("waits at the global retained receipt cap without spending or allocating a fleet", () => {
    const initial = makePlan(), existing = depart(initial).orders.tasks[0]!, trip = existing.transport!.trips[0]!;
    const history = Array.from({ length: 3 }, (_, owner) => ({ ...existing, id: owner + 2, status: "cancelled" as const, currentWork: null, activeJob: null,
      transport: { ...existing.transport!, trips: Array.from({ length: owner < 2 ? 100 : MAX_ORDER_TRIP_RECEIPTS - 200 }, (_, i) => ({ ...trip, fleetId: owner * 100 + i + 1, workId: owner * 100 + i + 1, phase: { kind: "returned" as const, outcome: { kind: "delivered" as const } } })) } }));
    const state = { ...initial, nextFleetId: 300, orders: { ...initial.orders, nextTaskId: 5, nextWorkId: 300, tasks: [...initial.orders.tasks, ...history] } };
    const next = depart(state);
    expect(next.fleets).toHaveLength(0);
    expect(next.nextFleetId).toBe(300);
    expect(next.planets).toBe(state.planets);
    expect(next.orders.tasks[0]!.reason).toContain("回执");
  });
  it("direct dispatch rechecks frozen target and real queue prerequisites", () => {
    let state = makePlan();
    state = { ...state, planets: state.planets.map(planet => planet.id === state.planets[0]!.id ? { ...planet, units: { ...planet.units, small_cargo: 0 } } : planet) };
    state = depart(state); // valid pending; real missing donor ships prevent departure
    state = { ...state, planets: state.planets.map(planet => planet.id === state.planets[0]!.id ? { ...planet, units: { ...planet.units, small_cargo: 1 } } : planet) };
    const pending = state.orders.tasks[0]!.currentWork!;
    expect(pending.stage).toBe("pending");
    const wrong = { ...state, orders: { ...state.orders, tasks: state.orders.tasks.map(task => ({ ...task, currentWork: { ...pending, spec: { kind: "building" as const, building: "crystal_mine" as const, targetLevel: 1, price: { metal: "48", crystal: "24", deuterium: "0" } } } })) } };
    const rejected = dispatchPendingOrderTransport(wrong, 1);
    expect(rejected.fleets).toHaveLength(0);
    expect(rejected.planets).toBe(wrong.planets);
    expect(rejected.orders.tasks[0]!.status).toBe("paused");
    const covered = enqueue(selectPlanet(replenish(state), "payer"), "metal_mine", "manual").state;
    expect(dispatchPendingOrderTransport(covered, 1).fleets).toHaveLength(0);
  });
  it("refuses resume while actual returning fleet is dock-blocked", () => {
    let state = arrival(depart());
    const donorId = state.planets[0]!.id;
    state = { ...state, planets: state.planets.map(planet => planet.id === donorId ? { ...planet, units: { ...planet.units, small_cargo: 1e15 } } : planet) };
    state = arrival(state);
    expect(state.orders.tasks[0]!.transport!.trips[0]!.phase).toMatchObject({ kind: "returning", dockBlocked: true });
    expect(resumeOrderTask(state, 1).ok).toBe(false);
    expect(state.orders.tasks[0]!.status).toBe("paused");
  });
  it("direct scheduler pauses when the claimed paid queue is missing", () => {
    let state = runDueOrderPass(arrival(depart()));
    state = { ...state, planets: state.planets.map(planet => planet.id === "payer" ? { ...planet, buildQueue: [] } : planet) };
    const next = advanceTransportOrder(state, 1);
    expect(next.orders.tasks[0]!.status).toBe("paused");
    expect(next.orders.tasks[0]!.currentWork?.stage).toBe("paid");
  });
  it("keeps fuel in exact net expenditure after cancelling a paid work", () => {
    const state = runDueOrderPass(arrival(depart()));
    const fuel = state.orders.tasks[0]!.transport!.trips[0]!.fuel;
    const result = cancelOrderTask(state, 1);
    expect(result.ok).toBe(true);
    expect(committedOrderMoney(result.state.orders.tasks[0]!)).toEqual({ metal: "0", crystal: "0", deuterium: fuel });
    expect(addOrderAmounts(result.state.orders.tasks[0]!.refunded.metal, "0")).toBe("60");
  });
});
