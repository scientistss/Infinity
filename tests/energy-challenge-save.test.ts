import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { createEnergyChallengeState, emptyEnergyChallengeProofs, ENERGY_CHALLENGE_BUILDINGS, ENERGY_CHALLENGE_TARGET_UNITS,
  type EnergyChallengeAttempt, type EnergyChallengePaidProof } from "../src/game/energy-challenge-state";
import { readEnergyChallengeState, validateEnergyChallengeReferences } from "../src/game/energy-challenge-save";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

/** Deliberate coherent shape fixtures, not a claim of production-earned challenge proof. */
function active(): GameState {
  const state = createInitialState(29, 29);
  state.totalTime = big(100);
  state.hasPrestiged = true;
  state.stats.launches = 1;
  state.orders.nextJobId = 6;
  state.energyChallenge = { ...createEnergyChallengeState(), nextAttemptId: 2, active: {
    attemptId: 1, universeSeed: 29, homeworldId: "homeworld", entryJobFloor: 1,
    enteredAt: "10", scoreUnits: "999999999999999999", proofs: emptyEnergyChallengeProofs(),
  } };
  return state;
}
function proof(jobId: number): EnergyChallengePaidProof {
  return { jobId, targetLevel: 1, source: "manual", taskId: null, paid: { metal: "60", crystal: "15", deuterium: "0" } };
}
function completed(): GameState {
  const state = active(), attempt = state.energyChallenge.active!;
  attempt.scoreUnits = ENERGY_CHALLENGE_TARGET_UNITS;
  for (const [index, building] of ENERGY_CHALLENGE_BUILDINGS.entries()) attempt.proofs[building] = proof(index + 1);
  state.energyChallenge.active = null;
  state.stats.launches = 2;
  state.terraformerGrantJobFloor = 5;
  state.energyChallenge.completion = { attempt, finish: { jobCeiling: 5, finishedAt: "50", ordinaryGain: "1",
    homeLevels: { metal_mine: 1, crystal_mine: 1, deuterium_synth: 1, solar_plant: 1 } } };
  return state;
}
function attemptOf(state: GameState): EnergyChallengeAttempt {
  return state.energyChallenge.active ?? state.energyChallenge.completion!.attempt;
}

