import { activePlanet, withPlanet } from "./empire";
/**
 * Build queue (design doc §5.5). One order under construction per planet, the rest wait.
 * Cost is charged on enqueue at the order's target level and refunded in full on cancel.
 * Duration is computed when an order starts, from the robotics/nanite levels at that moment.
 */
import { buildingById, isBuildingAvailable, type BuildingDef, type BuildingId } from "../data/buildings";
import { growthCut } from "../prestige/tree";
import { QUEUE_BASE_CAPACITY, resourceName } from "./content";
import { big } from "./decimal";
import { storageCaps } from "./economy";
import { formatAmount } from "./format";
import { buildSeconds, buildingCost, type ResourceCost } from "./formulas";
import { clonePlanet, usedFields, type BuildOrder, type OrderSource, type PlanetState } from "./planet";
import { missingRequirements as missingFrom } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";
import { cancelledPaidJob, creditPaidJob, ORDER_IDENTITY_REASON, preparePaidJob, refundPaidJob, validOwnedPaidJob } from "./order-ledger";
import { subtractOrderAmounts } from "./order-money";
import { MAX_ORDER_LEVEL, type OrderMoney } from "./order-state";
import { isLegacyTerraformerJob, TERRAFORMER_FIELDS_PER_LEVEL, terraformerCompletionProblem, terraformerEnqueueProblem, terraformerStateProblem } from "./terraformer";

export interface EnqueueCheck {
  ok: boolean;
  /** Chinese reason when not ok; empty when ok. */
  reason: string;
  targetLevel: number;
  cost: ResourceCost;
  /** True when the only blocker is missing resources (everything else would allow it). */
  onlyResources?: boolean;
}

export interface QueueResult {
  jobId?: number;
  state: GameState;
  ok: boolean;
  reason: string;
}

/** A rejected legacy retarget is strictly a no-op, including higher-level plan wrappers. */
export const QUEUE_TARGET_CANCEL_REASON = "取消会使后续已付任务的目标等级无效，原队列和资源已保留";
export const QUEUE_TERRAFORMER_CANCEL_REASON = "取消会破坏地形改造器付费凭证或格子账，原队列和资源已保留";
export function isAtomicQueueCancellationReason(reason: string): boolean {
  return reason === QUEUE_TARGET_CANCEL_REASON || reason === QUEUE_TERRAFORMER_CANCEL_REASON;
}

export interface CompletedBuild {
  building: BuildingId;
  level: number;
}

export function queueCapacity(_state: GameState): number {
  return QUEUE_BASE_CAPACITY;
}

export function queuedCount(planet: PlanetState, id: BuildingId): number {
  return planet.buildQueue.reduce((count, order) => count + (order.building === id ? 1 : 0), 0);
}

/** Level the next order of `id` would build: built + already queued + 1. */
export function nextTargetLevel(planet: PlanetState, id: BuildingId): number {
  return planet.buildings[id] + queuedCount(planet, id) + 1;
}

export function costFor(state: GameState, id: BuildingId, level: number): ResourceCost {
  return buildingCost(buildingById(id), level, growthCut(state));
}

/** Seconds an order of `def` at `level` would take if it started now. */
export function secondsFor(state: GameState, def: BuildingDef, level: number, cost?: ResourceCost): number {
  const b = activePlanet(state).buildings;
  return buildSeconds(cost ?? costFor(state, def.id, level), level, def, b.robotics_factory, b.nanite_factory);
}

/**
 * Unmet prerequisites, buildings and research (checked against finished levels; queued ones do not count).
 * Levels already built stay even if a prerequisite would no longer hold.
 */
export function missingRequirements(state: GameState, def: BuildingDef): string[] {
  return missingFrom(state, def.requires);
}

const STORAGE_FOR = { metal: "metal_storage", crystal: "crystal_storage", deuterium: "deuterium_tank" } as const;

export function shortfall(state: GameState, cost: ResourceCost): string {
  const parts: string[] = [];
  const blocked: string[] = [];
  const caps = storageCaps(state);
  for (const id of RESOURCE_IDS) {
    const lack = cost[id].sub(activePlanet(state).resources[id]);
    if (!lack.gt(0)) continue;
    parts.push(`${resourceName(id)} ${formatAmount(lack)}`);
    if (cost[id].gt(caps[id])) blocked.push(buildingById(STORAGE_FOR[id]).nameZh);
  }
  if (parts.length === 0) return "";
  const hint = blocked.length > 0 ? `（超过仓库上限，先升级${blocked.join("、")}）` : "";
  return `缺 ${parts.join("、")}${hint}`;
}

