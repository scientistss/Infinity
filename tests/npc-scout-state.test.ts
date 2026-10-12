import { describe, expect, it } from "vitest";
import { canonicalNpcScoutTime, NPC_SCOUT_SNAPSHOT_MODEL, readNpcScoutSnapshot } from "../src/game/npc-scout-state";

/** Synthetic detached boundary fixture, never a claim of paid arrival provenance. */
function snapshot(): any {
  return { model: NPC_SCOUT_SNAPSHOT_MODEL, fleetId: 1, originId: "old-colony", target: { galaxy: 1, system: 56, position: 6 },
    observedAt: "100.125", stock: [515, 257.5, 3], garrison: { light_fighter: 3, heavy_fighter: 0 },
    defenderTech: { weapons: 0, shields: 0, armour: 0 } };
}

describe("strict eight-field historical scout snapshot", () => {
  it("deep copies and freezes actual Number fractions/subnormal stock and normalizes only economic zero", () => {
    const source = snapshot(); source.stock = Object.freeze([-0, Number.MIN_VALUE, 1.2345678901234567]);
    const result = readNpcScoutSnapshot(source);
    expect(Object.is(source.stock[0], -0)).toBe(true); expect(Object.is(result.stock[0], 0)).toBe(true);
    expect(result.stock[1]).toBe(Number.MIN_VALUE); expect(result.stock[2]).toBe(source.stock[2]);
    for (const value of [result, result.target, result.stock, result.garrison, result.defenderTech]) expect(Object.isFrozen(value)).toBe(true);
    for (const key of ["target", "stock", "garrison", "defenderTech"]) expect((result as any)[key]).not.toBe(source[key]);
    source.target.system = 57; source.garrison.light_fighter = 0;
    expect(result.target.system).toBe(56); expect(result.garrison.light_fighter).toBe(3);
  });

  it.each(["model", "fleetId", "originId", "target", "observedAt", "stock", "garrison", "defenderTech"])
  ("requires own enumerable data field %s without invoking getters", key => {
    let calls = 0;
    for (const kind of ["missing", "hidden", "inherited", "accessor"] as const) {
      const raw = snapshot(), value = raw[key]; delete raw[key];
      if (kind === "hidden") Object.defineProperty(raw, key, { value });
      if (kind === "inherited") Object.setPrototypeOf(raw, { [key]: value });
      if (kind === "accessor") Object.defineProperty(raw, key, { enumerable: true, get() { calls++; return value; } });
      expect(() => readNpcScoutSnapshot(raw)).toThrow();
    }
    expect(calls).toBe(0);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER, NaN, Infinity, "1", null])("rejects fleet identity %s", value => {
    expect(() => readNpcScoutSnapshot({ ...snapshot(), fleetId: value })).toThrow();
  });
  it.each(["", "old colony", "é", "a".repeat(65), 1, null])("rejects origin identity %s", value => {
    expect(() => readNpcScoutSnapshot({ ...snapshot(), originId: value })).toThrow();
  });
  it.each([-1, NaN, Infinity, "1", null, undefined, 50000.00000000001])("rejects invalid represented metal stock %s", value => {
    const raw = snapshot(); raw.stock[0] = value; expect(() => readNpcScoutSnapshot(raw)).toThrow();
  });
  it.each(["named", "symbol", "hole", "accessor", "prototype", "length", "hidden-index"])("rejects stock array %s before copying", kind => {
    const raw = snapshot(); let calls = 0;
    if (kind === "named") raw.stock.extra = 1;
    if (kind === "symbol") raw.stock[Symbol("extra")] = 1;
    if (kind === "hole") delete raw.stock[1];
    if (kind === "accessor") Object.defineProperty(raw.stock, "1", { enumerable: true, get() { calls++; return 1; } });
    if (kind === "prototype") Object.setPrototypeOf(raw.stock, Object.create(Array.prototype));
    if (kind === "length") raw.stock.push(0);
    if (kind === "hidden-index") Object.defineProperty(raw.stock, "1", { value: 1, enumerable: false });
    expect(() => readNpcScoutSnapshot(raw)).toThrow(); expect(calls).toBe(0);
  });
  it.each(["target", "garrison", "defenderTech"])("rejects nested %s unknown/accessor/prototype/symbol fields", key => {
    let calls = 0;
    for (const kind of ["unknown", "symbol", "accessor", "prototype"]) {
      const raw = snapshot();
      if (kind === "unknown") raw[key].extra = undefined;
      if (kind === "symbol") raw[key][Symbol("extra")] = 0;
      if (kind === "accessor") Object.defineProperty(raw[key], Object.keys(raw[key])[0], { enumerable: true, get() { calls++; return 0; } });
      if (kind === "prototype") Object.setPrototypeOf(raw[key], { inherited: 0 });
      expect(() => readNpcScoutSnapshot(raw)).toThrow();
    }
    expect(calls).toBe(0);
  });
  it("rejects unknown models, out-of-bounds counts/coordinates and nonzero modeled technology", () => {
    for (const mutation of [
      (raw: any) => { raw.model = "npc-scout-snapshot-v2"; }, (raw: any) => { raw.extra = null; },
      (raw: any) => { raw.target.position = 16; }, (raw: any) => { raw.target.galaxy = 0; },
      (raw: any) => { raw.garrison.light_fighter = 9; }, (raw: any) => { raw.garrison.light_fighter = .5; },
      (raw: any) => { raw.garrison.heavy_fighter = 2; }, (raw: any) => { raw.defenderTech.weapons = 1; },
    ]) { const raw = snapshot(); mutation(raw); expect(() => readNpcScoutSnapshot(raw)).toThrow(); }
  });
  it.each(["0", "100.125", "1e+400", "5e-324"])("accepts exact canonical timestamp %s", value => {
    expect(canonicalNpcScoutTime(value)).toBe(value);
  });
  it.each(["", "-0", "00", "1.0", ".5", "1e400", "1E+400", "NaN", "Infinity", "-1", " 1", "1 ", "1".repeat(101), 1, null])
  ("rejects noncanonical timestamp %s without coercion", value => { expect(() => canonicalNpcScoutTime(value)).toThrow(); });
  it("does not coerce an object timestamp", () => {
    let calls = 0; const value = { toString() { calls++; throw Error("coercion"); } };
    expect(() => canonicalNpcScoutTime(value)).toThrow(); expect(calls).toBe(0);
  });
  it("accepts null-prototype plain records and returns detached ordinary records", () => {
    const source = snapshot(); Object.setPrototypeOf(source, null); Object.setPrototypeOf(source.target, null);
    expect(Object.getPrototypeOf(readNpcScoutSnapshot(source))).toBe(Object.prototype);
  });
});
