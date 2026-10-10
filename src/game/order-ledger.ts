import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId } from "../data/units";
import { big, isValidAmount, type BigNumber } from "./decimal";
import {
  MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, MAX_ORDER_REASON_LENGTH,
  type NewPaidJob, type OrderMoney, type OrderResult, type OrderTask, type PaidJobRef,
} from "./order-state";
import { addOrderAmounts, compareOrderAmounts, isOrderAmount, multiplyOrderAmountInteger, subtractOrderAmounts } from "./order-money";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";

export * from "./order-money";
export type { NewPaidJob, OrderResult } from "./order-state";
export const ORDER_PRECISION_REASON = "金额精度不足，计划已暂停；请调整库存后再继续";
export const ORDER_IDENTITY_REASON = "计划或付费任务身份不一致，已暂停";
export const ORDER_BUDGET_REASON = "计划预算不足，等待取消或另建计划";
export const ORDER_EXHAUSTED_REASON = "任务编号已耗尽，不能继续入队";

export function zeroOrderMoney(): OrderMoney { return { metal: "0", crystal: "0", deuterium: "0" }; }
export function isOrderMoney(value: unknown): value is OrderMoney {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return Object.keys(object).length === RESOURCE_IDS.length && RESOURCE_IDS.every(id => isOrderAmount(object[id]));
}
export function quoteOrderMoney(cost: ResourceAmounts): OrderMoney | null {
  const result = zeroOrderMoney();
  for (const id of RESOURCE_IDS) {
    const value = cost[id]?.toString();
    if (!isOrderAmount(value)) return null;
    result[id] = value;
  }
  return result;
}
export function committedOrderMoney(task: Pick<OrderTask, "budget" | "charged" | "refunded">): OrderMoney | null {
  if (!isOrderMoney(task.budget) || !isOrderMoney(task.charged) || !isOrderMoney(task.refunded)) return null;
  const result = zeroOrderMoney();
  for (const id of RESOURCE_IDS) {
    const value = subtractOrderAmounts(task.charged[id], task.refunded[id]);
    if (value === null || compareOrderAmounts(value, task.budget[id]) === 1) return null;
    result[id] = value;
  }
  return result;
}
function validId(value: number): boolean { return Number.isSafeInteger(value) && value > 0 && value < Number.MAX_SAFE_INTEGER; }
function validJob(job: NewPaidJob): boolean {
  if (!job || typeof job.planetId !== "string" || !["manual", "protocol", "plan"].includes(job.source)) return false;
  if (job.source === "plan" ? !validId(job.taskId as number) : job.taskId !== null) return false;
  switch (job.kind) {
    case "building": return isBuildingId(job.building) && job.quantity === 1 && Number.isSafeInteger(job.targetLevel) && job.targetLevel > 0;
    case "research": return isResearchId(job.tech) && job.quantity === 1 && Number.isSafeInteger(job.targetLevel) && job.targetLevel > 0;
    case "shipyard": return isUnitId(job.unit) && Number.isSafeInteger(job.quantity) && job.quantity > 0;
    default: return false;
  }
}
function matchesTarget(task: OrderTask, job: NewPaidJob): boolean {
  if (task.kind !== job.kind || task.planetId !== job.planetId) return false;
  if (task.kind === "building" && job.kind === "building") return task.building === job.building && job.targetLevel <= task.targetLevel && job.targetLevel <= MAX_ORDER_LEVEL;
  if (task.kind === "research" && job.kind === "research") return task.tech === job.tech && job.targetLevel <= task.targetLevel && job.targetLevel <= MAX_ORDER_LEVEL;
  if (task.kind === "shipyard" && job.kind === "shipyard") return task.unit === job.unit && job.quantity <= MAX_ORDER_QUANTITY && Number.isSafeInteger(task.completedUnits) && task.completedUnits >= 0 && job.quantity <= task.quantity - task.completedUnits;
  return false;
}
function replaceTask(state: GameState, task: OrderTask): GameState {
  const tasks = state.orders.tasks.map(value => value.id === task.id ? task : value);
  return { ...state, orders: { ...state.orders, tasks, accumulator: tasks.some(value => value.status === "running") ? state.orders.accumulator : 0 } };
}
/** Safety failures may update only the authorized owner's status; no money or IDs are consumed. */
function failure(state: GameState, job: NewPaidJob, reason: string, pause = false): PreparedJob {
  const task = job?.source === "plan" ? state.orders.tasks.find(value => value.id === job.taskId) : undefined;
  if (pause && task && task.status === "running") state = replaceTask(state, { ...task, status: "paused", reason: reason.slice(0, MAX_ORDER_REASON_LENGTH) });
  return { state, ok: false, reason, jobId: null };
}
function near(actual: BigNumber, expected: BigNumber): boolean {
  return isValidAmount(actual) && isValidAmount(expected) && (expected.eq(0) ? actual.eq(0) : actual.sub(expected).abs().div(expected).lte(1e-9));
}
function transfer(before: BigNumber, amount: BigNumber, refund: boolean): BigNumber | null {
  if (!isValidAmount(before) || !isValidAmount(amount)) return null;
  if (amount.eq(0)) return before;
  if (!refund && before.lt(amount)) return null;
  const after = refund ? before.add(amount) : before.sub(amount);
  if (!isValidAmount(after) || (refund ? !after.gt(before) : !after.lt(before))) return null;
  const movement = refund ? after.sub(before) : before.sub(after);
  return near(movement, amount) ? after : null;
}
function jobIdInUse(state: GameState, jobId: number): boolean {
  return state.research.queue.some(job => job.jobId === jobId) || state.planets.some(planet => planet.buildQueue.some(job => job.jobId === jobId) || planet.shipyardQueue.some(job => job.jobId === jobId));
}
export type PreparedJob = { state: GameState; ok: true; reason: ""; jobId: number } | { state: GameState; ok: false; reason: string; jobId: null };
/** One immutable transaction. Every source is debited here; primitives only append the returned identity. */
export function preparePaidJob(state: GameState, job: NewPaidJob, quotedCost: ResourceAmounts, exactCost?: OrderMoney): PreparedJob {
  if (!validJob(job)) return failure(state, job, ORDER_IDENTITY_REASON, true);
  const planet = state.planets.find(value => value.id === job.planetId);
  if (!planet) return failure(state, job, ORDER_IDENTITY_REASON, true);
  const jobId = state.orders.nextJobId;
  if (!validId(jobId)) return failure(state, job, ORDER_EXHAUSTED_REASON, true);
  if (jobIdInUse(state, jobId)) return failure(state, job, ORDER_IDENTITY_REASON, true);
  let owner: OrderTask | undefined;
  let charged: OrderMoney | undefined;
  let quote: OrderMoney | undefined;
  if (job.source === "plan") {
    owner = state.orders.tasks.find(value => value.id === job.taskId);
    if (!owner || owner.status !== "running" || owner.activeJob !== null || !matchesTarget(owner, job)) return failure(state, job, ORDER_IDENTITY_REASON, true);
    // Exact ship batch products must be supplied by the primitive's immutable per-unit price.
    const money = exactCost ?? (job.kind === "shipyard" ? null : quoteOrderMoney(quotedCost));
    const committed = committedOrderMoney(owner);
    if (!money || !isOrderMoney(money) || !committed) return failure(state, job, ORDER_PRECISION_REASON, true);
    quote = money;
    charged = zeroOrderMoney();
    for (const id of RESOURCE_IDS) {
      if (!near(quotedCost[id], big(quote[id]))) return failure(state, job, ORDER_PRECISION_REASON, true);
      const nextCommitted = addOrderAmounts(committed[id], quote[id]);
      const nextCharged = addOrderAmounts(owner.charged[id], quote[id]);
      if (nextCommitted === null || nextCharged === null) return failure(state, job, ORDER_PRECISION_REASON, true);
      if (compareOrderAmounts(nextCommitted, owner.budget[id]) === 1) return failure(state, job, ORDER_BUDGET_REASON);
      charged[id] = nextCharged;
    }
  }
  const resources = { ...planet.resources };
  for (const id of RESOURCE_IDS) {
    const cost = quote ? big(quote[id]) : quotedCost[id];
    if (!isValidAmount(cost) || resources[id].lt(cost)) return failure(state, job, "支付星球资源不足");
    const after = job.source === "plan" ? transfer(resources[id], cost, false) : resources[id].sub(cost);
    if (after === null) return failure(state, job, ORDER_PRECISION_REASON, true);
    resources[id] = after;
  }
  let next: GameState = {
    ...state,
    planets: state.planets.map(value => value.id === planet.id ? { ...value, resources } : value),
    orders: { ...state.orders, nextJobId: jobId + 1 },
  };
  if (owner && charged) next = replaceTask(next, { ...owner, charged, activeJob: { jobId, quantity: job.quantity, credited: 0 }, reason: "付费任务已入队" });
  return { state: next, ok: true, reason: "", jobId };
}

