import { BUILDING_IDS, CURRENT_PHASE, buildingById, type BuildingId } from "../data/buildings";
import { RESEARCH_IDS } from "../data/research";
import { growthCut } from "../prestige/tree";
import { activePlanet, selectPlanet } from "./empire";
import { usedFields } from "./planet";
import { isOrderMoney, quoteOrderMoney, zeroOrderMoney } from "./order-ledger";
import { addOrderAmounts, normalizeOrderAmount } from "./order-money";
import { MAX_LIVE_ORDER_TASKS, MAX_ORDER_TASKS, type OrderMoney, type OrderTask } from "./order-state";
import { createOrderTask } from "./orders";
import { costFor, nextTargetLevel, queueCapacity } from "./queue";
import { deserializeState, serializeState } from "./save";
import {
  MAX_BUILDING_TEMPLATES, MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH,
  hasBuildingTemplateFields, normalizeBuildingTemplateDraft,
  type BuildingTemplateAction, type BuildingTemplateApplyRequest, type BuildingTemplateDraft,
  type BuildingTemplateExistingTask, type BuildingTemplateMapping, type BuildingTemplateQuote,
  type BuildingTemplateQuoteRow, type BuildingTemplateResult, type BuildingTemplateRow,
} from "./building-template-state";
import { missingRequirements } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";

export type { BuildingTemplateAction, BuildingTemplateResult } from "./building-template-state";
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const live = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const failure = (state: GameState, reason: string): BuildingTemplateResult => ({ state, ok: false, reason, createdTaskIds: [] });
const success = (state: GameState, reason: string, createdTaskIds: number[] = []): BuildingTemplateResult => ({ state, ok: true, reason, createdTaskIds });

export function createBuildingTemplate(state: GameState, draft: BuildingTemplateDraft, expectedNextTemplateId: number): BuildingTemplateResult {
  const normalized = normalizeBuildingTemplateDraft(draft);
  if (!normalized) return failure(state, "模板名称或目标无效；名称限 64 个字符，目标须互异且等级为 1–1000");
  if (!validId(expectedNextTemplateId) || expectedNextTemplateId !== state.buildingTemplates.nextTemplateId) return failure(state, "模板表单已使用或过期，或模板编号已耗尽");
  if (state.buildingTemplates.templates.length >= MAX_BUILDING_TEMPLATES) return failure(state, "建造模板最多 32 个");
  const template = { id: expectedNextTemplateId, revision: 1, ...normalized };
  return success({ ...state, buildingTemplates: { nextTemplateId: template.id + 1, templates: [...state.buildingTemplates.templates, template] } }, "建造意图已保存；尚未创建计划或支付资源");
}
export function editBuildingTemplate(state: GameState, templateId: number, expectedTemplateRevision: number, draft: BuildingTemplateDraft): BuildingTemplateResult {
  const template = state.buildingTemplates.templates.find(value => value.id === templateId);
  if (!validId(templateId) || !validRevision(expectedTemplateRevision) || !template || template.revision !== expectedTemplateRevision) return failure(state, "模板已更改或不存在，请重新打开");
  if (template.revision >= Number.MAX_SAFE_INTEGER) return failure(state, "模板修订号已耗尽，请新建模板");
  const normalized = normalizeBuildingTemplateDraft(draft);
  if (!normalized) return failure(state, "模板名称或目标无效；名称限 64 个字符，目标须互异且等级为 1–1000");
  const edited = { id: template.id, revision: template.revision + 1, ...normalized };
  return success({ ...state, buildingTemplates: { ...state.buildingTemplates, templates: state.buildingTemplates.templates.map(value => value.id === templateId ? edited : value) } }, "模板已更新；已有计划的目标、付款星球和预算保持原样");
}
export function deleteBuildingTemplate(state: GameState, templateId: number, expectedTemplateRevision: number): BuildingTemplateResult {
  const template = state.buildingTemplates.templates.find(value => value.id === templateId);
  if (!validId(templateId) || !validRevision(expectedTemplateRevision) || !template || template.revision !== expectedTemplateRevision) return failure(state, "模板已更改或不存在，请重新打开");
  return success({ ...state, buildingTemplates: { ...state.buildingTemplates, templates: state.buildingTemplates.templates.filter(value => value.id !== templateId) } }, "模板已删除；已有计划继续执行，可在计划列表单独管理");
}
function taskSnapshot(task: Extract<OrderTask, { kind: "building" }>): BuildingTemplateExistingTask {
  return { id: task.id, status: task.status, building: task.building, targetLevel: task.targetLevel, planetId: task.planetId,
    budget: { ...task.budget }, charged: { ...task.charged }, refunded: { ...task.refunded }, reason: task.reason, hasTransport: task.transport !== null };
}

