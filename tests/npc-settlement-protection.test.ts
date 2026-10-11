import { describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../src/game/content";
import { SaveSession } from "../src/game/save-session";
import { exportSave, type KeyValueStore } from "../src/game/save";
import { createInitialState } from "../src/game/state";

function fixture() {
  const state = createInitialState(20261010, 123);
  const raw = exportSave(state, 1000, 1000);
  const values = new Map([[STORAGE_KEY, raw]]);
  const accesses: string[] = [];
  const store: KeyValueStore = {
    getItem(key) { accesses.push(`read:${key}`); return values.get(key) ?? null; },
    setItem(key, value) { accesses.push(`write:${key}`); values.set(key, value); },
    removeItem(key) { accesses.push(`remove:${key}`); values.delete(key); },
  };
  const session = new SaveSession(store, 1000);
  accesses.length = 0;
  return { state, raw, values, accesses, session };
}

describe("unadopted NPC settlement failure protects the existing save baseline", () => {
  it("performs no IO, retires prepared import, and exports original bytes instead of a candidate", async () => {
    const f = fixture();
    const prepared = await f.session.prepareFile({ text: async () => f.raw });
    expect(prepared.ok).toBe(true); expect(f.session.isCurrentPreparedFile(prepared)).toBe(true);
    const before = new Map(f.values); f.accesses.length = 0;
    const outcome = f.session.freezeSimulation(new Error("NPC candidate invariant"));
    expect(outcome).toMatchObject({ ok: false, code: "protected" });
    expect(f.session.mode).toBe("protected");
    expect(f.session.message).toContain("当前候选未采用");
    expect(f.session.message).not.toContain("存档操作失败");
    expect(f.session.isCurrentPreparedFile(prepared)).toBe(false);
    expect(f.session.export(f.state, 9000, 8000)).toEqual({ raw: f.raw, protected: true });
    expect(f.session.save(f.state, 9000, 8000).ok).toBe(false);
    expect(f.session.saveBackground(f.state, 9000, 8000).ok).toBe(false);
    expect(f.accesses).toEqual([]); expect(f.values).toEqual(before);
    const replaced = f.session.importText(f.raw, 1000);
    expect(replaced.ok).toBe(true); expect(f.session.mode).toBe("ready");
    expect(f.session.isCurrentPreparedFile(prepared)).toBe(false);
  });
  it("does not downgrade an observed cross-tab conflict or overwrite its protected original", () => {
    const f = fixture(); f.values.set(STORAGE_KEY, "other tab source");
    expect(f.session.handleStorageEvent(STORAGE_KEY)).toBe(true);
    expect(f.session.mode).toBe("conflict"); const message = f.session.message;
    const before = new Map(f.values); f.accesses.length = 0;
    expect(f.session.freezeSimulation(new Error("late failure"))).toMatchObject({ code: "conflict" });
    expect(f.session.mode).toBe("conflict"); expect(f.session.message).toBe(message);
    expect(f.session.export(f.state)).toEqual({ raw: f.raw, protected: true });
    expect(f.accesses).toEqual([]); expect(f.values).toEqual(before);
  });
});