describe("r16 strict bounded challenge persistence", () => {
  it("starts with mandatory inactive zero-reward state", () => {
    const state = createInitialState(29, 29), file = importSave(exportSave(state, 100));
    expect(file.revision).toBe(16);
    expect(file.state.energyChallenge).toEqual({ model: "energy-tightening-v1", nextAttemptId: 1, active: null, completion: null });
    const missing: any = JSON.parse(exportSave(state)); delete missing.state.energyChallenge;
    expect(() => importSave(JSON.stringify(missing))).toThrow(/挑战/);
  });
  it.each([createInitialState, active, completed])("copies independent bounded records and roundtrips repeatedly", factory => {
    const state = factory(), original = exportSave(state, 100), baseline = serializeState(state);
    let file = importSave(original);
    for (let round = 0; round < 5; round++) {
      const next = importSave(JSON.stringify(file));
      expect(next).toEqual(file); expect(serializeState(deserializeState(next.state))).toEqual(next.state);
      file = next;
    }
    const copy = serializeState(state);
    copy.energyChallenge.nextAttemptId += 1;
    expect(serializeState(state)).toEqual(baseline);
    expect(exportSave(state, 100)).toBe(original);
  });
  it("clones nested proof money, finish snapshots and attempt records", () => {
    const state = completed(), copy = serializeState(state);
    copy.energyChallenge.completion!.attempt.proofs.metal_mine!.paid.metal = "999";
    copy.energyChallenge.completion!.finish.homeLevels.metal_mine = 900;
    expect(state.energyChallenge.completion!.attempt.proofs.metal_mine!.paid.metal).toBe("60");
    expect(state.energyChallenge.completion!.finish.homeLevels.metal_mine).toBe(1);
  });
  it.each(["", "00", "01", "1.0", "1e18", "-1", "+1", "1000000000000000001", 1, null])
  ("rejects noncanonical or out-of-range score %j on read and write", score => {
    const state = active(); (attemptOf(state) as any).scoreUnits = score;
    expect(() => serializeState(state)).toThrow(/挑战/);
    const raw = serializeState(active()); (raw.energyChallenge.active as any).scoreUnits = score;
    expect(() => deserializeState(raw)).toThrow(/挑战/);
  });
  it.each([
    (state: any) => { delete state.energyChallenge.completion; },
    (state: any) => { state.energyChallenge.completed = true; },
    (state: any) => { state.energyChallenge.model = "energy-tightening-v2"; },
    (state: any) => { state.energyChallenge.nextAttemptId = 1; },
    (state: any) => { state.energyChallenge.active.entryJobFloor = 2; },
    (state: any) => { state.hasPrestiged = false; },
    (state: any) => { state.stats.launches = 0; },
    (state: any) => { state.energyChallenge.active.universeSeed = 30; },
    (state: any) => { state.energyChallenge.active.homeworldId = "colony"; },
    (state: any) => { state.energyChallenge.active.enteredAt = "101"; },
    (state: any) => { state.energyChallenge.active.enteredAt = "10.0"; },
    (state: any) => { state.energyChallenge.active.proofs = []; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { completed: true }; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { ...proof(1), paid: { metal: "0", crystal: "0", deuterium: "0" } }; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { ...proof(1), taskId: 1 }; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { ...proof(1), source: "plan" }; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = proof(6); },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = proof(1); state.energyChallenge.active.proofs.solar_plant = proof(1); },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { ...proof(1), paid: { metal: "60.0", crystal: "15", deuterium: "0" } }; },
    (state: any) => { state.energyChallenge.active.proofs.metal_mine = { ...proof(1), targetLevel: 0 }; },
    (state: any) => { state.energyChallenge.active.proofs.solar_plant = undefined; },
  ])("refuses malformed current active data without mutating source", mutate => {
    const state = active(); mutate(state); const before = JSON.stringify(state);
    expect(() => serializeState(state)).toThrow(); expect(JSON.stringify(state)).toBe(before);
    const raw = serializeState(active()); mutate(raw); const beforeRead = JSON.stringify(raw);
    expect(() => deserializeState(raw)).toThrow(); expect(JSON.stringify(raw)).toBe(beforeRead);
  });
  it.each([
    (state: any) => { state.energyChallenge.active = active().energyChallenge.active; },
    (state: any) => { state.energyChallenge.completion.attempt.scoreUnits = "999999999999999999"; },
    (state: any) => { state.energyChallenge.completion.attempt.proofs.solar_plant = null; },
    (state: any) => { state.energyChallenge.completion.finish.jobCeiling = 4; },
    (state: any) => { state.energyChallenge.completion.finish.jobCeiling = 7; },
    (state: any) => { state.terraformerGrantJobFloor = 4; },
    (state: any) => { state.hasPrestiged = false; },
    (state: any) => { state.stats.launches = 1; },
    (state: any) => { state.energyChallenge.completion.finish.finishedAt = "9"; },
    (state: any) => { state.energyChallenge.completion.finish.finishedAt = "101"; },
    (state: any) => { state.energyChallenge.completion.finish.ordinaryGain = "0"; },
    (state: any) => { state.energyChallenge.completion.finish.ordinaryGain = "1.1"; },
    (state: any) => { state.energyChallenge.completion.finish.homeLevels.solar_plant = 0; },
    (state: any) => { state.energyChallenge.completion.reward = 1; },
  ])("never derives a completed reward from partial or contradictory data", mutate => {
    const state = completed(); mutate(state);
    expect(() => serializeState(state)).toThrow();
    const raw = serializeState(completed()); mutate(raw);
    expect(() => deserializeState(raw)).toThrow();
  });
  it("rejects proof IDs still in real paid queues and bounds historical plan IDs", () => {
    const state = active(); attemptOf(state).proofs.metal_mine = proof(1);
    state.planets[0].buildQueue.push({ building: "metal_mine", targetLevel: 1, jobId: 1, taskId: null,
      source: "manual", paid: { metal: big(60), crystal: big(15), deuterium: big(0) }, totalSeconds: 1, remainingSeconds: 1 });
    expect(() => validateEnergyChallengeReferences(state)).toThrow();
    state.planets[0].buildQueue = [];
    attemptOf(state).proofs.metal_mine = { ...proof(1), source: "plan", taskId: 1 };
    expect(() => validateEnergyChallengeReferences(state)).toThrow();
    state.orders.nextTaskId = 2;
    expect(() => validateEnergyChallengeReferences(state)).not.toThrow();
  });
  it("allows completion receipts after later ordinary job floors and lower home levels", () => {
    const state = completed(); state.terraformerGrantJobFloor = state.orders.nextJobId;
    for (const building of ENERGY_CHALLENGE_BUILDINGS) state.planets[0].buildings[building] = 0;
    expect(() => serializeState(state)).not.toThrow();
  });
  it("retains canonical manual paid proof amounts beyond finite-plan ledger limits", () => {
    const state = active(); attemptOf(state).proofs.metal_mine = { ...proof(1), paid: { metal: "1e+220", crystal: "0", deuterium: "0" } };
    const file = importSave(exportSave(state));
    expect(file.state.energyChallenge.active!.proofs.metal_mine!.paid.metal).toBe("1e+220");
  });
  it("rejects unknown, inherited, hidden, accessor and array authority before projection", () => {
    for (const mutate of [
      (state: GameState) => { Object.setPrototypeOf(state.energyChallenge, { extra: true }); },
      (state: GameState) => { Object.defineProperty(state.energyChallenge, "hidden", { value: 1 }); },
      (state: GameState) => { Object.defineProperty(state, "energyChallenge", { value: state.energyChallenge, enumerable: false }); },
      (state: GameState) => { Object.setPrototypeOf(attemptOf(state).proofs, { extra: true }); },
      (state: GameState) => { (state as any).ignored = { energyChallenge: createEnergyChallengeState() }; },
      (state: GameState) => { (state as any).ignored = { model: "energy-tightening-v1" }; },
      (state: GameState) => { (state.energyChallenge as any).active = []; },
    ]) {
      const state = active(); mutate(state); expect(() => serializeState(state)).toThrow();
    }
    const state = active(); let calls = 0;
    Object.defineProperty(state.energyChallenge.active!, "scoreUnits", { enumerable: true, get() { calls++; return "0"; } });
    expect(() => serializeState(state)).toThrow(); expect(calls).toBe(0);
  });
  it("rejects forged model/arrays directly while retaining legitimate zero and goal units", () => {
    for (const scoreUnits of ["0", ENERGY_CHALLENGE_TARGET_UNITS]) {
      const state = active(); attemptOf(state).scoreUnits = scoreUnits;
      expect(readEnergyChallengeState(state.energyChallenge).active?.scoreUnits).toBe(scoreUnits);
    }
    expect(() => readEnergyChallengeState(Object.assign([], createEnergyChallengeState()))).toThrow();
    expect(() => readEnergyChallengeState({ ...createEnergyChallengeState(), active: undefined })).toThrow();
  });
});
