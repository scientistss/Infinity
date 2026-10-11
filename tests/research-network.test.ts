import { describe, expect, it } from "vitest";
import { catchUp } from "../src/core/offline";
import { researchById, type ResearchId } from "../src/data/research";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { abandonColony } from "../src/game/fleet";
import { emptyTickLog, tick } from "../src/game/logic";
import { validOwnedPaidJob } from "../src/game/order-ledger";
import { createOrderTask, pauseOrderTask, runDueOrderPass } from "../src/game/orders";
import { createPlanet, type OrderSource } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import {
  canEnqueueResearch, cancelResearch, completeActiveResearch, effectiveLabLevel, enqueueResearch,
  researchCostFor, researchNetworkView, researchSecondsFor, startNextResearch,
} from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";

// Synthetic domain fixtures. These exercise real payment/queue/save APIs, not natural progression.
// All duration goldens below are literal independent values of (M + C) * 6 / (1000 * (1 + lab)).
function ready(networkLevel = 0): GameState {
  const state = createInitialState(123, 456);
  const a = activePlanet(state);
  a.name = "A";
  a.buildings.research_lab = 10;
  const b = createPlanet("B", { galaxy: 1, system: 11, position: 1 });
  const c = createPlanet("C", { galaxy: 1, system: 12, position: 1 });
  b.name = "B";
  c.name = "C";
  b.buildings.research_lab = 7;
  c.buildings.research_lab = 3;
  state.planets.push(b, c);
  for (const planet of state.planets) planet.resources = { metal: big(1e7), crystal: big(1e7), deuterium: big(1e7) };
  Object.assign(state.research.levels, { energy_tech: 9, computer_tech: 8, shielding_tech: 5,
    hyperspace_tech: 7, intergalactic_research_network: networkLevel });
  return state;
}

