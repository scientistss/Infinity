import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { satelliteEnergyPerUnit } from "../src/game/formulas";
import { applyAchievementUnlocks, emptyTickLog, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { deserializeState, serializeState } from "../src/game/save";
import { speedUp } from "../src/game/dark-matter";
import {
  advanceShipyard,
  canBuildUnits,
  cancelUnits,
  deficitAfterQueued,
  maxBuildable,
  nextShipyardEvent,
  orderUnits,
  shipyardPausedReason,
  shipyardRemaining,
  unitSeconds,
} from "../src/game/shipyard";
import { empirePoints } from "../src/game/arcade";
import type { GameState } from "../src/game/types";
import { relErr, rich, stateWith, withResearch } from "./helpers";

function yard(level = 2, extra: Parameters<typeof stateWith>[0] = {}): GameState {
  return rich(withResearch(stateWith({ shipyard: level, ...extra }), { combustion_drive: 2, shielding_tech: 2 }));
}

describe("shipyard timing", () => {
  it("unit time = (M+C)/(2500·(1+yard)·2^nanite) h ÷ 600", () => {
    const s = yard(1);
    // Light fighter 3000+1000 at yard 1: 4000/5000 h = 0.8 h → 4.8 s.
    expect(unitSeconds(s, "light_fighter")).toBeCloseTo(4.8, 9);
    expect(unitSeconds(yard(2), "small_cargo")).toBeCloseTo((4000 / 7500) * 6, 9);
    expect(unitSeconds(yard(2, { nanite_factory: 1 }), "small_cargo")).toBeCloseTo((4000 / 15000) * 6, 9);
    // Rocket launcher at yard 12, nanite 10 hits the 0.01 s floor.
    expect(unitSeconds(yard(12, { nanite_factory: 10 }), "rocket_launcher")).toBe(0.01);
  });

  it("charges the whole batch, builds unit by unit and keeps partial progress", () => {
    let s = yard(1);
    const before = s.resources.metal.toNumber();
    const r = orderUnits(s, "light_fighter", 5, "manual");
    expect(r.ok).toBe(true);
    s = r.state;
    expect(before - s.resources.metal.toNumber()).toBe(15000);
    const step = advanceShipyard(s, 4.8 * 2.5);
    expect(step.completed).toEqual([{ unit: "light_fighter", count: 2 }]);
    expect(step.state.planet.units.light_fighter).toBe(2);
    expect(step.state.planet.shipyardQueue[0]?.count).toBe(3);
    expect(step.state.planet.shipyardQueue[0]?.progress).toBeCloseTo(0.5, 9);
    expect(shipyardRemaining(step.state)).toBeCloseTo(4.8 * 2.5, 9);
    const done = advanceShipyard(step.state, 100);
    expect(done.state.planet.units.light_fighter).toBe(5);
    expect(done.state.planet.shipyardQueue).toHaveLength(0);
    expect(done.state.stats.unitsBuilt).toBe(5);
  });

  it("flows time into later batches", () => {
    let s = yard(2);
    s = orderUnits(s, "light_fighter", 1, "manual").state;
    s = orderUnits(s, "rocket_launcher", 3, "manual").state;
    const lf = unitSeconds(s, "light_fighter");
    const rl = unitSeconds(s, "rocket_launcher");
    const out = advanceShipyard(s, lf + rl * 2);
    expect(out.state.planet.units.light_fighter).toBe(1);
    expect(out.state.planet.units.rocket_launcher).toBe(2);
    expect(out.state.planet.shipyardQueue[0]?.count).toBe(1);
  });

  it("pauses while the shipyard or nanite factory is upgraded", () => {
    let s = yard(1, { robotics_factory: 2 });
    s = orderUnits(s, "light_fighter", 3, "manual").state;
    const up = enqueue(s, "shipyard", "manual");
    expect(up.ok).toBe(true);
    s = up.state;
    expect(shipyardPausedReason(s)).toContain("造船厂升级中");
    expect(shipyardRemaining(s)).toBeNull();
    expect(nextShipyardEvent(s)).toBe(Number.POSITIVE_INFINITY);
    // Nothing is built during the upgrade; production then resumes at the new level (light fighter 3.2 s).
    const upgrade = s.planet.buildQueue[0]!.totalSeconds;
    const paused = tick(s, upgrade * 0.9);
    expect(paused.planet.shipyardQueue[0]?.progress).toBe(0);
    const resumed = tick(s, upgrade + 3.2);
    expect(resumed.planet.buildings.shipyard).toBe(2);
    expect(resumed.planet.units.light_fighter).toBe(1);
    expect(resumed.planet.shipyardQueue[0]?.progress).toBeCloseTo(0, 6);
    // Other buildings do not pause it.
    let t = yard(1);
    t = orderUnits(t, "light_fighter", 3, "manual").state;
    t = enqueue(t, "metal_mine", "manual").state;
    expect(shipyardPausedReason(t)).toBe("");
  });

  it("a long tick equals many short ones (shipyard + satellites feeding energy)", () => {
    let s = stateWith({ shipyard: 2, metal_mine: 12, crystal_mine: 10, solar_plant: 6 }, { metal: 5e5, crystal: 5e5, deuterium: 5e5 });
    s = withResearch(s, { combustion_drive: 2 });
    s = orderUnits(s, "solar_satellite", 40, "manual").state;
    s = orderUnits(s, "small_cargo", 10, "manual").state;
    const long = tick(s, 400);
    let short = s;
    for (let i = 0; i < 400; i++) short = tick(short, 1);
    expect(long.planet.units).toEqual(short.planet.units);
    expect(relErr(long.resources.metal.toNumber(), short.resources.metal.toNumber())).toBeLessThan(1e-6);
    expect(long.planet.units.solar_satellite).toBe(40);
    expect(long.planet.units.small_cargo).toBe(10);
  });

  it("logs completed units", () => {
    let s = yard(2);
    s = orderUnits(s, "rocket_launcher", 4, "manual").state;
    const log = emptyTickLog();
    tick(s, 60, "offline", log);
    expect(log.completedUnits).toEqual([{ unit: "rocket_launcher", count: 4 }]);
  });
});

describe("shipyard orders", () => {
  it("needs a shipyard and the unit's requirements", () => {
    expect(canBuildUnits(rich(stateWith()), "solar_satellite", 1).reason).toBe("需要造船厂 等级 1");
    expect(canBuildUnits(rich(stateWith({ shipyard: 1 })), "light_fighter", 1).reason).toContain("燃烧引擎");
    expect(canBuildUnits(yard(1), "small_cargo", 1).reason).toContain("造船厂 等级 2");
    expect(canBuildUnits(yard(2), "small_cargo", 1).ok).toBe(true);
  });

  it("refunds every unbuilt unit on cancel (including the one in progress)", () => {
    let s = yard(1);
    const start = s.resources.metal.toNumber();
    s = orderUnits(s, "light_fighter", 4, "manual").state;
    s = advanceShipyard(s, 4.8 * 1.5).state;
    const out = cancelUnits(s, 0);
    expect(out.ok).toBe(true);
    expect(out.state.planet.units.light_fighter).toBe(1);
    expect(start - out.state.resources.metal.toNumber()).toBeCloseTo(3000, 2);
    expect(cancelUnits(out.state, 0).ok).toBe(false);
  });

  it("limits shield domes to one each, counting the queue", () => {
    let s = yard(2);
    expect(canBuildUnits(s, "small_shield_dome", 2).reason).toContain("最多 1");
    s = orderUnits(s, "small_shield_dome", 1, "manual").state;
    expect(canBuildUnits(s, "small_shield_dome", 1).ok).toBe(false);
    expect(maxBuildable(s, "small_shield_dome")).toBe(0);
  });

  it("fits missiles into silo slots (ABM 1, IPM 2, 10 per level)", () => {
    let s = withResearch(yard(2, { missile_silo: 4 }), { impulse_drive: 1 });
    expect(maxBuildable(s, "anti_ballistic_missile")).toBe(40);
    s = orderUnits(s, "interplanetary_missile", 15, "manual").state;
    expect(maxBuildable(s, "anti_ballistic_missile")).toBe(10);
    expect(canBuildUnits(s, "interplanetary_missile", 6).reason).toContain("导弹井空位不足");
    expect(canBuildUnits(yard(2), "anti_ballistic_missile", 1).reason).toContain("导弹井");
  });

  it("orders max and fill-to", () => {
    let s = stateWith({ shipyard: 1 }, { metal: 10_000, crystal: 0, deuterium: 0 });
    expect(maxBuildable(s, "rocket_launcher")).toBe(5);
    s = orderUnits(s, "rocket_launcher", "max", "manual").state;
    expect(s.planet.shipyardQueue[0]?.count).toBe(5);
    expect(s.resources.metal.toNumber()).toBe(0);
    expect(orderUnits(s, "rocket_launcher", "max", "manual").ok).toBe(false);
    let f = yard(1);
    f = orderUnits(f, "solar_satellite", 3, "manual").state;
    f = orderUnits(f, "solar_satellite", { fillTo: 10 }, "manual").state;
    expect(f.planet.shipyardQueue[1]?.count).toBe(7);
    expect(orderUnits(f, "solar_satellite", { fillTo: 10 }, "manual").ok).toBe(false);
  });

  it("caps the queue at 10 batches", () => {
    let s = yard(1);
    for (let i = 0; i < 10; i++) s = orderUnits(s, "rocket_launcher", 1, "manual").state;
    expect(canBuildUnits(s, "rocket_launcher", 1).reason).toContain("造船队列已满（10/10）");
  });
});

describe("solar satellites", () => {
  it("each gives ⌊(Tmax+140)/6⌋ energy", () => {
    expect(satelliteEnergyPerUnit(40)).toBe(30);
    expect(satelliteEnergyPerUnit(-40)).toBe(16);
    const s = stateWith({ metal_mine: 10 });
    const base = economy(s).supply;
    s.planet.units.solar_satellite = 10;
    expect(economy(s).supply - base).toBe(10 * satelliteEnergyPerUnit(s.planet.tempMax));
  });

  it("deficitAfterQueued counts queued satellites as supply", () => {
    let s = rich(stateWith({ shipyard: 1, metal_mine: 15, crystal_mine: 12 }));
    const deficit = deficitAfterQueued(s);
    expect(deficit).toBeGreaterThan(0);
    const need = Math.ceil(deficit / satelliteEnergyPerUnit(s.planet.tempMax));
    s = orderUnits(s, "solar_satellite", need, "manual").state;
    expect(deficitAfterQueued(s)).toBe(0);
  });
});

describe("shipyard dark matter, saves, points, achievements", () => {
  it("DM halves / finishes the head batch only", () => {
    let s = yard(1);
    s = orderUnits(s, "light_fighter", 10, "manual").state;
    s = orderUnits(s, "rocket_launcher", 1, "manual").state;
    s = { ...s, darkMatter: big(100_000) };
    const half = speedUp(s, "shipyard", "halve");
    expect(half.ok).toBe(true);
    expect(half.state.planet.units.light_fighter).toBe(5);
    const fin = speedUp(half.state, "shipyard", "finish");
    expect(fin.ok).toBe(true);
    expect(fin.state.planet.units.light_fighter).toBe(10);
    expect(fin.state.planet.units.rocket_launcher).toBe(0);
    expect(fin.state.planet.shipyardQueue).toHaveLength(1);
    // 48 s → two started 30 s steps; then 24 s → one.
    expect(s.darkMatter.sub(half.state.darkMatter).toNumber()).toBe(750);
    expect(speedUp(yard(1), "shipyard", "finish").ok).toBe(false);
  });

  it("round-trips units and the shipyard queue through the save", () => {
    let s = yard(2);
    s = orderUnits(s, "small_cargo", 7, "manual").state;
    s = advanceShipyard(s, unitSeconds(s, "small_cargo") * 2.25).state;
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
    expect(back.planet.units).toEqual(s.planet.units);
    expect(back.planet.shipyardQueue).toEqual(s.planet.shipyardQueue);
    const bad = serializeState(s) as unknown as { planet: { units: Record<string, number> } };
    bad.planet.units.small_cargo = -1;
    expect(() => deserializeState(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it("units count toward empire points", () => {
    const s = yard(1);
    const before = empirePoints(s);
    s.planet.units.light_fighter = 10;
    expect(empirePoints(s)).toBeGreaterThan(before);
  });

  it("unlocks the P3 achievements", () => {
    const s = yard(1);
    s.planet.units.solar_satellite = 1;
    let a = applyAchievementUnlocks(s);
    expect(a.unlocked).toContain("first_shipyard");
    expect(a.unlocked).toContain("first_satellite");
    expect(a.unlocked).not.toContain("first_ship");
    a.planet.units.light_fighter = 1;
    a.planet.units.rocket_launcher = 1;
    a = applyAchievementUnlocks(a);
    expect(a.unlocked).toContain("first_ship");
    expect(a.unlocked).toContain("first_defense");
  });
});
