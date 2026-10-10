import { describe, expect, it } from "vitest";
import { armAutoRunner, clearSlot, equipCard, refreshUnlocks, stopAutoRunner } from "../src/automation/engine";
import { ARCADE, BET_SYMBOLS } from "../src/data/arcade";
import { grantRun, maxBetUnits, setBet, topUpReason } from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { storedRunLimit } from "../src/game/deep-state";
import { activePlanet } from "../src/game/empire";
import { prestige } from "../src/game/logic";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { arcadeView } from "../src/ui/arcade-present";
import { ringAutoInput, ringAutoView } from "../src/ui/ring-auto-model";
import { ringControlsView, type RingAutoDraft } from "../src/ui/ring-controls-model";

const draft: RingAutoDraft = { slot: "0", count: "2", cap: "100000" };

function ready() {
  let state = createInitialState(20261010);
  state.research.levels.astrophysics = 1;
  state.arcade.stats.manualRuns = ARCADE.autoCardManualRuns;
  state.arcade.stats.runs = ARCADE.autoCardManualRuns;
  state.arcade.stats.hits.empty = ARCADE.autoCardManualRuns;
  activePlanet(state).resources.deuterium = big(100000);
  state = equipCard(refreshUnlocks(state), 0, "auto_runner").state;
  return grantRun(grantRun(state, "bonus").state, "bonus").state;
}

function armed() {
  const state = ready();
  const result = armAutoRunner(state, 0, { planetId: state.activePlanetId, count: 2, maxDeuterium: draft.cap });
  expect(result.ok).toBe(true);
  return result.state;
}

function cases(): [string, GameState][] {
  const locked = ready(); locked.research.levels.astrophysics = 0;
  const empty = ready(); empty.arcade.runs = [];
  const poor = ready(); activePlanet(poor).resources.deuterium = big(0);
  const capped = setBet(ready(), "metal", maxBetUnits()).state;
  let full = ready();
  while (full.arcade.runs.length < storedRunLimit(full)) full = grantRun(full, "bonus").state;
  const exhausted = ready(); exhausted.arcade.nextRunId = Number.MAX_SAFE_INTEGER;
  return [
    ["ready", ready()], ["armed", armed()], ["stopped", stopAutoRunner(armed())],
    ["locked", locked], ["empty", empty], ["poor", poor], ["bet cap", capped],
    ["full queue", full], ["exhausted identifiers", exhausted],
    ["missing card", clearSlot(ready(), 0)], ["new world", createInitialState()],
  ];
}

describe("ring save-session control permissions", () => {
  it.each(cases())("ready permissions for %s equal the existing arcade and auto models", (_name, state) => {
    const before = serializeState(state), arcade = arcadeView(state), auto = ringAutoView(state);
    const input = ringAutoInput(state, draft.slot, draft.count, draft.cap);
    const model = ringControlsView(state, true, draft);
    expect(model).toMatchObject({
      canRun: arcade.canRun, canRunAll: arcade.runsCount > 0,
      topUpEnabled: arcade.topUpEnabled, clearEnabled: true,
      autoFieldsEnabled: auto.setupAvailable, autoArmEnabled: input.valid,
      autoStopEnabled: state.arcade.autoBatch?.armed === true, autoStatus: auto.status,
    });
    expect(model.bets).toEqual(arcade.bets.map(({ symbol, canAdd, canSub }) => ({ symbol, canAdd, canSub })));
    expect(model.topUpEnabled).toBe(topUpReason(state) === "");
    expect(model.auto).toEqual(auto);
    expect(model.input).toEqual(input);
    expect(serializeState(state)).toEqual(before);
  });

  it.each(cases())("protection disables all economic controls for %s without changing any state", (_name, state) => {
    const before = serializeState(state);
    for (const currentDraft of [draft, { slot: "0", count: "1", cap: "0" }, { slot: "2", count: "40", cap: "Infinity" }]) {
      const protectedView = ringControlsView(state, false, currentDraft);
      expect(protectedView).toMatchObject({
        canRun: false, canRunAll: false, topUpEnabled: false, clearEnabled: false,
        autoFieldsEnabled: false, autoArmEnabled: false, autoStopEnabled: false,
      });
      expect(protectedView.bets).toEqual(BET_SYMBOLS.map(symbol => ({ symbol, canAdd: false, canSub: false })));
      expect(protectedView.auto).toEqual(ringAutoView(state));
      if (state.arcade.autoBatch?.armed) {
        expect(protectedView.autoStatus).toContain("记录保留");
        expect(protectedView.autoStatus).toContain("冻结");
        expect(protectedView.autoStatus).not.toContain("已停止");
      }
    }
    expect(serializeState(state)).toEqual(before);
  });

  it("restores permissions from the replacement world and current drafts, never an old disabled mask", () => {
    const previous = armed(), previousBefore = serializeState(previous);
    expect(ringControlsView(previous, false, draft).autoStopEnabled).toBe(false);
    for (const [_name, state] of cases()) {
      const before = serializeState(state);
      for (const currentDraft of [draft, { slot: "0", count: "1", cap: "0" }, { slot: "0", count: "0", cap: "0" }, { slot: "2", count: "1", cap: "0" }]) {
        ringControlsView(state, false, currentDraft);
        const recovered = ringControlsView(state, true, currentDraft);
        expect(recovered.autoArmEnabled).toBe(ringAutoInput(state, currentDraft.slot, currentDraft.count, currentDraft.cap).valid);
        expect(recovered.autoStopEnabled).toBe(state.arcade.autoBatch?.armed === true);
        expect(recovered.canRun).toBe(state.arcade.runs.length > 0);
        expect(recovered.topUpEnabled).toBe(topUpReason(state) === "");
      }
      expect(serializeState(state)).toEqual(before);
    }
    expect(serializeState(previous)).toEqual(previousBefore);
  });

  it("retains a legitimate armed reload while stopped and curved records never regain authority", () => {
    const original = armed();
    original.lifetime.metal = big("1e12");
    const curved = prestige(original);
    expect(curved.hasPrestiged).toBe(true);
    const stopped = clearSlot(stopAutoRunner(original), 0);
    for (const [world, authorized] of [[original, true], [stopped, false], [curved, false], [createInitialState(), false]] as const) {
      const reloaded = deserializeState(serializeState(world)), before = serializeState(reloaded);
      expect(ringControlsView(reloaded, false, draft).autoStopEnabled).toBe(false);
      const restored = ringControlsView(reloaded, true, draft);
      expect(restored.autoStopEnabled).toBe(authorized);
      expect(reloaded.arcade.autoBatch?.armed ?? false).toBe(authorized);
      expect(serializeState(reloaded)).toEqual(before);
    }
  });

  it("uses the replacement active planet for affordability without changing the fixed batch source", () => {
    let state = armed();
    const colony = createPlanet("replacement"); colony.resources.deuterium = big(0);
    state = { ...state, planets: [...state.planets, colony], activePlanetId: colony.id };
    const before = serializeState(state), model = ringControlsView(state, true, draft);
    expect(model.topUpEnabled).toBe(false);
    expect(model.auto.source).toContain(colony.name);
    expect(model.auto.frozen).toContain(state.planets[0]!.name);
    expect(model.autoStopEnabled).toBe(true);
    expect(serializeState(state)).toEqual(before);
  });
});
