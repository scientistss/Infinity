import { describe, expect, it, vi } from "vitest";
import { armAutoRunner, equipCard, refreshUnlocks } from "../src/automation/engine";
import { grantRun } from "../src/game/arcade";
import { SAVE_REVISION, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { BACKUP_KEY, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession, type PreparedFileResult, type ReplacementResult } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";

const NOW = 1_000_000;

function game(clicks = 17) {
  const state = createInitialState(7);
  state.arcade.seed = 7;
  state.manualClicks = clicks;
  return state;
}

function raw(clicks = 17) { return exportSave(game(clicks), NOW); }

class MemoryStore implements KeyValueStore {
  data: Record<string, string> = {};
  reads: string[] = [];
  writes: string[] = [];
  removals: string[] = [];
  read: ((key: string) => string | null | undefined) | undefined;
  write: ((key: string, value: string) => boolean | void) | undefined;

  constructor(source = raw()) { this.data[STORAGE_KEY] = source; }
  getItem(key: string): string | null {
    this.reads.push(key);
    const intercepted = this.read?.(key);
    return intercepted === undefined ? this.data[key] ?? null : intercepted;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.write?.(key, value) !== false) this.data[key] = value;
  }
  removeItem(key: string): void { this.removals.push(key); delete this.data[key]; }
}

/** Keep native File bytes and native text decoding; delay only read completion. */
function deferredFile(source = raw(91)) {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const gate = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  class DeferredNativeFile extends File {
    override async text(): Promise<string> {
      await gate;
      return super.text();
    }
  }
  return {
    file: new DeferredNativeFile([source], "infinity-save.json", { type: "application/json", lastModified: NOW }),
    resolve,
    reject,
  };
}

function file(source = raw(91)) {
  return new File([source], "infinity-save.json", { type: "application/json", lastModified: NOW });
}

function prepared(result: PreparedFileResult) {
  if (!result.ok) throw Error(result.message);
  return result;
}

function accepted(result: ReplacementResult) {
  if (!result.ok) throw Error(result.message);
  return result;
}

function executableImport() {
  let state = game(91);
  state.planets[0]!.resources = { metal: big(100000), crystal: big(100000), deuterium: big(100000) };
  state.research.levels.astrophysics = 1;
  state.arcade.stats.manualRuns = 10;
  state.arcade.stats.runs = 10;
  state.arcade.stats.hits.empty = 10;
  state = equipCard(refreshUnlocks(state), 0, "auto_runner").state;
  state = grantRun(grantRun(state, "bonus").state, "bonus").state;
  const armed = armAutoRunner(state, 0, { planetId: state.activePlanetId, count: 2, maxDeuterium: "0" });
  if (!armed.ok) throw Error("Could not arm fixture's finite ring batch");
  const ordered = createOrderTask(armed.state, {
    kind: "building", planetId: state.activePlanetId, building: "metal_mine", targetLevel: 2,
    expectedNextTaskId: state.orders.nextTaskId,
    budget: { metal: "100000", crystal: "100000", deuterium: "100000" },
  });
  if (!ordered.ok) throw Error(ordered.reason);
  return ordered.state;
}

