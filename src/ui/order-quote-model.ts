import { buildingById, CURRENT_PHASE, isBuildingId } from "../data/buildings";
import { isResearchId, researchById } from "../data/research";
import { isUnitId, unitById, UNIT_IDS } from "../data/units";
import { selectPlanet } from "../game/empire";
import { researchEnergyRequirement, type ResourceCost } from "../game/formulas";
import { quoteOrderMoney, validOwnedPaidJob, zeroOrderMoney } from "../game/order-ledger";
import { addOrderAmounts } from "../game/order-money";
import {
  MAX_LIVE_ORDER_TASKS, MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, MAX_ORDER_TASKS,
  type OrderMoney, type OrderTarget, type OrderTask,
} from "../game/order-state";
import { usedFields, type BuildOrder } from "../game/planet";
import { costFor, queueCapacity } from "../game/queue";
import { missingRequirements } from "../game/requirements";
import { labBusyReason, researchCapacity, researchCostFor, type ResearchOrder } from "../game/research";
import { exactUnitCost, SHIPYARD, siloCapacity, siloUsed, unitTotal } from "../game/shipyard";
import { RESOURCE_IDS, type GameState } from "../game/types";
import { unitCost } from "../game/unit-cost";
import { growthCut } from "../prestige/tree";

export interface LocalOrderQuote {
  /** Cost availability only: this never asserts affordability or eventual executability. */
  available: boolean;
  reason: string;
  contextKey: string;
  payer: { id: string; name: string } | null;
  /** Actual completed level; always zero for a NEW additional-unit order. */
  completed: number;
  /** Paid queued levels within the requested goal; never existing ships or an unstarted plan. */
  paidCoverage: number;
  remaining: number;
  unit: "levels" | "units";
  cost: OrderMoney | null;
  warnings: string[];
}

const UNSUPPORTED_COST = "当前规则成本超出有限计划的精确金额范围，无法预览或填入预算";
const INVALID_COVERAGE = "已付费队列的等级或任务身份不一致，无法安全计算剩余成本";
const isLive = (task: OrderTask): boolean => task.status === "running" || task.status === "paused";
const validId = (id: number): boolean => Number.isSafeInteger(id) && id > 0 && id < Number.MAX_SAFE_INTEGER;

