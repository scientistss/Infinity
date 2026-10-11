import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, sendFleet } from "../src/game/fleet";
import { rejectNpcAttackFields } from "../src/game/npc-attack-state";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";

/** Synthetic legal prerequisite setup, followed by actual paid dispatch. */
function launched(mission: "attack" | "scout" = "attack") {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 3;
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000, espionage_probe: 10 });
  Object.assign(state.research.levels, { combustion_drive: 3, computer_tech: 10, weapons_tech: 1, espionage_tech: 2 });
  const ready = deserializeState(serializeState(state));
  const result = sendFleet(ready, { mission, target: { galaxy: 1, system: 56, position: 6 },
    ships: mission === "attack" ? { light_fighter: 20, small_cargo: 2 } : { espionage_probe: 1 },
    cargo: emptyCargo(), speedPercent: 100 });
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

const malformed = ["00", "01", "4294967295", "9007199254740991", "symbol", "hidden-alias", "hidden-index", "prototype", "null-prototype"] as const;
type Malformed = typeof malformed[number];
function alter<T>(fleets: T[], kind: Malformed): void {
  if (kind === "prototype") Object.setPrototypeOf(fleets, Object.create(Array.prototype));
  else if (kind === "null-prototype") Object.setPrototypeOf(fleets, null);
  else if (kind === "hidden-index") Object.defineProperty(fleets, "0", { value: fleets[0], enumerable: false });
  else Object.defineProperty(fleets, kind === "symbol" ? Symbol("attack-alias") : kind === "hidden-alias" ? "00" : kind,
    { value: fleets[0], enumerable: kind !== "hidden-alias", configurable: true });
}

describe("attack markers require a genuine fleet array entry", () => {
  it.each(malformed)("rejects raw %s without normalizing away attack authority", kind => {
    const source = launched(), sourceBefore = exportSave(source, 1000, 1000);
    const raw = serializeState(source);
    alter(raw.fleets, kind);
    const descriptors = Object.getOwnPropertyDescriptors(raw.fleets), prototype = Object.getPrototypeOf(raw.fleets);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => deserializeState(raw)).toThrow(/NPC/);
      expect(Object.getOwnPropertyDescriptors(raw.fleets)).toEqual(descriptors);
      expect(Object.getPrototypeOf(raw.fleets)).toBe(prototype);
      expect(exportSave(source, 1000, 1000)).toBe(sourceBefore);
    }
  });

  it.each(malformed)("rejects runtime %s before JSON can erase it", kind => {
    const state = launched();
    alter(state.fleets, kind);
    const descriptors = Object.getOwnPropertyDescriptors(state.fleets), prototype = Object.getPrototypeOf(state.fleets);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => exportSave(state, 1000, 1000)).toThrow(/NPC/);
      expect(Object.getOwnPropertyDescriptors(state.fleets)).toEqual(descriptors);
      expect(Object.getPrototypeOf(state.fleets)).toBe(prototype);
    }
  });

  it("accepts the paid fleet, detached raw read and current JSON round trip", () => {
    const state = launched(), before = exportSave(state, 1000, 1000), raw = serializeState(state);
    expect(serializeState(deserializeState(raw))).toEqual(raw);
    const readOnce = exportSave(deserializeState(importSave(before).state), 1000, 1000);
    // Existing fleet serialization inserts elapsed/returning in a different
    // property order on the first read; every field must still match exactly.
    expect(JSON.parse(readOnce)).toEqual(JSON.parse(before));
    expect(exportSave(deserializeState(importSave(readOnce).state), 1000, 1000)).toBe(readOnce);
    expect(() => rejectNpcAttackFields(JSON.parse(before), false, true)).not.toThrow();
    expect(exportSave(state, 1000, 1000)).toBe(before);
  });

  it("requires an array parent rather than only a numeric-looking path", () => {
    expect(() => rejectNpcAttackFields({ fleets: { 0: { npcAttack: {} } } }, false)).toThrow(/NPC/);
    expect(() => rejectNpcAttackFields({ state: { fleets: { 0: { npcAttack: {} } } } }, false, true)).toThrow(/NPC/);
  });

  it.each(["00", "01", "4294967295", "symbol", "hidden-alias", "hidden-index", "prototype"] as const)
  ("keeps ordinary mission array normalization unchanged for %s", kind => {
    const state = launched("scout"), raw = serializeState(state), expected = serializeState(state);
    alter(raw.fleets, kind);
    expect(serializeState(deserializeState(raw))).toEqual(expected);
    alter(state.fleets, kind);
    expect(JSON.parse(exportSave(state, 1000, 1000)).state).toEqual(expected);
  });
});
