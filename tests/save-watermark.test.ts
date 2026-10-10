import { describe, expect, it, vi } from "vitest";
import { equipCard } from "../src/automation/engine";
import { AccountedClock, type ClockSample } from "../src/core/accounted-clock";
import { catchUp } from "../src/core/offline";
import { PRESTIGE_SCORE_UNIT, SAVE_REVISION, SCORE_WEIGHTS, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { sendFleet } from "../src/game/fleet";
import { prestige, tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { BACKUP_KEY, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { orderUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const START = 1_000_000;
const FRAME = 250;
const sample = (elapsedMs = 0): ClockSample => ({ wallAt: START + elapsedMs, frameAt: FRAME + elapsedMs });
const game = () => tick(createInitialState(42, 771), 0);

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  writes: string[] = [];
  write: ((key: string, value: string) => boolean | void) | undefined;
  read: ((key: string) => string | null | undefined) | undefined;
  constructor(raw?: string) { if (raw !== undefined) this.data.set(STORAGE_KEY, raw); }
  getItem(key: string): string | null {
    const intercepted = this.read?.(key);
    return intercepted === undefined ? this.data.get(key) ?? null : intercepted;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.write?.(key, value) !== false) this.data.set(key, value);
  }
  removeItem(key: string): void { this.data.delete(key); }
  current(): string { return this.data.get(STORAGE_KEY)!; }
}

function deferredFile() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(yes => { resolve = yes; });
  return { file: { text: () => promise }, resolve };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Real API-created paid jobs, finite intent, protocol authority, and a returning transport. */
function mixedGame(): GameState {
  let state = createInitialState(42, 771);
  const home = state.planets[0]!;
  home.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  Object.assign(home.buildings, {
    metal_mine: 3, crystal_mine: 2, deuterium_synth: 2, solar_plant: 10,
    robotics_factory: 2, shipyard: 2, research_lab: 2,
  });
  home.units.small_cargo = 4;
  state.research.levels.combustion_drive = 6;
  state.research.levels.computer_tech = 2;
  state.manualClicks = 100;
  state.unlockedCards = ["auto_collect"];
  state = equipCard(state, 0, "auto_collect").state;
  const colony = createPlanet("watermark-colony", { ...home.coordinates, position: home.coordinates.position + 1 });
  colony.resources = { metal: big(1e5), crystal: big(1e5), deuterium: big(1e5) };
  state.planets.push(colony);
  for (let i = 0; i < 2; i++) {
    const built = enqueue(state, "metal_mine", "manual");
    expect(built.ok).toBe(true);
    state = built.state;
  }
  const researched = enqueueResearch(state, "energy_tech", "manual");
  expect(researched.ok).toBe(true);
  state = researched.state;
  const units = orderUnits(state, "light_fighter", 5, "manual");
  expect(units.ok).toBe(true);
  state = units.state;
  const ordered = createOrderTask(state, {
    kind: "building", planetId: colony.id, building: "crystal_mine", targetLevel: 3,
    expectedNextTaskId: state.orders.nextTaskId,
    budget: { metal: "1000000", crystal: "1000000", deuterium: "1000000" },
  });
  expect(ordered.ok).toBe(true);
  state = ordered.state;
  const sent = sendFleet(state, {
    mission: "transport", target: colony.coordinates, ships: { small_cargo: 2 },
    cargo: { metal: big(100), crystal: big(50), deuterium: big(0) }, speedPercent: 100,
  });
  expect(sent.ok).toBe(true);
  state = tick(sent.state, 0);
  const restored = deserializeState(importSave(exportSave(state, START)).state);
  expect(serializeState(restored)).toEqual(serializeState(state));
  return freeze(restored);
}

function existingFrameStep(state: GameState, gap: number): GameState {
  return gap >= 5 ? catchUp(state, gap).state : gap > 0 ? tick(state, gap) : state;
}

describe("snapshot timestamps at the save boundary", () => {
  it("keeps old one/two-argument exports and saves paired while accepting an explicit watermark", () => {
    const state = game();
    const now = vi.spyOn(Date, "now").mockReturnValue(START);
    try {
      expect(exportSave(state)).toBe(exportSave(state, START, START));
      expect(exportSave(state, START)).toBe(exportSave(state, START, START));
      const store = new MemoryStore();
      const session = new SaveSession(store, START);
      expect(session.save(state)).toEqual({ ok: true });
      expect(importSave(store.current())).toMatchObject({ savedAt: START, lastTickAt: START });
      expect(session.save(state, START + 100)).toEqual({ ok: true });
      expect(importSave(store.current())).toMatchObject({ savedAt: START + 100, lastTickAt: START + 100 });
      expect(session.save(state, START + 200, START)).toEqual({ ok: true });
      expect(importSave(store.current())).toMatchObject({ savedAt: START + 200, lastTickAt: START });
      expect(session.export(state, START + 300).raw).toBe(exportSave(state, START + 300));
      expect(session.export(state, START + 300, START).raw).toBe(exportSave(state, START + 300, START));
    } finally {
      now.mockRestore();
    }
  });

  it("saves at 15/30/45 seconds without RAF and reloads the complete 61-second window", () => {
    const store = new MemoryStore(exportSave(mixedGame(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const state = session.loaded.state;
    const before = serializeState(state);
    for (const elapsed of [15_000, 30_000, 45_000]) {
      expect(session.save(state, START + elapsed, clock.lastTickAt)).toEqual({ ok: true });
      expect(importSave(store.current())).toMatchObject({ savedAt: START + elapsed, lastTickAt: START });
      const exported = session.export(state, START + elapsed + 500, clock.lastTickAt);
      expect(exported.protected).toBe(false);
      expect(importSave(exported.raw).lastTickAt).toBe(START);
      expect(serializeState(state)).toEqual(before);
      expect(clock.lastTickAt).toBe(START);
    }
    const reloaded = new SaveSession(store, START + 61_000);
    expect(reloaded.loaded.rawSeconds).toBe(61);
    expect(reloaded.loaded.appliedSeconds).toBe(61);
    expect(serializeState(reloaded.loaded.state)).toEqual(serializeState(catchUp(state, 61).state));
    expect(reloaded.loaded.state.totalTime.toNumber()).toBeCloseTo(61, 9);
  });

  it("resumes that same full gap once, then reloads only the following second", () => {
    const store = new MemoryStore(exportSave(mixedGame(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    let state = session.loaded.state;
    for (const elapsed of [15_000, 30_000, 45_000]) {
      expect(session.save(state, START + elapsed, clock.lastTickAt).ok).toBe(true);
    }
    state = catchUp(state, clock.gapSeconds(FRAME + 61_000)).state;
    clock.account(FRAME + 61_000);
    expect(session.save(state, START + 62_000, clock.lastTickAt).ok).toBe(true);
    const reloaded = new SaveSession(store, START + 62_000);
    expect(reloaded.loaded.appliedSeconds).toBe(1);
    expect(serializeState(reloaded.loaded.state)).toEqual(serializeState(catchUp(state, 1).state));
    expect(reloaded.loaded.state.totalTime.toNumber()).toBeCloseTo(62, 9);
  });

  it.each([2, 8])("consumes a ten-hour raw absence once with the %i-hour cap after repeated hidden saves", hours => {
    const initial = game();
    if (hours === 8) {
      initial.curvature.offline_extend = 3;
      initial.offlineBonusHours = 6;
      initial.warpCores = big(3);
    }
    const store = new MemoryStore(exportSave(initial, START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const gapMs = 10 * 3600 * 1000;
    for (const elapsed of [15_000, 30_000, 45_000, 3600_000, 3 * 3600_000, 9 * 3600_000]) {
      expect(session.save(session.loaded.state, START + elapsed, clock.lastTickAt).ok).toBe(true);
    }
    const reloadStore = new MemoryStore(store.current());
    const reloaded = new SaveSession(reloadStore, START + gapMs);
    const resumed = catchUp(session.loaded.state, clock.gapSeconds(FRAME + gapMs));
    expect(resumed.appliedSeconds).toBe(hours * 3600);
    expect(resumed.capped).toBe(true);
    expect(serializeState(reloaded.loaded.state)).toEqual(serializeState(resumed.state));
    expect(reloaded.loaded.appliedSeconds).toBe(hours * 3600);
    clock.account(FRAME + gapMs);
    expect(session.save(resumed.state, START + gapMs, clock.lastTickAt).ok).toBe(true);
    expect(clock.gapSeconds(FRAME + gapMs + 1000)).toBe(1);
    expect(importSave(store.current()).lastTickAt).toBe(START + gapMs);
    const again = new SaveSession(store, START + gapMs + 1000);
    expect(again.loaded.appliedSeconds).toBe(1);
    expect(again.loaded.state.totalTime.toNumber()).toBeCloseTo(hours * 3600 + 1, 7);
    // Startup catch-up also starts an epoch at its full consumed wall window.
    const reloadClock = new AccountedClock(sample(gapMs));
    expect(reloaded.save(reloaded.loaded.state, START + gapMs, reloadClock.lastTickAt)).toEqual({ ok: true });
    expect(new SaveSession(reloadStore, START + gapMs + 1000).loaded.appliedSeconds).toBe(1);
  });
});

describe("unchanged engine cadence with accounted gaps", () => {
  it.each([4999, 5000, 29_999, 30_000])("keeps the entire old-engine state at the %i ms boundary", elapsed => {
    const initial = mixedGame();
    const clock = new AccountedClock(sample());
    const gap = clock.gapSeconds(FRAME + elapsed);
    const actual = existingFrameStep(initial, gap);
    const expected = elapsed >= 5000 ? catchUp(initial, elapsed / 1000).state : tick(initial, elapsed / 1000);
    expect(serializeState(actual)).toEqual(serializeState(expected));
    expect(clock.lastTickAt).toBe(START);
    clock.account(FRAME + elapsed);
    expect(clock.lastTickAt).toBe(START + elapsed);
  });

  it("matches every serialized field across mixed live/offline gaps, queues, plans, protocols, and fleet events", () => {
    const initial = mixedGame();
    const before = serializeState(initial);
    const store = new MemoryStore(exportSave(initial, START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    let actual = initial, expected = initial;
    let withoutCollect = deserializeState(serializeState(initial));
    withoutCollect.protocols.slots[0]!.card!.enabled = false;
    let frameAt = FRAME, oldLastFrame = FRAME;
    for (const elapsed of [16, 4999, 5000, 29_999, 30_000, 1, 60_001, 100]) {
      frameAt += elapsed;
      const oldGap = (frameAt - oldLastFrame) / 1000;
      oldLastFrame = frameAt;
      expected = existingFrameStep(expected, oldGap);
      withoutCollect = existingFrameStep(withoutCollect, oldGap);
      actual = existingFrameStep(actual, clock.gapSeconds(frameAt));
      clock.account(frameAt);
      expect(serializeState(actual)).toEqual(serializeState(expected));
      expect(session.save(actual, START + (frameAt - FRAME) + 250, clock.lastTickAt).ok).toBe(true);
      expect(importSave(store.current()).lastTickAt).toBe(START + frameAt - FRAME);
    }
    expect(serializeState(initial)).toEqual(before);
    expect(actual.stats.buildsCompleted).toBeGreaterThan(2);
    expect(actual.stats.researchCompleted).toBeGreaterThan(0);
    expect(actual.stats.unitsBuilt).toBe(5);
    expect(actual.orders.tasks[0]?.status).toBe("completed");
    expect(actual.fleets).toHaveLength(0);
    // Interval cards reset elapsed to zero after a successful pass. Check the
    // actual effect against an otherwise identical disabled-card engine run.
    expect(actual.protocols.slots[0]?.lamp).toBe("green");
    expect(actual.protocols.slots[0]?.reason).toContain("自动采集 +");
    expect(actual.lifetime.metal.gt(withoutCollect.lifetime.metal)).toBe(true);
    expect(actual.planets[0]!.resources.metal.gt(withoutCollect.planets[0]!.resources.metal)).toBe(true);
  });

  it.each([4000, 61_000])("keeps automatic prestige and curvature accounting inside the same %i ms engine step", elapsed => {
    let initial = game();
    initial.warpCores = big(10);
    initial.curvature.seed_stock = 1;
    initial.curvature.score_boost = 1;
    initial.curvature.offline_extend = 3;
    initial.offlineBonusHours = 6;
    initial.lifetime.metal = big(PRESTIGE_SCORE_UNIT).mul(9).div(SCORE_WEIGHTS.metal);
    initial.unlockedCards = ["auto_prestige"];
    initial = equipCard(initial, 0, "auto_prestige").state;
    initial.protocols.slots[0]!.card!.trigger = { kind: "interval", seconds: 1 };
    initial = freeze(deserializeState(importSave(exportSave(initial, START)).state));
    const clock = new AccountedClock(sample());
    const actual = existingFrameStep(initial, clock.gapSeconds(FRAME + elapsed));
    const expected = existingFrameStep(initial, elapsed / 1000);
    expect(actual.stats.automatedLaunches).toBeGreaterThan(0);
    expect(serializeState(actual)).toEqual(serializeState(expected));
    clock.account(FRAME + elapsed);
    expect(clock.lastTickAt).toBe(START + elapsed);
    expect(actual.totalTime.toNumber()).toBeCloseTo(elapsed / 1000, 9);
  });
});

describe("watermarks respect existing failure and replacement boundaries", () => {
  it("invalid state cannot change the durable watermark or roll back already accounted simulation", () => {
    const source = exportSave(game(), START);
    const store = new MemoryStore(source);
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const state = tick(session.loaded.state, 4);
    clock.account(FRAME + 4000);
    const invalid = { ...state, planets: [] };
    expect(session.save(invalid, START + 15_000, clock.lastTickAt)).toMatchObject({ ok: false, code: "invalid" });
    expect(session.mode).toBe("ready");
    expect(store.current()).toBe(source);
    expect(store.writes).toEqual([]);
    expect(clock.lastTickAt).toBe(START + 4000);
    expect(session.save(state, START + 15_000, clock.lastTickAt)).toEqual({ ok: true });
    expect(new SaveSession(store, START + 16_000).loaded.appliedSeconds).toBe(12);
  });

  it.each(["throw", "noop", "write-then-throw", "readback"] as const)("preserves protected original bytes and the live watermark after a %s write failure", fault => {
    const source = exportSave(game(), START);
    const store = new MemoryStore(source);
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const state = tick(session.loaded.state, 4);
    clock.account(FRAME + 4000);
    let written = false;
    store.write = (key, value) => {
      if (fault === "throw") throw Error("quota full");
      if (fault === "noop") return false;
      written = true;
      if (fault === "write-then-throw") { store.data.set(key, value); throw Error("uncertain write"); }
    };
    store.read = () => {
      if (fault === "readback" && written) throw Error("readback unavailable");
      return undefined;
    };
    expect(session.save(state, START + 15_000, clock.lastTickAt)).toMatchObject({ ok: false, code: "storage" });
    expect(session.mode).toBe("protected");
    expect(clock.lastTickAt).toBe(START + 4000);
    expect(session.export(state, NaN, NaN)).toEqual({ raw: source, protected: true });
    expect(session.save(state, START + 45_000, clock.lastTickAt).ok).toBe(false);
    expect(store.writes).toEqual([STORAGE_KEY]);
  });

  it("keeps cross-tab conflict exports byte-for-byte and does not alter the snapshot clock", () => {
    const source = exportSave(game(), START);
    const store = new MemoryStore(source);
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const foreign = exportSave({ ...game(), manualClicks: 19 }, START + 45_000, START + 20_000);
    store.data.set(STORAGE_KEY, foreign);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true);
    expect(session.mode).toBe("conflict");
    expect(session.export(session.loaded.state, START + 61_000, clock.lastTickAt)).toEqual({ raw: source, protected: true });
    expect(session.save(session.loaded.state, START + 61_000, clock.lastTickAt).ok).toBe(false);
    expect(clock.lastTickAt).toBe(START);
    expect(store.current()).toBe(foreign);
  });

  it.each(["import", "reset"] as const)("a successful %s keeps the replacement timestamp pair and discards the previous pending gap", kind => {
    const store = new MemoryStore(exportSave(game(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    clock.account(FRAME + 1000);
    const replacementSample = sample(25_000); // Captured after the user's confirmation.
    const result = kind === "import"
      ? session.importText(exportSave(game(), START - 100_000), replacementSample.wallAt)
      : session.reset(replacementSample.wallAt);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.message);
    expect(session.isCurrentReplacement(result)).toBe(true);
    clock.rebase(replacementSample);
    expect(importSave(result.raw)).toMatchObject({ savedAt: START + 25_000, lastTickAt: START + 25_000 });
    expect(clock.gapSeconds(FRAME + 26_000)).toBe(1);
    expect(new SaveSession(store, START + 26_000).loaded.appliedSeconds).toBe(1);
  });

  it("captures file replacement time after reading completes, using the unchanged callback API", async () => {
    const store = new MemoryStore(exportSave(game(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const pending = deferredFile();
    let currentSample = sample(5000);
    let replacementSample: ClockSample | null = null;
    const now = vi.fn(() => { replacementSample = currentSample; return currentSample.wallAt; });
    const operation = session.importFile(pending.file, now);
    currentSample = sample(25_000);
    expect(now).not.toHaveBeenCalled();
    pending.resolve(exportSave(game(), START - 100_000));
    const result = await operation;
    expect(result.ok).toBe(true);
    expect(now).toHaveBeenCalledTimes(1);
    if (!result.ok || !replacementSample) throw Error("expected a captured replacement");
    expect(session.isCurrentFileResult(result)).toBe(true);
    expect(session.isCurrentReplacement(result)).toBe(true);
    clock.rebase(replacementSample);
    expect(clock.lastTickAt).toBe(START + 25_000);
    expect(clock.gapSeconds(FRAME + 26_000)).toBe(1);
    expect(importSave(store.current())).toMatchObject({ savedAt: START + 25_000, lastTickAt: START + 25_000 });
  });

  it("a cancelled file read never samples a replacement clock or advances the existing watermark", async () => {
    const store = new MemoryStore(exportSave(game(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    const pending = deferredFile();
    const now = vi.fn(() => START + 25_000);
    const operation = session.importFile(pending.file, now);
    session.cancelPendingImport();
    pending.resolve(exportSave(game(), START - 100_000));
    expect(await operation).toMatchObject({ ok: false, code: "stale" });
    expect(now).not.toHaveBeenCalled();
    expect(clock.lastTickAt).toBe(START);
    expect(store.writes).toEqual([]);
  });

  it.each(["invalid", "write-failed", "stale-after-completion"] as const)("does not rebase a %s file replacement", async kind => {
    const store = new MemoryStore(exportSave(game(), START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    clock.account(FRAME + 1000);
    if (kind === "write-failed") store.write = () => { throw Error("backup quota"); };
    const replacementSample = sample(25_000);
    const result = await session.importFile({ text: async () => kind === "invalid" ? "bad json" : exportSave(game(), START) }, () => replacementSample.wallAt);
    if (kind === "stale-after-completion") session.cancelPendingImport();
    if (result.ok && session.isCurrentFileResult(result) && session.isCurrentReplacement(result)) clock.rebase(replacementSample);
    expect(clock.lastTickAt).toBe(START + 1000);
    expect(clock.gapSeconds(FRAME + 26_000)).toBe(25);
    if (kind === "stale-after-completion") {
      expect(result.ok).toBe(true);
      expect(session.isCurrentFileResult(result)).toBe(false);
    } else expect(result).toMatchObject({ ok: false, code: kind === "invalid" ? "invalid" : "storage" });
  });

  it.each([false, true])("migration uses the old watermark and pairs only its successful replacement (failure=%s)", failed => {
    const legacy = JSON.parse(exportSave(game(), START + 45_000, START));
    legacy.revision = 7;
    delete legacy.state.formations;
    const source = JSON.stringify(legacy);
    const store = new MemoryStore(source);
    if (failed) store.write = () => { throw Error("backup unavailable"); };
    const session = new SaveSession(store, START + 61_000);
    if (failed) {
      expect(session.mode).toBe("protected");
      expect(session.loaded.appliedSeconds).toBe(0);
      expect(session.loaded.state.totalTime.toNumber()).toBe(0);
      expect(session.export(game(), START + 61_000, START + 61_000)).toEqual({ raw: source, protected: true });
    } else {
      expect(session.loaded.appliedSeconds).toBe(61);
      expect(importSave(store.current())).toMatchObject({ revision: SAVE_REVISION, savedAt: START + 61_000, lastTickAt: START + 61_000 });
      expect(store.data.get(BACKUP_KEY)).toBe(source);
    }
  });

  it.each([false, true])("manual prestige retains the pending confirmation gap and write-before-adopt boundary (failure=%s)", failed => {
    const initial = game();
    initial.lifetime.metal = big(PRESTIGE_SCORE_UNIT).mul(9).div(SCORE_WEIGHTS.metal);
    const store = new MemoryStore(exportSave(initial, START));
    const session = new SaveSession(store, START);
    const clock = new AccountedClock(sample());
    let state = tick(session.loaded.state, 4);
    clock.account(FRAME + 4000);
    const before = state;
    const candidate = prestige(state);
    expect(candidate).not.toBe(state);
    if (failed) store.write = () => { throw Error("quota full"); };
    const result = session.save(candidate, START + 25_000, clock.lastTickAt);
    if (result.ok) state = candidate;
    expect(clock.lastTickAt).toBe(START + 4000);
    expect(clock.gapSeconds(FRAME + 26_000)).toBe(22);
    if (failed) {
      expect(state).toBe(before);
      expect(session.mode).toBe("protected");
    } else {
      expect(state).toBe(candidate);
      expect(state.totalTime).toBe(before.totalTime);
      expect(importSave(store.current())).toMatchObject({ savedAt: START + 25_000, lastTickAt: START + 4000 });
      expect(new SaveSession(store, START + 26_000).loaded.appliedSeconds).toBe(22);
    }
  });
});
