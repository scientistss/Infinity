import { expectedFreshNpcWallet, expectedEmptyNpcBattles } from "./npc-wallet-expectations";
import { describe, expect, it } from "vitest";
import historical from "./fixtures/demolition-r10.json";
import { SAVE_REVISION, SAVE_SCHEMA, STORAGE_KEY } from "../src/game/content";
import { createNpcEconomyState } from "../src/game/npc-economy";
import { readNpcEconomy, rejectLegacyNpcEconomyFields, rejectMisplacedNpcEconomyFields, serializeNpcEconomy } from "../src/game/npc-economy-save";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";

const MODEL = "fixed-production-v1";
const current = () => JSON.parse(exportSave(createInitialState(20261010, 731), 4000, 3750));
const json = (raw: unknown) => importSave(JSON.stringify(raw));

describe("r13 exact NPC wallet persistence and historical r12 reader", () => {
  it("keeps the branch and storage key, and emits exactly one explicit age-zero object", () => {
    expect(SAVE_REVISION).toBe(16);
    expect(SAVE_SCHEMA).toBe("infinity-original-p4");
    expect(STORAGE_KEY).toBe("infinity.original-p4.save.v1");
    const raw = current();
    expect(raw.state.npcEconomy).toEqual(expectedFreshNpcWallet());
    expect(raw.state.npcBattles).toEqual(expectedEmptyNpcBattles());
    expect(Object.keys(raw.state.npcEconomy).sort()).toEqual(["baseline", "model", "now", "sites"]);
  });

  it.each([0, 0.25, 60, 7200, 9900, 10000, 11900])("round-trips age %s without rerolls or envelope clock changes", elapsedSeconds => {
    const raw = current(); raw.state.npcEconomy.now = elapsedSeconds;
    const accepted = json(raw), state = deserializeState(accepted.state);
    expect(accepted).toEqual(raw);
    expect(serializeState(state)).toEqual(accepted.state);
    expect(exportSave(state, accepted.savedAt, accepted.lastTickAt)).toBe(JSON.stringify(raw, null, 2));
    expect(json(accepted)).toEqual(accepted);
    expect(Object.isFrozen(state.npcEconomy)).toBe(true);
  });

  it.each([
    undefined, null, false, 0, "0", [], {},
    { elapsedSeconds: 0 }, { model: MODEL },
    { model: "future-ledger-v2", elapsedSeconds: 0 },
    { model: 1, elapsedSeconds: 0 },
    ...[undefined, null, false, "0", {}, [], -0.25, -1, 11900.25, Number.MAX_VALUE, NaN, Infinity, -Infinity]
      .map(elapsedSeconds => ({ model: MODEL, elapsedSeconds })),
    { model: MODEL, elapsedSeconds: 0, extra: null },
    { model: MODEL, elapsedSeconds: 0, resources: { metal: 500 } },
  ])("rejects invalid current object %j rather than silently initializing it", invalid => {
    const raw = current(); raw.state.npcEconomy = invalid;
    expect(() => deserializeState(raw.state)).toThrow(/NPC/);
    expect(() => json(raw)).toThrow(/NPC/);
    expect(() => readNpcEconomy(invalid)).toThrow(/NPC/);
    const runtime = createInitialState(8, 9); runtime.npcEconomy = invalid as any;
    expect(() => exportSave(runtime)).toThrow(/NPC/);
  });

  it("accepts null-prototype data, detaches it, and rejects inherited/hidden/symbol extras", () => {
    const nullPrototype = Object.assign(Object.create(null), createNpcEconomyState());
    const detached = readNpcEconomy(nullPrototype);
    expect(detached).toEqual(createNpcEconomyState()); expect(detached).not.toBe(nullPrototype);
    nullPrototype.elapsedSeconds = 20; expect(detached.elapsedSeconds).toBe(0);
    const inherited = Object.create(createNpcEconomyState());
    const hidden = { ...createNpcEconomyState() };
    Object.defineProperty(hidden, "ignored", { value: 0 });
    const symbolic = { ...createNpcEconomyState(), [Symbol("ignored")]: 0 };
    for (const value of [inherited, hidden, symbolic]) expect(() => readNpcEconomy(value)).toThrow(/NPC/);
    const state = current().state; delete state.npcEconomy;
    Object.setPrototypeOf(state, { npcEconomy: createNpcEconomyState() });
    expect(() => deserializeState(state)).toThrow(/NPC/);
  });

  it("rejects all accessor inputs without evaluating the getter", () => {
    let reads = 0;
    for (const key of ["model", "elapsedSeconds"]) {
      const economy = { ...createNpcEconomyState() };
      Object.defineProperty(economy, key, { get() { reads++; throw Error("must not execute"); } });
      expect(() => readNpcEconomy(economy)).toThrow(/NPC/);
      expect(() => serializeNpcEconomy(economy)).toThrow(/NPC/);
      const state = current().state; state.npcEconomy = economy;
      expect(() => deserializeState(state)).toThrow(/访问器/);
    }
    for (const key of ["npcEconomy", "unknown"]) {
      const state = current().state;
      Object.defineProperty(state, key, { get() { reads++; throw Error("must not execute"); } });
      expect(() => deserializeState(state)).toThrow(/访问器/);
    }
    expect(reads).toBe(0);
  });

  it.each(["envelope", "envelope-nested", "planet", "queue", "universe", "state-nested", "economy-nested"])("rejects misplaced dedicated fields at %s", site => {
    for (const marker of [null, 0, false, {}, [], createNpcEconomyState()]) {
      const raw = current();
      if (site === "envelope") raw.npcEconomy = marker;
      if (site === "envelope-nested") raw.unknown = { deep: [{ npcEconomy: marker }] };
      if (site === "planet") raw.state.planets[0].npcEconomy = marker;
      if (site === "queue") raw.state.planets[0].buildQueue.push({ npcEconomy: marker });
      if (site === "universe") raw.state.universe.npcEconomy = marker;
      if (site === "state-nested") raw.state.unknown = { deep: [{ npcEconomy: marker }] };
      if (site === "economy-nested") raw.state.npcEconomy.extra = { npcEconomy: marker };
      expect(() => json(raw)).toThrow(/NPC/);
    }
  });

  it("detects cycles and shared aliases without mistaking ordinary field names for NPC authority", () => {
    const raw = current(), shared = { npcEconomy: createNpcEconomyState() };
    raw.unknown = shared; raw.state.unknown = shared;
    expect(() => rejectMisplacedNpcEconomyFields(raw, true)).toThrow(/NPC/);
    const state = current().state; state.unknown = state;
    expect(() => deserializeState(state)).toThrow(/循环/);
    const valid = current(); valid.unknown = { model: MODEL, elapsedSeconds: 0 };
    valid.state.unknown = { model: "other-domain", elapsedSeconds: 42 };
    expect(() => json(valid)).not.toThrow();
    expect(() => rejectLegacyNpcEconomyFields({ model: MODEL, elapsedSeconds: 11900 })).not.toThrow();
  });
});

