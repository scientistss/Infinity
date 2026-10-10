import { RESEARCH_IDS, researchById, type ResearchId } from "../data/research";
import { economy } from "./economy";
import { selectPlanet } from "./empire";
import { researchEnergyRequirement } from "./formulas";
import { isOrderMoney, quoteOrderMoney, zeroOrderMoney } from "./order-ledger";
import { addOrderAmounts, normalizeOrderAmount } from "./order-money";
import { MAX_LIVE_ORDER_TASKS, MAX_ORDER_TASKS, type OrderMoney, type OrderTask } from "./order-state";
import { createOrderTask } from "./orders";
import { labBusyReason, nextResearchLevel, researchCapacity, researchCostFor } from "./research";
import {
  MAX_RESEARCH_TEMPLATES, MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH,
  hasResearchTemplateFields, normalizeResearchTemplateDraft,
  type ResearchTemplateAction, type ResearchTemplateApplyRequest, type ResearchTemplateDraft,
  type ResearchTemplateExistingTask, type ResearchTemplateMapping, type ResearchTemplateQuote,
  type ResearchTemplateQuoteRow, type ResearchTemplateResult, type ResearchTemplateRow,
} from "./research-template-state";
import { missingRequirements } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";

export type { ResearchTemplateAction, ResearchTemplateResult } from "./research-template-state";
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const live = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const failure = (state: GameState, reason: string): ResearchTemplateResult => ({ state, ok: false, reason, createdTaskIds: [] });
const success = (state: GameState, reason: string, createdTaskIds: number[] = []): ResearchTemplateResult => ({ state, ok: true, reason, createdTaskIds });

export function createResearchTemplate(state: GameState, draft: ResearchTemplateDraft, expectedNextTemplateId: number): ResearchTemplateResult {
  const normalized = normalizeResearchTemplateDraft(draft);
  if (!normalized) return failure(state, "模板名称或目标无效；名称限 64 个字符，目标须互异且等级为 1–1000");
  if (!validId(expectedNextTemplateId) || expectedNextTemplateId !== state.researchTemplates.nextTemplateId) return failure(state, "模板表单已使用或过期，或模板编号已耗尽");
  if (state.researchTemplates.templates.length >= MAX_RESEARCH_TEMPLATES) return failure(state, "研究模板最多 32 个");
  const template = { id: expectedNextTemplateId, revision: 1, ...normalized };
  return success({ ...state, researchTemplates: { nextTemplateId: template.id + 1, templates: [...state.researchTemplates.templates, template] } }, "研究意图已保存；尚未创建计划或支付资源");
}
export function editResearchTemplate(state: GameState, templateId: number, expectedTemplateRevision: number, draft: ResearchTemplateDraft): ResearchTemplateResult {
  const template = state.researchTemplates.templates.find(value => value.id === templateId);
  if (!validId(templateId) || !validRevision(expectedTemplateRevision) || !template || template.revision !== expectedTemplateRevision) return failure(state, "模板已更改或不存在，请重新打开");
  if (template.revision >= Number.MAX_SAFE_INTEGER) return failure(state, "模板修订号已耗尽，请新建模板");
  const normalized = normalizeResearchTemplateDraft(draft);
  if (!normalized) return failure(state, "模板名称或目标无效；名称限 64 个字符，目标须互异且等级为 1–1000");
  const edited = { id: template.id, revision: template.revision + 1, ...normalized };
  return success({ ...state, researchTemplates: { ...state.researchTemplates, templates: state.researchTemplates.templates.map(value => value.id === templateId ? edited : value) } }, "模板已更新；已有计划的目标、付款星球和预算保持原样");
}
export function deleteResearchTemplate(state: GameState, templateId: number, expectedTemplateRevision: number): ResearchTemplateResult {
  const template = state.researchTemplates.templates.find(value => value.id === templateId);
  if (!validId(templateId) || !validRevision(expectedTemplateRevision) || !template || template.revision !== expectedTemplateRevision) return failure(state, "模板已更改或不存在，请重新打开");
  return success({ ...state, researchTemplates: { ...state.researchTemplates, templates: state.researchTemplates.templates.filter(value => value.id !== templateId) } }, "模板已删除；已有计划继续执行，可在计划列表单独管理");
}
function taskSnapshot(task: Extract<OrderTask, { kind: "research" }>): ResearchTemplateExistingTask {
  return { id: task.id, status: task.status, tech: task.tech, targetLevel: task.targetLevel, planetId: task.planetId,
    budget: { ...task.budget }, charged: { ...task.charged }, refunded: { ...task.refunded }, reason: task.reason, hasTransport: task.transport !== null };
}

