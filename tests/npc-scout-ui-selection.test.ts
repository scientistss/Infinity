import { describe, expect, it } from "vitest";
import originalR10Raw from "./fixtures/demolition-origin-r10-save.json?raw";
import panelSource from "../src/ui/space-panel.ts?raw";
import routeSource from "../scripts/npc-natural-r11-route.mjs?raw";
import { NPC_SCOUT_UI_SELECTION } from "../scripts/npc-scout-ui-selection";
import { SHIP_IDS } from "../src/data/units";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { orderUnits } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";

// Explicit, independent contract: never derive these expected zeros from the
// candidate selection or strip keys from an observed browser/state result.
const ZERO_SHIPS = {
  small_cargo: 0, large_cargo: 0, light_fighter: 0, heavy_fighter: 0,
  cruiser: 0, battleship: 0, battlecruiser: 0, bomber: 0, destroyer: 0,
  deathstar: 0, recycler: 0, colony_ship: 0,
};
const SPARSE = { espionage_probe: 1 };
const DENSE = { ...ZERO_SHIPS, ...SPARSE };
const target = { galaxy: 1, system: 56, position: 6 };
const request = (ships: FleetRequest["ships"]): FleetRequest => ({
  mission: "scout", target: { ...target }, ships: { ...ships }, cargo: emptyCargo(), speedPercent: 100,
});

/** Existing immutable r10 fixture, actual paid API actions. No state injection.
 * This is focused domain evidence; pinned ca5/native evidence remains separate.
 */
function paidProbe(): GameState {
  let state = selectPlanet(deserializeState(importSave(originalR10Raw).state), "homeworld");
  expect(activePlanet(state).units.espionage_probe).toBe(0);
  const research = enqueueResearch(state, "combustion_drive", "manual");
  expect(research.ok).toBe(true); expect(research.jobId).toBe(202);
  expect(activePlanet(research.state).resources.metal.eq(activePlanet(state).resources.metal.sub(1600))).toBe(true);
  expect(activePlanet(research.state).resources.deuterium.eq(activePlanet(state).resources.deuterium.sub(2400))).toBe(true);
  state = tick(research.state, 1, "live");
  const probe = orderUnits(state, "espionage_probe", 1, "manual");
  expect(probe.ok).toBe(true); expect(probe.jobId).toBe(203);
  expect(activePlanet(probe.state).resources.crystal.eq(activePlanet(state).resources.crystal.sub(1000))).toBe(true);
  state = tick(probe.state, 1, "live");
  expect(activePlanet(state).units.espionage_probe).toBe(1);
  expect(state.npcEconomy.elapsedSeconds).toBe(2);
  return state;
}

function dispatch(state: GameState, ships: FleetRequest["ships"], id: number): GameState {
  const input = request(ships), before = serializeState(state), quote = quoteFlight(state, input);
  expect(quote.ok).toBe(true);
  expect([quote.duration, quote.fuel.toString(), quote.capacity.toString()]).toEqual([1, "4", "7"]);
  expect(serializeState(state)).toEqual(before);
  const sent = sendFleet(state, input);
  expect(sent.ok).toBe(true); expect(sent.fleetId).toBe(id);
  expect(sent.state.fleets).toHaveLength(1);
  expect(sent.state.fleets[0]!.ships).toEqual(ships);
  expect(activePlanet(sent.state).resources.deuterium.eq(activePlanet(state).resources.deuterium.sub(4))).toBe(true);
  expect(activePlanet(sent.state).units.espionage_probe).toBe(0);
  // API owns its copy, including zeros; a caller mutation cannot change it.
  input.ships.espionage_probe = 0;
  expect(sent.state.fleets[0]!.ships.espionage_probe).toBe(1);
  expect(serializeState(state)).toEqual(before);
  return sent.state;
}

function reload(state: GameState): GameState {
  const before = serializeState(state), at = 1791590400000;
  const loaded = importSave(exportSave(state, at, at));
  expect(loaded.state).toEqual(before);
  const adopted = deserializeState(loaded.state);
  expect(serializeState(adopted)).toEqual(before);
  return adopted;
}

