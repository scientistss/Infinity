import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEARCH, researchById } from "../src/data/research";
import { arcadeUnlocked } from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { enqueueResearch } from "../src/game/research";
import { exportSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { present, presentVisible, researchVisible, resolveVisibleTab } from "../src/ui/present";

const INPUT = { status: "", banner: null, notice: null, catchup: null };
const EFFECT = "1 级解锁深空星环机（信标版）";
const LATER = "后续：殖民地数 ⌈L/2⌉、远征槽 ⌊√L⌋（第 4 阶段）";
const SEEDS = [20261013, 49303029] as const;
const panel = (state: GameState) => presentVisible(state, INPUT, "research").research;
const astrophysics = (state: GameState) => panel(state).items.find(item => item.id === "astrophysics")!;

// These are deliberately synthetic unit-test boundaries. The separate fixture script
// earns the first lab through the real engine and never copies these state edits.
function boundary(level = 0): GameState {
  const state = createInitialState(...SEEDS);
  activePlanet(state).buildings.research_lab = 1;
  state.research.levels.astrophysics = level;
  return state;
}

function paidUnfinished(): GameState {
  const state = boundary();
  const home = activePlanet(state);
  home.buildings.research_lab = 3;
  home.resources = { metal: big(4000), crystal: big(8000), deuterium: big(4000) };
  state.research.levels.espionage_tech = 4;
  state.research.levels.impulse_drive = 3;
  const result = enqueueResearch(state, "astrophysics", "manual");
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

function freezeTree(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeTree(child);
  Object.freeze(value);
}

afterEach(() => vi.restoreAllMocks());

describe("current astrophysics unlock copy", () => {
  it("does not open either gated page in a real initial state", () => {
    const state = createInitialState(...SEEDS);
    expect(researchVisible(state)).toBe(false);
    expect(resolveVisibleTab(state, "research")).toBe("facilities");
    expect(arcadeUnlocked(state)).toBe(false);
    expect(resolveVisibleTab(state, "arcade")).toBe("facilities");
  });

  it("shows the current effect at lab 1 / astrophysics 0 without changing prerequisites", () => {
    const state = boundary();
    expect(researchVisible(state)).toBe(true);
    expect(resolveVisibleTab(state, "research")).toBe("research");
    expect(arcadeUnlocked(state)).toBe(false);
    expect(astrophysics(state)).toMatchObject({
      level: "0", effect: EFFECT, later: LATER,
      cost: "金属 4.00e3 · 晶体 8.00e3 · 重氢 4.00e3", time: "研究时间 36 秒",
      button: "研究 等级 1", locked: true, canEnqueue: false,
      reason: "需要 研究实验室 等级 3、间谍技术 等级 4、脉冲引擎 等级 3",
      chain: [
        { label: "研究实验室 1/3", met: false },
        { label: "间谍技术 0/4", met: false },
        { label: "脉冲引擎 0/3", met: false },
      ],
    });
  });

  it("keeps the existing effect and real unlock at completed level 1", () => {
    const state = boundary(1);
    expect(astrophysics(state)).toMatchObject({ level: "1", effect: EFFECT, later: LATER, button: "研究 等级 2" });
    expect(arcadeUnlocked(state)).toBe(true);
    expect(resolveVisibleTab(state, "arcade")).toBe("arcade");
  });

  it("does not treat paid but unfinished level 1 as an unlock", () => {
    const state = paidUnfinished();
    const job = state.research.queue[0]!;
    expect(job.targetLevel).toBe(1);
    expect(job.remainingSeconds).toBeGreaterThan(0);
    expect(state.research.levels.astrophysics).toBe(0);
    expect(astrophysics(state)).toMatchObject({ level: "0（队列中 +1）", effect: EFFECT, later: LATER, button: "研究 等级 2" });
    expect(arcadeUnlocked(state)).toBe(false);
    expect(resolveVisibleTab(state, "arcade")).toBe("facilities");
    const finished = tick(state, job.remainingSeconds);
    expect(finished.research.levels.astrophysics).toBe(1);
    expect(arcadeUnlocked(finished)).toBe(true);
    expect(astrophysics(finished).effect).toBe(EFFECT);
  });

  it("leaves every other research card identical across the affected level boundary", () => {
    const zero = boundary(), one = boundary(1);
    const otherCards = (state: GameState) => panel(state).items.filter(item => item.id !== "astrophysics");
    expect(otherCards(zero)).toHaveLength(RESEARCH.length - 1);
    expect(otherCards(zero)).toEqual(otherCards(one));
    // Preserve all existing later text, including historically staged wording.
    for (const item of panel(zero).items) {
      const def = researchById(item.id);
      expect(item.later).toBe(def.later ? `后续：${def.later}` : "");
      if (!["energy_tech", "computer_tech", "plasma_tech"].includes(item.id)) expect(item.effect).toBe(def.effect);
    }
    expect(panel(zero).items.find(item => item.id === "energy_tech")!.effect).toBe(
      "核聚变供电 30·L·(1.05 + 0.01·能源技术)^L；核聚变需要 3 级。下一级：核聚变供电 0.00 → 0.00",
    );
    expect(panel(zero).items.find(item => item.id === "computer_tech")!.effect).toBe(
      "每 2 级 +1 协议卡槽（上限 12）；纳米机器人工厂需要 10 级。下一级：等级 1",
    );
    expect(panel(zero).items.find(item => item.id === "plasma_tech")!.effect).toBe(
      "矿产量：金属 +1%、晶体 +0.66%、重氢 +0.33%（每级）。下一级合计：金属 +1.00%、晶体 +0.66%、重氢 +0.33%",
    );
  });

  it.each(["level zero", "level one", "paid unfinished"])("is a pure full-state projection for %s", name => {
    const state = name === "paid unfinished" ? paidUnfinished() : boundary(name === "level one" ? 1 : 0);
    const rawBefore = exportSave(state, 123456789, 123456789);
    const allBefore = JSON.stringify(state);
    const seedsBefore = [state.universe.seed, state.arcade.seed, state.deepSpace.seed];
    freezeTree(state);
    const random = vi.spyOn(Math, "random");
    const first = present(state, INPUT);
    expect(present(state, INPUT)).toEqual(first);
    expect(presentVisible(state, INPUT, "research").research).toEqual(first.research);
    expect(random).not.toHaveBeenCalled();
    expect([state.universe.seed, state.arcade.seed, state.deepSpace.seed]).toEqual(seedsBefore);
    expect(JSON.stringify(state)).toBe(allBefore);
    expect(exportSave(state, 123456789, 123456789)).toBe(rawBefore);
  });

  it("fixes initial entropy through the supported factory arguments without economic edits", () => {
    const random = vi.spyOn(Math, "random");
    const state = createInitialState(...SEEDS);
    expect(exportSave(state, 123, 123)).toBe(exportSave(createInitialState(...SEEDS), 123, 123));
    expect(random).not.toHaveBeenCalled();
    expect(state.universe.seed).toBe(SEEDS[0]);
    expect(state.arcade.seed).toBe(SEEDS[1]);
    expect(Object.values(activePlanet(state).buildings).every(level => level === 0)).toBe(true);
    expect(Object.values(state.research.levels).every(level => level === 0)).toBe(true);
    expect(Object.values(activePlanet(state).resources).map(amount => amount.toString())).toEqual(["500", "500", "0"]);
  });
});
