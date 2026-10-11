import { afterEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, nextFleetEvent, resolveFleetArrivals, sendFleet } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { NpcSettlementError, nextNpcAttackEvent, resolveNpcAttackArrivals } from "../src/game/npc-attack";
import * as research from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const TARGET = { galaxy: 1, system: 56, position: 6 };
function ready(): GameState {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  Object.assign(planet.buildings, { shipyard: 2, research_lab: 4 });
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000 });
  Object.assign(state.research.levels, { combustion_drive: 2, computer_tech: 10, weapons_tech: 1 });
  state.protocols.slots.forEach(slot => { slot.card = null; });
  return state;
}
function launch(state = ready()): GameState {
  const result = sendFleet(state, { mission: "attack", target: TARGET, ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function remaining(state: GameState, values: number[]): GameState {
  return { ...state, fleets: state.fleets.map((fleet, index) => ({ ...fleet, remaining: values[index], elapsed: fleet.duration - values[index] })) };
}
function studying(state: GameState, seconds: number): GameState {
  const queued = research.enqueueResearch(state, "weapons_tech", "manual");
  expect(queued.ok, queued.reason).toBe(true);
  return research.withResearchRemaining(queued.state, seconds);
}
const reload = (state: GameState) => deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
afterEach(() => { vi.restoreAllMocks(); });

describe("precise NPC event identity and causal ordering", () => {
  it.each([[.5e-9, 2e-9], [1e-9, 1.5e-9], [2e-9, 2.5e-9]])("keeps %s and %s distinct even when the earlier fleet has the larger ID", (early, late) => {
    const state = remaining(launch(launch()), [late, early]), before = serializeState(state);
    expect(resolveFleetArrivals(state)).toBe(state);
    const next = tick(state, late);
    expect(next.npcBattles.reports.map(report => report.fleetId)).toEqual([2, 1]);
    expect(next.npcBattles.reports[0].battle.defenderBefore).toEqual({ light_fighter: 4 });
    expect(next.npcBattles.reports[1].battle.defenderBefore).toEqual({});
    expect(next.npcBattles.reports[1].battle.rounds).toEqual([]);
    expect(next.npcBattles.reports[1].stockBefore[0]).toBeLessThan(next.npcBattles.reports[0].stockBefore[0]);
    expect(serializeState(tick(reload(state), late))).toEqual(serializeState(next));
    expect(serializeState(state)).toEqual(before);
  });
  it("uses ascending full safe fleet IDs only for actual exact ties", () => {
    const state = remaining(launch(launch()), [2e-9, 2e-9]);
    const reversed = { ...state, fleets: state.fleets.slice().reverse() };
    expect(tick(reversed, 2e-9).npcBattles.reports.map(report => report.fleetId)).toEqual([1, 2]);
  });
  it("refuses direct helper overshoot instead of merging sub-EPS attack arrivals", () => {
    const state = remaining(launch(launch()), [2e-9, .5e-9]), before = serializeState(state);
    expect(() => advanceFleets(state, 2e-9)).toThrow("事件边界");
    expect(serializeState(state)).toEqual(before);
    expect(advanceFleets(state, .5e-9).npcBattles.reports.map(report => report.fleetId)).toEqual([2]);
  });
  it("does not let the legacy EPS resolver pick up an attack even at exact zero", () => {
    const state = remaining(launch(), [0]);
    expect(resolveFleetArrivals(state)).toBe(state);
    expect(resolveNpcAttackArrivals(state).npcBattles.reports).toHaveLength(1);
  });
  it.each([0, -1, NaN, Infinity])("does not add attack settlement to tick(%s)", dt => {
    const state = remaining(launch(), [0]);
    expect(tick(state, dt).npcBattles.reports).toHaveLength(0);
    expect(tick(state, dt).fleets[0].npcAttack?.phase.kind).toBe("outbound");
  });
});

describe("narrow exact-zero arrival research view", () => {
  it.each([[0, 2], [Number.MIN_VALUE, 1], [.5e-9, 1], [1e-9, 1], [-.5e-9, 1]])("entry head remaining %s observes weapons %s without paying or finishing research", (seconds, weapons) => {
    const state = remaining(studying(launch(), seconds), [0]);
    const before = state.research, wallet = activePlanet(state).resources;
    const next = resolveNpcAttackArrivals(state);
    expect(next.npcBattles.reports[0].attackerTech.weapons).toBe(weapons);
    expect(next.research).toBe(before);
    expect(activePlanet(next).resources).toBe(wallet);
  });
  it("has identical positive-tick entry semantics after serialization, including a paid zero head", () => {
    const state = remaining(studying(launch(), 0), [0]);
    const next = tick(state, .5e-9), loaded = tick(reload(state), .5e-9);
    expect(next.npcBattles.reports[0].attackerTech.weapons).toBe(2);
    expect(next.research.queue).toHaveLength(1);
    expect(next.research.levels.weapons_tech).toBe(1);
    expect(serializeState(next)).toEqual(serializeState(loaded));
  });
  it("honors the completed level when the old positive-segment EPS research path has already completed it", () => {
    const state = remaining(studying(launch(), 2e-9), [1e-9]);
    const next = tick(state, 1e-9);
    expect(next.research.levels.weapons_tech).toBe(2);
    expect(next.npcBattles.reports[0].attackerTech.weapons).toBe(2);
  });
  it("zero-time research completion in the necessary tail makes progress before the later precise attack", () => {
    const state = remaining(studying(launch(), 0), [.5e-9]);
    const next = tick(state, .5e-9);
    expect(next.research.queue).toHaveLength(0);
    expect(next.npcBattles.reports[0].attackerTech.weapons).toBe(2);
    expect(next.npcEconomy.now).toBe(.5e-9);
    expect(next.totalTime.toNumber()).toBe(.5e-9);
  });
});

describe("necessary EPS tail progress and controlled candidate failures", () => {
  it("adopts sub-EPS progress only when an actual attack event is inside the remainder", () => {
    const noAttack = ready();
    expect(tick(noAttack, .5e-9).npcEconomy).toBe(noAttack.npcEconomy);
    const beyondTail = remaining(launch(), [2e-9]);
    expect(tick(beyondTail, .5e-9).npcEconomy).toBe(beyondTail.npcEconomy);
    const due = remaining(launch(), [.5e-9]);
    const next = tick(due, .5e-9);
    expect(next.npcEconomy.now).toBe(.5e-9);
    expect(next.npcBattles.reports).toHaveLength(1);
  });
  it("excludes blocked docks from both event schedulers and does not consume an otherwise discarded tail", () => {
    const atTarget = advanceFleets(launch(), nextFleetEvent(launch()));
    activePlanet(atTarget).resources.metal = big("1e400");
    const blocked = advanceFleets(atTarget, nextFleetEvent(atTarget));
    expect(nextNpcAttackEvent(blocked)).toBe(Infinity);
    expect(nextFleetEvent(blocked)).toBe(Infinity);
    const next = tick(blocked, .5e-9);
    expect(next.npcEconomy).toBe(blocked.npcEconomy);
    expect(next.fleets).toBe(blocked.fleets);
  });
  it("stops a zero-step/no-change head instead of spinning or adopting a partial candidate", () => {
    const state = remaining(studying(launch(), 0), [.5e-9]), before = serializeState(state);
    vi.spyOn(research, "completeActiveResearch").mockImplementation(current => ({ state: current, completed: null }));
    expect(() => tick(state, .5e-9)).toThrow(NpcSettlementError);
    expect(serializeState(state)).toEqual(before);
  });
  it("wraps an inconsistent paid site failure with its cause and leaves the full source unchanged", () => {
    const source = remaining(launch(), [0]);
    const state = { ...source, npcEconomy: { ...source.npcEconomy, sites: {} } };
    const before = JSON.stringify(state);
    let failure: unknown;
    try { tick(state, 1); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(NpcSettlementError);
    expect((failure as NpcSettlementError).cause).toBeInstanceOf(Error);
    expect(JSON.stringify(state)).toBe(before);
  });
});
