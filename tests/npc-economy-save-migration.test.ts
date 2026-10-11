import { expectedFreshNpcWallet, expectedFullNpcWallet, expectedEmptyNpcBattles, expectedZeroNpcRemainder } from "./npc-wallet-expectations";
import { describe, expect, it } from "vitest";
import fixedR10 from "./fixtures/demolition-r10.json";
import naturalR10Raw from "./fixtures/demolition-origin-r10-save.json?raw";
import { STORAGE_KEY } from "../src/game/content";

import { BACKUP_KEY, MAX_SAVE_BACKUPS, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { createInitialState } from "../src/game/state";

const INITIAL = expectedFreshNpcWallet();
function liftR10(old: any) {
  return { ...old, revision: 13, state: { ...old.state, npcEconomy: INITIAL, npcBattles: expectedEmptyNpcBattles(),
    planets: old.state.planets.map((planet: any) => ({ ...planet, demolition: null, npcResourceRemainder: expectedZeroNpcRemainder() })) } };
}
function fixture(id: string) {
  const row = fixedR10.rows.find(value => value.id === id);
  if (!row) throw Error(`Missing genuine r10 source fixture ${id}`);
  return row;
}

type Fault = "none" | "backup-throw" | "backup-drop" | "backup-read" | "primary-throw" | "primary-drop" | "primary-read" | "primary-corrupt" | "concurrent";
/** Explicit in-memory fault injection; not native browser/localStorage evidence. */
class Store implements KeyValueStore {
  values = new Map<string, string>();
  events: string[] = [];
  fault: Fault = "none";
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

describe("NPC age-zero migration preserves genuine historical state", () => {
  it.each(fixedR10.rows)("only adds NPC age-zero and the historical null demolition slots: $id", row => {
    expect(JSON.parse(row.raw).revision).toBe(10);
    const migrated = importSave(row.raw);
    expect(migrated).toEqual(liftR10(row.oldReaderOutput));
    expect(importSave(JSON.stringify(migrated))).toEqual(migrated);
    expect(serializeState(deserializeState(migrated.state))).toEqual(migrated.state);
  });

  it.each(fixedR10.legacyInputs)("uses the fixed old-reader normalization for preserved r9: $id", row => {
    expect(importSave(row.raw)).toEqual(liftR10(JSON.parse(row.fixedR10Raw)));
  });

  it("preserves the exact natural r10 bytes, 25810-second world, grants and complete old projection", async () => {
    const { createHash } = await import("node:crypto" as string);
    expect(createHash("sha256").update(naturalR10Raw).digest("hex"))
      .toBe("d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a");
    const old = JSON.parse(naturalR10Raw);
    expect(old.revision).toBe(10); expect(old.state.totalTime).toBe("25810");
    expect(old.state.universe.seed).toBe(20261010); expect(old.state.nextFleetId).toBe(4);
    const current = importSave(naturalR10Raw);
    expect(current).toEqual(liftR10(old));
    expect(current.state.npcEconomy).toEqual(INITIAL);
    expect(current.state.npcEconomy.baseline).toEqual({ stock: [500, 250, 0], mark: 0 });
    const store = new Store(naturalR10Raw), session = new SaveSession(store, old.lastTickAt);
    expect(session.mode).toBe("ready"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.loaded.state.npcEconomy).toEqual(INITIAL);
    expect(store.values.get(BACKUP_KEY)).toBe(naturalR10Raw);
    const disk = JSON.parse(store.values.get(STORAGE_KEY)!);
    expect({ ...disk, savedAt: old.savedAt }).toEqual(current);
  });

  it("does not rebase earned grants, mixed grant floor, cancelled ID gaps or exhausted counter", () => {
    const earned = importSave(fixture("G10a-earned-grant").raw).state;
    expect(earned.planets[0]!.terraformerFields).toEqual({ base: 163, grantedLevels: 1 });
    expect(earned.terraformerGrantJobFloor).toBe(1); expect(earned.orders.nextJobId).toBe(2);
    const mixed = importSave(fixture("G10c-mixed-old-paid-new-earned").raw).state;
    expect(mixed.terraformerGrantJobFloor).toBe(2);
    expect(mixed.planets.map(planet => planet.terraformerFields.grantedLevels)).toEqual([0, 1]);
    expect(importSave(fixture("G10d-cancelled-id-gaps").raw).state.orders.nextJobId).toBe(4);
    expect(importSave(fixture("E10-exhausted-id-boundary").raw).state.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("SaveSession NPC upgrade is adopted only after verified persistence", () => {
  it("backs up the exact source before writing age-zero upgrade with matching controlled wall clock", () => {
    const row = fixture("G10b-multiworld-paid"), store = new Store(row.raw);
    const session = new SaveSession(store, row.oldReaderOutput.lastTickAt);
    expect(session.mode).toBe("ready"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(store.values.get(BACKUP_KEY)).toBe(row.raw);
    expect(session.loaded.state.npcEconomy).toEqual(INITIAL);
    expect(session.notice).toContain("NPC 库存从初始500金属、250晶体、0重氢开始");
    expect(session.notice).toContain("仅采用原水位之后本次封顶离线时间");
    const written = JSON.parse(store.values.get(STORAGE_KEY)!);
    expect({ ...written, savedAt: row.oldReaderOutput.savedAt }).toEqual(liftR10(row.oldReaderOutput));
    const backup = store.events.indexOf(`write:${BACKUP_KEY}`), primary = store.events.indexOf(`write:${STORAGE_KEY}`);
    expect(primary).toBeGreaterThan(backup);
    expect(store.events.slice(backup + 1, primary)).toContain(`read:${BACKUP_KEY}`);
  });

  it.each(["backup-throw", "backup-drop", "backup-read", "primary-throw", "primary-drop", "primary-read", "primary-corrupt", "concurrent"] as const)
  ("keeps readable age-zero semantics frozen and original export after %s", fault => {
    const row = fixture("G10b-multiworld-paid"), store = new Store(row.raw); store.fault = fault;
    const session = new SaveSession(store, row.oldReaderOutput.lastTickAt + 100_000_000);
    expect(session.mode).toBe(fault === "concurrent" ? "conflict" : "protected");
    expect(session.loaded.appliedSeconds).toBe(0);
    expect(serializeState(session.loaded.state)).toEqual(liftR10(row.oldReaderOutput).state);
    expect(session.export(session.loaded.state)).toEqual({ raw: row.raw, protected: true });
    expect(session.save(session.loaded.state).ok).toBe(false);
    expect(session.notice).not.toContain("升级为");
    if (fault === "primary-read") {
      // The write happened; only adoption is refused. Never claim disk is unchanged.
      expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(13);
      expect(JSON.parse(store.values.get(STORAGE_KEY)!).state.npcEconomy.now).toBe(7200);
    } else if (fault === "primary-corrupt") expect(store.values.get(STORAGE_KEY)).toBe("corrupted write");
    else if (fault === "concurrent") expect(store.values.get(STORAGE_KEY)).toBe("other tab changed the slot");
    else expect(store.values.get(STORAGE_KEY)).toBe(row.raw);
    if (fault.startsWith("backup") || fault === "concurrent") expect(store.events).not.toContain(`write:${STORAGE_KEY}`);
  });

  it("fails closed when backup slots are full, without rotation or granting unseen offline production", () => {
    const row = fixture("G10b-multiworld-paid"), store = new Store(row.raw);
    for (let index = 0; index < MAX_SAVE_BACKUPS; index++) store.values.set(index ? `${BACKUP_KEY}.${index}` : BACKUP_KEY, `retained-${index}`);
    const before = new Map(store.values), session = new SaveSession(store, row.oldReaderOutput.lastTickAt + 100_000_000);
    expect(session.mode).toBe("protected"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.loaded.state.npcEconomy).toEqual(INITIAL); expect(store.values).toEqual(before);
    expect(store.events.some(event => event.startsWith("write:"))).toBe(false);
    expect(session.export(session.loaded.state)).toEqual({ raw: row.raw, protected: true });
  });

  it("separates natural migration age zero from one capped offline adoption and repeat reloads", () => {
    const original = JSON.parse(naturalR10Raw), migrated = importSave(naturalR10Raw);
    expect(migrated.state.npcEconomy.now).toBe(0);
    const now = original.lastTickAt + 100_000_000, store = new Store(naturalR10Raw);
    const session = new SaveSession(store, now);
    expect(session.mode).toBe("ready"); expect(session.loaded.rawSeconds).toBe(100000);
    expect(session.loaded.appliedSeconds).toBe(7200); expect(session.loaded.capped).toBe(true);
    expect(session.loaded.state.npcEconomy.now).toBe(7200);
    expect(session.loaded.state.totalTime.toString()).toBe("33010");
    expect(session.loaded.state.npcEconomy).toEqual(expectedFreshNpcWallet(7200));
    expect(store.values.get(BACKUP_KEY)).toBe(naturalR10Raw);
    const disk = store.values.get(STORAGE_KEY)!, persisted = importSave(disk);
    expect(persisted.lastTickAt).toBe(now); expect(persisted.state.npcEconomy.now).toBe(7200);
    for (let index = 0; index < 3; index++) {
      const reloaded = new SaveSession(store, now);
      expect(reloaded.mode).toBe("ready"); expect(reloaded.loaded.appliedSeconds).toBe(0);
      expect(serializeState(reloaded.loaded.state)).toEqual(persisted.state);
      expect(store.values.get(STORAGE_KEY)).toBe(disk);
    }
  });

  it.each([0, 6])("current save adopts only the %s-hour-bonus cap, with the bounded wallet clock and actual inventory persisted once", bonus => {
    const initial = createInitialState(23, 42); initial.offlineBonusHours = bonus;
    const store = new Store(exportSave(initial, 1000)), now = 100_001_000;
    const session = new SaveSession(store, now), cap = bonus ? 28800 : 7200;
    expect(session.loaded.appliedSeconds).toBe(cap);
    expect(session.loaded.state.npcEconomy).toEqual(bonus ? expectedFullNpcWallet(4800) : expectedFreshNpcWallet(7200));
    expect(session.loaded.state.totalTime.toString()).toBe(String(cap));
    // Current-revision load does not write by itself; the normal adopted save owns its watermark.
    expect(session.save(session.loaded.state, now).ok).toBe(true);
    const reloaded = new SaveSession(store, now);
    expect(reloaded.loaded.appliedSeconds).toBe(0);
    expect(serializeState(reloaded.loaded.state)).toEqual(serializeState(session.loaded.state));
  });

  it("replaces world, age and messages on valid import, while failed import/reset cannot change them", () => {
    const old = createInitialState(23, 42); old.npcEconomy = expectedFreshNpcWallet(9900);
    const store = new Store(exportSave(old, 1000)), session = new SaveSession(store, 1000);
    const next = createInitialState(91, 92); next.npcEconomy = expectedFreshNpcWallet(0.25);
    const result = session.importText(exportSave(next, 1000), 2000);
    expect(result.ok).toBe(true); if (!result.ok) throw Error(result.message);
    expect(result.state.npcEconomy).toEqual(next.npcEconomy);
    expect(result.state.universe).toEqual(next.universe); expect(result.state.messages).toEqual(next.messages);
    const adopted = serializeState(result.state), before = new Map(store.values);
    const malformed = JSON.parse(result.raw); delete malformed.state.npcEconomy;
    expect(session.importText(JSON.stringify(malformed), 3000)).toMatchObject({ ok: false, code: "invalid" });
    expect(serializeState(result.state)).toEqual(adopted); expect(store.values).toEqual(before);
    store.fault = "primary-throw";
    expect(session.reset(4000).ok).toBe(false); expect(serializeState(result.state)).toEqual(adopted);
    expect(session.export(result.state)).toEqual({ raw: result.raw, protected: true });
  });
});
