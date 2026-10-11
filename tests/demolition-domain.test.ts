import { describe, expect, it } from "vitest";
import { clearSlot, equipCard, evaluateLoadout, moveSlot, patchSlot, refreshUnlocks, toggleSlot, unlockedSlotCount } from "../src/automation/engine";
import type { Action, ProtocolCard } from "../src/data/protocol-cards";
import { DEMOLISHABLE_BUILDING_IDS, type DemolitionJobRef } from "../src/game/demolition-state";
import { createBuildingTemplate, quoteBuildingTemplate, buildingTemplateAuthorityKey, applyBuildingTemplate } from "../src/game/building-templates";
import { advanceFleets } from "../src/game/fleet";
import { cancelDemolition, commitDemolition, completeDemolition, demolitionContextKey, demolitionJobProblem, quoteDemolition } from "../src/game/demolition";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { economy, storageCaps } from "../src/game/economy";
import { abandonColony } from "../src/game/fleet";
import { emptyTickLog, tick } from "../src/game/logic";
import { createOrderTask, pauseOrderTask, resumeOrderTask, runDueOrderPass } from "../src/game/orders";
import { createPlanet, usedFields } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch, researchNetworkView } from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import { canBuildUnits, enqueueUnits, siloCapacity } from "../src/game/shipyard";
import type { GameState, ResourceId } from "../src/game/types";
import { rich, stateWith } from "./helpers";

function ready(): GameState { return rich(stateWith({ metal_mine: 10, solar_plant: 20, metal_storage: 9, robotics_factory: 10, nanite_factory: 1, research_lab: 5, shipyard: 4, missile_silo: 2 }), 1e7); }
function pay(state = ready(), building: Parameters<typeof quoteDemolition>[1] = "metal_storage"): GameState {
  const q = quoteDemolition(state, building); expect(q.ok, q.reason).toBe(true); expect(q.quote).not.toBeNull();
  const result = commitDemolition(state, q.quote!); expect(result.ok, result.reason).toBe(true); return result.state;
}
function ref(state: GameState): DemolitionJobRef { return { kind: "demolition", planetId: state.activePlanetId, jobId: activePlanet(state).demolition!.jobId, taskId: null }; }
function addColony(state: GameState): GameState {
  const planet = createPlanet("colony", { galaxy: 1, system: 2, position: 8 });
  planet.buildings.research_lab = 10; planet.buildings.robotics_factory = 4;
  planet.resources = { metal: big(1e7), crystal: big(1e7), deuterium: big(1e7) };
  return { ...state, planets: [...state.planets, planet] };
}
function card(action: Action, enabled = true): ProtocolCard { return { id: "auto_build", enabled, trigger: { kind: "interval", seconds: 1 }, conditions: [], action }; }
const budget = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };

