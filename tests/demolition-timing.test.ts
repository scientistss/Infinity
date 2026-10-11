import { expectedFreshNpcWallet } from "./npc-wallet-expectations";
import { describe, expect, it } from "vitest";
import { catchUp } from "../src/core/offline";
import { commitDemolition, completeDemolition, quoteDemolition } from "../src/game/demolition";
import { MAX_DEMOLITION_SECONDS } from "../src/game/demolition-state";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyTickLog, tick } from "../src/game/logic";
import { createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { rich, stateWith } from "./helpers";

function paid(): GameState {
  const state = rich(stateWith({ metal_storage: 9, robotics_factory: 10, nanite_factory: 1, metal_mine: 10, solar_plant: 10 }), 1e7);
  state.research.levels.ion_tech = 25;
  const quote = quoteDemolition(state, "metal_storage"); expect(quote.ok, quote.reason).toBe(true);
  return commitDemolition(state, quote.quote!).state;
}
function runFrames(state: GameState, seconds: number, hz: number): GameState {
  for (let i = 0; i < seconds * hz; i++) state = tick(state, 1 / hz);
  return state;
}
function withoutNumericalIntegration(state: GameState, expectedNpcAge: number): unknown {
  const saved = serializeState(state);
  // Independently known adopted duration is checked before masking only numeric age.
  expect(Reflect.ownKeys(saved.npcEconomy).sort()).toEqual(["baseline", "model", "now", "sites"]);
  expect(saved.npcEconomy.model).toBe("npc-wallet-garrison-v1");
  expect(saved.npcEconomy.baseline).toEqual({ stock: [500, 250, 0], mark: 0 });
  expect(saved.npcEconomy.sites).toEqual({});
  expect(saved.npcBattles).toEqual({ model: "npc-battle-receipts-v1", reports: [] });
  expect(Math.abs(saved.npcEconomy.now - expectedNpcAge)).toBeLessThanOrEqual(1e-9);
  // These are accumulated numerical integration values, separately bounded below.
  return { ...saved, npcEconomy: { ...saved.npcEconomy, now: null }, totalTime: null, protocols: { ...saved.protocols, accumulator: null }, arcade: { ...saved.arcade, beaconAccumulator: null },
    planets: saved.planets.map(p => ({ ...p, resources: null })), lifetime: null };
}

describe("demolition actual event integration and persisted fractional timers", () => {
  it("log sink is observational and records exactly one own demolition event", () => {
    const initial = paid(), log = emptyTickLog(), withLog = tick(initial, 20, "live", log), withoutLog = tick(initial, 20);
    expect(serializeState(withLog)).toEqual(serializeState(withoutLog));
    expect(log.completedBuilds).toEqual([]);
    expect(log.completedDemolitions).toEqual([{ building: "metal_storage", fromLevel: 9, toLevel: 8, jobId: 1 }]);
    tick(withLog, 1, "live", log); expect(log.completedDemolitions).toHaveLength(1);
  });
  it("long ticks, realistic RAF rates and offline steps agree at the short task boundary", () => {
    const initial = paid(), longLog = emptyTickLog(), long = tick(initial, 20, "live", longLog);
    for (const hz of [30, 60, 120, 240]) {
      const short = runFrames(initial, 20, hz);
      expect(withoutNumericalIntegration(short, 20)).toEqual(withoutNumericalIntegration(long, 20));
      expect(Math.abs(short.totalTime.toNumber() - long.totalTime.toNumber())).toBeLessThan(1e-9);
      expect(Math.abs(short.protocols.accumulator - long.protocols.accumulator)).toBeLessThan(1e-9);
    }
    const offline = catchUp(initial, 20);
    expect(offline.state.npcEconomy).toEqual(expectedFreshNpcWallet(20));
    expect(activePlanet(offline.state).demolition).toBeNull(); expect(activePlanet(offline.state).buildings.metal_storage).toBe(8); expect(offline.completedBuilds).toEqual([]);
  });
  it("fractional partial reload uses saved total and remaining, not current accelerators or ion", () => {
    const initial = paid(), partial = runFrames(initial, 5, 120), before = activePlanet(partial).demolition!;
    const loaded = deserializeState(serializeState(partial))!;
    expect(activePlanet(loaded).demolition).toEqual(before);
    loaded.research.levels.ion_tech = 0; activePlanet(loaded).buildings.nanite_factory = 2; activePlanet(loaded).buildings.robotics_factory = 11;
    const next = tick(loaded, 1); expect(activePlanet(next).demolition!.totalSeconds).toBe(before.totalSeconds);
    expect(activePlanet(next).demolition!.remainingSeconds).toBeCloseTo(before.remainingSeconds - 1, 12);
  });
  it("large supported persisted timer advances under 60/120/240Hz within per-subtraction ULP bounds", () => {
    // Synthetic timer-domain fixture; not a claim this state was naturally quoted.
    const initial = paid(), total = MAX_DEMOLITION_SECONDS - 1;
    activePlanet(initial).demolition!.totalSeconds = total; activePlanet(initial).demolition!.remainingSeconds = total;
    const restored = deserializeState(serializeState(initial))!;
    for (const hz of [60, 120, 240]) {
      const seconds = 10, next = runFrames(restored, seconds, hz), remaining = activePlanet(next).demolition!.remainingSeconds;
      const ulp = 2 ** (Math.floor(Math.log2(total)) - 52);
      // Each frame is one subtraction; protocol boundaries can add at most one each.
      const subtractionCountBound = seconds * hz + seconds * 2 + 8;
      expect(remaining).toBeLessThan(total);
      expect(Math.abs((total - remaining) - seconds)).toBeLessThanOrEqual(subtractionCountBound * ulp / 2);
      expect(activePlanet(deserializeState(serializeState(next))!).demolition!.remainingSeconds).toBe(remaining);
    }
    const offline = catchUp(restored, 3600).state;
    expect(activePlanet(offline).demolition!.remainingSeconds).toBe(total - 3600);
  });
  it("a corrupt due job blocks only itself while another planet/research/production continue", () => {
    const initial = paid(), job = activePlanet(initial).demolition!;
    job.remainingSeconds = 0; job.fromLevel = 8; // Mismatch against actual level9.
    const colony = createPlanet("colony", { galaxy: 1, system: 2, position: 8 }); colony.buildings.metal_storage = 1;
    colony.resources = { metal: big(1e4), crystal: big(1e4), deuterium: big(1e4) };
    const state = { ...initial, planets: [...initial.planets, colony] };
    const q = quoteDemolition(selectPlanet(state, "colony"), "metal_storage"); expect(q.ok).toBe(true);
    const both = commitDemolition(selectPlanet(state, "colony"), q.quote!).state;
    const result = tick(both, 5);
    expect(result.planets[0]!.demolition).not.toBeNull(); expect(result.planets[0]!.buildings.metal_storage).toBe(9);
    expect(result.planets[1]!.demolition).toBeNull(); expect(result.planets[1]!.buildings.metal_storage).toBe(0);
    expect(result.totalTime.sub(both.totalTime).toNumber()).toBe(5);
  });
});

// Completion identity must not wait for an extra visual RAF just for subtraction dust.
describe("minimum demolition completion boundary", () => {
  for (const hz of [30, 60, 120, 240]) it(`one second finishes on frame ${hz} at ${hz}Hz`, () => {
    const state = rich(stateWith({ metal_storage: 1, robotics_factory: 10, nanite_factory: 1 }), 1e6);
    const quote = quoteDemolition(state, "metal_storage").quote!; expect(quote.totalSeconds).toBe(1);
    const start = commitDemolition(state, quote).state;
    let current = start;
    for (let i = 0; i < hz - 1; i++) current = tick(current, 1 / hz);
    expect(activePlanet(current).demolition).not.toBeNull();
    current = tick(current, 1 / hz);
    expect(activePlanet(current).demolition).toBeNull(); expect(activePlanet(current).buildings.metal_storage).toBe(0);
  });
});


describe("demolition bounded absolute engine completion tolerance", () => {
  for (const dt of [0, -1, Number.NaN, Infinity]) it(`never rounds a pending timer on invalid/nonpositive tick ${dt}`, () => {
    const state = paid(), job = activePlanet(state).demolition!;
    job.remainingSeconds = 5e-10;
    const log = emptyTickLog(), result = tick(state, dt, "live", log);
    expect(activePlanet(result).demolition!.remainingSeconds).toBe(5e-10);
    expect(log.completedDemolitions).toBeUndefined();
  });
  it("rounds only inside the absolute threshold after a real positive step", () => {
    for (const [tail, done] of [[5e-10, true], [1.5e-9, false]] as const) {
      const state = paid(), job = activePlanet(state).demolition!;
      job.remainingSeconds = 0.1 + tail;
      const result = tick(state, 0.1);
      expect(activePlanet(result).demolition === null).toBe(done);
      if (!done) expect(activePlanet(result).demolition!.remainingSeconds).toBeGreaterThan(1e-9);
    }
  });
  it("reader and external completion never consume positive dust; a large total creates no relative tolerance", () => {
    const state = paid(), job = activePlanet(state).demolition!;
    job.totalSeconds = MAX_DEMOLITION_SECONDS - 1; job.remainingSeconds = 5e-10;
    const restored = deserializeState(serializeState(state))!;
    expect(activePlanet(restored).demolition!.remainingSeconds).toBe(5e-10);
    expect(completeDemolition(restored, { kind: "demolition", planetId: state.activePlanetId, jobId: job.jobId, taskId: null }).state).toBe(restored);
    job.remainingSeconds = 1e-5;
    const progressed = tick(state, 1e-6);
    expect(activePlanet(progressed).demolition!.remainingSeconds).toBeCloseTo(9e-6, 16);
    expect(activePlanet(progressed).buildings.metal_storage).toBe(9);
  });
});
