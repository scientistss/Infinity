import { actualPaidJobs, paidJobIdentityProblem } from "./paid-job-identity";
import { activePlanet } from "./empire";
import { isValidAmount } from "./decimal";
import { economy } from "./economy";
import { validOwnedPaidJob } from "./order-ledger";
import { MAX_ORDER_LEVEL } from "./order-state";
import { readOrders, validateOrderReferences, validateOrderTransportReferences } from "./orders-save";
import type { BuildOrder, PlanetState } from "./planet";
import { RESOURCE_IDS, type GameState } from "./types";

export const TERRAFORMER_FIELDS_PER_LEVEL = 5;
export const MAX_PLANET_FIELDS = 10000;
export const LEGACY_TERRAFORMER_REASON = "此星球仍有旧版已付地形改造器，须待其完成或明确取消后才能新付款；旧项保留费用和计时，完成不增加格子";

/** An enqueue-only supply threshold. Resource discounts never reduce this requirement. */
export function terraformerEnergyRequirement(targetLevel: number): number {
  if (!Number.isSafeInteger(targetLevel) || targetLevel < 1 || targetLevel > MAX_ORDER_LEVEL) return Number.NaN;
  return Math.floor(1000 * Math.pow(2, targetLevel - 1));
}

export function isLegacyTerraformerJob(state: GameState, job: BuildOrder): boolean {
  return job.building === "terraformer" && job.jobId < state.terraformerGrantJobFloor;
}

export function pendingTerraformerGrants(state: GameState, planet: PlanetState): number {
  return planet.buildQueue.filter(job => job.building === "terraformer" && job.jobId >= state.terraformerGrantJobFloor).length;
}

/**
 * The common runtime/save invariant. It does not impose new field-usage or target-sequence
 * rules on historical paid jobs or any non-terraformer queue. A finished grant consumes
 * one new paid identity, so grants plus all still-paid new identities share the issue space.
 */
export function terraformerStateProblem(state: GameState): string | null {
  const floor = state.terraformerGrantJobFloor;
  const nextJobId = state.orders.nextJobId;
  if (!Number.isSafeInteger(nextJobId) || nextJobId < 1 || !Number.isSafeInteger(floor) || floor < 1 || floor > nextJobId) {
    return "地形改造器付款边界或任务编号无效";
  }
  let granted = 0;
  const planetIds = new Set<string>();
  for (const planet of state.planets) {
    if (planetIds.has(planet.id)) return "地形改造器所属星球身份重复";
    planetIds.add(planet.id);
    const ledger = planet.terraformerFields;
    const level = planet.buildings.terraformer;
    if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)
      || Object.keys(ledger).length !== 2 || !Object.hasOwn(ledger, "base") || !Object.hasOwn(ledger, "grantedLevels")
      || !Number.isSafeInteger(ledger.base) || ledger.base < 1 || ledger.base > MAX_PLANET_FIELDS
      || !Number.isSafeInteger(ledger.grantedLevels) || ledger.grantedLevels < 0
      || !Number.isSafeInteger(level) || level < 0 || level > MAX_ORDER_LEVEL || ledger.grantedLevels > level
      || !Number.isSafeInteger(planet.fieldsMax) || planet.fieldsMax > MAX_PLANET_FIELDS
      || planet.fieldsMax !== ledger.base + TERRAFORMER_FIELDS_PER_LEVEL * ledger.grantedLevels) {
      return `星球 ${planet.id} 的地形改造器格子账无效`;
    }
    granted += ledger.grantedLevels;
    if (!Number.isSafeInteger(granted)) return "地形改造器授格总数无效";
    const jobs = planet.buildQueue.filter(job => job.building === "terraformer");
    const currentJobs = jobs.filter(job => job.jobId >= floor);
    if (currentJobs.length > 0 && jobs.some(job => job.jobId < floor)) return `星球 ${planet.id} 的新旧地形改造器付费队列不能混排`;
    for (let i = 0; i < currentJobs.length; i += 1) {
      if (!Number.isSafeInteger(currentJobs[i]!.targetLevel) || currentJobs[i]!.targetLevel !== level + i + 1
        || currentJobs[i]!.targetLevel > MAX_ORDER_LEVEL) return `星球 ${planet.id} 的新版地形改造器目标必须逐级连续`;
    }
    if (planet.fieldsMax + TERRAFORMER_FIELDS_PER_LEVEL * currentJobs.length > MAX_PLANET_FIELDS) {
      return `星球 ${planet.id} 的已付地形改造器将超过 ${MAX_PLANET_FIELDS} 格上限`;
    }
  }
  if (!planetIds.has(state.activePlanetId)) return "地形改造器当前星球不存在";
  const identityProblem = paidJobIdentityProblem(state);
  if (identityProblem) return `地形改造器授格校验：${identityProblem}`;
  const newPaid = actualPaidJobs(state).filter(({ job }) => job.jobId >= floor).length;
  if (granted + newPaid > nextJobId - floor) return "地形改造器授格与当前付费任务超过新版任务发行数量";
  return null;
}