describe("ordinary demolition payment and actual one-level lifecycle", () => {
  it("supports exactly13 buildings, missing original prerequisites, full and historically overfull fields", () => {
    for (const building of DEMOLISHABLE_BUILDING_IDS) {
      const state = rich(stateWith({ [building]: 1 }), 1e6);
      activePlanet(state).fieldsMax = 1; activePlanet(state).terraformerFields.base = 1;
      activePlanet(state).buildings.alliance_depot = 8;
      const paid = pay(state, building), completed = tick(paid, activePlanet(paid).demolition!.totalSeconds);
      expect(activePlanet(completed).buildings[building]).toBe(0);
      expect(usedFields(completed.planets[0]!)).toBe(8);
      expect(activePlanet(completed).fieldsMax).toBe(1);
    }
    for (const building of ["terraformer", "lunar_base", "alliance_depot", "space_dock", "sensor_phalanx", "jump_gate"] as const) {
      const state = ready(); activePlanet(state).buildings[building] = 1;
      expect(quoteDemolition(state, building).ok).toBe(false);
    }
  });
  it("pays once, preserves functionality until due, saves a partial job, frees one field and rebuilds with old upgrade", () => {
    const state = ready(), quote = quoteDemolition(state, "metal_storage").quote!;
    expect(quote.paid.metal.toString()).toBe("128000"); expect(quote.totalSeconds).toBeCloseTo(768 / 55, 12);
    const paid = commitDemolition(state, quote).state, fields = usedFields(activePlanet(state));
    expect(commitDemolition(paid, quote).state).toBe(paid);
    expect(activePlanet(paid).resources.metal.toNumber()).toBe(1e7 - 128000);
    expect(activePlanet(paid).buildings.metal_storage).toBe(9);
    expect(canEnqueue(paid, "metal_mine")).toMatchObject({ ok: false }); expect(canEnqueue(paid, "metal_mine").onlyResources).not.toBe(true);
    const partial = tick(paid, 5), loaded = deserializeState(serializeState(partial));
    expect(loaded && activePlanet(loaded).demolition).toEqual(activePlanet(partial).demolition);
    const log = emptyTickLog(), done = tick(loaded!, 9, "live", log);
    expect(activePlanet(done).demolition).toBeNull(); expect(activePlanet(done).buildings.metal_storage).toBe(8); expect(usedFields(activePlanet(done))).toBe(fields - 1);
    expect(storageCaps(done).metal).toBe(1590000); expect(activePlanet(done).resources.metal.toNumber()).toBe(1e7 - 128000); expect(economy(done).net.metal === 0).toBe(true);
    expect(done.stats.buildsCompleted).toBe(state.stats.buildsCompleted); expect(log.completedBuilds).toEqual([]); expect(log.completedDemolitions).toHaveLength(1);
    const rebuilt = enqueue(done, "metal_storage", "manual"); expect(rebuilt.ok).toBe(true); expect(activePlanet(rebuilt.state).buildQueue[0]!.paid.metal.toString()).toBe("256000");
    const finished = tick(rebuilt.state, 28); expect(activePlanet(finished).buildings.metal_storage).toBe(9); expect(finished.stats.buildsCompleted).toBe(state.stats.buildsCompleted + 1);
    expect(finished.orders.nextJobId).toBe(state.orders.nextJobId + 2); expect(finished.lifetime.metal.eq(state.lifetime.metal)).toBe(true);
  });
  it("cancels actual saved price once despite later ion/growth changes; due cancel and early completion reject", () => {
    const paid = pay(), id = ref(paid), job = activePlanet(paid).demolition!;
    expect(completeDemolition(paid, id).state).toBe(paid);
    const partial = tick(paid, 2); partial.research.levels.ion_tech = 25; partial.curvature.growth_cut = 1;
    const before = activePlanet(partial).resources.metal, result = cancelDemolition(partial, id);
    expect(result.ok).toBe(true); expect(activePlanet(result.state).resources.metal.sub(before).toNumber()).toBe(128000);
    expect(result.state.orders.nextJobId).toBe(paid.orders.nextJobId); expect(activePlanet(result.state).buildings.metal_storage).toBe(9);
    expect(cancelDemolition(result.state, id).state).toBe(result.state);
    const due = { ...paid, planets: paid.planets.map(p => ({ ...p, demolition: { ...job, remainingSeconds: 0 } })) };
    expect(cancelDemolition(due, id).state).toBe(due);
    const done = completeDemolition(due, id); expect(done.completed).not.toBeNull(); expect(completeDemolition(done.state, id).state).toBe(done.state);
  });
  it("completion lowers energy/prerequisites but preserves installed assets and grants", () => {
    const energyState = ready(), beforeSupply = economy(energyState).supply;
    const paidSolar = pay(energyState, "solar_plant"), doneSolar = tick(paidSolar, activePlanet(paidSolar).demolition!.totalSeconds);
    expect(economy(doneSolar).supply).toBeLessThan(beforeSupply);
    const factoryState = rich(stateWith({ robotics_factory: 2, shipyard: 4 }), 1e6); activePlanet(factoryState).units.small_cargo = 7;
    const paidFactory = pay(factoryState, "robotics_factory"), done = tick(paidFactory, activePlanet(paidFactory).demolition!.totalSeconds);
    expect(activePlanet(done).buildings.shipyard).toBe(4); expect(activePlanet(done).units.small_cargo).toBe(7);
    expect(canEnqueue(done, "shipyard").ok).toBe(false);
    expect(activePlanet(done).terraformerFields).toEqual(activePlanet(factoryState).terraformerFields);
    expect(done.terraformerGrantJobFloor).toBe(factoryState.terraformerGrantJobFloor);
  });
  it("zero payment has fixed noninstant time, own ID, reload and ordinary completion", () => {
    const state = ready(); state.research.levels.ion_tech = 26;
    const paid = pay(state), job = activePlanet(paid).demolition!;
    expect(job.paid.metal.eq(0)).toBe(true); expect(job.totalSeconds).toBeCloseTo(768 / 55, 12); expect(job.jobId).toBe(1);
    expect(activePlanet(paid).resources).toEqual(activePlanet(state).resources);
    const partial = deserializeState(serializeState(tick(paid, 1)))!;
    expect(activePlanet(partial).demolition!.jobId).toBe(1); expect(activePlanet(tick(partial, 13)).buildings.metal_storage).toBe(8);
  });
  for (const resource of ["metal", "crystal", "deuterium"] as ResourceId[]) it(`atomic checked debit/refund rejects unrepresentable ${resource} without IDs or consuming jobs`, () => {
    const state = ready(), planet = activePlanet(state); planet.buildings.robotics_factory = 10;
    const q = quoteDemolition(state, "robotics_factory").quote!;
    planet.resources[resource] = big("1e100");
    const result = commitDemolition(state, q); expect(result.ok).toBe(false); expect(result.state).toBe(state); expect(state.orders.nextJobId).toBe(1); expect(planet.demolition).toBeNull();
    const paid = pay(ready(), "robotics_factory"); activePlanet(paid).resources[resource] = big("1e100");
    const cancelled = cancelDemolition(paid, ref(paid)); expect(cancelled.ok).toBe(false); expect(cancelled.state).toBe(paid); expect(activePlanet(paid).demolition).not.toBeNull();
  });
  it("quote review tolerates resource growth but retires price/level/slot/plan/world changes", () => {
    const state = refreshUnlocks(ready()), q = quoteDemolition(state, "metal_storage").quote!, grown = tick(state, 0.1);
    expect(demolitionContextKey(grown, "metal_storage")).toBe(q.fingerprint); expect(commitDemolition(grown, q).ok).toBe(true);
    for (const alter of [(s: GameState) => { s.research.levels.ion_tech += 1; }, (s: GameState) => { s.stats.launches += 1; }, (s: GameState) => { s.orders.nextJobId += 1; }, (s: GameState) => { s.research.levels.computer_tech += 1; }, (s: GameState) => { activePlanet(s).buildings.metal_storage -= 1; }]) {
      const changed = deserializeState(serializeState(state))!; alter(changed); expect(commitDemolition(changed, q).state).toBe(changed);
    }
    const colony = selectPlanet(addColony(state), "colony"); expect(commitDemolition(colony, q).state).toBe(colony);
  });
  it("unrepresentable warehouse golden refuses before any payment or identity, including ion25", () => {
    for (const ion of [0, 25]) {
      const state = rich(stateWith({ metal_storage: 32 }), 1e14); state.research.levels.ion_tech = ion;
      const before = serializeState(state), result = quoteDemolition(state, "metal_storage");
      expect(result.ok).toBe(false); expect(result.quote).toBeNull(); expect(result.reason).toContain("无法精确保存");
      expect(serializeState(state)).toEqual(before); expect(state.orders.nextJobId).toBe(1); expect(activePlanet(state).demolition).toBeNull();
    }
  });
  it("exhausted or duplicate identities and stolen plan receipts cannot authorize work", () => {
    const exhausted = ready(); exhausted.orders.nextJobId = Number.MAX_SAFE_INTEGER; expect(quoteDemolition(exhausted, "metal_storage").ok).toBe(false);
    const paid = pay(), id = ref(paid);
    const plan = createOrderTask(paid, { kind: "building", planetId: paid.activePlanetId, building: "metal_mine", targetLevel: 11, expectedNextTaskId: 1, budget }).state;
    plan.orders.tasks[0]!.activeJob = { jobId: id.jobId, quantity: 1, credited: 0 };
    expect(cancelDemolition(plan, id).state).toBe(plan);
    activePlanet(plan).demolition!.remainingSeconds = 0; expect(completeDemolition(plan, id).state).toBe(plan);
  });
  it("ref resolves fixed actual planet despite selection and blocks colony abandonment", () => {
    const start = selectPlanet(addColony(ready()), "colony"), paid = pay(start, "research_lab"), id = ref(paid);
    const elsewhere = selectPlanet(paid, "homeworld"); expect(abandonColony(elsewhere, "colony").ok).toBe(false);
    const result = cancelDemolition(elsewhere, id); expect(result.ok).toBe(true); expect(result.state.activePlanetId).toBe("homeworld"); expect(result.state.planets[1]!.demolition).toBeNull();
  });
});

