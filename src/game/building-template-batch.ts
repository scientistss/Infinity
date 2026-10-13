import {
  MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH, hasBuildingTemplateBatchFields,
  normalizeBuildingTemplateBatchPlanetIds, normalizeBuildingTemplateBatchRequest,
  type BuildingTemplateBatchAction, type BuildingTemplateBatchQuote, type BuildingTemplateBatchRequest,
} from "./building-template-batch-state";
import type { BuildingTemplateResult } from "./building-template-state";
import { buildingTemplateAuthorityKey, mapBuildingTemplate, quoteBuildingTemplate } from "./building-templates";
import { zeroOrderMoney } from "./order-ledger";
import { addOrderAmounts } from "./order-money";
import { MAX_LIVE_ORDER_TASKS, MAX_ORDER_TASKS, type OrderMoney, type OrderTask } from "./order-state";
import { createOrderTask } from "./orders";
import { deserializeState, serializeState } from "./save";
import { RESOURCE_IDS, type GameState } from "./types";

export type { BuildingTemplateBatchAction, BuildingTemplateBatchQuote, BuildingTemplateBatchRequest } from "./building-template-batch-state";
const live = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const failure = (state: GameState, reason: string): BuildingTemplateResult => ({ state, ok: false, reason, createdTaskIds: [] });

function capacityBlocker(state: GameState, count: number): string {
  if (!count) return "";
  if (state.orders.tasks.length + count > MAX_ORDER_TASKS) return "整批计划记录容量不足，请先移除已结束记录";
  if (state.orders.tasks.filter(live).length + count > MAX_LIVE_ORDER_TASKS) return "整批未结束计划容量不足，最多 32 项";
  if (!validId(state.orders.nextTaskId) || count > Number.MAX_SAFE_INTEGER - state.orders.nextTaskId) return "计划编号余量不足，无法完整创建整批计划";
  return "";
}

/** Length framing avoids nested JSON escaping and binds the explicit selection order. */
function joinedKey(kind: "authority" | "review", parts: string[]): string {
  if (parts.some(part => !part)) return "";
  const key = `building-template-batch:${kind}:1:${parts.length}:` + parts.map(part => `${part.length}:${part}`).join("");
  return key.length <= MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH ? key : "";
}
function actualSelection(state: GameState, templateId: number, planetIds: string[]): boolean {
  return validId(templateId) && state.buildingTemplates.templates.some(template => template.id === templateId)
    && planetIds.every(id => state.planets.filter(planet => planet.id === id).length === 1);
}

/** Cheap retirement key, with exactly the existing single-planet authority semantics. */
export function buildingTemplateBatchAuthorityKey(state: GameState, templateId: number, planetIds: readonly string[]): string {
  const ids = normalizeBuildingTemplateBatchPlanetIds(planetIds);
  if (!ids || !actualSelection(state, templateId, ids)) return "";
  return joinedKey("authority", ids.map(id => buildingTemplateAuthorityKey(state, templateId, id)));
}

function summedQuote(planets: BuildingTemplateBatchQuote["planets"]): OrderMoney | null {
  const total = zeroOrderMoney();
  for (const { quote } of planets) {
    if (!quote.totalQuote) return null;
    for (const resource of RESOURCE_IDS) {
      const amount = addOrderAmounts(total[resource], quote.totalQuote[resource]);
      if (amount === null) return null;
      total[resource] = amount;
    }
  }
  return total;
}

/** Explicit review only. All local quotes see the same unchanged source snapshot. */
export function quoteBuildingTemplateBatch(state: GameState, templateId: number, planetIds: readonly string[]): BuildingTemplateBatchQuote {
  const ids = normalizeBuildingTemplateBatchPlanetIds(planetIds);
  const base: BuildingTemplateBatchQuote = { ok: false, reason: "请明确选择 2–4 颗互异的实际执行和付款星球", templateId,
    templateRevision: state.buildingTemplates.templates.find(template => template.id === templateId)?.revision ?? 0,
    nextTaskId: state.orders.nextTaskId, reviewKey: "", authorityKey: "", planets: [], newCount: 0, totalQuote: null, blockers: [] };
  if (!ids || !actualSelection(state, templateId, ids)) {
    const reason = validId(templateId) && base.templateRevision ? base.reason : "建造模板不存在";
    return { ...base, reason, blockers: [reason] };
  }
  const planets = ids.map(planetId => ({ planetId, quote: quoteBuildingTemplate(state, templateId, planetId) }));
  // A leaf quote intentionally has ok=false for an achieved/covered-only planet.
  // Its empty blockers and nonempty review key still make it valid batch intent.
  const blockers = planets.flatMap(({ planetId, quote }) => quote.blockers.map(reason => `${planetId}：${reason}`));
  const newCount = planets.reduce((sum, { quote }) => sum + quote.newCount, 0);
  const capacity = capacityBlocker(state, newCount);
  if (capacity) blockers.push(capacity);
  const totalQuote = summedQuote(planets);
  if (totalQuote === null && planets.every(({ quote }) => quote.totalQuote !== null)) blockers.push("整批合计报价超出精确金额范围，请减少目标或星球");
  const authorityKey = buildingTemplateBatchAuthorityKey(state, templateId, ids);
  const reviewKey = joinedKey("review", planets.map(({ quote }) => quote.reviewKey));
  if (!authorityKey || !reviewKey) blockers.push("整批核对快照超过安全范围，无法应用");
  return { ...base, planets, newCount, totalQuote, authorityKey, reviewKey, blockers, ok: blockers.length === 0,
    reason: blockers[0] ?? (newCount ? "请核对各星球的独立预算；整批确认仅创建有限计划，不会立即支付" : "所有星球的目标均已达到或有计划覆盖；本次无需创建计划") };
}

