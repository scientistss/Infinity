import { afterEach, describe, expect, it, vi } from "vitest";
import { activeBuildings } from "../src/data/buildings";
import type { BuildingGoal } from "../src/game/building-template-state";
import { createBuildingTemplate, quoteBuildingTemplate } from "../src/game/building-templates";
import { advanceOrderPlans, createOrderTask, pauseOrderTask, resumeOrderTask } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import * as queue from "../src/game/queue";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { buildingTemplatesPanelHtml } from "../src/ui/building-templates-panel";
import {
  buildingTemplateAuthoritySignature, buildingTemplateBudgetText, buildingTemplateContextText,
  buildingTemplateGoals, buildingTemplateMapping, buildingTemplateMoney, buildingTemplateRowText,
} from "../src/ui/building-templates-present";

const money = (metal = "0", crystal = "0", deuterium = "0") => ({metal, crystal, deuterium});
function template(goals: BuildingGoal[], state = createInitialState(0x11112222, 0x33334444)): GameState {
  const result = createBuildingTemplate(state, {name: "合成建筑意图", goals}, state.buildingTemplates.nextTemplateId);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
afterEach(() => vi.restoreAllMocks());

describe("building-template read-only presentation", () => {
  it("starts folded with distinct DOM IDs, finite local language and the actual active catalog count", () => {
    const html = buildingTemplatesPanelHtml();
    expect(html).toContain('<details class="building-templates" id="building-templates">');
    expect(html).not.toContain('<details class="building-templates" id="building-templates" open');
    expect(html).toContain(`当前可新增 ${activeBuildings().length} 种已开放建筑`);
    expect(html).toContain("不自动拆分总额");
    expect(html).toContain("目标不规定施工顺序");
    expect(html).toContain('<option value="">请明确选择付款 / 执行星球</option>');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id === "building-templates" || id.startsWith("building-template-"))).toBe(true);
    expect(html).not.toContain("data-template-action");
  });

  it("maps high targets and context without pricing future levels or mutating state", () => {
    const state = template([{building: "metal_mine", targetLevel: 1000}]);
    const before = JSON.stringify(state), price = vi.spyOn(queue, "costFor");
    const mapping = buildingTemplateMapping(state, 1, "homeworld");
    const text = buildingTemplateRowText(state, mapping.rows[0]!);
    expect(text).toContain("本星球已完成 0 级");
    expect(text).toContain("整批目标还需 1000 个格子");
    expect(buildingTemplateContextText(state, mapping)).toContain("格子已用 0、已付款队列预留 0");
    expect(buildingTemplateAuthoritySignature(state, 1, "homeworld")).not.toBe("");
    expect(price).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps the explicit unselected-planet prompt and ignores another planet's level and plans", () => {
    let state = template([{building: "metal_mine", targetLevel: 3}]);
    const colony = createPlanet("synthetic-colony");
    colony.name = "合成第二星球";
    colony.buildings.metal_mine = 9;
    state = {...state, planets: [...state.planets, colony]};
    const created = createOrderTask(state, {kind: "building", building: "metal_mine", targetLevel: 10,
      planetId: colony.id, budget: money(), expectedNextTaskId: state.orders.nextTaskId});
    expect(created.ok, created.reason).toBe(true);
    state = created.state;
    const blank = buildingTemplateMapping(state, 1, "");
    expect(blank.rows).toEqual([]);
    expect(buildingTemplateContextText(state, blank)).toContain("请选择实际付款和执行星球");
    const local = buildingTemplateMapping(state, 1, "homeworld");
    expect(local.rows[0]!.status).toBe("new");
    expect(buildingTemplateRowText(state, local.rows[0]!)).not.toContain("合成第二星球");
  });

  it("distinguishes an intervening covered-plan pause even if resume later restores the same signature", () => {
    const initial = template([{building: "metal_mine", targetLevel: 3}, {building: "crystal_mine", targetLevel: 2}]);
    const created = createOrderTask(initial, {kind: "building", building: "metal_mine", targetLevel: 3,
      planetId: "homeworld", budget: money(), expectedNextTaskId: initial.orders.nextTaskId});
    expect(created.ok, created.reason).toBe(true);
    const running = created.state;
    const paused = pauseOrderTask(running, 1).state;
    const resumed = resumeOrderTask(paused, 1).state;
    const original = buildingTemplateAuthoritySignature(running, 1, "homeworld");
    expect(buildingTemplateAuthoritySignature(paused, 1, "homeworld")).not.toBe(original);
    expect(buildingTemplateAuthoritySignature(resumed, 1, "homeworld")).toBe(original);
    // The panel must observe the intervening signature while hidden, rather
    // than compare only after a later visible paint has returned to A.
    const price = vi.spyOn(queue, "costFor");
    for (const state of [running, paused, resumed]) buildingTemplateAuthoritySignature(state, 1, "homeworld");
    expect(price).not.toHaveBeenCalled();
  });

  it("shows paused original authorization and paid job provenance without claiming that payment again", () => {
    let state = template([{building: "metal_mine", targetLevel: 3}]);
    const created = createOrderTask(state, {kind: "building", building: "metal_mine", targetLevel: 3,
      planetId: "homeworld", budget: money("999", "999"), expectedNextTaskId: state.orders.nextTaskId});
    expect(created.ok, created.reason).toBe(true);
    state = advanceOrderPlans(created.state, 10);
    state = pauseOrderTask(state, 1).state;
    const row = buildingTemplateMapping(state, 1, "homeworld").rows[0]!;
    expect(row.status).toBe("covered");
    const text = buildingTemplateRowText(state, row);
    expect(text).toContain("已暂停");
    expect(text).toContain("原预算 金属 999 / 晶体 999 / 重氢 0");
    expect(text).toContain("原净支出 金属 60 / 晶体 15 / 重氢 0");
    expect(text).toContain("已付款工作 #1");
    expect(text).toContain("原计划 #1");
    expect(text).toContain("本次预算不认领原付款");
  });

  it("labels imported phase-locked goals and surfaces whole-batch conflicts", () => {
    let state = template([{building: "metal_mine", targetLevel: 3}, {building: "terraformer", targetLevel: 1}]);
    const created = createOrderTask(state, {kind: "building", building: "metal_mine", targetLevel: 2,
      planetId: "homeworld", budget: money(), expectedNextTaskId: state.orders.nextTaskId});
    expect(created.ok, created.reason).toBe(true);
    state = created.state;
    const mapping = buildingTemplateMapping(state, 1, "homeworld");
    expect(buildingTemplateGoals(state.buildingTemplates.templates[0]!)).toContain("设计目标 · 第 4 阶段未开放");
    expect(buildingTemplateRowText(state, mapping.rows[0]!)).toContain("整次不可创建");
    expect(buildingTemplateRowText(state, mapping.rows[1]!)).toContain("设计目标 · 第 4 阶段未开放");
    expect(mapping.ok).toBe(false);
  });

  it("presents the actual golden quote, exact decimals, invalid budgets and valid smaller finite caps", () => {
    const state = template([{building: "metal_mine", targetLevel: 3}, {building: "crystal_mine", targetLevel: 2}, {building: "solar_plant", targetLevel: 3}]);
    const quote = quoteBuildingTemplate(state, 1, "homeworld");
    expect(quote.totalQuote).toEqual(money("764", "274"));
    expect(buildingTemplateMoney(quote.totalQuote!)).toBe("金属 764 / 晶体 274 / 重氢 0");
    expect(buildingTemplateBudgetText(quote.totalQuote, money())).toContain("仍可创建有限计划");
    expect(buildingTemplateBudgetText(quote.totalQuote, money())).toContain("剩余额度不足时会等待");
    expect(buildingTemplateBudgetText(money("100000000000000000001"), money("100000000000000000000"))).toContain("低于");
    expect(buildingTemplateBudgetText(quote.totalQuote, quote.totalQuote!)).toContain("预算覆盖");
    expect(buildingTemplateBudgetText(quote.totalQuote, money("-1"))).toContain("预算无效");
    expect(buildingTemplateBudgetText(null, money())).toContain("报价无法精确表示");
  });
});
