import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEARCH } from "../src/data/research";
import { createBuildingTemplate } from "../src/game/building-templates";
import { big } from "../src/game/decimal";
import { cancelDemolition, commitDemolition, quoteDemolition } from "../src/game/demolition";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { evaluatePrestige, tick } from "../src/game/logic";
import { createOrderTask, pauseOrderTask, runDueOrderPass } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { cancel, enqueue } from "../src/game/queue";
import * as research from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import * as blockers from "../src/ui/lab-blockers-model";
import { present, presentVisible } from "../src/ui/present";

const INPUT = { status: "", banner: null, notice: null, catchup: null };
const EMPTY = { planetCount: 0, jobCount: 0, summary: "", note: "", items: [] };
const view = (state: GameState) => presentVisible(state, INPUT, "research").research;

function apply(result: { ok: boolean; reason: string; state: GameState }): GameState {
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

/** Synthetic starting economy; every displayed job is paid through its real API. */
function ready(): GameState {
  const state = createInitialState(113, 337);
  state.planets = [
    createPlanet("homeworld", { galaxy: 1, system: 56, position: 11 }),
    createPlanet("same-name", { galaxy: 1, system: 56, position: 12 }),
    createPlanet("demolition-world", { galaxy: 2, system: 7, position: 3 }),
  ];
  for (const [index, planet] of state.planets.entries()) {
    planet.name = index < 2 ? "同名星" : "拆除星";
    planet.buildings.research_lab = [3, 2, 5][index]!;
    planet.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
  }
  return state;
}

function occupied(): GameState {
  let state = apply(enqueue(ready(), "research_lab", "manual"));
  state = apply(enqueue(state, "research_lab", "manual"));
  state = selectPlanet(state, "same-name");
  state = apply(enqueue(state, "metal_mine", "manual"));
  state = apply(enqueue(state, "research_lab", "manual"));
  state = selectPlanet(state, "demolition-world");
  const quoted = quoteDemolition(state, "research_lab");
  expect(quoted.ok, quoted.reason).toBe(true);
  state = apply(commitDemolition(state, quoted.quote!));
  return selectPlanet(state, "same-name");
}

afterEach(() => vi.restoreAllMocks());

describe("read-only empire lab blocker projection", () => {
  it("lists literal paid head, tail, other-world and independent demolition facts", () => {
    const state = occupied(), before = JSON.stringify(state), saved = JSON.stringify(serializeState(state));
    freeze(state);
    expect(blockers.labBlockers(state)).toEqual({
      planetCount: 3, jobCount: 4,
      summary: "研究受阻：3处实验室施工",
      note: "按星球计，共 4 项已付工作（含排队）；以下仅列已付款的升级与拆除。",
      items: [
        { planetId: "homeworld", planetName: "同名星", coordinates: "[1:56:11]", jobId: 1,
          kind: "upgrade", targetLevel: 4, queuePosition: 1, status: "已付 · 施工中",
          text: "同名星 [1:56:11] · 升级 → 等级 4 · 建造队列第 1 位 · 已付 · 施工中 · 工作 #1" },
        { planetId: "homeworld", planetName: "同名星", coordinates: "[1:56:11]", jobId: 2,
          kind: "upgrade", targetLevel: 5, queuePosition: 2, status: "已付排队",
          text: "同名星 [1:56:11] · 升级 → 等级 5 · 建造队列第 2 位 · 已付排队 · 工作 #2" },
        { planetId: "same-name", planetName: "同名星", coordinates: "[1:56:12]", jobId: 4,
          kind: "upgrade", targetLevel: 3, queuePosition: 2, status: "已付排队",
          text: "同名星 [1:56:12] · 升级 → 等级 3 · 建造队列第 2 位 · 已付排队 · 工作 #4" },
        { planetId: "demolition-world", planetName: "拆除星", coordinates: "[2:7:3]", jobId: 5,
          kind: "demolition", targetLevel: 4, queuePosition: null, status: "已付 · 施工中",
          text: "拆除星 [2:7:3] · 拆除 → 等级 4 · 独立拆除位 · 已付 · 施工中 · 工作 #5" },
      ],
    });
    view(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(serializeState(state))).toBe(saved);
  });

  it("counts a world once even when it has two paid lab jobs", () => {
    const state = apply(enqueue(apply(enqueue(ready(), "research_lab", "manual")), "research_lab", "manual"));
    expect(blockers.labBlockers(state)).toMatchObject({ planetCount: 1, jobCount: 2, summary: "研究受阻：1处实验室施工" });
    expect(blockers.labBlockers(state).items.map(item => item.status)).toEqual(["已付 · 施工中", "已付排队"]);
  });

  it("does not call a zero-duration head or a tail with stored duration running", () => {
    const state = occupied(), home = state.planets[0]!;
    // Boundary snapshots, deliberately separate from the real paid-job fixture.
    home.buildQueue[0]!.totalSeconds = 0;
    home.buildQueue[1]!.totalSeconds = 123;
    expect(blockers.labBlockers(state).items.slice(0, 2).map(item => item.status)).toEqual(["已付排队", "已付排队"]);
  });

  it("excludes uncharged plans, templates, completed labs and unrelated construction", () => {
    let state = apply(createBuildingTemplate(ready(), {
      name: "尚未付款的实验室意图", goals: [{ building: "research_lab", targetLevel: 6 }],
    }, 1));
    state = apply(createOrderTask(state, {
      kind: "building", planetId: "homeworld", building: "research_lab", targetLevel: 4,
      expectedNextTaskId: 1, budget: { metal: "100000", crystal: "100000", deuterium: "100000" },
    }));
    state = apply(enqueue(state, "metal_mine", "manual"));
    expect(blockers.labBlockers(state)).toEqual(EMPTY);
    const quote = quoteDemolition(selectPlanet(state, "demolition-world"), "research_lab");
    expect(quote.ok).toBe(true);
    expect(blockers.labBlockers(state)).toEqual(EMPTY);
    state = runDueOrderPass(state);
    expect(blockers.labBlockers(state).items.map(item => [item.jobId, item.queuePosition, item.status])).toEqual([[2, 2, "已付排队"]]);
  });

  it("keeps paid work running when its finite plan is paused", () => {
    let state = apply(createOrderTask(ready(), {
      kind: "building", planetId: "homeworld", building: "research_lab", targetLevel: 4,
      expectedNextTaskId: 1, budget: { metal: "100000", crystal: "100000", deuterium: "100000" },
    }));
    state = apply(pauseOrderTask(runDueOrderPass(state), 1));
    expect(blockers.labBlockers(state).items[0]).toMatchObject({ jobId: 1, status: "已付 · 施工中" });
    const after = tick(state, 0.25);
    expect(activePlanet(after).buildQueue[0]!.remainingSeconds).toBeLessThan(activePlanet(state).buildQueue[0]!.remainingSeconds);
  });

  it("re-derives paid IDs, targets and positions after cancellation and completion", () => {
    let state = selectPlanet(occupied(), "homeworld");
    const original = blockers.labBlockers(state);
    state = apply(cancel(state, 0));
    expect(blockers.labBlockers(state).items[0]).toMatchObject({ jobId: 2, targetLevel: 4, queuePosition: 1, status: "已付 · 施工中" });
    state = tick(state, 60);
    expect(blockers.labBlockers(state)).toEqual(EMPTY);
    expect(original.items.map(item => item.jobId)).toEqual([1, 2, 4, 5]);
    expect(original.jobCount).toBe(4);
  });

  it("removes a cancelled demolition and preserves other blockers", () => {
    const state = occupied();
    const cancelled = apply(cancelDemolition(state, { kind: "demolition", planetId: "demolition-world", jobId: 5, taskId: null }));
    expect(blockers.labBlockers(cancelled)).toMatchObject({ planetCount: 2, jobCount: 3 });
    expect(blockers.labBlockers(cancelled).items.map(item => item.jobId)).toEqual([1, 2, 4]);
  });

  it("re-derives on world selection, full save adoption, curvature and same-ID new game", () => {
    const state = occupied(), initial = blockers.labBlockers(state);
    expect(blockers.labBlockers(selectPlanet(state, "demolition-world"))).toEqual(initial);
    const imported = deserializeState(serializeState(state));
    expect(blockers.labBlockers(imported)).toEqual(initial);
    imported.planets[0]!.name = "导入后的同编号星球";
    expect(blockers.labBlockers(imported).items[0]!.planetName).toBe("导入后的同编号星球");
    expect(initial.items[0]!.planetName).toBe("同名星");
    state.lifetime.metal = big(1e8);
    const reset = evaluatePrestige(state);
    expect(reset.gain.gt(0)).toBe(true);
    expect(blockers.labBlockers(reset.next)).toEqual(EMPTY);
    const replacement = createInitialState(113, 337);
    expect(replacement.activePlanetId).toBe("homeworld");
    expect(blockers.labBlockers(replacement)).toEqual(EMPTY);
  });
});

describe("lab blocker presenter isolation", () => {
  it("builds the complete list once per research projection, never once per card", () => {
    const state = occupied(), projection = vi.spyOn(blockers, "labBlockers");
    const cards = vi.spyOn(research, "canEnqueueResearch");
    const shown = view(state);
    expect(projection).toHaveBeenCalledTimes(1);
    expect(cards).toHaveBeenCalledTimes(RESEARCH.length);
    expect(shown.labBlockers?.jobCount).toBe(4);
    projection.mockClear(); cards.mockClear();
    for (const tab of ["overview", "facilities", "save", "galaxy", "fleet", "orders"]) {
      expect(presentVisible(state, INPUT, tab).research.labBlockers).toBeNull();
    }
    expect(projection).not.toHaveBeenCalled();
    expect(cards).not.toHaveBeenCalled();
    expect(view(state).labBlockers).toEqual(shown.labBlockers);
    expect(projection).toHaveBeenCalledTimes(1);
  });

  it("leaves every existing card, button, quote and paid queue field unchanged", () => {
    const state = occupied(), before = JSON.stringify(state);
    freeze(state);
    const shown = present(state, INPUT);
    vi.spyOn(blockers, "labBlockers").mockReturnValue(EMPTY);
    const withoutExplanation = present(state, INPUT);
    expect(shown.research.items).toEqual(withoutExplanation.research.items);
    expect(shown.research.queue).toEqual(withoutExplanation.research.queue);
    expect(shown.queue).toEqual(withoutExplanation.queue);
    expect(shown.buildings).toEqual(withoutExplanation.buildings);
    expect(shown.shipyard).toEqual(withoutExplanation.shipyard);
    expect(shown.research.items.find(item => item.id === "energy_tech")).toMatchObject({
      button: "研究 等级 1", canEnqueue: false, reason: "研究实验室正在拆除，暂不能研究",
      cost: "晶体 800.00 · 重氢 400.00", time: "研究时间 2 秒",
    });
    expect(shown.research.queue).toEqual({
      summary: "研究队列 0/2 · 研究实验室 2 级", items: [], signature: "",
      idleHint: "研究实验室正在拆除，暂不能研究。",
    });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps existing upgrade-only reasons and the no-blocker research queue", () => {
    const state = apply(enqueue(ready(), "research_lab", "manual"));
    expect(view(selectPlanet(state, "same-name")).items.find(item => item.id === "energy_tech")).toMatchObject({
      canEnqueue: false, reason: "研究实验室正在升级，暂不能研究",
    });
    const cleared = apply(cancel(state, 0));
    expect(view(cleared).labBlockers).toEqual(EMPTY);
    expect(view(cleared).queue.idleHint).toBe("研究队列空闲。研究同一时间只进行 1 项，入队时扣费，取消全额退还。");
    expect(view(cleared).items.find(item => item.id === "energy_tech")!.canEnqueue).toBe(true);
  });

  it("keeps active and waiting paid research queues identical when the explanation is absent", () => {
    let state = apply(research.enqueueResearch(ready(), "energy_tech", "manual"));
    state = apply(research.enqueueResearch(state, "energy_tech", "manual"));
    const shown = view(state);
    vi.spyOn(blockers, "labBlockers").mockReturnValue(EMPTY);
    expect(view(state).queue).toEqual(shown.queue);
    expect(shown.labBlockers).toEqual(EMPTY);
    expect(shown.queue.items.map(item => [item.jobId, item.active, item.detail])).toEqual([
      [1, true, "剩余 2 秒 / 共 2 秒"], [2, false, "等待中 · 已付款 · 按当前条件预计 3 秒（开工时确定）"],
    ]);
  });
});
