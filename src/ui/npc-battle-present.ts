import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { big } from "../game/decimal";
import { formatPlayed } from "../game/format";
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

/** Origin identity is current, delivery is live; combat facts remain the immutable receipt. */
export function npcBattleReportsView(state: GameState) {
  const reports = state.npcBattles.reports;
  if (!reports.length) return [];
  const origins = new Map(state.planets.map(planet => [planet.id, planet]));
  const returning = reports.some(report => report.delivery === "returning");
  const live = new Map(returning ? state.fleets.filter(fleet => fleet.mission === "attack").map(fleet => [fleet.id, fleet]) : []);
  return reports.slice().reverse().map(report => {
    const fleet = live.get(report.fleetId), phase = fleet?.npcAttack?.phase;
    const delivery = report.delivery === "delivered" ? "已入港" : report.delivery === "destroyed" ? "全损" : report.delivery === "forfeited" ? "已丢弃"
      : phase?.kind === "returning" && phase.reason === "battle" ? phase.dockBlocked ? "入港受阻" : "战后返航" : "交付状态不可确认";
    const undefended = report.battle.rounds.length === 0 && Object.values(report.battle.defenderBefore).every(value => !value);
    const outcome = undefended ? "无驻军收集" : report.battle.winner === "attacker" ? "胜" : report.battle.winner === "defender" ? "败" : "平";
    const origin = origins.get(report.originId);
    const route = `${origin ? `${origin.name} [${coordinateKey(origin.coordinates)}]` : "原出发星球已不可用"} → [${coordinateKey(report.target)}]`;
    const lostShips = SHIP_IDS.reduce((total, id) => id === "solar_satellite" ? total
      : total + (report.battle.attackerBefore[id] ?? 0) - (report.battle.attackerAfter[id] ?? 0), 0);
    const lossText = `我方永久损失：${lostShips} 艘`;
    const lootText = `实际装载：${npcLootText(report.loot)}`;
    const timeText = `游戏时间 ${formatPlayed(big(report.at))}`;
    const roundText = `${report.battle.rounds.length} 回合`;
    const summary = `#${report.fleetId} · ${outcome} · ${roundText} · ${delivery} · ${route} · ${lossText} · ${lootText} · ${timeText}`;
    return { id: report.fleetId, outcome, route, lossText, lootText, timeText, roundText, summary, delivery, report };
  });
}
export type NpcBattleReportsView = ReturnType<typeof npcBattleReportsView>;
