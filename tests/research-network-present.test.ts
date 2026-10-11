import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchId } from "../src/data/research";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { createPlanet } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import * as research from "../src/game/research";
import { createResearchTemplate, mapResearchTemplate, quoteResearchTemplate } from "../src/game/research-templates";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { localOrderQuoteContextKey, quoteLocalOrder } from "../src/ui/order-quote-model";
import { presentVisible } from "../src/ui/present";
import { templateRowText } from "../src/ui/research-templates-present";

const input = { status: "", banner: null, notice: null, catchup: null };
const view = (state: GameState) => presentVisible(state, input, "research").research;
const card = (state: GameState, id: ResearchId) => view(state).items.find(item => item.id === id)!;

/** Deliberate synthetic worlds, with fixed entropy and distinct coordinates. */
function networkState(networkLevel = 2): GameState {
  const state = createInitialState(0x11114444, 0x77772222);
  const home = activePlanet(state);
  home.name = "合成主实验室";
  home.coordinates = { galaxy: 1, system: 51, position: 5 };
  home.buildings.research_lab = 10;
  home.resources = { metal: big(1e9), crystal: big(1e9), deuterium: big(1e9) };
  Object.assign(state.research.levels, {
    energy_tech: 8, laser_tech: 10, ion_tech: 6, shielding_tech: 5,
    hyperspace_tech: 5, computer_tech: 8, intergalactic_research_network: networkLevel,
  });
  for (const [id, name, labLevel, position] of [
    ["support-nine", "合成九级协作星", 9, 6],
    ["support-four", "合成四级协作星", 4, 7],
  ] as const) {
    const planet = createPlanet(id, { galaxy: 1, system: 51, position });
    planet.name = name;
    planet.buildings.research_lab = labLevel;
    planet.resources = { metal: big(1e9), crystal: big(1e9), deuterium: big(1e9) };
    state.planets.push(planet);
  }
  return state;
}