/** Cheap bounded intent mapping, safe for display. It never sums future level prices. */
export function mapBuildingTemplate(state: GameState, templateId: number, planetId: string): BuildingTemplateMapping {
  const template = state.buildingTemplates.templates.find(value => value.id === templateId);
  const base = { templateId, templateRevision: template?.revision ?? 0, planetId, rows: [] as BuildingTemplateRow[], newCount: 0, blockers: [] as string[] };
  if (!validId(templateId) || !template) return { ...base, ok: false, reason: "建造模板不存在", blockers: ["建造模板不存在"] };
  if (typeof planetId !== "string" || !state.planets.some(value => value.id === planetId)) return { ...base, ok: false, reason: "请选择实际付款和执行星球", blockers: ["请选择实际付款和执行星球"] };
  const local = selectPlanet(state, planetId);
  const planet = activePlanet(local), capacity = queueCapacity(local);
  const used = usedFields(planet), reserved = planet.buildQueue.length;
  const full = reserved >= capacity ? `建造队列已满（${reserved}/${capacity}）` : "";
  const rows = template.goals.map((goal): BuildingTemplateRow => {
    const currentLevel = planet.buildings[goal.building], nextUnpaidLevel = nextTargetLevel(planet, goal.building);
    const activeTasks = state.orders.tasks.filter((task): task is Extract<OrderTask, { kind: "building" }> => task.kind === "building" && task.planetId === planetId && task.building === goal.building && live(task));
    const existing = activeTasks[0];
    const status = currentLevel >= goal.targetLevel ? "achieved" : existing ? existing.targetLevel >= goal.targetLevel && activeTasks.length === 1 ? "covered" : "conflict" : "new";
    const paidJobs = planet.buildQueue.filter(job => job.building === goal.building).map(job => ({ jobId: job.jobId, taskId: job.taskId, planetId, targetLevel: job.targetLevel, source: job.source,
      paid: { metal: job.paid.metal.toString(), crystal: job.paid.crystal.toString(), deuterium: job.paid.deuterium.toString() } }));
    const warnings: string[] = [];
    if (status === "new") {
      const def = buildingById(goal.building);
      if (def.phase > CURRENT_PHASE) warnings.push(`第 ${def.phase} 阶段开放`);
      const missing = missingRequirements(local, def.requires);
      if (missing.length) warnings.push(`需要 ${missing.join("、")}`);
      if (goal.building === "research_lab" && state.research.queue.length) warnings.push("研究进行中，研究实验室不能升级");
      if (full) warnings.push(full);
      if (used + reserved >= planet.fieldsMax) warnings.push(`星球格子已满（已用 ${used}，付费队列预留 ${reserved}，总计 ${planet.fieldsMax}）`);
      if (paidJobs.length) warnings.push("已有付费建造在先，等待真实完成；此次预算不认领原付款");
    } else if (status === "covered") warnings.push(`已有计划 #${existing!.id} 覆盖目标，保持原付款星球、预算和${existing!.status === "paused" ? "暂停" : "运行"}状态`);
    else if (status === "conflict") warnings.push("同建筑已有较低目标或冲突计划；请先在计划列表处理，模板不会替换原授权");
    return { ...goal, status, currentLevel, nextUnpaidLevel, existingTask: existing ? taskSnapshot(existing) : null, paidJobs, warnings };
  });
  // Every queued level already reserves one field. Warn for the whole batch, rather
  // than promising individually affordable goals that cannot all fit on this planet.
  const futureFields = rows.reduce((count, row) => count + (row.status === "new" || row.status === "covered"
    ? Math.max(0, Math.max(row.targetLevel, row.existingTask?.targetLevel ?? 0) - row.nextUnpaidLevel + 1) : 0), 0);
  if (futureFields > 0 && used + reserved + futureFields > planet.fieldsMax) {
    const warning = `整批目标还需 ${futureFields} 个格子；已用 ${used}、付费队列预留 ${reserved}、上限 ${planet.fieldsMax}，未来格子不足，计划会等待`;
    for (const row of rows) if (row.status === "new") row.warnings.push(warning);
  }
  const blockers = rows.filter(row => row.status === "conflict").map(row => `${buildingById(row.building).nameZh} 已有冲突计划，不能批量应用`);
  const newCount = rows.filter(row => row.status === "new").length;
  return { ...base, rows, newCount, blockers, ok: blockers.length === 0, reason: blockers[0] ?? (newCount ? "仅保存目标，不会自动建造；请明确预算后核对应用" : "目标均已达到或有计划覆盖，无需创建") };
}

