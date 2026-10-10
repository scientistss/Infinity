import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId, unitById } from "../data/units";
import { selectPlanet } from "./empire";
import { cancel, enqueue, nextTargetLevel } from "./queue";
import { cancelResearch, enqueueResearch, nextResearchLevel } from "./research";
import { canBuildUnits, cancelUnits, enqueueUnits, SHIPYARD, unitCost } from "./shipyard";
import {
  committedOrderMoney, isOrderMoney, ORDER_BUDGET_REASON, ORDER_IDENTITY_REASON,
  ORDER_PRECISION_REASON, quoteOrderMoney, zeroOrderMoney,
} from "./order-ledger";
import { addOrderAmounts, compareOrderAmounts, multiplyOrderAmountInteger, normalizeOrderAmount } from "./order-money";
import {
  MAX_LIVE_ORDER_TASKS, MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, MAX_ORDER_REASON_LENGTH,
  MAX_ORDER_TASKS, ORDER_PASS_SECONDS,
  type CancelPaidJobRequest, type CreateOrderRequest, type OrderAction,
  type OrderMoney, type OrderResult, type OrderTarget, type OrderTask,
} from "./order-state";
import { RESOURCE_IDS, type GameState } from "./types";

export type { OrderAction, OrderResult } from "./order-state";
const EPS = 1e-9;
const live = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const validId = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER;
function targetValid(target: OrderTarget): boolean {
  if (!target || typeof target.planetId !== "string" || !target.planetId) return false;
  switch (target.kind) {
    case "building": return isBuildingId(target.building) && Number.isSafeInteger(target.targetLevel) && target.targetLevel > 0 && target.targetLevel <= MAX_ORDER_LEVEL;
    case "research": return isResearchId(target.tech) && Number.isSafeInteger(target.targetLevel) && target.targetLevel > 0 && target.targetLevel <= MAX_ORDER_LEVEL;
    case "shipyard": return isUnitId(target.unit) && Number.isSafeInteger(target.quantity) && target.quantity > 0 && target.quantity <= MAX_ORDER_QUANTITY;
    default: return false;
  }
}
function sameTarget(a: OrderTarget, b: OrderTarget): boolean {
  if (a.kind === "research" && b.kind === "research") return a.tech === b.tech;
  if (a.planetId !== b.planetId) return false;
  return a.kind === "building" && b.kind === "building" ? a.building === b.building
    : a.kind === "shipyard" && b.kind === "shipyard" && a.unit === b.unit;
}
function satisfied(state: GameState, task: OrderTarget & { completedUnits?: number }): boolean {
  const planet = state.planets.find(value => value.id === task.planetId);
  return task.kind === "building" ? !!planet && planet.buildings[task.building] >= task.targetLevel
    : task.kind === "research" ? state.research.levels[task.tech] >= task.targetLevel
    : (task.completedUnits ?? 0) >= task.quantity;
}
function setTask(state: GameState, id: number, patch: Partial<OrderTask>): GameState {
  const tasks = state.orders.tasks.map(task => task.id === id ? { ...task, ...patch, ...(patch.reason === undefined ? {} : { reason: patch.reason.slice(0, MAX_ORDER_REASON_LENGTH) }) } as OrderTask : task);
  return { ...state, orders: { ...state.orders, tasks, accumulator: tasks.some(task => task.status === "running") ? state.orders.accumulator : 0 } };
}
function failed(state: GameState, reason: string): OrderResult { return { state, ok: false, reason }; }
function normalizeMoney(money: OrderMoney): OrderMoney {
  return { metal: normalizeOrderAmount(money.metal)!, crystal: normalizeOrderAmount(money.crystal)!, deuterium: normalizeOrderAmount(money.deuterium)! };
}
export function createOrderTask(state: GameState, request: CreateOrderRequest): OrderResult {
  if (!targetValid(request) || !isOrderMoney(request.budget)) return failed(state, "计划目标、数量或预算无效");
  if (!validId(request.expectedNextTaskId) || request.expectedNextTaskId !== state.orders.nextTaskId) return failed(state, "计划表单已使用或过期，请编辑表单或新建计划后重试");
  if (!state.planets.some(planet => planet.id === request.planetId)) return failed(state, "支付和执行星球不存在");
  if (state.orders.tasks.length >= MAX_ORDER_TASKS) return failed(state, "计划记录已满，请移除已结束记录");
  if (state.orders.tasks.filter(live).length >= MAX_LIVE_ORDER_TASKS) return failed(state, "未结束计划最多 32 项");
  if (state.orders.tasks.some(task => live(task) && sameTarget(task, request))) return failed(state, "相同目标已有未结束计划");
  if (satisfied(state, request)) return failed(state, "目标等级已经完成");
  const target: OrderTarget = request.kind === "building" ? { kind: request.kind, planetId: request.planetId, building: request.building, targetLevel: request.targetLevel }
    : request.kind === "research" ? { kind: request.kind, planetId: request.planetId, tech: request.tech, targetLevel: request.targetLevel }
    : { kind: request.kind, planetId: request.planetId, unit: request.unit, quantity: request.quantity };
  const task: OrderTask = { ...target, id: request.expectedNextTaskId, status: "running", reason: "等待下一次计划检查", budget: normalizeMoney(request.budget), charged: zeroOrderMoney(), refunded: zeroOrderMoney(), activeJob: null, completedUnits: 0 };
  return { state: { ...state, orders: { ...state.orders, nextTaskId: task.id + 1, accumulator: state.orders.tasks.some(value => value.status === "running") ? state.orders.accumulator : 0, tasks: [...state.orders.tasks, task] } }, ok: true, reason: "有限计划已创建；每 10 秒检查一次" };
}
export function pauseOrderTask(state: GameState, taskId: number): OrderResult {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!validId(taskId) || !task || task.status !== "running") return failed(state, "该计划不能暂停");
  return { state: setTask(state, taskId, { status: "paused", reason: "计划已暂停；已支付任务继续完成" }), ok: true, reason: "计划已暂停" };
}
export function resumeOrderTask(state: GameState, taskId: number): OrderResult {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!validId(taskId) || !task || task.status !== "paused") return failed(state, "该计划不能继续");
  if (!state.planets.some(planet => planet.id === task.planetId) || !targetValid(task) || !committedOrderMoney(task)) return failed(state, ORDER_IDENTITY_REASON);
  const wasIdle = !state.orders.tasks.some(value => value.status === "running");
  const next = setTask(state, taskId, { status: "running", reason: "等待下一次计划检查" });
  return { state: wasIdle ? { ...next, orders: { ...next.orders, accumulator: 0 } } : next, ok: true, reason: "计划已继续，原预算和进度保持不变" };
}
export function cancelPaidJob(state: GameState, request: CancelPaidJobRequest): OrderResult {
  if (!request || !validId(request.jobId) || !state.planets.some(planet => planet.id === request.planetId)) return failed(state, "付费任务已不存在，未执行取消");
  const local = selectPlanet(state, request.planetId);
  const planet = local.planets.find(value => value.id === request.planetId)!;
  let result: OrderResult;
  if (request.kind === "building") {
    const index = planet.buildQueue.findIndex(job => job.jobId === request.jobId);
    if (index < 0) return failed(state, "付费任务已不存在，未执行取消");
    result = cancel(local, index);
  } else if (request.kind === "research") {
    const index = local.research.queue.findIndex(job => job.jobId === request.jobId && job.planetId === request.planetId);
    if (index < 0) return failed(state, "付费任务已不存在，未执行取消");
    result = cancelResearch(local, index);
  } else if (request.kind === "shipyard") {
    const index = planet.shipyardQueue.findIndex(job => job.jobId === request.jobId);
    if (index < 0) return failed(state, "付费任务已不存在，未执行取消");
    result = cancelUnits(local, index);
  } else return failed(state, "付费任务种类无效");
  let next = selectPlanet(result.state, state.activePlanetId);
  if (!result.ok) {
    const owner = state.orders.tasks.find(task => live(task) && task.kind === request.kind && task.planetId === request.planetId && task.activeJob?.jobId === request.jobId);
    if (owner) next = setTask(next, owner.id, { status: "paused", reason: result.reason });
  }
  return { ...result, state: next };
}
export function cancelOrderTask(state: GameState, taskId: number): OrderResult {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!validId(taskId) || !task || !live(task)) return failed(state, "该计划已经结束或不存在");
  let next = state;
  if (task.activeJob) {
    const cancellation = cancelPaidJob(state, { kind: task.kind, planetId: task.planetId, jobId: task.activeJob.jobId });
    if (!cancellation.ok) return { ...cancellation, state: setTask(cancellation.state, taskId, { status: "paused", reason: cancellation.reason }) };
    next = cancellation.state;
  }
  return { state: setTask(next, taskId, { status: "cancelled", activeJob: null, reason: "计划已取消，未完成的付费部分已退款" }), ok: true, reason: "计划已取消" };
}
export function dismissOrderTask(state: GameState, taskId: number): OrderResult {
  const task = state.orders.tasks.find(value => value.id === taskId);
  if (!validId(taskId) || !task || live(task) || task.activeJob) return failed(state, "只能移除已结束的计划记录");
  return { state: { ...state, orders: { ...state.orders, tasks: state.orders.tasks.filter(value => value.id !== taskId) } }, ok: true, reason: "已移除计划记录" };
}
export function applyOrderAction(state: GameState, action: OrderAction): OrderResult {
  switch (action.type) {
    case "order-create": return createOrderTask(state, action.request);
    case "order-pause": return pauseOrderTask(state, action.taskId);
    case "order-resume": return resumeOrderTask(state, action.taskId);
    case "order-cancel": return cancelOrderTask(state, action.taskId);
    case "order-dismiss": return dismissOrderTask(state, action.taskId);
    case "cancel-paid-job": return cancelPaidJob(state, action.request);
    default: return failed(state, "计划操作无效");
  }
}
export function nextOrderPassIn(state: GameState): number {
  return state.orders.tasks.some(task => task.status === "running") ? Math.max(0, ORDER_PASS_SECONDS - state.orders.accumulator) : Number.POSITIVE_INFINITY;
}
/** Keep canonical persisted time even when a boundary effect round-trips the full state. */
export function accrueOrderPlanTime(state: GameState, seconds: number): { state: GameState; passes: number } {
  if (!state.orders.tasks.some(task => task.status === "running")) return { state: state.orders.accumulator === 0 ? state : { ...state, orders: { ...state.orders, accumulator: 0 } }, passes: 0 };
  if (!(seconds > 0) || !Number.isFinite(seconds)) return { state, passes: 0 };
  const elapsed = state.orders.accumulator + seconds;
  if (!Number.isFinite(elapsed)) return { state, passes: 0 };
  const wholePasses = Math.floor(elapsed / ORDER_PASS_SECONDS);
  const passes = Math.floor((elapsed + EPS) / ORDER_PASS_SECONDS);
  const accumulator = passes > wholePasses ? 0 : elapsed % ORDER_PASS_SECONDS;
  return { state: { ...state, orders: { ...state.orders, accumulator } }, passes };
}
function activeReceiptExists(state: GameState, task: OrderTask): boolean {
  if (!task.activeJob) return false;
  const planet = state.planets.find(value => value.id === task.planetId);
  if (!planet) return false;
  if (task.kind === "building") return planet.buildQueue.some(job => job.jobId === task.activeJob!.jobId && job.taskId === task.id && job.source === "plan" && job.building === task.building);
  if (task.kind === "research") return state.research.queue.some(job => job.jobId === task.activeJob!.jobId && job.taskId === task.id && job.source === "plan" && job.planetId === task.planetId && job.tech === task.tech);
  return planet.shipyardQueue.some(job => job.jobId === task.activeJob!.jobId && job.taskId === task.id && job.source === "plan" && job.unit === task.unit);
}
function affordableShipBatch(state: GameState, task: OrderTask & { kind: "shipyard" }): { quantity: number; reason: string; unsafe?: boolean } {
  const committed = committedOrderMoney(task);
  const perUnit = quoteOrderMoney(unitCost(unitById(task.unit)));
  if (!committed || !perUnit) return { quantity: 0, reason: ORDER_PRECISION_REASON, unsafe: true };
  const withinBudget = (count: number): boolean => RESOURCE_IDS.every(id => {
    const price = multiplyOrderAmountInteger(perUnit[id], count);
    const total = price === null ? null : addOrderAmounts(committed[id], price);
    return total !== null && compareOrderAmounts(total, task.budget[id]) !== 1;
  });
  if (!withinBudget(1)) return { quantity: 0, reason: ORDER_BUDGET_REASON };
  const one = canBuildUnits(state, task.unit, 1);
  if (!one.ok) return { quantity: 0, reason: one.reason };
  let low = 1, high = Math.min(task.quantity - task.completedUnits, SHIPYARD.maxBatch);
  while (low < high) {
    const middle = low + Math.ceil((high - low) / 2);
    if (withinBudget(middle) && canBuildUnits(state, task.unit, middle).ok) low = middle;
    else high = middle - 1;
  }
  return { quantity: low, reason: "" };
}
export function runDueOrderPass(state: GameState): GameState {
  let next = state;
  for (const taskId of state.orders.tasks.filter(task => task.status === "running").map(task => task.id).sort((a, b) => a - b)) {
    const task = next.orders.tasks.find(value => value.id === taskId);
    if (!task || task.status !== "running") continue;
    if (!targetValid(task) || !next.planets.some(planet => planet.id === task.planetId)) { next = setTask(next, taskId, { status: "paused", reason: ORDER_IDENTITY_REASON }); continue; }
    if (task.activeJob) {
      if (!activeReceiptExists(next, task)) next = setTask(next, taskId, { status: "paused", reason: ORDER_IDENTITY_REASON });
      continue;
    }
    if (satisfied(next, task)) { next = setTask(next, taskId, { status: "completed", reason: "有限目标已完成" }); continue; }
    const local = selectPlanet(next, task.planetId);
    const planet = local.planets.find(value => value.id === task.planetId)!;
    let result: OrderResult;
    if (task.kind === "building") {
      if (nextTargetLevel(planet, task.building) > task.targetLevel) { next = setTask(next, taskId, { reason: "已有付费建造覆盖目标，等待实际完成" }); continue; }
      result = enqueue(local, task.building, "plan", taskId);
    } else if (task.kind === "research") {
      if (nextResearchLevel(local.research, task.tech) > task.targetLevel) { next = setTask(next, taskId, { reason: "已有付费研究覆盖目标，等待实际完成" }); continue; }
      result = enqueueResearch(local, task.tech, "plan", taskId);
    } else {
      const batch = affordableShipBatch(local, task);
      if (batch.quantity < 1) { next = setTask(next, taskId, { reason: batch.reason, ...(batch.unsafe ? { status: "paused" } : {}) }); continue; }
      result = enqueueUnits(local, task.unit, batch.quantity, "plan", taskId);
    }
    next = selectPlanet(result.state, next.activePlanetId);
    next = setTask(next, taskId, { reason: result.reason });
  }
  return next;
}
/** Use the same ten simulated seconds in live and offline modes. Never called from rendering. */
export function advanceOrderPlans(state: GameState, seconds: number): GameState {
  const accrued = accrueOrderPlanTime(state, seconds);
  // No economic time or queue completions occur in this helper. Repeating pure passes
  // cannot advance a paid receipt, so collapse arbitrary elapsed input into one bounded pass.
  const next = accrued.passes > 0 ? runDueOrderPass(accrued.state) : accrued.state;
  return next.orders.tasks.some(task => task.status === "running") || next.orders.accumulator === 0 ? next : { ...next, orders: { ...next.orders, accumulator: 0 } };
}
/** Prestige drops the run's queues: retain historical spending without inventing a refund. */
export function terminateOrdersForPrestige(state: GameState): GameState["orders"] {
  return { ...state.orders, accumulator: 0, tasks: state.orders.tasks.map(task => live(task) ? { ...task, status: "cancelled", activeJob: null, reason: "殖民发射已结束本轮计划；已支付资源不额外退款" } : task) };
}
