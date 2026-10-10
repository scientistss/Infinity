import { describe, expect, it } from "vitest";
import archivedR8 from "./fixtures/building-templates-r8.json";
import { BUILDING_IDS } from "../src/data/buildings";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { createInitialState } from "../src/game/state";
import { exportSave, importSave, deserializeState, serializeState, BACKUP_KEY, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { readBuildingTemplates, serializeBuildingTemplates } from "../src/game/building-templates-save";
import { createBuildingTemplateState } from "../src/game/building-template-state";

function library(): any {
  return { nextTemplateId: 4, templates: [
    { id: 1, revision: 3, name: "合成目标 🚀", goals: [{ building: BUILDING_IDS[0], targetLevel: 4 }, { building: BUILDING_IDS[1], targetLevel: 1000 }] },
    { id: 3, revision: 1, name: "合成目标 🚀", goals: [{ building: BUILDING_IDS[0], targetLevel: 1 }] },
  ] };
}
function file(): any {
  const state = createInitialState(71);
  state.buildingTemplates = library();
  state.researchTemplates = { nextTemplateId: 5, templates: [
    { id: 4, revision: 2, name: "保留研究目标", goals: [{ tech: "energy_tech", targetLevel: 3 }] },
  ] };
  state.formations = { nextFormationId: 3, entries: [
    { id: 2, revision: 2, name: "已有运输编成", ships: { small_cargo: 7 } },
  ] };
  return JSON.parse(exportSave(state, 1000));
}
function read(value: any) { return importSave(JSON.stringify(value)); }

describe("r9 pure building-intent persistence", () => {
  it("round-trips the complete library and every unchanged world field", () => {
    const original = file(), imported = read(original);
    expect(imported.revision).toBe(9); expect(imported.revision).toBe(SAVE_REVISION);
    expect(imported.state).toEqual(original.state);
    expect(serializeState(deserializeState(imported.state))).toEqual(original.state);
    expect(read(imported)).toEqual(imported);
    expect(imported.state.buildingTemplates.templates[0]!.name).toBe(imported.state.buildingTemplates.templates[1]!.name);
  });
  it("deep-copies libraries, templates, goal arrays and every goal in both directions", () => {
    const input = library(), restored = readBuildingTemplates(input), serialized = serializeBuildingTemplates(restored);
    input.templates[0].goals[0].targetLevel = 99;
    input.templates[0].name = "changed";
    serialized.templates[0]!.goals[0]!.targetLevel = 2;
    serialized.templates[1]!.goals.push({ building: BUILDING_IDS[2]!, targetLevel: 1 });
    serialized.nextTemplateId = 12;
    expect(restored).toEqual(library());
    expect(restored.templates).not.toBe(serialized.templates);
    expect(restored.templates[0]).not.toBe(serialized.templates[0]);
    expect(restored.templates[0]!.goals).not.toBe(serialized.templates[0]!.goals);
  });
  it("accepts 64 Unicode code points, 16 canonical goals, 32 templates and exhausted counters", () => {
    const value = library();
    value.nextTemplateId = Number.MAX_SAFE_INTEGER;
    value.templates = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, revision: Number.MAX_SAFE_INTEGER,
      name: "🚀".repeat(64), goals: BUILDING_IDS.slice(0, 16).map(building => ({ building, targetLevel: 1000 })) }));
    expect(readBuildingTemplates(value)).toEqual(value);
    value.templates[31].id = Number.MAX_SAFE_INTEGER - 1;
    expect(readBuildingTemplates(value)).toEqual(value);
  });
  it.each(BUILDING_IDS)("accepts known building %s as intent regardless of current gameplay phase", building => {
    const value = library(); value.templates[0].goals = [{ building, targetLevel: 1000 }];
    expect(readBuildingTemplates(value)).toEqual(value);
  });
  it("accepts an explicitly empty library without creating work or advancing its counter", () => {
    const value = file(); value.state.buildingTemplates = createBuildingTemplateState();
    expect(read(value).state).toEqual(value.state);
  });
  it("ignores JSON object key order while preserving canonical goal array order", () => {
    const value = library();
    value.templates[0].goals[0] = { targetLevel: 4, building: BUILDING_IDS[0] };
    expect(readBuildingTemplates(value)).toEqual(library());
  });
  it.each([
    ["missing", (_v: any): undefined => undefined], ["null", (_v: any): null => null], ["array", (_v: any) => []],
    ["missing counter", (v: any) => { delete v.nextTemplateId; return v; }],
    ["zero counter", (v: any) => { v.nextTemplateId = 0; return v; }],
    ["fractional counter", (v: any) => { v.nextTemplateId = 4.5; return v; }],
    ["unsafe counter", (v: any) => { v.nextTemplateId = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["stale counter", (v: any) => { v.nextTemplateId = 3; return v; }],
    ["numeric-string counter", (v: any) => { v.nextTemplateId = "4"; return v; }],
    ["missing templates", (v: any) => { delete v.templates; return v; }],
    ["33 templates", (v: any) => { v.templates = Array.from({ length: 33 }, (_, i) => ({ ...v.templates[0], id: i + 1 })); v.nextTemplateId = 34; return v; }],
    ["library authority", (v: any) => { v.runId = 1; return v; }],
    ["zero id", (v: any) => { v.templates[0].id = 0; return v; }],
    ["duplicate id", (v: any) => { v.templates[1].id = 1; return v; }],
    ["issued exhausted id", (v: any) => { v.nextTemplateId = Number.MAX_SAFE_INTEGER; v.templates[0].id = Number.MAX_SAFE_INTEGER; return v; }],
    ["missing revision", (v: any) => { delete v.templates[0].revision; return v; }],
    ["zero revision", (v: any) => { v.templates[0].revision = 0; return v; }],
    ["unsafe revision", (v: any) => { v.templates[0].revision = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["fractional revision", (v: any) => { v.templates[0].revision = 1.5; return v; }],
    ["empty name", (v: any) => { v.templates[0].name = ""; return v; }],
    ["untrimmed name", (v: any) => { v.templates[0].name = " name "; return v; }],
    ["65 codepoints", (v: any) => { v.templates[0].name = "🚀".repeat(65); return v; }],
    ["control", (v: any) => { v.templates[0].name = "name\u0085"; return v; }],
    ["empty goals", (v: any) => { v.templates[0].goals = []; return v; }],
    ["17 goals", (v: any) => { v.templates[0].goals = BUILDING_IDS.slice(0, 17).map(building => ({ building, targetLevel: 1 })); return v; }],
    ["duplicate building", (v: any) => { v.templates[0].goals[1].building = BUILDING_IDS[0]; return v; }],
    ["unsorted goals", (v: any) => { v.templates[0].goals.reverse(); return v; }],
    ["unknown building", (v: any) => { v.templates[0].goals[0].building = "unknown"; return v; }],
    ["missing target", (v: any) => { delete v.templates[0].goals[0].targetLevel; return v; }],
    ["zero target", (v: any) => { v.templates[0].goals[0].targetLevel = 0; return v; }],
    ["fractional target", (v: any) => { v.templates[0].goals[0].targetLevel = 1.5; return v; }],
    ["1001 target", (v: any) => { v.templates[0].goals[0].targetLevel = 1001; return v; }],
  ] as const)("rejects %s without manufacturing a fresh library", (_label, mutate) => {
    const value = file(); value.state.buildingTemplates = mutate(library());
    expect(() => read(value)).toThrow();
  });
  it.each(["planetId", "payer", "budget", "charged", "refunded", "taskId", "runId", "status", "transport", "currentWork"])("rejects %s at all template data boundaries", key => {
    for (const location of ["library", "template", "goal"]) {
      const value = library();
      const target = location === "library" ? value : location === "template" ? value.templates[0] : value.templates[0].goals[0];
      target[key] = null;
      expect(() => readBuildingTemplates(value), location).toThrow();
      expect(() => serializeBuildingTemplates(value), location).toThrow();
    }
  });
  it("rejects symbolic or inherited live fields instead of stripping them on save", () => {
    const symbolic = library(); symbolic.templates[0][Symbol("payer")] = "homeworld";
    expect(() => serializeBuildingTemplates(symbolic)).toThrow();
    const inherited = library(); Object.setPrototypeOf(inherited, { runId: 1 });
    expect(() => serializeBuildingTemplates(inherited)).toThrow();
  });
  it.each(["templates", "goals"] as const)("rejects sparse %s arrays without changing their holes or surviving entries", location => {
    for (const kind of ["empty-slot", "deleted-entry", "inherited-entry"] as const) {
      const value = library(), parent = location === "templates" ? value : value.templates[0];
      const original = parent[location];
      const entries = kind === "empty-slot" ? Array(1) : [...original];
      if (kind !== "empty-slot") delete entries[0];
      if (kind === "inherited-entry") Object.setPrototypeOf(entries, Object.assign(Object.create(Array.prototype), { 0: original[0] }));
      parent[location] = entries;
      const beforeKeys = Reflect.ownKeys(entries), beforeLength = entries.length, beforePrototype = Object.getPrototypeOf(entries);
      const retained = entries[1], retainedValue = structuredClone(retained);
      expect(() => readBuildingTemplates(value), kind).toThrow("建筑模板");
      expect(() => serializeBuildingTemplates(value), kind).toThrow("建筑模板");
      const state = createInitialState(71); state.buildingTemplates = value;
      expect(() => exportSave(state, 1000), kind).toThrow("建筑模板");
      expect(parent[location]).toBe(entries);
      expect(Reflect.ownKeys(entries)).toEqual(beforeKeys);
      expect(entries.length).toBe(beforeLength);
      expect(Object.getPrototypeOf(entries)).toBe(beforePrototype);
      expect(Object.hasOwn(entries, 0)).toBe(false);
      expect(entries[1]).toBe(retained);
      expect(entries[1]).toEqual(retainedValue);
      expect(value.nextTemplateId).toBe(4);
    }
  });
  it("requires the r9 field even for an otherwise empty new game", () => {
    const value = JSON.parse(exportSave(createInitialState(71), 1000)); delete value.state.buildingTemplates;
    expect(() => read(value)).toThrow("建筑模板");
  });
});


const NOW = 1000;
const money = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
/** Synthetic boundary fixture; actual source-generated r8 evidence lives in check-order-migration.mjs. */
function legacy(revision: 2 | 3 | 4 | 5 | 6 | 7 | 8): any {
  const value = file();
  value.revision = revision;
  delete value.state.buildingTemplates;
  if (revision < 8) delete value.state.formations;
  if (revision < 7) delete value.state.researchTemplates;
  if (revision < 6) delete value.state.orders.nextWorkId;
  if (revision < 5) delete value.state.orders;
  if (revision < 4) { delete value.state.arcade.nextRunId; delete value.state.arcade.autoBatch; }
  if (revision === 2) delete value.state.deepSpace;
  return value;
}
/** Independent synthetic r8 audit snapshot with formation and manual paid identities/timers. */
function paidR8(): any {
  const value = legacy(8), planet = value.state.planets[0];
  planet.units.small_cargo = 1;
  // This prior completed ship has already earned its ordinary achievement reward.
  value.state.unlocked = ["first_ship"];
  value.state.darkMatter = "500";
  value.state.stats.darkMatterEarned = 500;
  planet.shipyardQueue = [{ jobId: 1, taskId: 1, source: "plan", unit: "small_cargo", count: 3,
    orderedCount: 4, paidPerUnit: money("7", "11", "13"), progress: 0.375 }];
  planet.buildQueue = [{ building: "metal_mine", targetLevel: 1, paid: money("60", "15"),
    totalSeconds: 50, remainingSeconds: 31.25, source: "manual", jobId: 2, taskId: null }];
  value.state.research.queue = [{ planetId: planet.id, tech: "energy_tech", targetLevel: 1,
    paid: money("0", "800", "400"), totalSeconds: 200, remainingSeconds: 161.5,
    source: "manual", jobId: 3, taskId: null }];
  value.state.orders = { nextTaskId: 2, nextJobId: 4, nextWorkId: 11, accumulator: 0.375, tasks: [
    { id: 1, kind: "shipyard", planetId: planet.id, unit: "small_cargo", quantity: 4, status: "running", reason: "",
      budget: money("28", "44", "52"), charged: money("28", "44", "52"), refunded: money(),
      activeJob: { jobId: 1, quantity: 4, credited: 1 }, completedUnits: 1,
      transport: null, currentWork: null, formationOrigin: {
        formation: { id: 2, revision: 1, name: "旧运输编成", ships: { small_cargo: 5 } },
        quotedUnitCost: money("7", "11", "13"),
      } },
  ] };
  return value;
}
class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  writes: string[] = [];
  write: ((key: string, value: string) => void) | undefined;
  read: ((key: string) => void) | undefined;
  constructor(raw: string) { this.data.set(STORAGE_KEY, raw); }
  getItem(key: string) { this.read?.(key); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.write?.(key, value); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("r9 additive migration boundaries", () => {
  it.each([2, 3, 4, 5, 6, 7, 8] as const)("adds only empty building intent after genuine r%d shape validation", revision => {
    const source = legacy(revision), original = structuredClone(source), imported = read(source);
    expect(source).toEqual(original);
    expect(imported.state.buildingTemplates).toEqual(createBuildingTemplateState());
    expect(imported.state.orders.tasks).toEqual([]);
    if (revision >= 7) expect(imported.state.researchTemplates).toEqual(source.state.researchTemplates);
    if (revision === 8) {
      const { buildingTemplates: _templates, ...projection } = imported.state;
      expect(projection).toEqual(source.state);
    }
    expect(read(imported)).toEqual(imported);
  });
  it.each([2, 3, 4, 5, 6, 7, 8] as const)("rejects nested, empty and null building metadata on r%d", revision => {
    for (const injected of [null, {}, [], createBuildingTemplateState(), library()]) {
      for (const location of ["state", "planet", "nested-array"]) {
        const source = legacy(revision);
        const target = location === "state" ? source.state : location === "planet" ? source.state.planets[0] :
          (source.state.unknown = [{ nested: {} }])[0].nested;
        target.buildingTemplates = injected;
        expect(() => read(source), location).toThrow("不能夹带 r9");
      }
    }
  });
  it("does not confuse genuine r7/r8 research nextTemplateId with new building metadata", () => {
    for (const revision of [7, 8] as const) {
      const source = legacy(revision);
      expect(read(source).state.researchTemplates).toEqual(source.state.researchTemplates);
      expect(read(source).state.buildingTemplates.nextTemplateId).toBe(1);
    }
  });
  it("preserves every r8 formation origin, research intent, paid identity, counter and timer", () => {
    const source = paidR8(), before = structuredClone(source), migrated = read(source);
    const { buildingTemplates, ...projection } = migrated.state;
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(projection).toEqual(source.state);
    expect(source).toEqual(before);
    expect(read(migrated)).toEqual(migrated);
    expect(serializeState(deserializeState(migrated.state))).toEqual(migrated.state);
    expect(migrated.state.orders.tasks[0]!.formationOrigin).not.toBeNull();
  });
  it("validates r8 order subformat 8 instead of silently fabricating required origins", () => {
    const source = paidR8(); delete source.state.orders.tasks[0].formationOrigin;
    expect(() => read(source)).toThrow();
    source.state.orders.tasks[0].formationOrigin = null;
    expect(() => read(source)).not.toThrow();
    delete source.state.formations;
    expect(() => read(source)).toThrow();
  });
  it("preserves the original r8 bytes before upgrade and describes retained libraries accurately", () => {
    const source = paidR8(), raw = JSON.stringify(source), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("ready");
    expect(store.getItem(BACKUP_KEY)).toBe(raw);
    expect(store.writes).toEqual([BACKUP_KEY, STORAGE_KEY]);
    const { buildingTemplates, ...projection } = serializeState(session.loaded.state);
    expect(projection).toEqual(source.state);
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(session.notice).toContain("已有命名编成与计划来源完整保留");
    expect(session.notice).toContain("已有研究模板完整保留");
    expect(session.notice).toContain("建筑模板为空");
    expect(session.notice).not.toContain("命名编成为空");
    expect(importSave(store.getItem(STORAGE_KEY)!).revision).toBe(9);
  });
  it.each(["backup-write", "backup-read", "current-write", "current-read"])("freezes rich r8 progress and exports original bytes after %s failure", fault => {
    const source = paidR8(), raw = JSON.stringify(source), store = new MemoryStore(raw);
    store.write = key => {
      if ((fault === "backup-write" && key === BACKUP_KEY) || (fault === "current-write" && key === STORAGE_KEY)) throw Error("write denied");
    };
    store.read = key => {
      if ((fault === "backup-read" && key === BACKUP_KEY && store.data.has(BACKUP_KEY)) ||
          (fault === "current-read" && key === STORAGE_KEY && store.writes.includes(STORAGE_KEY))) throw Error("read denied");
    };
    const session = new SaveSession(store, NOW + 5000);
    expect(session.mode).toBe("protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    const { buildingTemplates, ...projection } = serializeState(session.loaded.state);
    expect(projection).toEqual(source.state);
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(session.export(session.loaded.state, NOW)).toEqual({ raw, protected: true });
    expect(session.save(session.loaded.state, NOW)).toMatchObject({ ok: false });
    if (fault !== "current-read") expect(store.data.get(STORAGE_KEY)).toBe(raw);
    if (fault.startsWith("current")) expect(store.data.get(BACKUP_KEY)).toBe(raw);
  });
});

describe("r9 session validation and replacement", () => {
  it.each(["missing", "malformed", "authority"])("protects %s current library bytes without any writes", kind => {
    const value = file();
    if (kind === "missing") delete value.state.buildingTemplates;
    if (kind === "malformed") value.state.buildingTemplates.templates[0].goals[0].targetLevel = -1;
    if (kind === "authority") value.state.buildingTemplates.templates[0].payer = "homeworld";
    const raw = JSON.stringify(value), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.save(createInitialState(71), NOW)).toMatchObject({ ok: false });
    expect(session.export(createInitialState(71), NOW)).toEqual({ raw, protected: true });
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.writes).toEqual([]);
  });
  it("invalid imports and autosaves cannot mutate current bytes or a valid live library", () => {
    const raw = JSON.stringify(file()), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    const original = serializeState(session.loaded.state), invalid = file();
    invalid.state.buildingTemplates.nextTemplateId = 1;
    expect(session.importText(JSON.stringify(invalid), NOW)).toMatchObject({ ok: false, code: "invalid" });
    expect(serializeState(session.loaded.state)).toEqual(original);
    const malformed = deserializeState(original); malformed.buildingTemplates.templates[0]!.revision = 0;
    expect(session.save(malformed, NOW)).toMatchObject({ ok: false, code: "invalid" });
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.writes).toEqual([]);
    expect(session.mode).toBe("ready");
  });
  it("replaces libraries without merging template IDs and resets them after verified writes", () => {
    const raw = JSON.stringify(file()), store = new MemoryStore(raw), session = new SaveSession(store, NOW), incoming = file();
    incoming.state.buildingTemplates = { nextTemplateId: 2, templates: [
      { id: 1, revision: 1, name: "替换建筑库", goals: [{ building: "solar_plant", targetLevel: 7 }] },
    ] };
    const imported = session.importText(JSON.stringify(incoming), NOW);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw Error(imported.message);
    expect(imported.state.buildingTemplates).toEqual(incoming.state.buildingTemplates);
    expect(store.getItem(BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).state.buildingTemplates).toEqual(incoming.state.buildingTemplates);
    const reset = session.reset(NOW);
    expect(reset.ok).toBe(true);
    if (!reset.ok) throw Error(reset.message);
    expect(reset.state.buildingTemplates).toEqual(createBuildingTemplateState());
    expect(JSON.parse(store.getItem(STORAGE_KEY)!).state.buildingTemplates).toEqual(createBuildingTemplateState());
  });
});


describe("pinned source-generated r8 migration", () => {
  it.each(["outbound", "returning"] as const)("preserves the actual archived %s envelope with only an empty r9 library", phase => {
    expect(archivedR8.sourceSha).toBe("4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b");
    const source: any = structuredClone(archivedR8.fixtures[phase]), before = structuredClone(source);
    expect(source.revision).toBe(8);
    expect(source.state).not.toHaveProperty("buildingTemplates");
    expect(source.state.researchTemplates.templates).toHaveLength(2);
    expect(source.state.formations.entries[0].revision).toBe(2);
    expect(source.state.orders.tasks.at(-1).formationOrigin.formation.revision).toBe(1);
    expect(source.state.orders.tasks.at(-1).completedUnits).toBe(2);
    expect(source.state.planets[0].shipyardQueue[0].count).toBe(5);
    expect(source.state.planets[1].shipyardQueue[0].count).toBe(1);
    expect(source.state.research.queue[0].source).toBe("plan");
    expect(source.state.orders.tasks[0].transport.trips[0].phase.kind).toBe(phase);
    expect(source.state.fleets).toHaveLength(1);
    const migrated = read(source), { buildingTemplates, ...projection } = migrated.state;
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(projection).toEqual(source.state);
    expect(source).toEqual(before);
    expect(migrated.savedAt).toBe(source.savedAt);
    expect(migrated.lastTickAt).toBe(source.lastTickAt);
    expect(read(migrated)).toEqual(migrated);
    expect(exportSave(deserializeState(migrated.state), migrated.savedAt, migrated.lastTickAt)).toBe(JSON.stringify(migrated, null, 2));
  });
  it.each(["outbound", "returning"] as const)("backs up exact historical %s bytes before its verified upgrade", phase => {
    const source = archivedR8.fixtures[phase], raw = JSON.stringify(source, null, 2), store = new MemoryStore(raw);
    const session = new SaveSession(store, source.lastTickAt);
    expect(session.mode).toBe("ready");
    expect(store.getItem(BACKUP_KEY)).toBe(raw);
    expect(store.writes).toEqual([BACKUP_KEY, STORAGE_KEY]);
    const { buildingTemplates, ...projection } = serializeState(session.loaded.state);
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(projection).toEqual(source.state);
  });
  it.each(["outbound", "returning"] as const)("keeps actual %s receipts and queues frozen when backup fails", phase => {
    const source = archivedR8.fixtures[phase], raw = JSON.stringify(source, null, 2), store = new MemoryStore(raw);
    store.write = () => { throw Error("backup quota"); };
    const session = new SaveSession(store, source.lastTickAt + 5000);
    expect(session.mode).toBe("protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    const { buildingTemplates, ...projection } = serializeState(session.loaded.state);
    expect(buildingTemplates).toEqual(createBuildingTemplateState());
    expect(projection).toEqual(source.state);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
    expect(session.save(session.loaded.state)).toMatchObject({ ok: false });
  });
});
