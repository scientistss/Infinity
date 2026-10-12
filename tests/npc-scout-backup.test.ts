import { describe, expect, it } from "vitest";
import historical from "./fixtures/npc-economy-r11.json";
import { STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";

type Fault = "none" | "backup-throw" | "backup-drop" | "backup-read" | "primary-throw" | "primary-drop" | "primary-read" | "primary-corrupt" | "concurrent";
/** Explicit memory-store fault injection, not a browser/localStorage acceptance claim. */
class Store implements KeyValueStore {
  values = new Map<string, string>(); events: string[] = []; fault: Fault = "none";
  constructor(raw: string) { this.values.set(STORAGE_KEY, raw); }
  getItem(key: string) {
    this.events.push(`read:${key}`);
    if (this.fault === "backup-read" && key === BACKUP_KEY && this.values.has(key)) return "unverified backup";
    if (this.fault === "primary-read" && key === STORAGE_KEY && this.events.includes(`write:${STORAGE_KEY}`)) throw Error("post-write read refusal");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.events.push(`write:${key}`);
    if (this.fault === "backup-throw" && key === BACKUP_KEY || this.fault === "primary-throw" && key === STORAGE_KEY) throw Error("quota exceeded");
    if (this.fault === "backup-drop" && key === BACKUP_KEY || this.fault === "primary-drop" && key === STORAGE_KEY) return;
    this.values.set(key, this.fault === "primary-corrupt" && key === STORAGE_KEY ? "corrupted write" : value);
    if (this.fault === "concurrent" && key === BACKUP_KEY) this.values.set(STORAGE_KEY, "other tab changed the slot");
  }
  removeItem(key: string) { this.values.delete(key); }
}

describe("r14 null-history migration preserves raw backup protection", () => {
  it.each(historical.rows)("only adds null to genuine normalized r11 messages: $id", row => {
    const migrated = importSave(row.raw);
    expect(migrated.revision).toBe(14);
    expect(migrated.state.messages).toEqual(row.oldReaderOutput.state.messages.map(message => ({ ...message, npcScoutSnapshot: null })));
    expect(migrated.state.nextFleetId).toBe(row.oldReaderOutput.state.nextFleetId);
    expect(migrated.state.fleets).toEqual(row.oldReaderOutput.state.fleets);
    expect(migrated.state.totalTime).toBe(row.oldReaderOutput.state.totalTime);
    expect(importSave(JSON.stringify(migrated))).toEqual(migrated);
  });
  it("writes and verifies the exact original bytes before the r14 adoption", () => {
    const row = historical.rows[0], source = JSON.parse(row.raw), store = new Store(row.raw);
    const session = new SaveSession(store, source.lastTickAt);
    expect(session.mode).toBe("ready"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(store.values.get(BACKUP_KEY)).toBe(row.raw);
    expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(14);
    const backup = store.events.indexOf(`write:${BACKUP_KEY}`), primary = store.events.indexOf(`write:${STORAGE_KEY}`);
    expect(primary).toBeGreaterThan(backup); expect(store.events.slice(backup + 1, primary)).toContain(`read:${BACKUP_KEY}`);
    expect(session.loaded.state.messages.every(message => message.npcScoutSnapshot === null)).toBe(true);
  });
  it.each(["backup-throw", "backup-drop", "backup-read", "primary-throw", "primary-drop", "primary-read", "primary-corrupt", "concurrent"] as const)
  ("preserves exact exportable original and does not adopt catch-up after %s", fault => {
    const row = historical.rows[0], source = JSON.parse(row.raw), expected = importSave(row.raw), store = new Store(row.raw); store.fault = fault;
    const session = new SaveSession(store, source.lastTickAt + 100_000_000);
    expect(session.mode).toBe(fault === "concurrent" ? "conflict" : "protected");
    expect(session.loaded.appliedSeconds).toBe(0); expect(serializeState(session.loaded.state)).toEqual(expected.state);
    expect(session.export(session.loaded.state)).toEqual({ raw: row.raw, protected: true });
    expect(session.save(session.loaded.state).ok).toBe(false);
    if (fault === "primary-read") expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(14);
    else if (fault === "primary-corrupt") expect(store.values.get(STORAGE_KEY)).toBe("corrupted write");
    else if (fault === "concurrent") expect(store.values.get(STORAGE_KEY)).toBe("other tab changed the slot");
    else expect(store.values.get(STORAGE_KEY)).toBe(row.raw);
  });
  it("rejects hidden new history in an old source without changing its source slot", () => {
    const source = JSON.parse(historical.rows[0].raw); source.ignored = { deeply: [{ npcScoutSnapshot: null }] };
    const raw = JSON.stringify(source, null, 2), store = new Store(raw), session = new SaveSession(store, source.lastTickAt);
    expect(session.mode).toBe("protected"); expect(store.values.get(STORAGE_KEY)).toBe(raw);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
    expect(store.events.some(event => event.startsWith("write:"))).toBe(false);
  });
});
