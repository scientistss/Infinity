import { isBuildingId, type BuildingId } from "../data/buildings";
import { MAX_BUILDING_TEMPLATE_GOALS, MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH, type BuildingTemplateQuote } from "./building-template-state";
import { normalizeOrderAmount } from "./order-money";
import type { OrderMoney } from "./order-state";
import { RESOURCE_IDS } from "./types";

export const MIN_BUILDING_TEMPLATE_BATCH_PLANETS = 2;
export const MAX_BUILDING_TEMPLATE_BATCH_PLANETS = 4;
export const MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH = MAX_BUILDING_TEMPLATE_BATCH_PLANETS * MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH;

/** Ephemeral authorization only. The save contains ordinary independent leaf orders. */
export interface BuildingTemplateBatchRequest {
  templateId: number;
  expectedTemplateRevision: number;
  expectedNextTaskId: number;
  expectedReviewKey: string;
  planets: Array<{ planetId: string; budgets: Array<{ building: BuildingId; budget: OrderMoney }> }>;
}
export interface BuildingTemplateBatchQuote {
  ok: boolean;
  reason: string;
  templateId: number;
  templateRevision: number;
  nextTaskId: number;
  reviewKey: string;
  authorityKey: string;
  planets: Array<{ planetId: string; quote: BuildingTemplateQuote }>;
  newCount: number;
  /** Display-only sum. It never pools wallets or authorizes a shared budget. */
  totalQuote: OrderMoney | null;
  blockers: string[];
}
export type BuildingTemplateBatchAction = { type: "building-template-batch-apply"; request: BuildingTemplateBatchRequest };

/** Inspect data descriptors before reading any values; accessors are never authorization. */
export function hasBuildingTemplateBatchFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    if (typeof key !== "string" || !fields.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && "value" in descriptor && descriptor.enumerable === true;
  });
}

function boundedArray(value: unknown, minimum: number, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) return false;
  if (Reflect.ownKeys(value).length !== length + 1) return false;
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return false;
  }
  return true;
}
const planetIdValid = (value: unknown): value is string => typeof value === "string" && value.length <= 64 && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const positiveSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Preserve explicit selection order; it determines the ordered, reviewed task IDs. */
export function normalizeBuildingTemplateBatchPlanetIds(value: unknown): string[] | null {
  try {
    if (!boundedArray(value, MIN_BUILDING_TEMPLATE_BATCH_PLANETS, MAX_BUILDING_TEMPLATE_BATCH_PLANETS)) return null;
    const ids: string[] = [];
    for (const id of value) {
      if (!planetIdValid(id) || ids.includes(id)) return null;
      ids.push(id);
    }
    return ids;
  } catch { return null; }
}

/** Bounded detached snapshot; no unknown, inherited, sparse or accessor-bearing inputs. */
export function normalizeBuildingTemplateBatchRequest(value: unknown): BuildingTemplateBatchRequest | null {
  try {
    if (!hasBuildingTemplateBatchFields(value, ["templateId", "expectedTemplateRevision", "expectedNextTaskId", "expectedReviewKey", "planets"])
      || !positiveSafeInteger(value.templateId) || value.templateId >= Number.MAX_SAFE_INTEGER
      || !positiveSafeInteger(value.expectedTemplateRevision) || !positiveSafeInteger(value.expectedNextTaskId)
      || typeof value.expectedReviewKey !== "string" || !value.expectedReviewKey || value.expectedReviewKey.length > MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH
      || !boundedArray(value.planets, MIN_BUILDING_TEMPLATE_BATCH_PLANETS, MAX_BUILDING_TEMPLATE_BATCH_PLANETS)) return null;
    const planets: BuildingTemplateBatchRequest["planets"] = [];
    for (const entry of value.planets) {
      if (!hasBuildingTemplateBatchFields(entry, ["planetId", "budgets"]) || !planetIdValid(entry.planetId)
        || planets.some(planet => planet.planetId === entry.planetId) || !boundedArray(entry.budgets, 0, MAX_BUILDING_TEMPLATE_GOALS)) return null;
      const budgets: BuildingTemplateBatchRequest["planets"][number]["budgets"] = [];
      for (const row of entry.budgets) {
        if (!hasBuildingTemplateBatchFields(row, ["building", "budget"]) || typeof row.building !== "string" || !isBuildingId(row.building)
          || budgets.some(budget => budget.building === row.building) || !hasBuildingTemplateBatchFields(row.budget, RESOURCE_IDS)
          || typeof row.budget.metal !== "string" || typeof row.budget.crystal !== "string" || typeof row.budget.deuterium !== "string") return null;
        const metal = normalizeOrderAmount(row.budget.metal), crystal = normalizeOrderAmount(row.budget.crystal), deuterium = normalizeOrderAmount(row.budget.deuterium);
        if (metal === null || crystal === null || deuterium === null) return null;
        budgets.push({ building: row.building, budget: { metal, crystal, deuterium } });
      }
      planets.push({ planetId: entry.planetId, budgets });
    }
    return { templateId: value.templateId, expectedTemplateRevision: value.expectedTemplateRevision, expectedNextTaskId: value.expectedNextTaskId,
      expectedReviewKey: value.expectedReviewKey, planets };
  } catch { return null; }
}
