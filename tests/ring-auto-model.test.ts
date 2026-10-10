import { describe, expect, it } from "vitest";
import { armAutoRunner, clearSlot, equipCard, refreshUnlocks, stopAutoRunner, toggleSlot } from "../src/automation/engine";
import { ARCADE } from "../src/data/arcade";
import { grantRun } from "../src/game/arcade";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import { ringAutoInput, ringAutoView, ringBetSummary } from "../src/ui/ring-auto-model";

function ready() {
  let state = createInitialState(20261010);
  state.research.levels.astrophysics = 1;
  state.arcade.stats.manualRuns = ARCADE.autoCardManualRuns;
  state.arcade.stats.runs = ARCADE.autoCardManualRuns;
  state.arcade.stats.hits.empty = ARCADE.autoCardManualRuns;
  state = equipCard(refreshUnlocks(state), 0, "auto_runner").state;
  state = grantRun(state, "bonus").state;
  return grantRun(state, "bonus").state;
}

describe("bounded ring read-only controls model", () => {
  it("starts off with no implied authorization and explains prerequisites", () => {
    const fresh = createInitialState();
    expect(ringAutoView(fresh).status).toContain("默认未授权");
    expect(ringAutoView(fresh).prerequisite).toContain("天体物理学 1");
    fresh.research.levels.astrophysics = 1;
    expect(ringAutoView(fresh).prerequisite).toContain(`手动开奖 ${ARCADE.autoCardManualRuns} 次`);
    fresh.arcade.stats.manualRuns = ARCADE.autoCardManualRuns;
    fresh.unlockedCards.push("auto_runner");
    expect(ringAutoView(fresh).prerequisite).toContain("装配");
  });
  it("only offers unlocked, open auto-runner runLights slots", () => {
    const state = ready();
    state.protocols.slots[2] = structuredClone(state.protocols.slots[0]!);
    expect(ringAutoView(state).slots.map(slot => slot.index)).toEqual([0]);
    state.protocols.slots[0]!.card!.action = {kind: "setBet", symbol: "metal", units: 1};
    expect(ringAutoView(state).slots).toEqual([]);
    expect(ringAutoView(state).setupAvailable).toBe(false);
    expect(ringAutoView(state).showPanel).toBe(false);
  });
  it("keeps locked research and locked-card progress compact even with tickets", () => {
    const state = grantRun(createInitialState(), "bonus").state;
    expect(state.arcade.runs).toHaveLength(1);
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: false, showPanel: false, armed: false });
    expect(ringAutoView(state).manualHint).toContain("天体物理学 1 级");
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
    state.research.levels.astrophysics = 1;
    for (const count of [0, 1, ARCADE.autoCardManualRuns - 1]) {
      state.arcade.stats.manualRuns = count;
      const before = serializeState(state), model = ringAutoView(state);
      expect(model.manualHint).toContain(`${count}/${ARCADE.autoCardManualRuns}`);
      expect(model).toMatchObject({ setupAvailable: false, showPanel: false, armed: false });
      expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
      expect(serializeState(state)).toEqual(before);
    }
  });
  it("does not turn a reached threshold into an unlocked card or equipped slot", () => {
    let state = grantRun(createInitialState(), "bonus").state;
    state.research.levels.astrophysics = 1;
    state.arcade.stats.manualRuns = ARCADE.autoCardManualRuns;
    const before = serializeState(state), pending = ringAutoView(state);
    expect(pending.manualHint).toContain(`${ARCADE.autoCardManualRuns}/${ARCADE.autoCardManualRuns}`);
    expect(pending.manualHint).toContain("等待解锁状态更新");
    expect(pending).toMatchObject({ setupAvailable: false, showPanel: false, armed: false });
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
    expect(serializeState(state)).toEqual(before);
    state = refreshUnlocks(state);
    expect(ringAutoView(state).manualHint).toContain("已解锁");
    expect(ringAutoView(state).manualHint).toContain("装配默认关闭");
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: false, showPanel: false, armed: false });
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
  });
  it("shows equipped controls with an empty queue without implying authority", () => {
    const state = ready();
    expect(state.protocols.slots[0]!.card!.enabled).toBe(false);
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: true, showPanel: true, armed: false });
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(true);
    expect(ringAutoView(toggleSlot(state, 0, true)).armed).toBe(false);
    state.arcade.runs = [];
    const before = serializeState(state), model = ringAutoView(state);
    expect(model).toMatchObject({ setupAvailable: true, showPanel: true, armed: false, maxCount: 0 });
    expect(model.prerequisite).toContain("暂无待揭晓");
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
    expect(serializeState(state)).toEqual(before);
  });
  it("rechecks actual research and manual progress even if an old card is present", () => {
    const state = ready();
    state.arcade.stats.manualRuns = ARCADE.autoCardManualRuns - 1;
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: false, showPanel: false });
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
    state.arcade.stats.manualRuns = ARCADE.autoCardManualRuns;
    state.research.levels.astrophysics = 0;
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: false, showPanel: false });
    expect(ringAutoInput(state, "0", "1", "0").valid).toBe(false);
  });
  it("keeps armed and retired audit history visible when setup becomes unavailable", () => {
    let state = ready();
    state = armAutoRunner(state, 0, {planetId: state.activePlanetId, count: 2, maxDeuterium: "123"}).state;
    state.research.levels.astrophysics = 0;
    const before = serializeState(state), model = ringAutoView(state);
    expect(model).toMatchObject({ setupAvailable: false, showPanel: true, armed: true });
    expect(model.progress).toContain("0/2");
    expect(model.progress).toContain("上限 123");
    expect(model.frozen).toContain(state.planets[0]!.name);
    expect(serializeState(state)).toEqual(before);
    state = clearSlot(stopAutoRunner(state), 0);
    state.arcade.runs = [];
    expect(ringAutoView(state)).toMatchObject({ setupAvailable: false, showPanel: true, armed: false });
    expect(ringAutoView(state).status).toContain("已停止");
    expect(ringAutoView(state).progress).toBe(model.progress);
    expect(ringAutoView(state).frozen).toBe(model.frozen);
    expect(ringAutoView(state).stopReason).toContain("停止原因");
    expect(ringAutoInput(state, "0", "1", "123").valid).toBe(false);
  });
  it("reads only the replacement world's permissions and preserves imported authority unchanged", () => {
    let state = ready();
    state = armAutoRunner(state, 0, {planetId: state.activePlanetId, count: 2, maxDeuterium: "0"}).state;
    const armed = deserializeState(serializeState(state));
    const stopped = deserializeState(serializeState(clearSlot(stopAutoRunner(state), 0)));
    const fresh = deserializeState(serializeState(createInitialState()));
    for (const [world, showPanel, setupAvailable, authorized] of [
      [armed, true, true, true], [stopped, true, false, false], [fresh, false, false, false],
    ] as const) {
      const before = serializeState(world);
      expect(ringAutoView(world)).toMatchObject({ showPanel, setupAvailable, armed: authorized });
      expect(ringAutoInput(world, "0", "2", "0").valid).toBe(false);
      expect(serializeState(world)).toEqual(before);
    }
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
    expect(model.showPanel).toBe(true);
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
