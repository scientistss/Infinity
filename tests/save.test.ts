import { activePlanet, withPlanet } from "../src/game/empire";
import { describe, expect, it } from "vitest";
import { equipCard } from "../src/automation/engine";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { grantRun } from "../src/game/arcade";
import { enqueue } from "../src/game/queue";
import {
  SaveVersionError,
  deserializeState,
  exportSave,
  importSave,
  loadGame,
  serializeState,
  writeSave,
  type KeyValueStore,
} from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { tick } from "../src/game/logic";
import { rich, stateWith } from "./helpers";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const V5_SAVE = JSON.stringify({
  version: 5,
  savedAt: 1_710_000_000_000,
  lastTickAt: 1_710_000_000_000,
  state: {
    resources: { metal: "123456", crystal: "7890", deuterium: "12" },
    producers: { metal_mine: "30", solar_plant: "10", crystal_mine: "12", deuterium_synth: "3", robotics_factory: "2" },
    lifetime: { metal: "1e6", crystal: "1e5", deuterium: "100" },
    warpCores: "3",
    totalTime: "5000",
    manualClicks: 4,
    seenEnergyShortage: true,
    hasPrestiged: true,
    unlockedCards: ["auto_collect"],
    protocols: { accumulator: 0, slots: [] },
  },
});

function busyState() {
  let state = rich(stateWith({ metal_mine: 12, robotics_factory: 3, solar_plant: 11 }), 5e6);
  state = { ...state, unlockedCards: ["auto_build", "queue_scheduler"] };
  state = equipCard(state, 0, "queue_scheduler").state;
  state = enqueue(state, "metal_mine", "manual").state;
  state = enqueue(state, "metal_mine", "protocol").state;
  state = tick(state, 0.25);
  state = withPlanet(state, { planet: { ...activePlanet(state), productionPct: { ...activePlanet(state).productionPct, crystal_mine: 70 } } });
  return state;
}

describe("save v9", () => {
  it("protects a v5 local save instead of silently resetting it", () => {
    const store = memoryStore({ [STORAGE_KEY]: V5_SAVE });
    expect(() => loadGame(store, 1_710_000_100_000)).toThrow(SaveVersionError);
    expect(store.data[STORAGE_KEY]).toBe(V5_SAVE);
    expect(Object.keys(store.data)).toEqual([STORAGE_KEY]);
  });

  it("protects older versions too (v1)", () => {
    const raw = JSON.stringify({ version: 1, savedAt: 1, state: {} });
    const store = memoryStore({ [STORAGE_KEY]: raw });
    expect(() => loadGame(store)).toThrow(SaveVersionError);
    expect(store.data[STORAGE_KEY]).toBe(raw);
  });

  it("importing a v5 file is refused and leaves the current game alone", () => {
    const current = busyState();
    const snapshot = exportSave(current, 42);
    expect(() => importSave(V5_SAVE)).toThrow(SaveVersionError);
    expect(() => importSave(V5_SAVE)).toThrow("存档版本 v5 已过时");
    expect(exportSave(current, 42)).toBe(snapshot);
  });

  it("a v7 (P2) save is protected too", () => {
    const file = JSON.parse(exportSave(createInitialState(), 1)) as { version: number };
    file.version = 7;
    expect(() => importSave(JSON.stringify(file))).toThrow("存档版本 v7 已过时");
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(file) });
    expect(() => loadGame(store)).toThrow(SaveVersionError);
    expect(store.data[STORAGE_KEY]).toBe(JSON.stringify(file));
  });

  it("importing a newer version is refused too", () => {
    const file = JSON.parse(exportSave(createInitialState(), 1)) as { version: number };
    file.version = 10;
    expect(() => importSave(JSON.stringify(file))).toThrow("比游戏更新");
  });

  it("export → import round-trips exactly, including the queue and paid amounts", () => {
    const state = busyState();
    expect(activePlanet(state).buildQueue).toHaveLength(2);
    const json = exportSave(state, 1_700_000_000_000);
    const file = importSave(json);
    const restored = deserializeState(file.state);
    expect(serializeState(restored)).toEqual(serializeState(state));
    expect(activePlanet(restored).buildQueue[1]?.paid.metal.eq(activePlanet(state).buildQueue[1]?.paid.metal ?? big(-1))).toBe(true);
    expect(activePlanet(restored).buildQueue[0]?.remainingSeconds).toBe(activePlanet(state).buildQueue[0]?.remainingSeconds);
    expect(activePlanet(restored).productionPct.crystal_mine).toBe(70);
    expect(restored.protocols.slots[0]?.card?.id).toBe("queue_scheduler");
  });

  it("loadGame applies offline time to a v9 save", () => {
    const store = memoryStore();
    writeSave(store, busyState(), 1_000_000);
    const loaded = loadGame(store, 1_000_000 + 600_000);
    expect(loaded.notice).toBeNull();
    expect(loaded.appliedSeconds).toBe(600);
    expect(loaded.completedBuilds.length).toBeGreaterThan(0);
  });

  it("rejects invalid levels and percentages", () => {
    const file = JSON.parse(exportSave(createInitialState(), 1));
    file.state.planets[0].buildings.metal_mine = 1.5;
    expect(() => importSave(JSON.stringify(file))).toThrow("整数");
    const pct = JSON.parse(exportSave(createInitialState(), 1));
    pct.state.planets[0].productionPct.metal_mine = 55;
    expect(() => importSave(JSON.stringify(pct))).toThrow("10 的倍数");
    const neg = JSON.parse(exportSave(createInitialState(), 1));
    neg.state.planets[0].buildings.solar_plant = -1;
    expect(() => importSave(JSON.stringify(neg))).toThrow();
  });
});

