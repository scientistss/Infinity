import balance from "../data/balance.json";
import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId, unitById, SHIP_IDS } from "../data/units";
import {
  createOrderState, MAX_LIVE_ORDER_TASKS, MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY,
  MAX_ORDER_REASON_LENGTH, MAX_ORDER_TASKS, ORDER_PASS_SECONDS,
  MAX_ORDER_TRIPS, MAX_ORDER_TRIP_RECEIPTS, MIN_ORDER_SPEED_PERCENT, MAX_ORDER_SPEED_PERCENT, ORDER_SPEED_STEP,
  type OrderCurrentWork, type OrderWorkSpec, type OrderTransportState, type OrderTripPhase, type OrderDeliveryOutcome,
  type OrderJobReceipt, type OrderMoney, type OrderState, type OrderTarget, type OrderTask,
} from "./order-state";
import { addOrderAmounts, compareOrderAmounts, isOrderAmount, multiplyOrderAmountInteger, subtractOrderAmounts } from "./order-money";
import { big } from "./decimal";
import { sameCoordinates, SPACE, validCoordinates } from "./galaxy";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";
import { readFormationOrigin } from "./formations-save";

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
  const prototype = Object.getPrototypeOf(raw), own = Reflect.ownKeys(raw);
  if ((prototype !== Object.prototype && prototype !== null) || own.length !== expected.length ||
      own.some(key => typeof key !== "string" || !expected.includes(key))) throw Error(`${label}字段无效`);
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
function exactWalletAmount(raw: unknown, label: string): string {
  if (!isOrderAmount(raw) || compareOrderAmounts(raw, big(raw).toString()) !== 0) throw Error(`${label}快照精度无法保留`);
  return raw;
}
function exactWalletMoney(raw: unknown, label: string): OrderMoney {
  const value = money(raw, label);
  for (const res of RESOURCE_IDS) exactWalletAmount(value[res], label);
  return value;
}
function outcome(raw: unknown): OrderDeliveryOutcome {
  if (!record(raw)) throw Error("运输交付裁决缺失");
  if (raw.kind === "delivered") { keys(raw, ["kind"], "已交付裁决"); return { kind: "delivered" }; }
  if (raw.kind !== "not-delivered" || typeof raw.reason !== "string" || !["manual-recall", "plan-cancel", "goal-satisfied", "target-invalid", "precision-rejected"].includes(raw.reason)) throw Error("运输交付裁决无效");
  keys(raw, ["kind", "reason"], "未交付裁决");
  return { kind: "not-delivered", reason: raw.reason as Extract<OrderDeliveryOutcome, { kind: "not-delivered" }>["reason"] };
}
function phase(raw: unknown): OrderTripPhase {
  if (!record(raw)) throw Error("运输阶段缺失");
  if (raw.kind === "outbound") { keys(raw, ["kind"], "出航阶段"); return { kind: "outbound" }; }
  if (raw.kind === "returning") {
    keys(raw, ["kind", "outcome", "dockBlocked"], "返航阶段");
    if (typeof raw.dockBlocked !== "boolean") throw Error("返港受阻标记无效");
    return { kind: "returning", outcome: outcome(raw.outcome), dockBlocked: raw.dockBlocked };
  }
  if (raw.kind === "returned") { keys(raw, ["kind", "outcome"], "已返港阶段"); return { kind: "returned", outcome: outcome(raw.outcome) }; }
  if (raw.kind === "prestige-retired") {
    keys(raw, ["kind", "outcome"], "重生封存阶段");
    return { kind: "prestige-retired", outcome: raw.outcome === null ? null : outcome(raw.outcome) };
  }
  throw Error("运输阶段无效");
}
function transport(raw: unknown): OrderTransportState | null {
  if (raw === null) return null;
  if (!record(raw)) throw Error("运输授权缺失");
  keys(raw, ["authorization", "trips"], "运输状态");
  const auth = raw.authorization;
  if (!record(auth)) throw Error("运输授权缺失");
  keys(auth, ["donorPlanetId", "ship", "count", "speedPercent", "maxTrips", "grossCargoCap"], "运输授权");
  if (typeof auth.ship !== "string" || !(SHIP_IDS as readonly string[]).includes(auth.ship) || auth.ship === "solar_satellite") throw Error("运输舰种无效");
  const speedPercent = integer(auth.speedPercent, "运输速度", MIN_ORDER_SPEED_PERCENT, MAX_ORDER_SPEED_PERCENT);
  if (speedPercent % ORDER_SPEED_STEP) throw Error("运输速度步长无效");
  const maxTrips = integer(auth.maxTrips, "运输次数上限", 1, MAX_ORDER_TRIPS);
  if (!Array.isArray(raw.trips) || raw.trips.length > maxTrips) throw Error("运输次数超过授权上限");
  return {
    authorization: { donorPlanetId: planetId(auth.donorPlanetId), ship: auth.ship as OrderTransportState["authorization"]["ship"],
      count: integer(auth.count, "运输舰船数量", 1, SPACE.maxShips), speedPercent, maxTrips,
      grossCargoCap: money(auth.grossCargoCap, "累计毛货物上限") },
    trips: raw.trips.map(entry => {
      if (!record(entry)) throw Error("运输回执缺失");
      keys(entry, ["fleetId", "workId", "targetPlanetId", "target", "cargo", "fuel", "duration", "phase"], "运输回执");
      if (!record(entry.target) || !validCoordinates(entry.target)) throw Error("运输回执坐标无效");
      keys(entry.target, ["galaxy", "system", "position"], "运输坐标");
      if (typeof entry.duration !== "number" || !Number.isFinite(entry.duration) || entry.duration < SPACE.minFlightSeconds || entry.duration > 1e12) throw Error("运输航时无效");
      const cargo = exactWalletMoney(entry.cargo, "运输货单");
      if (RESOURCE_IDS.every(res => compareOrderAmounts(cargo[res], "0") === 0)) throw Error("运输不能为空货单");
      const fuel = exactWalletAmount(entry.fuel, "运输燃料");
      if (compareOrderAmounts(fuel, "0") !== 1) throw Error("运输燃料必须为正数");
      return { fleetId: integer(entry.fleetId, "运输舰队 ID", 1, MAX_ID), workId: integer(entry.workId, "运输工作 ID", 1, MAX_ID),
        targetPlanetId: planetId(entry.targetPlanetId), target: { ...entry.target }, cargo,
        fuel, duration: entry.duration, phase: phase(entry.phase) };
    }),
  };
}
function workSpec(raw: unknown): OrderWorkSpec {
  if (!record(raw)) throw Error("运输子目标缺失");
  if (raw.kind === "building" && typeof raw.building === "string" && isBuildingId(raw.building)) {
    keys(raw, ["kind", "building", "targetLevel", "price"], "运输建筑子目标");
    return { kind: "building", building: raw.building, targetLevel: integer(raw.targetLevel, "子目标等级", 1, MAX_ORDER_LEVEL), price: exactWalletMoney(raw.price, "子目标价格") };
  }
  if (raw.kind === "research" && typeof raw.tech === "string" && isResearchId(raw.tech)) {
    keys(raw, ["kind", "tech", "targetLevel", "price"], "运输研究子目标");
    return { kind: "research", tech: raw.tech, targetLevel: integer(raw.targetLevel, "子目标等级", 1, MAX_ORDER_LEVEL), price: exactWalletMoney(raw.price, "子目标价格") };
  }
  if (raw.kind === "shipyard" && isUnitId(raw.unit)) {
    keys(raw, ["kind", "unit", "quantity", "completedUnitsAtStart", "paidPerUnit"], "运输造船子目标");
    return { kind: "shipyard", unit: raw.unit, quantity: integer(raw.quantity, "子目标数量", 1, Math.min(MAX_ORDER_QUANTITY, balance.shipyard.maxBatch)),
      completedUnitsAtStart: integer(raw.completedUnitsAtStart, "子目标完成水位", 0, MAX_ORDER_QUANTITY), paidPerUnit: exactWalletMoney(raw.paidPerUnit, "子目标单价") };
  }
  throw Error("运输子目标无效");
}
function currentWork(raw: unknown): OrderCurrentWork | null {
  if (raw === null) return null;
  if (!record(raw) || (raw.stage !== "pending" && raw.stage !== "paid")) throw Error("运输当前工作缺失或无效");
  keys(raw, ["workId", "spec", "shipmentFleetId", "stage", raw.stage === "pending" ? "reserved" : "jobId"], "运输当前工作");
  const identity = { workId: integer(raw.workId, "运输工作 ID", 1, MAX_ID), spec: workSpec(raw.spec),
    shipmentFleetId: raw.shipmentFleetId === null ? null : integer(raw.shipmentFleetId, "工作舰队 ID", 1, MAX_ID) };
  return raw.stage === "pending" ? { ...identity, stage: "pending", reserved: money(raw.reserved, "工作预算预留") }
    : { ...identity, stage: "paid", jobId: integer(raw.jobId, "工作付款 ID", 1, MAX_ID) };
}
function tripFuel(task: OrderTask): string {
  let total = "0";
  for (const trip of task.transport?.trips ?? []) {
    const sum = addOrderAmounts(total, trip.fuel);
    if (sum === null) throw Error("运输历史燃料累计溢出");
    total = sum;
  }
  return total;
}