describe("legacy native-file race remains a rejected replacement", () => {
  it("reproduces the original save-during-File.text race without relaxing the stale contract", async () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const delayed = deferredFile(), pending = session.importFile(delayed.file, () => NOW + 2000);
    expect(delayed.file).toBeInstanceOf(File);
    expect(delayed.file.size).toBeGreaterThan(0);
    const live = tick(session.loaded.state, 1);
    expect(session.save(live, NOW + 1000)).toEqual({ ok: true });
    const latest = store.data[STORAGE_KEY];
    expect(latest).not.toBe(source);
    delayed.resolve();
    expect(await pending).toMatchObject({ ok: false, code: "stale" });
    expect(store.data[STORAGE_KEY]).toBe(latest);
    expect(store.writes).toEqual([STORAGE_KEY]);
    expect(store.data[BACKUP_KEY]).toBeUndefined();
  });

  it.each([false, true])("background save also retires the old replacement API (reject=%s)", async reject => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile();
    const pending = session.importFile(delayed.file, () => NOW + 2000);
    expect(session.saveBackground(tick(session.loaded.state, 1), NOW + 1000)).toEqual({ ok: true });
    const latest = store.data[STORAGE_KEY];
    if (reject) delayed.reject(Error("late native read failure"));
    else delayed.resolve();
    expect(await pending).toMatchObject({ ok: false, code: "stale" });
    expect(store.data[STORAGE_KEY]).toBe(latest);
    expect(store.writes).toEqual([STORAGE_KEY]);
  });

  it("even an equal verified background save retires a completed replacement result", () => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = accepted(session.importText(raw(91), NOW));
    expect(session.isCurrentReplacement(result)).toBe(true);
    const writes = [...store.writes];
    expect(session.saveBackground(result.state, NOW)).toEqual({ ok: true });
    expect(store.writes).toEqual(writes);
    expect(session.isCurrentReplacement(result)).toBe(false);
  });
});

