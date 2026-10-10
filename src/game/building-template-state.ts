import { BUILDING_IDS, isBuildingId, type BuildingId } from "../data/buildings";
import { MAX_ORDER_LEVEL, type OrderMoney, type OrderTask } from "./order-state";
import type { GameState } from "./types";

export const MAX_BUILDING_TEMPLATES = 32;
export const MAX_BUILDING_TEMPLATE_GOALS = 16;
export const MAX_BUILDING_TEMPLATE_NAME_LENGTH = 64;
export const MAX_BUILDING_TEMPLATE_LEVEL = MAX_ORDER_LEVEL;
export const MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH = 131_072;

/** Saved intent only. No payer, money, task ownership, or execution authorization lives here. */
export interface BuildingGoal { building: BuildingId; targetLevel: number }
export interface BuildingTemplate { id: number; revision: number; name: string; goals: BuildingGoal[] }
export interface BuildingTemplateState { nextTemplateId: number; templates: BuildingTemplate[] }
export interface BuildingTemplateDraft { name: string; goals: BuildingGoal[] }
export type TemplateDraft = BuildingTemplateDraft;
export interface BuildingTemplateApplyRequest {
  templateId: number;
  expectedTemplateRevision: number;
  planetId: string;
  expectedNextTaskId: number;
  expectedReviewKey: string;
  budgets: Array<{ building: BuildingId; budget: OrderMoney }>;
}
export type TemplateApplyRequest = BuildingTemplateApplyRequest;
export interface BuildingTemplateResult {
  state: GameState;
  ok: boolean;
  reason: string;
  createdTaskIds: number[];
}
export type BuildingTemplateAction =
  | { type: "building-template-create"; draft: BuildingTemplateDraft; expectedNextTemplateId: number }
  | { type: "building-template-edit"; templateId: number; expectedTemplateRevision: number; draft: BuildingTemplateDraft }
  | { type: "building-template-delete"; templateId: number; expectedTemplateRevision: number }
  | { type: "building-template-apply"; request: BuildingTemplateApplyRequest };

export type BuildingTemplateRowStatus = "achieved" | "covered" | "conflict" | "new";
export type BuildingTemplateExistingTask = Pick<Extract<OrderTask, { kind: "building" }>,
  "id" | "status" | "building" | "targetLevel" | "planetId" | "budget" | "charged" | "refunded" | "reason"> & { hasTransport: boolean };
export interface BuildingTemplatePaidJob {
  jobId: number;
  taskId: number | null;
  planetId: string;
  targetLevel: number;
  source: "manual" | "protocol" | "plan";
  paid: OrderMoney;
}
export interface BuildingTemplateRow extends BuildingGoal {
  status: BuildingTemplateRowStatus;
  currentLevel: number;
  nextUnpaidLevel: number;
  existingTask: BuildingTemplateExistingTask | null;
  paidJobs: BuildingTemplatePaidJob[];
  /** Display-only waiting conditions. These do not prevent saving or authorizing a finite plan. */
  warnings: string[];
}
export interface BuildingTemplateQuoteRow extends BuildingTemplateRow {
  /** Additional unpaid resources, zero for achieved/covered rows; null if not representable. */
  quote: OrderMoney | null;
}
export interface BuildingTemplateMapping {
  ok: boolean;
  reason: string;
  templateId: number;
  templateRevision: number;
  planetId: string;
  rows: BuildingTemplateRow[];
  newCount: number;
  blockers: string[];
}
export interface BuildingTemplateQuote extends Omit<BuildingTemplateMapping, "rows"> {
  rows: BuildingTemplateQuoteRow[];
  nextTaskId: number;
  reviewKey: string;
  totalQuote: OrderMoney | null;
}

export function createBuildingTemplateState(): BuildingTemplateState { return { nextTemplateId: 1, templates: [] }; }

/** Shared by the action boundary and strict save reader. Reject unknown authorization fields. */
export function hasBuildingTemplateFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key));
}
export function normalizeBuildingTemplateDraft(value: unknown): BuildingTemplateDraft | null {
  if (!hasBuildingTemplateFields(value, ["name", "goals"]) || typeof value.name !== "string") return null;
  // Bound raw text before Unicode iteration. A valid trimmed name uses at most 128 UTF-16 units.
  if (value.name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) return null;
  const name = value.name.trim();
  if (!name || Array.from(name).length > MAX_BUILDING_TEMPLATE_NAME_LENGTH) return null;
  if (!Array.isArray(value.goals) || value.goals.length < 1 || value.goals.length > MAX_BUILDING_TEMPLATE_GOALS) return null;
  const goals: BuildingGoal[] = [];
  const seen = new Set<BuildingId>();
  for (const goal of value.goals) {
    if (!hasBuildingTemplateFields(goal, ["building", "targetLevel"]) || typeof goal.building !== "string" || !isBuildingId(goal.building)
      || typeof goal.targetLevel !== "number" || !Number.isSafeInteger(goal.targetLevel) || goal.targetLevel < 1 || goal.targetLevel > MAX_BUILDING_TEMPLATE_LEVEL || seen.has(goal.building)) return null;
    seen.add(goal.building);
    goals.push({ building: goal.building, targetLevel: goal.targetLevel });
  }
  goals.sort((a, b) => BUILDING_IDS.indexOf(a.building) - BUILDING_IDS.indexOf(b.building));
  return { name, goals };
}