function task(raw: unknown, revision: 5 | 6 | 8): OrderTask {
  if (!record(raw)) throw Error("计划数据格式不正确");
  let target: OrderTarget;
  const common = ["kind", "planetId", "id", "status", "reason", "budget", "charged", "refunded", "activeJob", "completedUnits", ...(revision >= 6 ? ["transport", "currentWork"] : []), ...(revision === 8 ? ["formationOrigin"] : [])];
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
    transport: revision >= 6 ? transport(raw.transport) : null, currentWork: revision >= 6 ? currentWork(raw.currentWork) : null,
    formationOrigin: revision === 8 ? readFormationOrigin(raw.formationOrigin) : null,
    activeJob: receipt(raw.activeJob), completedUnits: integer(raw.completedUnits, "计划已完成数量", 0, target.kind === "shipyard" ? target.quantity : 0) };
  for (const res of RESOURCE_IDS) {
    const net = subtractOrderAmounts(result.charged[res], result.refunded[res]);
    if (net === null || compareOrderAmounts(net, result.budget[res]) === 1) throw Error("计划净支出超出预算或退款超出付款");
  }
  if (!live(result) && (result.activeJob !== null || result.currentWork !== null)) throw Error("终止计划不能保留付款凭证");
  if (result.kind === "shipyard" && result.status === "completed" && result.completedUnits !== result.quantity) throw Error("造船计划完成数量不一致");
  if (result.transport === null && result.currentWork !== null) throw Error("本地计划不能夹带运输工作");
  return result;
}