describe("demolition reciprocal construction, research, shipyard, missile and plan locks", () => {
  it("all local upgrade payment paths wait; other worlds continue", () => {
    const state = pay(addColony(ready()));
    expect(enqueue(state, "metal_mine", "manual").state).toBe(state); expect(enqueue(state, "metal_mine", "protocol").state).toBe(state);
    expect(enqueue(selectPlanet(state, "colony"), "metal_mine", "manual").ok).toBe(true);
    const busy = enqueue(ready(), "metal_storage", "manual").state; expect(quoteDemolition(busy, "metal_mine").ok).toBe(false);
  });
  it("any queued research blocks any lab demolition and any lab demolition blocks new research globally/IRN support", () => {
    const state = addColony(ready()); state.research.levels.intergalactic_research_network = 1;
    const paidResearch = enqueueResearch(state, "energy_tech", "manual"); expect(paidResearch.ok).toBe(true);
    expect(quoteDemolition(selectPlanet(paidResearch.state, "colony"), "research_lab").ok).toBe(false);
    const paid = pay(selectPlanet(state, "colony"), "research_lab"), local = selectPlanet(paid, "homeworld");
    expect(canEnqueueResearch(local, "energy_tech").ok).toBe(false); expect(researchNetworkView(local, "energy_tech").supports).toEqual([]);
  });
  it("yard/nanite reject both directions, while unrelated demolition lets yard finish", () => {
    const state = ready(); state.research.levels.combustion_drive = 2;
    const queued = enqueueUnits(state, "small_cargo", 1, "manual"); expect(queued.ok).toBe(true);
    expect(quoteDemolition(queued.state, "shipyard").ok).toBe(false); expect(quoteDemolition(queued.state, "nanite_factory").ok).toBe(false);
    for (const building of ["shipyard", "nanite_factory"] as const) expect(canBuildUnits(pay(state, building), "small_cargo", 1).ok).toBe(false);
    const paid = pay(queued.state); expect(activePlanet(tick(paid, 30)).units.small_cargo).toBe(1);
  });
  it("silo checks built+paid missiles and reserves the future capacity for new payments", () => {
    const state = ready(); state.research.levels.impulse_drive = 1; activePlanet(state).units.anti_ballistic_missile = 11;
    expect(quoteDemolition(state, "missile_silo").ok).toBe(false);
    activePlanet(state).units.anti_ballistic_missile = 9;
    const paid = pay(state, "missile_silo"); expect(siloCapacity(activePlanet(paid))).toBe(10);
    expect(canBuildUnits(paid, "anti_ballistic_missile", 2).ok).toBe(false); expect(canBuildUnits(paid, "anti_ballistic_missile", 1).ok).toBe(true);
    const queued = enqueueUnits(paid, "anti_ballistic_missile", 1, "manual").state;
    expect(demolitionJobProblem(queued, queued.activePlanetId)).toBe("");
  });
  it("templates retain upgrade intent, retire old review keys and cannot create a same-target plan", () => {
    const initial = createBuildingTemplate(ready(), { name: "warehouse", goals: [{ building: "metal_storage", targetLevel: 10 }] }, 1).state;
    const quote = quoteBuildingTemplate(initial, 1, initial.activePlanetId), key = buildingTemplateAuthorityKey(initial, 1, initial.activePlanetId);
    const paid = pay(initial); expect(buildingTemplateAuthorityKey(paid, 1, paid.activePlanetId)).not.toBe(key);
    expect(quoteBuildingTemplate(paid, 1, paid.activePlanetId).ok).toBe(false);
    const result = applyBuildingTemplate(paid, { templateId: 1, expectedTemplateRevision: 1, planetId: paid.activePlanetId,
      expectedNextTaskId: 1, expectedReviewKey: quote.reviewKey, budgets: [{ building: "metal_storage", budget }] });
    expect(result.ok).toBe(false); expect(result.state).toBe(paid); expect(paid.orders.tasks).toEqual([]);
  });
  it("construction lock does not dispatch supply; already-in-flight cargo still arrives and returns", () => {
    let state = addColony(ready()); activePlanet(state).units.small_cargo = 1; state.research.levels.combustion_drive = 2;
    const payer = state.planets[1]!; payer.buildings.metal_storage = 9; payer.resources = { metal: big(128000), crystal: big(0), deuterium: big(0) };
    const transport = { donorPlanetId: "homeworld", ship: "small_cargo" as const, count: 1, speedPercent: 100, maxTrips: 1, grossCargoCap: budget };
    const request = { kind: "building" as const, planetId: "colony", building: "crystal_mine" as const, targetLevel: 1, expectedNextTaskId: 1, budget, transport };
    state = createOrderTask(state, request).state;
    const paid = pay(selectPlanet(state, "colony"));
    const waiting = runDueOrderPass(paid); expect(waiting.fleets).toEqual([]); expect(waiting.orders.nextWorkId).toBe(paid.orders.nextWorkId);
    expect(waiting.orders.tasks[0]!.reason).toContain("拆除");
    const departed = runDueOrderPass(state); expect(departed.fleets).toHaveLength(1);
    const live = pay(selectPlanet(departed, "colony")); const flight = live.fleets[0]!, arrived = advanceFleets(live, flight.remaining);
    expect(arrived.fleets[0]!.returning).toBe(true); expect(arrived.planets[1]!.resources.crystal.gt(0)).toBe(true);
    expect(arrived.orders.tasks[0]!.transport!.trips).toHaveLength(1); expect(activePlanet(arrived).demolition!.jobId).toBe(activePlanet(live).demolition!.jobId);
    const returned = advanceFleets(arrived, arrived.fleets[0]!.remaining); expect(returned.fleets).toEqual([]);
    expect(runDueOrderPass(returned).fleets).toEqual([]);
  });
  it("paused same-target plans still block; creation/resume same-target rejects during demolition and terminal plans never reopen", () => {
    const state = ready(), request = { kind: "building" as const, planetId: state.activePlanetId, building: "metal_storage" as const, targetLevel: 10, expectedNextTaskId: 1, budget };
    const created = createOrderTask(state, request); expect(created.ok).toBe(true);
    expect(quoteDemolition(created.state, "metal_storage").ok).toBe(false);
    const paused = pauseOrderTask(created.state, 1).state; expect(quoteDemolition(paused, "metal_storage").ok).toBe(false);
    const paid = pay(state); expect(createOrderTask(paid, request).state).toBe(paid);
    const corrupt = { ...paid, orders: { ...paid.orders, tasks: paused.orders.tasks, nextTaskId: 2 } };
    expect(resumeOrderTask(corrupt, 1).state).toBe(corrupt);
    const terminal = { ...paid, orders: { ...paid.orders, tasks: paused.orders.tasks.map(t => ({ ...t, status: "completed" as const })), nextTaskId: 2 } };
    expect(runDueOrderPass(tick(terminal, 14)).orders.tasks[0]!.status).toBe("completed");
  });
});

