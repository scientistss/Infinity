import balance from "../data/balance.json";
import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId, unitById } from "../data/units";
import {
  createOrderState, MAX_LIVE_ORDER_TASKS, MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY,
  MAX_ORDER_REASON_LENGTH, MAX_ORDER_TASKS, ORDER_PASS_SECONDS,
  type OrderJobReceipt, type OrderMoney, type OrderState, type OrderTarget, type OrderTask,
} from "./order-state";
import { compareOrderAmounts, isOrderAmount, multiplyOrderAmountInteger, subtractOrderAmounts } from "./order-money";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";

const MAX_ID = Number.MAX_SAFE_INTEGER - 1;
const live = (task: OrderTask) => task.status === "running" || task.status === "paused";
function record(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}
function integer(raw: unknown, label: string, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < min || raw > max) throw Error(`${label}整数无效`);
  return raw;
}
function keys(raw: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(raw).length !== expected.length || expected.some(key => !(key in raw))) throw Error(`${label}字段无效`);
}
function planetId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) throw Error("计划星球 ID 无效");
  return raw;
}
function money(raw: unknown, label: string): OrderMoney {
  if (!record(raw)) throw Error(`${label}缺失`);
  keys(raw, RESOURCE_IDS, label);
  for (const res of RESOURCE_IDS) if (!isOrderAmount(raw[res])) throw Error(`${label}数额无效`);
  return { metal: raw.metal as string, crystal: raw.crystal as string, deuterium: raw.deuterium as string };
}
function receipt(raw: unknown): OrderJobReceipt | null {
  if (raw === null) return null;
  if (!record(raw)) throw Error("计划付款凭证缺失");
  keys(raw, ["jobId", "quantity", "credited"], "计划付款凭证");
  const quantity = integer(raw.quantity, "计划付款数量", 1, MAX_ORDER_QUANTITY);
  return {
    jobId: integer(raw.jobId, "计划付款 ID", 1, MAX_ID), quantity,
    credited: integer(raw.credited, "计划完成水位", 0, quantity),
  };
}
function task(raw: unknown): OrderTask {
  if (!record(raw)) throw Error("计划数据格式不正确");
  let target: OrderTarget;
  const common = ["kind", "planetId", "id", "status", "reason", "budget", "charged", "refunded", "activeJob", "completedUnits"];
  if (raw.kind === "building" && typeof raw.building === "string" && isBuildingId(raw.building)) {
    keys(raw, [...common, "building", "targetLevel"], "建筑计划");
    target = { kind: "building", planetId: planetId(raw.planetId), building: raw.building,
      targetLevel: integer(raw.targetLevel, "建筑计划目标", 1, MAX_ORDER_LEVEL) };
  } else if (raw.kind === "research" && typeof raw.tech === "string" && isResearchId(raw.tech)) {
    keys(raw, [...common, "tech", "targetLevel"], "研究计划");
    target = { kind: "research", planetId: planetId(raw.planetId), tech: raw.tech,
      targetLevel: integer(raw.targetLevel, "研究计划目标", 1, MAX_ORDER_LEVEL) };
  } else if (raw.kind === "shipyard" && typeof raw.unit === "string" && isUnitId(raw.unit)) {
    keys(raw, [...common, "unit", "quantity"], "造船计划");
    target = { kind: "shipyard", planetId: planetId(raw.planetId), unit: raw.unit,
      quantity: integer(raw.quantity, "造船计划目标", 1, MAX_ORDER_QUANTITY) };
  } else throw Error("计划目标无效");
  const status = raw.status;
  if (status !== "running" && status !== "paused" && status !== "completed" && status !== "cancelled") throw Error("计划状态无效");
  if (typeof raw.reason !== "string" || raw.reason.length > MAX_ORDER_REASON_LENGTH) throw Error("计划状态说明无效");
  const result: OrderTask = { ...target, id: integer(raw.id, "计划 ID", 1, MAX_ID), status, reason: raw.reason,
    budget: money(raw.budget, "计划预算"), charged: money(raw.charged, "计划已支付"), refunded: money(raw.refunded, "计划已退款"),
    activeJob: receipt(raw.activeJob), completedUnits: integer(raw.completedUnits, "计划已完成数量", 0, target.kind === "shipyard" ? target.quantity : 0) };
  for (const res of RESOURCE_IDS) {
    const net = subtractOrderAmounts(result.charged[res], result.refunded[res]);
    if (net === null || compareOrderAmounts(net, result.budget[res]) === 1) throw Error("计划净支出超出预算或退款超出付款");
  }
  if (!live(result) && result.activeJob !== null) throw Error("终止计划不能保留付款凭证");
  if (result.kind === "shipyard" && result.status === "completed" && result.completedUnits !== result.quantity) throw Error("造船计划完成数量不一致");
  return result;
}

