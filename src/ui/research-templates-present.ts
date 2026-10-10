import { researchById } from "../data/research";
import { mapResearchTemplate, researchTemplateAuthorityKey } from "../game/research-templates";
import type { ResearchTemplate, ResearchTemplateMapping, ResearchTemplateRow } from "../game/research-template-state";
import type { OrderMoney } from "../game/order-state";
import type { GameState } from "../game/types";

export const TEMPLATE_RESOURCES = [["metal", "金属"], ["crystal", "晶体"], ["deuterium", "重氢"]] as const;
export const templateMoney = (money: OrderMoney) => TEMPLATE_RESOURCES.map(([id, label]) => `${label} ${money[id]}`).join(" / ");
export const templateGoals = (template: ResearchTemplate) => template.goals.map(goal => `${researchById(goal.tech).nameZh} ${goal.targetLevel} 级`).join(" · ");
export const templatePlanet = (state: GameState, id: string) => state.planets.find(planet => planet.id === id)?.name ?? `${id}（已不存在）`;

export function templateRowText(state: GameState, row: ResearchTemplateRow): string {
  const title = `${researchById(row.tech).nameZh} → ${row.targetLevel} 级（已完成 ${row.currentLevel} 级）`;
  if (row.status === "achieved") return `${title} · 已达到，无需新建`;
  const task = row.existingTask;
  if (task) return `${title} · ${row.status === "conflict" ? "冲突：已有较低目标，整次不可创建" : "已有计划覆盖目标"} #${task.id} · ${task.status === "paused" ? "已暂停" : "运行中"} · 原目标 ${task.targetLevel} 级 · 原付款星球 ${templatePlanet(state, task.planetId)} · 原预算 ${templateMoney(task.budget)}${task.hasTransport ? " · 含原运输授权" : " · 本地计划"} · ${task.reason}。不会恢复、改目标或追加原预算。`;
  return `${title} · 新建候选${row.paidJobs.length ? ` · ${row.paidJobs.map(job => `已付款工作 #${job.jobId}（${templatePlanet(state, job.planetId)}，${job.targetLevel} 级）`).join("、")}在先，等待真实完成` : ""}${row.warnings.length ? ` · ${row.warnings.join("；")}` : ""}`;
}

/** Bounded live mapping only: never sum all future levels during animation renders. */
export function researchTemplateMapping(state: GameState, templateId: number, planetId: string): ResearchTemplateMapping {
  return mapResearchTemplate(state, templateId, planetId);
}

/** Shared domain dependencies only; no future-level quote work during renders. */
export const templateAuthoritySignature = researchTemplateAuthorityKey;