/** Resolve both the real paid queue and its receipt. No receipt-only refunds or stale completion credit. */
function paidContext(state: GameState, ref: PaidJobRef): { task: OrderTask | null; liability: OrderMoney | null; quantity: number; observed: number; goalOnFinish: boolean } | null {
  if (!ref || !validId(ref.jobId)) return null;
  const planet = state.planets.find(value => value.id === ref.planetId);
  if (!planet) return null;
  let job: NewPaidJob;
  let liability: OrderMoney | null;
  let observed = 0;
  if (ref.kind === "building") {
    const found = planet.buildQueue.find(value => value.jobId === ref.jobId && value.taskId === ref.taskId);
    if (!found) return null;
    job = { ...found, kind: "building", planetId: planet.id, quantity: 1 };
    liability = quoteOrderMoney(found.paid);
  } else if (ref.kind === "research") {
    const found = state.research.queue.find(value => value.jobId === ref.jobId && value.taskId === ref.taskId && value.planetId === planet.id);
    if (!found) return null;
    job = { ...found, kind: "research", quantity: 1 };
    liability = quoteOrderMoney(found.paid);
  } else if (ref.kind === "shipyard") {
    const found = planet.shipyardQueue.find(value => value.jobId === ref.jobId && value.taskId === ref.taskId);
    if (!found) return null;
    job = { ...found, kind: "shipyard", planetId: planet.id, quantity: found.orderedCount };
    observed = found.orderedCount - found.count;
    const unitPrice = quoteOrderMoney(found.paidPerUnit);
    liability = unitPrice && zeroOrderMoney();
    if (unitPrice && liability) for (const id of RESOURCE_IDS) {
      const amount = multiplyOrderAmountInteger(unitPrice[id], found.count);
      if (amount === null) { liability = null; break; }
      liability[id] = amount;
    }
  } else return null;
  if (!validJob(job)) return null;
  if (job.source !== "plan") return ref.taskId === null ? { task: null, liability, quantity: job.quantity, observed, goalOnFinish: false } : null;
  const task = state.orders.tasks.find(value => value.id === ref.taskId);
  const receipt = task?.activeJob;
  if (!task || (task.status !== "running" && task.status !== "paused") || !receipt || receipt.jobId !== ref.jobId || receipt.quantity !== job.quantity || !Number.isSafeInteger(receipt.credited) || receipt.credited < 0 || receipt.credited > receipt.quantity) return null;
  // matchesTarget's remaining-goal check excludes already-credited units; restore them for the original batch.
  if (!matchesTarget({ ...task, completedUnits: task.completedUnits - receipt.credited }, job)) return null;
  if (job.kind === "shipyard" ? receipt.credited !== observed || task.completedUnits < receipt.credited : receipt.credited !== 0) return null;
  const goalOnFinish = (job.kind === "building" && task.kind === "building" && job.targetLevel >= task.targetLevel) || (job.kind === "research" && task.kind === "research" && job.targetLevel >= task.targetLevel);
  return { task, liability, quantity: job.quantity, observed, goalOnFinish };
}