/** Cheap bounded intent mapping, safe for display. It never sums future level prices. */
export function mapResearchTemplate(state: GameState, templateId: number, planetId: string): ResearchTemplateMapping {
  const template = state.researchTemplates.templates.find(value => value.id === templateId);
  const base = { templateId, templateRevision: template?.revision ?? 0, planetId, rows: [] as ResearchTemplateRow[], newCount: 0, blockers: [] as string[] };
  if (!validId(templateId) || !template) return { ...base, ok: false, reason: "研究模板不存在", blockers: ["研究模板不存在"] };
  if (typeof planetId !== "string" || !state.planets.some(value => value.id === planetId)) return { ...base, ok: false, reason: "请选择实际付款和执行星球", blockers: ["请选择实际付款和执行星球"] };
  const local = selectPlanet(state, planetId);
  const busy = labBusyReason(state), capacity = researchCapacity(state);
  const full = state.research.queue.length >= capacity ? `研究队列已满（${state.research.queue.length}/${capacity}）` : "";
  let supply: number | undefined;
  const rows = template.goals.map((goal): ResearchTemplateRow => {
    const currentLevel = state.research.levels[goal.tech], nextUnpaidLevel = nextResearchLevel(state.research, goal.tech);
    const activeTasks = state.orders.tasks.filter((task): task is Extract<OrderTask, { kind: "research" }> => task.kind === "research" && task.tech === goal.tech && live(task));
    const existing = activeTasks[0];
    const status = currentLevel >= goal.targetLevel ? "achieved" : existing ? existing.targetLevel >= goal.targetLevel && activeTasks.length === 1 ? "covered" : "conflict" : "new";
    const paidJobs = state.research.queue.filter(job => job.tech === goal.tech).map(job => ({ jobId: job.jobId, taskId: job.taskId, planetId: job.planetId, targetLevel: job.targetLevel, source: job.source,
      paid: { metal: job.paid.metal.toString(), crystal: job.paid.crystal.toString(), deuterium: job.paid.deuterium.toString() } }));
    const warnings: string[] = [];
    if (status === "new") {
      const def = researchById(goal.tech);
      const missing = missingRequirements(local, def.requires);
      if (missing.length) warnings.push(`需要 ${missing.join("、")}`);
      if (busy) warnings.push(busy);
      if (full) warnings.push(full);
      const energy = researchEnergyRequirement(def, nextUnpaidLevel);
      if (energy > 0) {
        supply ??= economy(local).supply;
        warnings.push(`能源仅为研究前置，不会花费；下一级要求 ${energy}，当前供给 ${supply}${supply < energy ? "（不足）" : ""}`);
      }
      if (paidJobs.length) warnings.push("已有付费研究在先，等待真实完成；此次预算不认领原付款");
    } else if (status === "covered") warnings.push(`已有计划 #${existing!.id} 覆盖目标，保持原付款星球、预算和${existing!.status === "paused" ? "暂停" : "运行"}状态`);
    else if (status === "conflict") warnings.push("同科技已有较低目标或冲突计划；请先在计划列表处理，模板不会替换原授权");
    return { ...goal, status, currentLevel, nextUnpaidLevel, existingTask: existing ? taskSnapshot(existing) : null, paidJobs, warnings };
  });
  const blockers = rows.filter(row => row.status === "conflict").map(row => `${researchById(row.tech).nameZh} 已有冲突计划，不能批量应用`);
  const newCount = rows.filter(row => row.status === "new").length;
  return { ...base, rows, newCount, blockers, ok: blockers.length === 0, reason: blockers[0] ?? (newCount ? "仅保存目标，不会自动研究；请明确预算后核对应用" : "目标均已达到或有计划覆盖，无需创建") };
}

