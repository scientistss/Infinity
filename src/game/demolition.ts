import { BUILDING_IDS, buildingById, isBuildingAvailable, type BuildingId } from "../data/buildings";
import { SLOT_RULES, type Action, type ProtocolCard } from "../data/protocol-cards";
import { growthCut, protocolSlotBonus } from "../prestige/tree";
import { big, isValidAmount } from "./decimal";
import { DEMOLITION_RULE_VERSION, isDemolishableBuildingId, validDemolitionSeconds, type DemolishableBuildingId, type DemolitionJob, type DemolitionJobRef } from "./demolition-state";
import { demolitionPrice, exactIntegerString } from "./demolition-pricing";
import { activePlanet, selectPlanet } from "./empire";
import { storageCaps } from "./economy";
import { compareOrderAmounts, isOrderAmount } from "./order-money";
import { checkedWalletTransfer } from "./order-wallet";
import { MAX_ORDER_LEVEL } from "./order-state";
import { actualPaidJobs, paidJobIdentityProblem } from "./paid-job-identity";
import { serializeDemolitionJob } from "./demolition-save";
import { terraformerStateProblem } from "./terraformer";
import { clonePlanet, type PlanetState } from "./planet";
import { siloUsed } from "./shipyard";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "./types";

export const DEMOLITION_BUILD_REASON = "本星拆除进行中，暂不能支付新的建筑升级";
export const DEMOLITION_PRECISION_REASON = "拆除金额无法安全扣除或退还，原资源和任务已保留；请调整库存后重试";
const validId = (id: number): boolean => Number.isSafeInteger(id) && id > 0 && id < Number.MAX_SAFE_INTEGER;
const live = (status: string): boolean => status === "running" || status === "paused";
const MINES: readonly BuildingId[] = ["metal_mine", "crystal_mine", "deuterium_synth"];
const STORAGE: readonly BuildingId[] = ["metal_storage", "crystal_storage", "deuterium_tank"];
export function actionRebuilds(action: Action, building: BuildingId): boolean {
  return action.kind === "enqueue" ? action.building === building : action.kind === "enqueueCheapest"
    && (action.group === "mines" ? MINES : action.group === "storage" ? STORAGE : []).includes(building);
}
export function demolitionProtocolProblem(state: GameState, card: ProtocolCard): string {
  if (!card.enabled) return "";
  const conflict = state.planets.find(planet => planet.demolition && actionRebuilds(card.action, planet.demolition.building));
  return conflict ? `${conflict.name}的${buildingById(conflict.demolition!.building).nameZh}正在拆除，不能启用或改为会重建它的协议` : "";
}
/** Same slot rule as automation, without importing its payment/event engine. */
function slots(state: GameState, robotics: number): number {
  return Math.min(SLOT_RULES.hardCap, SLOT_RULES.initial + Math.floor(robotics / SLOT_RULES.roboticsPerLevels)
    + Math.floor(state.research.levels.computer_tech / SLOT_RULES.computerPerLevels) + protocolSlotBonus(state));
}
function interlockProblem(state: GameState, planet: PlanetState, building: DemolishableBuildingId, toLevel: number): string {
  if (planet.buildQueue.length) return "请先完成或明确取消本星已付建筑队列，再拆除";
  if (building === "research_lab" && state.research.queue.length) return "仍有已付研究（含等待项），不能拆除研究实验室";
  if ((building === "shipyard" || building === "nanite_factory") && planet.shipyardQueue.length) return "本星仍有已付造船或防御，不能拆除造船厂或纳米工厂";
  if (building === "missile_silo" && siloUsed(planet) > toLevel * 10) return "已建及排队导弹超过拆后井容量，不能拆除";
  if (state.orders.tasks.some(task => task.kind === "building" && task.planetId === planet.id && task.building === building && live(task.status))) return "同星同建筑仍有运行或暂停计划，请先明确处理该计划";
  const open = slots(state, planet.buildings.robotics_factory);
  const index = state.protocols.slots.findIndex(slot => slot.card?.enabled && actionRebuilds(slot.card.action, building));
  if (index >= 0) return `请先明确停用槽 ${index + 1} 的同目标建造协议${index >= open ? "（当前锁定不执行，重新解锁后可能重建）" : ""}`;
  return "";
}
function paidValid(paid: ResourceAmounts): boolean {
  if (!paid || Reflect.ownKeys(paid).length !== RESOURCE_IDS.length) return false;
  return RESOURCE_IDS.every(id => {
    const amount = paid[id];
    if (!amount || !isValidAmount(amount)) return false;
    const text = amount.toString();
    return isOrderAmount(text) && exactIntegerString(text) !== null && compareOrderAmounts(text, big(text).toString()) === 0;
  });
}
const JOB_KEYS = ["jobId", "taskId", "kind", "source", "demolitionRuleVersion", "building", "fromLevel", "toLevel", "paid", "totalSeconds", "remainingSeconds"];
/** Validate a real stored snapshot, never reprice it from current technology. */
export function demolitionJobProblem(state: GameState, planetId: string): string {
  const planet = state.planets.find(value => value.id === planetId), job = planet?.demolition;
  if (!planet || !job) return "拆除任务不存在";
  try { serializeDemolitionJob(job); } catch { return "拆除任务快照无效，原任务已保留"; }
  if (Reflect.ownKeys(job).length !== JOB_KEYS.length || !JOB_KEYS.every(key => Object.hasOwn(job, key))
    || job.kind !== "demolition" || job.source !== "manual" || job.taskId !== null || job.demolitionRuleVersion !== DEMOLITION_RULE_VERSION
    || !isDemolishableBuildingId(job.building) || !isBuildingAvailable(buildingById(job.building))
    || !Number.isSafeInteger(job.fromLevel) || job.fromLevel < 1 || job.fromLevel > MAX_ORDER_LEVEL || job.toLevel !== job.fromLevel - 1
    || planet.buildings[job.building] !== job.fromLevel || !validDemolitionSeconds(job.totalSeconds, job.remainingSeconds) || !paidValid(job.paid)) return "拆除任务快照无效，原任务已保留";
  if (!validId(job.jobId) || !Number.isSafeInteger(state.orders.nextJobId) || job.jobId >= state.orders.nextJobId
    || job.jobId < state.terraformerGrantJobFloor || paidJobIdentityProblem(state) !== null) return "拆除付费身份不一致，原任务已保留";
  if (state.orders.tasks.some(task => task.activeJob?.jobId === job.jobId
    || task.currentWork?.stage === "paid" && task.currentWork.jobId === job.jobId)) return "拆除身份不能被有限计划或运输工作认领，原任务已保留";
  return terraformerStateProblem(state) ?? interlockProblem(state, planet, job.building, job.toLevel);
}
export function demolitionStateProblem(state: GameState): string {
  for (const planet of state.planets) if (planet.demolition) {
    const problem = demolitionJobProblem(state, planet.id);
    if (problem) return problem;
  }
  return "";
}
export interface DemolitionQuote {
  planetId: string;
  building: DemolishableBuildingId;
  fromLevel: number;
  toLevel: number;
  paid: ResourceAmounts;
  totalSeconds: number;
  fingerprint: string;
  currentSlots: number;
  nextSlots: number;
  /** Player-facing, one-based slot numbers. */
  relockedSlots: number[];
  currentCaps: Record<keyof ResourceAmounts, number>;
  nextCaps: Record<keyof ResourceAmounts, number>;
}
export interface DemolitionQuoteResult { ok: boolean; reason: string; quote: DemolitionQuote | null }
export interface DemolitionResult { state: GameState; ok: boolean; reason: string; jobId?: number }
/** Cheap UI authority key: no wallet balances, timer countdowns, or exact exponentiation. */
export function demolitionContextKey(state: GameState, building: BuildingId): string {
  const planet = activePlanet(state);
  if (!isDemolishableBuildingId(building)) return "";
  const def = buildingById(building);
  return JSON.stringify({ version: DEMOLITION_RULE_VERSION, planetId: planet.id, coordinates: planet.coordinates,
    world: state.universe, launches: state.stats.launches, nextJobId: state.orders.nextJobId, floor: state.terraformerGrantJobFloor,
    def: { base: def.baseCost, factor: def.factor, early: def.earlyLevelSpeedup, phase: def.phase },
    building, buildings: BUILDING_IDS.map(id => planet.buildings[id]), fieldsMax: planet.fieldsMax, terraformerFields: planet.terraformerFields,
    research: state.research.levels, growthCut: growthCut(state), slotBonus: protocolSlotBonus(state), productionPct: planet.productionPct,
    localJobs: planet.buildQueue.map(job => [job.jobId, job.building, job.targetLevel]),
    demolition: planet.demolition ? [planet.demolition.jobId, planet.demolition.building, planet.demolition.fromLevel, planet.demolition.toLevel] : null,
    yard: planet.shipyardQueue.map(job => [job.jobId, job.unit, job.count]), missiles: siloUsed(planet),
    researchJobs: state.research.queue.map(job => [job.jobId, job.planetId, job.tech, job.targetLevel]),
    tasks: state.orders.tasks.filter(task => task.kind === "building" && task.planetId === planet.id && task.building === building).map(task => [task.id, task.status, task.kind === "building" ? task.targetLevel : null]),
    cards: state.protocols.slots.map(slot => slot.card ? { card: slot.card, unlocked: state.unlockedCards.some(id => id === slot.card!.id) } : null),
  });
}
export function quoteDemolition(state: GameState, building: BuildingId): DemolitionQuoteResult {
  const fail = (reason: string): DemolitionQuoteResult => ({ ok: false, reason, quote: null });
  if (!isDemolishableBuildingId(building) || !isBuildingAvailable(buildingById(building))) return fail("本期仅支持人工拆除普通建筑，地形、月球和未开放设施不可拆除");
  const planet = activePlanet(state), fromLevel = planet.buildings[building], toLevel = fromLevel - 1;
  if (planet.demolition) return fail("本星已有拆除任务，请等待完成或明确取消");
  const problem = terraformerStateProblem(state) ?? interlockProblem(state, planet, building, toLevel);
  if (problem) return fail(problem);
  if (!validId(state.orders.nextJobId) || paidJobIdentityProblem(state) !== null || actualPaidJobs(state).some(({ job }) => job.jobId === state.orders.nextJobId)) return fail("付费任务编号无效或已耗尽，未扣款");
  const priced = demolitionPrice(buildingById(building), fromLevel, state.research.levels.ion_tech, growthCut(state), planet.buildings.robotics_factory, planet.buildings.nanite_factory);
  if (!priced.ok) return fail(priced.reason);
  const currentSlots = slots(state, planet.buildings.robotics_factory), nextSlots = slots(state, building === "robotics_factory" ? toLevel : planet.buildings.robotics_factory);
  const nextPlanet = { ...planet, buildings: { ...planet.buildings, [building]: toLevel } };
  const quote: DemolitionQuote = { planetId: planet.id, building, fromLevel, toLevel, paid: priced.price.paid, totalSeconds: priced.price.totalSeconds,
    fingerprint: demolitionContextKey(state, building), currentSlots, nextSlots, relockedSlots: Array.from({ length: Math.max(0, currentSlots - nextSlots) }, (_, i) => nextSlots + i + 1),
    currentCaps: storageCaps(state), nextCaps: storageCaps({ ...state, planets: state.planets.map(p => p.id === planet.id ? nextPlanet : p) }) };
  for (const id of RESOURCE_IDS) {
    if (planet.resources[id].lt(quote.paid[id])) return { ok: false, quote, reason: "拆除资源不足，未扣款" };
    if (checkedWalletTransfer(planet.resources[id], quote.paid[id], false) === null) return { ok: false, quote, reason: DEMOLITION_PRECISION_REASON };
  }
  return { ok: true, reason: "", quote };
}
export function commitDemolition(state: GameState, quote: DemolitionQuote): DemolitionResult {
  const fail = (reason: string): DemolitionResult => ({ state, ok: false, reason });
  if (!quote || state.activePlanetId !== quote.planetId || demolitionContextKey(state, quote.building) !== quote.fingerprint) return fail("拆除核对已过期，请重新核对固定星球、费用与损失");
  const current = quoteDemolition(state, quote.building);
  if (!current.ok || !current.quote) return fail(current.reason);
  const actual = current.quote;
  if (actual.fromLevel !== quote.fromLevel || actual.toLevel !== quote.toLevel || actual.totalSeconds !== quote.totalSeconds
    || !paidValid(quote.paid) || RESOURCE_IDS.some(id => compareOrderAmounts(actual.paid[id].toString(), quote.paid[id].toString()) !== 0)) return fail("拆除报价已变化，请重新核对");
  const planet = clonePlanet(activePlanet(state)), resources = { ...planet.resources };
  for (const id of RESOURCE_IDS) {
    const after = checkedWalletTransfer(resources[id], actual.paid[id], false);
    if (after === null) return fail(DEMOLITION_PRECISION_REASON);
    resources[id] = after;
  }
  const jobId = state.orders.nextJobId;
  const job: DemolitionJob = { kind: "demolition", source: "manual", taskId: null, demolitionRuleVersion: DEMOLITION_RULE_VERSION,
    jobId, building: actual.building, fromLevel: actual.fromLevel, toLevel: actual.toLevel, paid: { ...actual.paid }, totalSeconds: actual.totalSeconds, remainingSeconds: actual.totalSeconds };
  planet.resources = resources; planet.demolition = job;
  const next = { ...state, planets: state.planets.map(p => p.id === planet.id ? planet : p), orders: { ...state.orders, nextJobId: jobId + 1 }, stats: { ...state.stats, manualActions: state.stats.manualActions + 1 } };
  const problem = demolitionJobProblem(next, planet.id);
  if (problem) return fail(problem);
  return { state: next, ok: true, reason: `${buildingById(job.building).nameZh} ${job.fromLevel}→${job.toLevel} 拆除已开工`, jobId };
}
function actualRef(state: GameState, ref: DemolitionJobRef): PlanetState | null {
  if (!ref || ref.kind !== "demolition" || ref.taskId !== null || !validId(ref.jobId)) return null;
  const planet = state.planets.find(value => value.id === ref.planetId);
  return planet?.demolition?.jobId === ref.jobId ? planet : null;
}
export function cancelDemolition(state: GameState, ref: DemolitionJobRef): DemolitionResult {
  const planet = actualRef(state, ref), job = planet?.demolition;
  if (!planet || !job) return { state, ok: false, reason: "该拆除任务已不存在，未退款" };
  const problem = demolitionJobProblem(state, planet.id);
  if (problem) return { state, ok: false, reason: problem };
  if (!(job.remainingSeconds > 0)) return { state, ok: false, reason: "拆除已到完成边界，不能取消或退款" };
  const resources = { ...planet.resources };
  for (const id of RESOURCE_IDS) {
    const after = checkedWalletTransfer(resources[id], job.paid[id], true);
    if (after === null) return { state, ok: false, reason: DEMOLITION_PRECISION_REASON };
    resources[id] = after;
  }
  return { state: { ...state, planets: state.planets.map(p => p.id === planet.id ? { ...planet, resources, demolition: null } : p) }, ok: true, reason: "拆除已取消，本次实际拆除费已全额退还；原等级保持" };
}
export interface CompletedDemolition { building: DemolishableBuildingId; fromLevel: number; toLevel: number; jobId: number }
export function completeDemolition(state: GameState, ref: DemolitionJobRef): { state: GameState; completed: CompletedDemolition | null; reason?: string } {
  const planet = actualRef(state, ref), job = planet?.demolition;
  if (!planet || !job) return { state, completed: null, reason: "该拆除任务已不存在" };
  const problem = demolitionJobProblem(state, planet.id);
  if (problem || job.remainingSeconds !== 0) return { state, completed: null, reason: problem || "拆除尚未到点，不能提前降低等级" };
  const next = { ...planet, buildings: { ...planet.buildings, [job.building]: job.toLevel }, demolition: null };
  return { state: { ...state, planets: state.planets.map(p => p.id === planet.id ? next : p) }, completed: { building: job.building, fromLevel: job.fromLevel, toLevel: job.toLevel, jobId: job.jobId } };
}
export function withDemolitionRemaining(state: GameState, planetId: string, jobId: number, remainingSeconds: number): GameState {
  const local = selectPlanet(state, planetId), planet = activePlanet(local), job = planet.demolition;
  if (planet.id !== planetId || !job || job.jobId !== jobId || !validDemolitionSeconds(job.totalSeconds, remainingSeconds)) return state;
  return { ...state, planets: state.planets.map(p => p.id === planetId ? { ...planet, demolition: { ...job, remainingSeconds } } : p) };
}
