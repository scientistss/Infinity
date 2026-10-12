import { describe, expect, it } from "vitest";
import {
  buildNpcRehearsalFormationCopy, listNpcRehearsalFormations,
} from "../src/ui/npc-rehearsal-formation-model";
import source from "../src/ui/npc-rehearsal-formation-model.ts?raw";

/** Independent gold: do not derive expectations from the production ID list. */
const GOLD_IDS = ["small_cargo", "large_cargo", "light_fighter", "heavy_fighter", "cruiser", "battleship",
  "battlecruiser", "bomber", "destroyer", "deathstar", "recycler", "espionage_probe", "colony_ship"] as const;
function formation(id = 7): any {
  return { id, revision: 3, name: "远征数量", ships: { small_cargo: 20, light_fighter: 3, colony_ship: 1 } };
}
function frozenTree(value: any): any {
  if (value && typeof value === "object") { Object.values(value).forEach(frozenTree); Object.freeze(value); }
  return value;
}

describe("one-time named formation copy into historical rehearsal numbers", () => {
  it("copies an independent 13-field gold without clipping, and reports only landed deficits", () => {
    const selected = formation(), entries = [selected], stock = { small_cargo: 7, light_fighter: 5 };
    const model = buildNpcRehearsalFormationCopy(entries, selected, stock)!;
    expect(model.origin).toEqual({ id: 7, revision: 3, name: "远征数量" });
    expect(model.values).toEqual({ small_cargo: "20", large_cargo: "0", light_fighter: "3", heavy_fighter: "0", cruiser: "0",
      battleship: "0", battlecruiser: "0", bomber: "0", destroyer: "0", deathstar: "0", recycler: "0", espionage_probe: "0", colony_ship: "1" });
    expect(model.rows).toEqual([
      { unit: "small_cargo", target: 20, landed: 7, deficit: 13 },
      { unit: "large_cargo", target: 0, landed: 0, deficit: 0 },
      { unit: "light_fighter", target: 3, landed: 5, deficit: 0 },
      { unit: "heavy_fighter", target: 0, landed: 0, deficit: 0 },
      { unit: "cruiser", target: 0, landed: 0, deficit: 0 },
      { unit: "battleship", target: 0, landed: 0, deficit: 0 },
      { unit: "battlecruiser", target: 0, landed: 0, deficit: 0 },
      { unit: "bomber", target: 0, landed: 0, deficit: 0 },
      { unit: "destroyer", target: 0, landed: 0, deficit: 0 },
      { unit: "deathstar", target: 0, landed: 0, deficit: 0 },
      { unit: "recycler", target: 0, landed: 0, deficit: 0 },
      { unit: "espionage_probe", target: 0, landed: 0, deficit: 0 },
      { unit: "colony_ship", target: 1, landed: 0, deficit: 1 },
    ]);
    expect(model.total).toBe(24); expect(model.totalDeficit).toBe(14);
    expect(Object.keys(model.values)).toEqual(GOLD_IDS);
  });

  it("copies all 13 types through 1e6, with bounded totals and no new hand-entry limit", () => {
    const selected = formation(); selected.ships = Object.fromEntries(GOLD_IDS.map(id => [id, 1_000_000]));
    const empty = buildNpcRehearsalFormationCopy([selected], selected, {})!;
    expect(empty.total).toBe(13_000_000); expect(empty.totalDeficit).toBe(13_000_000);
    expect(Object.values(empty.values)).toEqual(Array(13).fill("1000000"));
    const stock = Object.fromEntries(GOLD_IDS.map(id => [id, Number.MAX_SAFE_INTEGER]));
    const full = buildNpcRehearsalFormationCopy([selected], selected, stock)!;
    expect(full.totalDeficit).toBe(0); expect(full.values).toEqual(empty.values);
    expect(full.rows.every(row => row.landed === Number.MAX_SAFE_INTEGER)).toBe(true);
    selected.ships.light_fighter = 1_000_001;
    expect(buildNpcRehearsalFormationCopy([selected], selected, stock)).toBeNull();
    selected.ships.light_fighter = 1e12;
    expect(buildNpcRehearsalFormationCopy([selected], selected, stock)).toBeNull();
    // The existing hand-entry reader and its 1e12 contract are unchanged.
    expect(source).not.toContain("readNpcRehearsalSelection");
  });

  it("maps a distinct positive gold for every ship regardless of source key order", () => {
    const selected = formation();
    selected.ships = { colony_ship: 13, espionage_probe: 12, recycler: 11, deathstar: 10, destroyer: 9, bomber: 8,
      battlecruiser: 7, battleship: 6, cruiser: 5, heavy_fighter: 4, light_fighter: 3, large_cargo: 2, small_cargo: 1 };
    const model = buildNpcRehearsalFormationCopy([selected], selected, {})!;
    expect(model.values).toEqual({ small_cargo: "1", large_cargo: "2", light_fighter: "3", heavy_fighter: "4", cruiser: "5",
      battleship: "6", battlecruiser: "7", bomber: "8", destroyer: "9", deathstar: "10", recycler: "11", espionage_probe: "12", colony_ship: "13" });
    expect(model.rows.map(row => row.unit)).toEqual(GOLD_IDS);
    expect(model.rows.map(row => row.target)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(model.rows.map(row => row.deficit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(model.total).toBe(91); expect(model.totalDeficit).toBe(91);
  });

  it("lists current order with duplicate names distinguished by IDs, from zero through 32 entries", () => {
    expect(listNpcRehearsalFormations([])).toEqual([]);
    const entries = Array.from({ length: 32 }, (_, index) => formation(32 - index));
    const candidates = listNpcRehearsalFormations(entries);
    expect(candidates).toHaveLength(32);
    expect(candidates[0]).toEqual({ id: 32, revision: 3, name: "远征数量", index: 0 });
    expect(candidates[31]).toEqual({ id: 1, revision: 3, name: "远征数量", index: 31 });
    expect(buildNpcRehearsalFormationCopy(entries, entries[31], {})).not.toBeNull();
    entries.push(formation(33));
    expect(listNpcRehearsalFormations(entries)).toEqual([]);
    expect(buildNpcRehearsalFormationCopy(entries, entries[0], {})).toBeNull();
  });

  it("requires actual unique current source membership, rejecting clones, replacement and deletion", () => {
    const selected = formation(), replacement = structuredClone(selected), entries = [selected];
    expect(buildNpcRehearsalFormationCopy(entries, replacement, {})).toBeNull();
    expect(buildNpcRehearsalFormationCopy([replacement], selected, {})).toBeNull();
    expect(buildNpcRehearsalFormationCopy([], selected, {})).toBeNull();
    expect(buildNpcRehearsalFormationCopy(entries, selected.id, {})).toBeNull();
    expect(buildNpcRehearsalFormationCopy([...entries], selected, {})).not.toBeNull();
    replacement.revision++;
    expect(buildNpcRehearsalFormationCopy([replacement], selected, {})).toBeNull();
  });

  it.each(["source", "id", "ships", "inventory"])("rejects aliased or ambiguous %s identity", kind => {
    const selected = formation(), other = formation(8), entries = [selected, other];
    if (kind === "source") entries[1] = selected;
    if (kind === "id") other.id = selected.id;
    if (kind === "ships") other.ships = selected.ships;
    const stock = kind === "inventory" ? selected.ships : {};
    expect(buildNpcRehearsalFormationCopy(entries, selected, stock)).toBeNull();
    if (kind !== "inventory") expect(listNpcRehearsalFormations(entries)).toEqual([]);
    else expect(buildNpcRehearsalFormationCopy(entries, selected, { ...stock })).not.toBeNull();
  });

  it("rejects cross-record node aliases and inventory aliasing even on an unselected source", () => {
    for (const alias of ["source-to-ships", "ships-to-source", "unselected-inventory"]) {
      const selected = formation(), other = formation(8), third = formation(9), entries = [selected, other, third];
      if (alias === "source-to-ships") other.ships = third;
      if (alias === "ships-to-source") entries[2] = other.ships;
      const stock = alias === "unselected-inventory" ? other.ships : {};
      expect(buildNpcRehearsalFormationCopy(entries, selected, stock)).toBeNull();
    }
  });

  it("leaves all inputs unchanged and unfrozen, with deeply detached frozen output", () => {
    const selected = formation(), entries = [selected], stock = { small_cargo: 7 }, before = structuredClone({ entries, stock });
    const model = buildNpcRehearsalFormationCopy(entries, selected, stock)!, candidates = listNpcRehearsalFormations(entries);
    expect({ entries, stock }).toEqual(before);
    for (const value of [selected, selected.ships, entries, stock]) expect(Object.isFrozen(value)).toBe(false);
    for (const value of [model, model.origin, model.values, model.rows, ...model.rows, candidates, ...candidates]) expect(Object.isFrozen(value)).toBe(true);
    expect(model.origin).not.toBe(selected); expect(model.values).not.toBe(selected.ships);
    selected.name = "后来修改"; selected.revision++; selected.ships.small_cargo = 99; stock.small_cargo = 100; entries.length = 0;
    expect(model.origin).toEqual({ id: 7, revision: 3, name: "远征数量" });
    expect(model.values.small_cargo).toBe("20"); expect(model.rows[0]).toEqual({ unit: "small_cargo", target: 20, landed: 7, deficit: 13 });
    expect(candidates[0]).toEqual({ id: 7, revision: 3, name: "远征数量", index: 0 });
    expect(() => { (model.values as any).small_cargo = "99"; }).toThrow();
    const fresh = formation(); frozenTree(fresh);
    expect(buildNpcRehearsalFormationCopy(Object.freeze([fresh]), fresh, Object.freeze({}))).not.toBeNull();
  });

  it.each([0, -0, -1, .5, 1_000_001, 1e12, Number.MAX_SAFE_INTEGER, Infinity, NaN, "1", null, undefined, 1n])
  ("rejects noncanonical saved count %s instead of normalizing or clipping", count => {
    const selected = formation(); selected.ships.small_cargo = count;
    expect(listNpcRehearsalFormations([selected])).toEqual([]);
    expect(buildNpcRehearsalFormationCopy([selected], selected, {})).toBeNull();
  });

  it("retains canonical ID/revision/name boundaries, with no coercion or trimming", () => {
    const valid = formation(Number.MAX_SAFE_INTEGER - 1); valid.revision = Number.MAX_SAFE_INTEGER; valid.name = "🚀".repeat(64);
    expect(buildNpcRehearsalFormationCopy([valid], valid, {})).not.toBeNull();
    for (const [field, values] of Object.entries({
      id: [0, -1, 1.1, Number.MAX_SAFE_INTEGER, Infinity, "7", 7n],
      revision: [0, -1, .5, Number.MAX_SAFE_INTEGER + 1, Infinity, "3"],
      name: ["", " ", " 前导", "尾随 ", "x".repeat(65), "🚀".repeat(65), "内\n部", "\u007f", "\u009f", 7],
    })) for (const value of values) {
      const selected = formation(); selected[field] = value;
      expect(buildNpcRehearsalFormationCopy([selected], selected, {})).toBeNull();
    }
  });

  it.each(["solar_satellite", "rocket_launcher", "unknown", "__proto__", "constructor"])
  ("rejects unknown saved or inventory field %s even at zero", key => {
    const selected = formation(); Object.defineProperty(selected.ships, key, { value: 0, enumerable: true });
    expect(buildNpcRehearsalFormationCopy([selected], selected, {})).toBeNull();
    const good = formation(), stock = Object.create(null); stock[key] = 0;
    expect(buildNpcRehearsalFormationCopy([good], good, stock)).toBeNull();
  });

  it("rejects empty, extra or nested authority fields rather than stripping them", () => {
    for (const mutate of [
      (x: any) => { x.ships = {}; }, (x: any) => { x.planetId = "homeworld"; },
      (x: any) => { x.quote = null; }, (x: any) => { x.ships.light_fighter = { value: 3 }; },
      (x: any) => { x[Symbol("extra")] = 0; }, (x: any) => { x.ships[Symbol("extra")] = 0; },
    ]) {
      const selected = formation(); mutate(selected);
      expect(buildNpcRehearsalFormationCopy([selected], selected, {})).toBeNull();
    }
  });

  it.each(["id", "revision", "name", "ships"])("rejects malformed source %s descriptors without calling getters", key => {
    let calls = 0;
    for (const kind of ["missing", "hidden", "getter", "inherited"]) {
      const selected = formation(), value = selected[key]; delete selected[key];
      if (kind === "hidden") Object.defineProperty(selected, key, { value });
      if (kind === "getter") Object.defineProperty(selected, key, { enumerable: true, get() { calls++; return value; } });
      if (kind === "inherited") Object.setPrototypeOf(selected, { [key]: value });
      expect(listNpcRehearsalFormations([selected])).toEqual([]);
      expect(buildNpcRehearsalFormationCopy([selected], selected, {})).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it.each(["hole", "getter", "hidden", "prototype", "extra", "symbol", "method"])
  ("rejects malformed current array %s before iteration/accessors", kind => {
    let calls = 0;
    const selected = formation(), entries: any = [selected];
    if (kind === "hole") delete entries[0];
    if (kind === "getter") Object.defineProperty(entries, "0", { enumerable: true, get() { calls++; return selected; } });
    if (kind === "hidden") Object.defineProperty(entries, "0", { value: selected, enumerable: false });
    if (kind === "prototype") Object.setPrototypeOf(entries, Object.create(Array.prototype));
    if (kind === "extra") entries.extra = 0;
    if (kind === "symbol") entries[Symbol("extra")] = 0;
    if (kind === "method") Object.defineProperty(entries, "map", { get() { calls++; return () => []; } });
    expect(listNpcRehearsalFormations(entries)).toEqual([]);
    expect(buildNpcRehearsalFormationCopy(entries, selected, {})).toBeNull();
    expect(calls).toBe(0);
  });

  it.each(["ships", "stock"])("rejects nested %s accessor, hidden, symbol and prototype fields", location => {
    let calls = 0;
    for (const kind of ["getter", "hidden", "prototype", "symbol"]) {
      const selected = formation(), stock = { small_cargo: 7 }, value = location === "ships" ? selected.ships : stock;
      if (kind === "getter") Object.defineProperty(value, "small_cargo", { enumerable: true, get() { calls++; return 7; } });
      if (kind === "hidden") Object.defineProperty(value, "small_cargo", { value: 7, enumerable: false });
      if (kind === "prototype") Object.setPrototypeOf(value, { inherited: 1 });
      if (kind === "symbol") value[Symbol("extra")] = 0;
      expect(buildNpcRehearsalFormationCopy([selected], selected, stock)).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it.each([-1, .1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "7", undefined, null, 7n])
  ("rejects invalid landed count %s including unused ship types", value => {
    const selected = formation();
    expect(buildNpcRehearsalFormationCopy([selected], selected, { recycler: value })).toBeNull();
  });

  it("accepts strict null-prototype records and fails closed on unrelated malformed sources", () => {
    const selected = formation(), stock = Object.create(null);
    Object.setPrototypeOf(selected, null); Object.setPrototypeOf(selected.ships, null); stock.small_cargo = 7;
    expect(buildNpcRehearsalFormationCopy([selected], selected, stock)?.totalDeficit).toBe(17);
    const unrelated = formation(8); unrelated.extra = "do not skip me";
    expect(buildNpcRehearsalFormationCopy([selected, unrelated], selected, stock)).toBeNull();
    expect(listNpcRehearsalFormations([selected, unrelated])).toEqual([]);
    for (const invalid of [null, undefined, 1, "[]", {}, new Date(), new Set()]) {
      expect(listNpcRehearsalFormations(invalid)).toEqual([]);
      expect(buildNpcRehearsalFormationCopy(invalid, selected, stock)).toBeNull();
      if (invalid === null || typeof invalid !== "object" || Object.getPrototypeOf(invalid) !== Object.prototype)
        expect(buildNpcRehearsalFormationCopy([selected], selected, invalid)).toBeNull();
    }
    expect(Object.isFrozen(listNpcRehearsalFormations(null))).toBe(true);
  });

  it("catches hostile reflective failures and never invokes ordinary input property reads", () => {
    const selected = formation(); let gets = 0;
    const proxy = new Proxy(selected, { get() { gets++; throw Error("ordinary read forbidden"); } });
    expect(buildNpcRehearsalFormationCopy([proxy], proxy, {})?.total).toBe(24);
    expect(gets).toBe(0);
    const hostile = new Proxy(selected, { getOwnPropertyDescriptor() { throw Error("reflection failed"); } });
    expect(listNpcRehearsalFormations([hostile])).toEqual([]);
    expect(buildNpcRehearsalFormationCopy([hostile], hostile, {})).toBeNull();
    const revoked = Proxy.revocable([], {}); revoked.revoke();
    expect(listNpcRehearsalFormations(revoked.proxy)).toEqual([]);
  });

  it("has no world, economy, combat, quote, timer, persistence or execution authority", () => {
    for (const forbidden of ["GameState", "Decimal", "BigInt", "big(", "Math.random", "Date.now", "setTimeout", "setInterval",
      "quoteFlight", "rehearseNpcScout", "sendFleet", "createFormationReplenishment", "localStorage", "document.", "npcAt", "projectNpc"])
      expect(source).not.toContain(forbidden);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:decimal|fleet|npc-attack|npc-rehearsal|formations-save|orders)["']/);
  });
});
