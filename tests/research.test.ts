import { describe, expect, it } from "vitest";
import { equipCard, unlockedSlotCount, enqueueCheapest, refreshUnlocks } from "../src/automation/engine";
import { catchUp } from "../src/core/offline";
import { researchById } from "../src/data/research";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { researchCost, researchSeconds } from "../src/game/formulas";
import { emptyTickLog, prestige, tick } from "../src/game/logic";
import { canEnqueue, enqueue } from "../src/game/queue";
import {
  canEnqueueResearch,
  cancelResearch,
  enqueueResearch,
  researchCapacity,
} from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { rich, stateWith, withResearch } from "./helpers";

const lab = (level: number, amount = 1e12) => rich(stateWith({ research_lab: level }), amount);

describe("research formulas (OGame, S = 600)", () => {
  it("costs follow ⌊base × factor^(L−1)⌋", () => {
    const energy2 = researchCost(researchById("energy_tech"), 2);
    expect(energy2.metal.toNumber()).toBe(0);
    expect(energy2.crystal.toNumber()).toBe(1600);
    expect(energy2.deuterium.toNumber()).toBe(800);
    const computer5 = researchCost(researchById("computer_tech"), 5);
    expect(computer5.crystal.toNumber()).toBe(400 * 16);
    expect(computer5.deuterium.toNumber()).toBe(600 * 16);
  });

  it("astrophysics uses factor 1.75 rounded to 100", () => {
    const def = researchById("astrophysics");
    expect(researchCost(def, 1).metal.toNumber()).toBe(4000);
    expect(researchCost(def, 2).metal.toNumber()).toBe(7000);
    expect(researchCost(def, 3).metal.toNumber()).toBe(12300);
    expect(researchCost(def, 3).crystal.toNumber()).toBe(24500);
  });

  it("research time = (M + C) / (1000 × (1 + lab)) hours ÷ 600", () => {
    const cost = researchCost(researchById("energy_tech"), 1);
    expect(researchSeconds(cost, 1)).toBeCloseTo((800 / 2000) * 3600 / 600, 9);
    const plasma = researchCost(researchById("plasma_tech"), 1);
    expect(researchSeconds(plasma, 4)).toBeCloseTo((6000 / 5000) * 3600 / 600, 9);
    // Never below the 1 second floor.
    expect(researchSeconds(researchCost(researchById("laser_tech"), 1), 20)).toBe(1);
  });
});