export function serializeOrders(orders: OrderState): OrderState {
  return { ...orders, tasks: orders.tasks.map(entry => ({ ...entry, budget: { ...entry.budget },
    charged: { ...entry.charged }, refunded: { ...entry.refunded }, activeJob: entry.activeJob ? { ...entry.activeJob } : null })) };
}

/** Revision 5 authorization is mandatory. Never reconstruct a missing ledger. */
export function readOrders(raw: unknown): OrderState {
  if (!record(raw)) throw Error("r5 有限计划数据缺失");
  keys(raw, ["nextTaskId", "nextJobId", "accumulator", "tasks"], "有限计划");
  if (!Array.isArray(raw.tasks) || raw.tasks.length > MAX_ORDER_TASKS) throw Error("计划列表过长或无效");
  const tasks = raw.tasks.map(task);
  const nextTaskId = integer(raw.nextTaskId, "下一计划 ID", 1, Number.MAX_SAFE_INTEGER);
  const nextJobId = integer(raw.nextJobId, "下一付款 ID", 1, Number.MAX_SAFE_INTEGER);
  if (new Set(tasks.map(entry => entry.id)).size !== tasks.length || tasks.some(entry => entry.id >= nextTaskId)) throw Error("计划 ID 重复或计数器过期");
  if (tasks.filter(live).length > MAX_LIVE_ORDER_TASKS) throw Error("进行中的计划过多");
  if (typeof raw.accumulator !== "number" || !Number.isFinite(raw.accumulator) || raw.accumulator < 0 || raw.accumulator >= ORDER_PASS_SECONDS) throw Error("计划计时无效");
  if (!tasks.some(entry => entry.status === "running") && raw.accumulator !== 0) throw Error("停用计划不能保留计时");
  if (tasks.some(entry => entry.activeJob && entry.activeJob.jobId >= nextJobId)) throw Error("计划付款 ID 计数器过期");
  return { nextTaskId, nextJobId, accumulator: raw.accumulator, tasks };
}

