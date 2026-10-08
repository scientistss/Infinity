/** Read-only deep-space presentation. Never reads an unrevealed RNG outcome. */
import { DEEP } from "../data/deep-space";
import { formatAmount, formatDuration, formatUnits } from "../game/format";
import { big } from "../game/decimal";
import { coordinateKey } from "../game/galaxy";
import { chargeDeliveryStatus, type ChargeReport } from "../game/deep-state";
import type { GameState } from "../game/types";

export const REPORT_FILTERS = ["all", "battle", "merchant", "loss", "pending"] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number];
export function validReportFilter(value: string): ReportFilter {
  return REPORT_FILTERS.includes(value as ReportFilter) ? value as ReportFilter : "all";
}
export function reportMatches(state: GameState, report: ChargeReport, filter: ReportFilter): boolean {
  if (filter === "battle") return report.battle !== null;
  if (filter === "merchant") return report.symbol === "merchant";
  if (filter === "loss") return report.destroyed;
  if (filter === "pending") return chargeDeliveryStatus(state, report) === "返航中";
  return true;
}
export function chargeRows(state: GameState) {
  return state.fleets.filter(f => f.mission === "charge" && f.charge).map(f => {
    const phase = f.returning ? "return" : f.charge!.phase;
    const duration = f.elapsed + f.remaining;
    return {
      id: f.id, phase,
      stage: phase === "outbound" ? "前往深空" : phase === "holding" ? "驻留充能" : "返航入港",
      origin: state.planets.find(p => p.id === f.originId)?.name ?? f.originId,
      destination: coordinateKey(f.target), slots: f.charge!.slots,
      progress: duration > 0 ? Math.max(0, Math.min(100, f.elapsed / duration * 100)) : 100,
      remaining: formatDuration(Math.ceil(Math.max(0, f.remaining))),
      ships: formatUnits(Object.values(f.ships).reduce((sum, n) => sum + (n ?? 0), 0)),
      cargo: formatAmount(f.cargo.metal.add(f.cargo.crystal).add(f.cargo.deuterium)),
      canRecall: !f.returning,
      reportId: f.charge!.reportId,
      note: phase === "return"
        ? f.charge!.reportId ? "事件已结算；奖励到港后入库，回放不重复发奖。" : "已召回；未完成充能押注到港退回，燃料不退。"
        : "尚未生成结果。可召回，燃料不退；保护不免除遭遇战损。",
    };
  });
}
export function protectionSummary(state: GameState): string {
  const { completed, lastBlackhole } = state.deepSpace;
  const beginner = Math.max(0, DEEP.beginnerProtection - completed);
  const cooldown = lastBlackhole > 0 ? Math.max(0, DEEP.blackholeCooldown - (completed - lastBlackhole)) : 0;
  if (beginner) return `黑洞新手保护 · 剩余 ${beginner} 次；仍有海盗／异星战损风险。`;
  if (cooldown) return `黑洞冷却保护 · 剩余 ${cooldown} 次；仍有海盗／异星战损风险。`;
  return "黑洞计次保护已结束；舰队价值超过帝国50%的保护在事件结算时另行判断。";
}
export function merchantSummary(state: GameState) {
  const now = state.totalTime.toNumber();
  const local = state.deepSpace.offers.filter(o => o.planetId === state.activePlanetId);
  const usable = local.filter(o => o.startsAt >= 0 && o.startsAt <= now && o.expiresAt > now && big(o.remainingMe).gt(0));
  const pending = local.filter(o => o.startsAt < 0);
  return {
    usable: usable.length, pending: pending.length,
    text: usable.length ? `本港可交易 ${usable.length} 份报价 · 手续费 ${DEEP.merchantFee * 100}%`
      : pending.length ? `本港 ${pending.length} 份联络等待舰队返航，尚不能交易。`
      : "本港暂无可交易报价；可由商船事件取得，或主动呼叫。",
  };
}