describe("read-only file preparation", () => {
  it("validates native bytes without storage access, replacement, or simulation execution", async () => {
    const imported = executableImport(), source = exportSave(imported, NOW - 60000);
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const visible = session.loaded.state, before = serializeState(visible), bytes = { ...store.data };
    const status = { mode: session.mode, notice: session.notice, message: session.message };
    store.reads = [];
    const result = prepared(await session.prepareFile(file(source)));
    expect(result).toMatchObject({ raw: source, sourceVersion: SAVE_VERSION, sourceRevision: SAVE_REVISION });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(session.loaded.state).toBe(visible);
    expect(serializeState(visible)).toEqual(before);
    expect({ mode: session.mode, notice: session.notice, message: session.message }).toEqual(status);
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(store.removals).toEqual([]);
    expect(store.data).toEqual(bytes);
    const candidate = importSave(result.raw).state;
    expect(candidate.orders.tasks[0]!.charged).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    expect(candidate.orders.nextJobId).toBe(1);
    expect(candidate.planets[0]!.buildQueue).toEqual([]);
    expect(candidate.arcade.autoBatch).toMatchObject({ armed: true, completed: 0, spentDeuterium: "0" });
    expect(candidate.arcade.stats.autoRuns).toBe(0);
    expect(candidate.arcade.runs).toEqual(imported.arcade.runs);
    expect(candidate.totalTime).toBe("0");
  });

  it("reports the file's original revision without rewriting a supported migration", async () => {
    const legacy = JSON.parse(raw(91));
    legacy.revision = 7;
    delete legacy.state.buildingTemplates;
    delete legacy.state.formations;
    const source = JSON.stringify(legacy), store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = prepared(await session.prepareFile(file(source)));
    expect(result).toMatchObject({ raw: source, sourceVersion: 9, sourceRevision: 7 });
    expect(importSave(result.raw).revision).toBe(SAVE_REVISION);
    expect(JSON.parse(result.raw).revision).toBe(7);
    expect(store.writes).toEqual([]);
  });

  it.each(["not json", "[]", '{"version":8}', '{"version":10}'])("rejects invalid source %s without touching storage", async source => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), before = { ...store.data };
    store.reads = [];
    const result = await session.prepareFile(file(source));
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(session.mode).toBe("ready");
    expect(store.data).toEqual(before);
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  it.each(["schema", "revision", "state", "ring authority", "order authority"] as const)("strictly validates %s before preparing any file", async field => {
    const incoming = JSON.parse(exportSave(executableImport(), NOW));
    if (field === "schema") incoming.schema = "another-route";
    if (field === "revision") incoming.revision = 1;
    if (field === "state") incoming.state.planets = [];
    if (field === "ring authority") incoming.state.arcade.autoBatch.ticketIds = [999];
    if (field === "order authority") incoming.state.orders.tasks[0].budget.metal = "-1";
    const store = new MemoryStore(), session = new SaveSession(store, NOW), bytes = { ...store.data };
    const result = await session.prepareFile(file(JSON.stringify(incoming)));
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.data).toEqual(bytes);
    expect(store.writes).toEqual([]);
  });

  it("reports a current native read rejection and permits a later new preparation", async () => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile();
    const pending = session.prepareFile(delayed.file);
    delayed.reject(Error("native read failed"));
    const failed = await pending;
    expect(failed).toMatchObject({ ok: false, code: "invalid" });
    expect(session.isCurrentPreparedFile(failed)).toBe(true);
    const next = prepared(await session.prepareFile(file()));
    expect(session.isCurrentPreparedFile(failed)).toBe(false);
    expect(session.isCurrentPreparedFile(next)).toBe(true);
    expect(next.preparation).toBeGreaterThan(failed.preparation);
    expect(store.writes).toEqual([]);
  });

  it.each([false, true])("reports a current read/validation failure after verified background saving (reject=%s)", async reject => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile("invalid JSON");
    const pending = session.prepareFile(delayed.file);
    expect(session.saveBackground(tick(session.loaded.state, 1), NOW + 1000)).toEqual({ ok: true });
    const latest = store.data[STORAGE_KEY];
    if (reject) delayed.reject(Error("native read failed"));
    else delayed.resolve();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.data[STORAGE_KEY]).toBe(latest);
    expect(store.writes).toEqual([STORAGE_KEY]);
    expect(store.data[BACKUP_KEY]).toBeUndefined();
  });

  it("retains a prepared file across real ticks and verified native saves, then confirms exactly once against the newest bytes", async () => {
    const imported = executableImport(), incoming = exportSave(imported, NOW - 60000);
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile(incoming);
    let visible = session.loaded.state;
    const replace = vi.spyOn(session, "importText");
    const pending = session.prepareFile(delayed.file);
    visible = tick(visible, 1);
    expect(session.saveBackground(visible, NOW + 1200, NOW + 1000)).toEqual({ ok: true });
    const duringRead = store.data[STORAGE_KEY];
    delayed.resolve();
    const result = prepared(await pending);
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    expect(store.writes).toEqual([STORAGE_KEY]);
    expect(store.data[BACKUP_KEY]).toBeUndefined();
    expect(visible.manualClicks).toBe(17);
    expect(visible.orders.tasks).toEqual([]);
    expect(visible.arcade.autoBatch).toBeNull();
    visible = tick(visible, 2);
    expect(session.saveBackground(visible, NOW + 3250, NOW + 3000)).toEqual({ ok: true });
    const latest = store.data[STORAGE_KEY]!;
    expect(latest).not.toBe(duringRead);
    expect(JSON.parse(latest).lastTickAt).toBe(NOW + 3000);
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.data[BACKUP_KEY]).toBeUndefined();

    // The UI confirmation is a new synchronous authorization, never a saved replacement intent.
    const confirm = () => {
      if (!session.isCurrentPreparedFile(result)) return;
      const committed = accepted(session.importText(result.raw, NOW + 4000));
      if (session.isCurrentReplacement(committed)) visible = committed.state;
    };
    confirm();
    confirm();
    expect(replace).toHaveBeenCalledExactlyOnceWith(incoming, NOW + 4000);
    expect(store.writes).toEqual([STORAGE_KEY, STORAGE_KEY, BACKUP_KEY, STORAGE_KEY]);
    expect(store.data[BACKUP_KEY]).toBe(latest);
    expect(session.isCurrentPreparedFile(result)).toBe(false);
    expect(visible.manualClicks).toBe(91);
    expect(visible.totalTime.eq(0)).toBe(true);
    expect(visible.orders.tasks[0]!.charged.metal).toBe("0");
    expect(visible.arcade.autoBatch!.completed).toBe(0);
    expect(visible.arcade.runs).toEqual(imported.arcade.runs);
    const executed = tick(visible, 10);
    expect(executed.orders.tasks[0]!.charged.metal).not.toBe("0");
    expect(executed.arcade.stats.autoRuns).toBeGreaterThan(0);
  });

  it.each([false, true])("canceling preparation has no write or backup (already read=%s)", async alreadyRead => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile();
    const before = { ...store.data }, pending = session.prepareFile(delayed.file);
    if (alreadyRead) {
      delayed.resolve();
      const result = prepared(await pending);
      session.cancelPendingImport();
      expect(session.isCurrentPreparedFile(result)).toBe(false);
    } else {
      session.cancelPendingImport();
      delayed.resolve();
      const result = await pending;
      expect(result).toMatchObject({ ok: false, code: "stale" });
      expect(session.isCurrentPreparedFile(result)).toBe(false);
    }
    expect(store.data).toEqual(before);
    expect(store.writes).toEqual([]);
    expect(store.removals).toEqual([]);
  });

  it("keeps preparation read-only in protected mode and only recovers after explicit confirmation", async () => {
    const source = "corrupt original", store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const previous = session.loaded.state, notice = session.notice;
    store.reads = [];
    const result = prepared(await session.prepareFile(file()));
    expect(session.mode).toBe("protected");
    expect(session.notice).toBe(notice);
    expect(session.loaded.state).toBe(previous);
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(session.export(previous, NOW)).toEqual({ raw: source, protected: true });
    const replacement = accepted(session.importText(result.raw, NOW + 1));
    expect(session.mode).toBe("ready");
    expect(replacement.state.manualClicks).toBe(91);
    expect(store.data[BACKUP_KEY]).toBe(source);
    expect(store.data[STORAGE_KEY]).toBe(replacement.raw);
    expect(store.writes).toEqual([BACKUP_KEY, STORAGE_KEY]);
    expect(session.isCurrentPreparedFile(result)).toBe(false);
  });
});

