import { describe, expect, it } from "vitest";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, MAX_SAVE_BACKUPS, exportSave, importSave, deserializeState, serializeState, preserveRawSave, type KeyValueStore } from "../src/game/save";
import { SaveSession, type ReplacementResult } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";
import { grantRun } from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { catchUp } from "../src/core/offline";

const NOW = 1_000_000;
function game(clicks = 17) {
  const state = createInitialState(7);
  state.arcade.seed = 7;
  return { ...state, manualClicks: clicks };
}
function raw(clicks = 17) { return exportSave(game(clicks), NOW); }
function legacy(revision: 2 | 3 | 4, source = raw()) {
  const file = JSON.parse(source);
  file.revision = revision;
  delete file.state.orders;
  for (const planet of file.state.planets) {
    for (const job of [...planet.buildQueue, ...planet.shipyardQueue]) {
      delete job.jobId; delete job.taskId; delete job.orderedCount; delete job.paidPerUnit;
    }
  }
  for (const job of file.state.research.queue) { delete job.jobId; delete job.taskId; }
  if (revision === 4) return JSON.stringify(file);
  if (revision === 2) delete file.state.deepSpace;
  delete file.state.arcade.nextRunId;
  delete file.state.arcade.autoBatch;
  for (const run of file.state.arcade.runs) delete run.id;
  return JSON.stringify(file);
}

class MemoryStore implements KeyValueStore {
  data: Record<string, string> = {};
  writes: string[] = [];
  removals: string[] = [];
  read: ((key: string) => string | null | undefined) | undefined;
  write: ((key: string, value: string) => boolean | void) | undefined;
  constructor(initial?: string) { if (initial !== undefined) this.data[STORAGE_KEY] = initial; }
  getItem(key: string): string | null {
    const intercepted = this.read?.(key);
    return intercepted === undefined ? this.data[key] ?? null : intercepted;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.write?.(key, value) !== false) this.data[key] = value;
  }
  removeItem(key: string): void { this.removals.push(key); delete this.data[key]; }
}

function accepted(result: ReplacementResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}
function deferredFile() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { file: { text: () => promise }, resolve, reject };
}