function validTarget(target: OrderTarget): boolean {
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

function priceContext(target: OrderTarget): unknown {
  if (target.kind === "building") {
    const def = buildingById(target.building);
    return [def.baseCost, def.factor, def.phase, def.requires];
  }
  if (target.kind === "research") {
    const def = researchById(target.tech);
    return [def.baseCost, def.factor, def.roundTo, def.requires];
  }
  const def = unitById(target.unit);
  return [def.cost, def.requires, def.maxCount, def.siloSlots];
}

/**
 * Small dependency snapshot, not a quote. Never visits future levels or sums prices.
 * Wallet balances, timers, progress fractions, UI selection and passive ticks are excluded.
 * Queues and task records are already bounded by the game's canonical state limits.
 */
export function localOrderQuoteContextKey(state: GameState, target: OrderTarget): string {
  if (!validTarget(target)) return "invalid-local-order-target";
  const planet = state.planets.find(value => value.id === target.planetId);
  if (!planet) return JSON.stringify([target, "missing-payer"]);
  const relevantJobs = target.kind === "building" ? planet.buildQueue.filter(job => job.building === target.building)
    : target.kind === "research" ? state.research.queue.filter(job => job.tech === target.tech) : [];
  const paidOwners = relevantJobs.map(job => {
    const owner = state.orders.tasks.find(task => task.id === job.taskId);
    return [job.jobId, job.jobId < state.orders.nextJobId, owner ? [
      owner.id, owner.kind, owner.planetId, owner.status,
      owner.kind === "building" ? owner.building : owner.kind === "research" ? owner.tech : owner.unit,
      owner.kind === "shipyard" ? owner.quantity : owner.targetLevel,
      owner.completedUnits, owner.activeJob, !!owner.transport, owner.currentWork,
    ] : null];
  });
  const paid = (cost: ResourceCost): unknown => RESOURCE_IDS.map(id => cost[id]?.toString());
  const researchQueue = target.kind === "research" ? state.research.queue.map(job => [
    job.jobId, job.taskId, job.planetId, state.planets.some(world => world.id === job.planetId),
    job.tech, job.targetLevel, job.source, job.tech === target.tech ? paid(job.paid) : null,
  ]) : target.kind === "building" && target.building === "research_lab" ? state.research.queue.length : null;
  const def = target.kind === "shipyard" ? unitById(target.unit) : null;
  return JSON.stringify([
    target, priceContext(target), target.kind === "building" ? growthCut(state) : null,
    planet.id, planet.name, planet.buildings, state.research.levels,
    target.kind === "building" ? planet.fieldsMax : null,
    planet.buildQueue.map(job => [job.jobId, job.taskId, job.building, job.targetLevel, job.source,
      target.kind === "building" && job.building === target.building ? paid(job.paid) : null]),
    researchQueue, paidOwners,
    target.kind === "research" ? !!labBusyReason(state) : null,
    target.kind === "shipyard" ? planet.shipyardQueue.map(job => [job.jobId, job.unit, job.count]) : null,
    def?.maxCount !== undefined && target.kind === "shipyard" ? planet.units[target.unit] : null,
    def?.siloSlots ? UNIT_IDS.filter(id => unitById(id).siloSlots).map(id => planet.units[id]) : null,
    state.orders.tasks.length, state.orders.tasks.filter(isLive).length,
    state.orders.tasks.filter(task => isLive(task) && sameTarget(task, target)).map(task => [task.id, task.status]),
  ]);
}

function coveredLevels(state: GameState, target: OrderTarget, completed: number): Set<number> | null {
  if (target.kind === "shipyard") return new Set();
  const planet = state.planets.find(value => value.id === target.planetId)!;
  const jobs: (BuildOrder | ResearchOrder)[] = target.kind === "building"
    ? planet.buildQueue.filter(job => job.building === target.building)
    : state.research.queue.filter(job => job.tech === target.tech);
  const covered = new Set<number>();
  let expected = completed + 1;
  const identities = new Set<number>();
  for (const job of jobs) {
    if (!validId(job.jobId) || job.jobId >= state.orders.nextJobId || identities.has(job.jobId)
      || !Number.isSafeInteger(job.targetLevel) || job.targetLevel !== expected || !quoteOrderMoney(job.paid)) return null;
    identities.add(job.jobId);
    expected += 1;
    if (target.kind === "research" && (!("planetId" in job) || !state.planets.some(world => world.id === job.planetId))) return null;
    if (job.source === "plan") {
      const owner = state.orders.tasks.find(task => task.id === job.taskId);
      if (!owner || owner.activeJob?.jobId !== job.jobId || !validOwnedPaidJob(state, owner)) return null;
    } else if ((job.source !== "manual" && job.source !== "protocol") || job.taskId !== null) return null;
    if (job.targetLevel <= target.targetLevel) covered.add(job.targetLevel);
  }
  return covered;
}

function warningsFor(state: GameState, target: OrderTarget, remaining: number): string[] {
  const planet = state.planets.find(value => value.id === target.planetId)!;
  const local = selectPlanet(state, target.planetId);
  // Shared price/fuel caveat is always visible in the quote panel; only actual
  // blockers belong here, avoiding duplicate instructions beside every amount.
  const warnings: string[] = [];
  if (state.orders.tasks.some(task => isLive(task) && sameTarget(task, target))) warnings.push("相同目标已有未结束计划，不能重复创建");
  if (state.orders.tasks.length >= MAX_ORDER_TASKS) warnings.push("计划记录已满，请先移除已结束记录");
  if (state.orders.tasks.filter(isLive).length >= MAX_LIVE_ORDER_TASKS) warnings.push("未结束计划已达 32 项上限");
  if (target.kind === "building") {
    const def = buildingById(target.building);
    const missing = missingRequirements(local, def.requires);
    if (missing.length) warnings.push(`前置条件未满足：${missing.join("、")}`);
    if (def.phase > CURRENT_PHASE) warnings.push(`该建筑在第 ${def.phase} 阶段开放，当前不能执行`);
    if (target.building === "research_lab" && state.research.queue.length) warnings.push("研究队列未清空，研究实验室暂不能升级");
    if (planet.buildQueue.length >= queueCapacity(local)) warnings.push("建造队列已满，需等待空位");
    else if (planet.buildQueue.length) warnings.push("已有付费建造排队，新工作仍需等待建造队列");
    if (remaining > 0 && usedFields(planet) + planet.buildQueue.length + remaining > planet.fieldsMax) warnings.push("当前星球剩余格子不足以容纳全部目标等级");
    if (planet.buildings[target.building] >= target.targetLevel) warnings.push("目标等级已经完成，无需创建新计划");
  } else if (target.kind === "research") {
    const def = researchById(target.tech);
    const missing = missingRequirements(local, def.requires);
    if (missing.length) warnings.push(`支付星球前置条件未满足：${missing.join("、")}`);
    const busy = labBusyReason(local);
    if (busy) warnings.push(busy);
    if (state.research.queue.length >= researchCapacity(local)) warnings.push("帝国研究队列已满，需等待空位");
    else if (state.research.queue.length) warnings.push("使用帝国统一研究队列，其他星球已付费的同项等级也计入覆盖");
    const energy = researchEnergyRequirement(def, target.targetLevel);
    if (energy > 0) warnings.push(Number.isFinite(energy)
      ? `目标等级还要求支付星球供能达到 ${energy.toLocaleString("zh-CN")}（能源不作为资源扣款）`
      : "目标等级供能要求超出可表示范围，当前不能保证执行");
    if (state.research.levels[target.tech] >= target.targetLevel) warnings.push("目标等级已经完成，无需创建新计划");
  } else {
    const def = unitById(target.unit);
    const missing = missingRequirements(local, def.requires);
    if (planet.buildings.shipyard < 1) warnings.push("支付星球需要造船厂 等级 1");
    if (missing.length) warnings.push(`前置条件未满足：${missing.join("、")}`);
    if (planet.shipyardQueue.length >= SHIPYARD.maxOrders) warnings.push("造船队列已满，需等待空位");
    else if (planet.shipyardQueue.length) warnings.push("已有付费造船排队，不抵扣本次新增数量");
    if (planet.buildQueue.some(job => job.building === "shipyard" || job.building === "nanite_factory")) warnings.push("造船厂或纳米机器人工厂升级期间会暂停造船");
    if (def.maxCount !== undefined && unitTotal(planet, target.unit) + remaining > def.maxCount) warnings.push(`目标超过每颗星球 ${def.maxCount} 个的建造上限`);
    if (def.siloSlots && siloUsed(planet) + remaining * def.siloSlots > siloCapacity(planet)) warnings.push("当前导弹井容量不足以容纳全部新增数量");
    if (remaining > SHIPYARD.maxBatch) warnings.push(`按每批最多 ${SHIPYARD.maxBatch.toLocaleString("zh-CN")} 个逐批执行`);
  }
  return warnings;
}

/** Pure opt-in preview: no payment, authorization, queue insertion or save-state mutation. */
export function quoteLocalOrder(state: GameState, target: OrderTarget): LocalOrderQuote {
  const base: LocalOrderQuote = {
    available: false, reason: "计划目标、等级或数量无效", contextKey: localOrderQuoteContextKey(state, target),
    payer: null, completed: 0, paidCoverage: 0, remaining: 0,
    unit: target?.kind === "shipyard" ? "units" : "levels", cost: null, warnings: [],
  };
  if (!validTarget(target)) return base;
  const planet = state.planets.find(value => value.id === target.planetId);
  if (!planet) return { ...base, reason: "支付和执行星球不存在" };
  base.payer = { id: planet.id, name: planet.name };
  base.completed = target.kind === "building" ? planet.buildings[target.building]
    : target.kind === "research" ? state.research.levels[target.tech] : 0;
  if (!Number.isSafeInteger(base.completed) || base.completed < 0) return { ...base, reason: "已完成等级无效，无法安全预览" };
  const coverage = coveredLevels(state, target, base.completed);
  if (!coverage) return { ...base, reason: INVALID_COVERAGE };
  base.paidCoverage = coverage.size;
  base.remaining = target.kind === "shipyard" ? target.quantity : Math.max(0, target.targetLevel - base.completed - coverage.size);
  base.warnings = warningsFor(state, target, base.remaining);
  let total = zeroOrderMoney();
  if (target.kind === "shipyard") {
    const cost = exactUnitCost(unitCost(unitById(target.unit)), target.quantity);
    if (!cost) return { ...base, reason: UNSUPPORTED_COST };
    total = cost;
  } else {
    // At most MAX_ORDER_LEVEL price evaluations, once per explicit preview request.
    for (let level = base.completed + 1; level <= target.targetLevel; level += 1) {
      if (coverage.has(level)) continue;
      const step = quoteOrderMoney(target.kind === "building" ? costFor(state, target.building, level) : researchCostFor(target.tech, level));
      if (!step) return { ...base, reason: UNSUPPORTED_COST };
      for (const id of RESOURCE_IDS) {
        const amount = addOrderAmounts(total[id], step[id]);
        if (amount === null) return { ...base, reason: UNSUPPORTED_COST };
        total[id] = amount;
      }
    }
  }
  return { ...base, available: true, reason: "按当前规则计算的剩余资源成本", cost: total };
}
