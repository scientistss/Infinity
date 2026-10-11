import { stripVerifiedNpcMetadata } from "./helpers";
import { describe, expect, it } from "vitest";
import historical from "./fixtures/terraformer-r9.json";
import archivedR8 from "./fixtures/building-templates-r8.json";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyTickLog, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { BACKUP_KEY, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";
import { readTerraformerFields, readTerraformerGrantJobFloor } from "../src/game/terraformer-save";

function current(): any { return JSON.parse(exportSave(createInitialState(123, 456), 1000, 900)); }
function read(file: any) { return importSave(JSON.stringify(file)); }
function projection(state: any): any {
  const verified = structuredClone(state);
  stripVerifiedNpcMetadata(verified, 0);
  const { terraformerGrantJobFloor: _floor, ...rest } = verified;
  return { ...rest, planets: verified.planets.map((planet: any) => {
    expect(Object.hasOwn(planet, "demolition")).toBe(true);
    expect(planet.demolition).toBeNull();
    const { terraformerFields: _fields, demolition: _demolition, ...old } = planet;
    return old;
  }) };
}
function historicalRow(name: string) {
  const row = historical.rows.find(value => value.name === name);
  if (!row) throw Error(`Missing fixed historical fixture ${name}`);
  return row;
}
function paidBuilding(jobId: number, building = "terraformer", targetLevel = 1): any {
  return { jobId, taskId: null, building, targetLevel, paid: { metal: "0", crystal: "50000", deuterium: "100000" },
    totalSeconds: 10, remainingSeconds: 4, source: "manual" };
}
function paidResearch(jobId: number): any {
  return { jobId, taskId: null, planetId: "homeworld", tech: "energy_tech", targetLevel: 1,
    paid: { metal: "0", crystal: "800", deuterium: "400" }, totalSeconds: 10, remainingSeconds: 4, source: "manual" };
}
function paidShipyard(jobId: number): any {
  return { jobId, taskId: null, unit: "light_fighter", count: 100, orderedCount: 100,
    paidPerUnit: { metal: "3000", crystal: "1000", deuterium: "0" }, progress: 0.5, source: "manual" };
}
function grant(file: any, count: number) {
  const planet = file.state.planets[0];
  planet.buildings.terraformer = count;
  planet.terraformerFields.grantedLevels = count;
  planet.fieldsMax = planet.terraformerFields.base + 5 * count;
}

class MemoryStore implements KeyValueStore {
  values = new Map<string, string>();
  events: string[] = [];
  fault: "none" | "backup-write" | "backup-read" | "primary-write" | "primary-read" = "none";
  constructor(raw: string) { this.values.set(STORAGE_KEY, raw); }
  getItem(key: string): string | null {
    this.events.push(`read:${key}`);
    if (this.fault === "backup-read" && key === BACKUP_KEY && this.values.has(key)) return "different backup bytes";
    if (this.fault === "primary-read" && key === STORAGE_KEY && this.events.includes(`write:${STORAGE_KEY}`)) return "different committed bytes";
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.events.push(`write:${key}`);
    if (this.fault === "backup-write" && key === BACKUP_KEY || this.fault === "primary-write" && key === STORAGE_KEY) throw Error("synthetic quota failure");
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("strict r10 terraformer field accounting", () => {
  it("starts at 163/0 with floor 1 and round-trips without a grant", () => {
    const file = current(), restored = read(file);
    expect(restored.revision).toBe(13); expect(SAVE_REVISION).toBe(13);
    expect(restored.state.terraformerGrantJobFloor).toBe(1);
    expect(restored.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    expect(restored).toEqual(file);
    expect(serializeState(deserializeState(restored.state))).toEqual(restored.state);
  });
  it("stores completed grants exactly and never grants again on repeated import", () => {
    const file = current(); grant(file, 2); file.state.orders.nextJobId = 3;
    const first = read(file), second = read(first), third = read(second);
    expect(first).toEqual(file); expect(second).toEqual(first); expect(third).toEqual(first);
    expect(third.state.planets[0]!.fieldsMax).toBe(173);
  });
  it("preserves a real paid completion through verified r10 writes and strict cold reads", () => {
    // Synthetic prerequisites only: payment, timing and grants use production paths.
    const state = createInitialState(123, 456), planet = activePlanet(state);
    planet.buildings.nanite_factory = 1;
    state.research.levels.energy_tech = 12;
    planet.tempMax = 10;
    planet.units.solar_satellite = 100;
    planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
    const paid = enqueue(state, "terraformer", "manual");
    expect(paid.ok, paid.reason).toBe(true);
    expect(activePlanet(paid.state).resources.crystal.toNumber()).toBe(950000);
    expect(activePlanet(paid.state).resources.deuterium.toNumber()).toBe(900000);
    expect(activePlanet(paid.state).terraformerFields).toEqual({ base: 163, grantedLevels: 0 });

    const originalBackup = historicalRow("continuous_manual").raw;
    const store = new MemoryStore(exportSave(paid.state, 1000));
    store.values.set(BACKUP_KEY, originalBackup);
    const session = new SaveSession(store, 1000), log = emptyTickLog();
    expect(session.mode).toBe("ready");
    const seconds = Math.ceil(activePlanet(session.loaded.state).buildQueue[0]!.remainingSeconds);
    const completed = tick(session.loaded.state, seconds, "live", log);
    const now = 1000 + seconds * 1000;
    expect(log.completedBuilds).toEqual([{ building: "terraformer", level: 1 }]);
    expect(activePlanet(completed).buildQueue).toHaveLength(0);
    expect(activePlanet(completed).terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(activePlanet(completed).fieldsMax).toBe(168);
    expect(completed.terraformerGrantJobFloor).toBe(1);
    expect(completed.orders.nextJobId).toBe(2);

    store.events.length = 0;
    expect(session.save(completed, now)).toEqual({ ok: true });
    const write = store.events.indexOf(`write:${STORAGE_KEY}`);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(store.events.slice(write + 1)).toContain(`read:${STORAGE_KEY}`);
    const raw = store.values.get(STORAGE_KEY)!;
    expect(raw).toBe(exportSave(completed, now));
    const restored = importSave(raw);
    expect(restored).toEqual(JSON.parse(raw));
    expect(serializeState(deserializeState(restored.state))).toEqual(serializeState(completed));
    expect(importSave(JSON.stringify(restored))).toEqual(restored);

    store.events.length = 0;
    const cold = new SaveSession(store, now);
    expect(cold.mode).toBe("ready");
    expect(cold.loaded.completedBuilds).toHaveLength(0);
    expect(serializeState(cold.loaded.state)).toEqual(restored.state);
    expect(store.values.get(STORAGE_KEY)).toBe(raw);
    expect(store.values.get(BACKUP_KEY)).toBe(originalBackup);
    expect(store.events.some(event => event.startsWith("write:"))).toBe(false);
  });
  it.each([
    ["missing floor", (f: any) => { delete f.state.terraformerGrantJobFloor; }],
    ["null floor", (f: any) => { f.state.terraformerGrantJobFloor = null; }],
    ["string floor", (f: any) => { f.state.terraformerGrantJobFloor = "1"; }],
    ["zero floor", (f: any) => { f.state.terraformerGrantJobFloor = 0; }],
    ["fractional floor", (f: any) => { f.state.terraformerGrantJobFloor = 1.5; }],
    ["future floor", (f: any) => { f.state.terraformerGrantJobFloor = 2; }],
    ["unsafe floor", (f: any) => { f.state.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER + 1; }],
    ["missing ledger", (f: any) => { delete f.state.planets[0].terraformerFields; }],
    ["null ledger", (f: any) => { f.state.planets[0].terraformerFields = null; }],
    ["array ledger", (f: any) => { f.state.planets[0].terraformerFields = []; }],
    ["missing base", (f: any) => { delete f.state.planets[0].terraformerFields.base; }],
    ["missing grant count", (f: any) => { delete f.state.planets[0].terraformerFields.grantedLevels; }],
    ["unknown ledger field", (f: any) => { f.state.planets[0].terraformerFields.lastJobId = 1; }],
    ["zero base", (f: any) => { f.state.planets[0].terraformerFields.base = 0; }],
    ["overlimit base", (f: any) => { f.state.planets[0].terraformerFields.base = 10001; }],
    ["fractional base", (f: any) => { f.state.planets[0].terraformerFields.base = 163.5; }],
    ["string base", (f: any) => { f.state.planets[0].terraformerFields.base = "163"; }],
    ["negative grants", (f: any) => { f.state.planets[0].terraformerFields.grantedLevels = -1; }],
    ["fractional grants", (f: any) => { f.state.planets[0].terraformerFields.grantedLevels = 0.5; }],
    ["unsafe grants", (f: any) => { f.state.planets[0].terraformerFields.grantedLevels = Number.MAX_SAFE_INTEGER + 1; }],
    ["string grants", (f: any) => { f.state.planets[0].terraformerFields.grantedLevels = "0"; }],
    ["mismatched field equation", (f: any) => { f.state.planets[0].fieldsMax = 164; }],
    ["missing fieldsMax", (f: any) => { delete f.state.planets[0].fieldsMax; }],
    ["more grants than levels", (f: any) => { grant(f, 1); f.state.planets[0].buildings.terraformer = 0; f.state.orders.nextJobId = 2; }],
    ["unissued grant", (f: any) => { grant(f, 1); }],
    ["field total above cap", (f: any) => { grant(f, 1); f.state.planets[0].terraformerFields.base = 9996; f.state.planets[0].fieldsMax = 10001; f.state.orders.nextJobId = 2; }],
  ] as const)("rejects %s without refilling metadata", (_label, mutate) => {
    const file = current(); mutate(file); const before = structuredClone(file);
    expect(() => read(file)).toThrow(); expect(file).toEqual(before);
  });
  it("uses own exact ledger keys and rejects inherited, symbol or nonfinite data", () => {
    expect(() => readTerraformerFields(Object.create({ base: 163, grantedLevels: 0 }))).toThrow();
    expect(() => readTerraformerFields({ base: 163, grantedLevels: 0, [Symbol("extra")]: true })).toThrow();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => readTerraformerFields({ base: bad, grantedLevels: 0 })).toThrow();
      expect(() => readTerraformerFields({ base: 163, grantedLevels: bad })).toThrow();
      expect(() => readTerraformerGrantJobFloor(bad, Number.MAX_SAFE_INTEGER)).toThrow();
    }
  });
  it("accepts an exhausted empty floor and the last issued job below the sentinel", () => {
    const file = current(); file.state.orders.nextJobId = Number.MAX_SAFE_INTEGER;
    file.state.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER;
    expect(read(file)).toEqual(file);
    file.state.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER - 1;
    file.state.planets[0].buildQueue = [paidBuilding(Number.MAX_SAFE_INTEGER - 1)];
    expect(read(file)).toEqual(file);
    file.state.planets[0].buildQueue[0].jobId = Number.MAX_SAFE_INTEGER;
    expect(() => read(file)).toThrow();
  });
  it.each(["building", "research", "shipyard"] as const)("counts current %s paid identity against already granted issuance", kind => {
    const file = current(); grant(file, 1); file.state.orders.nextJobId = 2;
    if (kind === "building") file.state.planets[0].buildQueue = [paidBuilding(1, "metal_mine")];
    if (kind === "research") file.state.research.queue = [paidResearch(1)];
    if (kind === "shipyard") file.state.planets[0].shipyardQueue = [paidShipyard(1)];
    expect(() => read(file)).toThrow();
    file.state.orders.nextJobId = 3;
    expect(read(file).state.planets[0]!.terraformerFields.grantedLevels).toBe(1);
  });
  it("counts a hundred-unit shipyard batch once, and all paid kinds across one issuance bound", () => {
    const file = current(); grant(file, 1); file.state.orders.nextJobId = 5;
    file.state.planets[0].buildQueue = [paidBuilding(1, "metal_mine")];
    file.state.research.queue = [paidResearch(2)];
    file.state.planets[0].shipyardQueue = [paidShipyard(3)];
    expect(read(file).state.planets[0]!.shipyardQueue[0]!.count).toBe(100);
    file.state.orders.nextJobId = 4;
    expect(() => read(file)).toThrow();
  });
  it("rejects a paid identity reused across queue kinds and stale counters", () => {
    const file = current(); file.state.orders.nextJobId = 3;
    file.state.planets[0].buildQueue = [paidBuilding(1, "metal_mine")];
    file.state.research.queue = [paidResearch(1)];
    expect(() => read(file)).toThrow();
    file.state.research.queue[0].jobId = 2;
    expect(() => read(file)).not.toThrow();
    file.state.orders.nextJobId = 2;
    expect(() => read(file)).toThrow();
  });
  it("requires genuine consecutive new terra targets while preserving the historical branch", () => {
    const file = current(); file.state.planets[0].buildings.terraformer = 2;
    file.state.orders.nextJobId = 3;
    file.state.planets[0].buildQueue = [paidBuilding(1, "terraformer", 3), paidBuilding(2, "terraformer", 4)];
    expect(() => read(file)).not.toThrow();
    for (const targets of [[3, 3], [3, 5], [2, 3], [7, 8]]) {
      const candidate = structuredClone(file);
      candidate.state.planets[0].buildQueue.forEach((job: any, index: number) => { job.targetLevel = targets[index]; });
      expect(() => read(candidate)).toThrow();
      candidate.state.terraformerGrantJobFloor = 3;
      expect(() => read(candidate)).not.toThrow();
    }
    file.state.terraformerGrantJobFloor = 2;
    expect(() => read(file)).toThrow();
  });
  it("reserves exactly five fields per new pending terra job without granting early", () => {
    const file = current(); file.state.orders.nextJobId = 3;
    const planet = file.state.planets[0]; planet.fieldsMax = 9990; planet.terraformerFields.base = 9990;
    planet.buildQueue = [paidBuilding(1), paidBuilding(2, "terraformer", 2)];
    expect(read(file).state.planets[0]!.fieldsMax).toBe(9990);
    planet.fieldsMax = 9991; planet.terraformerFields.base = 9991;
    expect(() => read(file)).toThrow();
    planet.buildQueue.pop(); planet.fieldsMax = 9995; planet.terraformerFields.base = 9995;
    expect(() => read(file)).not.toThrow();
    planet.fieldsMax = 9996; planet.terraformerFields.base = 9996;
    expect(() => read(file)).toThrow();
  });
  it("does not impose a new global used-fields or ordinary-target continuity rule", () => {
    const file = current(), planet = file.state.planets[0];
    planet.fieldsMax = 1; planet.terraformerFields.base = 1; planet.buildings.metal_mine = 100;
    planet.buildQueue = [paidBuilding(1, "metal_mine", 1), paidBuilding(2, "metal_mine", 999)];
    file.state.orders.nextJobId = 3;
    expect(() => read(file)).not.toThrow();
  });
});

describe("fixed historical r9 to r10 additive migration", () => {
  it("records the immutable oracle and labels synthetic inputs", async () => {
    const { createHash } = await import("node:crypto" as string);
    expect(historical.sourceSha).toBe("f96894eb1b32737ab403890ed83fdb3da41a0644");
    expect(historical.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of historical.rows) {
      expect(row.synthetic).toBe(true); expect(row.rawSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(createHash("sha256").update(row.raw).digest("hex")).toBe(row.rawSha256);
      expect(JSON.parse(row.raw).revision).toBe(9); expect(row.oldReaderOutput.revision).toBe(9);
      expect(JSON.parse(row.raw).state).not.toHaveProperty("terraformerGrantJobFloor");
      if (row.canonical) expect(JSON.parse(row.raw)).toEqual(row.oldReaderOutput);
    }
  });
  it.each(historical.rows)("preserves the old reader's complete semantic output: $name", row => {
    const migrated = importSave(row.raw);
    expect(migrated.revision).toBe(13);
    expect(migrated.savedAt).toBe(row.oldReaderOutput.savedAt);
    expect(migrated.lastTickAt).toBe(row.oldReaderOutput.lastTickAt);
    expect(projection(migrated.state)).toEqual(row.oldReaderOutput.state);
    expect(migrated.state.terraformerGrantJobFloor).toBe(row.oldReaderOutput.state.orders.nextJobId);
    for (const planet of migrated.state.planets) expect(planet.terraformerFields).toEqual({ base: planet.fieldsMax, grantedLevels: 0 });
    expect(read(migrated)).toEqual(migrated);
  });
  it("preserves real r9 building templates alongside paid research, shipyard and transport receipts", () => {
    const worlds = historical.rows.filter(row => row.name.startsWith("complete_world_"));
    expect(worlds).toHaveLength(2);
    for (const row of worlds) {
      const old: any = row.oldReaderOutput.state, migrated = importSave(row.raw);
      expect(old.buildingTemplates.templates).toHaveLength(1);
      expect(old.researchTemplates.templates).toHaveLength(2);
      expect(old.formations.entries).toHaveLength(1);
      expect(old.research.queue[0].source).toBe("plan");
      expect(old.planets.every((planet: any) => planet.shipyardQueue.length > 0)).toBe(true);
      expect(old.fleets).toHaveLength(1);
      const sources = old.planets.flatMap((planet: any) => planet.buildQueue.filter((job: any) => job.building === "terraformer").map((job: any) => job.source));
      expect(new Set(sources)).toEqual(new Set(["manual", "protocol", "plan"]));
      expect(migrated.state.buildingTemplates).toEqual(old.buildingTemplates);
      expect(projection(migrated.state)).toEqual(old);
    }
  });
  it("keeps the real old normalization boundary and original bytes separate", () => {
    const row = historicalRow("legacy_normalization"), raw = JSON.parse(row.raw);
    expect(row.canonical).toBe(false);
    expect(raw.state.planets[0].buildQueue[0].remainingSeconds).toBe(20);
    expect(raw.state.planets[0]).not.toHaveProperty("fieldsMax");
    expect(row.oldReaderOutput.state.planets[0]!.buildQueue[0]!.remainingSeconds).toBe(10);
    const migrated = importSave(row.raw);
    expect(projection(migrated.state)).toEqual(row.oldReaderOutput.state);
    expect(migrated.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    const store = new MemoryStore(row.raw), session = new SaveSession(store, 900);
    expect(session.mode).toBe("ready"); expect(store.values.get(BACKUP_KEY)).toBe(row.raw);
  });
  it("retains old plan payment identity and rejects a forged payer or unmatched receipt", () => {
    const migrated: any = importSave(historicalRow("full10000_plan").raw);
    expect(migrated.state.orders.tasks[0].activeJob.jobId).toBe(migrated.state.planets[0].buildQueue[0].jobId);
    const wrongPayer = structuredClone(migrated); wrongPayer.state.orders.tasks[0].planetId = "other-world";
    expect(() => read(wrongPayer)).toThrow();
    const wrongJob = structuredClone(migrated); wrongJob.state.orders.tasks[0].activeJob.jobId = 0;
    expect(() => read(wrongJob)).toThrow();
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9])("rejects deep r10 metadata smuggled into declared r%s before migration", revision => {
    for (const [key, value] of [["terraformerFields", null], ["terraformerGrantJobFloor", 1]] as const) {
      const file = JSON.parse(historicalRow("continuous_manual").raw);
      file.revision = revision; file.state.unrecognizedLegacyObject = [{ deeply: { [key]: value } }];
      expect(() => read(file)).toThrow(/r10/);
    }
  });
  it("rejects r10 metadata even outside the legacy state envelope", () => {
    const file = JSON.parse(historicalRow("continuous_manual").raw);
    file.unknownEnvelope = [{ terraformerFields: null }];
    expect(() => read(file)).toThrow(/r10/);
  });
  it("cannot hide missing r10 accounting by changing only its revision to r9", () => {
    const file = current(); stripVerifiedNpcMetadata(file.state, 0); file.revision = 9;
    for (const planet of file.state.planets) delete planet.demolition;
    expect(() => read(file)).toThrow(/r10/);
    delete file.state.terraformerGrantJobFloor;
    expect(() => read(file)).toThrow(/r10/);
  });
  it.each(["outbound", "returning"] as const)("preserves the genuine r8 chain and existing %s receipt", phase => {
    const source: any = structuredClone(archivedR8.fixtures[phase]), migrated = read(source);
    const { buildingTemplates, ...withoutR9 } = projection(migrated.state);
    expect(buildingTemplates).toEqual({ nextTemplateId: 1, templates: [] });
    expect(withoutR9).toEqual(source.state);
    expect(migrated.state.terraformerGrantJobFloor).toBe(source.state.orders.nextJobId);
    expect(migrated.state.orders.tasks[0]!.transport!.trips[0]!.phase.kind).toBe(phase);
  });
  it("continues rejecting unsupported versions, original r1 and another lineage", () => {
    const file = JSON.parse(historicalRow("continuous_manual").raw);
    expect(() => read({ ...file, version: 8 })).toThrow();
    expect(() => read({ ...file, revision: 1 })).toThrow();
    expect(() => read({ ...file, schema: "infinity-alternate", revision: 6 })).toThrow();
  });
});

describe("r10 migration storage protection", () => {
  it("verifies original backup bytes before committing, then cold-loads without a grant", () => {
    const row = historicalRow("continuous_manual"), store = new MemoryStore(row.raw);
    const session = new SaveSession(store, 900);
    expect(session.mode).toBe("ready");
    const write = store.events.indexOf(`write:${STORAGE_KEY}`), backup = store.events.indexOf(`write:${BACKUP_KEY}`);
    expect(backup).toBeGreaterThan(-1); expect(write).toBeGreaterThan(backup);
    expect(store.events.slice(backup + 1, write)).toContain(`read:${BACKUP_KEY}`);
    expect(store.values.get(BACKUP_KEY)).toBe(row.raw);
    expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(13);
    expect(projection(serializeState(session.loaded.state))).toEqual(row.oldReaderOutput.state);
    const cold = new SaveSession(store, 900);
    expect(cold.mode).toBe("ready"); expect(cold.loaded.state.planets[0]!.terraformerFields.grantedLevels).toBe(0);
    expect(store.values.get(BACKUP_KEY)).toBe(row.raw);
  });
  it.each(["backup-write", "backup-read", "primary-write", "primary-read"] as const)("freezes and exports exact old bytes after %s failure", fault => {
    const row = historicalRow("continuous_manual"), store = new MemoryStore(row.raw); store.fault = fault;
    const session = new SaveSession(store, 5900);
    expect(session.mode).toBe("protected"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(projection(serializeState(session.loaded.state))).toEqual(row.oldReaderOutput.state);
    expect(session.loaded.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    expect(session.export(session.loaded.state)).toEqual({ raw: row.raw, protected: true });
    expect(session.save(session.loaded.state)).toMatchObject({ ok: false });
    if (fault !== "primary-read") expect(store.values.get(STORAGE_KEY)).toBe(row.raw);
    if (fault === "backup-write" || fault === "backup-read") expect(store.events).not.toContain(`write:${STORAGE_KEY}`);
  });
  it("protects an r10 save with a missing ledger and does not recreate an old-world boundary", () => {
    const file = current(); grant(file, 1); file.state.orders.nextJobId = 2;
    delete file.state.planets[0].terraformerFields;
    const raw = JSON.stringify(file), store = new MemoryStore(raw), session = new SaveSession(store, 5000);
    expect(session.mode).toBe("protected"); expect(store.values.get(STORAGE_KEY)).toBe(raw);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
    expect(store.events.some(event => event.startsWith("write:"))).toBe(false);
  });
  it("treats imported old snapshots as full world replacement, without merging grants", () => {
    const file = current(); grant(file, 2); file.state.orders.nextJobId = 3;
    const store = new MemoryStore(JSON.stringify(file)), session = new SaveSession(store, 900);
    const row = historicalRow("continuous_manual"), result = session.importText(row.raw, 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(projection(serializeState(result.state))).toEqual(row.oldReaderOutput.state);
    expect(result.state.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 0 });
    expect(result.state.terraformerGrantJobFloor).toBe(row.oldReaderOutput.state.orders.nextJobId);
  });
  it("keeps conflicting-tab original bytes and refuses to overwrite the other tab", () => {
    const row = historicalRow("continuous_manual"), migrated = importSave(row.raw);
    const raw = JSON.stringify(migrated), store = new MemoryStore(raw), session = new SaveSession(store, 900);
    const other = exportSave(createInitialState(999, 888), 2000, 2000);
    store.values.set(STORAGE_KEY, other);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true); expect(session.mode).toBe("conflict");
    expect(session.save(session.loaded.state)).toMatchObject({ ok: false });
    expect(store.values.get(STORAGE_KEY)).toBe(other);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
  });
});
