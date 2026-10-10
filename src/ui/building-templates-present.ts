import { CURRENT_PHASE, buildingById } from "../data/buildings";
import { mapBuildingTemplate, buildingTemplateAuthorityKey } from "../game/building-templates";
import type { BuildingTemplate, BuildingTemplateMapping, BuildingTemplateRow } from "../game/building-template-state";
import { compareOrderAmounts, subtractOrderAmounts } from "../game/order-money";
import type { OrderMoney } from "../game/order-state";
import { usedFields } from "../game/planet";
import { queueCapacity } from "../game/queue";
import type { GameState } from "../game/types";

export const BUILDING_TEMPLATE_RESOURCES = [["metal", "金属"], ["crystal", "晶体"], ["deuterium", "重氢"]] as const;
export const buildingTemplateMoney = (money: OrderMoney) => BUILDING_TEMPLATE_RESOURCES.map(([id, label]) => `${label} ${money[id]}`).join(" / ");
export const buildingTemplatePlanet = (state: GameState, id: string) => state.planets.find(planet => planet.id === id)?.name ?? `${id}（已不存在）`;
function goalName(goal: BuildingTemplate["goals"][number]): string {
  const def = buildingById(goal.building);
  return `${def.nameZh} → ${goal.targetLevel} 级${def.phase > CURRENT_PHASE ? `（设计目标 · 第 ${def.phase} 阶段未开放）` : ""}`;
}
export const buildingTemplateGoals = (template: BuildingTemplate) => template.goals.map(goalName).join(" · ");

export function buildingTemplateRowText(state: GameState, row: BuildingTemplateRow): string {
  const parts = [`${goalName(row)}（本星球已完成 ${row.currentLevel} 级）`];
  if (row.status === "achieved") parts.push("已达到，无需新建");
  else if (row.status === "new") parts.push("新建候选");
  const task = row.existingTask;
  if (task) {
    parts.push(`${row.status === "conflict" ? "冲突：已有较低目标或重复计划，整次不可创建" : row.status === "covered" ? "已有计划覆盖目标" : "已有原计划"} #${task.id}`);
    parts.push(`${task.status === "paused" ? "已暂停" : "运行中"} · 原目标 ${task.targetLevel} 级 · 原付款 / 执行星球 ${buildingTemplatePlanet(state, task.planetId)}`);
    parts.push(`原预算 ${buildingTemplateMoney(task.budget)}`);
    parts.push(`原净支出 ${BUILDING_TEMPLATE_RESOURCES.map(([id, label]) => `${label} ${subtractOrderAmounts(task.charged[id], task.refunded[id]) ?? "账目待检查"}`).join(" / ")}`);
    parts.push(`${task.hasTransport ? "含原运输授权" : "本地计划"}${task.reason ? ` · ${task.reason}` : ""}。不会恢复、改目标或追加原预算`);
  }
  for (const job of row.paidJobs) {
    const source = job.source === "manual" ? "手动建造" : job.source === "protocol" ? "协议建造" : `原计划 #${job.taskId ?? "待核对"}`;
    parts.push(`已付款工作 #${job.jobId}（${buildingTemplatePlanet(state, job.planetId)}，${job.targetLevel} 级，${source}；原付款 ${buildingTemplateMoney(job.paid)}），等待真实完成；本次预算不认领原付款`);
  }
  parts.push(...row.warnings);
  return parts.join(" · ");
}

/** Bounded context only. Used/reserved fields and the local queue never price future levels. */
export function buildingTemplateContextText(state: GameState, mapping: BuildingTemplateMapping): string {
  const planet = state.planets.find(value => value.id === mapping.planetId);
  if (!planet) return mapping.reason;
  const used = usedFields(planet), reserved = planet.buildQueue.length;
  return `固定付款 / 执行星球：${planet.name} [${planet.id}]；本地建造队列 ${reserved} / ${queueCapacity(state)}；格子已用 ${used}、已付款队列预留 ${reserved}、上限 ${planet.fieldsMax}，剩余 ${Math.max(0, planet.fieldsMax - used - reserved)}。${mapping.reason}`;
}

/** Compare exact decimal strings only; a smaller independent cap remains a valid finite plan. */
export function buildingTemplateBudgetText(quote: OrderMoney | null, budget: OrderMoney): string {
  const comparisons = BUILDING_TEMPLATE_RESOURCES.map(([id]) => compareOrderAmounts(budget[id], quote?.[id] ?? "0"));
  if (comparisons.includes(null)) return "预算无效，请填写范围内的非负精确金额后重新核对。";
  if (!quote) return "报价无法精确表示，请降低目标等级。";
  if (comparisons.some(value => value === -1)) return "本项预算低于当前未付报价：仍可创建有限计划；剩余额度不足时会等待，不会自动追加。";
  return "本项预算覆盖当前未付报价；实际入队时仍须满足资源、前置、格子与队列条件。";
}

/** Pure cheap mapping and shared authority snapshot; explicit fill/review performs pricing elsewhere. */
export const buildingTemplateMapping = mapBuildingTemplate;
export const buildingTemplateAuthoritySignature = buildingTemplateAuthorityKey;