describe("independent preparation generations", () => {
  it.each([false, true])("keeps only the newest preparation when an older read completes late (reject=%s)", async reject => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const older = deferredFile(raw(11)), newer = deferredFile(raw(22));
    const first = session.prepareFile(older.file), second = session.prepareFile(newer.file);
    newer.resolve();
    const current = prepared(await second);
    if (reject) older.reject(Error("late failure"));
    else older.resolve();
    const stale = await first;
    expect(stale).toMatchObject({ ok: false, code: "stale" });
    expect(stale.preparation).toBeLessThan(current.preparation);
    expect(session.isCurrentPreparedFile(stale)).toBe(false);
    expect(session.isCurrentPreparedFile(current)).toBe(true);
    expect(current.raw).toBe(raw(22));
    expect(store.writes).toEqual([]);
  });

  it.each(["valid", "invalid"] as const)("detects a completed %s result made stale before caller adoption", async kind => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const pending = session.prepareFile(file(kind === "valid" ? raw(91) : "invalid JSON"));
    // Register the newer action first, so completion is queued ahead of the caller's continuation.
    const newerAction = pending.then(() => session.cancelPendingImport());
    await newerAction;
    const result = await pending;
    expect(result.ok).toBe(kind === "valid");
    if (!result.ok) expect(result.code).toBe("invalid");
    expect(session.isCurrentPreparedFile(result)).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it.each(["valid", "invalid"] as const)("preserves a completed %s result only through a known-success background save", async kind => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = await session.prepareFile(file(kind === "valid" ? raw(91) : "invalid JSON"));
    expect(session.saveBackground(game(), NOW)).toEqual({ ok: true });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.writes).toEqual([]);
  });

  it.each(["manual save", "invalid manual save", "manual action", "text import", "invalid text import", "reset", "storage conflict"] as const)("retires a prepared result on %s", async operation => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = prepared(await session.prepareFile(file()));
    if (operation === "manual save") expect(session.save(session.loaded.state, NOW)).toEqual({ ok: true });
    if (operation === "invalid manual save") {
      const invalid = game(); invalid.planets = [];
      expect(session.save(invalid, NOW)).toMatchObject({ ok: false, code: "invalid" });
    }
    if (operation === "manual action") session.cancelPendingImport();
    if (operation === "text import") accepted(session.importText(raw(33), NOW));
    if (operation === "invalid text import") expect(session.importText("invalid", NOW)).toMatchObject({ ok: false, code: "invalid" });
    if (operation === "reset") accepted(session.reset(NOW));
    if (operation === "storage conflict") {
      store.data[STORAGE_KEY] = raw(44);
      expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true);
    }
    expect(session.isCurrentPreparedFile(result)).toBe(false);
  });

  it.each(["manual action", "reset", "text import"] as const)("rejects both late success and late failure after %s", async operation => {
    for (const reject of [false, true]) {
      const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile();
      const pending = session.prepareFile(delayed.file);
      if (operation === "manual action") session.cancelPendingImport();
      if (operation === "reset") accepted(session.reset(NOW));
      if (operation === "text import") accepted(session.importText(raw(33), NOW));
      const bytes = { ...store.data }, writes = [...store.writes];
      if (reject) delayed.reject(Error("late native read failure"));
      else delayed.resolve();
      const result = await pending;
      expect(result).toMatchObject({ ok: false, code: "stale" });
      expect(session.isCurrentPreparedFile(result)).toBe(false);
      expect(store.data).toEqual(bytes);
      expect(store.writes).toEqual(writes);
    }
  });

  it("new legacy import retires preparation before its own native read completes", async () => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = prepared(await session.prepareFile(file()));
    const delayed = deferredFile(raw(33)), pending = session.importFile(delayed.file, () => NOW);
    expect(session.isCurrentPreparedFile(result)).toBe(false);
    expect(store.writes).toEqual([]);
    session.cancelPendingImport();
    delayed.resolve();
    expect(await pending).toMatchObject({ ok: false, code: "stale" });
    expect(store.writes).toEqual([]);
  });

  it("new preparation retires a pending legacy replacement without granting write authority", async () => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW), delayed = deferredFile();
    const legacy = session.importFile(delayed.file, () => NOW);
    const result = prepared(await session.prepareFile(file(raw(22))));
    delayed.resolve();
    expect(await legacy).toMatchObject({ ok: false, code: "stale" });
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    expect(store.writes).toEqual([]);
  });

  it("ignores unrelated and equal-value storage events but retires preparation on an unreadable event", async () => {
    const store = new MemoryStore(), session = new SaveSession(store, NOW);
    const result = prepared(await session.prepareFile(file()));
    expect(session.handleStorageEvent("unrelated")).toBe(false);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(false);
    expect(session.isCurrentPreparedFile(result)).toBe(true);
    store.read = () => { throw Error("event read denied"); };
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true);
    expect(session.isCurrentPreparedFile(result)).toBe(false);
    expect(session.mode).toBe("protected");
    expect(store.writes).toEqual([]);
  });
});

