import { describe, expect, it } from "vitest";
import { exportSave, importSave, deserializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { rejectMisplacedDemolitionFields } from "../src/game/demolition-save";
import { big } from "../src/game/decimal";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { tick } from "../src/game/logic";

const fresh = (): any => JSON.parse(exportSave(createInitialState(123, 456), 1000));
const markers = ["demolition", "demolitionRuleVersion", "fromLevel", "toLevel"];
const places = [
  ["shadow"], ["state", "shadow"], ["state", "planets", 0, "shadow"],
  ["state", "planets", 0, "resources", "shadow"], ["state", "research", "shadow"],
  ["state", "orders", "shadow"], ["state", "deepSpace", "shadow"],
] as const;
function insert(file: any, path: readonly (string | number)[], value: unknown) {
  let parent = file;
  for (const key of path.slice(0, -1)) parent = parent[key];
  parent[path[path.length - 1]!] = value;
}

describe("r11 new markers cannot be silently discarded at unknown locations", () => {
  for (const place of places) for (const key of markers) for (const value of [null, false, 0, {}]) {
    it(`${place.join(".")}.${key}=${JSON.stringify(value)}`, () => {
      const file = fresh(); insert(file, place, { [key]: value });
      expect(() => importSave(JSON.stringify(file))).toThrow(/拆除/);
    });
  }
  it.each(places)("rejects a hidden demolition-kind object at %j", (...path) => {
    const file = fresh(); insert(file, path as (string | number)[], { kind: "demolition" });
    expect(() => importSave(JSON.stringify(file))).toThrow(/拆除/);
  });
  it("preserves the actual null slot and does not broaden unrelated old unknown-field rules", () => {
    const original = fresh(), file = fresh(); file.unrelatedNote = { text: "anonymous test annotation" };
    expect(importSave(JSON.stringify(file))).toEqual(original);
    expect(() => rejectMisplacedDemolitionFields(original, true)).not.toThrow();
    expect(() => deserializeState(original.state)).not.toThrow();
  });
  it("checks direct state-reader callers and does not let an aliased planet hide a marker", () => {
    const file = fresh(); file.state.shadow = file.state.planets[0];
    expect(() => deserializeState(file.state)).toThrow(/拆除/);
    expect(() => importSave(JSON.stringify(file))).toThrow(/拆除/);
  });
  it("does not treat a lookalike nested state/planets path as the authoritative slot", () => {
    const file = fresh(); file.shadow = { state: { planets: [{ demolition: null }] } };
    expect(() => importSave(JSON.stringify(file))).toThrow(/拆除/);
  });
  it.each(["4294967295", "9007199254740992", "01", "-1"])("rejects ignored non-index array property %s in a direct reader", key => {
    const file = fresh(); file.state.planets[key] = { demolition: null };
    expect(() => deserializeState(file.state)).toThrow(/拆除/);
  });
  it("allows an actually paid typed slot, but rejects its alias at an ignored path", () => {
    const state = createInitialState(123, 456), planet = state.planets[0]!;
    planet.buildings.metal_mine = 10;
    planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
    state.research.levels.ion_tech = 1;
    // Synthetic setup must settle the existing achievement/card reader contract
    // before issuing the genuine new paid job; this does not modify a source file.
    const ready = deserializeState(importSave(exportSave(tick(state, 0), 1000)).state);
    const quote = quoteDemolition(ready, "metal_mine"); expect(quote.ok).toBe(true);
    const paid = commitDemolition(ready, quote.quote!); expect(paid.ok).toBe(true);
    const file = JSON.parse(exportSave(paid.state, 1000));
    expect(importSave(JSON.stringify(file))).toEqual(file);
    file.state.shadow = file.state.planets[0].demolition;
    expect(() => deserializeState(file.state)).toThrow(/拆除/);
  });
  it("tolerates unrelated acyclic aliases without dropping a hidden new marker", () => {
    const file = fresh(), note = { text: "anonymous annotation" };
    file.state.noteA = note; file.state.noteB = note;
    expect(() => deserializeState(file.state)).not.toThrow();
  });
  it("rejects direct-reader cycles without traversing indefinitely", () => {
    const root = fresh(); root.state.shadow = root.state;
    expect(() => deserializeState(root.state)).toThrow(/循环/);
    const nested = fresh(), note: any = {}; note.self = note; nested.state.shadow = note;
    expect(() => deserializeState(nested.state)).toThrow(/循环/);
  });
  it("rejects ignored demolition-kind properties on an unknown array", () => {
    const file = fresh(); file.state.shadow = Object.assign([], { kind: "demolition" });
    expect(() => deserializeState(file.state)).toThrow(/拆除/);
  });
});