/** Validate actual queue ownership, exact remaining refund liabilities and fixed goals. */
export function validateOrderReferences(state: GameState): void {
  const { orders } = state;
  const tasks = new Map(orders.tasks.map(entry => [entry.id, entry]));
  const ids = new Set<number>(), owners = new Set<number>(), goals = new Set<string>();
  for (const entry of orders.tasks) {
    if (!live(entry)) continue;
    if (!state.planets.some(planet => planet.id === entry.planetId)) throw Error("计划出资星球不存在");
    const goal = entry.kind === "research" ? `research:${entry.tech}`
      : entry.kind === "building" ? `building:${entry.planetId}:${entry.building}` : `shipyard:${entry.planetId}:${entry.unit}`;
    if (goals.has(goal)) throw Error("进行中的计划目标重复");
    goals.add(goal);
  }
  function own(job: { jobId: number; taskId: number | null; source: string }, kind: OrderTask["kind"], payer: string): OrderTask | null {
    integer(job.jobId, "付款 ID", 1, MAX_ID);
    if (job.jobId >= orders.nextJobId || ids.has(job.jobId)) throw Error("付款 ID 重复或计数器过期");
    ids.add(job.jobId);
    if (job.source !== "plan") {
      if ((job.source !== "manual" && job.source !== "protocol") || job.taskId !== null) throw Error("普通队列不能拥有计划付款");
      return null;
    }
    integer(job.taskId, "付款计划 ID", 1, MAX_ID);
    const owner = tasks.get(job.taskId!);
    if (!owner || !live(owner) || owner.kind !== kind || owner.planetId !== payer || owner.activeJob?.jobId !== job.jobId || owners.has(owner.id)) throw Error("计划付款归属或出资星球不一致");
    owners.add(owner.id);
    return owner;
  }
  function liability(owner: OrderTask, paid: ResourceAmounts, count = 1): void {
    for (const res of RESOURCE_IDS) {
      const refund = multiplyOrderAmountInteger(paid[res].toString(), count);
      const net = subtractOrderAmounts(owner.charged[res], owner.refunded[res]);
      if (refund === null || net === null || compareOrderAmounts(refund, net) === 1) throw Error("计划剩余退款超过净支出");
    }
  }
  for (const planet of state.planets) {
    for (const job of planet.buildQueue) {
      const owner = own(job, "building", planet.id);
      if (!owner) continue;
      if (owner.kind !== "building" || owner.building !== job.building || job.targetLevel > owner.targetLevel ||
          owner.activeJob!.quantity !== 1 || owner.activeJob!.credited !== 0) throw Error("建筑计划目标或凭证不一致");
      liability(owner, job.paid);
    }
    for (const job of planet.shipyardQueue) {
      const owner = own(job, "shipyard", planet.id);
      if (!owner) continue;
      const receipt = owner.activeJob!;
      if (owner.kind !== "shipyard" || owner.unit !== job.unit || receipt.quantity !== job.orderedCount ||
          receipt.quantity - receipt.credited !== job.count || owner.completedUnits < receipt.credited ||
          owner.completedUnits + job.count > owner.quantity) throw Error("造船计划目标、数量或完成水位不一致");
      liability(owner, job.paidPerUnit, job.count);
    }
  }
  for (const job of state.research.queue) {
    const owner = own(job, "research", job.planetId);
    if (!owner) continue;
    if (owner.kind !== "research" || owner.tech !== job.tech || job.targetLevel > owner.targetLevel ||
        owner.activeJob!.quantity !== 1 || owner.activeJob!.credited !== 0) throw Error("研究计划目标或凭证不一致");
    liability(owner, job.paid);
  }
  if (orders.tasks.some(entry => entry.activeJob !== null && !owners.has(entry.id))) throw Error("计划付款凭证没有对应队列");
}

/** Pure deterministic metadata migration; old economics, timers and payer IDs are untouched. */
export function migrateLegacyOrders(raw: unknown): Record<string, unknown> {
  if (!record(raw)) throw Error("存档状态格式不正确");
  if ("orders" in raw) throw Error("旧修订不能夹带 r5 有限计划授权数据");
  let nextJobId = 1;
  function migrateJob(entry: unknown, shipyard: boolean): Record<string, unknown> {
    if (!record(entry)) throw Error("旧版付款队列格式不正确");
    if (["jobId", "taskId", "orderedCount", "paidPerUnit"].some(key => key in entry) || entry.source === "plan") throw Error("旧修订不能夹带 r5 付款身份或授权数据");
    const identity = { jobId: nextJobId++, taskId: null };
    if (!shipyard) return { ...entry, ...identity };
    if (typeof entry.unit !== "string" || !isUnitId(entry.unit)) throw Error("旧版造船单位无效");
    const cost = unitById(entry.unit).cost;
    return { ...entry, ...identity, orderedCount: entry.count,
      paidPerUnit: { metal: String(cost.metal), crystal: String(cost.crystal), deuterium: String(cost.deuterium) } };
  }
  if (!Array.isArray(raw.planets) || raw.planets.length < 1 || raw.planets.length > 100) throw Error("旧版星球列表无效");
  const planets = raw.planets.map(planet => {
    if (!record(planet) || !Array.isArray(planet.buildQueue) || planet.buildQueue.length > 5 ||
        !Array.isArray(planet.shipyardQueue) || planet.shipyardQueue.length > balance.shipyard.maxOrders) throw Error("旧版星球队列无效");
    return { ...planet, buildQueue: planet.buildQueue.map(entry => migrateJob(entry, false)),
      shipyardQueue: planet.shipyardQueue.map(entry => migrateJob(entry, true)) };
  });
  let research = raw.research;
  if (record(research) && Array.isArray(research.queue)) {
    if (research.queue.length > 5) throw Error("旧版研究队列过长");
    research = { ...research, queue: research.queue.map(entry => migrateJob(entry, false)) };
  }
  return { ...raw, planets, research, orders: { ...createOrderState(), nextJobId } };
}