describe("demolition protocol authority and actual robot slot relocking", () => {
  it("all enabled direct/group cards conflict, including locked slots", () => {
    for (const action of [{ kind: "enqueue", building: "metal_mine", levels: 1 }, { kind: "enqueueCheapest", group: "mines" }] as Action[]) {
      const state = ready(); state.protocols.slots[11]!.card = card(action);
      const q = quoteDemolition(state, "metal_mine"); expect(q.ok).toBe(false); expect(q.reason).toContain("当前锁定不执行，重新解锁后可能重建");
      const off = toggleSlot(state, 11, false); expect(off.protocols.slots[11]!.card!.enabled).toBe(false); expect(quoteDemolition(off, "metal_mine").ok).toBe(true);
    }
  });
  it("robot2→1 identifies slot2, preserves unrelated enabled configuration, permits only explicit off/clear while locked", () => {
    const state = rich(stateWith({ robotics_factory: 2 }), 1e6); state.unlockedCards = ["auto_build"]; state.protocols.slots[1]!.card = card({ kind: "collect" });
    const q = quoteDemolition(state, "robotics_factory").quote!; expect(q.currentSlots).toBe(2); expect(q.nextSlots).toBe(1); expect(q.relockedSlots).toEqual([2]);
    const paid = commitDemolition(state, q).state, done = tick(paid, q.totalSeconds); expect(unlockedSlotCount(done)).toBe(1);
    expect(done.protocols.slots[1]!.card).toEqual(state.protocols.slots[1]!.card);
    expect(activePlanet(evaluateLoadout(done, 1)).resources.metal.toString()).toBe(activePlanet(done).resources.metal.toString());
    const off = toggleSlot(done, 1, false); expect(off.protocols.slots[1]!.card!.enabled).toBe(false);
    expect(toggleSlot(off, 1, true)).toBe(off); expect(patchSlot(off, 1, "trigger.seconds", "10")).toBe(off); expect(moveSlot(off, 1, 0)).toBe(off);
    expect(equipCard(off, 1, "auto_build").state).toBe(off);
    const round = deserializeState(serializeState(off))!; round.research.levels.computer_tech = 2; expect(unlockedSlotCount(round)).toBe(2); expect(round.protocols.slots[1]!.card!.enabled).toBe(false);
    const cleared = clearSlot(done, 1); expect(cleared.protocols.slots[1]!.card).toBeNull(); const loaded = deserializeState(serializeState(cleared))!; loaded.research.levels.computer_tech = 2; expect(loaded.protocols.slots[1]!.card).toBeNull();
    expect(activePlanet(evaluateLoadout(off, 1)).resources.metal.toString()).toBe(activePlanet(off).resources.metal.toString());
  });
  it("enable/equip/permission changes cannot rebuild matching target on any currently-demolishing planet", () => {
    const initial = ready(); initial.protocols.slots[0]!.card = card({ kind: "enqueue", building: "metal_mine", levels: 1 }, false);
    const paid = pay(addColony(initial), "metal_mine"), elsewhere = selectPlanet(paid, "colony");
    expect(toggleSlot(elsewhere, 0, true)).toBe(elsewhere); expect(patchSlot(elsewhere, 0, "trigger.seconds", "10")).toBe(elsewhere);
    expect(elsewhere.protocols.slots[0]!.card!.enabled).toBe(false);
  });
});