describe("SaveSession load and version protection", () => {
  it("loads current saves without a write and applies offline time", () => {
    const source = raw();
    const store = new MemoryStore(source);
    const session = new SaveSession(store, NOW + 2000);
    expect(session.mode).toBe("ready");
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(session.loaded.appliedSeconds).toBe(2);
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(store.writes).toEqual([]);
  });

  it("a genuinely missing save is immediately safe to save", () => {
    const store = new MemoryStore();
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe("ready");
    expect(session.save(game(), NOW)).toEqual({ ok: true });
    expect(importSave(store.data[STORAGE_KEY]!).state.manualClicks).toBe(17);
    expect(store.data[BACKUP_KEY]).toBeUndefined();
  });

  it.each(["", "not json", "[]", '{"version":1}', '{"version":5}', '{"version":8}', '{"version":10}'])("protects unsupported or corrupt bytes %s", (source) => {
    const store = new MemoryStore(source);
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected");
    expect(session.notice).toContain("临时初始画面");
    expect(session.save(game(99), NOW)).toMatchObject({ ok: false });
    expect(session.export(game(99), NOW)).toEqual({ raw: source, protected: true });
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(store.writes).toEqual([]);
  });

  it.each(["schema", "revision", "state"])("protects incompatible %s", (field) => {
    const file = JSON.parse(raw());
    if (field === "schema") file.schema = "another-route";
    if (field === "revision") file.revision = 1;
    if (field === "state") file.state.planets = [];
    const source = JSON.stringify(file), store = new MemoryStore(source);
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected");
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(store.writes).toEqual([]);
  });

  it.each([2, 3, 4] as const)("commits a supported r%d upgrade only after preserving its exact original", (revision) => {
    const source = legacy(revision), store = new MemoryStore(source);
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe("ready");
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(store.data[BACKUP_KEY]).toBe(source);
    expect(JSON.parse(store.data[STORAGE_KEY]!).revision).toBe(SAVE_REVISION);
    expect(store.writes).toEqual([BACKUP_KEY, STORAGE_KEY]);
  });

  it.each([2, 3, 4] as const)("retains readable r%d progress frozen when backup quota is full", (revision) => {
    const source = legacy(revision), store = new MemoryStore(source);
    store.write = () => { throw new Error("quota full"); };
    const session = new SaveSession(store, NOW + 5000);
    expect(session.mode).toBe("protected");
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.notice).not.toContain("临时初始画面");
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(session.export(game(99))).toEqual({ raw: source, protected: true });
  });

  it.each([2, 3, 4] as const)("protects readable r%d progress through each migration verification failure", (revision) => {
    for (const fault of ["backup-write", "backup-read", "backup-noop", "current-write", "current-read", "current-noop", "current-write-then-throw"] as const) {
      const source = legacy(revision), store = new MemoryStore(source);
      let currentWritten = false;
      store.write = (key, value) => {
        if (fault === "backup-write" && key === BACKUP_KEY) throw Error("backup denied");
        if (fault === "backup-noop" && key === BACKUP_KEY) return false;
        if (fault === "current-write" && key === STORAGE_KEY) throw Error("current denied");
        if (fault === "current-noop" && key === STORAGE_KEY) return false;
        if (key === STORAGE_KEY) currentWritten = true;
        if (fault === "current-write-then-throw" && key === STORAGE_KEY) {
          store.data[key] = value;
          throw Error("uncertain write");
        }
      };
      store.read = key => {
        if (fault === "backup-read" && key === BACKUP_KEY && store.data[key] !== undefined) throw Error("backup read denied");
        if (fault === "current-read" && key === STORAGE_KEY && currentWritten) throw Error("current read denied");
        return undefined;
      };
      const session = new SaveSession(store, NOW + 5000);
      expect(session.mode, fault).toBe("protected");
      expect(session.loaded.state.manualClicks, fault).toBe(17);
      expect(session.loaded.appliedSeconds, fault).toBe(0);
      expect(session.loaded.state.totalTime.eq(0), fault).toBe(true);
      expect(session.notice, fault).not.toContain("临时初始画面");
      expect(session.export(game(99)), fault).toEqual({ raw: source, protected: true });
      expect(session.save(game(99)), fault).toMatchObject({ ok: false });
      if (fault !== "current-read" && fault !== "current-write-then-throw") expect(store.data[STORAGE_KEY], fault).toBe(source);
      if (fault.startsWith("current")) expect(store.data[BACKUP_KEY], fault).toBe(source);
    }
  });

  it.each([2, 3] as const)("disables old runner and setBet cards before r%d offline catch-up", revision => {
    let state = game();
    state.research.levels.astrophysics = 1;
    state.arcade.stats.manualRuns = 10;
    state.arcade.bets.metal = 1;
    state.planets[0]!.resources.deuterium = big(100000);
    for (let i = 0; i < 3; i++) state = grantRun(state, "bonus").state;
    state.unlockedCards.push("auto_runner");
    state.protocols.slots[0]!.card = { id: "auto_runner", enabled: true,
      trigger: { kind: "interval", seconds: 1 }, conditions: [], action: { kind: "runLights", count: "all" } };
    state.protocols.slots[1]!.card = { id: "auto_runner", enabled: true,
      trigger: { kind: "interval", seconds: 1 }, conditions: [], action: { kind: "setBet", symbol: "metal", units: 12 } };
    // Independently retain legitimate offline achievements/bonus tickets while disabling spending.
    const control = deserializeState(serializeState(state));
    for (const slot of control.protocols.slots.slice(0, 2)) slot.card!.enabled = false;
    const expected = catchUp(control, 60).state;
    const source = legacy(revision, exportSave(state, NOW)), store = new MemoryStore(source);
    const session = new SaveSession(store, NOW + 60000);
    expect(session.mode).toBe("ready");
    expect(session.loaded.appliedSeconds).toBe(60);
    expect(session.loaded.state.arcade).toEqual(expected.arcade);
    expect(session.loaded.state.arcade.runs.slice(0, state.arcade.runs.length)).toEqual(state.arcade.runs);
    expect(session.loaded.state.unlocked).toEqual(expected.unlocked);
    expect(session.loaded.state.darkMatter).toEqual(expected.darkMatter);
    expect(session.loaded.state.arcade.stats.betSpent).toBe(0);
    expect(session.loaded.state.arcade.stats.autoRuns).toBe(0);
    expect(session.loaded.state.arcade.bets).toEqual(state.arcade.bets);
    expect(session.loaded.state.planets[0]!.resources.deuterium.eq(100000)).toBe(true);
    expect(session.loaded.state.arcade.autoBatch).toBeNull();
    expect(session.loaded.state.protocols.slots.slice(0, 2).map(slot => slot.card?.enabled)).toEqual([false, false]);
    expect(store.data[BACKUP_KEY]).toBe(source);
  });

  it("reloads current ring state without replenishing the finite budget or resetting its consumed cursor", () => {
    let state = game();
    for (let i = 0; i < 3; i++) state = grantRun(state, "bonus").state;
    const ticketIds = state.arcade.runs.map(run => run.id);
    state.arcade.runs.shift();
    state.arcade.autoBatch = { armed: true, planetId: state.activePlanetId, ticketIds, completed: 1,
      maxDeuterium: "100", spentDeuterium: "65", bets: { ...state.arcade.bets }, stopReason: "" };
    const source = exportSave(state, NOW), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("ready");
    expect(session.loaded.state.arcade.autoBatch).toEqual(state.arcade.autoBatch);
    expect(store.writes).toEqual([]);
    expect(session.save(session.loaded.state, NOW)).toEqual({ ok: true });
    const reopened = new SaveSession(store, NOW);
    expect(reopened.loaded.state.arcade.autoBatch).toEqual(state.arcade.autoBatch);
  });

  it.each([false, true])("preserves armed r4 authority with a verified upgrade or frozen failed view (failure=%s)", fail => {
    let state = game();
    for (let i = 0; i < 3; i++) state = grantRun(state, "bonus").state;
    const ticketIds = state.arcade.runs.map(run => run.id);
    state.arcade.runs.shift();
    state.arcade.autoBatch = { armed: true, planetId: state.activePlanetId, ticketIds, completed: 1,
      maxDeuterium: "100", spentDeuterium: "65", bets: { ...state.arcade.bets }, stopReason: "" };
    const source = legacy(4, exportSave(state, NOW)), store = new MemoryStore(source);
    if (fail) store.write = () => { throw Error("backup quota"); };
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe(fail ? "protected" : "ready");
    expect(session.loaded.state.arcade.autoBatch).toEqual(state.arcade.autoBatch);
    expect(session.loaded.state.orders.tasks).toEqual([]);
    if (fail) {
      expect(session.export(game())).toEqual({ raw: source, protected: true });
      expect(store.data[STORAGE_KEY]).toBe(source);
    } else {
      expect(store.data[BACKUP_KEY]).toBe(source);
      expect(session.notice).toContain("已有星环有限批次授权保持不变");
      expect(session.notice).not.toContain("旧星环自动卡已停用");
      expect(new SaveSession(store, NOW).loaded.state.arcade.autoBatch).toEqual(state.arcade.autoBatch);
    }
  });

  it("does not falsely report an unreadable startup as a missing save", () => {
    const source = raw(), store = new MemoryStore(source);
    store.read = () => { throw Error("read denied"); };
    const session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected");
    expect(session.save(game(), NOW)).toMatchObject({ ok: false });
    expect(() => session.export(game())).toThrow("read denied");
    store.read = undefined;
    expect(session.export(game())).toEqual({ raw: source, protected: true });
    const result = accepted(session.importText(raw(91), NOW));
    expect(result.state.manualClicks).toBe(91);
    expect(store.data[BACKUP_KEY]).toBe(source);
  });
});

