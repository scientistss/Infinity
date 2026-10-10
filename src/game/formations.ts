import { unitById } from "../data/units";
import { selectPlanet } from "./empire";
import {
  FLYABLE_SHIP_IDS, MAX_FORMATIONS, MAX_FORMATION_AUTHORITY_KEY_LENGTH,
  hasFormationFields, immutableFormationOrigin, isFlyableShipId, normalizeFormationDraft,
  type CreateFormationRequest, type DeleteFormationRequest, type EditFormationRequest,
  type FleetFormation, type FormationAction, type FormationPreviewRequest, type FormationPreviewRow,
  type FormationReplenishmentLine, type FormationReplenishmentPreview, type FormationReplenishmentRequest, type FormationResult,
} from "./formation-state";
import { isOrderMoney, quoteOrderMoney, zeroOrderMoney } from "./order-ledger";
import { addOrderAmounts, compareOrderAmounts, multiplyOrderAmountInteger, normalizeOrderAmount } from "./order-money";
import { MAX_LIVE_ORDER_TASKS, MAX_ORDER_TASKS, type OrderMoney, type OrderTask } from "./order-state";
import { createOrderTask } from "./orders";
import { SHIPYARD, shipOutputCapacity, shipyardPausedReason, unitMissing } from "./shipyard";
import { unitCost } from "./unit-cost";
import { RESOURCE_IDS, type GameState } from "./types";

export type { FormationAction, FormationResult } from "./formation-state";
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const live = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const failure = (state: GameState, reason: string): FormationResult => ({ state, ok: false, reason, createdTaskIds: [] });
const success = (state: GameState, reason: string, createdTaskIds: number[] = []): FormationResult => ({ state, ok: true, reason, createdTaskIds });
const moneyEqual = (a: OrderMoney, b: OrderMoney): boolean => RESOURCE_IDS.every(id => compareOrderAmounts(a[id], b[id]) === 0);
function normalizedMoney(value: OrderMoney): OrderMoney { return { metal: normalizeOrderAmount(value.metal)!, crystal: normalizeOrderAmount(value.crystal)!, deuterium: normalizeOrderAmount(value.deuterium)! }; }