function quoteUnpaidLevels(local: GameState, building: BuildingId, from: number, target: number): OrderMoney | null {
  const total = zeroOrderMoney();
  for (let level = from; level <= target; level += 1) {
    // Use the actual next-level formula and growth cut; never sum with Number or a geometric shortcut.
    const cost = quoteOrderMoney(costFor(local, building, level));
    if (!cost) return null;
    for (const resource of RESOURCE_IDS) {
      const amount = addOrderAmounts(total[resource], cost[resource]);
      if (amount === null) return null;
      total[resource] = amount;
    }
  }
  return total;
}
function summedQuote(rows: BuildingTemplateQuoteRow[]): OrderMoney | null {
  const total = zeroOrderMoney();
  for (const row of rows) {
    if (row.quote === null) return null;
    for (const resource of RESOURCE_IDS) {
      const amount = addOrderAmounts(total[resource], row.quote[resource]);
      if (amount === null) return null;
      total[resource] = amount;
    }
  }
  return total;
}
function capacityBlocker(state: GameState, count: number): string {
  if (state.orders.tasks.length + count > MAX_ORDER_TASKS) return "计划记录容量不足，请先移除已结束记录";
  if (state.orders.tasks.filter(live).length + count > MAX_LIVE_ORDER_TASKS) return "未结束计划容量不足，最多 32 项";
  // MAX_SAFE_INTEGER is an exhausted sentinel and can never be issued as a task ID.
  if (!validId(state.orders.nextTaskId) || count > Number.MAX_SAFE_INTEGER - state.orders.nextTaskId) return "计划编号余量不足，无法完整创建这批计划";
  return "";
}