describe("background preservation requires verified persistence success", () => {
  it.each(["compare read", "quota", "drop", "write then throw", "readback", "conflict"] as const)("retires completed and pending preparations after %s", async fault => {
    for (const settlement of ["completed", "resolve", "reject"] as const) {
      const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
      const delayed = deferredFile(), pending = session.prepareFile(delayed.file);
      let completed: PreparedFileResult | undefined;
      if (settlement === "completed") { delayed.resolve(); completed = await pending; }
      let written = false;
      store.write = (key, value) => {
        if (key !== STORAGE_KEY) return;
        if (fault === "quota") throw Error("quota exceeded");
        if (fault === "drop") return false;
        written = true;
        if (fault === "write then throw") { store.data[key] = value; throw Error("unknown write outcome"); }
      };
      store.read = key => {
        if (key === STORAGE_KEY && (fault === "compare read" || (fault === "readback" && written))) throw Error("read denied");
        return undefined;
      };
      if (fault === "conflict") store.data[STORAGE_KEY] = raw(44);
      expect(session.saveBackground(game(33), NOW + 1000)).toMatchObject({ ok: false, code: fault === "conflict" ? "conflict" : "storage" });
      expect(session.mode).toBe(fault === "conflict" ? "conflict" : "protected");
      expect(session.loaded.state.manualClicks).toBe(17);
      expect(session.export(game(99), NOW)).toEqual({ raw: source, protected: true });
      if (settlement !== "completed") {
        if (settlement === "reject") delayed.reject(Error("late native read failure"));
        else delayed.resolve();
        completed = await pending;
        expect(completed).toMatchObject({ ok: false, code: "stale" });
      }
      expect(session.isCurrentPreparedFile(completed!)).toBe(false);
      expect(store.data[BACKUP_KEY]).toBeUndefined();
      expect(store.writes.every(key => key === STORAGE_KEY)).toBe(true);
      const afterFailure = { ...store.data }, writes = [...store.writes];
      expect(session.saveBackground(game(99), NOW + 2000).ok).toBe(false);
      expect(store.data).toEqual(afterFailure);
      expect(store.writes).toEqual(writes);
    }
  });

  it("does not preserve preparation on invalid background serialization or a blocked background save", async () => {
    for (const protectedMode of [false, true]) {
      const source = protectedMode ? "broken original" : raw();
      const store = new MemoryStore(source), session = new SaveSession(store, NOW);
      const result = prepared(await session.prepareFile(file()));
      const state = game();
      if (!protectedMode) state.planets = [];
      expect(session.saveBackground(state, NOW)).toMatchObject({ ok: false, code: protectedMode ? "protected" : "invalid" });
      expect(session.isCurrentPreparedFile(result)).toBe(false);
      expect(store.data[STORAGE_KEY]).toBe(source);
      expect(store.writes).toEqual([]);
    }
  });
});

