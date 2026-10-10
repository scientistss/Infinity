import { describe, expect, it } from "vitest";
import { armAutoRunner, equipCard, stopAutoRunner } from "../src/automation/engine";
import { grantRun } from "../src/game/arcade";
import { serializeState } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import { ringAutoInput, ringAutoView, ringBetSummary } from "../src/ui/ring-auto-model";

function ready() {
  let state = createInitialState(20261010);
  state.research.levels.astrophysics = 1;
  state.unlockedCards.push("auto_runner");
  state.arcade.stats.manualRuns = 10;
  state = equipCard(state, 0, "auto_runner").state;
  state = grantRun(state, "bonus").state;
  return grantRun(state, "bonus").state;
}

describe("bounded ring read-only controls model", () => {
  it("starts off with no implied authorization and explains prerequisites", () => {
    const fresh = createInitialState();
    expect(ringAutoView(fresh).status).toContain("默认未授权");
    expect(ringAutoView(fresh).prerequisite).toContain("天体物理学 1");
    fresh.research.levels.astrophysics = 1;
    expect(ringAutoView(fresh).prerequisite).toContain("手动开奖 10 次");
    fresh.unlockedCards.push("auto_runner");
    expect(ringAutoView(fresh).prerequisite).toContain("装配");
  });
  it("only offers unlocked, open auto-runner runLights slots", () => {
    const state = ready();
    state.protocols.slots[2] = structuredClone(state.protocols.slots[0]!);
    expect(ringAutoView(state).slots.map(slot => slot.index)).toEqual([0]);
    state.protocols.slots[0]!.card!.action = {kind: "setBet", symbol: "metal", units: 1};
    expect(ringAutoView(state).slots).toEqual([]);
  });
  it.each(["0", "-1", "1.5", "3", "", "Infinity", "1e1"])("rejects count %s", count => {
    expect(ringAutoInput(ready(), "0", count, "0").valid).toBe(false);
  });
  it.each(["-1", "NaN", "Infinity", "", "<script>", "1e999999999999999999999999999999999999"])("rejects cap %s", cap => {
    expect(ringAutoInput(ready(), "0", "1", cap).valid).toBe(false);
  });
  it.each(["0", "0.5", "1000", "1e9"])("allows explicit nonnegative cap %s without arming", cap => {
    const state = ready(), before = serializeState(state);
    expect(ringAutoInput(state, "0", "2", cap).valid).toBe(true);
    expect(serializeState(state)).toEqual(before);
  });
  it("never treats absent or closed slot as selected", () => {
    for (const slot of ["", "-1", "2", "nonsense"]) expect(ringAutoInput(ready(), slot, "1", "0").valid).toBe(false);
  });
  it("shows frozen source/bets separately from edited current selection", () => {
    let state = ready();
    state = armAutoRunner(state, 0, {planetId: state.activePlanetId, count: 2, maxDeuterium: "0"}).state;
    const colony = createPlanet("other"); colony.name = "第二星球";
    state = {...state, planets: [...state.planets, colony], activePlanetId: colony.id};
    const before = serializeState(state), model = ringAutoView(state);
    expect(model.source).toContain("第二星球");
    expect(model.frozen).toContain(state.planets[0]!.name);
    expect(model.progress).toContain("0/2");
    expect(model.armed).toBe(true);
    expect(ringAutoInput(state, "0", "1", "1000").valid).toBe(false);
    expect(serializeState(state)).toEqual(before);
    state = stopAutoRunner(state);
    expect(ringAutoView(state).stopReason).toContain("停止原因");
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(true);
  });
  it("hides all unrevealed outcomes from the batch model", () => {
    const state = ready(), before = ringAutoView(state);
    state.arcade.runs[0]!.outcome.main.tile = (state.arcade.runs[0]!.outcome.main.tile + 1) % 24;
    expect(ringAutoView(state)).toEqual(before);
  });
  it("summarizes only positive bets and handles zero budget transparently", () => {
    expect(ringBetSummary({metal:0, crystal:0, deuterium:0, drifter:0})).toContain("扣费 0");
    expect(ringBetSummary({metal:1, crystal:0, deuterium:2, drifter:0})).toBe("金属陨石 1 注、重氢云 2 注");
  });
});