describe("SaveSession verified replacements", () => {
  it("replaces in memory only after backup and verified current write", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const previous = session.loaded.state;
    let visible = previous;
    store.write = (key) => { expect(visible).toBe(previous); expect(key === BACKUP_KEY || key === STORAGE_KEY).toBe(true); };
    const result = accepted(session.importText(raw(91), NOW));
    visible = result.state;
    expect(visible.manualClicks).toBe(91);
    expect(session.isCurrentReplacement(result)).toBe(true);
    expect(store.data[BACKUP_KEY]).toBe(source);
    expect(store.data[STORAGE_KEY]).toBe(result.raw);
  });

  it("invalid imports leave current memory, bytes and protection unchanged", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const previous = session.loaded.state;
    expect(session.importText("not json", NOW)).toMatchObject({ ok: false, code: "invalid" });
    expect(session.mode).toBe("ready");
    expect(session.loaded.state).toBe(previous);
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(store.writes).toEqual([]);
  });

  it("a protected malformed original can be explicitly replaced after a verified backup", () => {
    const store = new MemoryStore("broken original"), session = new SaveSession(store, NOW);
    const result = accepted(session.importText(raw(91), NOW));
    expect(session.mode).toBe("ready");
    expect(result.state.manualClicks).toBe(91);
    expect(store.data[BACKUP_KEY]).toBe("broken original");
    expect(store.data[STORAGE_KEY]).toBe(result.raw);
  });

  it.each(["backup-write", "backup-read", "backup-noop", "current-write", "current-read", "current-noop"])("fails closed on %s", (fault) => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const previous = session.loaded.state;
    let currentWritten = false;
    store.write = (key) => {
      if (fault === "backup-write" && key === BACKUP_KEY) throw Error("backup denied");
      if (fault === "backup-noop" && key === BACKUP_KEY) return false;
      if (fault === "current-write" && key === STORAGE_KEY) throw Error("current denied");
      if (fault === "current-noop" && key === STORAGE_KEY) return false;
      if (key === STORAGE_KEY) currentWritten = true;
    };
    store.read = (key) => {
      if (fault === "backup-read" && key === BACKUP_KEY && store.data[key] !== undefined) throw Error("backup read denied");
      if (fault === "current-read" && key === STORAGE_KEY && currentWritten) throw Error("current read denied");
      return undefined;
    };
    const result = session.importText(raw(91), NOW);
    expect(result).toMatchObject({ ok: false, code: "storage" });
    expect(session.loaded.state).toBe(previous);
    expect(session.mode).toBe("protected");
    expect(session.export(game(91))).toEqual({ raw: source, protected: true });
    expect(session.save(game(99), NOW)).toMatchObject({ ok: false });
    if (fault !== "current-read") expect(store.data[STORAGE_KEY]).toBe(source);
    if (fault.startsWith("current")) expect(store.data[BACKUP_KEY]).toBe(source);
  });

  it("preserves the original if a store writes then throws", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    store.write = (key, value) => { if (key === STORAGE_KEY) { store.data[key] = value; throw Error("uncertain write"); } };
    expect(session.reset(NOW)).toMatchObject({ ok: false, code: "storage" });
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(store.data[BACKUP_KEY]).toBe(source);
    expect(session.export(game())).toEqual({ raw: source, protected: true });
    expect(session.reset(NOW)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("reset verifies a new save immediately without removeItem or delayed autosave", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const result = accepted(session.reset(NOW));
    expect(result.state.manualClicks).toBe(0);
    expect(store.data[BACKUP_KEY]).toBe(source);
    expect(store.data[STORAGE_KEY]).toBe(result.raw);
    expect(store.removals).toEqual([]);
  });

  it("failed reset keeps current memory and bytes intact, then can be explicitly retried", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    store.write = () => { throw Error("quota"); };
    expect(session.reset(NOW)).toMatchObject({ ok: false });
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(store.data[STORAGE_KEY]).toBe(source);
    store.write = undefined;
    expect(accepted(session.reset(NOW)).state.manualClicks).toBe(0);
    expect(session.mode).toBe("ready");
  });

  it("treats equal verified writes as success without relying on a storage event", () => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW);
    expect(session.save(game(), NOW)).toEqual({ ok: true });
    expect(store.writes).toEqual([]);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(false);
    expect(session.mode).toBe("ready");
  });

  it("validates serialization before making any backup or current write", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const invalid = game(); invalid.planets = [];
    expect(session.save(invalid, NOW)).toMatchObject({ ok: false, code: "invalid" });
    expect(store.writes).toEqual([]);
    expect(store.data[STORAGE_KEY]).toBe(source);
  });
});