describe("confirmed preparation keeps verified-replacement safeguards", () => {
  it.each(["backup quota", "backup drop", "backup readback", "current quota", "current drop", "current readback", "write then throw", "interleaving conflict"] as const)("does not adopt an import after %s", async fault => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const visible = session.loaded.state, result = prepared(await session.prepareFile(file()));
    expect(store.writes).toEqual([]);
    let currentWritten = false;
    store.write = (key, value) => {
      if (fault === "backup quota" && key === BACKUP_KEY) throw Error("backup quota");
      if (fault === "backup drop" && key === BACKUP_KEY) return false;
      if (fault === "interleaving conflict" && key === BACKUP_KEY) store.data[STORAGE_KEY] = raw(44);
      if (fault === "current quota" && key === STORAGE_KEY) throw Error("current quota");
      if (fault === "current drop" && key === STORAGE_KEY) return false;
      if (key === STORAGE_KEY) currentWritten = true;
      if (fault === "write then throw" && key === STORAGE_KEY) { store.data[key] = value; throw Error("unknown write outcome"); }
    };
    store.read = key => {
      if (fault === "backup readback" && key === BACKUP_KEY && store.data[key] !== undefined) throw Error("backup readback denied");
      if (fault === "current readback" && key === STORAGE_KEY && currentWritten) throw Error("current readback denied");
      return undefined;
    };
    expect(session.importText(result.raw, NOW + 1)).toMatchObject({ ok: false, code: fault === "interleaving conflict" ? "conflict" : "storage" });
    expect(session.isCurrentPreparedFile(result)).toBe(false);
    expect(session.loaded.state).toBe(visible);
    expect(session.export(visible, NOW)).toEqual({ raw: source, protected: true });
    if (!["current readback", "write then throw", "interleaving conflict"].includes(fault)) expect(store.data[STORAGE_KEY]).toBe(source);
    if (fault.startsWith("current") || fault === "write then throw" || fault === "interleaving conflict") expect(store.data[BACKUP_KEY]).toBe(source);
    if (fault === "interleaving conflict") expect(store.data[STORAGE_KEY]).toBe(raw(44));
    expect(store.removals).toEqual([]);
  });
});
