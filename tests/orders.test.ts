import { describe, expect, it } from "vitest";
import { armAutoRunner, equipCard, refreshUnlocks } from "../src/automation/engine";
import { BOARD } from "../src/data/arcade";
import { BUILDING_IDS } from "../src/data/buildings";
import { createArcade, grantRun } from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { speedUp, useInventory } from "../src/game/dark-matter";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { abandonColony } from "../src/game/fleet";
import { prestige, tick } from "../src/game/logic";
import type { CreateOrderRequest, OrderMoney } from "../src/game/order-state";
import { advanceOrderPlans, cancelOrderTask, cancelPaidJob, createOrderTask, dismissOrderTask, nextOrderPassIn, pauseOrderTask, resumeOrderTask } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { completeActive, enqueue } from "../src/game/queue";
import { deserializeState, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

const budget: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
function request(state: GameState, targetLevel = 2): CreateOrderRequest {
  return { kind: "building", planetId: state.activePlanetId, building: "metal_mine", targetLevel, expectedNextTaskId: state.orders.nextTaskId, budget };
}
function plan(state = rich(stateWith(), 1e6), targetLevel = 2): GameState { return createOrderTask(state, request(state, targetLevel)).state; }
function colony(state: GameState): GameState {
  const extra = createPlanet("test-colony", { galaxy: 1, system: 2, position: 8 });
  extra.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  return { ...state, planets: [...state.planets, extra] };
}

describe("finite local plan authorizations", () => {
  it("creation does not spend; nonce is single-use and goal/budget are copied", () => {
    const state = rich(stateWith(), 1e6), form = request(state);
    const created = createOrderTask(state, form);
    expect(created.ok).toBe(true);
    expect(created.state.planets).toBe(state.planets);
    expect(created.state.orders.nextTaskId).toBe(2);
    expect(created.state.orders.nextJobId).toBe(1);
    expect(createOrderTask(created.state, form).ok).toBe(false);
    form.budget = { metal: "0", crystal: "0", deuterium: "0" };
    expect(created.state.orders.tasks[0]?.budget.metal).toBe("1000000");
  });
  it("rejects invalid kind, quantity, levels, budgets, nonce and satisfied targets without IDs", () => {
    const state = stateWith({ metal_mine: 2 });
    for (const patch of [{ kind: "transport" }, { targetLevel: 0 }, { targetLevel: 1001 }, { targetLevel: 1.5 }, { planetId: "missing" }, { expectedNextTaskId: 0 }, { budget: { ...budget, metal: "1e191" } }]) {
      const result = createOrderTask(state, { ...request(state, 3), ...patch } as CreateOrderRequest);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
    expect(createOrderTask(state, request(state, 2)).ok).toBe(false);
    for (const quantity of [0, -1, 1.5, 1_000_001]) expect(createOrderTask(state, { kind: "shipyard", unit: "rocket_launcher", planetId: state.activePlanetId, quantity, expectedNextTaskId: 1, budget }).ok).toBe(false);
  });
  it("forbids duplicate live targets, including empire research across payers", () => {
    let state = colony(plan());
    expect(createOrderTask(state, request(state, 3)).ok).toBe(false);
    state = pauseOrderTask(state, 1).state;
    expect(createOrderTask(state, request(state, 3)).ok).toBe(false);
    state = createOrderTask(state, { kind: "research", planetId: state.activePlanetId, tech: "energy_tech", targetLevel: 1, expectedNextTaskId: 2, budget }).state;
    expect(createOrderTask(state, { kind: "research", planetId: "test-colony", tech: "energy_tech", targetLevel: 2, expectedNextTaskId: 3, budget }).ok).toBe(false);
  });
  it("enforces retained/live caps and never reuses dismissed or exhausted IDs", () => {
    let state = plan();
    const original = state.orders.tasks[0]!;
    state = { ...state, orders: { ...state.orders, tasks: Array.from({ length: 100 }, (_, i) => ({ ...original, id: i + 1, status: "cancelled" as const })), nextTaskId: 101 } };
    expect(createOrderTask(state, request(state)).ok).toBe(false);
    state = dismissOrderTask(state, 1).state;
    expect(createOrderTask(state, request(state)).state.orders.tasks.at(-1)?.id).toBe(101);
    const exhausted = { ...state, orders: { ...state.orders, nextTaskId: Number.MAX_SAFE_INTEGER } };
    expect(createOrderTask(exhausted, request(exhausted)).state).toBe(exhausted);
    const worlds = [activePlanet(state), ...Array.from({ length: 2 }, (_, i) => createPlanet(`capacity-${i}`, { galaxy: 1, system: 3 + i, position: 8 }))];
    let liveState = { ...rich(stateWith(), 1e6), planets: worlds, activePlanetId: worlds[0]!.id };
    for (let i = 0; i < 32; i += 1) liveState = createOrderTask(liveState, { kind: "building", planetId: worlds[Math.floor(i / BUILDING_IDS.length)]!.id, building: BUILDING_IDS[i % BUILDING_IDS.length]!, targetLevel: 100, expectedNextTaskId: liveState.orders.nextTaskId, budget }).state;
    expect(liveState.orders.tasks).toHaveLength(32);
    expect(createOrderTask(liveState, { kind: "shipyard", planetId: liveState.activePlanetId, unit: "rocket_launcher", quantity: 1, expectedNextTaskId: liveState.orders.nextTaskId, budget }).ok).toBe(false);
  });
});

describe("finite plan scheduling and ownership", () => {
  it("builds real finite building, research and additional-unit goals", () => {
    let state = plan(rich(stateWith({ research_lab: 1, shipyard: 1 }), 1e6));
    activePlanet(state).units.rocket_launcher = 9;
    state = createOrderTask(state, { kind: "research", planetId: state.activePlanetId, tech: "energy_tech", targetLevel: 2, expectedNextTaskId: 2, budget }).state;
    state = createOrderTask(state, { kind: "shipyard", planetId: state.activePlanetId, unit: "rocket_launcher", quantity: 3, expectedNextTaskId: 3, budget }).state;
    state = tick(state, 40);
    expect(activePlanet(state).buildings.metal_mine).toBe(2);
    expect(state.research.levels.energy_tech).toBe(2);
    expect(activePlanet(state).units.rocket_launcher).toBe(12);
    expect(state.orders.tasks.map(task => task.status)).toEqual(["completed", "completed", "completed"]);
    expect(state.orders.tasks[2]?.completedUnits).toBe(3);
    expect(nextOrderPassIn(state)).toBe(Infinity);
    expect(state.orders.accumulator).toBe(0);
  });
  it("safety-pauses a scheduler payment at an unrepresentable wallet without consuming IDs", () => {
    const state = plan(rich(stateWith(), 1e100), 1);
    const next = advanceOrderPlans(state, 10);
    expect(next.orders.tasks[0]?.status).toBe("paused");
    expect(next.orders.tasks[0]?.reason).toContain("精度");
    expect(next.orders.tasks[0]?.charged.metal).toBe("0");
    expect(next.orders.nextJobId).toBe(1);
    expect(activePlanet(next).buildQueue).toHaveLength(0);
    expect(activePlanet(next).resources).toEqual(activePlanet(state).resources);
    expect(nextOrderPassIn(next)).toBe(Infinity);
  });
  it("collapses arbitrarily large pure scheduler elapsed time to one bounded pass", () => {
    const next = advanceOrderPlans(plan(), 1e12);
    expect(activePlanet(next).buildQueue).toHaveLength(1);
    expect(next.orders.nextJobId).toBe(2);
    expect(next.orders.tasks[0]?.charged.metal).toBe("60");
    expect(next.orders.accumulator).toBe(0);
  });
  it("honors a ten-second activation window and fixed payer after planet selection", () => {
    const initial = colony(rich(stateWith(), 1e6));
    const homeId = initial.activePlanetId;
    let state = selectPlanet(plan(initial, 1), "test-colony");
    const untouched = activePlanet(state).resources;
    state = advanceOrderPlans(state, 9);
    expect(state.orders.tasks[0]?.activeJob).toBeNull();
    expect(nextOrderPassIn(state)).toBe(1);
    state = advanceOrderPlans(state, 1);
    expect(state.activePlanetId).toBe("test-colony");
    expect(activePlanet(state).resources).toBe(untouched);
    expect(state.planets.find(value => value.id === homeId)?.buildQueue[0]?.taskId).toBe(1);
  });
  it("waits for manually queued coverage without adopting its charges", () => {
    let state = enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state;
    state = advanceOrderPlans(plan(state, 1), 10);
    expect(state.orders.tasks[0]?.charged.metal).toBe("0");
    expect(state.orders.tasks[0]?.activeJob).toBeNull();
    state = advanceOrderPlans(completeActive(state).state, 10);
    expect(state.orders.tasks[0]?.status).toBe("completed");
  });
  it("keeps progress and spending across pause, while paid work continues", () => {
    let state = advanceOrderPlans(plan(), 10);
    state = pauseOrderTask(state, 1).state;
    expect(nextOrderPassIn(state)).toBe(Infinity);
    state = tick(state, 15);
    expect(activePlanet(state).buildings.metal_mine).toBe(1);
    expect(state.orders.tasks[0]?.status).toBe("paused");
    expect(state.orders.tasks[0]?.charged.metal).toBe("60");
    state = resumeOrderTask(state, 1).state;
    expect(nextOrderPassIn(state)).toBe(10);
    expect(state.orders.tasks[0]?.charged.metal).toBe("60");
    expect(tick(state, 12).orders.tasks[0]?.status).toBe("completed");
  });
  it("ignores stale cancellation identity after the next job occupies index zero", () => {
    let state = advanceOrderPlans(plan(), 10);
    const first = activePlanet(state).buildQueue[0]!;
    state = advanceOrderPlans(completeActive(state).state, 10);
    const before = state;
    const stale = cancelPaidJob(state, { kind: "building", planetId: state.activePlanetId, jobId: first.jobId });
    expect(stale.ok).toBe(false);
    expect(stale.state).toBe(before);
    expect(activePlanet(stale.state).buildQueue[0]?.jobId).not.toBe(first.jobId);
  });
  it("chooses affordable finite ship batches without changing their goal", () => {
    let state = rich(stateWith({ shipyard: 1 }), 1e6);
    state = createOrderTask(state, { kind: "shipyard", planetId: state.activePlanetId, unit: "rocket_launcher", quantity: 1_000_000, expectedNextTaskId: 1, budget: { metal: "6000", crystal: "0", deuterium: "0" } }).state;
    state = tick(state, 40);
    expect(activePlanet(state).units.rocket_launcher).toBe(3);
    expect(state.orders.tasks[0]?.completedUnits).toBe(3);
    expect(state.orders.tasks[0]?.status).toBe("running");
    expect(state.orders.tasks[0]?.charged.metal).toBe("6000");
    expect(state.orders.tasks[0]?.reason).toContain("预算");
  });
  it("uses stable ascending plan priority when resources compete", () => {
    let state = stateWith({}, { metal: 60, crystal: 30, deuterium: 0 });
    state = plan(state, 1);
    state = createOrderTask(state, { kind: "building", building: "crystal_mine", planetId: state.activePlanetId, targetLevel: 1, expectedNextTaskId: 2, budget }).state;
    state = { ...state, orders: { ...state.orders, tasks: [...state.orders.tasks].reverse() } };
    state = advanceOrderPlans(state, 10);
    expect(activePlanet(state).buildQueue.map(job => job.taskId)).toEqual([1]);
    expect(state.orders.tasks.find(task => task.id === 2)?.charged.metal).toBe("0");
  });
  it.each(["live", "offline"] as const)("matches long versus split ticks in %s mode", mode => {
    const state = plan(rich(stateWith({ robotics_factory: 4 }), 1e6), 4);
    const long = tick(state, 50, mode);
    let split = state;
    for (let i = 0; i < 100; i += 1) split = tick(split, 0.5, mode);
    expect(split.orders).toEqual(long.orders);
    expect(activePlanet(split).buildings).toEqual(activePlanet(long).buildings);
    expect(activePlanet(split).buildQueue).toEqual(activePlanet(long).buildQueue);
  });
  it("dark-matter and item acceleration share cumulative completion accounting", () => {
    let state = advanceOrderPlans(plan(rich(stateWith(), 1e6), 1), 10);
    state = { ...state, darkMatter: big(100000), items: { ...state.items, kraken_box: 1 } };
    const shortened = useInventory(state, "kraken_box");
    expect(shortened.ok).toBe(true);
    expect(shortened.state.orders.tasks[0]?.activeJob).not.toBeNull();
    const finished = speedUp(shortened.state, "build", "finish");
    expect(finished.ok).toBe(true);
    expect(finished.state.orders.tasks[0]?.status).toBe("completed");
    expect(finished.state.orders.tasks[0]?.activeJob).toBeNull();
    expect(finished.state.orders.tasks[0]?.charged.metal).toBe("60");
  });
  it("preserves history and counters on prestige and blocks abandoning paused owners", () => {
    let state = colony(rich(stateWith(), 1e6));
    state = selectPlanet(state, "test-colony");
    state = advanceOrderPlans(plan(state, 1), 10);
    state = pauseOrderTask(state, 1).state;
    expect(abandonColony(state, "test-colony").ok).toBe(false);
    state = { ...state, lifetime: { metal: big(1e15), crystal: big(0), deuterium: big(0) } };
    const launched = prestige(state);
    expect(launched.orders.tasks[0]?.status).toBe("cancelled");
    expect(launched.orders.tasks[0]?.activeJob).toBeNull();
    expect(launched.orders.tasks[0]?.charged).toEqual(state.orders.tasks[0]?.charged);
    expect(launched.orders.tasks[0]?.refunded).toEqual(state.orders.tasks[0]?.refunded);
    expect(launched.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(launched.orders.nextTaskId).toBe(state.orders.nextTaskId);
    expect(launched.orders.accumulator).toBe(0);
    expect(deserializeState(serializeState(launched)).orders).toEqual(launched.orders);
    const cancelled = cancelOrderTask(state, 1);
    expect(abandonColony(cancelled.state, "test-colony").ok).toBe(true);
  });
  it("keeps canonical order time during real armed-ring settlement at the ten-second boundary", () => {
    let state = withResearch(rich(stateWith({ robotics_factory: 4 }), 1e6), { astrophysics: 1 });
    state.arcade = createArcade(773);
    state.arcade.stats.manualRuns = 10;
    state.arcade.stats.runs = 10;
    state.arcade.stats.hits.empty = 10;
    state.unlocked = [...state.unlocked, "astrophysics_1"];
    state = equipCard(refreshUnlocks(state), 0, "auto_runner").state;
    const card = state.protocols.slots[0]!.card!;
    state.protocols.slots[0]!.card = { ...card, trigger: { kind: "interval", seconds: 10 } };
    state = grantRun(state, "bonus").state;
    state.arcade.runs[0]!.outcome = { main: { tile: BOARD.indexOf("empty"), big: false, u: 0.5, v: 0 }, lucky: null, forced: null };
    const armed = armAutoRunner(state, 0, { planetId: state.activePlanetId, count: 1, maxDeuterium: "0" });
    expect(armed.ok).toBe(true);
    state = plan(armed.state, 1);
    state = tick(state, 10);
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.autoBatch?.completed).toBe(1);
    expect(state.orders.tasks[0]?.activeJob).not.toBeNull();
    expect(state.orders.accumulator).toBe(0);
    expect(deserializeState(serializeState(state)).orders).toEqual(state.orders);
  });
});