describe("SaveSession cross-tab conflicts and read failures", () => {
  it("detects a competing tab before save even without a storage event", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    const newer = raw(88); store.data[STORAGE_KEY] = newer;
    expect(session.save(game(99), NOW)).toMatchObject({ ok: false, code: "conflict" });
    expect(session.reset(NOW)).toMatchObject({ ok: false, code: "conflict" });
    expect(store.data[STORAGE_KEY]).toBe(newer);
    expect(store.writes).toEqual([]);
    expect(session.export(game(99))).toEqual({ raw: source, protected: true });
  });

  it("rechecks current after creating a backup", () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW), newer = raw(88);
    store.write = (key) => { if (key === BACKUP_KEY) store.data[STORAGE_KEY] = newer; };
    expect(session.importText(raw(99), NOW)).toMatchObject({ ok: false, code: "conflict" });
    expect(store.data[STORAGE_KEY]).toBe(newer);
    expect(store.data[BACKUP_KEY]).toBe(source);
  });

  it("locks on storage change/clear, ignores unrelated or same-value events", () => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW);
    expect(session.handleStorageEvent("unrelated")).toBe(false);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(false);
    delete store.data[STORAGE_KEY];
    expect(session.handleStorageEvent(null)).toBe(true);
    expect(session.mode).toBe("conflict");
    expect(session.save(game(99), NOW)).toMatchObject({ ok: false });
  });

  it("protects cached bytes when a compare read or event read fails", () => {
    for (const operation of ["save", "event"] as const) {
      const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
      store.read = () => { throw Error("read denied"); };
      if (operation === "save") expect(session.save(game(99), NOW)).toMatchObject({ ok: false, code: "storage" });
      else expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true);
      expect(session.mode).toBe("protected");
      expect(session.export(game(99))).toEqual({ raw: source, protected: true });
      expect(store.writes).toEqual([]);
    }
  });
});

