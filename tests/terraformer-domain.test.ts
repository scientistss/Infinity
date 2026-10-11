import { describe, expect, it } from "vitest";
import { activeBuildings, buildingById, CURRENT_PHASE, isBuildingAvailable } from "../src/data/buildings";
import { catchUp } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { advanceBuild, buyShopItem, speedUp, useInventory } from "../src/game/dark-matter";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyTickLog, evaluatePrestige, tick } from "../src/game/logic";
import { validOwnedPaidJob } from "../src/game/order-ledger";
import { cancelOrderTask, cancelPaidJob, createOrderTask, pauseOrderTask, runDueOrderPass } from "../src/game/orders";
import { createPlanet, type BuildOrder, usedFields } from "../src/game/planet";
import { canEnqueue, cancel, completeActive, costFor, enqueue, secondsFor, startNext } from "../src/game/queue";
import { createInitialState } from "../src/game/state";
import { deserializeState, serializeState } from "../src/game/save";
import { terraformerEnergyRequirement, terraformerEnqueueProblem, terraformerStateProblem } from "../src/game/terraformer";
import type { GameState } from "../src/game/types";
import { rich, stateWith } from "./helpers";

// Synthetic domain fixtures, not claims of natural player progression.
function ready(fields = 163, satellites = 100): GameState {
  const state = createInitialState(123, 456);
  const planet = activePlanet(state);
  planet.buildings.nanite_factory = 1;
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  state.research.levels.energy_tech = 12;
  planet.fieldsMax = fields;
  planet.terraformerFields = { base: fields, grantedLevels: 0 };
  planet.tempMax = 10; // Each satellite supplies exactly 25 energy.
  planet.units.solar_satellite = satellites;
  return state;
}
function paid(state = ready(), source: "manual" | "protocol" = "manual"): GameState {
  const result = enqueue(state, "terraformer", source);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function atBoundary(state: GameState): GameState {
  return { ...state, planets: state.planets.map(planet => planet.id === state.activePlanetId
    ? { ...planet, buildQueue: planet.buildQueue.map((job, index) => index === 0 ? { ...job, remainingSeconds: 0 } : job) } : planet) };
}
function plan(state = ready(), targetLevel = 1, budget = { metal: "0", crystal: "150000", deuterium: "300000" }): GameState {
  const result = createOrderTask(state, { kind: "building", building: "terraformer", planetId: state.activePlanetId, targetLevel,
    expectedNextTaskId: state.orders.nextTaskId, budget });
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function oldJobs(targets: number[], level = 2, fields = 163): GameState {
  const state = ready(fields);
  activePlanet(state).buildings.terraformer = level;
  activePlanet(state).buildQueue = targets.map((targetLevel, index): BuildOrder => ({
    jobId: 41 + index, taskId: null, building: "terraformer", targetLevel,
    paid: { metal: big(7), crystal: big(1234), deuterium: big(4567) },
    totalSeconds: index === 0 ? 20 : 0, remainingSeconds: index === 0 ? 7 : 0, source: "manual",
  }));
  state.orders.nextJobId = 41 + targets.length;
  state.terraformerGrantJobFloor = state.orders.nextJobId;
  return state;
}
function twoWorlds(state = ready()): GameState {
  const home = activePlanet(state).coordinates;
  const colony = createPlanet("colony", { ...home, system: home.system === 1 ? 2 : 1 }, 187);
  colony.buildings.nanite_factory = 1;
  colony.tempMax = 10;
  colony.units.solar_satellite = 100;
  colony.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  return { ...state, planets: [...state.planets, colony] };
}
function transportPaid(): GameState {
  const state = twoWorlds();
  const created = createOrderTask(state, { kind: "building", building: "terraformer", planetId: state.activePlanetId,
    targetLevel: 1, expectedNextTaskId: state.orders.nextTaskId, budget: { metal: "0", crystal: "50000", deuterium: "100000" },
    transport: { donorPlanetId: "colony", ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 1,
      grossCargoCap: { metal: "0", crystal: "50000", deuterium: "100000" } } });
  expect(created.ok).toBe(true);
  const paid = runDueOrderPass(created.state);
  expect(paid.orders.tasks[0]?.currentWork?.stage).toBe("paid");
  expect(() => deserializeState(serializeState(paid))).not.toThrow();
  return paid;
}


describe("terraformer availability and independent numerical goldens", () => {
  it("opens only the terraformer while preserving phase 3", () => {
    expect(CURRENT_PHASE).toBe(3);
    expect(isBuildingAvailable("terraformer")).toBe(true);
    expect(isBuildingAvailable(buildingById("terraformer"))).toBe(true);
    expect(activeBuildings().map(def => def.id)).toContain("terraformer");
    for (const id of ["space_dock", "alliance_depot", "lunar_base", "sensor_phalanx", "jump_gate"] as const) expect(isBuildingAvailable(id)).toBe(false);
  });
  it("keeps fixed resource prices, growth cut, energy curve, and low-level build-time goldens", () => {
    const state = ready();
    const one = costFor(state, "terraformer", 1), two = costFor(state, "terraformer", 2);
    expect([one.metal.toNumber(), one.crystal.toNumber(), one.deuterium.toNumber()]).toEqual([0, 50000, 100000]);
    expect([two.metal.toNumber(), two.crystal.toNumber(), two.deuterium.toNumber()]).toEqual([0, 100000, 200000]);
    expect([1, 2, 3, 10].map(terraformerEnergyRequirement)).toEqual([1000, 2000, 4000, 512000]);
    expect(secondsFor(state, buildingById("terraformer"), 1)).toBeCloseTo(17.142857142857142, 10);
    expect(secondsFor(state, buildingById("terraformer"), 2)).toBe(40);
    state.curvature.growth_cut = 1;
    const discounted = costFor(state, "terraformer", 2);
    expect([discounted.metal.toNumber(), discounted.crystal.toNumber(), discounted.deuterium.toNumber()]).toEqual([0, 99500, 199000]);
    expect(costFor(state, "terraformer", 1).crystal.toNumber()).toBe(50000);
    expect(terraformerEnergyRequirement(2)).toBe(2000);
    expect(secondsFor(state, buildingById("terraformer"), 2)).toBeCloseTo(39.8, 10);
  });
  it("initializes actual planet sizes without deriving any bonus from existing levels", () => {
    const fresh = createInitialState(1, 1);
    expect(fresh.terraformerGrantJobFloor).toBe(1);
    expect(activePlanet(fresh).terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    expect(createPlanet("different", { galaxy: 1, system: 1, position: 1 }, 219).terraformerFields).toEqual({ base: 219, grantedLevels: 0 });
    const old = oldJobs([], 5, 177);
    expect(terraformerStateProblem(old)).toBeNull();
    expect(activePlanet(tick(old, 1)).fieldsMax).toBe(177);
  });
  it("keeps deterministic distinct coordinates and still rejects the original duplicate-coordinate defect", () => {
    const state = twoWorlds();
    expect(state.universe.seed).toBe(123);
    expect(state.planets.map(planet => planet.coordinates)).toEqual([
      { galaxy: 1, system: 51, position: 5 },
      { galaxy: 1, system: 1, position: 5 },
    ]);
    expect(state.planets[1]!.coordinates).not.toEqual(state.planets[0]!.coordinates);
    expect(() => deserializeState(serializeState(state))).not.toThrow();
    state.planets[1]!.coordinates = { ...state.planets[0]!.coordinates };
    expect(() => deserializeState(serializeState(state))).toThrow("星球坐标重复");
  });
  it("requires separately completed nanite and energy prerequisites", () => {
    const state = ready();
    activePlanet(state).buildings.nanite_factory = 0;
    expect(canEnqueue(state, "terraformer").reason).toContain("纳米机器人工厂 等级 1");
    activePlanet(state).buildings.robotics_factory = 10;
    state.research.levels.computer_tech = 10;
    const queuedNanite = enqueue(rich(state, 1e9), "nanite_factory", "manual").state;
    expect(activePlanet(queuedNanite).buildQueue[0]?.building).toBe("nanite_factory");
    expect(canEnqueue(queuedNanite, "terraformer").reason).toContain("纳米机器人工厂 等级 1");
    activePlanet(state).buildings.nanite_factory = 1;
    state.research.levels.energy_tech = 11;
    expect(canEnqueue(state, "terraformer").reason).toContain("能源技术 等级 12");
    state.research.levels.energy_tech = 12;
    expect(canEnqueue(state, "terraformer").ok).toBe(true);
  });
});

describe("terraformer uses actual pre-payment supply once", () => {
  it.each([[39, false], [40, true], [41, true]] as const)("checks the exact 1000 supply boundary at %s satellites", (satellites, ok) => {
    const state = ready(163, satellites);
    expect(economy(state).supply).toBe(satellites * 25);
    expect(canEnqueue(state, "terraformer").ok).toBe(ok);
    if (!ok) {
      expect(canEnqueue(state, "terraformer").onlyResources).not.toBe(true);
      expect(enqueue(state, "terraformer", "manual").state).toBe(state);
    }
  });
  it("uses supply even when demand exceeds supply, without consuming energy", () => {
    const state = ready(163, 40);
    activePlanet(state).buildings.metal_mine = 30;
    expect(economy(state).demand).toBeGreaterThan(1000);
    const result = paid(state);
    expect(economy(result).supply).toBe(1000);
    expect(economy(result).demand).toBe(economy(state).demand);
    expect(activePlanet(result).resources.crystal.toNumber()).toBe(950000);
    expect(activePlanet(result).resources.deuterium.toNumber()).toBe(900000);
  });
  it("applies power production settings and output doubling, and ignores resource growth cut", () => {
    const state = ready(163, 0);
    activePlanet(state).buildings.solar_plant = 15;
    expect(canEnqueue(state, "terraformer").ok).toBe(true);
    activePlanet(state).productionPct.solar_plant = 70;
    expect(canEnqueue(state, "terraformer").ok).toBe(false);
    state.curvature.output_double = 1;
    expect(canEnqueue(state, "terraformer").ok).toBe(true);
    state.curvature.output_double = 0;
    state.curvature.growth_cut = 1;
    expect(canEnqueue(state, "terraformer").ok).toBe(false);
  });
  it("respects fuel-starved fusion, but does not recheck when payment itself empties deuterium", () => {
    const state = ready(163, 0);
    activePlanet(state).buildings.fusion_reactor = 10;
    activePlanet(state).resources.deuterium = big(0);
    expect(economy(state).supply).toBe(0);
    expect(canEnqueue(state, "terraformer").reason).toContain("能源不足");
    expect(canEnqueue(state, "terraformer").onlyResources).not.toBe(true);
    activePlanet(state).resources.deuterium = big(100000);
    expect(economy(state).supply).toBeGreaterThan(1000);
    const result = paid(state);
    expect(activePlanet(result).resources.deuterium.toNumber()).toBe(0);
    expect(economy(result).supply).toBe(0);
    const done = tick(result, 18);
    expect(activePlanet(done).fieldsMax).toBe(168);
  });
  it("uses the second queued target's 2000 threshold and never reprices paid work on energy loss", () => {
    let state = paid(ready(163, 40));
    expect(canEnqueue(state, "terraformer")).toMatchObject({ ok: false, targetLevel: 2 });
    expect(canEnqueue(state, "terraformer").reason).toContain("需要 2000");
    activePlanet(state).units.solar_satellite = 80;
    state = paid(state);
    activePlanet(state).units.solar_satellite = 0;
    const done = tick(state, 60);
    expect(activePlanet(done).buildings.terraformer).toBe(2);
    expect(activePlanet(done).terraformerFields).toEqual({ base: 163, grantedLevels: 2 });
    expect(activePlanet(done).fieldsMax).toBe(173);
  });
  it.each(["manual", "protocol"] as const)("rejects a %s energy failure atomically", source => {
    const state = ready(163, 39);
    const before = JSON.stringify(state);
    const result = enqueue(state, "terraformer", source);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("finite plans wait without payment; a transport plan never sends a flight to solve missing energy", () => {
    const local = runDueOrderPass(plan(ready(163, 39)));
    expect(local.orders.nextJobId).toBe(1);
    expect(local.orders.tasks[0]?.charged).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    expect(local.orders.tasks[0]?.reason).toContain("能源不足");
    let state = twoWorlds(ready());
    const donor = activePlanet(state);
    donor.units.small_cargo = 100;
    state.research.levels.combustion_drive = 2;
    state = selectPlanet(state, "colony");
    activePlanet(state).units.solar_satellite = 0;
    activePlanet(state).resources = { metal: big(0), crystal: big(0), deuterium: big(0) };
    const made = createOrderTask(state, { kind: "building", building: "terraformer", planetId: "colony", targetLevel: 1,
      expectedNextTaskId: 1, budget: { metal: "0", crystal: "50000", deuterium: "110000" },
      transport: { donorPlanetId: donor.id, ship: "small_cargo", count: 100, speedPercent: 100, maxTrips: 2,
        grossCargoCap: { metal: "0", crystal: "50000", deuterium: "100000" } } });
    expect(made.ok).toBe(true);
    const after = runDueOrderPass(made.state);
    expect(after.orders.tasks[0]?.reason).toContain("能源不足");
    expect(after.fleets).toHaveLength(0);
    expect(after.orders.nextJobId).toBe(1);
    expect(after.orders.nextWorkId).toBe(1);
    expect(after.planets).toBe(made.state.planets);
  });
});

describe("terraformer field reservation and atomic completion", () => {
  it("reserves the last free field normally and grants only upon actual completion", () => {
    const initial = ready(2);
    const used = usedFields(activePlanet(initial));
    expect(used).toBe(1);
    const queued = paid(initial);
    expect(activePlanet(queued).fieldsMax).toBe(2);
    expect(canEnqueue(queued, "terraformer").reason).toContain("星球格子已满");
    expect(completeActive(queued).state).toBe(queued);
    expect(activePlanet(tick(queued, 17)).fieldsMax).toBe(2);
    const done = tick(queued, 18);
    expect(activePlanet(done).fieldsMax).toBe(7);
    expect(usedFields(activePlanet(done))).toBe(used + 1);
    expect(activePlanet(done).fieldsMax - usedFields(activePlanet(done))).toBe(5);
    expect(activePlanet(done).terraformerFields.grantedLevels).toBe(1);
  });
  it("does not waive the existing full-world rule", () => {
    const state = ready(1);
    expect(canEnqueue(state, "terraformer").reason).toContain("星球格子已满");
    expect(enqueue(state, "terraformer", "manual").state).toBe(state);
  });
  it.each([[9990, 2], [9995, 1], [9996, 0], [10000, 0]] as const)("reserves complete +5 grants from %s fields", (fields, allowed) => {
    let state = ready(fields);
    for (let i = 0; i < allowed; i += 1) state = paid(state);
    const rejected = enqueue(state, "terraformer", "manual");
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(state);
    expect(activePlanet(state).fieldsMax).toBe(fields);
    const done = tick(state, 60);
    expect(activePlanet(done).fieldsMax).toBe(fields + allowed * 5);
    expect(activePlanet(done).terraformerFields.grantedLevels).toBe(allowed);
  });
  it("consumes a due paid head exactly once, never through an early or repeated callback", () => {
    const queued = paid();
    expect(completeActive(queued)).toMatchObject({ state: queued, completed: null });
    const boundary = atBoundary(queued);
    const done = completeActive(boundary);
    expect(done.completed).toEqual({ building: "terraformer", level: 1 });
    expect(activePlanet(done.state).fieldsMax).toBe(168);
    expect(completeActive(done.state).state).toBe(done.state);
    expect(activePlanet(tick(tick(done.state, 0), 60)).fieldsMax).toBe(168);
    expect(activePlanet(queued).fieldsMax).toBe(163);
    expect(activePlanet(queued).terraformerFields.grantedLevels).toBe(0);
  });
  it("does not complete an unstarted waiting head", () => {
    const state = paid();
    activePlanet(state).buildQueue[0]!.totalSeconds = 0;
    activePlanet(state).buildQueue[0]!.remainingSeconds = 0;
    expect(completeActive(state).state).toBe(state);
  });
  it("settles a paused plan's genuine receipt and grant together", () => {
    let state = runDueOrderPass(plan());
    expect(state.orders.tasks[0]?.activeJob).toEqual({ jobId: 1, quantity: 1, credited: 0 });
    state = pauseOrderTask(state, 1).state;
    const done = tick(state, 18);
    expect(activePlanet(done).fieldsMax).toBe(168);
    expect(done.orders.tasks[0]?.activeJob).toBeNull();
    expect(done.orders.tasks[0]?.status).toBe("completed");
    expect(done.orders.tasks[0]?.charged).toEqual({ metal: "0", crystal: "50000", deuterium: "100000" });
  });
  it.each(["missing", "wrong-job", "credited", "wrong-planet"])("refuses an invalid %s plan receipt without any partial grant", kind => {
    const state = atBoundary(runDueOrderPass(plan()));
    const task = state.orders.tasks[0]!;
    if (kind === "missing") task.activeJob = null;
    if (kind === "wrong-job") task.activeJob!.jobId = 2;
    if (kind === "credited") task.activeJob!.credited = 1;
    if (kind === "wrong-planet") task.planetId = "elsewhere";
    const before = JSON.stringify(state);
    expect(completeActive(state).state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    const advanced = tick(state, 2);
    expect(advanced.totalTime.toNumber()).toBe(2);
    expect(activePlanet(advanced).fieldsMax).toBe(163);
    expect(activePlanet(advanced).buildQueue).toHaveLength(1);
  });
  it.each([false, true])("checks full transport authority before completion, including legacy=%s", legacy => {
    for (const defect of ["work-id", "shipment-id", "charge", "budget", "work-counter"] as const) {
      const state = transportPaid();
      if (legacy) state.terraformerGrantJobFloor = state.orders.nextJobId;
      const task = state.orders.tasks[0]!;
      if (defect === "work-id") task.currentWork!.workId = state.orders.nextWorkId;
      if (defect === "shipment-id") task.currentWork!.shipmentFleetId = 999;
      if (defect === "charge") task.charged.crystal = "0";
      if (defect === "budget") task.budget.crystal = "0";
      if (defect === "work-counter") state.orders.nextWorkId = 1;
      // Demonstrates the audit gap: the pre-existing lightweight guard alone accepts it.
      expect(validOwnedPaidJob(state, task)).toBe(true);
      const boundary = atBoundary(state), before = JSON.stringify(boundary);
      expect(completeActive(boundary).state).toBe(boundary);
      expect(JSON.stringify(boundary)).toBe(before);
      expect(activePlanet(boundary).fieldsMax).toBe(163);
      expect(task.activeJob).not.toBeNull();
    }
  });
  it("completes a genuine transport-plan receipt and field award in one transaction", () => {
    const state = transportPaid();
    const done = completeActive(atBoundary(state));
    expect(done.completed).toEqual({ building: "terraformer", level: 1 });
    expect(done.state.orders.tasks[0]?.activeJob).toBeNull();
    expect(done.state.orders.tasks[0]?.currentWork).toBeNull();
    expect(activePlanet(done.state).fieldsMax).toBe(168);
    expect(() => deserializeState(serializeState(done.state))).not.toThrow();
  });
  it("cannot manufacture another award by replaying an already-issued identity", () => {
    const queued = paid();
    const done = completeActive(atBoundary(queued)).state;
    const planet = activePlanet(done);
    planet.buildQueue = [{ ...activePlanet(queued).buildQueue[0]!, targetLevel: 2, remainingSeconds: 0 }];
    expect(terraformerStateProblem(done)).toContain("发行数量");
    expect(completeActive(done).state).toBe(done);
    expect(planet.fieldsMax).toBe(168);
  });
  it("counts pending paid jobs from all kinds against the issue-space proof", () => {
    let state = completeActive(atBoundary(paid())).state;
    state = enqueue(state, "metal_mine", "manual").state;
    state.orders.nextJobId = 2;
    activePlanet(state).buildQueue[0]!.jobId = 1;
    expect(terraformerStateProblem(state)).toContain("发行数量");
  });
  it("rejects corrupt current expansion metadata and targets without charging", () => {
    for (const invalid of [NaN, Infinity, -1, 0.5, 1001]) {
      const state = ready();
      activePlanet(state).buildings.terraformer = invalid;
      expect(enqueue(state, "terraformer", "manual").state).toBe(state);
    }
    const state = ready();
    activePlanet(state).terraformerFields.grantedLevels = 1;
    expect(enqueue(state, "terraformer", "manual").state).toBe(state);
    for (const level of [0, -1, NaN, Infinity, 1.5, 1001]) expect(Number.isNaN(terraformerEnergyRequirement(level))).toBe(true);
    expect(Number.isFinite(terraformerEnergyRequirement(1000))).toBe(true);
    const max = ready(10000);
    activePlanet(max).buildings.terraformer = 1000;
    expect(enqueue(max, "terraformer", "manual").state).toBe(max);
  });
  it("rejects non-finite supply and duplicate paid identities", () => {
    const state = ready();
    activePlanet(state).buildings.solar_plant = 100000;
    expect(terraformerEnqueueProblem(state, 1)).toContain("供能无效");
    const queued = paid();
    activePlanet(queued).buildQueue.push({ ...activePlanet(queued).buildQueue[0]!, targetLevel: 2 });
    expect(terraformerStateProblem(queued)).toContain("重复");
    expect(completeActive(atBoundary(queued)).completed).toBeNull();
  });
  it("can issue the last job, but never the exhausted sentinel or reuse an old identity", () => {
    let state = ready();
    state.orders.nextJobId = Number.MAX_SAFE_INTEGER - 1;
    state.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER - 1;
    state = paid(state);
    expect(state.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
    expect(activePlanet(completeActive(atBoundary(state)).state).fieldsMax).toBe(168);
    const exhausted = ready();
    exhausted.orders.nextJobId = Number.MAX_SAFE_INTEGER;
    exhausted.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER;
    expect(enqueue(exhausted, "terraformer", "manual").state).toBe(exhausted);
  });
});

describe("terraformer cancellation and explicitly historical paid semantics", () => {
  it("refunds exact charged amounts, downgrades the following job, and grants nothing on cancel", () => {
    let state = paid(paid());
    const before = activePlanet(state).resources;
    state = cancel(state, 0).state;
    const planet = activePlanet(state);
    expect(planet.resources.crystal.sub(before.crystal).toNumber()).toBe(100000);
    expect(planet.resources.deuterium.sub(before.deuterium).toNumber()).toBe(200000);
    expect(planet.buildQueue[0]).toMatchObject({ jobId: 2, targetLevel: 1 });
    expect(planet.buildQueue[0]!.paid.crystal.toNumber()).toBe(50000);
    expect(planet.fieldsMax).toBe(163);
    expect(planet.terraformerFields.grantedLevels).toBe(0);
    expect(activePlanet(tick(state, 18)).fieldsMax).toBe(168);
  });
  it("cancels the tail without resetting a started timer or changing grants", () => {
    const state = tick(paid(paid()), 4);
    const remaining = activePlanet(state).buildQueue[0]!.remainingSeconds;
    const cancelled = cancel(state, 1);
    expect(cancelled.ok).toBe(true);
    expect(activePlanet(cancelled.state).buildQueue[0]!.remainingSeconds).toBe(remaining);
    expect(activePlanet(cancelled.state).fieldsMax).toBe(163);
    expect(activePlanet(cancelled.state).resources.crystal.toNumber()).toBe(950000);
  });
  it("retains historical targets, paid prices and timers while only blocking new local terraformer payments", () => {
    const state = oldJobs([5]);
    const job = activePlanet(state).buildQueue[0]!;
    expect(terraformerStateProblem(state)).toBeNull();
    expect(canEnqueue(state, "terraformer").reason).toContain("旧版已付");
    expect(canEnqueue(state, "metal_mine").ok).toBe(true);
    const before = JSON.stringify(job);
    const waiting = tick(state, 6);
    expect(activePlanet(waiting).fieldsMax).toBe(163);
    const done = tick(waiting, 1);
    expect(activePlanet(done).buildings.terraformer).toBe(5);
    expect(activePlanet(done).fieldsMax).toBe(163);
    expect(activePlanet(done).terraformerFields.grantedLevels).toBe(0);
    expect(JSON.stringify(job)).toBe(before);
  });
  it.each([[3, 3], [5, 3]] as const)("completes old duplicate/noncontinuous targets %s without any grant or repricing", (first, second) => {
    const state = oldJobs([first, second], 2, 9996);
    const done = tick(state, 30);
    expect(activePlanet(done).buildQueue).toHaveLength(0);
    expect(activePlanet(done).buildings.terraformer).toBe(Math.max(first, second));
    expect(activePlanet(done).fieldsMax).toBe(9996);
    expect(activePlanet(done).terraformerFields.grantedLevels).toBe(0);
  });
  it("old completion never rechecks new energy or prerequisites; a later new job earns exactly one grant", () => {
    let state = oldJobs([1], 0);
    activePlanet(state).buildings.nanite_factory = 0;
    activePlanet(state).units.solar_satellite = 0;
    state.research.levels.energy_tech = 0;
    state = tick(state, 7);
    expect(activePlanet(state).buildings.terraformer).toBe(1);
    expect(activePlanet(state).fieldsMax).toBe(163);
    activePlanet(state).buildings.nanite_factory = 1;
    activePlanet(state).units.solar_satellite = 80;
    state.research.levels.energy_tech = 12;
    state = paid(state);
    expect(activePlanet(state).buildQueue[0]?.jobId).toBe(42);
    const done = tick(state, 40);
    expect(activePlanet(done).buildings.terraformer).toBe(2);
    expect(activePlanet(done).fieldsMax).toBe(168);
  });
  it("rejects the historical level 0/[1,1] head cancel atomically while keeping the source valid", () => {
    const state = oldJobs([1, 1], 0);
    expect(terraformerStateProblem(state)).toBeNull();
    const before = JSON.stringify(state);
    const result = cancel(state, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("目标等级无效");
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    const tail = cancel(state, 1);
    expect(tail.ok).toBe(true);
    expect(activePlanet(tail.state).resources.metal.sub(activePlanet(state).resources.metal).toNumber()).toBe(7);
  });
  it("keeps the entire state through both plan cancellation wrappers on a legacy target-zero rejection", () => {
    const state = runDueOrderPass(plan());
    const head = activePlanet(state).buildQueue[0]!;
    activePlanet(state).buildQueue.push({ ...head, jobId: 2, taskId: null, source: "manual", totalSeconds: 0, remainingSeconds: 0 });
    state.orders.nextJobId = 3;
    state.terraformerGrantJobFloor = 3;
    expect(terraformerStateProblem(state)).toBeNull();
    expect(cancel(state, 0).state).toBe(state);
    expect(cancelPaidJob(state, { kind: "building", planetId: state.activePlanetId, jobId: 1 }).state).toBe(state);
    expect(cancelOrderTask(state, 1).state).toBe(state);
    expect(state.orders.tasks[0]!.status).toBe("running");
  });
  it("retains the existing plan-pause behavior for unrelated receipt failures", () => {
    const state = runDueOrderPass(plan());
    state.orders.tasks[0]!.activeJob!.quantity = 2;
    const result = cancelPaidJob(state, { kind: "building", planetId: state.activePlanetId, jobId: 1 });
    expect(result.ok).toBe(false);
    expect(result.state.orders.tasks[0]!.status).toBe("paused");
    expect(result.state.planets).toBe(state.planets);
    expect(activePlanet(result.state).fieldsMax).toBe(163);
  });
  it("defensively rolls back cancellation of a synthetic runtime-only immutable transport tail", () => {
    // This is deliberately NOT an accepted historical save: both r9 and r10 strict readers
    // reject a paid transport job preceded by the same building. The runtime receipt guard
    // alone is weaker than that save contract, so exercise this defense without claiming
    // a historical compatibility fix or adding it to the accepted old-save fixtures.
    const state = runDueOrderPass(plan(twoWorlds(), 2));
    const planet = activePlanet(state), tail = planet.buildQueue[0]!, task = state.orders.tasks[0]!;
    tail.targetLevel = 2;
    tail.paid = costFor(state, "terraformer", 2);
    tail.totalSeconds = 0;
    tail.remainingSeconds = 0;
    task.charged = { metal: "0", crystal: "100000", deuterium: "200000" };
    task.transport = { authorization: { donorPlanetId: "colony", ship: "small_cargo", count: 1, speedPercent: 100,
      maxTrips: 1, grossCargoCap: { ...task.budget } }, trips: [] };
    task.currentWork = { workId: 1, shipmentFleetId: null, stage: "paid", jobId: tail.jobId,
      spec: { kind: "building", building: "terraformer", targetLevel: 2, price: { ...task.charged } } };
    planet.buildQueue.unshift({ jobId: 2, taskId: null, building: "terraformer", targetLevel: 1,
      paid: costFor(state, "terraformer", 1), totalSeconds: 10, remainingSeconds: 4, source: "manual" });
    state.orders.nextJobId = 3;
    state.orders.nextWorkId = 2;
    state.terraformerGrantJobFloor = 3;
    expect(validOwnedPaidJob(state, task)).toBe(true);
    expect(terraformerStateProblem(state)).toBeNull();
    expect(() => deserializeState(serializeState(state))).toThrow("运输建筑付款与冻结子目标不一致");
    const before = JSON.stringify(state);
    const result = cancel(state, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("付费凭证或格子账");
    expect(result.state).toBe(state);
    expect(cancelPaidJob(state, { kind: "building", planetId: planet.id, jobId: planet.buildQueue[0]!.jobId }).state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(validOwnedPaidJob(state, task)).toBe(true);
  });
  it("keeps a historical plan receipt's exact charged amount and clears it without granting fields", () => {
    const state = runDueOrderPass(plan());
    state.terraformerGrantJobFloor = state.orders.nextJobId;
    const charged = { ...state.orders.tasks[0]!.charged };
    const done = tick(state, 18);
    expect(activePlanet(done).fieldsMax).toBe(163);
    expect(done.orders.tasks[0]?.activeJob).toBeNull();
    expect(done.orders.tasks[0]?.status).toBe("completed");
    expect(done.orders.tasks[0]?.charged).toEqual(charged);
  });
  it("does not pay when an authorized finite plan has insufficient budget", () => {
    const state = plan(ready(), 1, { metal: "0", crystal: "49999", deuterium: "100000" });
    const after = runDueOrderPass(state);
    expect(after.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(after.planets).toBe(state.planets);
    expect(after.orders.tasks[0]?.reason).toContain("预算不足");
  });
});

describe("terraformer event engine, ownership and reset", () => {
  it("halves and finishes through the actual accelerated boundary, charging the existing DM price", () => {
    const state = paid();
    state.darkMatter = big(10000);
    const remaining = activePlanet(state).buildQueue[0]!.remainingSeconds;
    const half = speedUp(state, "build", "halve");
    expect(half.ok).toBe(true);
    expect(activePlanet(half.state).fieldsMax).toBe(163);
    expect(activePlanet(half.state).buildQueue[0]!.remainingSeconds).toBeCloseTo(remaining / 2, 10);
    expect(half.state.darkMatter.toNumber()).toBe(9250);
    const done = speedUp(half.state, "build", "finish");
    expect(done.ok).toBe(true);
    expect(done.state.darkMatter.toNumber()).toBe(8500);
    expect(activePlanet(done.state).fieldsMax).toBe(168);
    expect(activePlanet(done.state).terraformerFields.grantedLevels).toBe(1);
  });
  it("KRAKEN carry completes each paid level once, while the inventory box only shortens its head", () => {
    const state = paid(paid());
    state.darkMatter = big(10000);
    state.items.kraken_box = 1;
    const remaining = activePlanet(state).buildQueue[0]!.remainingSeconds;
    const box = useInventory(state, "kraken_box");
    expect(box.ok).toBe(true);
    expect(box.state.items.kraken_box).toBe(0);
    expect(activePlanet(box.state).fieldsMax).toBe(163);
    expect(activePlanet(box.state).buildQueue[0]!.remainingSeconds).toBeCloseTo(remaining * 0.7, 10);
    const done = buyShopItem(state, "kraken_gold");
    expect(done.ok).toBe(true);
    expect(done.state.darkMatter.toNumber()).toBe(1000);
    expect(activePlanet(done.state).fieldsMax).toBe(173);
    expect(activePlanet(done.state).buildQueue).toHaveLength(0);
  });
  it("half and inventory acceleration can reach the same epsilon boundary exactly once", () => {
    for (const useBox of [false, true]) {
      const state = paid();
      state.darkMatter = big(10000);
      state.items.kraken_box = 1;
      activePlanet(state).buildQueue[0]!.remainingSeconds = 1e-10;
      const result = useBox ? useInventory(state, "kraken_box") : speedUp(state, "build", "halve");
      expect(result.ok).toBe(true);
      expect(activePlanet(result.state).fieldsMax).toBe(168);
      expect(completeActive(result.state).state).toBe(result.state);
    }
  });
  it("rejects all acceleration atomically when the terraformer receipt is invalid", () => {
    const state = runDueOrderPass(plan());
    state.darkMatter = big(10000);
    state.items.kraken_box = 1;
    state.orders.tasks[0]!.activeJob = null;
    const before = JSON.stringify(state);
    for (const result of [speedUp(state, "build", "finish"), speedUp(state, "build", "halve"),
      buyShopItem(state, "kraken_gold"), useInventory(state, "kraken_box")]) {
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
    }
    expect(advanceBuild(state, 360, true)).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("rolls back an earlier ordinary completion if KRAKEN later reaches an invalid terraformer", () => {
    let state = ready();
    state = enqueue(state, "metal_mine", "manual").state;
    state = runDueOrderPass(plan(state));
    expect(activePlanet(state).buildQueue.map(job => job.building)).toEqual(["metal_mine", "terraformer"]);
    state.orders.tasks[0]!.activeJob = null;
    state.darkMatter = big(10000);
    const before = JSON.stringify(state);
    const rejected = buyShopItem(state, "kraken_gold");
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("one long tick and many small ticks produce the same completed grants", () => {
    const state = paid(paid());
    const long = tick(state, 60);
    let segmented = state;
    for (let i = 0; i < 60; i += 1) segmented = tick(segmented, 1);
    expect(activePlanet(long).fieldsMax).toBe(173);
    expect(activePlanet(segmented).terraformerFields).toEqual(activePlanet(long).terraformerFields);
    expect(activePlanet(segmented).buildings).toEqual(activePlanet(long).buildings);
    expect(activePlanet(segmented).resources).toEqual(activePlanet(long).resources);
    expect(segmented.orders).toEqual(long.orders);
    expect(segmented.stats).toEqual(long.stats);
  });
  it("simultaneous worlds pay and finish on their own planets despite active-planet switching", () => {
    let state = twoWorlds();
    state = paid(state);
    state = paid(selectPlanet(state, "colony"));
    const log = emptyTickLog();
    const done = tick(selectPlanet(state, "homeworld"), 18, "live", log);
    expect(done.activePlanetId).toBe("homeworld");
    expect(done.planets.map(planet => [planet.id, planet.fieldsMax, planet.terraformerFields.grantedLevels])).toEqual([["homeworld", 168, 1], ["colony", 192, 1]]);
    expect(log.completedBuilds.map(job => job.planetId)).toEqual(["homeworld", "colony"]);
    expect(done.planets.map(planet => planet.resources.crystal.toNumber())).toEqual([950000, 950000]);
    expect(terraformerStateProblem(done)).toBeNull();
  });
  it("does not let an old paid job on another planet block a new local payment", () => {
    const state = selectPlanet(twoWorlds(oldJobs([3])), "colony");
    expect(canEnqueue(state, "terraformer").ok).toBe(true);
    const done = tick(paid(state), 18);
    expect(done.planets.map(planet => planet.fieldsMax)).toEqual([163, 192]);
  });
  it("offline catch-up obeys the cap and never grants during initialization or repeated completed catch-up", () => {
    const state = paid();
    activePlanet(state).buildQueue[0]!.totalSeconds = 8000;
    activePlanet(state).buildQueue[0]!.remainingSeconds = 8000;
    expect(activePlanet(catchUp(state, 0).state).fieldsMax).toBe(163);
    const capped = catchUp(state, 10000);
    expect(capped.appliedSeconds).toBe(7200);
    expect(capped.capped).toBe(true);
    expect(activePlanet(capped.state).fieldsMax).toBe(163);
    expect(activePlanet(capped.state).buildQueue[0]!.remainingSeconds).toBe(800);
    const done = catchUp(capped.state, 800);
    expect(activePlanet(done.state).fieldsMax).toBe(168);
    expect(done.completedBuilds).toHaveLength(1);
    expect(activePlanet(catchUp(done.state, 60).state).fieldsMax).toBe(168);
  });
  it("resets the expansion ledger and boundary while retaining the global job counter", () => {
    const state = completeActive(atBoundary(paid())).state;
    state.lifetime.metal = big(1e12);
    const reset = evaluatePrestige(state);
    expect(reset.gain.gt(0)).toBe(true);
    expect(reset.next.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(reset.next.terraformerGrantJobFloor).toBe(state.orders.nextJobId);
    expect(activePlanet(reset.next).fieldsMax).toBe(163);
    expect(activePlanet(reset.next).buildings.terraformer).toBe(0);
    expect(activePlanet(reset.next).terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    expect(activePlanet(reset.next).buildQueue).toHaveLength(0);
    expect(terraformerStateProblem(reset.next)).toBeNull();
  });
  it("preserves the historical direct completion and economic behavior of ordinary buildings", () => {
    const state = enqueue(rich(stateWith(), 1000), "metal_mine", "manual").state;
    expect(activePlanet(state).resources.metal.toNumber()).toBe(940);
    expect(activePlanet(state).resources.crystal.toNumber()).toBe(985);
    const done = completeActive(state).state;
    expect(activePlanet(done).buildings.metal_mine).toBe(1);
    expect(activePlanet(done).fieldsMax).toBe(163);
    expect(activePlanet(done).terraformerFields.grantedLevels).toBe(0);
    expect(startNext(done)).toBe(done);
  });
});