/** Shared finite identity snapshot for UI retirement and explicit review; never prices future levels. */
export function buildingTemplateAuthorityKey(state: GameState, templateId: number, planetId: string): string {
  const mapping = mapBuildingTemplate(state, templateId, planetId);
  const template = state.buildingTemplates.templates.find(value => value.id === templateId);
  const payer = state.planets.find(value => value.id === planetId);
  // Bind meaningful authorization, never wallets, UI selection, countdowns or display reasons.
  // The local paid queue reserves fields even when its building is not a template goal.
  const relevantTasks = state.orders.tasks.filter(task => task.kind === "building" && task.planetId === planetId
    && template?.goals.some(goal => goal.building === task.building));
  const key = template && payer ? JSON.stringify({ version: 1, world: state.universe, worldLaunches: state.stats.launches,
    template: { id: template.id, revision: template.revision, name: template.name, goals: template.goals }, planetId, coordinates: payer.coordinates,
    nextTaskId: state.orders.nextTaskId, records: state.orders.tasks.length, liveTasks: state.orders.tasks.filter(live).length,
    buildings: BUILDING_IDS.map(building => [building, payer.buildings[building]]),
    research: RESEARCH_IDS.map(tech => [tech, state.research.levels[tech]]), fieldsMax: payer.fieldsMax, growthCut: growthCut(state),
    jobs: payer.buildQueue.map(job => [job.building, job.jobId, job.taskId, planetId, job.targetLevel, job.source, ...RESOURCE_IDS.map(id => job.paid[id].toString())]),
    researchJobs: state.research.queue.map(job => [job.tech, job.jobId, job.taskId, job.planetId, job.targetLevel, job.source, ...RESOURCE_IDS.map(id => job.paid[id].toString())]),
    tasks: relevantTasks.map(task => ({ id: task.id, kind: task.kind, planetId: task.planetId, building: task.kind === "building" ? task.building : null,
      targetLevel: task.kind === "building" ? task.targetLevel : null, status: task.status, budget: task.budget, charged: task.charged, refunded: task.refunded,
      activeJob: task.activeJob, completedUnits: task.completedUnits, transport: task.transport, currentWork: task.currentWork, formationOrigin: task.formationOrigin })),
    rows: mapping.rows.map(row => [row.building, row.targetLevel, row.status, row.currentLevel, row.nextUnpaidLevel]) }) : "";
  return key.length <= MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH ? key : "";
}

/** Explicit review only: priced snapshots must not be regenerated by each animation frame. */
export function quoteBuildingTemplate(state: GameState, templateId: number, planetId: string): BuildingTemplateQuote {
  const mapping = mapBuildingTemplate(state, templateId, planetId);
  const local = selectPlanet(state, planetId);
  const rows: BuildingTemplateQuoteRow[] = mapping.rows.map(row => ({ ...row, quote: row.status === "new" ? quoteUnpaidLevels(local, row.building, row.nextUnpaidLevel, row.targetLevel) : zeroOrderMoney() }));
  const blockers = mapping.blockers.slice();
  for (const row of rows) if (row.quote === null) blockers.push(`${buildingById(row.building).nameZh} 的未付报价无法精确表示，请降低目标等级`);
  const totalQuote = summedQuote(rows);
  if (totalQuote === null && !rows.some(row => row.quote === null)) blockers.push("合计报价超出精确金额范围，请减少目标或拆分模板");
  if (mapping.newCount) {
    const capacity = capacityBlocker(state, mapping.newCount);
    if (capacity) blockers.push(capacity);
  }
  const authorityKey = buildingTemplateAuthorityKey(state, templateId, planetId);
  const key = authorityKey ? JSON.stringify({ authorityKey, quotes: rows.map(row => [row.building, row.quote]), totalQuote }) : "";
  const reviewKey = key.length <= MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH ? key : "";
  if (mapping.rows.length && !reviewKey) blockers.push("核对快照超过安全范围，无法应用");
  const ok = mapping.ok && mapping.newCount > 0 && blockers.length === 0 && !!reviewKey;
  return { ...mapping, rows, blockers, ok, reason: blockers[0] ?? (mapping.newCount ? "请核对固定付款星球和各项独立预算；确认仅创建有限计划，不会立即支付" : mapping.reason), nextTaskId: state.orders.nextTaskId, reviewKey, totalQuote };
}

