import { expect, it } from "vitest";
import { activePlanet, selectPlanet, withPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { advanceBuild, speedUp } from "../src/game/dark-matter";
import { economy } from "../src/game/economy";
import { evaluatePrestige, prestige, scrape, tick } from "../src/game/logic";
import { canEnqueue, cancel, completeActive, enqueue, queueCapacity } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch, researchCapacity } from "../src/game/research";
import { createPlanet, HOMEWORLD_ID } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { createOrderTask, runDueOrderPass } from "../src/game/orders";
import { ENERGY_CHALLENGE_BUILDINGS, ENERGY_CHALLENGE_TARGET_UNITS, createEnergyChallengeState } from "../src/game/energy-challenge-state";
import {
  abandonEnergyChallenge, energyChallengeScoreText, energyChallengeStatus,
  enterEnergyChallenge, finishEnergyChallenge, quoteEnergyChallenge,
} from "../src/game/energy-challenge";
import { computeProductionContributionUnits } from "../src/game/energy-challenge-score";
import { equipCard, evaluateLoadout, patchSlot, toggleSlot } from "../src/automation/engine";
import type { ProtocolCard } from "../src/data/protocol-cards";

function eligible(): GameState {
  const state = createInitialState(0x12345678, 0x13579);
  state.lifetime.metal = big(1e8);
  return state;
}
function entered(): GameState {
  const state = eligible();
  const result = enterEnergyChallenge(state, quoteEnergyChallenge(state, "enter"));
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function funded(state: GameState, amount = 1e10): GameState {
  return withPlanet(state, { resources: { metal: big(amount), crystal: big(amount), deuterium: big(amount) } });
}
/** Score is explicitly synthetic; all four construction proofs come from actual paid jobs. */
function ready(): GameState {
  let state = funded(entered());
  for (const id of ENERGY_CHALLENGE_BUILDINGS) {
    const paid = enqueue(state, id, "manual");
    expect(paid.ok, paid.reason).toBe(true);
    state = advanceBuild(paid.state, activePlanet(paid.state).buildQueue[0]!.remainingSeconds, false);
  }
  return { ...state, lifetime: { ...state.lifetime, metal: big(1e8) }, energyChallenge: {
    ...state.energyChallenge, active: { ...state.energyChallenge.active!, scoreUnits: ENERGY_CHALLENGE_TARGET_UNITS },
  } };
}
function card(action: ProtocolCard["action"], enabled = true): ProtocolCard {
  return { id: "auto_prestige", enabled, trigger: { kind: "interval", seconds: 1 }, conditions: [], action };
}

it("refuses zero-gain entry and stale/replayed quote identities without changing input", () => {
  const fresh = createInitialState(1, 2);
  expect(enterEnergyChallenge(fresh, quoteEnergyChallenge(fresh, "enter")).state).toBe(fresh);
  const state = eligible(), quote = quoteEnergyChallenge(state, "enter");
  expect(Object.isFrozen(quote)).toBe(true);
  expect(Object.isFrozen(quote.expected)).toBe(true);
  expect(enterEnergyChallenge({ ...state }, quote).ok).toBe(false);
  expect(enterEnergyChallenge({ ...state, universe: { ...state.universe, seed: 5 } }, quote).ok).toBe(false);
  const first = enterEnergyChallenge(state, quote);
  expect(first.ok).toBe(true);
  expect(enterEnergyChallenge(state, quote).ok).toBe(false);
  expect(enterEnergyChallenge(first.state, quote).state).toBe(first.state);
});

it("entry exactly follows ordinary reset, binds the new mother, and only disables prestige actions", () => {
  const state = eligible();
  state.planets.push(createPlanet("colony"));
  state.activePlanetId = "colony";
  state.protocols.slots[0]!.card = card({ kind: "prestige", minGain: 9 });
  state.protocols.slots[1]!.card = card({ kind: "collect" });
  state.protocols.slots[10]!.card = card({ kind: "prestige", minGain: 13 });
  const ordinary = evaluatePrestige(state).next;
  const quote = quoteEnergyChallenge(state, "enter");
  expect(quote.disabledPrestigeSlots).toEqual([0, 10]);
  const result = enterEnergyChallenge(state, quote).state;
  const active = result.energyChallenge.active!;
  expect(active.homeworldId).toBe(HOMEWORLD_ID);
  expect(active.entryJobFloor).toBe(result.orders.nextJobId);
  expect(active.scoreUnits).toBe("0");
  expect(Object.values(active.proofs)).toEqual([null, null, null, null]);
  expect(result.activePlanetId).toBe(HOMEWORLD_ID);
  for (const index of [0, 10]) expect(result.protocols.slots[index]!.card).toEqual({ ...ordinary.protocols.slots[index]!.card!, enabled: false });
  expect(result.protocols.slots[1]).toEqual(ordinary.protocols.slots[1]);
  const expected = { ...ordinary, energyChallenge: result.energyChallenge, protocols: result.protocols };
  expect(result).toEqual(expected);
  expect(state.protocols.slots[0]!.card!.enabled).toBe(true);
});

it("doubles shared mine demand only; supply, fusion cost, satellite supply and inactive economy stay ordinary", () => {
  const state = entered();
  Object.assign(activePlanet(state).buildings, { metal_mine: 12, crystal_mine: 10, deuterium_synth: 9, solar_plant: 6, fusion_reactor: 3 });
  activePlanet(state).units.solar_satellite = 2;
  activePlanet(state).resources.deuterium = big(1000);
  const ordinary = { ...state, energyChallenge: createEnergyChallengeState() };
  const restricted = economy(state), normal = economy(ordinary);
  expect(restricted.demand).toBe(normal.demand * 2);
  expect(restricted.supply).toBe(normal.supply);
  expect(restricted.consumption.deuterium).toBe(normal.consumption.deuterium);
  expect(restricted.efficiency).toBeLessThan(normal.efficiency);
  const abandoned = abandonEnergyChallenge(state, quoteEnergyChallenge(state, "abandon")).state;
  expect(economy(abandoned)).toEqual(normal);
});

it("scores only canonical retained production, per planet; scrapes, payments and refunds contribute zero", () => {
  let state = entered();
  activePlanet(state).resources.metal = big(9999);
  activePlanet(state).resources.crystal = big(9999);
  const before = state;
  state = tick(state, 60, "offline");
  expect(state.energyChallenge.active!.scoreUnits).toBe("4000000000000");
  expect(activePlanet(state).resources.metal.toNumber()).toBe(10000);
  expect(activePlanet(state).resources.crystal.toNumber()).toBe(10000);
  const scraped = scrape(state);
  expect(scraped.energyChallenge.active!.scoreUnits).toBe(state.energyChallenge.active!.scoreUnits);
  const paid = enqueue(scraped, "metal_mine", "manual").state;
  expect(paid.energyChallenge.active!.scoreUnits).toBe(state.energyChallenge.active!.scoreUnits);
  const refunded = cancel(paid, 0).state;
  expect(refunded.energyChallenge.active!.scoreUnits).toBe(state.energyChallenge.active!.scoreUnits);
  expect(before.energyChallenge.active!.scoreUnits).toBe("0");
  let two = entered();
  two.planets.push(createPlanet("colony"));
  const after = tick(two, 0.1);
  let expected = 0n;
  for (const planet of two.planets) for (const [res, weight] of [["metal", 1], ["crystal", 3], ["deuterium", 10]] as const) {
    expected += computeProductionContributionUnits(planet.resources[res].toString(), after.planets.find(p => p.id === planet.id)!.resources[res].toString(), weight);
  }
  expect(after.energyChallenge.active!.scoreUnits).toBe(expected.toString());
});

it("records only new paid mother completions; queued, cancelled and pre-timer completion do not prove anything", () => {
  const state = entered();
  const paid = enqueue(state, "metal_mine", "manual").state;
  expect(paid.energyChallenge.active!.proofs.metal_mine).toBeNull();
  expect(cancel(paid, 0).state.energyChallenge.active!.proofs.metal_mine).toBeNull();
  expect(completeActive(paid).state.energyChallenge.active!.proofs.metal_mine).toBeNull();
  const timed = tick(paid, activePlanet(paid).buildQueue[0]!.remainingSeconds + 0.01);
  expect(timed.energyChallenge.active!.proofs.metal_mine?.jobId).toBe(activePlanet(paid).buildQueue[0]!.jobId);
  const colony = createPlanet("colony");
  let offworld = selectPlanet({ ...state, planets: [...state.planets, colony] }, colony.id);
  offworld = funded(offworld);
  offworld = enqueue(offworld, "metal_mine", "manual").state;
  offworld = advanceBuild(offworld, activePlanet(offworld).buildQueue[0]!.remainingSeconds, false);
  expect(offworld.energyChallenge.active!.proofs.metal_mine).toBeNull();
});

it("paid instant acceleration records the exact consumed job and charges dark matter once", () => {
  let state = entered();
  state.darkMatter = big(1e6);
  state = enqueue(state, "solar_plant", "manual").state;
  const job = activePlanet(state).buildQueue[0]!;
  const result = speedUp(state, "build", "finish");
  expect(result.ok, result.reason).toBe(true);
  expect(result.state.darkMatter.lt(state.darkMatter)).toBe(true);
  expect(result.state.energyChallenge.active!.proofs.solar_plant).toMatchObject({ jobId: job.jobId, targetLevel: job.targetLevel, taskId: null, source: "manual" });
  expect(result.state.energyChallenge.active!.proofs.solar_plant!.paid.metal).toBe(job.paid.metal.toString());
});

it("abandonment is an exact economic no-op, clears proof/score, and retry requires another legal curve", () => {
  let state = entered();
  state = enqueue(state, "metal_mine", "manual").state;
  state = tick(state, 0.1);
  const quote = quoteEnergyChallenge(state, "abandon");
  const result = abandonEnergyChallenge(state, quote);
  expect(result.ok).toBe(true);
  expect(result.state).toEqual({ ...state, energyChallenge: { ...state.energyChallenge, active: null } });
  expect(result.state.planets).toBe(state.planets);
  expect(result.state.orders).toBe(state.orders);
  expect(result.state.research).toBe(state.research);
  expect(enterEnergyChallenge(result.state, quoteEnergyChallenge(result.state, "enter")).ok).toBe(false);
  expect(abandonEnergyChallenge(state, quote).ok).toBe(false);
  const retryReady = { ...result.state, lifetime: { ...result.state.lifetime, metal: big(1e8) } };
  const retry = enterEnergyChallenge(retryReady, quoteEnergyChallenge(retryReady, "enter"));
  expect(retry.ok).toBe(true);
  expect(retry.state.energyChallenge.active!.attemptId).toBe(state.energyChallenge.nextAttemptId);
  expect(retry.state.energyChallenge.active!.scoreUnits).toBe("0");
});

it("requires full score, four proofs, live mother levels and ordinary curve legality", () => {
  const active = entered();
  active.energyChallenge.active!.scoreUnits = ENERGY_CHALLENGE_TARGET_UNITS;
  active.lifetime.metal = big(1e8);
  for (const id of ENERGY_CHALLENGE_BUILDINGS) activePlanet(active).buildings[id] = 1;
  expect(energyChallengeStatus(active).canFinish).toBe(false);
  const full = ready();
  expect(energyChallengeStatus(full).canFinish).toBe(true);
  const lower = withPlanet(full, { planet: { ...activePlanet(full), buildings: { ...activePlanet(full).buildings, solar_plant: 0 } } });
  expect(energyChallengeStatus(lower).canFinish).toBe(false);
  const noCurve = { ...full, lifetime: { metal: big(0), crystal: big(0), deuterium: big(0) } };
  expect(energyChallengeStatus(noCurve).canFinish).toBe(false);
  expect(evaluatePrestige(full).next).toBe(full);
  expect(prestige(full)).toBe(full);
  const tinyShort = { ...full, energyChallenge: { ...full.energyChallenge, active: { ...full.energyChallenge.active!, scoreUnits: "999999999999999999" } } };
  expect(energyChallengeStatus(tinyShort).canFinish).toBe(false);
});

it("finishes once into a coherent receipt, retains it over ordinary resets and pays for a real third build/research", () => {
  const state = ready(), quote = quoteEnergyChallenge(state, "finish");
  const result = finishEnergyChallenge(state, quote);
  expect(result.ok, result.reason).toBe(true);
  expect(finishEnergyChallenge(state, quote).ok).toBe(false);
  expect(result.state.energyChallenge.active).toBeNull();
  expect(result.state.energyChallenge.completion?.attempt).toEqual(state.energyChallenge.active);
  expect(result.state.stats.launches).toBe(state.stats.launches + 1);
  expect(queueCapacity(result.state)).toBe(3);
  expect(researchCapacity(result.state)).toBe(3);
  expect(quoteEnergyChallenge(result.state, "enter").ok).toBe(false);
  let build = result.state;
  for (let i = 0; i < 3; i++) {
    const before = activePlanet(build).resources.metal;
    const paid = enqueue(build, "metal_mine", "manual");
    expect(paid.ok, paid.reason).toBe(true);
    expect(activePlanet(paid.state).resources.metal.lt(before)).toBe(true);
    build = paid.state;
  }
  expect(activePlanet(build).buildQueue).toHaveLength(3);
  expect(enqueue(build, "solar_plant", "manual").ok).toBe(false);
  let research = funded(result.state);
  activePlanet(research).buildings.research_lab = 1;
  for (let i = 0; i < 3; i++) {
    const before = activePlanet(research).resources.crystal;
    const paid = enqueueResearch(research, "energy_tech", "manual");
    expect(paid.ok, paid.reason).toBe(true);
    expect(activePlanet(paid.state).resources.crystal.lt(before)).toBe(true);
    research = paid.state;
  }
  expect(research.research.queue).toHaveLength(3);
  expect(enqueueResearch(research, "energy_tech", "manual").ok).toBe(false);
  const later = { ...result.state, lifetime: { ...result.state.lifetime, metal: big(1e8) } };
  expect(prestige(later).energyChallenge).toBe(result.state.energyChallenge);
  const damaged = { ...result.state, energyChallenge: { ...result.state.energyChallenge, completion: { ...result.state.energyChallenge.completion!, finish: { ...result.state.energyChallenge.completion!.finish, ordinaryGain: "0" } } } };
  expect(queueCapacity(damaged)).toBe(2);
});

it("active ordinary admissions stay at two, and legacy paid queue tails are never truncated", () => {
  let state = funded(entered());
  state = enqueue(state, "metal_mine", "manual").state;
  state = enqueue(state, "solar_plant", "manual").state;
  expect(enqueue(state, "crystal_mine", "manual").ok).toBe(false);
  const source = activePlanet(state).buildQueue[1]!;
  const tail = [2, 3, 4].map(i => ({ ...source, jobId: source.jobId + i - 1, building: "solar_plant" as const, targetLevel: i }));
  const legacy = { ...state, orders: { ...state.orders, nextJobId: source.jobId + 4 } };
  activePlanet(legacy).buildQueue.push(...tail);
  expect(activePlanet(legacy).buildQueue).toHaveLength(5);
  expect(enqueue(legacy, "crystal_mine", "manual").state).toBe(legacy);
  const advanced = advanceBuild(legacy, 1e6, true);
  expect(activePlanet(advanced).buildQueue).toHaveLength(0);
  expect(activePlanet(advanced).buildings.solar_plant).toBe(4);
});

it("all prestige enable/edit/execution paths are guarded while other actions run, then require manual re-enable", () => {
  const source = eligible();
  source.unlockedCards.push("auto_prestige");
  source.protocols.slots[0]!.card = card({ kind: "prestige", minGain: 1 });
  let state = enterEnergyChallenge(source, quoteEnergyChallenge(source, "enter")).state;
  expect(toggleSlot(state, 0, true)).toBe(state);
  expect(equipCard(state, 0, "auto_prestige").state).toBe(state);
  state = { ...state, lifetime: { ...state.lifetime, metal: big(1e8) } };
  const malicious = { ...state, protocols: { ...state.protocols, slots: state.protocols.slots.map((slot, i) => i === 0 ? { ...slot, card: { ...slot.card!, enabled: true } } : slot) } };
  expect(evaluateLoadout(malicious, 1).stats.launches).toBe(state.stats.launches);
  const collect = { ...state, protocols: { ...state.protocols, slots: state.protocols.slots.map((slot, i) => i === 0 ? { ...slot, card: card({ kind: "collect" }) } : slot) } };
  expect(patchSlot(collect, 0, "action.kind", "prestige")).toBe(collect);
  expect(activePlanet(evaluateLoadout(collect, 1)).resources.metal.gt(activePlanet(collect).resources.metal)).toBe(true);
  const abandoned = abandonEnergyChallenge(state, quoteEnergyChallenge(state, "abandon")).state;
  expect(abandoned.protocols.slots[0]!.card!.enabled).toBe(false);
  expect(toggleSlot(abandoned, 0, true).protocols.slots[0]!.card!.enabled).toBe(true);
});

it("formats exact units without rounding a near-target value up", () => {
  expect(energyChallengeScoreText("999999999999999999")).toBe("999999.999999999999");
  expect(energyChallengeScoreText(ENERGY_CHALLENGE_TARGET_UNITS)).toBe("1000000");
  expect(energyChallengeScoreText("1")).toBe("0.000000000001");
});


it("finite paid plans keep running and contribute only their consumed mother job", () => {
  let state = funded(entered(), 1e6);
  const created = createOrderTask(state, { kind: "building", planetId: HOMEWORLD_ID, building: "crystal_mine", targetLevel: 2,
    expectedNextTaskId: state.orders.nextTaskId, budget: { metal: "100000", crystal: "100000", deuterium: "0" } });
  expect(created.ok, created.reason).toBe(true);
  state = runDueOrderPass(created.state);
  const head = activePlanet(state).buildQueue[0]!;
  expect(head.source).toBe("plan");
  state = advanceBuild(state, head.remainingSeconds, false);
  expect(state.energyChallenge.active!.proofs.crystal_mine).toMatchObject({ jobId: head.jobId, taskId: head.taskId, source: "plan" });
  expect(state.orders.tasks[0]!.activeJob).toBeNull();
  const firstProof = state.energyChallenge.active!.proofs.crystal_mine;
  state = runDueOrderPass(state);
  state = advanceBuild(state, activePlanet(state).buildQueue[0]!.remainingSeconds, false);
  expect(state.orders.tasks[0]!.status).toBe("completed");
  expect(state.energyChallenge.active!.proofs.crystal_mine).toBe(firstProof);
});

it("terraformer and graviton retain actual supply gates rather than reading doubled mine demand", () => {
  const state = funded(entered());
  Object.assign(activePlanet(state).buildings, { solar_plant: 60, metal_mine: 100, research_lab: 12, nanite_factory: 1 });
  activePlanet(state).fieldsMax = 300;
  activePlanet(state).terraformerFields = { base: 300, grantedLevels: 0 };
  state.research.levels.energy_tech = 12;
  const normal = { ...state, energyChallenge: createEnergyChallengeState() };
  expect(economy(state).demand).toBe(economy(normal).demand * 2);
  expect(economy(state).efficiency).toBeLessThan(1);
  expect(economy(state).supply).toBe(economy(normal).supply);
  expect(canEnqueue(state, "terraformer").ok).toBe(true);
  expect(canEnqueueResearch(state, "graviton_tech").ok).toBe(true);
  expect(canEnqueue(state, "terraformer").cost).toEqual(canEnqueue(normal, "terraformer").cost);
});


it("refuses entry atomically with fewer than four remaining paid IDs and admits exactly four", () => {
  for (const remaining of [0, 1, 2, 3]) {
    const state = eligible();
    state.orders.nextJobId = Number.MAX_SAFE_INTEGER - remaining;
    const snapshot = JSON.stringify(state);
    const quote = quoteEnergyChallenge(state, "enter");
    expect(quote.ok).toBe(false);
    expect(quote.reason).toContain("编号");
    expect(enterEnergyChallenge(state, quote).state).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(evaluatePrestige(state).next).not.toBe(state);
  }
  const source = eligible();
  source.orders.nextJobId = Number.MAX_SAFE_INTEGER - 4;
  const entry = enterEnergyChallenge(source, quoteEnergyChallenge(source, "enter"));
  expect(entry.ok, entry.reason).toBe(true);
  let state = entry.state;
  for (const id of ENERGY_CHALLENGE_BUILDINGS) {
    const paid = enqueue(state, id, "manual");
    expect(paid.ok, paid.reason).toBe(true);
    state = advanceBuild(paid.state, activePlanet(paid.state).buildQueue[0]!.remainingSeconds, false);
  }
  expect(state.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
  expect(ENERGY_CHALLENGE_BUILDINGS.every(id => state.energyChallenge.active!.proofs[id] !== null)).toBe(true);
});
