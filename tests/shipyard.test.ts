import { activePlanet } from "../src/game/empire";
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
    const before = activePlanet(s).resources.metal.toNumber();
    const r = orderUnits(s, "light_fighter", 5, "manual");
    expect(r.ok).toBe(true);
    s = r.state;
    expect(before - activePlanet(s).resources.metal.toNumber()).toBe(15000);
    const step = advanceShipyard(s, 4.8 * 2.5);
    expect(step.completed).toEqual([{ unit: "light_fighter", count: 2 }]);
    expect(activePlanet(step.state).units.light_fighter).toBe(2);
    expect(activePlanet(step.state).shipyardQueue[0]?.count).toBe(3);
    expect(activePlanet(step.state).shipyardQueue[0]?.progress).toBeCloseTo(0.5, 9);
    expect(shipyardRemaining(step.state)).toBeCloseTo(4.8 * 2.5, 9);
    const done = advanceShipyard(step.state, 100);
    expect(activePlanet(done.state).units.light_fighter).toBe(5);
    expect(activePlanet(done.state).shipyardQueue).toHaveLength(0);
    expect(done.state.stats.unitsBuilt).toBe(5);
  });

  it("flows time into later batches", () => {
    let s = yard(2);
    s = orderUnits(s, "light_fighter", 1, "manual").state;
    s = orderUnits(s, "rocket_launcher", 3, "manual").state;
    const lf = unitSeconds(s, "light_fighter");
    const rl = unitSeconds(s, "rocket_launcher");
    const out = advanceShipyard(s, lf + rl * 2);
    expect(activePlanet(out.state).units.light_fighter).toBe(1);
    expect(activePlanet(out.state).units.rocket_launcher).toBe(2);
    expect(activePlanet(out.state).shipyardQueue[0]?.count).toBe(1);
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
    const upgrade = activePlanet(s).buildQueue[0]!.totalSeconds;
    const paused = tick(s, upgrade * 0.9);
    expect(activePlanet(paused).shipyardQueue[0]?.progress).toBe(0);
    const resumed = tick(s, upgrade + 3.2);
    expect(activePlanet(resumed).buildings.shipyard).toBe(2);
    expect(activePlanet(resumed).units.light_fighter).toBe(1);
    expect(activePlanet(resumed).shipyardQueue[0]?.progress).toBeCloseTo(0, 6);
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
    expect(activePlanet(long).units).toEqual(activePlanet(short).units);
    expect(relErr(activePlanet(long).resources.metal.toNumber(), activePlanet(short).resources.metal.toNumber())).toBeLessThan(1e-6);
    expect(activePlanet(long).units.solar_satellite).toBe(40);
    expect(activePlanet(long).units.small_cargo).toBe(10);
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
    const start = activePlanet(s).resources.metal.toNumber();
    s = orderUnits(s, "light_fighter", 4, "manual").state;
    s = advanceShipyard(s, 4.8 * 1.5).state;
    const out = cancelUnits(s, 0);
    expect(out.ok).toBe(true);
    expect(activePlanet(out.state).units.light_fighter).toBe(1);
    expect(start - activePlanet(out.state).resources.metal.toNumber()).toBeCloseTo(3000, 2);
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
    expect(activePlanet(s).shipyardQueue[0]?.count).toBe(5);
    expect(activePlanet(s).resources.metal.toNumber()).toBe(0);
    expect(orderUnits(s, "rocket_launcher", "max", "manual").ok).toBe(false);
    let f = yard(1);
    f = orderUnits(f, "solar_satellite", 3, "manual").state;
    f = orderUnits(f, "solar_satellite", { fillTo: 10 }, "manual").state;
    expect(activePlanet(f).shipyardQueue[1]?.count).toBe(7);
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
    activePlanet(s).units.solar_satellite = 10;
    expect(economy(s).supply - base).toBe(10 * satelliteEnergyPerUnit(activePlanet(s).tempMax));
  });

  it("deficitAfterQueued counts queued satellites as supply", () => {
    let s = rich(stateWith({ shipyard: 1, metal_mine: 15, crystal_mine: 12 }));
    const deficit = deficitAfterQueued(s);
    expect(deficit).toBeGreaterThan(0);
    const need = Math.ceil(deficit / satelliteEnergyPerUnit(activePlanet(s).tempMax));
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
    expect(activePlanet(half.state).units.light_fighter).toBe(5);
    const fin = speedUp(half.state, "shipyard", "finish");
    expect(fin.ok).toBe(true);
    expect(activePlanet(fin.state).units.light_fighter).toBe(10);
    expect(activePlanet(fin.state).units.rocket_launcher).toBe(0);
    expect(activePlanet(fin.state).shipyardQueue).toHaveLength(1);
    // 48 s → two started 30 s steps; then 24 s → one.
    expect(s.darkMatter.sub(half.state.darkMatter).toNumber()).toBe(750);
    expect(speedUp(yard(1), "shipyard", "finish").ok).toBe(false);
  });

  it("round-trips units and the shipyard queue through the save", () => {
    let s = yard(2);
    s = orderUnits(s, "small_cargo", 7, "manual").state;
    s = advanceShipyard(s, unitSeconds(s, "small_cargo") * 2.25).state;
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
    expect(activePlanet(back).units).toEqual(activePlanet(s).units);
    expect(activePlanet(back).shipyardQueue).toEqual(activePlanet(s).shipyardQueue);
    const bad = serializeState(s) as unknown as { planets: Array<{ units: Record<string, number> }> };
    bad.planets[0]!.units.small_cargo = -1;
    expect(() => deserializeState(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it("units count toward empire points", () => {
    const s = yard(1);
    const before = empirePoints(s);
    activePlanet(s).units.light_fighter = 10;
    expect(empirePoints(s)).toBeGreaterThan(before);
  });

  it("unlocks the P3 achievements", () => {
    const s = yard(1);
    activePlanet(s).units.solar_satellite = 1;
    let a = applyAchievementUnlocks(s);
    expect(a.unlocked).toContain("first_shipyard");
    expect(a.unlocked).toContain("first_satellite");
    expect(a.unlocked).not.toContain("first_ship");
    activePlanet(a).units.light_fighter = 1;
    activePlanet(a).units.rocket_launcher = 1;
    a = applyAchievementUnlocks(a);
    expect(a.unlocked).toContain("first_ship");
    expect(a.unlocked).toContain("first_defense");
  });
});

describe("DETROIT (shipyard items)", () => {
  it("shop DETROIT takes OGame hours off on the dark-matter clock and carries into later batches", async () => {
    const { buyShopItem, useInventory, addInventory, shopItemReason } = await import("../src/game/dark-matter");
    let s = yard(1);
    s = { ...s, darkMatter: big(20_000) };
    expect(shopItemReason(s, "detroit_bronze")).toBe("造船厂没有在造的批次");
    s = orderUnits(s, "light_fighter", 5, "manual").state; // 5 × 4.8 s = 24 s
    s = orderUnits(s, "rocket_launcher", 10, "manual").state; // 10 × 2.4 s
    const bought = buyShopItem(s, "detroit_bronze"); // 0.5 OGame h = 30 s
    expect(bought.ok).toBe(true);
    expect(s.darkMatter.sub(bought.state.darkMatter).toNumber()).toBe(750);
    expect(activePlanet(bought.state).units.light_fighter).toBe(5);
    expect(activePlanet(bought.state).units.rocket_launcher).toBe(2);
    expect(activePlanet(bought.state).shipyardQueue[0]?.progress).toBeCloseTo(0.5, 6);
    // Inventory DETROIT: −30% of the head batch only.
    let t = addInventory(orderUnits(yard(1), "light_fighter", 10, "manual").state, "detroit_box", 1);
    t = useInventory(t, "detroit_box").state;
    expect(activePlanet(t).units.light_fighter).toBe(3);
    expect(t.items.detroit_box).toBe(0);
    expect(useInventory(t, "detroit_box").ok).toBe(false);
  });
});

describe("shipyard protocol cards (P3)", () => {
  it("卫星供电 unlocks with the first satellite and orders exactly the deficit when the shipyard is idle", async () => {
    const { equipCard, protocolSentence, satellitesForDeficit } = await import("../src/automation/engine");
    let s = rich(stateWith({ shipyard: 1, metal_mine: 15, crystal_mine: 12, solar_plant: 5 }));
    expect(tick(s, 0.01).unlockedCards).not.toContain("satellite_power");
    activePlanet(s).units.solar_satellite = 1;
    s = tick(s, 0.01);
    expect(s.unlockedCards).toContain("satellite_power");
    s = equipCard(s, 0, "satellite_power").state;
    expect(protocolSentence(s.protocols.slots[0]!.card!)).toBe("当造船厂空闲，若能源缺口（计入排队卫星）≥ 1，则造够补足能源缺口的太阳能卫星。");
    const need = satellitesForDeficit(s);
    expect(need).toBeGreaterThan(0);
    s = tick(s, 1);
    expect(activePlanet(s).shipyardQueue[0]?.unit).toBe("solar_satellite");
    expect(activePlanet(s).shipyardQueue[0]?.source).toBe("protocol");
    expect(deficitAfterQueued(s)).toBe(0);
    // Busy shipyard: the card waits.
    s = tick(s, 1);
    expect(activePlanet(s).shipyardQueue).toHaveLength(1);
    expect(s.protocols.slots[0]!.reason).toContain("造船厂忙");
    // After the batch, energy is covered.
    s = tick(s, 3600);
    expect(economy(s).supply).toBeGreaterThanOrEqual(economy(s).demand);
  });

  it("防御维护 unlocks with the first defense and fills to N; the shipyardIdle event refills at once", async () => {
    const { equipCard, patchSlot, protocolSentence } = await import("../src/automation/engine");
    let s = yard(2);
    activePlanet(s).units.rocket_launcher = 1;
    s = equipCard(tick(s, 0.01), 0, "defense_keeper").state;
    expect(protocolSentence(s.protocols.slots[0]!.card!)).toBe("当造船厂空闲，若火箭发射器（含排队）少于 50，则把火箭发射器补到 50 个。");
    s = tick(s, 1);
    expect(activePlanet(s).shipyardQueue[0]?.count).toBe(49);
    s = patchSlot(s, 0, "condition.0.value", "100");
    s = patchSlot(s, 0, "action.fillTo", "100");
    // One long tick: the batch ends mid-step and the idle event orders the next one in the same tick.
    s = tick(s, 49 * unitSeconds(s, "rocket_launcher") + 0.5);
    expect(activePlanet(s).units.rocket_launcher).toBe(50);
    expect(activePlanet(s).shipyardQueue[0]?.count).toBe(50);
    s = patchSlot(s, 0, "action.count", "max");
    expect(protocolSentence(s.protocols.slots[0]!.card!)).toContain("按现有资源造最多的火箭发射器");
    s = patchSlot(s, 0, "action.unit", "light_fighter");
    s = patchSlot(s, 0, "action.count", "5");
    expect(protocolSentence(s.protocols.slots[0]!.card!)).toContain("造 5 个轻型战斗机");
    s = patchSlot(s, 0, "condition.0.unit", "small_cargo");
    expect(s.protocols.slots[0]!.card!.conditions[0]).toEqual({ kind: "unitCountLt", unit: "small_cargo", value: 100 });
    const back = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
    expect(back.protocols.slots[0]!.card).toEqual(s.protocols.slots[0]!.card);
  });

  it("the deficit mode only applies to solar satellites", async () => {
    const { equipCard, patchSlot } = await import("../src/automation/engine");
    let s = rich(stateWith({ shipyard: 1, metal_mine: 15, crystal_mine: 12 }));
    activePlanet(s).units.solar_satellite = 1;
    s = equipCard(tick(s, 0.01), 0, "satellite_power").state;
    s = patchSlot(s, 0, "action.unit", "rocket_launcher");
    s = tick(s, 1);
    expect(activePlanet(s).shipyardQueue).toHaveLength(0);
    expect(s.protocols.slots[0]!.reason).toContain("只适用于太阳能卫星");
  });
});