describe("r12 historical boundary and reserved marker", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])("rejects dedicated markers anywhere before reading claimed r%s", revision => {
    // These are attack derivatives, not fabricated historical provenance.
    for (const marker of [undefined, null, 0, false, {}, [], createNpcEconomyState()]) {
      for (const site of ["state", "planet", "state-nested", "envelope", "envelope-nested"]) {
        const raw = JSON.parse(historical.rows[0]!.raw); raw.revision = revision;
        if (site === "state") raw.state.npcEconomy = marker;
        if (site === "planet") raw.state.planets[0].npcEconomy = marker;
        if (site === "state-nested") raw.state.unknown = { deep: [{ npcEconomy: marker }] };
        if (site === "envelope") raw.npcEconomy = marker;
        if (site === "envelope-nested") raw.unknown = { deep: [{ npcEconomy: marker }] };
        expect(() => rejectLegacyNpcEconomyFields(raw)).toThrow(/r12/);
        // JSON cannot carry undefined; every representable derivative reaches importSave.
        if (marker !== undefined) expect(() => json(raw)).toThrow(/r12/);
      }
    }
  });

  it("requires current NPC data and rejects future, incompatible schema, and the other sector route", () => {
    const missing = current(); delete missing.state.npcEconomy;
    expect(() => json(missing)).toThrow(/NPC/);
    const future = current(); future.revision = 15;
    expect(() => json(future)).toThrow(/修订不兼容/);
    const incompatible = current(); incompatible.schema = "different-route";
    expect(() => json(incompatible)).toThrow(/分支/);
    const sector = { version: 9, revision: 6, schema: "infinity-sector", savedAt: 4000, state: { sector: {} } };
    expect(() => json(sector)).toThrow(/分支/);
  });
});