function quoteUnpaidLevels(tech: ResearchId, from: number, target: number): OrderMoney | null {
  const total = zeroOrderMoney();
  for (let level = from; level <= target; level += 1) {
    // Each level uses the actual formula, including astrophysics rounding. Never sum with Number.
    const cost = quoteOrderMoney(researchCostFor(tech, level));
    if (!cost) return null;
    for (const resource of RESOURCE_IDS) {
      const amount = addOrderAmounts(total[resource], cost[resource]);
      if (amount === null) return null;
      total[resource] = amount;
    }
  }
  return total;
}
function summedQuote(rows: ResearchTemplateQuoteRow[]): OrderMoney | null {
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
export function researchTemplateAuthorityKey(state: GameState, templateId: number, planetId: string): string {
  const mapping = mapResearchTemplate(state, templateId, planetId);
  const template = state.researchTemplates.templates.find(value => value.id === templateId);
  const payer = state.planets.find(value => value.id === planetId);
  // Authoritative identities, completed levels and charges are included; wallet amounts,
  // changing scheduler reasons and countdowns deliberately are not. Curvature is a new world.
  const key = template && payer ? JSON.stringify({ version: 1, worldLaunches: state.stats.launches,
    template: { id: template.id, revision: template.revision, name: template.name, goals: template.goals }, planetId,
    nextTaskId: state.orders.nextTaskId, levels: RESEARCH_IDS.map(tech => [tech, state.research.levels[tech]]), lab: payer.buildings.research_lab,
    labJobs: state.planets.flatMap(planet => planet.buildQueue.filter(job => job.building === "research_lab").map(job => [planet.id, job.jobId, job.targetLevel])),
    jobs: state.research.queue.map(job => [job.tech, job.jobId, job.taskId, job.planetId, job.targetLevel, job.source, ...RESOURCE_IDS.map(id => job.paid[id].toString())]),
    rows: mapping.rows.map(row => ({ tech: row.tech, targetLevel: row.targetLevel, status: row.status, currentLevel: row.currentLevel, nextUnpaidLevel: row.nextUnpaidLevel,
      existing: row.existingTask ? { id: row.existingTask.id, status: row.existingTask.status, targetLevel: row.existingTask.targetLevel, planetId: row.existingTask.planetId,
        budget: row.existingTask.budget, charged: row.existingTask.charged, refunded: row.existingTask.refunded, hasTransport: row.existingTask.hasTransport } : null })) }) : "";
  return key.length <= MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH ? key : "";
}

/** Explicit review only: priced snapshots must not be regenerated by each animation frame. */
export function quoteResearchTemplate(state: GameState, templateId: number, planetId: string): ResearchTemplateQuote {
  const mapping = mapResearchTemplate(state, templateId, planetId);
  const rows: ResearchTemplateQuoteRow[] = mapping.rows.map(row => ({ ...row, quote: row.status === "new" ? quoteUnpaidLevels(row.tech, row.nextUnpaidLevel, row.targetLevel) : zeroOrderMoney() }));
  const blockers = mapping.blockers.slice();
  for (const row of rows) if (row.quote === null) blockers.push(`${researchById(row.tech).nameZh} 的未付报价无法精确表示，请降低目标等级`);
  const totalQuote = summedQuote(rows);
  if (totalQuote === null && !rows.some(row => row.quote === null)) blockers.push("合计报价超出精确金额范围，请减少目标或拆分模板");
  if (mapping.newCount) {
    const capacity = capacityBlocker(state, mapping.newCount);
    if (capacity) blockers.push(capacity);
  }
  const authorityKey = researchTemplateAuthorityKey(state, templateId, planetId);
  const key = authorityKey ? JSON.stringify({ authorityKey, quotes: rows.map(row => [row.tech, row.quote]), totalQuote }) : "";
  const reviewKey = key.length <= MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH ? key : "";
  if (key && !reviewKey) blockers.push("核对快照超过安全范围，无法应用");
  const ok = mapping.ok && mapping.newCount > 0 && blockers.length === 0 && !!reviewKey;
  return { ...mapping, rows, blockers, ok, reason: blockers[0] ?? (mapping.newCount ? "请核对固定付款星球和各项独立预算；确认仅创建有限计划，不会立即支付" : mapping.reason), nextTaskId: state.orders.nextTaskId, reviewKey, totalQuote };
}

export function applyResearchTemplate(state: GameState, request: ResearchTemplateApplyRequest): ResearchTemplateResult {
  if (!hasResearchTemplateFields(request, ["templateId", "expectedTemplateRevision", "planetId", "expectedNextTaskId", "expectedReviewKey", "budgets"])
    || !validId(request.templateId) || !validRevision(request.expectedTemplateRevision) || typeof request.planetId !== "string"
    || !validId(request.expectedNextTaskId) || request.expectedNextTaskId !== state.orders.nextTaskId
    || typeof request.expectedReviewKey !== "string" || !request.expectedReviewKey || request.expectedReviewKey.length > MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH
    || !Array.isArray(request.budgets)) return failure(state, "应用核对已过期或请求无效，请重新核对");
  const template = state.researchTemplates.templates.find(value => value.id === request.templateId);
  if (!template || template.revision !== request.expectedTemplateRevision) return failure(state, "模板已更改或删除，请重新核对");
  const mapping = mapResearchTemplate(state, request.templateId, request.planetId);
  if (!mapping.ok || mapping.newCount === 0) return failure(state, mapping.reason);
  const newRows = mapping.rows.filter(row => row.status === "new");
  if (request.budgets.length !== newRows.length) return failure(state, "预算必须恰好覆盖所有新增目标，不可缺少或多出项目");
  const budgets = new Map<ResearchId, OrderMoney>();
  for (const entry of request.budgets) {
    if (!hasResearchTemplateFields(entry, ["tech", "budget"]) || !newRows.some(row => row.tech === entry.tech)
      || budgets.has(entry.tech as ResearchId) || !hasResearchTemplateFields(entry.budget, RESOURCE_IDS) || !isOrderMoney(entry.budget)) return failure(state, "逐项预算无效、重复或包含非新增目标");
    const money = entry.budget;
    budgets.set(entry.tech as ResearchId, { metal: normalizeOrderAmount(money.metal)!, crystal: normalizeOrderAmount(money.crystal)!, deuterium: normalizeOrderAmount(money.deuterium)! });
  }
  const capacity = capacityBlocker(state, newRows.length);
  if (capacity) return failure(state, capacity);
  const quote = quoteResearchTemplate(state, request.templateId, request.planetId);
  if (!quote.ok) return failure(state, quote.reason);
  if (quote.reviewKey !== request.expectedReviewKey) return failure(state, "研究、队列或计划已变化，请重新核对");
  let candidate = state;
  const createdTaskIds: number[] = [];
  for (const row of newRows) {
    const id = candidate.orders.nextTaskId;
    const result = createOrderTask(candidate, { kind: "research", planetId: request.planetId, tech: row.tech, targetLevel: row.targetLevel, budget: budgets.get(row.tech)!, expectedNextTaskId: id, transport: null });
    if (!result.ok) return failure(state, result.reason);
    candidate = result.state;
    createdTaskIds.push(id);
  }
  return success(candidate, `已创建 ${createdTaskIds.length} 个有限研究计划；每 10 秒按原计划规则检查`, createdTaskIds);
}
export function applyResearchTemplateAction(state: GameState, action: ResearchTemplateAction): ResearchTemplateResult {
  if (!action || typeof action !== "object") return failure(state, "模板操作无效");
  switch (action.type) {
    case "research-template-create":
      return hasResearchTemplateFields(action, ["type", "draft", "expectedNextTemplateId"]) ? createResearchTemplate(state, action.draft, action.expectedNextTemplateId) : failure(state, "模板操作包含未知字段");
    case "research-template-edit":
      return hasResearchTemplateFields(action, ["type", "templateId", "expectedTemplateRevision", "draft"]) ? editResearchTemplate(state, action.templateId, action.expectedTemplateRevision, action.draft) : failure(state, "模板操作包含未知字段");
    case "research-template-delete":
      return hasResearchTemplateFields(action, ["type", "templateId", "expectedTemplateRevision"]) ? deleteResearchTemplate(state, action.templateId, action.expectedTemplateRevision) : failure(state, "模板操作包含未知字段");
    case "research-template-apply":
      return hasResearchTemplateFields(action, ["type", "request"]) ? applyResearchTemplate(state, action.request) : failure(state, "模板操作包含未知字段");
    default: return failure(state, "模板操作无效");
  }
}
