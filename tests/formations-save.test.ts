import { describe, expect, it } from "vitest";
import { SHIP_IDS, unitById } from "../src/data/units";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { createFormationState } from "../src/game/formation-state";
import { readFormationOrigin, readFormations, serializeFormations } from "../src/game/formations-save";
import { advanceOrderPlans, cancelOrderTask, resumeOrderTask } from "../src/game/orders";
import { readOrders, serializeOrders } from "../src/game/orders-save";
import { BACKUP_KEY, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { advanceShipyard, unitSeconds } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";

const NOW = 1000;
const money = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
function library(): any {
  return { nextFormationId: 4, entries: [
    { id: 1, revision: 3, name: "运输与护航 🚀", ships: { small_cargo: 10, light_fighter: 12 } },
    { id: 3, revision: 1, name: "运输与护航 🚀", ships: { small_cargo: 1 } },
  ] };
}
function origin(): any {
  return { formation: { id: 1, revision: 2, name: "早期护航", ships: { small_cargo: 5, light_fighter: 10 } },
    quotedUnitCost: money("7", "11", "13") };
}
function file(): any {
  const state = createInitialState(83);
  state.formations = library();
  state.researchTemplates = { nextTemplateId: 2, templates: [
    { id: 1, revision: 1, name: "保留研究目标", goals: [{ tech: "energy_tech", targetLevel: 3 }] },
  ] };
  return JSON.parse(exportSave(state, NOW));
}
function paidFile(): any {
  const value = file(), planet = value.state.planets[0];
  planet.units.small_cargo = 1;
  planet.shipyardQueue = [{ jobId: 1, taskId: 1, source: "plan", unit: "small_cargo", count: 3,
    orderedCount: 4, paidPerUnit: money("7", "11", "13"), progress: 0.375 }];
  value.state.orders = { nextTaskId: 2, nextJobId: 2, nextWorkId: 1, accumulator: 0, tasks: [
    { id: 1, kind: "shipyard", planetId: planet.id, unit: "small_cargo", quantity: 4, status: "running", reason: "",
      budget: money("28", "44", "52"), charged: money("28", "44", "52"), refunded: money(),
      activeJob: { jobId: 1, quantity: 4, credited: 1 }, completedUnits: 1,
      transport: null, currentWork: null, formationOrigin: origin() },
  ] };
  return value;
}
function unpaidFile(): any {
  const value = paidFile();
  value.state.planets[0].shipyardQueue = [];
  Object.assign(value.state.orders.tasks[0], { activeJob: null, completedUnits: 0, charged: money() });
  return value;
}
const read = (value: any) => importSave(JSON.stringify(value));
function appendHistory(value: any): any {
  const task = structuredClone(value.state.orders.tasks[0]);
  Object.assign(task, { id: 2, status: "cancelled", planetId: "retired", activeJob: null, completedUnits: 0,
    charged: money(), refunded: money() });
  value.state.orders.tasks.push(task);
  value.state.orders.nextTaskId = 3;
  return task;
}
function legacy(revision: 2 | 3 | 4 | 5 | 6 | 7): any {
  const value = revision >= 5 ? unpaidFile() : file();
  value.revision = revision;
  delete value.state.formations;
  for (const task of value.state.orders.tasks) delete task.formationOrigin;
  if (revision < 7) delete value.state.researchTemplates;
  if (revision < 6) {
    delete value.state.orders.nextWorkId;
    for (const task of value.state.orders.tasks) { delete task.transport; delete task.currentWork; }
    for (const fleet of value.state.fleets) delete fleet.orderTransport;
  }
  if (revision < 5) delete value.state.orders;
  if (revision < 4) { delete value.state.arcade.nextRunId; delete value.state.arcade.autoBatch; }
  if (revision === 2) delete value.state.deepSpace;
  return value;
}
class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  writes: string[] = [];
  failBackup = false;
  constructor(raw: string) { this.data.set(STORAGE_KEY, raw); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes.push(key);
    if (this.failBackup && key === BACKUP_KEY) throw Error("backup quota");
    this.data.set(key, value);
  }
  removeItem(key: string) { this.data.delete(key); }
}

