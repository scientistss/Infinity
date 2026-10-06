import { describe, expect, it } from "vitest";
import { activePlanet, onPlanet, selectPlanet } from "../src/game/empire";
import { createPlanet } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { applyAchievementUnlocks, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { cancelResearch, effectiveLabLevel, enqueueResearch, researchSecondsFor } from "../src/game/research";
import { researchById } from "../src/data/research";
import { deserializeState, exportSave, importSave, serializeState, loadGame } from "../src/game/save";
import { STORAGE_KEY } from "../src/game/content";
import { rich, stateWith, withResearch } from "./helpers";
import { presentEmpire } from "../src/ui/empire-present";
import type { GameState } from "../src/game/types";

export function twoPlanets(state = createInitialState()): GameState {
  return { ...state, planets: [...state.planets, { ...createPlanet(), id: "second", name: "冰原", homeworld: false, coordinates: { galaxy: 1, system: 51, position: 12 } }] };
}
function stable(state: GameState): GameState {
  let s = state;
  for (const p of s.planets) s = onPlanet(s, p.id, applyAchievementUnlocks);
  return s;
}

describe("P4 canonical empire state", () => {
  it("stores inventory only inside planets and switches without duplicating it", () => {
    const s = twoPlanets();
    expect("planet" in s).toBe(false); expect("resources" in s).toBe(false);
    const switched = selectPlanet(s, "second");
    expect(activePlanet(switched)).toBe(s.planets[1]);
    expect(selectPlanet(s, "missing")).toBe(s);
    expect(s.activePlanetId).toBe("home");
  });
  it("produces on both planets but advances empire time only once", () => {
    const s = stable(twoPlanets());
    const a = economy(s), b = economy(selectPlanet(s, "second"));
    const t = tick(s, 10);
    expect(t.totalTime.toNumber()).toBe(10);
    expect(t.planets[0]!.resources.metal.toNumber()).toBeCloseTo(500 + a.net.metal * 10);
    expect(t.planets[1]!.resources.metal.toNumber()).toBeCloseTo(500 + b.net.metal * 10);
    expect(t.lifetime.metal.toNumber()).toBeCloseTo((a.net.metal + b.net.metal) * 10);
    expect(s.planets[0]!.resources.metal.toNumber()).toBe(500);
  });
  it("keeps independent storage and production settings", () => {
    let s = twoPlanets(stateWith({ metal_mine: 6, solar_plant: 8 }));
    s = onPlanet(s, "second", (p) => {
      activePlanet(p).resources.metal = big(10000);
      return p;
    });
    const t = tick(s, 4);
    expect(t.planets[0]!.resources.metal.gt(500)).toBe(true);
    expect(t.planets[1]!.resources.metal.eq(10000)).toBe(true);
  });
  it("finishes both local build queues at exact boundaries regardless of selection", () => {
    let s = twoPlanets(rich(stateWith({ robotics_factory: 2 })));
    s = onPlanet(s, "second", rich);
    s = enqueue(s, "metal_mine", "manual").state;
    s = onPlanet(s, "second", (p) => enqueue(p, "crystal_mine", "manual").state);
    const t = tick(s, 10);
    expect(t.planets[0]!.buildings.metal_mine).toBe(1);
    expect(t.planets[1]!.buildings.crystal_mine).toBe(1);
    expect(t.stats.buildsCompleted).toBe(2);
    expect(t.activePlanetId).toBe("home");
  });
  it("matches a long tick and many short ticks for independent planets", () => {
    let s = twoPlanets(rich(stateWith({ metal_mine: 12, solar_plant: 14, robotics_factory: 3 })));
    s = onPlanet(s, "second", rich);
    s = onPlanet(s, "second", (p) => enqueue(p, "metal_mine", "manual").state);
    s = enqueue(s, "metal_mine", "manual").state;
    s = stable(s);
    const long = tick(s, 60);
    let short = s;
    for (let i = 0; i < 240; i++) short = tick(short, 0.25);
    expect(long.totalTime.toNumber()).toBe(short.totalTime.toNumber());
    for (let i = 0; i < long.planets.length; i++) {
      expect(long.planets[i]!.buildings).toEqual(short.planets[i]!.buildings);
      for (const r of ["metal", "crystal", "deuterium"] as const) expect(long.planets[i]!.resources[r].div(short.planets[i]!.resources[r]).toNumber()).toBeCloseTo(1, 9);
    }
  });
  it("applies colony position bonuses, without changing the P3 homeworld baseline", () => {
    const s = stateWith({ metal_mine: 10, solar_plant: 20 });
    const home = economy(s);
    activePlanet(s).homeworld = false;
    const colony = economy(s);
    expect(colony.gross.metal).toBeGreaterThan(home.gross.metal);
    expect(colony.demand).toBe(home.demand);
  });
  it("binds queued research time and refund to its paying planet", () => {
    let s = twoPlanets(rich(stateWith({ research_lab: 1 })));
    s.planets[1]!.buildings.research_lab = 10;
    s = onPlanet(s, "second", rich);
    const before = s.planets[0]!.resources.crystal;
    s = enqueueResearch(s, "energy_tech", "manual").state;
    s = enqueueResearch(s, "energy_tech", "manual").state;
    const nextTime = researchSecondsFor(s, researchById("energy_tech"), 2);
    s = selectPlanet(s, "second");
    s = tick(s, s.research.queue[0]!.remainingSeconds);
    expect(s.research.queue[0]!.totalSeconds).toBe(nextTime);
    const secondStock = s.planets[1]!.resources.crystal;
    const cancel = cancelResearch(s, 0).state;
    expect(cancel.planets[1]!.resources.crystal.eq(secondStock)).toBe(true);
    expect(cancel.planets[0]!.resources.crystal.eq(before.sub(800))).toBe(true);
    expect(cancel.activePlanetId).toBe("second");
  });
  it("refunds repriced later orders to their own payer rather than the selection", () => {
    let s = twoPlanets(rich(stateWith({ research_lab: 2 })));
    s.planets[1]!.buildings.research_lab = 3;
    s = onPlanet(s,"second",rich);
    const before = s.planets.map((p) => p.resources.crystal);
    s = enqueueResearch(s,"energy_tech","manual").state;
    s = onPlanet(s,"second",(p) => enqueueResearch(p,"energy_tech","manual").state);
    s = cancelResearch(s,0).state;
    expect(s.planets[0]!.resources.crystal.eq(before[0]!)).toBe(true);
    expect(s.planets[1]!.resources.crystal.eq(before[1]!.sub(800))).toBe(true);
    expect(s.research.queue[0]!.planetId).toBe("second");
  });
  it("uses only qualifying additional labs in the intergalactic research network", () => {
    let s = twoPlanets(stateWith({ research_lab: 4 }));
    s.planets[1]!.buildings.research_lab = 7;
    s = withResearch(s, { intergalactic_research_network: 1 });
    expect(effectiveLabLevel(s, 4)).toBe(11);
    expect(effectiveLabLevel(s, 8)).toBe(4);
  });
  it("round-trips canonical v9 state and exports no obsolete inventory aliases", () => {
    const s = stable(twoPlanets());
    const raw = serializeState(s);
    expect("resources" in raw).toBe(false); expect("planet" in raw).toBe(false);
    expect(serializeState(deserializeState(importSave(exportSave(s)).state))).toEqual(raw);
  });
  it.each(["duplicate-id", "duplicate-coordinate", "no-active", "two-homes", "bad-coordinate"])("rejects malformed planet data: %s", (kind) => {
    const file = JSON.parse(exportSave(twoPlanets()));
    if(kind === "duplicate-id") file.state.planets[1].id = "home";
    if(kind === "duplicate-coordinate") file.state.planets[1].coordinates = file.state.planets[0].coordinates;
    if(kind === "no-active") file.state.activePlanetId = "missing";
    if(kind === "two-homes") file.state.planets[1].homeworld = true;
    if(kind === "bad-coordinate") file.state.planets[1].coordinates.galaxy = 6;
    expect(() => importSave(JSON.stringify(file))).toThrow();
  });
  it("rejects malformed v8 data and protects the stored original", () => {
    const json = JSON.stringify({ version: 8, state: { planet: {} }, savedAt: 0 });
    expect(() => importSave(json)).toThrow("v8 单星球存档结构不完整");
    const result = loadGame({ getItem: (key) => key === STORAGE_KEY ? json : null, setItem: () => {}, removeItem: () => {} }, 1);
    expect(result.saveBlocked).toBe(true);
    expect(result.notice).toContain("原存档未覆盖");
    expect(result.state.planets).toHaveLength(1);
  });
  it("keeps the presenter pure and exposes all planets", () => {
    const s = twoPlanets(); const before = exportSave(s,1);
    const view = presentEmpire(s);
    expect(view.planets).toHaveLength(2);
    expect(view.rows).toHaveLength(15);
    expect(exportSave(s,1)).toBe(before);
  });
});