function paid(state: GameState, tech: ResearchId, source: OrderSource = "manual", taskId: number | null = null): GameState {
  const result = enqueueResearch(state, tech, source, taskId);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

function cold(state: GameState): GameState {
  return deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
}

function money(values: { metal: { toNumber(): number }; crystal: { toNumber(): number }; deuterium: { toNumber(): number } }): number[] {
  return RESOURCE_IDS.map(id => values[id].toNumber());
}

/** Whole-state comparison: only existing floating economy/time integration gets its 1e-9 tolerance. */
function expectEquivalent(actual: GameState, expected: GameState): void {
  const a = serializeState(actual), b = serializeState(expected);
  const near = (left: string, right: string) => {
    expect(big(left).sub(right).abs().div(big(right).abs().max(1)).toNumber()).toBeLessThan(1e-9);
  };
  expect(a.planets.map(planet => planet.id)).toEqual(b.planets.map(planet => planet.id));
  for (let index = 0; index < a.planets.length; index++) {
    for (const id of RESOURCE_IDS) near(a.planets[index]!.resources[id], b.planets[index]!.resources[id]);
    a.planets[index]!.resources = b.planets[index]!.resources;
  }
  for (const id of RESOURCE_IDS) near(a.lifetime[id], b.lifetime[id]);
  near(a.totalTime, b.totalTime);
  a.lifetime = b.lifetime;
  a.totalTime = b.totalTime;
  expect(a).toEqual(b);
}

describe("technology-specific lab network independent goldens", () => {
  it.each([
    [0, 10, 12288 / 55, []],
    [1, 17, 2048 / 15, ["B"]],
    [2, 20, 4096 / 35, ["B", "C"]],
  ] as const)("energy 10 uses completed IRN %i and effective lab %i", (level, effective, seconds, supports) => {
    const initial = ready(level);
    const view = researchNetworkView(initial, "energy_tech");
    expect(view).toMatchObject({ payerId: "homeworld", primaryLabLevel: 10, requiredLabLevel: 1, networkLevel: level, effectiveLabLevel: effective });
    expect(view.supports.map(support => support.planetId)).toEqual(supports);
    expect(money(researchCostFor("energy_tech", 10))).toEqual([0, 409600, 204800]);
    expect(researchSecondsFor(initial, researchById("energy_tech"), 10)).toBeCloseTo(seconds, 10);
    const state = paid(initial, "energy_tech");
    expect(money(state.research.queue[0]!.paid)).toEqual([0, 409600, 204800]);
    expect(state.research.queue[0]!.totalSeconds).toBeCloseTo(seconds, 10);
    expect(state.research.queue[0]!.remainingSeconds).toBe(state.research.queue[0]!.totalSeconds);
    expect(state.research.queue[0]).toMatchObject({ planetId: "homeworld", tech: "energy_tech", targetLevel: 10, jobId: 1, taskId: null, source: "manual" });
  });

  it.each([[0, 10, 3072 / 11, []], [1, 17, 512 / 3, ["B"]], [2, 17, 512 / 3, ["B"]]] as const)(
    "hyperspace 8 excludes lab 3 even with IRN %i", (level, effective, seconds, supports) => {
      const state = ready(level);
      const view = researchNetworkView(state, "hyperspace_tech");
      expect(view.requiredLabLevel).toBe(7);
      expect(view.effectiveLabLevel).toBe(effective);
      expect(view.supports.map(support => support.planetId)).toEqual(supports);
      const after = paid(state, "hyperspace_tech");
      expect(money(after.research.queue[0]!.paid)).toEqual([0, 512000, 256000]);
      expect(after.research.queue[0]!.totalSeconds).toBeCloseTo(seconds, 10);
    },
  );

  it("keeps a low-level eligible payer as primary instead of replacing it with the largest lab", () => {
    const state = selectPlanet(ready(1), "C");
    expect(researchNetworkView(state, "energy_tech")).toEqual({ payerId: "C", primaryLabLevel: 3, requiredLabLevel: 1,
      networkLevel: 1, supports: [{ planetId: "homeworld", name: "A", labLevel: 10 }], effectiveLabLevel: 13 });
    const after = paid(state, "energy_tech");
    expect(after.research.queue[0]!.totalSeconds).toBeCloseTo(6144 / 35, 10);
    expect(after.research.queue[0]!.planetId).toBe("C");
    expect(money(after.planets[0]!.resources)).toEqual([1e7, 1e7, 1e7]);
    expect(money(after.planets[2]!.resources)).toEqual([1e7, 9590400, 9795200]);
  });

  it("uses the old network for IRN itself, and requires each support to meet IRN's lab 10", () => {
    const first = ready(0);
    first.research.levels.hyperspace_tech = 8;
    const one = paid(first, "intergalactic_research_network");
    expect(money(one.research.queue[0]!.paid)).toEqual([240000, 400000, 160000]);
    expect(one.research.queue[0]!.totalSeconds).toBeCloseTo(3840 / 11, 10);
    const second = ready(1);
    second.research.levels.hyperspace_tech = 8;
    expect(researchNetworkView(second, "intergalactic_research_network").supports).toEqual([]);
    const two = paid(second, "intergalactic_research_network");
    expect(money(two.research.queue[0]!.paid)).toEqual([480000, 800000, 320000]);
    expect(two.research.queue[0]!.totalSeconds).toBeCloseTo(7680 / 11, 10);
    second.planets[1]!.buildings.research_lab = 10;
    const eligible = paid(second, "intergalactic_research_network");
    expect(researchNetworkView(second, "intergalactic_research_network").effectiveLabLevel).toBe(20);
    expect(eligible.research.queue[0]!.totalSeconds).toBeCloseTo(2560 / 7, 10);
  });

  it("has no network effect at level zero or on one world, and preserves the generic primary summary", () => {
    const zero = ready(0);
    expect(researchNetworkView(zero, "energy_tech").supports).toEqual([]);
    const single = ready(100);
    single.planets = [single.planets[0]!];
    expect(researchNetworkView(single, "energy_tech").effectiveLabLevel).toBe(10);
    expect(researchSecondsFor(single, researchById("energy_tech"), 10)).toBeCloseTo(12288 / 55, 10);
    expect(effectiveLabLevel(ready(2))).toBe(10);
    expect(effectiveLabLevel(selectPlanet(ready(2), "C"))).toBe(3);
  });
});

describe("network eligibility, purity and unchanged admission", () => {
  it("breaks equal-level ties by stable raw planet ID, independent of name and array order", () => {
    const state = ready(2);
    const primary = state.planets[0]!;
    const supports = [["a", 7], ["_", 7], ["A", 7], ["z", 11]].map(([id, level], index) => {
      const planet = createPlanet(String(id), { galaxy: 1, system: 20 + index, position: 1 });
      planet.name = `name-${3 - index}`;
      planet.buildings.research_lab = Number(level);
      return planet;
    });
    state.planets = [primary, ...supports];
    const before = JSON.stringify(serializeState(state));
    const view = researchNetworkView(state, "hyperspace_tech");
    expect(view.supports.map(support => support.planetId)).toEqual(["z", "A"]);
    expect(view.effectiveLabLevel).toBe(28);
    view.supports[0]!.labLevel = 999;
    view.supports[0]!.name = "changed copy";
    expect(JSON.stringify(serializeState(state))).toBe(before);
    const reordered = { ...state, planets: [...state.planets].reverse().map(planet => ({ ...planet, name: "same name" })) };
    expect(researchNetworkView(reordered, "hyperspace_tech").supports.map(support => support.planetId)).toEqual(["z", "A"]);
    expect(researchNetworkView(state, "energy_tech", "a").primaryLabLevel).toBe(7);
    expect(() => researchNetworkView(state, "energy_tech", "missing")).toThrow("研究付款星球不存在");
  });

  it("cannot meet the payer's lab or technology prerequisite with the aggregate", () => {
    const lowPrimary = selectPlanet(ready(2), "C");
    expect(researchNetworkView(lowPrimary, "hyperspace_tech")).toMatchObject({ primaryLabLevel: 3, requiredLabLevel: 7, supports: [], effectiveLabLevel: 3 });
    const denied = enqueueResearch(lowPrimary, "hyperspace_tech", "manual");
    expect(denied.ok).toBe(false);
    expect(denied.reason).toContain("研究实验室 等级 7");
    expect(denied.state).toBe(lowPrimary);
    const missingTech = ready(2);
    missingTech.research.levels.energy_tech = 4;
    expect(canEnqueueResearch(missingTech, "hyperspace_tech").reason).toContain("能源技术 等级 5");
  });

  it.each([
    ["B", "energy_tech"], // would otherwise be the chosen support
    ["C", "energy_tech"], // eligible, but outside the one-support limit
    ["C", "hyperspace_tech"], // below this technology's original prerequisite
  ] as const)("a lab upgrade anywhere still blocks admission: %s, %s", (id, tech) => {
    const initial = ready(1);
    const result = enqueue(selectPlanet(initial, id), "research_lab", "manual");
    expect(result.ok, result.reason).toBe(true);
    const state = selectPlanet(result.state, "homeworld");
    expect(researchNetworkView(state, tech).supports.some(support => support.planetId === id)).toBe(false);
    expect(canEnqueueResearch(state, tech).reason).toBe("研究实验室正在升级，暂不能研究");
    for (const source of ["manual", "protocol"] as const) {
      const rejected = enqueueResearch(state, tech, source);
      expect(rejected.ok).toBe(false);
      expect(rejected.state).toBe(state);
    }
  });

  it("excludes a queued support lab at any queue position and never counts its target level", () => {
    let state = selectPlanet(ready(2), "B");
    activePlanet(state).buildings.research_lab = 6;
    state = enqueue(state, "metal_mine", "manual").state;
    state = enqueue(state, "research_lab", "manual").state;
    expect(activePlanet(state).buildQueue[1]).toMatchObject({ building: "research_lab", targetLevel: 7, totalSeconds: 0 });
    state = selectPlanet(state, "homeworld");
    expect(researchNetworkView(state, "hyperspace_tech").supports).toEqual([]);
    expect(researchNetworkView(state, "energy_tech").supports.map(support => support.planetId)).toEqual(["C"]);
    expect(canEnqueueResearch(state, "energy_tech").ok).toBe(false);
  });

  it("keeps the reverse exclusion for every lab while research is active or only paid and waiting", () => {
    const active = paid(ready(1), "energy_tech");
    const waiting = { ...active, research: { ...active.research, queue: active.research.queue.map(job => ({ ...job, totalSeconds: 0, remainingSeconds: 0 })) } };
    for (const state of [active, waiting]) for (const planet of state.planets) {
      expect(canEnqueue(selectPlanet(state, planet.id), "research_lab").reason).toBe("研究进行中，研究实验室不能升级");
    }
  });

  it("does not pool any support resources or satisfy missing payer stock", () => {
    const state = ready(2);
    activePlanet(state).resources = { metal: big(0), crystal: big(0), deuterium: big(0) };
    const before = JSON.stringify(serializeState(state));
    expect(canEnqueueResearch(state, "energy_tech")).toMatchObject({ ok: false, onlyResources: true });
    expect(enqueueResearch(state, "energy_tech", "manual").state).toBe(state);
    expect(JSON.stringify(serializeState(state))).toBe(before);
  });

  it("checks graviton energy on the payer only, without consuming or pooling supply", () => {
    const state = ready(2);
    for (const planet of state.planets) {
      planet.buildings.research_lab = 12;
      planet.tempMax = 10;
    }
    state.planets[1]!.units.solar_satellite = 12000;
    expect(economy(selectPlanet(state, "B")).supply).toBe(300000);
    expect(researchNetworkView(state, "graviton_tech").effectiveLabLevel).toBe(36);
    expect(canEnqueueResearch(state, "graviton_tech").reason).toContain("能源供给");
    activePlanet(state).units.solar_satellite = 12000;
    const after = paid(state, "graviton_tech");
    expect(after.research.queue[0]!.totalSeconds).toBe(1);
    expect(money(after.research.queue[0]!.paid)).toEqual([0, 0, 0]);
    expect(after.planets).toEqual(state.planets);
    expect(economy(after).supply).toBe(300000);
  });
});

describe("start-time freeze and old paid queue retention", () => {
  it("preserves an active paid duration across selection, network changes and cold reload", () => {
    const initial = paid(ready(1), "energy_tech");
    const job = initial.research.queue[0]!;
    let state = selectPlanet(initial, "C");
    state = { ...state, research: { ...state.research, levels: { ...state.research.levels, intergalactic_research_network: 2 } },
      planets: state.planets.map(planet => ({ ...planet, buildings: { ...planet.buildings, research_lab: 20 } })) };
    expect(startNextResearch(state)).toBe(state);
    state = cold(state);
    expect(state.research.queue[0]).toEqual(job);
    expect(startNextResearch(state)).toBe(state);
    const advanced = tick(state, 1);
    expect(advanced.research.queue[0]!.totalSeconds).toBe(job.totalSeconds);
    expect(advanced.research.queue[0]!.remainingSeconds).toBeCloseTo(job.remainingSeconds - 1, 10);
    expect(advanced.research.queue[0]).toMatchObject({ jobId: job.jobId, taskId: null, source: "manual", planetId: "homeworld" });
    expect(money(advanced.research.queue[0]!.paid)).toEqual([0, 409600, 204800]);
  });

  it("uses the queued payer and then-current network when a zero-duration paid head actually starts", () => {
    let state = paid(ready(1), "computer_tech");
    state = paid(selectPlanet(state, "C"), "energy_tech", "protocol");
    const waiting = state.research.queue[1]!;
    expect(waiting).toMatchObject({ totalSeconds: 0, remainingSeconds: 0, planetId: "C", source: "protocol", jobId: 2, taskId: null });
    state = cold(selectPlanet(state, "B"));
    expect(state.research.queue[1]).toEqual(waiting);
    state.research.levels.intergalactic_research_network = 2;
    const next = completeActiveResearch(state).state;
    expect(next.activePlanetId).toBe("B");
    expect(next.research.queue[0]!.totalSeconds).toBeCloseTo(4096 / 35, 10); // C3 + A10 + B7
    const { totalSeconds: _oldTotal, remainingSeconds: _oldRemaining, ...oldIdentity } = waiting;
    const { totalSeconds: _newTotal, remainingSeconds: _newRemaining, ...newIdentity } = next.research.queue[0]!;
    expect(newIdentity).toEqual(oldIdentity);
    expect(next.orders).toEqual(state.orders);
    expect(next.planets).toEqual(state.planets);
  });

  it("IRN completion first upgrades the network, then gives the waiting job its start-time duration", () => {
    const initial = ready(0);
    initial.research.levels.hyperspace_tech = 8;
    let state = paid(initial, "intergalactic_research_network");
    state = paid(state, "energy_tech");
    expect(state.research.queue[0]!.totalSeconds).toBeCloseTo(3840 / 11, 10);
    expect(state.research.queue[1]!.totalSeconds).toBe(0);
    const next = tick(state, 3840 / 11);
    expect(next.research.levels.intergalactic_research_network).toBe(1);
    expect(next.research.queue[0]).toMatchObject({ tech: "energy_tech", jobId: 2 });
    expect(next.research.queue[0]!.totalSeconds).toBeCloseTo(2048 / 15, 10);
    expect(next.research.queue[0]!.remainingSeconds).toBeCloseTo(2048 / 15, 10);
  });

  it("cancelling a head reprices the same waiting job and starts it with its own payer's network", () => {
    const initial = ready(1);
    let state = paid(initial, "energy_tech");
    state = paid(selectPlanet(state, "C"), "energy_tech", "protocol");
    expect(state.research.queue[1]).toMatchObject({ jobId: 2, targetLevel: 11, totalSeconds: 0, remainingSeconds: 0 });
    const result = cancelResearch(selectPlanet(state, "B"), 0);
    expect(result.ok).toBe(true);
    expect(result.state.activePlanetId).toBe("B");
    expect(result.state.research.queue[0]).toMatchObject({ jobId: 2, targetLevel: 10, planetId: "C", source: "protocol", taskId: null });
    expect(money(result.state.research.queue[0]!.paid)).toEqual([0, 409600, 204800]);
    expect(result.state.research.queue[0]!.totalSeconds).toBeCloseTo(6144 / 35, 10);
    expect(result.state.planets[0]).toEqual(initial.planets[0]);
    expect(result.state.planets[1]).toEqual(initial.planets[1]);
    expect(money(result.state.planets[2]!.resources)).toEqual([1e7, 9590400, 9795200]);
    expect(result.state.orders.nextJobId).toBe(3);
  });

  it("retains historical paid times exactly, adds no save fields and leaves old waiting jobs at zero", () => {
    let state = paid(ready(2), "energy_tech");
    state = paid(state, "computer_tech");
    const raw = serializeState(state);
    raw.research.queue[0]!.totalSeconds = 900;
    raw.research.queue[0]!.remainingSeconds = 123.75;
    const restored = deserializeState(JSON.parse(JSON.stringify(raw)));
    expect(serializeState(restored).research).toEqual(raw.research);
    expect(Object.keys(serializeState(restored)).sort()).toEqual(Object.keys(raw).sort());
    expect(Object.keys(serializeState(restored).research).sort()).toEqual(["levels", "queue"]);
    expect(Object.keys(serializeState(restored).research.queue[0]!).sort()).toEqual([
      "jobId", "paid", "planetId", "remainingSeconds", "source", "targetLevel", "taskId", "tech", "totalSeconds",
    ]);
    expect(startNextResearch(restored)).toBe(restored);
    expect(restored.research.queue[1]).toMatchObject({ totalSeconds: 0, remainingSeconds: 0 });
    const next = tick(selectPlanet(restored, "C"), 123.75);
    expect(next.research.queue[0]!.planetId).toBe("homeworld");
    expect(next.research.queue[0]!.totalSeconds).toBeCloseTo(1024 / 35, 10); // computer 9, 102400 crystal, effective lab 20
  });

  it("support abandonment affects only future starts and retains the primary-payer guard", () => {
    let state = paid(selectPlanet(ready(1), "C"), "energy_tech");
    expect(abandonColony(state, "C")).toMatchObject({ ok: false, state });
    state = paid(selectPlanet(state, "homeworld"), "computer_tech");
    const active = state.research.queue[0]!;
    const removed = abandonColony(state, "B");
    expect(removed.ok).toBe(true);
    expect(removed.state.research.queue[0]).toEqual(active);
    expect(cold(removed.state).research).toEqual(removed.state.research);
    const next = completeActiveResearch(removed.state).state;
    expect(next.research.queue[0]!.totalSeconds).toBeCloseTo(1536 / 35, 10); // A10 + C3
    expect(next.research.queue[0]!.jobId).toBe(2);
  });

  it("losing a selected support never slows the already-running job", () => {
    let state = paid(ready(1), "energy_tech");
    const duration = state.research.queue[0]!.totalSeconds;
    state = abandonColony(state, "B").state;
    expect(researchNetworkView(state, "energy_tech").effectiveLabLevel).toBe(13);
    expect(researchSecondsFor(state, researchById("energy_tech"), 10)).toBeCloseTo(6144 / 35, 10);
    const next = tick(cold(state), 1);
    expect(next.research.queue[0]!.totalSeconds).toBe(duration);
    expect(next.research.queue[0]!.remainingSeconds).toBeCloseTo(duration - 1, 10);
  });
});

describe("network timing preserves payment ownership and finite authority", () => {
  it.each(["manual", "protocol"] as const)("%s payment and cancellation touch only the original payer", source => {
    const initial = selectPlanet(ready(1), "C");
    const state = paid(initial, "energy_tech", source);
    expect(state.research.queue[0]).toMatchObject({ source, jobId: 1, taskId: null, planetId: "C" });
    expect(state.planets[0]).toEqual(initial.planets[0]);
    expect(state.planets[1]).toEqual(initial.planets[1]);
    const result = cancelResearch(selectPlanet(state, "B"), 0);
    expect(result.ok).toBe(true);
    expect(result.state.activePlanetId).toBe("B");
    expect(result.state.planets).toEqual(initial.planets);
    expect(result.state.orders.tasks).toEqual([]);
    expect(result.state.orders.nextJobId).toBe(2);
  });

  it("keeps finite plan budget, task, paid receipt and payer unchanged across faster starts and reload", () => {
    const initial = ready(1);
    const created = createOrderTask(initial, { kind: "research", planetId: "C", tech: "energy_tech", targetLevel: 10,
      expectedNextTaskId: 1, budget: { metal: "0", crystal: "409600", deuterium: "204800" } });
    expect(created.ok, created.reason).toBe(true);
    const state = runDueOrderPass(created.state);
    const task = state.orders.tasks[0]!;
    expect(state.activePlanetId).toBe("homeworld");
    expect(task).toMatchObject({ id: 1, planetId: "C", budget: { metal: "0", crystal: "409600", deuterium: "204800" },
      charged: { metal: "0", crystal: "409600", deuterium: "204800" }, refunded: { metal: "0", crystal: "0", deuterium: "0" },
      activeJob: { jobId: 1, quantity: 1, credited: 0 } });
    expect(state.research.queue[0]).toMatchObject({ planetId: "C", jobId: 1, taskId: 1, source: "plan" });
    expect(state.research.queue[0]!.totalSeconds).toBeCloseTo(6144 / 35, 10);
    expect(validOwnedPaidJob(state, task)).toBe(true);
    const paused = pauseOrderTask(state, 1).state;
    const restored = cold(paused);
    expect(restored.orders).toEqual(paused.orders);
    expect(restored.research).toEqual(paused.research);
    const result = cancelResearch(selectPlanet(restored, "B"), 0);
    expect(result.ok).toBe(true);
    expect(result.state.orders.tasks[0]!.budget).toEqual(task.budget);
    expect(result.state.orders.tasks[0]!.refunded).toEqual(task.charged);
    expect(result.state.orders.tasks[0]!.activeJob).toBeNull();
    expect(result.state.orders.tasks[0]!.status).toBe("paused");
    expect(result.state.planets).toEqual(initial.planets);
  });

  it("does not turn a large network into permission, a bigger budget or a plan payment", () => {
    const initial = ready(100);
    const created = createOrderTask(initial, { kind: "research", planetId: "C", tech: "energy_tech", targetLevel: 10,
      expectedNextTaskId: 1, budget: { metal: "0", crystal: "409599", deuterium: "204800" } });
    expect(created.ok).toBe(true);
    const state = runDueOrderPass(created.state);
    expect(state.research.queue).toEqual([]);
    expect(state.orders.nextJobId).toBe(1);
    expect(state.orders.tasks[0]!.charged).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    expect(state.planets).toEqual(initial.planets);
    expect(tick(initial, 60).research.queue).toEqual([]);
    expect(tick(initial, 60).orders.tasks).toEqual([]);
    expect(tick(initial, 60).planets.every(planet => planet.buildQueue.length === 0)).toBe(true);
  });

  it("credits the finite plan exactly once on faster completion and never continues past its goal", () => {
    const created = createOrderTask(ready(1), { kind: "research", planetId: "C", tech: "energy_tech", targetLevel: 10,
      expectedNextTaskId: 1, budget: { metal: "0", crystal: "409600", deuterium: "204800" } });
    expect(created.ok).toBe(true);
    const state = runDueOrderPass(created.state);
    const done = tick(selectPlanet(cold(state), "B"), 180);
    expect(done.research.levels.energy_tech).toBe(10);
    expect(done.research.queue).toEqual([]);
    expect(done.orders.tasks[0]).toMatchObject({ id: 1, status: "completed", planetId: "C", targetLevel: 10,
      charged: { metal: "0", crystal: "409600", deuterium: "204800" },
      refunded: { metal: "0", crystal: "0", deuterium: "0" }, activeJob: null });
    expect(done.orders.nextTaskId).toBe(2);
    expect(done.orders.nextJobId).toBe(2);
    expect(tick(cold(done), 60).research).toEqual(done.research);
    expect(tick(cold(done), 60).orders).toEqual(done.orders);
  });
});

describe("network completion is independent of simulation segmentation", () => {
  it("compares the complete resulting state for long, split, cold and offline catch-up", () => {
    const initial = ready(0);
    initial.research.levels.hyperspace_tech = 8;
    let state = paid(initial, "intergalactic_research_network");
    state = paid(selectPlanet(state, "C"), "energy_tech", "protocol");
    state = cold(selectPlanet(state, "B"));
    const original = JSON.stringify(serializeState(state));
    const longLog = emptyTickLog(), splitLog = emptyTickLog();
    const long = tick(state, 600, "live", longLog);
    let split = state;
    for (let index = 0; index < 1200; index++) split = tick(split, 0.5, "live", splitLog);
    const offline = catchUp(state, 600);
    const expectedCompletions = [{ tech: "intergalactic_research_network", level: 1 }, { tech: "energy_tech", level: 10 }];
    expect(longLog.completedResearch).toEqual(expectedCompletions);
    expect(splitLog).toEqual(longLog);
    expect(offline.completedResearch).toEqual(expectedCompletions);
    expect(long.research.queue).toEqual([]);
    expect(long.research.levels.intergalactic_research_network).toBe(1);
    expect(long.research.levels.energy_tech).toBe(10);
    expect(long.activePlanetId).toBe("B");
    expect(long.orders.nextJobId).toBe(3);
    expectEquivalent(split, long);
    expectEquivalent(offline.state, long);
    expectEquivalent(cold(long), long);
    expect(JSON.stringify(serializeState(state))).toBe(original);
  });
});