export function serializeOrders(orders: OrderState): OrderState {
  // Parse and clone all fields so unknown live authority cannot disappear silently.
  return readOrders(orders);
}

/** Order subformats differ from envelopes: both r6 and r7 envelopes contain subformat 6. */
export function readOrders(raw: unknown, revision: 5 | 6 | 8 = 8): OrderState {
  if (!record(raw)) throw Error(`r${revision} 有限计划数据缺失`);
  keys(raw, ["nextTaskId", "nextJobId", ...(revision >= 6 ? ["nextWorkId"] : []), "accumulator", "tasks"], "有限计划");
  if (!Array.isArray(raw.tasks) || raw.tasks.length > MAX_ORDER_TASKS) throw Error("计划列表过长或无效");
  const tasks = raw.tasks.map(entry => task(entry, revision));
  const nextTaskId = integer(raw.nextTaskId, "下一计划 ID", 1, Number.MAX_SAFE_INTEGER);
  const nextJobId = integer(raw.nextJobId, "下一付款 ID", 1, Number.MAX_SAFE_INTEGER);
  const nextWorkId = revision >= 6 ? integer(raw.nextWorkId, "下一工作 ID", 1, Number.MAX_SAFE_INTEGER) : 1;
  if (new Set(tasks.map(entry => entry.id)).size !== tasks.length || tasks.some(entry => entry.id >= nextTaskId)) throw Error("计划 ID 重复或计数器过期");
  if (tasks.filter(live).length > MAX_LIVE_ORDER_TASKS) throw Error("进行中的计划过多");
  if (typeof raw.accumulator !== "number" || !Number.isFinite(raw.accumulator) || raw.accumulator < 0 || raw.accumulator >= ORDER_PASS_SECONDS) throw Error("计划计时无效");
  if (!tasks.some(entry => entry.status === "running") && raw.accumulator !== 0) throw Error("停用计划不能保留计时");
  if (tasks.some(entry => entry.activeJob && entry.activeJob.jobId >= nextJobId)) throw Error("计划付款 ID 计数器过期");
  if (tasks.reduce((sum, entry) => sum + (entry.transport?.trips.length ?? 0), 0) > MAX_ORDER_TRIP_RECEIPTS) throw Error("运输历史回执超过全局上限");
  return { nextTaskId, nextJobId, nextWorkId, accumulator: raw.accumulator, tasks };
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
      const refundable = net === null ? null : subtractOrderAmounts(net, res === "deuterium" ? tripFuel(owner) : "0");
      if (refund === null || refundable === null || compareOrderAmounts(refund, refundable) === 1) throw Error("计划剩余退款超过净支出");
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
  const { nextWorkId: _nextWorkId, ...orders } = createOrderState();
  return { ...raw, planets, research, orders: { ...orders, nextJobId } };
}

