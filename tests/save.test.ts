import { withPlanet, activePlanet } from "../src/game/empire";
import { describe, expect, it } from "vitest";
import { equipCard } from "../src/automation/engine";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
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
  state = { ...withPlanet(state, { planet: { ...activePlanet(state), productionPct: { ...activePlanet(state).productionPct, crystal_mine: 70 } } }) };
  return state;
}

describe("save v9", () => {
  it("a v5 save stays intact and suspends autosave", () => {
    const store = memoryStore({ [STORAGE_KEY]: V5_SAVE });
    const loaded = loadGame(store, 1_710_000_100_000);
    expect(loaded.notice).toContain("v5 → v9");
    expect(loaded.saveBlocked).toBe(true);
    expect(store.getItem(STORAGE_KEY)).toBe(V5_SAVE);
    expect(activePlanet(loaded.state).resources.metal.toNumber()).toBe(500);
    expect(loaded.state.warpCores.toNumber()).toBe(0);
    expect(activePlanet(loaded.state).buildings.metal_mine).toBe(0);
    expect(loaded.appliedSeconds).toBe(0);

    // A deliberately saved new game replaces it; loadGame never writes it.
    writeSave(store, loaded.state, 1_710_000_100_000);
    expect(loadGame(store, 1_710_000_100_000).notice).toBeNull();
  });

  it("older versions remain protected (v1)", () => {
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify({ version: 1, savedAt: 1, state: {} }) });
    expect(loadGame(store).notice).toContain("v1 → v9");
  });

  it("importing a v5 file is refused and leaves the current game alone", () => {
    const current = busyState();
    const snapshot = exportSave(current, 42);
    expect(() => importSave(V5_SAVE)).toThrow(SaveVersionError);
    expect(() => importSave(V5_SAVE)).toThrow("存档版本 v5 已过时");
    expect(exportSave(current, 42)).toBe(snapshot);
  });

  it("a v7 (P2) save is also protected", () => {
    const file = JSON.parse(exportSave(createInitialState(), 1)) as { version: number };
    file.version = 7;
    expect(() => importSave(JSON.stringify(file))).toThrow("存档版本 v7 已过时");
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(file) });
    expect(loadGame(store).notice).toContain("v7 → v9");
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
