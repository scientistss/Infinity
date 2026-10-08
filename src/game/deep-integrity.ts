import { BOARD, BET_SYMBOLS } from "../data/arcade";
import { SHIP_IDS } from "../data/units";
import { DEEP } from "../data/deep-space";
import { sameCoordinates } from "./galaxy";
import type { GameState } from "./types";
import { expeditionSlots, type ShipCounts } from "./deep-state";

const count = (ships: ShipCounts) => Object.values(ships).reduce((sum, n) => sum + (n ?? 0), 0);

/** Cross-object invariants after all individual save readers have validated their own fields.
 * Historical reports may outlive their planet, receipt or fleet. Pending loot may not be duplicated.
 */
export function assertDeepLinks(state: GameState): void {
  const flights = state.fleets.filter(f => f.mission === "charge");
  if (flights.length > expeditionSlots(state)) throw Error("充能舰队超过远征槽上限");
  const reports = new Map(state.deepSpace.reports.map(r => [r.id, r]));
  const activeReports = new Set<string>(), activeOffers = new Set<string>();
  for (const fleet of flights) {
    const charge = fleet.charge!;
    if (charge.cargoFactor > 1 + 0.05 * state.research.levels.hyperspace_tech + 1e-9) throw Error("充能货舱倍率超过已完成科技");
    if (!charge.reportId) continue;
    if (charge.reportId !== `charge-${fleet.id}` || activeReports.has(charge.reportId)) throw Error("充能奖励凭证归属不一致");
    activeReports.add(charge.reportId);
    const report = reports.get(charge.reportId);
    if (report && (report.originId !== fleet.originId || !sameCoordinates(report.target, fleet.target)
      || report.destroyed || report.returned || report.slots !== charge.slots)) throw Error("返航舰队与充能报告不一致");
    if (charge.offerId) {
      if (activeOffers.has(charge.offerId)) throw Error("同一商人联络绑定多支舰队");
      activeOffers.add(charge.offerId);
      const offer = state.deepSpace.offers.find(o => o.id === charge.offerId);
      if (!offer || offer.planetId !== fleet.originId || offer.startsAt !== -1 || offer.expiresAt !== -1) throw Error("在途商人联络已生效或归属错误");
    }
  }
  for (const offer of state.deepSpace.offers) {
    if (offer.startsAt === -1 && !activeOffers.has(offer.id)) throw Error("待激活商人缺少返航舰队");
  }
  for (const report of reports.values()) {
    if (report.id !== `charge-${report.fleetId}` || report.fleetId >= state.nextFleetId || report.target.position !== 16) throw Error("充能报告身份或目标无效");
    if (report.destroyed && report.returned) throw Error("全损舰队不能标记为已返航");
    if (report.protection) {
      if (report.rawSymbol !== "blackhole" || report.symbol !== "turbulence" || report.destroyed) throw Error("黑洞保护记录不一致");
    } else if (report.rawSymbol !== report.symbol) throw Error("未受保护的事件不应改变符号");
    const combat = report.symbol === "pirate" || report.symbol === "alien";
    if (combat !== !!report.battle) throw Error("遭遇战缺少战报或非战斗事件夹带战报");
    if (report.battle) {
      const b = report.battle;
      let attackers = count(b.attackerBefore), defenders = count(b.defenderBefore);
      if (!attackers || !defenders || !b.rounds.length || b.rounds.length > DEEP.combatRounds) throw Error("战报初始舰队或回合无效");
      for (const round of b.rounds) {
        if (!attackers || !defenders || round.attacker > attackers || round.defender > defenders) throw Error("战报回合舰数不守恒");
        attackers = round.attacker; defenders = round.defender;
      }
      if (attackers !== count(b.attackerAfter) || defenders !== count(b.defenderAfter)) throw Error("战报末回合与存活舰队不一致");
      const winner = attackers && !defenders ? "attacker" : defenders && !attackers ? "defender" : "draw";
      if (b.winner !== winner || report.destroyed !== (attackers === 0)) throw Error("战报胜负与存活舰队不一致");
      for (const id of SHIP_IDS) if ((b.attackerAfter[id] ?? 0) > (b.attackerBefore[id] ?? 0)
        || (b.defenderAfter[id] ?? 0) > (b.defenderBefore[id] ?? 0)) throw Error("战报损失为负数");
    }
  }
  for (const run of state.arcade.runs) {
    if (run.source !== "charge") continue;
    const receipt = run.receipt!, main = receipt.lights[0]!;
    if (main.tile !== run.outcome.main.tile || main.symbol !== BOARD[run.outcome.main.tile] || main.big !== run.outcome.main.big) throw Error("充能回放与预掷结果不一致");
    const report = reports.get(receipt.reportId);
    if (report && (report.originId !== receipt.originId || JSON.stringify(report.outcome) !== JSON.stringify(run.outcome))) throw Error("充能回放与报告不一致");
  }
  // A pure read must never introduce a new reward or silently repair a broken contract.
  for (const fleet of flights) {
    const c = fleet.charge!;
    if (BET_SYMBOLS.reduce((sum, id) => sum + c.bets[id], 0) === 0 && c.stake !== 0) throw Error("未押注却存在充能本金");
  }
}
