import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { coordinateKey } from "../game/galaxy";
import type { NpcBattleReceipt } from "../game/npc-attack-state";
import type { GameState } from "../game/types";

const counts = (ships: Readonly<Partial<Record<ShipId, number>>>) => SHIP_IDS
  .filter(id => (ships[id] ?? 0) > 0).map(id => `${unitById(id).nameZh} ${ships[id]}`).join(" · ") || "无";
const losses = (before: Readonly<Partial<Record<ShipId, number>>>, after: Readonly<Partial<Record<ShipId, number>>>) =>
  counts(Object.fromEntries(SHIP_IDS.map(id => [id, (before[id] ?? 0) - (after[id] ?? 0)])));
export const npcLootText = (loot: readonly number[]) => `金属 ${loot[0]} · 晶体 ${loot[1]} · 重氢 ${loot[2]}`;

/** Historical battle data never joins live research, wallets, garrisons or names. */
export function npcBattleDetails(report: NpcBattleReceipt) {
  const battle = report.battle;
  return {
    source: `出发星球 ${report.originId} → [${coordinateKey(report.target)}] · 实际游戏时间 ${report.at} 秒`,
    attacker: `我方出征：${counts(battle.attackerBefore)}；永久损失：${losses(battle.attackerBefore, battle.attackerAfter)}；幸存：${counts(battle.attackerAfter)}`,
    defender: `NPC 当时驻军：${counts(battle.defenderBefore)}；永久损失：${losses(battle.defenderBefore, battle.defenderAfter)}；幸存：${counts(battle.defenderAfter)}`,
    loot: `实际装载：${npcLootText(report.loot)}。返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益，不计入普通可花库存。此处仍记录本场完整整数战利品，历史战报不可再次领取。`,
    tech: `本场我方武器 ${report.attackerTech.weapons} / 护盾 ${report.attackerTech.shields} / 装甲 ${report.attackerTech.armour}；NPC 科技均为 0。出航货舱倍率 ×${report.cargoFactor}。`,
  };
}

/** The expensive round strings are requested only when that report is expanded. */
export function npcBattleRounds(report: NpcBattleReceipt) {
  return report.battle.rounds.map(round => ({
    round: String(round.round), attacker: String(round.attacker), defender: String(round.defender),
    attackDamage: String(round.attackDamage), defendDamage: String(round.defendDamage),
  }));
}

/** Only delivery is live; all combat facts remain the immutable receipt snapshot. */
export function npcBattleReportsView(state: GameState) {
  const returning = state.npcBattles.reports.some(report => report.delivery === "returning");
  const live = new Map(returning ? state.fleets.filter(fleet => fleet.mission === "attack").map(fleet => [fleet.id, fleet]) : []);
  return state.npcBattles.reports.slice().reverse().map(report => {
    const fleet = live.get(report.fleetId), phase = fleet?.npcAttack?.phase;
    const delivery = report.delivery === "delivered" ? "已入港" : report.delivery === "destroyed" ? "全损" : report.delivery === "forfeited" ? "已丢弃"
      : phase?.kind === "returning" && phase.reason === "battle" ? phase.dockBlocked ? "入港受阻" : "战后返航" : "交付状态不可确认";
    const undefended = report.battle.rounds.length === 0 && Object.values(report.battle.defenderBefore).every(value => !value);
    const outcome = undefended ? "无驻军收集" : report.battle.winner === "attacker" ? "胜" : report.battle.winner === "defender" ? "败" : "平";
    return { id: report.fleetId, summary: `#${report.fleetId} · [${coordinateKey(report.target)}] · ${outcome} · ${report.battle.rounds.length} 回合 · ${delivery}`, delivery, report };
  });
}
export type NpcBattleReportsView = ReturnType<typeof npcBattleReportsView>;