export function applyBuildingTemplateBatch(state: GameState, input: BuildingTemplateBatchRequest): BuildingTemplateResult {
  const request = normalizeBuildingTemplateBatchRequest(input);
  if (!request) return failure(state, "整批应用核对已过期或请求无效，请重新核对");
  // Scan the untouched source before even reading its counter or mapping goals.
  // The existing serializer rejects accessors through data descriptors, so a
  // malformed source cannot mutate its own wallet or UI selection during review.
  try { serializeState(state); }
  catch { return failure(state, "原存档未通过完整性检查；没有创建计划，请重新核对"); }
  if (request.expectedNextTaskId !== state.orders.nextTaskId) return failure(state, "整批应用核对已过期或请求无效，请重新核对");
  const template = state.buildingTemplates.templates.find(value => value.id === request.templateId);
  if (!template || template.revision !== request.expectedTemplateRevision) return failure(state, "模板已更改或删除，请重新核对");
  const planetIds = request.planets.map(planet => planet.planetId);
  if (!actualSelection(state, request.templateId, planetIds)) return failure(state, "所选执行和付款星球已不存在或身份不唯一，请重新核对");
  const mappings = request.planets.map(planet => ({ ...planet, mapping: mapBuildingTemplate(state, request.templateId, planet.planetId) }));
  for (const { planetId, budgets, mapping } of mappings) {
    if (!mapping.ok) return failure(state, `${planetId}：${mapping.reason}`);
    const rows = mapping.rows.filter(row => row.status === "new");
    if (budgets.length !== rows.length || budgets.some(entry => !rows.some(row => row.building === entry.building))) {
      return failure(state, `${planetId}：独立预算必须恰好覆盖本星所有新增目标，不可缺少或多出项目`);
    }
  }
  const capacity = capacityBlocker(state, mappings.reduce((sum, { mapping }) => sum + mapping.newCount, 0));
  if (capacity) return failure(state, capacity);
  const quote = quoteBuildingTemplateBatch(state, request.templateId, planetIds);
  if (!quote.ok) return failure(state, quote.reason);
  if (quote.reviewKey !== request.expectedReviewKey) return failure(state, "模板、星球、建造队列或计划已变化，请重新核对整批授权");

  // Preflight above never advances the shared task counter. Only this private
  // candidate may allocate leaf IDs; a failed suffix can never publish a prefix.
  let candidate = state;
  const createdTaskIds: number[] = [];
  try {
    for (const { planetId, budgets, mapping } of mappings) {
      for (const row of mapping.rows) {
        if (row.status !== "new") continue;
        const id = candidate.orders.nextTaskId;
        const result = createOrderTask(candidate, { kind: "building", planetId, building: row.building, targetLevel: row.targetLevel,
          budget: budgets.find(entry => entry.building === row.building)!.budget, expectedNextTaskId: id, transport: null });
        if (!result.ok) return failure(state, result.reason);
        candidate = result.state;
        createdTaskIds.push(id);
      }
    }
    // Strict current-save validation is required even for a successful no-op.
    // Keep the candidate itself so paid jobs, old orders and display markers retain
    // their original identity; do not accept a reader-normalized replacement.
    deserializeState(serializeState(candidate));
  } catch { return failure(state, "整批计划未通过存档完整性检查；没有创建计划，请重新核对"); }
  return { state: candidate, ok: true, createdTaskIds, reason: createdTaskIds.length
    ? `已为 ${request.planets.length} 颗星球创建 ${createdTaskIds.length} 个独立有限建造计划；尚未支付资源`
    : "所有目标均已达到或有计划覆盖；未创建计划、未消耗编号或支付资源" };
}

/** Strict envelope for dispatchers; unknown or accessor-bearing actions are inert. */
export function applyBuildingTemplateBatchAction(state: GameState, action: BuildingTemplateBatchAction): BuildingTemplateResult {
  try {
    return hasBuildingTemplateBatchFields(action, ["type", "request"]) && action.type === "building-template-batch-apply"
      ? applyBuildingTemplateBatch(state, action.request) : failure(state, "整批模板操作无效或包含未知字段");
  } catch { return failure(state, "整批模板操作无效"); }
}