describe("research queue", () => {
  it("needs a research lab and names missing prerequisites", () => {
    expect(canEnqueueResearch(rich(stateWith()), "energy_tech").reason).toBe("需要 研究实验室 等级 1");
    expect(canEnqueueResearch(lab(1), "laser_tech").reason).toBe("需要 能源技术 等级 2");
    expect(canEnqueueResearch(withResearch(lab(1), { energy_tech: 2 }), "laser_tech").ok).toBe(true);
    expect(canEnqueueResearch(lab(3), "astrophysics").reason).toBe("需要 间谍技术 等级 4、脉冲引擎 等级 3");
  });

  it("charges on enqueue, runs one at a time, queue length equals the build queue", () => {
    let state = lab(1, 10000);
    expect(researchCapacity(state)).toBe(2);
    state = enqueueResearch(state, "energy_tech", "manual").state;
    expect(state.resources.crystal.toNumber()).toBe(10000 - 800);
    expect(state.research.queue[0]?.totalSeconds).toBeCloseTo(2.4, 9);
    state = enqueueResearch(state, "energy_tech", "manual").state;
    expect(state.research.queue[1]?.targetLevel).toBe(2);
    expect(state.research.queue[1]?.totalSeconds).toBe(0);
    expect(canEnqueueResearch(state, "computer_tech").reason).toBe("研究队列已满（2/2）");
  });

  it("cancel refunds in full and reprices later levels of the same research", () => {
    let state = lab(1, 10000);
    state = enqueueResearch(state, "computer_tech", "manual").state;
    state = enqueueResearch(state, "computer_tech", "manual").state;
    expect(state.resources.crystal.toNumber()).toBe(10000 - 400 - 800);
    const cancelled = cancelResearch(state, 0);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.research.queue).toHaveLength(1);
    expect(cancelled.state.research.queue[0]?.targetLevel).toBe(1);
    expect(cancelled.state.resources.crystal.toNumber()).toBe(10000 - 400);
    expect(cancelled.state.research.queue[0]?.totalSeconds).toBeGreaterThan(0);
  });

  it("the lab cannot be upgraded during research, and research waits while the lab is queued", () => {
    let state = lab(1);
    state = enqueueResearch(state, "energy_tech", "manual").state;
    expect(canEnqueue(state, "research_lab").reason).toBe("研究进行中，研究实验室不能升级");
    let other = lab(1);
    other = enqueue(other, "research_lab", "manual").state;
    expect(canEnqueueResearch(other, "energy_tech").reason).toBe("研究实验室正在升级，暂不能研究");
  });

  it("graviton needs energy supply, not resources", () => {
    const poor = withResearch(stateWith({ research_lab: 12, solar_plant: 10 }), {});
    expect(canEnqueueResearch(poor, "graviton_tech").reason).toContain("能源供给");
    const powered = stateWith({ research_lab: 12, solar_plant: 60 });
    expect(economy(powered).supply).toBeGreaterThan(300000);
    const result = enqueueResearch(powered, "graviton_tech", "manual");
    expect(result.ok).toBe(true);
    expect(result.state.resources.metal.eq(powered.resources.metal)).toBe(true);
  });

  it("tick finishes research and levels up; long and short ticks agree", () => {
    let state = lab(1);
    state = enqueueResearch(state, "energy_tech", "manual").state;
    state = enqueueResearch(state, "energy_tech", "manual").state;
    const log = emptyTickLog();
    const long = tick(state, 20, "live", log);
    expect(long.research.levels.energy_tech).toBe(2);
    expect(log.completedResearch).toEqual([
      { tech: "energy_tech", level: 1 },
      { tech: "energy_tech", level: 2 },
    ]);
    let short = state;
    for (let i = 0; i < 80; i += 1) short = tick(short, 0.25);
    expect(short.research.levels.energy_tech).toBe(2);
    expect(short.resources.metal.sub(long.resources.metal).abs().toNumber()).toBeLessThan(1e-3);
  });

  it("offline catch-up reports finished research", () => {
    let state = lab(2);
    state = enqueueResearch(state, "computer_tech", "manual").state;
    const result = catchUp(state, 600);
    expect(result.completedResearch).toEqual([{ tech: "computer_tech", level: 1 }]);
  });
});

describe("research effects", () => {
  it("energy technology raises fusion output", () => {
    const base = stateWith({ fusion_reactor: 10, deuterium_synth: 10 }, { deuterium: 1e6 });
    const boosted = withResearch(base, { energy_tech: 5 });
    expect(economy(boosted).supply / economy(base).supply).toBeCloseTo(Math.pow(1.1 / 1.05, 10), 6);
  });

  it("plasma technology adds 1% / 0.66% / 0.33% per level to mines", () => {
    const base = stateWith({ metal_mine: 10, crystal_mine: 10, deuterium_synth: 10, solar_plant: 30 });
    const plasma = withResearch(base, { plasma_tech: 10 });
    const a = economy(base).gross;
    const b = economy(plasma).gross;
    const baseMetal = 30 * 600 / 3600 * economy(base).global;
    expect((b.metal - baseMetal) / (a.metal - baseMetal)).toBeCloseTo(1.1, 9);
    expect(b.deuterium / a.deuterium).toBeCloseTo(1.033, 9);
  });

  it("computer technology adds a protocol slot every 2 levels, hard cap 12", () => {
    expect(unlockedSlotCount(stateWith())).toBe(1);
    expect(unlockedSlotCount(withResearch(stateWith(), { computer_tech: 4 }))).toBe(3);
    expect(unlockedSlotCount(withResearch(stateWith({ robotics_factory: 6 }), { computer_tech: 5 }))).toBe(6);
    expect(unlockedSlotCount(withResearch(stateWith({ robotics_factory: 20 }), { computer_tech: 20 }))).toBe(12);
  });

  it("restored prerequisites: nanite needs computer 10, fusion needs energy 3", () => {
    const state = rich(stateWith({ robotics_factory: 10, deuterium_synth: 5 }));
    expect(canEnqueue(state, "nanite_factory").reason).toBe("需要 计算机技术 等级 10");
    expect(canEnqueue(withResearch(state, { computer_tech: 10 }), "nanite_factory").ok).toBe(true);
    // Levels already built stay even without the research.
    const built = stateWith({ fusion_reactor: 3, deuterium_synth: 5 });
    expect(built.planet.buildings.fusion_reactor).toBe(3);
  });

  it("launch keeps research levels and dark matter, drops queued research", () => {
    let state = withResearch(lab(5), { energy_tech: 6, computer_tech: 4 });
    state = { ...state, darkMatter: big(1234), lifetime: { metal: big(1e12), crystal: big(0), deuterium: big(0) } };
    state = enqueueResearch(state, "laser_tech", "manual").state;
    const next = prestige(state);
    expect(next).not.toBe(state);
    expect(next.research.levels.energy_tech).toBe(6);
    expect(next.research.levels.computer_tech).toBe(4);
    expect(next.research.queue).toHaveLength(0);
    expect(next.darkMatter.toNumber()).toBe(1234);
    expect(next.planet.buildings.research_lab).toBe(0);
  });
});