export function canEnqueue(state: GameState, id: BuildingId): EnqueueCheck {
  const def = buildingById(id);
  const planet = activePlanet(state);
  const targetLevel = nextTargetLevel(planet, id);
  const cost = id === "terraformer" && (!Number.isSafeInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_ORDER_LEVEL)
    ? zeroCost() : costFor(state, id, targetLevel);
  const fail = (reason: string): EnqueueCheck => ({ ok: false, reason, targetLevel, cost });
  if (!isBuildingAvailable(def)) return fail(`第 ${def.phase} 阶段开放`);
  const missing = missingRequirements(state, def);
  if (missing.length > 0) return fail(`需要 ${missing.join("、")}`);
  if (id === "research_lab" && state.research.queue.length > 0) return fail("研究进行中，研究实验室不能升级");
  const capacity = queueCapacity(state);
  if (planet.buildQueue.length >= capacity) return fail(`建造队列已满（${planet.buildQueue.length}/${capacity}）`);
  if (usedFields(planet) + planet.buildQueue.length >= planet.fieldsMax) {
    return fail(`星球格子已满（${usedFields(planet)}/${planet.fieldsMax}）`);
  }
  if (id === "terraformer") {
    const problem = terraformerEnqueueProblem(state, targetLevel);
    if (problem) return fail(problem);
  }
  const lack = shortfall(state, cost);
  if (lack) return { ok: false, reason: lack, targetLevel, cost, onlyResources: true };
  return { ok: true, reason: "", targetLevel, cost };
}

/** Charge the cost and append an order. Starts it immediately when nothing is under construction. */
export function enqueue(state: GameState, id: BuildingId, source: OrderSource, taskId: number | null = null): QueueResult {
  const check = canEnqueue(state, id);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const payment = preparePaidJob(state, {
    kind: "building", planetId: state.activePlanetId, building: id,
    targetLevel: check.targetLevel, quantity: 1, source, taskId,
  }, check.cost);
  if (!payment.ok) return { state: payment.state, ok: false, reason: payment.reason };
  const planet = clonePlanet(activePlanet(payment.state));
  const order: BuildOrder = {
    jobId: payment.jobId,
    taskId,
    building: id,
    targetLevel: check.targetLevel,
    paid: { metal: check.cost.metal, crystal: check.cost.crystal, deuterium: check.cost.deuterium },
    totalSeconds: 0,
    remainingSeconds: 0,
    source,
  };
  planet.buildQueue.push(order);
  const stats =
    source === "manual" ? { ...state.stats, manualActions: state.stats.manualActions + 1 } : state.stats;
  const next = startNext({ ...withPlanet(payment.state, { planet }), stats });
  return { state: next, ok: true, jobId: payment.jobId, reason: `${buildingById(id).nameZh} → 等级 ${check.targetLevel} 已入队` };
}

/** Give the head order its duration if it has not started yet. */
export function startNext(state: GameState): GameState {
  const head = activePlanet(state).buildQueue[0];
  if (!head || head.totalSeconds > 0) return state;
  const planet = clonePlanet(activePlanet(state));
  const order = planet.buildQueue[0];
  if (!order) return state;
  const seconds = secondsFor(state, buildingById(order.building), order.targetLevel, order.paid);
  order.totalSeconds = seconds;
  order.remainingSeconds = seconds;
  return { ...withPlanet(state, { planet }) };
}

/** Finish the head order: level up, record stats, start the next one. */
export function completeActive(state: GameState): { state: GameState; completed: CompletedBuild | null; reason?: string } {
  const head = activePlanet(state).buildQueue[0];
  if (!head) return { state, completed: null };
  const terraformer = head.building === "terraformer";
  if (terraformer) {
    const problem = terraformerCompletionProblem(state, head);
    if (problem) return { state, completed: null, reason: problem };
  }
  const credited = creditPaidJob(state, { kind: "building", planetId: state.activePlanetId, jobId: head.jobId, taskId: head.taskId }, 1, true);
  // creditPaidJob intentionally returns the input on invalid receipts. A terraformer must
  // never grant fields or consume its paid job unless its plan credit actually succeeded.
  if (terraformer && head.source === "plan") {
    const receipt = credited.orders.tasks.find(task => task.id === head.taskId);
    if (credited === state || !receipt || receipt.activeJob !== null || receipt.currentWork !== null) {
      return { state, completed: null, reason: "地形改造器计划完成记账失败，原付费任务保留" };
    }
  }
  const planet = clonePlanet(activePlanet(credited));
  planet.buildQueue.shift();
  planet.buildings[head.building] = Math.max(planet.buildings[head.building], head.targetLevel);
  if (terraformer && !isLegacyTerraformerJob(state, head)) {
    planet.terraformerFields.grantedLevels += 1;
    planet.fieldsMax += TERRAFORMER_FIELDS_PER_LEVEL;
  }
  const stats = {
    ...state.stats,
    buildsCompleted: state.stats.buildsCompleted + 1,
    seenQueueIdle: state.stats.seenQueueIdle || planet.buildQueue.length === 0,
  };
  const next = startNext({ ...withPlanet(credited, { planet }), stats });
  return { state: next, completed: { building: head.building, level: head.targetLevel } };
}