function legacyFile(revision: 2 | 3) {
  let state = createInitialState(91);
  state.arcade.seed = 819;
  for (let i = 0; i < 3; i++) state = grantRun(state, "bonus").state;
  const file = JSON.parse(exportSave(state, 123));
  file.revision = revision;
  delete file.state.orders;
  if (revision === 2) delete file.state.deepSpace;
  delete file.state.arcade.nextRunId;
  delete file.state.arcade.autoBatch;
  for (const run of file.state.arcade.runs) delete run.id;
  return file;
}

function authorizedFile() {
  let state = createInitialState(91);
  state.arcade.seed = 819;
  for (let i = 0; i < 3; i++) state = grantRun(state, "bonus").state;
  const ticketIds = state.arcade.runs.map(run => run.id);
  state.arcade.runs.shift();
  state.arcade.autoBatch = {
    armed: true, planetId: state.activePlanetId, ticketIds, completed: 1,
    maxDeuterium: "100", spentDeuterium: "25",
    bets: { metal: 1, crystal: 0, deuterium: 0, drifter: 0 }, stopReason: "",
  };
  return JSON.parse(exportSave(state, 123));
}

describe("r4 ring save boundary", () => {
  it.each([2, 3] as const)("adds stable IDs to r%d in existing order without changing RNG, bets or outcomes", revision => {
    const file = legacyFile(revision), original = structuredClone(file.state.arcade);
    const migrated = importSave(JSON.stringify(file));
    expect(migrated.revision).toBe(SAVE_REVISION);
    const { nextRunId, autoBatch, ...arcade } = migrated.state.arcade;
    expect(nextRunId).toBe(4);
    expect(autoBatch).toBeNull();
    expect(arcade.runs.map(run => run.id)).toEqual([1, 2, 3]);
    expect({ ...arcade, runs: arcade.runs.map(({ id: _id, ...run }) => run) }).toEqual(original);
    expect(migrated.state.planets).toEqual(file.state.planets);
    expect(migrated.state.lifetime).toEqual(file.state.lifetime);
    expect(migrated.state.fleets).toEqual(file.state.fleets);
    if (revision === 3) expect(migrated.state.deepSpace).toEqual(file.state.deepSpace);
  });

  it.each([2, 3] as const)("backs up exact r%d bytes in the low-level compatibility reader without replacing current", revision => {
    const source = JSON.stringify(legacyFile(revision)), store = memoryStore({ [STORAGE_KEY]: source });
    const loaded = loadGame(store, 123);
    expect(loaded.state.arcade.autoBatch).toBeNull();
    expect(store.data[STORAGE_KEY + ".backup"]).toBe(source);
    expect(store.data[STORAGE_KEY]).toBe(source);
  });

  it.each([2, 3] as const)("rejects r4 fields smuggled into r%d instead of erasing authorization", revision => {
    for (const field of ["nextRunId", "autoBatch", "id"] as const) {
      const file = legacyFile(revision);
      if (field === "id") file.state.arcade.runs[0].id = 1;
      else file.state.arcade[field] = field === "nextRunId" ? 4 : null;
      expect(() => importSave(JSON.stringify(file)), field).toThrow("不能夹带");
    }
  });

  it("retains a partially completed r4 batch budget, ticket snapshot and cursor exactly", () => {
    const file = authorizedFile();
    expect(importSave(JSON.stringify(file)).state.arcade).toEqual(file.state.arcade);
    const first = importSave(JSON.stringify(file));
    expect(importSave(JSON.stringify(first)).state.arcade).toEqual(file.state.arcade);
  });

  it("accepts finite Decimal caps beyond native Number range without resetting them", () => {
    const file = authorizedFile();
    file.state.arcade.autoBatch.maxDeuterium = "1e400";
    file.state.arcade.autoBatch.spentDeuterium = "5e399";
    expect(importSave(JSON.stringify(file)).state.arcade.autoBatch).toEqual(file.state.arcade.autoBatch);
  });

  it("preserves uppercase exponent strings without parsing them through a different amount reader", () => {
    const file = authorizedFile();
    file.state.arcade.autoBatch.maxDeuterium = "1E20";
    file.state.arcade.autoBatch.spentDeuterium = "5E19";
    expect(importSave(JSON.stringify(file)).state.arcade.autoBatch).toEqual(file.state.arcade.autoBatch);
  });

  it("keeps bounded stopped history when research reduces the live storage limit", () => {
    const file = authorizedFile();
    file.state.arcade.nextRunId = 8;
    file.state.arcade.autoBatch = { ...file.state.arcade.autoBatch, armed: false,
      ticketIds: [1, 2, 3, 4, 5, 6, 7], completed: 7, stopReason: "已停止" };
    file.state.arcade.runs = [];
    expect(importSave(JSON.stringify(file)).state.arcade.autoBatch).toEqual(file.state.arcade.autoBatch);
  });

  it("accepts stopped history after its source planet and remaining tickets disappear", () => {
    const file = authorizedFile();
    file.state.arcade.autoBatch.armed = false;
    file.state.arcade.autoBatch.planetId = "retired-colony";
    file.state.arcade.autoBatch.stopReason = "出资星球已移除";
    file.state.arcade.runs = [];
    expect(importSave(JSON.stringify(file)).state.arcade.autoBatch).toEqual(file.state.arcade.autoBatch);
  });

  it.each([
    ["missing arcade", (f: any) => { delete f.state.arcade; }],
    ["missing next ID", (f: any) => { delete f.state.arcade.nextRunId; }],
    ["missing batch", (f: any) => { delete f.state.arcade.autoBatch; }],
    ["missing ticket ID", (f: any) => { delete f.state.arcade.runs[0].id; }],
    ["negative ticket ID", (f: any) => { f.state.arcade.runs[0].id = -1; }],
    ["zero ticket ID", (f: any) => { f.state.arcade.runs[0].id = 0; }],
    ["fractional ticket ID", (f: any) => { f.state.arcade.runs[0].id = 1.5; }],
    ["unsafe ticket ID", (f: any) => { f.state.arcade.runs[0].id = Number.MAX_SAFE_INTEGER + 1; }],
    ["unsorted ticket IDs", (f: any) => { f.state.arcade.autoBatch = null; f.state.arcade.runs.reverse(); }],
    ["duplicate ticket IDs", (f: any) => { f.state.arcade.runs[1].id = f.state.arcade.runs[0].id; }],
    ["stale counter", (f: any) => { f.state.arcade.nextRunId = 3; }],
    ["unsafe counter", (f: any) => { f.state.arcade.nextRunId = Number.MAX_SAFE_INTEGER + 1; }],
    ["missing armed", (f: any) => { delete f.state.arcade.autoBatch.armed; }],
    ["nonboolean armed", (f: any) => { f.state.arcade.autoBatch.armed = "false"; }],
    ["empty snapshot", (f: any) => { f.state.arcade.autoBatch.ticketIds = []; }],
    ["oversized snapshot", (f: any) => { f.state.arcade.autoBatch.ticketIds = Array.from({ length: 41 }, (_, i) => i + 1); f.state.arcade.nextRunId = 42; }],
    ["armed snapshot over live limit", (f: any) => { f.state.arcade.autoBatch.ticketIds = [1, 2, 3, 4, 5, 6]; f.state.arcade.nextRunId = 7; }],
    ["duplicate snapshot", (f: any) => { f.state.arcade.autoBatch.ticketIds = [1, 2, 2]; }],
    ["unsorted snapshot", (f: any) => { f.state.arcade.autoBatch.ticketIds = [1, 3, 2]; }],
    ["unsafe snapshot ID", (f: any) => { f.state.arcade.autoBatch.ticketIds[0] = Number.MAX_SAFE_INTEGER + 1; }],
    ["fractional cursor", (f: any) => { f.state.arcade.autoBatch.completed = 1.5; }],
    ["negative cursor", (f: any) => { f.state.arcade.autoBatch.completed = -1; }],
    ["past-end cursor", (f: any) => { f.state.arcade.autoBatch.completed = 4; }],
    ["armed completed cursor", (f: any) => { f.state.arcade.autoBatch.completed = 3; }],
    ["missing source", (f: any) => { f.state.arcade.autoBatch.planetId = "missing"; }],
    ["wrong remaining prefix", (f: any) => { f.state.arcade.runs.reverse(); }],
    ["consumed ticket still pending", (f: any) => { f.state.arcade.runs.unshift({ ...f.state.arcade.runs[0], id: 1 }); }],
    ["missing budget", (f: any) => { delete f.state.arcade.autoBatch.maxDeuterium; }],
    ["whitespace budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = " 100"; }],
    ["signed budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "+100"; }],
    ["negative budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "-1"; }],
    ["nonfinite budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "Infinity"; }],
    ["NaN budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "NaN"; }],
    ["overflow exponent", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "1e" + "9".repeat(400); }],
    ["oversized budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "1".repeat(1001); }],
    ["numeric budget", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = 100; }],
    ["negative spend", (f: any) => { f.state.arcade.autoBatch.spentDeuterium = "-1"; }],
    ["over budget below floating precision", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "1e20"; f.state.arcade.autoBatch.spentDeuterium = "100000000000000000001"; }],
    ["overflowed canonical Decimal", (f: any) => { f.state.arcade.autoBatch.maxDeuterium = "1e999999999999999999999"; }],
    ["over budget", (f: any) => { f.state.arcade.autoBatch.spentDeuterium = "101"; }],
    ["missing bets", (f: any) => { delete f.state.arcade.autoBatch.bets; }],
    ["missing bet", (f: any) => { delete f.state.arcade.autoBatch.bets.metal; }],
    ["unknown bet", (f: any) => { f.state.arcade.autoBatch.bets.unknown = 1; }],
    ["excess bets", (f: any) => { f.state.arcade.autoBatch.bets.metal = 1000; }],
    ["fractional bet", (f: any) => { f.state.arcade.autoBatch.bets.metal = 0.5; }],
    ["missing reason", (f: any) => { delete f.state.arcade.autoBatch.stopReason; }],
    ["long reason", (f: any) => { f.state.arcade.autoBatch.stopReason = "x".repeat(241); }],
    ["stale retired counter", (f: any) => { f.state.arcade.autoBatch.armed = false; f.state.arcade.autoBatch.ticketIds = [1, 5]; f.state.arcade.autoBatch.completed = 1; }],
  ] as const)("rejects malformed r4 %s", (_label, mutate) => {
    const file = authorizedFile();
    mutate(file);
    expect(() => importSave(JSON.stringify(file))).toThrow();
  });
});