function equalMoney(a: OrderMoney, b: OrderMoney): boolean {
  return RESOURCE_IDS.every(res => compareOrderAmounts(a[res], b[res]) === 0);
}
function walletMoney(value: ResourceAmounts): OrderMoney {
  return { metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() };
}
function remainingPrice(task: OrderTask, spec: OrderWorkSpec): OrderMoney {
  if (spec.kind !== task.kind) throw Error("运输子目标种类不一致");
  if (spec.kind === "building") {
    if (task.kind !== "building" || spec.building !== task.building || spec.targetLevel > task.targetLevel) throw Error("运输建筑子目标不一致");
    return spec.price;
  }
  if (spec.kind === "research") {
    if (task.kind !== "research" || spec.tech !== task.tech || spec.targetLevel > task.targetLevel) throw Error("运输研究子目标不一致");
    return spec.price;
  }
  if (task.kind !== "shipyard" || spec.unit !== task.unit || spec.completedUnitsAtStart > task.completedUnits ||
      spec.completedUnitsAtStart + spec.quantity > task.quantity) throw Error("运输造船子目标或完成水位不一致");
  const count = spec.quantity - (task.completedUnits - spec.completedUnitsAtStart);
  if (count <= 0) throw Error("已完成运输子目标不能保留当前工作");
  const result = {} as OrderMoney;
  for (const res of RESOURCE_IDS) {
    const amount = multiplyOrderAmountInteger(spec.paidPerUnit[res], count);
    if (amount === null) throw Error("运输工作预留累计溢出");
    result[res] = amount;
  }
  return result;
}

