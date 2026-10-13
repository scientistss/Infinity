import { describe, expect, it } from "vitest";
import historical from "./fixtures/npc-scout-legacy.json";
import { SAVE_REVISION, STORAGE_KEY, SUPPORTED_SAVE_REVISIONS } from "../src/game/content";
import { createEnergyChallengeState, emptyEnergyChallengeProofs } from "../src/game/energy-challenge-state";
import { BACKUP_KEY, deserializeState, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";

/** The checked-in source fixtures contain actual archived r2–r13 serializer bytes. */
function publicR14(row = historical.rows[0]) {
  const old = structuredClone(row.r13ReaderOutput);
  return { ...old, revision: 14, state: { ...old.state,
    messages: old.state.messages.map(message => ({ ...message, npcScoutSnapshot: null })) } };
}
type Fault = "none" | "backup-quota" | "backup-drop" | "backup-read" | "primary-quota" | "primary-drop" | "primary-read" | "concurrent";
/** Explicit deterministic storage faults, not native-browser acceptance evidence. */
class Store implements KeyValueStore {
  values = new Map<string, string>(); events: string[] = []; fault: Fault = "none";
  constructor(raw: string) { this.values.set(STORAGE_KEY, raw); }
  getItem(key: string): string | null {
    this.events.push(`read:${key}`);
    if (this.fault === "backup-read" && key === BACKUP_KEY && this.values.has(key)) return "unverified backup";
    if (this.fault === "primary-read" && key === STORAGE_KEY && this.events.includes(`write:${STORAGE_KEY}`)) throw Error("readback unavailable");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.events.push(`write:${key}`);
    if (this.fault === "backup-quota" && key === BACKUP_KEY || this.fault === "primary-quota" && key === STORAGE_KEY) throw Error("quota exceeded");
    if (this.fault === "backup-drop" && key === BACKUP_KEY || this.fault === "primary-drop" && key === STORAGE_KEY) return;
    this.values.set(key, value);
    if (this.fault === "concurrent" && key === BACKUP_KEY) this.values.set(STORAGE_KEY, "changed by another tab");
  }
  removeItem(key: string): void { this.events.push(`remove:${key}`); this.values.delete(key); }
}

describe("r16 frozen historical chain and additive challenge migration", () => {
  it("explicitly supports all public sources and omits unknown r15", () => {
    expect(SAVE_REVISION).toBe(16);
    expect(SUPPORTED_SAVE_REVISIONS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]);
    expect([...new Set(historical.rows.map(row => row.revision))].sort((a, b) => a - b))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
  it.each(historical.rows)("first preserves the complete public r14 canonical projection: $id", row => {
    const old = publicR14(row), before = row.raw, adopted = importSave(row.raw);
    const expected = { ...old, revision: 16, state: { energyChallenge: createEnergyChallengeState(), ...old.state } };
    expect(adopted).toEqual(expected);
    expect(row.raw).toBe(before);
    expect(adopted.state.energyChallenge).toEqual(createEnergyChallengeState());
    expect(importSave(JSON.stringify(adopted))).toEqual(adopted);
    expect(serializeState(deserializeState(adopted.state))).toEqual(adopted.state);
  });
  it("accepts direct r14 and preserves every existing canonical field", () => {
    // Exact public additive r13→r14 projection; not mislabeled current r16 data.
    const source = publicR14(), raw = JSON.stringify(source, null, 2), adopted = importSave(raw);
    const { energyChallenge, ...oldProjection } = adopted.state;
    expect(oldProjection).toEqual(source.state);
    expect(energyChallenge).toEqual(createEnergyChallengeState());
    expect(adopted.savedAt).toBe(source.savedAt); expect(adopted.lastTickAt).toBe(source.lastTickAt);
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  ("retains ordinary old message text equal to the new model string in r%s", revision => {
    const row = historical.rows.find(value => value.revision === Math.min(revision, 13))!;
    const source: any = revision === 14 ? publicR14(row) : JSON.parse(row.raw);
    source.state.messages = [{ id: "ordinary-model-text", at: 0, text: "energy-tightening-v1", ...(revision === 14 ? { npcScoutSnapshot: null } : {}) }];
    const adopted = importSave(JSON.stringify(source));
    expect(adopted.state.messages[0].text).toBe("energy-tightening-v1");
    expect(adopted.state.energyChallenge).toEqual(createEnergyChallengeState());
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  ("rejects smuggled challenge fields rather than removing them from r%s", revision => {
    const row = historical.rows.find(value => value.revision === Math.min(revision, 13))!;
    for (const misplaced of [false, true]) {
      const source: any = revision === 14 ? publicR14(row) : JSON.parse(row.raw);
      if (misplaced) source.ignored = { nested: { energyChallenge: createEnergyChallengeState() } };
      else source.state.energyChallenge = createEnergyChallengeState();
      const raw = JSON.stringify(source), store = new Store(raw), session = new SaveSession(store, source.lastTickAt);
      expect(session.mode).toBe("protected"); expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
      expect(store.events.some(event => event.startsWith("write:") || event.startsWith("remove:"))).toBe(false);
    }
  });
  it("does not let a fresh challenge mask invalid historical wallet or paid identity", () => {
    for (const mutate of [
      (source: any) => { source.state.npcEconomy.model = "unknown-wallet"; },
      (source: any) => { source.state.orders.nextJobId = 0; },
      (source: any) => { delete source.state.planets[0].npcResourceRemainder; },
      (source: any) => { delete source.state.terraformerGrantJobFloor; },
    ]) {
      const source = publicR14(); mutate(source);
      expect(() => importSave(JSON.stringify(source))).toThrow();
    }
  });
  it.each([3, 4, 5])("preserves legal paid building/research queues of %s entries under cap two", count => {
    const source: any = publicR14();
    // Synthetic legal paid queues, explicitly not historical-source provenance.
    source.state.orders.tasks = []; source.state.orders.accumulator = 0;
    source.state.orders.nextJobId = 2 * count + 1;
    source.state.terraformerGrantJobFloor = 1;
    source.state.planets = [source.state.planets.find((planet: any) => planet.id === "homeworld")];
    source.state.activePlanetId = "homeworld";
    const planet = source.state.planets[0]; planet.buildings.metal_mine = 0;
    planet.shipyardQueue = []; planet.demolition = null;
    source.state.fleets = []; source.state.messages = [];
    planet.buildQueue = Array.from({ length: count }, (_, index) => ({ building: "metal_mine", targetLevel: index + 1,
      paid: { metal: "60", crystal: "15", deuterium: "0" }, totalSeconds: index ? 0 : 1, remainingSeconds: index ? 0 : 1,
      source: "manual", jobId: index + 1, taskId: null }));
    source.state.research.levels.energy_tech = 0;
    source.state.research.queue = Array.from({ length: count }, (_, index) => ({ planetId: "homeworld", tech: "energy_tech", targetLevel: index + 1,
      paid: { metal: "0", crystal: "800", deuterium: "400" }, totalSeconds: index ? 0 : 1, remainingSeconds: index ? 0 : 1,
      source: "manual", jobId: count + index + 1, taskId: null }));
    const adopted = importSave(JSON.stringify(source));
    expect(adopted.state.planets[0].buildQueue).toEqual(planet.buildQueue);
    expect(adopted.state.research.queue).toEqual(source.state.research.queue);
    const active = deserializeState(adopted.state);
    active.hasPrestiged = true; active.stats.launches = Math.max(1, active.stats.launches);
    active.energyChallenge = { ...createEnergyChallengeState(), nextAttemptId: 2, active: {
      attemptId: 1, universeSeed: active.universe.seed, homeworldId: "homeworld", entryJobFloor: 1,
      enteredAt: active.totalTime.toString(), scoreUnits: "0", proofs: emptyEnergyChallengeProofs(),
    } };
    expect(serializeState(active).planets[0].buildQueue).toEqual(planet.buildQueue);
    expect(serializeState(active).research.queue).toEqual(source.state.research.queue);
  });
});

describe("r16 migration preserves SaveSession transaction safety", () => {
  it("rejects unknown r15 before writing and exports byte-exact untouched originals", () => {
    const source = { ...publicR14(), revision: 15 }, raw = `  ${JSON.stringify(source, null, 3)}\n`;
    const store = new Store(raw), session = new SaveSession(store, source.lastTickAt + 100_000);
    expect(session.mode).toBe("protected"); expect(store.values.get(STORAGE_KEY)).toBe(raw);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
    expect(session.save(session.loaded.state).ok).toBe(false);
    expect(store.events.some(event => event.startsWith("write:") || event.startsWith("remove:"))).toBe(false);
  });
  it("verifies exact r14 backup before committing r16 and grants no challenge reward", () => {
    const source = publicR14(), raw = JSON.stringify(source, null, 2), store = new Store(raw);
    const session = new SaveSession(store, source.lastTickAt);
    expect(session.mode).toBe("ready"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(store.values.get(BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(16);
    expect(session.loaded.state.energyChallenge).toEqual(createEnergyChallengeState());
    const backup = store.events.indexOf(`write:${BACKUP_KEY}`), current = store.events.indexOf(`write:${STORAGE_KEY}`);
    expect(current).toBeGreaterThan(backup); expect(store.events.slice(backup + 1, current)).toContain(`read:${BACKUP_KEY}`);
  });
  it.each(["backup-quota", "backup-drop", "backup-read", "primary-quota", "primary-drop", "primary-read", "concurrent"] as const)
  ("retains frozen pre-catch-up state and original export when %s fails", fault => {
    const source = publicR14(), raw = JSON.stringify(source, null, 2), expected = importSave(raw), store = new Store(raw); store.fault = fault;
    const session = new SaveSession(store, source.lastTickAt + 100_000_000);
    expect(session.mode).toBe(fault === "concurrent" ? "conflict" : "protected");
    expect(session.loaded.appliedSeconds).toBe(0); expect(serializeState(session.loaded.state)).toEqual(expected.state);
    expect(session.export(session.loaded.state)).toEqual({ raw, protected: true });
    expect(session.save(session.loaded.state).ok).toBe(false);
    if (fault === "primary-read") expect(JSON.parse(store.values.get(STORAGE_KEY)!).revision).toBe(16);
    else if (fault === "concurrent") expect(store.values.get(STORAGE_KEY)).toBe("changed by another tab");
    else expect(store.values.get(STORAGE_KEY)).toBe(raw);
  });
});
