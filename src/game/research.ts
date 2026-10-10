import { activePlanet, withPlanet, onPlanet, selectPlanet } from "./empire";
/**
 * Research queue (design doc §6.1). Empire-wide, one research at a time, same queue length as the
 * build queue. Cost is charged on enqueue at the target level and refunded in full on cancel.
 * Duration is computed when a research starts, from the research lab level at that moment.
 * The research lab cannot be upgraded while research is queued, and research cannot be queued while
 * the lab is in the build queue (OGame rule).
 */
import { RESEARCH_IDS, isResearchId, researchById, type ResearchDef, type ResearchId } from "../data/research";
import { big, type BigNumber } from "./decimal";
import { economy } from "./economy";
import { formatAmount } from "./format";
import { researchCost, researchEnergyRequirement, researchSeconds, type ResourceCost } from "./formulas";
import type { OrderSource } from "./planet";
import { queueCapacity, shortfall } from "./queue";
import { missingRequirements } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";
import { cancelledPaidJob, creditPaidJob, preparePaidJob, refundPaidJob } from "./order-ledger";
import { subtractOrderAmounts } from "./order-money";
import type { OrderMoney, PaidJobIdentity } from "./order-state";

export interface ResearchOrder extends PaidJobIdentity {
  /** Paying planet also supplies the primary lab; UI selection is irrelevant. */
  planetId: string;
  tech: ResearchId;
  targetLevel: number;
  paid: { metal: BigNumber; crystal: BigNumber; deuterium: BigNumber };
  /** Written when the research starts. 0 while waiting. */
  totalSeconds: number;
  remainingSeconds: number;
  source: OrderSource;
}

export interface ResearchState {
  levels: Record<ResearchId, number>;
  queue: ResearchOrder[];
}

export interface CompletedResearch {
  tech: ResearchId;
  level: number;
}

export interface ResearchCheck {
  ok: boolean;
  reason: string;
  targetLevel: number;
  cost: ResourceCost;
  /** True when the only blocker is missing resources (everything else would allow it). */
  onlyResources?: boolean;
}

export interface ResearchResult {
  jobId?: number;
  state: GameState;
  ok: boolean;
  reason: string;
}

export function emptyResearchLevels(): Record<ResearchId, number> {
  const out = {} as Record<ResearchId, number>;
  for (const id of RESEARCH_IDS) out[id] = 0;
  return out;
}

export function createResearch(): ResearchState {
  return { levels: emptyResearchLevels(), queue: [] };
}

export function cloneResearch(research: ResearchState): ResearchState {
  return {
    levels: { ...research.levels },
    queue: research.queue.map((order) => ({ ...order, paid: { ...order.paid } })),
  };
}

export function researchCapacity(state: GameState): number {
  return queueCapacity(state);
}

/** P4-1 uses the paying planet's lab. Network aggregation is a separate increment. */
export function effectiveLabLevel(state: GameState): number {
  return activePlanet(state).buildings.research_lab;
}

export function nextResearchLevel(research: ResearchState, id: ResearchId): number {
  return research.levels[id] + research.queue.filter((order) => order.tech === id).length + 1;
}

export function researchCostFor(id: ResearchId, level: number): ResourceCost {
  return researchCost(researchById(id), level);
}

/** Seconds a research of `def` at `level` would take if it started now. */
export function researchSecondsFor(state: GameState, def: ResearchDef, level: number, cost?: ResourceCost): number {
  return researchSeconds(cost ?? researchCostFor(def.id, level), effectiveLabLevel(state));
}

export function labBusyReason(state: GameState): string {
  return state.planets.some(p => p.buildQueue.some(order => order.building === "research_lab")) ? "研究实验室正在升级，暂不能研究" : "";
}

export function canEnqueueResearch(state: GameState, id: ResearchId): ResearchCheck {
  const def = researchById(id);
  const targetLevel = nextResearchLevel(state.research, id);
  const cost = researchCostFor(id, targetLevel);
  const fail = (reason: string): ResearchCheck => ({ ok: false, reason, targetLevel, cost });
  const missing = missingRequirements(state, def.requires);
  if (missing.length > 0) return fail(`需要 ${missing.join("、")}`);
  const busy = labBusyReason(state);
  if (busy) return fail(busy);
  const capacity = researchCapacity(state);
  if (state.research.queue.length >= capacity) return fail(`研究队列已满（${state.research.queue.length}/${capacity}）`);
  const energy = researchEnergyRequirement(def, targetLevel);
  if (energy > 0) {
    const supply = economy(state).supply;
    if (supply < energy) return fail(`能源供给 ${formatAmount(big(supply))} 不足 ${formatAmount(big(energy))}`);
  }
  const lack = shortfall(state, cost);
  if (lack) return { ok: false, reason: lack, targetLevel, cost, onlyResources: true };
  return { ok: true, reason: "", targetLevel, cost };
}