/** Cross-reference immutable authority against real work and fleets; never infer a delivery. */
export function validateOrderTransportReferences(state: GameState): void {
  const workOwners = new Map<number, number>(), receiptFleets = new Set<number>(), activeFleets = new Set<number>();
  function claimWork(workId: number, taskId: number): void {
    if (workId >= state.orders.nextWorkId) throw Error("运输工作计数器过期");
    const owner = workOwners.get(workId);
    if (owner !== undefined && owner !== taskId) throw Error("运输历史工作被跨计划冒领");
    workOwners.set(workId, taskId);
  }
  for (const task of state.orders.tasks) {
    const transport = task.transport, work = task.currentWork;
    if (transport === null) {
      if (work !== null) throw Error("本地计划不能拥有运输工作");
      continue;
    }
    const auth = transport.authorization;
    const donor = state.planets.find(planet => planet.id === auth.donorPlanetId);
    const payer = state.planets.find(planet => planet.id === task.planetId);
    if (auth.donorPlanetId === task.planetId) throw Error("运输来源和执行星球不能相同");
    if (live(task) && (!donor || !payer)) throw Error("运输来源或执行星球不存在");
    const tripWorks = new Set<number>();
    const gross: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
    let activeCount = 0;
    for (const trip of transport.trips) {
      claimWork(trip.workId, task.id);
      if (tripWorks.has(trip.workId)) throw Error("同一运输工作不能再次出航");
      tripWorks.add(trip.workId);
      if (receiptFleets.has(trip.fleetId) || trip.fleetId >= state.nextFleetId) throw Error("运输舰队回执重复或计数器过期");
      receiptFleets.add(trip.fleetId);
      if (trip.targetPlanetId !== task.planetId) throw Error("运输回执执行星球不一致");
      for (const res of RESOURCE_IDS) {
        const sum = addOrderAmounts(gross[res], trip.cargo[res]);
        if (sum === null || compareOrderAmounts(sum, auth.grossCargoCap[res]) === 1) throw Error("运输累计毛货物超过授权");
        gross[res] = sum;
      }
      const fleet = state.fleets.find(entry => entry.id === trip.fleetId);
      if (trip.phase.kind !== "outbound" && trip.phase.kind !== "returning") {
        if (fleet) throw Error("已结清运输回执不能保留真实舰队");
        if (trip.phase.kind === "prestige-retired" && live(task)) throw Error("重生封存运输不能仍在进行");
        continue;
      }
      activeCount += 1;
      if (activeCount > 1) throw Error("每个计划最多一艘在途运输舰队");
      if (!fleet || fleet.orderTransport?.taskId !== task.id || fleet.orderTransport.workId !== trip.workId) throw Error("运输回执没有唯一真实舰队归属");
      activeFleets.add(fleet.id);
      if (!donor || fleet.originId !== auth.donorPlanetId || fleet.mission !== "transport" || fleet.charge !== undefined ||
          !sameCoordinates(fleet.target, trip.target) || fleet.duration !== trip.duration) throw Error("运输舰队来源、目标或航时不一致");
      const ships = Object.entries(fleet.ships);
      if (ships.length !== 1 || ships[0]![0] !== auth.ship || ships[0]![1] !== auth.count) throw Error("运输舰队不符合固定舰种数量");
      if (!payer) {
        if (task.status !== "cancelled" || trip.phase.kind !== "returning" || trip.phase.outcome.kind !== "not-delivered" || trip.phase.outcome.reason !== "target-invalid") throw Error("运输执行星球不存在");
      } else if (!sameCoordinates(payer.coordinates, trip.target) &&
          (trip.phase.kind !== "returning" || trip.phase.outcome.kind !== "not-delivered" || trip.phase.outcome.reason !== "target-invalid")) throw Error("运输执行星球坐标身份不一致");
      if (trip.phase.kind === "outbound") {
        if (!live(task) || fleet.returning || !equalMoney(walletMoney(fleet.cargo), trip.cargo)) throw Error("运输出航阶段或真实货物不一致");
      } else {
        const expectedCargo = trip.phase.outcome.kind === "delivered" ? { metal: "0", crystal: "0", deuterium: "0" } : trip.cargo;
        if (!fleet.returning || !equalMoney(walletMoney(fleet.cargo), expectedCargo)) throw Error("运输返航阶段或真实货物不一致");
        if (trip.phase.dockBlocked && (fleet.remaining !== 0 || task.status === "running")) throw Error("返港入库受阻状态不一致");
      }
    }
    const activeTrip = transport.trips.find(trip => trip.phase.kind === "outbound" || trip.phase.kind === "returning");
    if (activeTrip && work && activeTrip.workId !== work.workId) throw Error("旧运输未返港不能开启下一工作");
    if (activeTrip?.phase.kind === "outbound" && (!work || work.stage !== "pending")) throw Error("运输出航缺少原待付工作");
    const fuel = tripFuel(task);
    for (const res of RESOURCE_IDS) {
      const net = subtractOrderAmounts(task.charged[res], task.refunded[res]);
      const reserve = work?.stage === "pending" ? work.reserved[res] : "0";
      const occupied = net === null ? null : addOrderAmounts(net, reserve);
      if (occupied === null || compareOrderAmounts(occupied, task.budget[res]) === 1) throw Error("运输净支出与预留超过预算");
      if (res === "deuterium" && compareOrderAmounts(net!, fuel) === -1) throw Error("运输退款侵占不可退燃料");
    }
    if (!work) {
      if (task.activeJob) throw Error("运输付款缺少当前工作");
      continue;
    }
    claimWork(work.workId, task.id);
    if (!live(task)) throw Error("终止计划不能保留运输工作");
    const remaining = remainingPrice(task, work.spec);
    const trip = transport.trips.find(entry => entry.workId === work.workId);
    if ((trip?.fleetId ?? null) !== work.shipmentFleetId) throw Error("运输工作出航身份不能清空或改写");
    if (work.stage === "pending") {
      if ((work.spec.kind === "building" && work.spec.targetLevel > payer!.buildings[work.spec.building] + 1) ||
          (work.spec.kind === "research" && work.spec.targetLevel > state.research.levels[work.spec.tech] + 1)) throw Error("待付运输工作不能越过未完成的前置等级");
      if (task.activeJob !== null || !equalMoney(work.reserved, remaining)) throw Error("运输待付工作付款或预留不一致");
      continue;
    }
    if (work.jobId >= state.orders.nextJobId || task.activeJob?.jobId !== work.jobId) throw Error("运输工作付款身份不一致");
    if (trip?.phase.kind === "outbound" || (trip?.phase.kind === "returning" && trip.phase.outcome.kind !== "delivered")) throw Error("运输尚未交付或返港不能付款");
    const spec = work.spec;
    if (spec.kind === "building") {
      const index = payer!.buildQueue.findIndex(job => job.jobId === work.jobId), job = payer!.buildQueue[index];
      if (!job || job.building !== spec.building || job.targetLevel !== spec.targetLevel || !equalMoney(walletMoney(job.paid), spec.price) ||
          payer!.buildings[spec.building] + 1 !== spec.targetLevel || payer!.buildQueue.slice(0, index).some(other => other.building === spec.building)) throw Error("运输建筑付款与冻结子目标不一致");
    } else if (spec.kind === "research") {
      const index = state.research.queue.findIndex(job => job.jobId === work.jobId), job = state.research.queue[index];
      if (!job || job.tech !== spec.tech || job.targetLevel !== spec.targetLevel || !equalMoney(walletMoney(job.paid), spec.price) ||
          state.research.levels[spec.tech] + 1 !== spec.targetLevel || state.research.queue.slice(0, index).some(other => other.tech === spec.tech)) throw Error("运输研究付款与冻结子目标不一致");
    } else {
      const job = payer!.shipyardQueue.find(entry => entry.jobId === work.jobId);
      if (!job || job.unit !== spec.unit || !equalMoney(walletMoney(job.paidPerUnit), spec.paidPerUnit) ||
          job.count !== spec.quantity - (task.completedUnits - spec.completedUnitsAtStart) ||
          task.completedUnits - spec.completedUnitsAtStart < task.activeJob!.credited) throw Error("运输造船付款与冻结子目标完成水位不一致");
    }
  }
  if (state.fleets.some(fleet => fleet.orderTransport !== null && !activeFleets.has(fleet.id))) throw Error("真实运输舰队没有唯一活跃回执");
}

