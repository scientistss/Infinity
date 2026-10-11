import { SHIP_IDS, unitById } from "../data/units";
import { big, bigToString } from "./decimal";
import type { Fleet, FleetRequest, FleetResult } from "./fleet";
import { coordinateKey, npcAt, SPACE, type Coordinates } from "./galaxy";
import { npcArrivalCombatTech, npcBattleSeed, resolveNpcBattleCandidate } from "./npc-battle";
import { NPC_SITE_LIMIT, NPC_UNFINISHED_ATTACK_LIMIT, trimNpcBattleReports, type NpcAttackContract, type NpcBattleReceipt } from "./npc-attack-state";
import { checkedNpcCargoCredit, checkedNpcLootCargo, readNpcLootCargo } from "./npc-transfer";
import { createNpcWalletContext, debitNpcAtArrival, materializeNpcAtPaidLaunch, projectNpc, type NpcWalletContext } from "./npc-wallet";
import { checkedShipLanding } from "./order-wallet";
import { missingRequirements } from "./requirements";
import { RESOURCE_IDS, type GameState } from "./types";

/** A failed NPC candidate must never be adopted or saved by the host loop. */
export class NpcSettlementError extends Error {
  constructor(cause: unknown) {
    super(`NPC 结算异常，当前候选未采用：${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "NpcSettlementError";
  }
}
function checkedSettlement<T>(run: () => T): T {
  try { return run(); }
  catch (error) { throw error instanceof NpcSettlementError ? error : new NpcSettlementError(error); }
}

export function npcWalletContext(state: GameState): NpcWalletContext {
  return createNpcWalletContext(state.universe.seed, NPC_SITE_LIMIT, state.planets.map(planet => planet.coordinates));
}

/** Additional attack-only eligibility. The shared flight quote checks stock, drives and cargo. */
export function npcAttackLaunchReason(state: GameState, request: FleetRequest): string | null {
  if (state.research.levels.weapons_tech < 1) return "攻击需要武器技术等级 1";
  if (!npcAt(state, request.target)) return "攻击目标必须是 NPC 轨道驻军";
  if (state.fleets.filter(fleet => fleet.mission === "attack").length >= NPC_UNFINISHED_ATTACK_LIMIT) return "未结束的攻击舰队已达 64 支，返航和受阻返港也占名额";
  if (!Object.hasOwn(state.npcEconomy.sites, coordinateKey(request.target)) && Object.keys(state.npcEconomy.sites).length >= NPC_SITE_LIMIT) return "NPC 目标记录已达 512 处；仍可攻击已记录的目标";
  for (const id of SHIP_IDS) {
    if (!(request.ships?.[id]! > 0)) continue;
    const missing = missingRequirements(state, unitById(id).requires);
    if (missing.length) return `${unitById(id).nameZh}尚未解锁：${missing.join("、")}`;
  }
  if (!Number.isSafeInteger(state.nextFleetId) || state.nextFleetId < 1 || state.nextFleetId >= Number.MAX_SAFE_INTEGER) return "舰队编号已超出安全范围";
  return null;
}

export function npcAttackLaunchWallet(state: GameState, target: Coordinates) {
  return materializeNpcAtPaidLaunch(state.npcEconomy, target, npcWalletContext(state));
}
export function npcAttackContract(state: GameState, fleetId: number, target: Coordinates): NpcAttackContract {
  return { seed: npcBattleSeed(state.universe.seed, fleetId, target), cargoFactor: 1 + .05 * state.research.levels.hyperspace_tech, phase: { kind: "outbound" } };
}
export function isNpcAttackDockBlocked(fleet: Fleet): boolean {
  return fleet.mission === "attack" && fleet.npcAttack?.phase.kind === "returning" && fleet.npcAttack.phase.dockBlocked;
}
/** Attack events have no epsilon window. Blocked landings require an explicit retry. */
export function nextNpcAttackEvent(state: GameState): number {
  return state.fleets.reduce((soonest, fleet) => fleet.mission === "attack" && !isNpcAttackDockBlocked(fleet)
    ? Math.min(soonest, Math.max(0, fleet.remaining)) : soonest, Infinity);
}
function message(state: GameState, id: string, text: string): GameState {
  const beyond = state.totalTime.gt(1e12);
  return { ...state, messages: [...state.messages, { id, at: beyond ? 1e12 : state.totalTime.toNumber(),
    text: beyond ? `${text}（列表时间已达显示上限；实际游戏时间 ${state.totalTime.toString()} 秒。）` : text }].slice(-SPACE.maxMessages) };
}
function sameShips(a: Fleet["ships"], b: Fleet["ships"]): boolean {
  return SHIP_IDS.every(id => (a[id] ?? 0) === (b[id] ?? 0));
}
function currentAttack(state: GameState, fleetId: number): Fleet {
  const matching = state.fleets.filter(fleet => fleet.id === fleetId);
  const fleet = matching[0];
  if (matching.length !== 1 || !fleet || fleet.mission !== "attack" || !fleet.npcAttack || fleet.orderTransport !== null || fleet.charge
    || fleet.npcAttack.seed !== npcBattleSeed(state.universe.seed, fleet.id, fleet.target)
    || fleet.returning !== (fleet.npcAttack.phase.kind === "returning")
    || !state.planets.some(planet => planet.id === fleet.originId)) throw new Error("NPC 攻击舰队合同不一致，已停止结算以保护存档");
  return fleet;
}
function returningReport(state: GameState, fleet: Fleet): NpcBattleReceipt | null {
  const reports = state.npcBattles.reports.filter(report => report.fleetId === fleet.id);
  const phase = fleet.npcAttack!.phase;
  if (phase.kind !== "returning") throw new Error("NPC 返航阶段不一致");
  if (phase.reason !== "battle") {
    if (reports.length || RESOURCE_IDS.some(id => fleet.cargo[id].gt(0))) throw new Error("NPC 无战斗返航含不合法货物或战报");
    return null;
  }
  const report = reports[0], loot = readNpcLootCargo(fleet.cargo);
  if (reports.length !== 1 || !report || report.delivery !== "returning" || report.originId !== fleet.originId
    || coordinateKey(report.target) !== coordinateKey(fleet.target) || report.seed !== fleet.npcAttack!.seed
    || report.cargoFactor !== fleet.npcAttack!.cargoFactor || !sameShips(report.battle.attackerAfter, fleet.ships)
    || !loot.ok || loot.value.some((amount, index) => amount !== report.loot[index])) throw new Error("NPC 返航战报与真实舰队不一致，已停止结算以保护存档");
  return report;
}
function settleNpcDock(state: GameState, fleetId: number, retry = false): GameState {
  const fleet = currentAttack(state, fleetId), phase = fleet.npcAttack!.phase;
  if (phase.kind !== "returning" || fleet.remaining !== 0 || phase.dockBlocked && !retry) return state;
  const report = returningReport(state, fleet);
  const origin = state.planets.find(planet => planet.id === fleet.originId)!;
  const resources = checkedNpcCargoCredit(origin.resources, fleet.cargo);
  const units = checkedShipLanding(state, origin.id, fleet);
  if (!resources.ok || !units) {
    if (retry || phase.dockBlocked) return state;
    return message({ ...state, fleets: state.fleets.map(value => value.id === fleet.id
      ? { ...value, npcAttack: { ...value.npcAttack!, phase: { ...phase, dockBlocked: true } } } : value) },
    `npc-dock-blocked-${fleet.id}`, `攻击舰队 #${fleet.id} 返港入库受阻，全部舰船与货物已保留；调整母港库存或舰船数量后可重试。`);
  }
  const npcBattles = report ? trimNpcBattleReports(state.npcBattles.reports.map(value => value.fleetId === fleet.id ? { ...value, delivery: "delivered" as const } : value)) : state.npcBattles;
  return message({ ...state, npcBattles,
    planets: state.planets.map(planet => planet.id === origin.id ? { ...planet, resources: resources.value, units } : planet),
    fleets: state.fleets.filter(value => value.id !== fleet.id) }, `return-${fleet.id}`, `攻击舰队 #${fleet.id} 已返航，全部幸存舰船与战利品已安全入港。`);
}
function settleNpcArrival(state: GameState, fleetId: number): GameState {
  const fleet = currentAttack(state, fleetId), contract = fleet.npcAttack!;
  if (contract.phase.kind !== "outbound" || fleet.remaining !== 0) return state;
  if (state.npcBattles.reports.some(report => report.fleetId === fleet.id)) throw new Error("NPC 攻击任务已存在战报，拒绝重复结算");
  if (RESOURCE_IDS.some(id => !fleet.cargo[id].eq(0))) throw new Error("NPC 攻击出航货物必须为空");
  if (!npcAt(state, fleet.target)) {
    return message({ ...state, fleets: state.fleets.map(value => value.id === fleet.id
      ? { ...value, remaining: value.duration, elapsed: 0, returning: true, npcAttack: { ...contract, phase: { kind: "returning", reason: "target-invalid", dockBlocked: false } } } : value) },
    `failed-${fleet.id}`, `攻击舰队 #${fleet.id} 目标失效，全部舰船原路返航；燃料不退。`);
  }
  const context = npcWalletContext(state);
  if (!Object.hasOwn(state.npcEconomy.sites, coordinateKey(fleet.target))) throw new Error("NPC 攻击目标缺少已付费预留记录");
  const snapshot = projectNpc(state.npcEconomy, fleet.target, context);
  const candidate = resolveNpcBattleCandidate({ universeSeed: state.universe.seed, fleetId: fleet.id, target: fleet.target,
    ships: fleet.ships, garrison: snapshot.garrison, attackerTech: npcArrivalCombatTech(state.research), stock: snapshot.stock, cargoFactor: contract.cargoFactor });
  const cargo = checkedNpcLootCargo(candidate.loot);
  if (!cargo.ok) throw new Error("NPC 战利品无法精确装载，已停止结算以保护存档");
  const npcEconomy = debitNpcAtArrival(state.npcEconomy, fleet.target, candidate.loot, candidate.garrison, context);
  const report: NpcBattleReceipt = { fleetId: fleet.id, originId: fleet.originId, target: { ...fleet.target }, at: bigToString(state.totalTime),
    seed: candidate.seed, cargoFactor: candidate.cargoFactor, attackerTech: candidate.attackerTech, battle: candidate.battle,
    stockBefore: candidate.stockBefore, loot: candidate.loot, delivery: candidate.destroyed ? "destroyed" : "returning" };
  const next: GameState = { ...state, npcEconomy, npcBattles: trimNpcBattleReports([...state.npcBattles.reports, report]),
    fleets: candidate.destroyed ? state.fleets.filter(value => value.id !== fleet.id) : state.fleets.map(value => value.id === fleet.id
      ? { ...value, ships: { ...candidate.survivors }, cargo: cargo.value, returning: true, remaining: value.duration, elapsed: 0,
        npcAttack: { ...contract, phase: { kind: "returning", reason: "battle", dockBlocked: false } } } : value) };
  const result = candidate.undefended ? "无驻军收集（0 轮）" : `${candidate.battle.rounds.length} 轮轨道战：${candidate.battle.winner === "attacker" ? "胜利" : candidate.battle.winner === "defender" ? "战败" : "平局"}`;
  return message(next, `npc-battle-${fleet.id}`, `攻击舰队 #${fleet.id} ${result}，${candidate.destroyed ? "舰队全损" : "幸存舰船携战利品返航"}；永久损失与战利品详见战报。`);
}
/** Only exact ties use stable IDs. Each settlement reads its predecessor's committed wallet. */
function resolveNpcAttackArrivalsImpl(state: GameState): GameState {
  let next = state;
  for (const fleet of state.fleets.filter(value => value.mission === "attack" && value.remaining === 0 && !isNpcAttackDockBlocked(value)).sort((a, b) => a.id - b.id)) {
    next = fleet.returning ? settleNpcDock(next, fleet.id) : settleNpcArrival(next, fleet.id);
  }
  return next;
}
function retryNpcAttackDockImpl(state: GameState, fleetId: number): FleetResult {
  const fleet = state.fleets.find(value => value.id === fleetId);
  if (!fleet || !isNpcAttackDockBlocked(fleet) || fleet.remaining !== 0) return { state, ok: false, reason: "没有对应的受阻攻击返港舰队" };
  const next = settleNpcDock(state, fleetId, true);
  return next === state ? { state, ok: false, reason: "返港入库仍受阻，请调整母港库存或舰船数量后重试" }
    : { state: next, ok: true, reason: "全部幸存舰船与战利品已安全入港" };
}
function recallNpcAttackImpl(state: GameState, fleetId: number): FleetResult {
  const fleet = currentAttack(state, fleetId), contract = fleet.npcAttack!;
  if (contract.phase.kind !== "outbound" || fleet.remaining <= 0) return { state, ok: false, reason: "只能召回尚未抵达的出航攻击舰队" };
  const next = message({ ...state, fleets: state.fleets.map(value => value.id === fleet.id
    ? { ...value, returning: true, remaining: Math.min(value.duration, value.elapsed), elapsed: 0,
      cargo: { metal: big(0), crystal: big(0), deuterium: big(0) }, npcAttack: { ...contract, phase: { kind: "returning", reason: "recall", dockBlocked: false } } } : value) },
  `recall-${fleet.id}`, `攻击舰队 #${fleet.id} 已召回，按已飞行时间返航；无战利品，燃料不退。`);
  return { state: resolveNpcAttackArrivals(next), ok: true, reason: "攻击舰队已召回，燃料不退" };
}
export function forfeitNpcAttackReports(state: GameState) {
  return trimNpcBattleReports(state.npcBattles.reports.map(report => report.delivery === "returning" ? { ...report, delivery: "forfeited" as const } : report));
}

export function resolveNpcAttackArrivals(state: GameState): GameState {
  return checkedSettlement(() => resolveNpcAttackArrivalsImpl(state));
}
export function retryNpcAttackDock(state: GameState, fleetId: number): FleetResult {
  return checkedSettlement(() => retryNpcAttackDockImpl(state, fleetId));
}
export function recallNpcAttack(state: GameState, fleetId: number): FleetResult {
  return checkedSettlement(() => recallNpcAttackImpl(state, fleetId));
}