export function enqueueResearch(state: GameState, id: ResearchId, source: OrderSource, taskId: number | null = null): ResearchResult {
  const check = canEnqueueResearch(state, id);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const payment = preparePaidJob(state, {
    kind: "research", planetId: state.activePlanetId, tech: id,
    targetLevel: check.targetLevel, quantity: 1, source, taskId,
  }, check.cost);
  if (!payment.ok) return { state: payment.state, ok: false, reason: payment.reason };
  const research = cloneResearch(payment.state.research);
  research.queue.push({
    jobId: payment.jobId,
    taskId,
    planetId: state.activePlanetId,
    tech: id,
    targetLevel: check.targetLevel,
    paid: { metal: check.cost.metal, crystal: check.cost.crystal, deuterium: check.cost.deuterium },
    totalSeconds: 0,
    remainingSeconds: 0,
    source,
  });
  const stats = source === "manual" ? { ...state.stats, manualActions: state.stats.manualActions + 1 } : state.stats;
  const next = startNextResearch({ ...payment.state, research, stats });
  return { state: next, ok: true, jobId: payment.jobId, reason: `${researchById(id).nameZh} → 等级 ${check.targetLevel} 已加入研究队列` };
}

export function startNextResearch(state: GameState): GameState {
  const head = state.research.queue[0];
  if (!head || head.totalSeconds > 0) return state;
  const research = cloneResearch(state.research);
  const order = research.queue[0];
  if (!order) return state;
  const seconds = researchSecondsFor(selectPlanet(state, order.planetId), researchById(order.tech), order.targetLevel, order.paid);
  order.totalSeconds = seconds;
  order.remainingSeconds = seconds;
  return { ...state, research };
}

export function completeActiveResearch(state: GameState): { state: GameState; completed: CompletedResearch | null } {
  const head = state.research.queue[0];
  if (!head) return { state, completed: null };
  const credited = creditPaidJob(state, { kind: "research", planetId: head.planetId, jobId: head.jobId, taskId: head.taskId }, 1, true);
  const research = cloneResearch(credited.research);
  research.queue.shift();
  research.levels[head.tech] = Math.max(research.levels[head.tech], head.targetLevel);
  const stats = { ...state.stats, researchCompleted: state.stats.researchCompleted + 1 };
  const next = startNextResearch({ ...credited, research, stats });
  return { state: next, completed: { tech: head.tech, level: head.targetLevel } };
}

export function withResearchRemaining(state: GameState, remaining: number): GameState {
  const [head, ...rest] = state.research.queue;
  if (!head) return state;
  return { ...state, research: { ...state.research, queue: [{ ...head, remainingSeconds: remaining }, ...rest] } };
}

/** Cancel with a full refund. Later orders of the same research drop one level and get the difference back. */
export function cancelResearch(state: GameState, index: number): ResearchResult {
  const target = state.research.queue[index];
  if (!Number.isInteger(index) || !target) return { state, ok: false, reason: "研究队列中没有这一项" };
  let candidate = state;
  const research = cloneResearch(state.research);
  const refund = (order: ResearchOrder, amounts: ResourceCost, exact?: OrderMoney): string => {
    if (order.source === "plan") {
      const result = refundPaidJob(candidate, { kind: "research", planetId: order.planetId, jobId: order.jobId, taskId: order.taskId }, exact ?? quotedResearchMoney(amounts));
      if (!result.ok) return result.reason;
      candidate = result.state;
    } else {
      candidate = onPlanet(candidate, order.planetId, local => {
        const resources = { ...activePlanet(local).resources };
        for (const res of RESOURCE_IDS) resources[res] = resources[res].add(amounts[res]);
        return withPlanet(local, { resources });
      });
    }
    return "";
  };
  let reason = refund(target, target.paid);
  if (reason) return { state, ok: false, reason };
  research.queue.splice(index, 1);
  for (let i = index; i < research.queue.length; i += 1) {
    const order = research.queue[i];
    if (!order || order.tech !== target.tech) continue;
    order.targetLevel -= 1;
    const repriced = researchCostFor(order.tech, order.targetLevel);
    const amounts: ResourceCost = { metal: big(0), crystal: big(0), deuterium: big(0) };
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
      }
    }
    reason = refund(order, amounts, exact);
    if (reason) return { state, ok: false, reason };
    order.paid = repriced;
  }
  candidate = cancelledPaidJob(candidate, { kind: "research", planetId: target.planetId, jobId: target.jobId, taskId: target.taskId });
  const next = startNextResearch({ ...candidate, research });
  return {
    state: next,
    ok: true,
    reason: `已取消 ${researchById(target.tech).nameZh} → 等级 ${target.targetLevel}，资源已全额退还`,
  };
}

export function isResearchKey(value: string): value is ResearchId {
  return isResearchId(value);
}

function quotedResearchMoney(cost: ResourceCost): OrderMoney {
  return { metal: cost.metal.toString(), crystal: cost.crystal.toString(), deuterium: cost.deuterium.toString() };
}