describe("research protocols", () => {
  it("研究调度 refills the research queue right when a research finishes", () => {
    let state = lab(1);
    state = refreshUnlocks(state);
    expect(state.unlockedCards).toContain("research_scheduler");
    state = equipCard(state, 0, "research_scheduler").state;
    const after = tick(state, 30);
    // Template: research computer technology while below level 10.
    expect(after.research.levels.computer_tech).toBeGreaterThanOrEqual(2);
  });

  it("最便宜优先 picks the cheapest mine and explains when it waits", () => {
    const state = stateWith({ metal_mine: 5, crystal_mine: 1, deuterium_synth: 3 }, { metal: 1e6, crystal: 1e6, deuterium: 1e6 });
    const result = enqueueCheapest(state, "mines");
    expect(result.ok).toBe(true);
    expect(result.state.planet.buildQueue[0]?.building).toBe("crystal_mine");
    const broke = stateWith({ metal_mine: 5 }, { metal: 0, crystal: 0, deuterium: 0 });
    const waiting = enqueueCheapest(broke, "mines");
    expect(waiting.ok).toBe(false);
    expect(waiting.reason).toContain("最便宜的是");
  });

  it("unlocks 最便宜优先 at computer technology 2", () => {
    expect(refreshUnlocks(withResearch(stateWith(), { computer_tech: 1 })).unlockedCards).not.toContain("cheapest_first");
    expect(refreshUnlocks(withResearch(stateWith(), { computer_tech: 2 })).unlockedCards).toContain("cheapest_first");
  });
});

describe("save v7 research", () => {
  it("round-trips research levels, the research queue and dark matter", () => {
    let state = withResearch(lab(3), { energy_tech: 4, espionage_tech: 2 });
    state = { ...state, darkMatter: big(777) };
    state = enqueueResearch(state, "computer_tech", "manual").state;
    state = enqueueResearch(state, "computer_tech", "protocol").state;
    state = tick(state, 0.5);
    const file = importSave(exportSave(state, 1));
    const restored = deserializeState(file.state);
    expect(serializeState(restored)).toEqual(serializeState(state));
    expect(restored.research.queue).toHaveLength(2);
    expect(restored.darkMatter.toNumber()).toBe(777);
  });

  it("rejects unknown research and bad levels", () => {
    const file = JSON.parse(exportSave(stateWith(), 1));
    file.state.research.levels.energy_tech = 2.5;
    expect(() => importSave(JSON.stringify(file))).toThrow("整数");
    const bad = JSON.parse(exportSave(stateWith(), 1));
    bad.state.research.queue = [{ tech: "warp_drive", targetLevel: 1, paid: { metal: "0", crystal: "0", deuterium: "0" }, totalSeconds: 1, remainingSeconds: 1, source: "manual" }];
    expect(() => importSave(JSON.stringify(bad))).toThrow("研究无效");
  });
});