function pay(state: GameState, tech: ResearchId): GameState {
  const result = research.enqueueResearch(state, tech, "manual");
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

afterEach(() => vi.restoreAllMocks());

describe("per-technology research-network presentation", () => {
  it("shows literal quotes and lab sums for each technology's own prerequisite", () => {
    const state = networkState(), before = JSON.stringify(state);
    const shown = view(state);
    // Independent formula examples: ion 1300*64*0.006/24 = 20.8 seconds;
    // hyperspace 4000*32*0.006/20 = 38.4 seconds. The level-4 lab helps only ion.
    expect(shown.items.find(item => item.id === "ion_tech")).toMatchObject({
      time: "研究时间 21 秒",
      later: "当前实验室：主 10 + 协作 13 = 23 级。后续：拆除费用 −4%/级（拆除随第 4 阶段）",
      canEnqueue: true,
    });
    expect(shown.items.find(item => item.id === "hyperspace_tech")).toMatchObject({
      time: "研究时间 39 秒",
      later: "当前实验室：主 10 + 协作 9 = 19 级。后续：货舱 +5%/级（第 4 阶段舰队）",
      canEnqueue: true,
    });
    expect(shown.items.find(item => item.id === "energy_tech")).toMatchObject({
      time: "研究时间 52 秒", later: "当前实验室：主 10 + 协作 13 = 23 级",
      cost: "晶体 2.05e5 · 重氢 1.02e5",
    });
    expect(shown.queue.summary).toBe("研究队列 0/2 · 研究实验室 10 级");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("retains original single-lab labels with IRN zero or no eligible supporters", () => {
    const zero = networkState(0);
    expect(card(zero, "ion_tech")).toMatchObject({
      time: "研究时间 46 秒", later: "后续：拆除费用 −4%/级（拆除随第 4 阶段）",
    });
    expect(card(zero, "hyperspace_tech")).toMatchObject({
      time: "研究时间 1 分 10 秒", later: "后续：货舱 +5%/级（第 4 阶段舰队）",
    });
    const alone = networkState();
    alone.planets = [activePlanet(alone)];
    expect(card(alone, "energy_tech")).toMatchObject({ time: "研究时间 1 分 52 秒", later: "" });
    // Neither the level-9 nor the level-4 lab meets IRN's original level-10 prerequisite.
    expect(card(networkState(), "intergalactic_research_network")).toMatchObject({
      time: "研究时间 23 分 17 秒", later: "",
    });
    expect(card(networkState(), "intergalactic_research_network").effect).not.toContain("多星球后生效");
  });

  it("never displays an aggregate as satisfying the primary lab requirement", () => {
    const state = networkState();
    activePlanet(state).buildings.research_lab = 4;
    state.planets.find(planet => planet.id === "support-nine")!.buildings.research_lab = 20;
    const shown = card(state, "hyperspace_tech");
    expect(shown).toMatchObject({
      time: "研究时间 2 分 34 秒", locked: true, canEnqueue: false,
      reason: "需要 研究实验室 等级 7", later: "后续：货舱 +5%/级（第 4 阶段舰队）",
    });
    expect(shown.chain[0]).toEqual({ label: "研究实验室 4/7", met: false });
  });

  it("uses only completed network levels when quoting the next card", () => {
    let state = networkState(1);
    state.research.levels.hyperspace_tech = 8;
    state = pay(state, "intergalactic_research_network");
    expect(card(state, "ion_tech")).toMatchObject({
      time: "研究时间 25 秒",
      later: "当前实验室：主 10 + 协作 9 = 19 级。后续：拆除费用 −4%/级（拆除随第 4 阶段）",
    });
    expect(state.research.queue[0]!.targetLevel).toBe(2);
    expect(state.research.levels.intergalactic_research_network).toBe(1);
  });

  it("keeps the global lab-construction blocker visible even on an unrelated world", () => {
    let state = networkState();
    const unrelated = createPlanet("unrelated-lab", { galaxy: 1, system: 51, position: 8 });
    unrelated.resources = { metal: big(1e9), crystal: big(1e9), deuterium: big(1e9) };
    state.planets.push(unrelated);
    const queued = enqueue(selectPlanet(state, unrelated.id), "research_lab", "manual");
    expect(queued.ok, queued.reason).toBe(true);
    state = selectPlanet(queued.state, "homeworld");
    const before = JSON.stringify(state);
    expect(card(state, "ion_tech")).toMatchObject({
      canEnqueue: false, reason: "研究实验室正在升级，暂不能研究",
    });
    expect(view(state).queue.idleHint).toBe("研究实验室正在升级，暂不能研究。");
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("paid research queue presentation", () => {
  it("keeps running duration frozen and labels changing waiting quotes as estimates", () => {
    let state = pay(pay(networkState(), "ion_tech"), "hyperspace_tech");
    state = research.withResearchRemaining(state, 7);
    const initial = view(state).queue;
    expect(initial.items.map(item => item.detail)).toEqual([
      "剩余 7 秒 / 共 21 秒", "等待中 · 已付款 · 按当前条件预计 39 秒（开工时确定）",
    ]);
    state = { ...state, planets: state.planets.filter(planet => planet.id !== "support-nine") };
    state = selectPlanet(state, "support-four");
    const before = JSON.stringify(state), changed = view(state).queue;
    expect(changed.items.map(item => item.detail)).toEqual([
      "剩余 7 秒 / 共 21 秒", "等待中 · 已付款 · 按当前条件预计 1 分 10 秒（开工时确定）",
    ]);
    expect(changed.items.map(item => item.label)).toEqual([
      "离子技术 → 等级 7 · 合成主实验室", "超空间技术 → 等级 6 · 合成主实验室",
    ]);
    expect(changed.summary).toBe("研究队列 2/2 · 研究实验室 10 级");
    expect(changed.signature).toBe(initial.signature);
    expect(changed.items[0]!.progressPct).toBeCloseTo(66.3461538462, 8);
    expect(JSON.stringify(state)).toBe(before);
    const started = research.completeActiveResearch(state).state;
    expect(view(started).queue.items[0]!.detail).toBe("剩余 1 分 10 秒 / 共 1 分 10 秒");
    expect(started.research.queue[0]!.totalSeconds).toBeCloseTo(69.8181818182, 8);
  });

  it("does not request a fresh duration for an active job while showing queue-only chrome", () => {
    const state = pay(networkState(), "ion_tech");
    state.planets = [activePlanet(state)];
    // A restored running order can carry a duration from earlier lab conditions.
    state.research.queue[0]!.totalSeconds = 600;
    state.research.queue[0]!.remainingSeconds = 123;
    const seconds = vi.spyOn(research, "researchSecondsFor"), before = JSON.stringify(state);
    const shown = presentVisible(state, input, "overview").research;
    expect(shown.items).toEqual([]);
    expect(shown.queue.items[0]!.detail).toBe("剩余 2 分 3 秒 / 共 10 分 0 秒");
    expect(shown.queue.items[0]!.detail).not.toContain("实验室");
    expect(seconds).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("resource-only plans and templates", () => {
  it("keeps fixed-payer budgets independent of changing support labs, without ETA work", () => {
    const created = createResearchTemplate(networkState(), {
      name: "合成资源预算", goals: [{ tech: "energy_tech", targetLevel: 9 }],
    }, 1);
    expect(created.ok, created.reason).toBe(true);
    const state = created.state;
    const target = { kind: "research" as const, tech: "energy_tech" as const, targetLevel: 9, planetId: "homeworld" };
    const seconds = vi.spyOn(research, "researchSecondsFor");
    const beforeKey = localOrderQuoteContextKey(state, target);
    const originalQuote = quoteResearchTemplate(state, 1, "homeworld");
    expect(originalQuote.totalQuote).toEqual({ metal: "0", crystal: "204800", deuterium: "102400" });
    expect(quoteLocalOrder(state, target).cost).toEqual({ metal: "0", crystal: "204800", deuterium: "102400" });
    state.planets.find(planet => planet.id === "support-nine")!.buildings.research_lab = 30;
    const before = JSON.stringify(state), changedQuote = quoteResearchTemplate(state, 1, "homeworld");
    expect(changedQuote.totalQuote).toEqual({ metal: "0", crystal: "204800", deuterium: "102400" });
    expect(changedQuote.reviewKey).toBe(originalQuote.reviewKey);
    expect(localOrderQuoteContextKey(state, target)).toBe(beforeKey);
    expect(quoteLocalOrder(selectPlanet(state, "support-four"), target).payer).toEqual({ id: "homeworld", name: "合成主实验室" });
    const mapping = mapResearchTemplate(state, 1, "homeworld");
    expect(templateRowText(state, mapping.rows[0]!)).toBe("能源技术 → 9 级（已完成 8 级） · 新建候选");
    expect(seconds).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });
});