/** Every payment path calls this through canEnqueue, before touching wallets or receipts. */
export function terraformerEnqueueProblem(state: GameState, targetLevel: number): string | null {
  const invalid = terraformerStateProblem(state);
  if (invalid) return invalid;
  const planet = activePlanet(state);
  if (planet.buildQueue.some(job => isLegacyTerraformerJob(state, job))) return LEGACY_TERRAFORMER_REASON;
  const required = terraformerEnergyRequirement(targetLevel);
  if (!Number.isFinite(required)) return "地形改造器目标等级或能源门槛无效";
  if (planet.fieldsMax + TERRAFORMER_FIELDS_PER_LEVEL * (pendingTerraformerGrants(state, planet) + 1) > MAX_PLANET_FIELDS) {
    return `地形改造器完成后将超过 ${MAX_PLANET_FIELDS} 格上限`;
  }
  const supplied = economy(state).supply;
  if (!Number.isFinite(supplied) || supplied < 0) return "当前供能无效，地形改造器不能付款";
  if (supplied < required) return `能源不足：当前供能 ${Math.floor(supplied)} / 需要 ${required}（只检查供能，不消耗）`;
  return null;
}

/** Validates the real current paid head, without imposing today's energy or prerequisite rules. */
export function terraformerCompletionProblem(state: GameState, head: BuildOrder): string | null {
  const planet = activePlanet(state);
  if (planet.buildQueue[0] !== head || head.building !== "terraformer") return "地形改造器并非本星球实际付费队首";
  if (!Number.isFinite(head.totalSeconds) || head.totalSeconds <= 0 || head.remainingSeconds !== 0) return "地形改造器尚未到达实际完成时间";
  const invalid = terraformerStateProblem(state);
  if (invalid) return invalid;
  if (!Number.isSafeInteger(head.targetLevel) || head.targetLevel < 1 || head.targetLevel > MAX_ORDER_LEVEL
    || !head.paid || !RESOURCE_IDS.every(id => !!head.paid[id] && isValidAmount(head.paid[id]))) return "地形改造器已付任务无效";
  if (head.source === "plan") {
    const task = state.orders.tasks.find(value => value.id === head.taskId);
    if (!task || task.planetId !== planet.id || task.activeJob?.jobId !== head.jobId || !validOwnedPaidJob(state, task)) return "地形改造器计划完成凭证不一致";
    // The lightweight paid-context guard alone does not verify issued work IDs,
    // shipment/trip bindings, exact remaining liability, or the complete budget.
    // Reuse the existing pure authority validators without normalizing or adopting
    // their output; this is a completion check, never a migration or a re-payment.
    try {
      readOrders(state.orders);
      validateOrderReferences(state);
      validateOrderTransportReferences(state);
    } catch {
      return "地形改造器计划或运输完成凭证无效，原付费任务保留";
    }
  } else if ((head.source !== "manual" && head.source !== "protocol") || head.taskId !== null) return "地形改造器付款来源不一致";
  if (!isLegacyTerraformerJob(state, head)
    && (head.targetLevel !== planet.buildings.terraformer + 1 || planet.fieldsMax + TERRAFORMER_FIELDS_PER_LEVEL > MAX_PLANET_FIELDS)) {
    return "地形改造器升级或授格边界无效";
  }
  return null;
}
