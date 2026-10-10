import { RESEARCH_IDS, isResearchId, type ResearchId } from "../data/research";
import { MAX_ORDER_LEVEL, type OrderMoney, type OrderTask } from "./order-state";
import type { GameState } from "./types";

export const MAX_RESEARCH_TEMPLATES = 32;
export const MAX_RESEARCH_TEMPLATE_GOALS = 16;
export const MAX_RESEARCH_TEMPLATE_NAME_LENGTH = 64;
export const MAX_RESEARCH_TEMPLATE_LEVEL = MAX_ORDER_LEVEL;
export const MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH = 131_072;

/** Saved intent only. No payer, money, task ownership, or execution authorization lives here. */
export interface ResearchGoal { tech: ResearchId; targetLevel: number }
export interface ResearchTemplate { id: number; revision: number; name: string; goals: ResearchGoal[] }
export interface ResearchTemplateState { nextTemplateId: number; templates: ResearchTemplate[] }
export interface ResearchTemplateDraft { name: string; goals: ResearchGoal[] }
export type TemplateDraft = ResearchTemplateDraft;
export interface ResearchTemplateApplyRequest {
  templateId: number;
  expectedTemplateRevision: number;
  planetId: string;
  expectedNextTaskId: number;
  expectedReviewKey: string;
  budgets: Array<{ tech: ResearchId; budget: OrderMoney }>;
}
export type TemplateApplyRequest = ResearchTemplateApplyRequest;
export interface ResearchTemplateResult {
  state: GameState;
  ok: boolean;
  reason: string;
  createdTaskIds: number[];
}
export type ResearchTemplateAction =
  | { type: "research-template-create"; draft: ResearchTemplateDraft; expectedNextTemplateId: number }
  | { type: "research-template-edit"; templateId: number; expectedTemplateRevision: number; draft: ResearchTemplateDraft }
  | { type: "research-template-delete"; templateId: number; expectedTemplateRevision: number }
  | { type: "research-template-apply"; request: ResearchTemplateApplyRequest };

export type ResearchTemplateRowStatus = "achieved" | "covered" | "conflict" | "new";
export type ResearchTemplateExistingTask = Pick<Extract<OrderTask, { kind: "research" }>,
  "id" | "status" | "tech" | "targetLevel" | "planetId" | "budget" | "charged" | "refunded" | "reason"> & { hasTransport: boolean };
export interface ResearchTemplatePaidJob {
  jobId: number;
  taskId: number | null;
  planetId: string;
  targetLevel: number;
  source: "manual" | "protocol" | "plan";
  paid: OrderMoney;
}
export interface ResearchTemplateRow extends ResearchGoal {
  status: ResearchTemplateRowStatus;
  currentLevel: number;
  nextUnpaidLevel: number;
  existingTask: ResearchTemplateExistingTask | null;
  paidJobs: ResearchTemplatePaidJob[];
  /** Display-only waiting conditions. These do not prevent saving or authorizing a finite plan. */
  warnings: string[];
}
export interface ResearchTemplateQuoteRow extends ResearchTemplateRow {
  /** Additional unpaid resources, zero for achieved/covered rows; null if not representable. */
  quote: OrderMoney | null;
}
export interface ResearchTemplateMapping {
  ok: boolean;
  reason: string;
  templateId: number;
  templateRevision: number;
  planetId: string;
  rows: ResearchTemplateRow[];
  newCount: number;
  blockers: string[];
}
export interface ResearchTemplateQuote extends Omit<ResearchTemplateMapping, "rows"> {
  rows: ResearchTemplateQuoteRow[];
  nextTaskId: number;
  reviewKey: string;
  totalQuote: OrderMoney | null;
}

export function createResearchTemplateState(): ResearchTemplateState { return { nextTemplateId: 1, templates: [] }; }

/** Shared by the action boundary and strict save reader. Reject unknown authorization fields. */
export function hasResearchTemplateFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key));
}
export function normalizeResearchTemplateDraft(value: unknown): ResearchTemplateDraft | null {
  if (!hasResearchTemplateFields(value, ["name", "goals"]) || typeof value.name !== "string") return null;
  // Bound raw text before Unicode iteration. A valid trimmed name uses at most 128 UTF-16 units.
  if (value.name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) return null;
  const name = value.name.trim();
  if (!name || Array.from(name).length > MAX_RESEARCH_TEMPLATE_NAME_LENGTH) return null;
  if (!Array.isArray(value.goals) || value.goals.length < 1 || value.goals.length > MAX_RESEARCH_TEMPLATE_GOALS) return null;
  const goals: ResearchGoal[] = [];
  const seen = new Set<ResearchId>();
  for (const goal of value.goals) {
    if (!hasResearchTemplateFields(goal, ["tech", "targetLevel"]) || typeof goal.tech !== "string" || !isResearchId(goal.tech)
      || typeof goal.targetLevel !== "number" || !Number.isSafeInteger(goal.targetLevel) || goal.targetLevel < 1 || goal.targetLevel > MAX_RESEARCH_TEMPLATE_LEVEL || seen.has(goal.tech)) return null;
    seen.add(goal.tech);
    goals.push({ tech: goal.tech, targetLevel: goal.targetLevel });
  }
  goals.sort((a, b) => RESEARCH_IDS.indexOf(a.tech) - RESEARCH_IDS.indexOf(b.tech));
  return { name, goals };
}