export function refundPaidJob(state: GameState, ref: PaidJobRef, quotedRefund: OrderMoney): OrderResult {
  const context = paidContext(state, ref);
  if (!context) return { state, ok: false, reason: ORDER_IDENTITY_REASON };
  const planet = state.planets.find(value => value.id === ref.planetId)!;
  const resources = { ...planet.resources };
  const task = context.task;
  let refunded: OrderMoney | undefined;
  if (task) {
    const committed = committedOrderMoney(task);
    if (!isOrderMoney(quotedRefund) || !context.liability || !committed) return { state, ok: false, reason: ORDER_PRECISION_REASON };
    refunded = zeroOrderMoney();
    for (const id of RESOURCE_IDS) {
      if (compareOrderAmounts(quotedRefund[id], context.liability[id]) === 1 || compareOrderAmounts(quotedRefund[id], committed[id]) === 1) return { state, ok: false, reason: ORDER_IDENTITY_REASON };
      const amount = addOrderAmounts(task.refunded[id], quotedRefund[id]);
      if (amount === null) return { state, ok: false, reason: ORDER_PRECISION_REASON };
      refunded[id] = amount;
    }
  }
  for (const id of RESOURCE_IDS) {
    const amount = big(quotedRefund[id]);
    if (!isValidAmount(amount)) return { state, ok: false, reason: ORDER_PRECISION_REASON };
    const after = task ? transfer(resources[id], amount, true) : resources[id].add(amount);
    if (after === null) return { state, ok: false, reason: ORDER_PRECISION_REASON };
    resources[id] = after;
  }
  let next: GameState = { ...state, planets: state.planets.map(value => value.id === planet.id ? { ...value, resources } : value) };
  if (task && refunded) next = replaceTask(next, { ...task, refunded });
  return { state: next, ok: true, reason: "" };
}
export function creditPaidJob(state: GameState, ref: PaidJobRef, cumulativeCompleted: number, finished: boolean): GameState {
  const context = paidContext(state, ref);
  const task = context?.task;
  if (!context || !task || !task.activeJob || !Number.isSafeInteger(cumulativeCompleted) || cumulativeCompleted < task.activeJob.credited || cumulativeCompleted > context.quantity || (finished && cumulativeCompleted !== context.quantity)) return state;
  if (task.kind !== "shipyard" && (!finished || cumulativeCompleted !== 1)) return state;
  const delta = task.kind === "shipyard" ? cumulativeCompleted - task.activeJob.credited : 0;
  if (task.kind === "shipyard" && task.completedUnits + delta > task.quantity) return state;
  if (!finished && delta === 0) return state;
  const completed = finished && (context.goalOnFinish || (task.kind === "shipyard" && task.completedUnits + delta >= task.quantity));
  return replaceTask(state, { ...task, completedUnits: task.completedUnits + delta, status: completed ? "completed" : task.status, activeJob: finished ? null : { ...task.activeJob, credited: cumulativeCompleted }, reason: completed ? "有限目标已完成" : finished ? "付费任务已完成" : "付费任务进行中" });
}
export function cancelledPaidJob(state: GameState, ref: PaidJobRef): GameState {
  const task = paidContext(state, ref)?.task;
  return task ? replaceTask(state, { ...task, activeJob: null, status: "paused", reason: "付费任务已取消；计划暂停，继续需重新授权" }) : state;
}
