import { expectedFreshNpcWallet, expectedEmptyNpcBattles } from "./npc-wallet-expectations";
import { stripVerifiedNpcRemainders } from "./helpers";
import { describe, expect, it } from "vitest";
import fixedR10 from "./fixtures/demolition-r10.json";
import { STORAGE_KEY } from "../src/game/content";
import { BACKUP_KEY, MAX_SAVE_BACKUPS, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";

function row(id: string) {
  const found = fixedR10.rows.find(value => value.id === id);
  if (!found) throw Error(`Missing fixed source fixture ${id}`);
  return found;
}
function lifted(old: any) {
  return { ...old, revision: 13, state: { ...old.state, npcEconomy: expectedFreshNpcWallet(), npcBattles: expectedEmptyNpcBattles(), planets: old.state.planets.map((planet: any) => ({ ...planet, demolition: null })) } };
}
function assertOnlyMigrationMetadata(actual: any, old: any) {
  expect(actual.revision).toBe(13);
  for (const planet of actual.state.planets) {
    expect(Object.hasOwn(planet, "demolition")).toBe(true);
    expect(planet.demolition).toBeNull();
  }
  const verified = structuredClone(actual);
  stripVerifiedNpcRemainders(verified.state);
  expect(verified).toEqual(lifted(old));
}
class Store implements KeyValueStore {
  values = new Map<string, string>();
  events: string[] = [];
  fault: "none" | "backup-write" | "backup-read" | "primary-write" | "primary-read" | "concurrent" = "none";
  constructor(raw: string) { this.values.set(STORAGE_KEY, raw); }
  getItem(key: string) {
    this.events.push(`read:${key}`);
    if (this.fault === "backup-read" && key === BACKUP_KEY && this.values.has(key)) return "different backup bytes";
    if (this.fault === "primary-read" && key === STORAGE_KEY && this.events.includes(`write:${STORAGE_KEY}`)) throw Error("post-write read failed");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.events.push(`write:${key}`);
    if (this.fault === "backup-write" && key === BACKUP_KEY || this.fault === "primary-write" && key === STORAGE_KEY) throw Error("synthetic storage failure");
    this.values.set(key, value);
    if (this.fault === "concurrent" && key === BACKUP_KEY) this.values.set(STORAGE_KEY, "other tab owns this slot");
  }
  removeItem(key: string) { this.values.delete(key); }
}

describe("fixed ac3 r10 old-reader oracle", () => {
  it("preserves source identity, exact raw hashes, distinct old canonical bytes and synthetic provenance", async () => {
    const { createHash } = await import("node:crypto" as string);
    expect(fixedR10.sourceSha).toBe("ac3cce98403bea1e7162bcb4092e4cfeeb448a9a");
    expect(fixedR10.originalEvidenceManifestSha256).toBe("184a1497ee30844b52acc74c91d1295e10f6d02e1d1a6476b98fc7c3270050f3");
    expect(fixedR10.rows).toHaveLength(12);
    for (const fixture of fixedR10.rows) {
      expect(fixture.synthetic).toBe(true); expect(fixture.naturalProgression).toBe(false);
      expect(fixture.generationMode).toBe("unmodified-r10-serializer-output");
      expect(createHash("sha256").update(fixture.raw).digest("hex")).toBe(fixture.rawSha256);
      expect(createHash("sha256").update(fixture.oldReaderRaw).digest("hex")).toBe(fixture.oldReaderSha256);
      expect(JSON.parse(fixture.raw).revision).toBe(10);
      expect(JSON.parse(fixture.oldReaderRaw)).toEqual(fixture.oldReaderOutput);
      for (const planet of JSON.parse(fixture.raw).state.planets) expect(planet).not.toHaveProperty("demolition");
    }
  });
  it.each(fixedR10.rows)("only adds null slots and zero NPC age to full fixed-r10 semantics: $id", fixture => {
    const restored = importSave(fixture.raw);
    assertOnlyMigrationMetadata(restored, fixture.oldReaderOutput);
    expect(importSave(JSON.stringify(restored))).toEqual(restored);
    expect(serializeState(deserializeState(restored.state))).toEqual(restored.state);
  });
  it.each(fixedR10.legacyInputs)("matches fixed-r10 reader of preserved true r9 input: $id", fixture => {
    const old = JSON.parse(fixture.fixedR10Raw);
    expect(old.revision).toBe(10);
    assertOnlyMigrationMetadata(importSave(fixture.raw), old);
  });
  it("retains genuine earned grants, original mixed floor, ID gaps and exhausted counter", () => {
    const earned = importSave(row("G10a-earned-grant").raw).state;
    expect(earned.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(earned.terraformerGrantJobFloor).toBe(1); expect(earned.orders.nextJobId).toBe(2);
    const mixed = importSave(row("G10c-mixed-old-paid-new-earned").raw).state;
    expect(mixed.terraformerGrantJobFloor).toBe(2);
    expect(mixed.planets.map(planet => planet.terraformerFields.grantedLevels)).toEqual([0, 1]);
    expect(mixed.planets[0]!.buildQueue[0]!.jobId).toBeLessThan(mixed.terraformerGrantJobFloor);
    const gaps = importSave(row("G10d-cancelled-id-gaps").raw).state;
    expect(gaps.orders.nextJobId).toBe(4);
    const exhausted = importSave(row("E10-exhausted-id-boundary").raw).state;
    expect(exhausted.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("does not retroactively reject legacy overfull planets, ordinary target order, or hidden levels", () => {
    const fixture = row("O10-ordinary-legacy-overfull"), restored = importSave(fixture.raw);
    assertOnlyMigrationMetadata(restored, fixture.oldReaderOutput);
    expect(restored.state.planets[0]!.fieldsMax).toBe(5);
    expect(restored.state.planets[0]!.buildQueue.map(job => job.targetLevel)).toEqual([27, 23]);
  });
  it.each(["floor", "ledger", "base", "grants", "capacity"])("does not reconstruct a damaged actual r10 %s", field => {
    const original = JSON.parse(row("G10a-earned-grant").raw);
    if (field === "floor") delete original.state.terraformerGrantJobFloor;
    if (field === "ledger") delete original.state.planets[0].terraformerFields;
    if (field === "base") delete original.state.planets[0].terraformerFields.base;
    if (field === "grants") delete original.state.planets[0].terraformerFields.grantedLevels;
    if (field === "capacity") original.state.planets[0].fieldsMax++;
    expect(() => importSave(JSON.stringify(original))).toThrow();
  });
});

describe("all-envelope legacy demolition smuggling", () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])("refuses every new marker before reading declared r%i", revision => {
    // Explicit attack derivatives of historical raw; changing the tag is never
    // represented as evidence of a genuine serializer from another revision.
    for (const key of ["demolition", "demolitionRuleVersion", "fromLevel", "toLevel"]) {
      for (const value of [null, 0, false, {}, []]) for (const site of ["planet", "queue", "nested", "envelope"]) {
        const edited = JSON.parse(row("H10-fresh").raw); edited.revision = revision;
        if (site === "planet") edited.state.planets[0][key] = value;
        if (site === "queue") edited.state.planets[0].buildQueue.push({ [key]: value });
        if (site === "nested") edited.state.unknown = { depth: [{ [key]: value }] };
        if (site === "envelope") edited.unknownEnvelope = { depth: [{ [key]: value }] };
        expect(() => importSave(JSON.stringify(edited))).toThrow(/r11/);
      }
    }
    for (const site of ["state", "envelope"]) {
      const edited = JSON.parse(row("H10-fresh").raw); edited.revision = revision;
      (site === "state" ? edited.state : edited).unknown = { depth: [{ kind: "demolition" }] };
      expect(() => importSave(JSON.stringify(edited))).toThrow(/r11/);
    }
  });
});

describe("r13 migration and import raw-byte protection", () => {
  it("backs up exact genuine r10 bytes before the verified r13 write and explains retained grants", () => {
    const fixture = row("G10a-earned-grant"), store = new Store(fixture.raw);
    const session = new SaveSession(store, fixture.oldReaderOutput.lastTickAt);
    expect(session.mode).toBe("ready");
    expect(store.values.get(BACKUP_KEY)).toBe(fixture.raw);
    const written = JSON.parse(store.values.get(STORAGE_KEY)!);
    expect(written.savedAt).toBe(fixture.oldReaderOutput.lastTickAt);
    // SaveSession stamps its verified write time; pure import clock preservation is tested above.
    assertOnlyMigrationMetadata({ ...written, savedAt: fixture.oldReaderOutput.savedAt }, fixture.oldReaderOutput);
    const backupWrite = store.events.indexOf(`write:${BACKUP_KEY}`), primaryWrite = store.events.indexOf(`write:${STORAGE_KEY}`);
    expect(primaryWrite).toBeGreaterThan(backupWrite);
    expect(store.events.slice(backupWrite + 1, primaryWrite)).toContain(`read:${BACKUP_KEY}`);
    expect(session.notice).toContain("已有地形授格账");
    expect(session.notice).not.toContain("不增加格数");
  });
  it.each(["backup-write", "backup-read", "primary-write", "primary-read", "concurrent"] as const)("freezes old semantics and exports original raw after %s", fault => {
    const fixture = row("G10b-multiworld-paid"), store = new Store(fixture.raw); store.fault = fault;
    const session = new SaveSession(store, fixture.oldReaderOutput.lastTickAt + 5000);
    expect(session.mode).toBe(fault === "concurrent" ? "conflict" : "protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    const verified = serializeState(session.loaded.state);
    stripVerifiedNpcRemainders(verified);
    expect(verified).toEqual(lifted(fixture.oldReaderOutput).state);
    expect(session.export(session.loaded.state)).toEqual({ raw: fixture.raw, protected: true });
    expect(session.save(session.loaded.state).ok).toBe(false);
    if (fault === "primary-read") expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(13);
    else if (fault === "concurrent") expect(store.values.get(STORAGE_KEY)).toBe("other tab owns this slot");
    else expect(store.values.get(STORAGE_KEY)).toBe(fixture.raw);
    if (fault.startsWith("backup") || fault === "concurrent") expect(store.events).not.toContain(`write:${STORAGE_KEY}`);
  });
  it("refuses a full backup archive without rotating or exposing uncommitted offline changes", () => {
    const fixture = row("G10b-multiworld-paid"), store = new Store(fixture.raw);
    for (let index = 0; index < MAX_SAVE_BACKUPS; index++) store.values.set(index ? `${BACKUP_KEY}.${index}` : BACKUP_KEY, `retained backup ${index}`);
    const before = new Map(store.values), session = new SaveSession(store, fixture.oldReaderOutput.lastTickAt + 5000);
    expect(session.mode).toBe("protected"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(store.values).toEqual(before); expect(store.events.some(event => event.startsWith("write:"))).toBe(false);
    expect(session.export(session.loaded.state)).toEqual({ raw: fixture.raw, protected: true });
  });
  it("protects invalid imported bytes and leaves valid live and disk state unchanged", () => {
    const current = exportSave(createInitialState(11, 12), 1000), store = new Store(current), session = new SaveSession(store, 1000);
    const old = JSON.parse(row("H10-fresh").raw); old.unknown = [{ demolition: null }];
    const originalLoaded = serializeState(session.loaded.state), before = new Map(store.values);
    expect(session.importText(JSON.stringify(old), 1500)).toMatchObject({ ok: false, code: "invalid" });
    expect(serializeState(session.loaded.state)).toEqual(originalLoaded); expect(store.values).toEqual(before);
    const corruptRaw = JSON.stringify(old), corruptStore = new Store(corruptRaw), protectedSession = new SaveSession(corruptStore, 1000);
    expect(protectedSession.mode).toBe("protected"); expect(corruptStore.values.get(STORAGE_KEY)).toBe(corruptRaw);
    expect(protectedSession.export(protectedSession.loaded.state)).toEqual({ raw: corruptRaw, protected: true });
    expect(corruptStore.events.some(event => event.startsWith("write:"))).toBe(false);
  });
  it("retires delayed file preparation when a newer reset succeeds", async () => {
    const source = exportSave(createInitialState(11, 12), 1000), store = new Store(source), session = new SaveSession(store, 1000);
    let resolve!: (value: string) => void;
    const pending = session.prepareFile({ text: () => new Promise<string>(yes => { resolve = yes; }) });
    const reset = session.reset(2000); expect(reset.ok).toBe(true);
    const resetRaw = store.values.get(STORAGE_KEY);
    resolve(row("G10a-earned-grant").raw);
    const prepared = await pending;
    expect(prepared).toMatchObject({ ok: false, code: "stale" }); expect(session.isCurrentPreparedFile(prepared)).toBe(false);
    expect(store.values.get(STORAGE_KEY)).toBe(resetRaw);
  });
});