export function createFormation(state: GameState, request: CreateFormationRequest): FormationResult {
  if (!hasFormationFields(request, ["expectedNextFormationId", "name", "ships"])) return failure(state, "编成操作包含未知字段");
  const draft = normalizeFormationDraft({ name: request.name, ships: request.ships });
  if (!draft) return failure(state, "编成名称或数量无效；名称限 64 个字符，只能填写可飞舰船且每种不超过 1,000,000");
  if (!validId(request.expectedNextFormationId) || request.expectedNextFormationId !== state.formations.nextFormationId) return failure(state, "编成表单已使用或过期，或编号已耗尽");
  if (state.formations.entries.length >= MAX_FORMATIONS) return failure(state, "命名编成最多 32 个");
  const formation: FleetFormation = { id: request.expectedNextFormationId, revision: 1, ...draft };
  return success({ ...state, formations: { nextFormationId: formation.id + 1, entries: [...state.formations.entries, formation] } }, "编成已保存；只记录舰船数量，不会出航或付款");
}
export function editFormation(state: GameState, request: EditFormationRequest): FormationResult {
  if (!hasFormationFields(request, ["formationId", "expectedRevision", "name", "ships"])) return failure(state, "编成操作包含未知字段");
  const formation = state.formations.entries.find(value => value.id === request.formationId);
  if (!validId(request.formationId) || !validRevision(request.expectedRevision) || !formation || formation.revision !== request.expectedRevision) return failure(state, "编成已更改或不存在，请重新打开");
  const draft = normalizeFormationDraft({ name: request.name, ships: request.ships });
  if (!draft) return failure(state, "编成名称或数量无效");
  if (draft.name === formation.name && JSON.stringify(draft.ships) === JSON.stringify(formation.ships)) return success(state, "编成内容未改变");
  if (formation.revision >= Number.MAX_SAFE_INTEGER) return failure(state, "编成修订号已耗尽，请另建编成");
  const edited: FleetFormation = { id: formation.id, revision: formation.revision + 1, ...draft };
  return success({ ...state, formations: { ...state.formations, entries: state.formations.entries.map(value => value.id === edited.id ? edited : value) } }, "编成已更新；已有补船计划保留创建时的数量、预算和版本");
}
export function deleteFormation(state: GameState, request: DeleteFormationRequest): FormationResult {
  if (!hasFormationFields(request, ["formationId", "expectedRevision"])) return failure(state, "编成操作包含未知字段");
  const formation = state.formations.entries.find(value => value.id === request.formationId);
  if (!validId(request.formationId) || !validRevision(request.expectedRevision) || !formation || formation.revision !== request.expectedRevision) return failure(state, "编成已更改或不存在，请重新打开");
  const references = state.orders.tasks.filter(task => task.formationOrigin?.formation.id === formation.id);
  if (references.length) return failure(state, `编成仍被计划 ${references.map(task => `#${task.id}`).join("、")} 引用；请先结束并移除这些记录`);
  return success({ ...state, formations: { ...state.formations, entries: state.formations.entries.filter(value => value.id !== formation.id) } }, "未引用编成已删除");
}
function capacityReason(state: GameState, count: number): string {
  if (state.orders.tasks.length + count > MAX_ORDER_TASKS) return "计划记录容量不足，请先移除已结束记录";
  if (state.orders.tasks.filter(live).length + count > MAX_LIVE_ORDER_TASKS) return "未结束计划容量不足，最多 32 项";
  if (!validId(state.orders.nextTaskId) || count > Number.MAX_SAFE_INTEGER - state.orders.nextTaskId) return "计划编号余量不足，无法完整创建这组计划";
  return "";
}
function fixedBudget(cost: OrderMoney, count: number): OrderMoney | null {
  const budget = zeroOrderMoney();
  for (const id of RESOURCE_IDS) {
    const amount = multiplyOrderAmountInteger(cost[id], count);
    if (amount === null) return null;
    budget[id] = amount;
  }
  return budget;
}
interface Mapping { formation: FleetFormation | null; rows: FormationPreviewRow[]; lines: FormationReplenishmentLine[]; totalBudget: OrderMoney | null; reason: string }
/** Counts only real local inventory and the remaining units in real, already-paid queues. */
function mapFormation(state: GameState, formationId: number, planetId: string, warnings: boolean): Mapping {
  const formation = state.formations.entries.find(value => value.id === formationId) ?? null;
  const planet = state.planets.find(value => value.id === planetId);
  const base: Mapping = { formation, rows: [], lines: [], totalBudget: zeroOrderMoney(), reason: "" };
  if (!validId(formationId) || !formation) return { ...base, reason: "编成不存在" };
  if (typeof planetId !== "string" || !planet) return { ...base, reason: "请选择实际付款和执行星球" };
  const local = warnings ? selectPlanet(state, planetId) : null;
  for (const unit of FLYABLE_SHIP_IDS) {
    const target = formation.ships[unit];
    if (target === undefined) continue;
    const localStock = planet.units[unit];
    let paidQueueRemaining = 0;
    for (const job of planet.shipyardQueue) {
      if (job.unit !== unit) continue;
      if (!Number.isSafeInteger(job.count) || job.count < 1 || job.count > Number.MAX_SAFE_INTEGER - paidQueueRemaining) return { ...base, reason: "已付费队列数量无效" };
      paidQueueRemaining += job.count;
    }
    if (!Number.isSafeInteger(localStock) || localStock < 0) return { ...base, reason: "本地舰船数量无效" };
    const deficit = Math.max(0, target - localStock - paidQueueRemaining);
    const rawPrice = quoteOrderMoney(unitCost(unitById(unit)));
    const quotedUnitCost = rawPrice && normalizedMoney(rawPrice);
    const budget = quotedUnitCost && fixedBudget(quotedUnitCost, deficit);
    const conflictingTaskIds = deficit ? state.orders.tasks.filter(task => task.kind === "shipyard" && task.planetId === planetId && task.unit === unit && live(task)).map(task => task.id) : [];
    const rowWarnings: string[] = [];
    if (local && deficit) {
      const missing = unitMissing(local, unit);
      if (missing.length) rowWarnings.push(`需要 ${missing.join("、")}`);
      if (planet.buildings.shipyard < 1 && !missing.length) rowWarnings.push("需要造船厂 等级 1");
      const paused = shipyardPausedReason(local);
      if (paused) rowWarnings.push(paused);
      if (planet.shipyardQueue.length >= SHIPYARD.maxOrders) rowWarnings.push("已付费造船队列已满，等待空位");
      if (shipOutputCapacity(local, unit) < deficit) rowWarnings.push("舰船安全容量不足，付款时仍计入在途舰船并按真实容量等待");
    }
    base.rows.push({ unit, target, localStock, paidQueueRemaining, deficit, quotedUnitCost, budget, conflictingTaskIds, warnings: rowWarnings });
    if (!deficit) continue;
    if (!quotedUnitCost || !budget) { base.reason ||= "补船金额无法精确表示"; base.totalBudget = null; continue; }
    base.lines.push({ unit, quantity: deficit, quotedUnitCost: { ...quotedUnitCost }, budget: { ...budget } });
    if (base.totalBudget) for (const id of RESOURCE_IDS) {
      const total = addOrderAmounts(base.totalBudget[id], budget[id]);
      if (total === null) { base.totalBudget = null; base.reason ||= "补船总预算超过安全范围"; break; }
      base.totalBudget[id] = total;
    }
    if (conflictingTaskIds.length) base.reason ||= `${unitById(unit).nameZh} 已有未结束计划 ${conflictingTaskIds.map(id => `#${id}`).join("、")}，整组未创建`;
  }
  if (base.lines.length) base.reason ||= capacityReason(state, base.lines.length);
  return base;
}
/** Shared cheap bounded UI/commit key. No BigNumber, exact multiplication, or new quote on render. */
export function formationAuthorityKey(state: GameState, formationId: number, planetId: string): string {
  const formation = state.formations.entries.find(value => value.id === formationId);
  const planet = state.planets.find(value => value.id === planetId);
  if (!formation || !planet) return "";
  const lines: Array<{ unit: string; quantity: number; catalogPrice: number[]; conflicts: number[] }> = [];
  for (const unit of FLYABLE_SHIP_IDS) {
    const target = formation.ships[unit];
    if (target === undefined) continue;
    let paid = 0;
    for (const job of planet.shipyardQueue) if (job.unit === unit) {
      if (!Number.isSafeInteger(job.count) || job.count < 1 || job.count > Number.MAX_SAFE_INTEGER - paid) return "";
      paid += job.count;
    }
    if (!Number.isSafeInteger(planet.units[unit]) || planet.units[unit] < 0) return "";
    const quantity = Math.max(0, target - planet.units[unit] - paid);
    if (!quantity) continue;
    const cost = unitById(unit).cost;
    lines.push({ unit, quantity, catalogPrice: RESOURCE_IDS.map(id => cost[id]),
      conflicts: state.orders.tasks.filter(task => task.kind === "shipyard" && task.planetId === planetId && task.unit === unit && live(task)).map(task => task.id) });
  }
  // Completion transfers queue into stock without changing authority. Wallets, countdowns,
  // warnings, stock/queue splits, and flight history cannot renew or revoke the same fixed quote.
  const key = JSON.stringify({ version: 1, world: { universe: state.universe, launches: state.stats.launches }, formation,
    payer: { id: planet.id, coordinates: planet.coordinates }, nextTaskId: state.orders.nextTaskId,
    lines, blocker: lines.length ? capacityReason(state, lines.length) : "" });
  return key.length <= MAX_FORMATION_AUTHORITY_KEY_LENGTH ? key : "";
}
export function previewFormationReplenishment(state: GameState, request: FormationPreviewRequest): FormationReplenishmentPreview {
  if (!hasFormationFields(request, ["formationId", "formationRevision", "planetId"]) || !validRevision(request.formationRevision)) return { ok: false, reason: "补船预览参数无效", rows: [], request: null };
  const mapping = mapFormation(state, request.formationId, request.planetId, true);
  if (mapping.formation && mapping.formation.revision !== request.formationRevision) return { ok: false, reason: "编成版本已更改，请重新选择", rows: mapping.rows, request: null };
  if (mapping.reason || !mapping.totalBudget) return { ok: false, reason: mapping.reason || "补船金额无效", rows: mapping.rows, request: null };
  if (!mapping.lines.length) return { ok: true, reason: "本星球现货与已付款待造已覆盖目标，无需补船", rows: mapping.rows, request: null };
  const expectedAuthorityKey = formationAuthorityKey(state, request.formationId, request.planetId);
  if (!expectedAuthorityKey) return { ok: false, reason: "补船核对内容超过安全范围", rows: mapping.rows, request: null };
  return { ok: true, reason: "仅创建本次缺额的有限计划；不立即付款，在途舰船不抵扣", rows: mapping.rows,
    request: { ...request, expectedNextTaskId: state.orders.nextTaskId, expectedAuthorityKey, lines: mapping.lines, totalBudget: mapping.totalBudget } };
}
function validRequest(request: unknown): request is FormationReplenishmentRequest {
  if (!hasFormationFields(request, ["formationId", "formationRevision", "planetId", "expectedNextTaskId", "expectedAuthorityKey", "lines", "totalBudget"])
    || !validId(request.formationId) || !validRevision(request.formationRevision) || typeof request.planetId !== "string" || request.planetId.length > 128
    || !validId(request.expectedNextTaskId) || typeof request.expectedAuthorityKey !== "string" || request.expectedAuthorityKey.length < 1 || request.expectedAuthorityKey.length > MAX_FORMATION_AUTHORITY_KEY_LENGTH
    || !Array.isArray(request.lines) || request.lines.length < 1 || request.lines.length > FLYABLE_SHIP_IDS.length
    || !hasFormationFields(request.totalBudget, RESOURCE_IDS) || !isOrderMoney(request.totalBudget)) return false;
  let previous = -1;
  for (const line of request.lines) {
    if (!hasFormationFields(line, ["unit", "quantity", "quotedUnitCost", "budget"]) || !isFlyableShipId(line.unit)
      || typeof line.quantity !== "number" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1_000_000
      || !hasFormationFields(line.quotedUnitCost, RESOURCE_IDS) || !isOrderMoney(line.quotedUnitCost)
      || !hasFormationFields(line.budget, RESOURCE_IDS) || !isOrderMoney(line.budget)) return false;
    const index = FLYABLE_SHIP_IDS.indexOf(line.unit);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}
export function createFormationReplenishment(state: GameState, request: FormationReplenishmentRequest): FormationResult {
  if (!validRequest(request)) return failure(state, "补船核对内容无效或包含未知授权字段");
  if (request.expectedNextTaskId !== state.orders.nextTaskId) return failure(state, "补船核对已使用或过期，请重新预览");
  const preview = previewFormationReplenishment(state, { formationId: request.formationId, formationRevision: request.formationRevision, planetId: request.planetId });
  const current = preview.request;
  if (!preview.ok || !current) return failure(state, preview.reason);
  if (current.expectedAuthorityKey !== request.expectedAuthorityKey || current.lines.length !== request.lines.length
    || !moneyEqual(current.totalBudget, request.totalBudget) || current.lines.some((line, index) => {
      const reviewed = request.lines[index]!;
      return line.unit !== reviewed.unit || line.quantity !== reviewed.quantity || !moneyEqual(line.quotedUnitCost, reviewed.quotedUnitCost) || !moneyEqual(line.budget, reviewed.budget);
    })) return failure(state, "缺额、价格或编成已变化，请重新预览补船");
  const formation = state.formations.entries.find(value => value.id === request.formationId)!;
  let candidate = state;
  const createdTaskIds: number[] = [];
  for (const line of current.lines) {
    const id = candidate.orders.nextTaskId;
    const result = createOrderTask(candidate, { kind: "shipyard", planetId: request.planetId, unit: line.unit, quantity: line.quantity,
      expectedNextTaskId: id, budget: line.budget, transport: null });
    if (!result.ok) return failure(state, result.reason);
    const origin = immutableFormationOrigin(formation, line.quotedUnitCost);
    candidate = { ...result.state, orders: { ...result.state.orders, tasks: result.state.orders.tasks.map(task => task.id === id ? { ...task, formationOrigin: origin } : task) } };
    createdTaskIds.push(id);
  }
  return success(candidate, `已创建 ${createdTaskIds.length} 个有限补船计划；固定数量不会因出航、战损或队列取消而增加`, createdTaskIds);
}
export function applyFormationAction(state: GameState, action: FormationAction): FormationResult {
  if (!action || typeof action !== "object") return failure(state, "编成操作无效");
  switch (action.type) {
    case "formation-create": {
      if (!hasFormationFields(action, ["type", "expectedNextFormationId", "name", "ships"])) return failure(state, "编成操作包含未知字段");
      return createFormation(state, { expectedNextFormationId: action.expectedNextFormationId, name: action.name, ships: action.ships });
    }
    case "formation-edit": {
      if (!hasFormationFields(action, ["type", "formationId", "expectedRevision", "name", "ships"])) return failure(state, "编成操作包含未知字段");
      return editFormation(state, { formationId: action.formationId, expectedRevision: action.expectedRevision, name: action.name, ships: action.ships });
    }
    case "formation-delete": {
      if (!hasFormationFields(action, ["type", "formationId", "expectedRevision"])) return failure(state, "编成操作包含未知字段");
      return deleteFormation(state, { formationId: action.formationId, expectedRevision: action.expectedRevision });
    }
    case "formation-replenish": return hasFormationFields(action, ["type", "request"]) ? createFormationReplenishment(state, action.request) : failure(state, "编成操作包含未知字段");
    default: return failure(state, "编成操作无效");
  }
}