describe("append-only recovery backups", () => {
  it("never rotates over the sole original, and reuses an identical verified copy", () => {
    const store = new MemoryStore(); store.data[BACKUP_KEY] = "first original";
    expect(preserveRawSave(store, "second original")).toBe(`${BACKUP_KEY}.1`);
    expect(store.data[BACKUP_KEY]).toBe("first original");
    expect(preserveRawSave(store, "second original")).toBe(`${BACKUP_KEY}.1`);
    expect(store.writes).toEqual([`${BACKUP_KEY}.1`]);
  });

  it("fails closed when the archive is full", () => {
    const source = raw(), store = new MemoryStore(source);
    for (let index = 0; index < MAX_SAVE_BACKUPS; index += 1) store.data[index ? `${BACKUP_KEY}.${index}` : BACKUP_KEY] = `original ${index}`;
    const snapshot = { ...store.data }, session = new SaveSession(store, NOW);
    expect(session.reset(NOW)).toMatchObject({ ok: false, code: "storage" });
    expect(store.data).toEqual(snapshot);
    expect(store.writes).toEqual([]);
  });
});

describe("asynchronous file import intents", () => {
  it("only commits the newest file even if an older file resolves later", async () => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW), first = deferredFile(), second = deferredFile();
    const older = session.importFile(first.file, () => NOW), newer = session.importFile(second.file, () => NOW);
    second.resolve(raw(22)); const result = accepted(await newer);
    first.resolve(raw(11)); expect(await older).toMatchObject({ ok: false, code: "stale" });
    expect(result.state.manualClicks).toBe(22);
    expect(store.data[STORAGE_KEY]).toBe(result.raw);
  });

  it.each(["reset", "text", "manual", "save", "conflict"])("retires a pending file on %s", async (operation) => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW), pending = deferredFile();
    const result = session.importFile(pending.file, () => NOW);
    if (operation === "reset") accepted(session.reset(NOW));
    if (operation === "text") accepted(session.importText(raw(22), NOW));
    if (operation === "manual") session.cancelPendingImport();
    if (operation === "save") session.save(game(33), NOW);
    if (operation === "conflict") { store.data[STORAGE_KEY] = raw(44); session.handleStorageEvent(STORAGE_KEY); }
    const current = store.data[STORAGE_KEY];
    pending.resolve(raw(99));
    expect(await result).toMatchObject({ ok: false, code: "stale" });
    expect(store.data[STORAGE_KEY]).toBe(current);
  });

  it("a canceled file rejection cannot supersede a newer successful operation", async () => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW), pending = deferredFile();
    const result = session.importFile(pending.file, () => NOW);
    const reset = accepted(session.reset(NOW));
    pending.reject(Error("read failed"));
    expect(await result).toMatchObject({ ok: false, code: "stale" });
    expect(session.isCurrentReplacement(reset)).toBe(true);
    expect(store.data[STORAGE_KEY]).toBe(reset.raw);
  });

  it("retires failure status if a newer intent occurs before the UI resumes", async () => {
    const store = new MemoryStore(raw()), session = new SaveSession(store, NOW);
    const pending = session.importFile({ text: async () => "invalid JSON" }, () => NOW);
    await Promise.resolve(); // The file result is complete; its caller has not adopted it yet.
    accepted(session.reset(NOW));
    const result = await pending;
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(session.isCurrentFileResult(result)).toBe(false);
  });

  it("reports a current file read failure without touching memory or storage", async () => {
    const source = raw(), store = new MemoryStore(source), session = new SaveSession(store, NOW);
    expect(await session.importFile({ text: async () => { throw Error("read failed"); } })).toMatchObject({ ok: false, code: "invalid" });
    expect(session.loaded.state.manualClicks).toBe(17);
    expect(store.data[STORAGE_KEY]).toBe(source);
    expect(store.writes).toEqual([]);
  });
});