export function applyBuildingTemplate(state: GameState, request: BuildingTemplateApplyRequest): BuildingTemplateResult {
  if (!hasBuildingTemplateFields(request, ["templateId", "expectedTemplateRevision", "planetId", "expectedNextTaskId", "expectedReviewKey", "budgets"])
    || !validId(request.templateId) || !validRevision(request.expectedTemplateRevision) || typeof request.planetId !== "string"
    || !validId(request.expectedNextTaskId) || request.expectedNextTaskId !== state.orders.nextTaskId
    || typeof request.expectedReviewKey !== "string" || !request.expectedReviewKey || request.expectedReviewKey.length > MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH
    || !Array.isArray(request.budgets)) return failure(state, "应用核对已过期或请求无效，请重新核对");
  const template = state.buildingTemplates.templates.find(value => value.id === request.templateId);
  if (!template || template.revision !== request.expectedTemplateRevision) return failure(state, "模板已更改或删除，请重新核对");
  const mapping = mapBuildingTemplate(state, request.templateId, request.planetId);
  if (!mapping.ok || mapping.newCount === 0) return failure(state, mapping.reason);
  const newRows = mapping.rows.filter(row => row.status === "new");
  if (request.budgets.length !== newRows.length) return failure(state, "预算必须恰好覆盖所有新增目标，不可缺少或多出项目");
  const budgets = new Map<BuildingId, OrderMoney>();
  for (const entry of request.budgets) {
    if (!hasBuildingTemplateFields(entry, ["building", "budget"]) || !newRows.some(row => row.building === entry.building)
      || budgets.has(entry.building as BuildingId) || !hasBuildingTemplateFields(entry.budget, RESOURCE_IDS) || !isOrderMoney(entry.budget)) return failure(state, "逐项预算无效、重复或包含非新增目标");
    const money = entry.budget;
    budgets.set(entry.building as BuildingId, { metal: normalizeOrderAmount(money.metal)!, crystal: normalizeOrderAmount(money.crystal)!, deuterium: normalizeOrderAmount(money.deuterium)! });
  }
  const capacity = capacityBlocker(state, newRows.length);
  if (capacity) return failure(state, capacity);
  const quote = quoteBuildingTemplate(state, request.templateId, request.planetId);
  if (!quote.ok) return failure(state, quote.reason);
  if (quote.reviewKey !== request.expectedReviewKey) return failure(state, "建造、队列或计划已变化，请重新核对");
  let candidate = state;
  const createdTaskIds: number[] = [];
  for (const row of newRows) {
    const id = candidate.orders.nextTaskId;
    const result = createOrderTask(candidate, { kind: "building", planetId: request.planetId, building: row.building, targetLevel: row.targetLevel, budget: budgets.get(row.building)!, expectedNextTaskId: id, transport: null });
    if (!result.ok) return failure(state, result.reason);
    candidate = result.state;
    createdTaskIds.push(id);
  }
  // Validate the fully assembled batch against strict current-save invariants once.
  // Validation may normalize display markers, so retain the untouched candidate.
  try { deserializeState(serializeState(candidate)); }
  catch { return failure(state, "整批计划未通过存档完整性检查；没有创建计划，请重新核对"); }
  return success(candidate, `已创建 ${createdTaskIds.length} 个有限建造计划；每 10 秒按原计划规则检查`, createdTaskIds);
}
export function applyBuildingTemplateAction(state: GameState, action: BuildingTemplateAction): BuildingTemplateResult {
  if (!action || typeof action !== "object") return failure(state, "模板操作无效");
  switch (action.type) {
    case "building-template-create":
      return hasBuildingTemplateFields(action, ["type", "draft", "expectedNextTemplateId"]) ? createBuildingTemplate(state, action.draft, action.expectedNextTemplateId) : failure(state, "模板操作包含未知字段");
    case "building-template-edit":
      return hasBuildingTemplateFields(action, ["type", "templateId", "expectedTemplateRevision", "draft"]) ? editBuildingTemplate(state, action.templateId, action.expectedTemplateRevision, action.draft) : failure(state, "模板操作包含未知字段");
    case "building-template-delete":
      return hasBuildingTemplateFields(action, ["type", "templateId", "expectedTemplateRevision"]) ? deleteBuildingTemplate(state, action.templateId, action.expectedTemplateRevision) : failure(state, "模板操作包含未知字段");
    case "building-template-apply":
      return hasBuildingTemplateFields(action, ["type", "request"]) ? applyBuildingTemplate(state, action.request) : failure(state, "模板操作包含未知字段");
    default: return failure(state, "模板操作无效");
  }
}