/**
 * Cancel one order with a full refund (may exceed storage caps). Later orders of the same building
 * drop one level and get the price difference back.
 */
export function cancel(state: GameState, index: number): QueueResult {
  const target = activePlanet(state).buildQueue[index];
  if (!Number.isInteger(index) || !target) return { state, ok: false, reason: "队列中没有这一项" };
  // Historical readers accepted duplicate targets, including level 0 with [1, 1].
  // Keep that source state valid, but do not let cancellation manufacture target level 0.
  if (activePlanet(state).buildQueue.slice(index + 1).some(order => order.building === target.building
    && (!Number.isSafeInteger(order.targetLevel) || order.targetLevel <= 1))) {
    return { state, ok: false, reason: QUEUE_TARGET_CANCEL_REASON };
  }
  if (target.building === "terraformer") {
    if (terraformerStateProblem(state)) return { state, ok: false, reason: QUEUE_TERRAFORMER_CANCEL_REASON };
    // Already-broken receipts retain the existing owner-pause contract. The atomic
    // refusal below is specifically for damage this otherwise valid cancellation creates.
    if (!validTerraformerCancellationState(state)) return { state, ok: false, reason: ORDER_IDENTITY_REASON };
  }
  // Assemble every refund against a candidate. A later exact-ledger failure must not leak
  // an earlier refund, a level change, or a removed job into the returned state.
  let candidate = state;
  const planet = clonePlanet(activePlanet(state));
  const refund = (order: BuildOrder, amounts: ResourceCost, exact?: OrderMoney): string => {
    if (order.source === "plan") {
      const result = refundPaidJob(candidate, { kind: "building", planetId: planet.id, jobId: order.jobId, taskId: order.taskId }, exact ?? quotedBuildMoney(amounts));
      if (!result.ok) return result.reason;
      candidate = result.state;
    } else {
      const resources = { ...activePlanet(candidate).resources };
      for (const res of RESOURCE_IDS) resources[res] = resources[res].add(amounts[res]);
      candidate = withPlanet(candidate, { resources });
    }
    return "";
  };
  let reason = refund(target, target.paid);
  if (reason) return { state, ok: false, reason };
  planet.buildQueue.splice(index, 1);
  for (let i = index; i < planet.buildQueue.length; i += 1) {
    const order = planet.buildQueue[i];
    if (!order || order.building !== target.building) continue;
    order.targetLevel -= 1;
    const repriced = costFor(state, order.building, order.targetLevel);
    const amounts = zeroCost();
    const exact: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
    for (const res of RESOURCE_IDS) {
      const diff = order.paid[res].sub(repriced[res]);
      if (diff.gt(0)) {
        if (order.source === "plan") {
          const difference = subtractOrderAmounts(order.paid[res].toString(), repriced[res].toString());
          if (difference === null) return { state, ok: false, reason: "计划退款金额无法精确表示" };
          exact[res] = difference;
        }
        amounts[res] = diff;
        order.paid[res] = repriced[res];
      }
    }
    reason = refund(order, amounts, exact);
    if (reason) return { state, ok: false, reason };
    // A waiting order has no duration yet; a started one keeps its timer.
  }
  candidate = cancelledPaidJob(candidate, { kind: "building", planetId: planet.id, jobId: target.jobId, taskId: target.taskId });
  planet.resources = activePlanet(candidate).resources;
  const next = startNext(withPlanet(candidate, { planet }));
  if (target.building === "terraformer" && (!validTerraformerCancellationState(next)
    || target.source === "plan" && next.orders.tasks.find(task => task.id === target.taskId)?.activeJob !== null)) {
    return { state, ok: false, reason: QUEUE_TERRAFORMER_CANCEL_REASON };
  }
  return {
    state: next,
    ok: true,
    reason: `已取消 ${buildingById(target.building).nameZh} → 等级 ${target.targetLevel}，资源已全额退还`,
  };
}

function validTerraformerCancellationState(state: GameState): boolean {
  if (terraformerStateProblem(state)) return false;
  const planet = activePlanet(state);
  return planet.buildQueue.every(job => {
    if (job.building !== "terraformer" || job.source !== "plan") return true;
    const task = state.orders.tasks.find(value => value.id === job.taskId);
    return !!task && task.planetId === planet.id && task.activeJob?.jobId === job.jobId && validOwnedPaidJob(state, task);
  });
}

export function zeroCost(): ResourceCost {
  return { metal: big(0), crystal: big(0), deuterium: big(0) };
}

function quotedBuildMoney(cost: ResourceCost): OrderMoney {
  return { metal: cost.metal.toString(), crystal: cost.crystal.toString(), deuterium: cost.deuterium.toString() };
}