/** Old revisions must never use migration to erase unknown transport authority. */
export function rejectLegacyTransportFields(raw: unknown): void {
  const forbidden = new Set(["transport", "currentWork", "nextWorkId", "orderTransport", "workId", "shipmentFleetId", "grossCargoCap", "donorPlanetId", "dockBlocked", "trips", "authorization", "targetPlanetId", "completedUnitsAtStart", "maxTrips"]);
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { for (const entry of value) inspect(entry); return; }
    if (!record(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (forbidden.has(key)) throw Error("旧修订不能夹带 r6 运输授权、工作或舰队归属");
      inspect(entry);
    }
  }
  inspect(raw);
}

/** Validate the r5 ledger first, then add empty transport authority without touching economics. */
export function migrateTransportOrders(raw: unknown): Record<string, unknown> {
  if (!record(raw)) throw Error("存档状态格式不正确");
  rejectLegacyTransportFields(raw);
  const orders = readOrders(raw.orders, 5);
  if (!Array.isArray(raw.fleets) || raw.fleets.length > SPACE.maxFleets) throw Error("旧版舰队列表无效");
  const fleets = raw.fleets.map(fleet => {
    if (!record(fleet)) throw Error("旧版舰队格式无效");
    return { ...fleet, orderTransport: null };
  });
  return { ...raw, orders, fleets };
}