describe("r8 pure named fleet formation persistence", () => {
  it("round-trips designs, research intent, historical prices and real paid receipts together", () => {
    const source = paidFile(), restored = read(source);
    expect(restored.revision).toBe(8);
    expect(restored.revision).toBe(SAVE_REVISION);
    expect(restored.state).toEqual(source.state);
    expect(serializeState(deserializeState(restored.state))).toEqual(source.state);
    expect(read(restored)).toEqual(restored);
    expect(restored.state.formations.entries[0]!.name).toBe(restored.state.formations.entries[1]!.name);
  });
  it("deep-copies the library and each ship map in both directions", () => {
    const input = library(), restored = readFormations(input), serialized = serializeFormations(restored);
    input.entries[0].ships.small_cargo = 99;
    input.entries[0].name = "changed input";
    serialized.entries[0]!.ships.small_cargo = 2;
    serialized.entries[1]!.name = "changed output";
    serialized.nextFormationId = 12;
    expect(restored).toEqual(library());
    expect(restored.entries).not.toBe(serialized.entries);
    expect(restored.entries[0]).not.toBe(serialized.entries[0]);
    expect(restored.entries[0]!.ships).not.toBe(serialized.entries[0]!.ships);
  });
  it("detaches restored order snapshots and quotes from their input and serialization", () => {
    const input = paidFile(), restored = readOrders(input.state.orders), serialized = serializeOrders(restored);
    input.state.orders.tasks[0].formationOrigin.formation.ships.small_cargo = 99;
    input.state.orders.tasks[0].formationOrigin.quotedUnitCost.metal = "99";
    expect(restored.tasks[0]!.formationOrigin).toEqual(origin());
    expect(restored.tasks[0]!.formationOrigin).not.toBe(serialized.tasks[0]!.formationOrigin);
    expect(restored.tasks[0]!.formationOrigin!.formation).not.toBe(serialized.tasks[0]!.formationOrigin!.formation);
    expect(restored.tasks[0]!.formationOrigin!.formation.ships).not.toBe(serialized.tasks[0]!.formationOrigin!.formation.ships);
    expect(restored.tasks[0]!.formationOrigin!.quotedUnitCost).not.toBe(serialized.tasks[0]!.formationOrigin!.quotedUnitCost);
    for (const snapshot of [restored.tasks[0]!.formationOrigin!, serialized.tasks[0]!.formationOrigin!]) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.formation)).toBe(true);
      expect(Object.isFrozen(snapshot.formation.ships)).toBe(true);
      expect(Object.isFrozen(snapshot.quotedUnitCost)).toBe(true);
      expect(() => { snapshot.formation.name = "changed output"; }).toThrow();
      expect(() => { snapshot.formation.ships.small_cargo = 2; }).toThrow();
      expect(() => { snapshot.quotedUnitCost.crystal = "99"; }).toThrow();
    }
    expect(restored.tasks[0]!.formationOrigin).toEqual(origin());
    serialized.tasks[0]!.formationOrigin = null;
    expect(restored.tasks[0]!.formationOrigin).toEqual(origin());
  });
  it("accepts maximum code points, counts, entries and the exhausted next-ID sentinel", () => {
    const ships = Object.fromEntries(SHIP_IDS.filter(id => id !== "solar_satellite").map(id => [id, 1_000_000]));
    const value = { nextFormationId: Number.MAX_SAFE_INTEGER, entries: Array.from({ length: 32 }, (_, i) => ({
      id: i === 31 ? Number.MAX_SAFE_INTEGER - 1 : i + 1, revision: Number.MAX_SAFE_INTEGER,
      name: "🚀".repeat(64), ships: { ...ships },
    })) };
    expect(readFormations(value)).toEqual(value);
    expect(readFormations(createFormationState())).toEqual({ nextFormationId: 1, entries: [] });
  });
  it("accepts arbitrary JSON key order and returns canonical ship order", () => {
    const value = library(); value.entries[0].ships = { light_fighter: 12, small_cargo: 10 };
    const restored = readFormations(value);
    expect(restored).toEqual(library());
    expect(Object.keys(restored.entries[0]!.ships)).toEqual(["small_cargo", "light_fighter"]);
  });
  it.each([
    ["missing", (_v: any): undefined => undefined], ["null", (_v: any): null => null], ["array", (_v: any): never[] => []],
    ["missing counter", (v: any) => { delete v.nextFormationId; return v; }],
    ["zero counter", (v: any) => { v.nextFormationId = 0; return v; }],
    ["fractional counter", (v: any) => { v.nextFormationId = 4.5; return v; }],
    ["unsafe counter", (v: any) => { v.nextFormationId = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["string counter", (v: any) => { v.nextFormationId = "4"; return v; }],
    ["stale counter", (v: any) => { v.nextFormationId = 3; return v; }],
    ["missing entries", (v: any) => { delete v.entries; return v; }],
    ["33 entries", (v: any) => { v.entries = Array.from({ length: 33 }, (_, i) => ({ ...v.entries[0], id: i + 1 })); v.nextFormationId = 34; return v; }],
    ["duplicate ID", (v: any) => { v.entries[1].id = 1; return v; }],
    ["zero ID", (v: any) => { v.entries[0].id = 0; return v; }],
    ["fractional ID", (v: any) => { v.entries[0].id = 1.5; return v; }],
    ["issued sentinel ID", (v: any) => { v.entries[0].id = Number.MAX_SAFE_INTEGER; v.nextFormationId = Number.MAX_SAFE_INTEGER; return v; }],
    ["missing revision", (v: any) => { delete v.entries[0].revision; return v; }],
    ["zero revision", (v: any) => { v.entries[0].revision = 0; return v; }],
    ["fractional revision", (v: any) => { v.entries[0].revision = 1.5; return v; }],
    ["unsafe revision", (v: any) => { v.entries[0].revision = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["empty name", (v: any) => { v.entries[0].name = ""; return v; }],
    ["untrimmed name", (v: any) => { v.entries[0].name = " name "; return v; }],
    ["65 code points", (v: any) => { v.entries[0].name = "🚀".repeat(65); return v; }],
    ["C0 control", (v: any) => { v.entries[0].name = "a\u0000b"; return v; }],
    ["C1 control", (v: any) => { v.entries[0].name = "a\u0085b"; return v; }],
    ["empty ships", (v: any) => { v.entries[0].ships = {}; return v; }],
    ["array ships", (v: any) => { v.entries[0].ships = []; return v; }],
    ["zero count", (v: any) => { v.entries[0].ships.small_cargo = 0; return v; }],
    ["negative count", (v: any) => { v.entries[0].ships.small_cargo = -1; return v; }],
    ["fractional count", (v: any) => { v.entries[0].ships.small_cargo = 1.5; return v; }],
    ["over-limit count", (v: any) => { v.entries[0].ships.small_cargo = 1_000_001; return v; }],
    ["numeric-string count", (v: any) => { v.entries[0].ships.small_cargo = "1"; return v; }],
    ["satellite", (v: any) => { v.entries[0].ships.solar_satellite = 1; return v; }],
    ["defense", (v: any) => { v.entries[0].ships.rocket_launcher = 1; return v; }],
    ["unknown ship", (v: any) => { v.entries[0].ships.unknown = 1; return v; }],
  ] as const)("rejects %s without repairing or dropping malformed intent", (_label, mutate) => {
    const value = mutate(library());
    expect(() => readFormations(value)).toThrow();
    expect(() => serializeFormations(value)).toThrow();
    const source = file(); source.state.formations = value;
    expect(() => read(source)).toThrow();
  });
  it.each(["planetId", "payer", "budget", "taskId", "mission", "cargo", "transport", "currentWork", "formationOrigin"])(
    "rejects %s at every pure-intent boundary", key => {
      for (const location of ["library", "entry", "ships"]) {
        const value = library();
        const target = location === "library" ? value : location === "entry" ? value.entries[0] : value.entries[0].ships;
        target[key] = null;
        expect(() => readFormations(value), location).toThrow();
        expect(() => serializeFormations(value), location).toThrow();
      }
    });
  it.each(["library", "entry", "ships"])("rejects symbolic, inherited and hidden metadata on %s", location => {
    for (const mode of ["symbol", "inherited", "hidden"]) {
      const value = library();
      const target = location === "library" ? value : location === "entry" ? value.entries[0] : value.entries[0].ships;
      if (mode === "symbol") target[Symbol("payer")] = "homeworld";
      else if (mode === "inherited") Object.setPrototypeOf(target, { payer: "homeworld" });
      else Object.defineProperty(target, "payer", { value: "homeworld" });
      expect(() => readFormations(value), mode).toThrow();
      expect(() => serializeFormations(value), mode).toThrow();
    }
  });
  it("requires explicit formations and explicit nullable origin in every r8 task", () => {
    const absentLibrary = file(); delete absentLibrary.state.formations;
    expect(() => read(absentLibrary)).toThrow();
    const absentOrigin = paidFile(); delete absentOrigin.state.orders.tasks[0].formationOrigin;
    expect(() => read(absentOrigin)).toThrow();
    const ordinary = paidFile(); ordinary.state.orders.tasks[0].formationOrigin = null;
    expect(read(ordinary).state.orders.tasks[0]!.formationOrigin).toBeNull();
  });
});

describe("r8 immutable formation origin audit", () => {
  it("accepts only explicit null or a complete detached snapshot and quote", () => {
    expect(readFormationOrigin(null)).toBeNull();
    const input = origin(), restored = readFormationOrigin(input);
    input.formation.ships.small_cargo = 99; input.quotedUnitCost.metal = "99";
    expect(restored).toEqual(origin());
    for (const value of [undefined, {}, [], { formation: origin().formation }, { quotedUnitCost: money() }]) {
      expect(() => readFormationOrigin(value)).toThrow();
    }
  });
  it.each(["origin", "snapshot", "ships", "quote"])("rejects unknown, symbolic and inherited fields on %s", location => {
    for (const mode of ["unknown", "symbol", "inherited"]) {
      const value = origin();
      const target = location === "origin" ? value : location === "snapshot" ? value.formation
        : location === "ships" ? value.formation.ships : value.quotedUnitCost;
      if (mode === "unknown") target.payer = "homeworld";
      else if (mode === "symbol") target[Symbol("payer")] = "homeworld";
      else Object.setPrototypeOf(target, { payer: "homeworld" });
      expect(() => readFormationOrigin(value), mode).toThrow();
      const state = deserializeState(paidFile().state);
      state.orders.tasks[0]!.formationOrigin = value;
      expect(() => serializeState(state), mode).toThrow();
    }
  });
  it.each([7, "-1", "NaN", "Infinity", "1e191", "0.0000000000000000001", "60.000000000000000001"])(
    "rejects invalid or wallet-unrepresentable historical quote %s", amount => {
      const value = origin(); value.quotedUnitCost.metal = amount;
      expect(() => readFormationOrigin(value)).toThrow();
    });
  it("preserves old revisions when the current name and target have changed", () => {
    const source = paidFile();
    source.state.formations.entries[0].name = "新名称";
    source.state.formations.entries[0].ships.small_cargo = 1;
    expect(read(source).state.orders.tasks[0]!.formationOrigin).toEqual(origin());
  });
  it("requires an equal current revision to match the entire current snapshot", () => {
    const source = paidFile(); source.state.orders.tasks[0].formationOrigin.formation = structuredClone(source.state.formations.entries[0]);
    expect(() => read(source)).not.toThrow();
    for (const mutate of [
      (f: any) => { f.name = "different"; },
      (f: any) => { f.ships.light_fighter = 13; },
      (f: any) => { delete f.ships.light_fighter; },
    ]) {
      const invalid = structuredClone(source); mutate(invalid.state.orders.tasks[0].formationOrigin.formation);
      expect(() => read(invalid)).toThrow();
    }
  });
  it("checks equal-version historical snapshots even across cancelled records and retired payers", () => {
    const source = paidFile(), second = appendHistory(source);
    expect(() => read(source)).not.toThrow();
    second.formationOrigin.formation.name = "conflicting old version";
    expect(() => read(source)).toThrow();
    second.formationOrigin.formation.revision = 1;
    expect(() => read(source)).not.toThrow();
  });
  it.each([
    ["missing current design", (f: any) => { f.state.formations.entries.shift(); }],
    ["future snapshot revision", (f: any) => { f.state.orders.tasks[0].formationOrigin.formation.revision = 4; }],
    ["target outside snapshot", (f: any) => { f.state.orders.tasks[0].formationOrigin.formation.ships.small_cargo = 3; }],
    ["unit outside snapshot", (f: any) => { delete f.state.orders.tasks[0].formationOrigin.formation.ships.small_cargo; }],
    ["wrong metal budget", (f: any) => { f.state.orders.tasks[0].budget.metal = "29"; }],
    ["wrong crystal budget", (f: any) => { f.state.orders.tasks[0].budget.crystal = "45"; }],
    ["wrong deuterium budget", (f: any) => { f.state.orders.tasks[0].budget.deuterium = "53"; }],
    ["different real paid price", (f: any) => { f.state.planets[0].shipyardQueue[0].paidPerUnit.metal = "6"; }],
    ["missing real receipt", (f: any) => { f.state.planets[0].shipyardQueue = []; }],
    ["orphan real task", (f: any) => { f.state.planets[0].shipyardQueue[0].taskId = 2; }],
    ["manual ownership", (f: any) => { f.state.planets[0].shipyardQueue[0].source = "manual"; }],
    ["wrong credit watermark", (f: any) => { f.state.orders.tasks[0].activeJob.credited = 0; }],
    ["insufficient net paid liability", (f: any) => { f.state.orders.tasks[0].refunded.metal = "8"; }],
    ["live retired payer", (f: any) => { f.state.orders.tasks[0].planetId = "retired"; }],
    ["duplicate live goal", (f: any) => { const task = appendHistory(f); task.status = "running"; task.planetId = f.state.activePlanetId; }],
  ] as const)("rejects %s without weakening original order invariants", (_label, mutate) => {
    const source = paidFile(); mutate(source); expect(() => read(source)).toThrow();
  });
  it.each(["building", "research", "defense", "satellite", "transport"])("rejects %s authority on an otherwise valid origin", kind => {
    const source = unpaidFile(), task = source.state.orders.tasks[0];
    if (kind === "building" || kind === "research") {
      delete task.unit; delete task.quantity;
      Object.assign(task, kind === "building" ? { kind, building: "metal_mine", targetLevel: 1 }
        : { kind, tech: "energy_tech", targetLevel: 1 });
    } else if (kind === "transport") {
      task.transport = { authorization: { donorPlanetId: source.state.activePlanetId, ship: "small_cargo", count: 1,
        speedPercent: 100, maxTrips: 1, grossCargoCap: money("100", "100", "100") }, trips: [] };
    } else task.unit = kind === "defense" ? "rocket_launcher" : "solar_satellite";
    expect(() => read(source)).toThrow();
  });
  it("retains cancelled origins for removed payers and still rejects dangling design references", () => {
    const source = unpaidFile(), task = source.state.orders.tasks[0];
    Object.assign(task, { status: "cancelled", planetId: "retired" });
    expect(read(source).state.orders.tasks[0]!.formationOrigin).toEqual(origin());
    source.state.formations.entries.shift();
    expect(() => read(source)).toThrow();
  });
  it("finishes a real historical-price queue without repricing its ledger or origin", () => {
    const state = deserializeState(read(paidFile()).state);
    expect(unitById("small_cargo").cost.metal).not.toBe(7);
    const originalResources = state.planets[0]!.resources;
    const done = advanceShipyard(state, unitSeconds(state, "small_cargo") * 4).state;
    expect(done.planets[0]!.shipyardQueue).toEqual([]);
    expect(done.planets[0]!.units.small_cargo).toBe(4);
    expect(done.orders.tasks[0]).toMatchObject({ status: "completed", completedUnits: 4, activeJob: null,
      budget: money("28", "44", "52"), charged: money("28", "44", "52"), refunded: money(), formationOrigin: origin() });
    expect(done.planets[0]!.resources).toEqual(originalResources);
    expect(() => importSave(exportSave(done, NOW))).not.toThrow();
  });
  it("refunds only the historical paid remainder and pauses new payment at the changed catalog price", () => {
    const state = deserializeState(read(paidFile()).state), before = state.planets[0]!.resources;
    const cancelled = cancelOrderTask(state, 1);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.orders.tasks[0]).toMatchObject({ status: "cancelled", completedUnits: 1,
      refunded: money("21", "33", "39"), formationOrigin: origin() });
    for (const [res, amount] of [["metal", 21], ["crystal", 33], ["deuterium", 39]] as const) {
      expect(cancelled.state.planets[0]!.resources[res].eq(before[res].add(amount))).toBe(true);
    }
    expect(() => importSave(exportSave(cancelled.state, NOW))).not.toThrow();
    const pending = deserializeState(read(unpaidFile()).state);
    const paused = advanceOrderPlans(pending, 10);
    expect(paused.orders.tasks[0]!.status).toBe("paused");
    expect(paused.orders.tasks[0]!.charged).toEqual(money());
    expect(paused.orders.nextJobId).toBe(pending.orders.nextJobId);
    expect(paused.planets[0]!.resources).toEqual(pending.planets[0]!.resources);
    const retried = advanceOrderPlans(resumeOrderTask(paused, 1).state, 10);
    expect(retried.orders.tasks[0]!.status).toBe("paused");
    expect(retried.orders.tasks[0]!.charged).toEqual(money());
    expect(() => importSave(exportSave(retried, NOW))).not.toThrow();
  });
});

describe("r8 additive migration and SaveSession protection", () => {
  it.each([2, 3, 4, 5, 6, 7] as const)("adds empty designs and explicit null origins to r%d without inventing authority", revision => {
    const source = legacy(revision), unchanged = structuredClone(source), imported = read(source);
    expect(source).toEqual(unchanged);
    expect(imported.state.formations).toEqual(createFormationState());
    expect(imported.state.orders.tasks.every(task => task.formationOrigin === null)).toBe(true);
    expect(read(imported)).toEqual(imported);
    if (revision === 7) {
      expect(imported.state.researchTemplates).toEqual(source.state.researchTemplates);
      const projection: any = structuredClone(imported.state); delete projection.formations;
      for (const task of projection.orders.tasks) delete task.formationOrigin;
      expect(projection).toEqual(source.state);
    }
  });
  it.each([2, 3, 4, 5, 6, 7] as const)("rejects new r8 fields smuggled anywhere in r%d, including null and empty values", revision => {
    for (const key of ["formations", "nextFormationId", "formationOrigin", "quotedUnitCost"]) {
      for (const injected of [null, {}, createFormationState()]) {
        for (const location of ["state", "planet"]) {
          const source = legacy(revision), target = location === "state" ? source.state : source.state.planets[0];
          target[key] = injected;
          expect(() => read(source), `${key}/${location}`).toThrow("不能夹带 r8");
        }
      }
    }
    if (revision >= 5) {
      const source = legacy(revision); source.state.orders.tasks[0].formationOrigin = null;
      expect(() => read(source)).toThrow("不能夹带 r8");
    }
  });
  it("protects malformed current origin bytes without overwriting them", () => {
    const invalid = paidFile(); invalid.state.orders.tasks[0].formationOrigin.formation.id = 2;
    const raw = JSON.stringify(invalid), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected");
    expect(session.save(createInitialState(83), NOW)).toMatchObject({ ok: false });
    expect(session.export(createInitialState(83), NOW)).toEqual({ raw, protected: true });
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.writes).toEqual([]);
  });
  it("does not weaken import or autosave validation around immutable-origin audits", () => {
    const raw = JSON.stringify(paidFile()), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    const invalid = paidFile(); invalid.state.orders.tasks[0].budget.crystal = "45";
    expect(session.importText(JSON.stringify(invalid), NOW)).toMatchObject({ ok: false, code: "invalid" });
    const live = deserializeState(read(paidFile()).state); live.orders.tasks[0]!.budget.metal = "29";
    expect(session.save(live, NOW)).toMatchObject({ ok: false, code: "invalid" });
    expect(session.mode).toBe("ready");
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.writes).toEqual([]);
  });
  it("preserves exact r7 bytes before migration and keeps its research library", () => {
    const source = legacy(7), raw = JSON.stringify(source), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("ready");
    expect(store.getItem(BACKUP_KEY)).toBe(raw);
    expect(store.writes).toEqual([BACKUP_KEY, STORAGE_KEY]);
    expect(session.loaded.state.formations).toEqual(createFormationState());
    expect(session.loaded.state.researchTemplates).toEqual(source.state.researchTemplates);
    expect(session.loaded.state.orders.tasks[0]!.formationOrigin).toBeNull();
    expect(importSave(store.getItem(STORAGE_KEY)!).revision).toBe(8);
  });
  it("keeps readable r7 progress frozen when preserving the original fails", () => {
    const raw = JSON.stringify(legacy(7)), store = new MemoryStore(raw); store.failBackup = true;
    const session = new SaveSession(store, NOW + 5000);
    expect(session.mode).toBe("protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.loaded.state.formations).toEqual(createFormationState());
    expect(session.export(session.loaded.state, NOW)).toEqual({ raw, protected: true });
    expect(store.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("replaces rather than merges design IDs and resets both intent libraries only after saving", () => {
    const raw = JSON.stringify(paidFile()), store = new MemoryStore(raw), session = new SaveSession(store, NOW);
    const replacement = file(); replacement.state.formations = { nextFormationId: 2, entries: [
      { id: 1, revision: 1, name: "来自另一个世界", ships: { colony_ship: 1 } },
    ] };
    const imported = session.importText(JSON.stringify(replacement), NOW);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw Error(imported.message);
    expect(imported.state.formations).toEqual(replacement.state.formations);
    expect(imported.state.orders.tasks).toEqual([]);
    expect(store.getItem(BACKUP_KEY)).toBe(raw);
    const reset = session.reset(NOW);
    expect(reset.ok).toBe(true);
    if (!reset.ok) throw Error(reset.message);
    expect(reset.state.formations).toEqual(createFormationState());
    expect(reset.state.researchTemplates).toEqual({ nextTemplateId: 1, templates: [] });
    expect(importSave(store.getItem(STORAGE_KEY)!).state.formations).toEqual(createFormationState());
  });
});