describe("NPC acceptance uses the UI's exact dense ship selection", () => {
  it("binds all 13 UI inputs, with one probe and only 12 named legal zeros", () => {
    expect(NPC_SCOUT_UI_SELECTION).toEqual(DENSE);
    expect(Object.keys(NPC_SCOUT_UI_SELECTION)).toEqual(SHIP_IDS.filter(id => id !== "solar_satellite"));
    expect(Object.values(NPC_SCOUT_UI_SELECTION).reduce<number>((sum, count) => sum + count, 0)).toBe(1);
    expect(Object.values(NPC_SCOUT_UI_SELECTION).filter(count => count === 0)).toHaveLength(12);
    // Static source binding, not a claim to have executed the native UI here.
    expect(panelSource).toContain('SHIP_IDS.filter(id=>id!=="solar_satellite").map(id=>');
    expect(panelSource).toContain('value="0" data-ship="${id}"');
    expect(panelSource).toContain('for(const i of root.querySelectorAll<HTMLInputElement>("[data-ship]"))ships[i.dataset.ship as ShipId]=Number(i.value);');
    expect(routeSource).toContain('ships: { ...NPC_SCOUT_UI_SELECTION }');
    expect(routeSource).toContain('legacy.fleet.sendFleet(control, request())');
  });

  it("preserves sparse API support and matches the dense full state at both flights and every reload", () => {
    let sparse = paidProbe(), dense = paidProbe();
    const inFlight: string[] = [];
    function exact(stage: string, id?: number, returning = false, remaining = 1, elapsed = 0) {
      const s = serializeState(sparse), d = serializeState(dense);
      if (id === undefined) {
        expect(s.fleets, stage).toEqual([]); expect(d, stage).toEqual(s);
      } else {
        expect(s.fleets, stage).toHaveLength(1); expect(d.fleets, stage).toHaveLength(1);
        const old = s.fleets[0]!, current = d.fleets[0]!;
        expect(old.ships, stage).toEqual(SPARSE); expect(current.ships, stage).toEqual(DENSE);
        expect([current.id, current.returning, current.duration, current.remaining, current.elapsed], stage)
          .toEqual([id, returning, 1, remaining, elapsed]);
        // Add only the twelve frozen legal zero keys to a separately checked
        // sparse expected input. All other state fields remain strict equality.
        expect(d, stage).toEqual({ ...s, fleets: [{ ...old, ships: { ...ZERO_SHIPS, ...old.ships } }] });
        inFlight.push(stage);
      }
      sparse = reload(sparse); dense = reload(dense);
      expect(serializeState(sparse), stage).toEqual(s);
      expect(serializeState(dense), stage).toEqual(d);
    }
    function advance(seconds: number) { sparse = tick(sparse, seconds, "live"); dense = tick(dense, seconds, "live"); }
    exact("probe-complete");
    sparse = dispatch(sparse, SPARSE, 4); dense = dispatch(dense, NPC_SCOUT_UI_SELECTION, 4);
    exact("first-scout-outbound", 4);
    advance(1); exact("first-snapshot-returning", 4, true);
    const frozen = structuredClone(dense.messages.find(message => message.id === "scout-4"));
    expect(frozen?.at).toBe(25813);
    advance(1); exact("first-probe-returned");
    for (let i = 0; i < 60; i++) advance(1);
    exact("ordinary-wait-complete");
    sparse = dispatch(sparse, SPARSE, 5); dense = dispatch(dense, NPC_SCOUT_UI_SELECTION, 5);
    exact("second-scout-outbound", 5);
    advance(.5); exact("second-scout-halfway-native-free-strict-reload", 5, false, .5, .5);
    const uninterrupted = dense;
    dense = reload(dense);
    advance(.5); expect(serializeState(dense)).toEqual(serializeState(tick(uninterrupted, .5, "live")));
    exact("second-snapshot-returning", 5, true);
    expect(dense.messages.find(message => message.id === "scout-5")?.at).toBe(25875);
    expect(dense.messages.find(message => message.id === "scout-4")).toEqual(frozen);
    advance(1); exact("final-returned-and-reloaded");
    expect([dense.totalTime.toString(), dense.npcEconomy.elapsedSeconds, dense.nextFleetId, activePlanet(dense).units.espionage_probe])
      .toEqual(["25876", 66, 6, 1]);
    expect(inFlight).toEqual(["first-scout-outbound", "first-snapshot-returning", "second-scout-outbound", "second-scout-halfway-native-free-strict-reload", "second-snapshot-returning"]);
  });

  it.each(["unknown_ship", "solar_satellite", "rocket_launcher"])("rejects the forbidden %s key even when zero, in dispatch and the reader", key => {
    const state = paidProbe(), before = serializeState(state);
    const invalid = request({ ...NPC_SCOUT_UI_SELECTION, [key]: 0 });
    expect(quoteFlight(state, invalid).ok).toBe(false);
    const sent = sendFleet(state, invalid);
    expect(sent.ok).toBe(false); expect(serializeState(sent.state)).toEqual(before);
    const outbound = dispatch(state, NPC_SCOUT_UI_SELECTION, 4);
    const file = JSON.parse(exportSave(outbound, 1791590400000));
    file.state.fleets[0].ships[key] = 0;
    expect(() => importSave(JSON.stringify(file))).toThrow(/不能派遣防御或太阳能卫星/);
  });
});
