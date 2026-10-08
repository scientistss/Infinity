import { DEEP } from "../data/deep-space";
import { blackholeProtection, fleetValue, empireFleetValue } from "../game/deep-space";
import { quoteFlight, type FleetRequest } from "../game/fleet";
import { formatAmount, formatDuration, formatUnits } from "../game/format";
import { big } from "../game/decimal";
import { unitById, SHIP_IDS } from "../data/units";
import type { GameState } from "../game/types";

/** Advisory preview only. Actual protection is recalculated at the hold-completion boundary. */
export function chargePreview(state: GameState, request: FleetRequest): { risk: string; capacity: string } {
  if (request.mission !== "charge") return { risk: "", capacity: "" };
  const quote = quoteFlight(state, request);
  if (!quote.ok) return { risk: "请先完成有效编队。黑洞保护不免除海盗或异星战损。", capacity: "" };
  const nextIndex = state.deepSpace.completed + 1;
  const fraction = empireFleetValue(state) ? fleetValue(request.ships) / empireFleetValue(state) : 0;
  const protection = nextIndex <= DEEP.beginnerProtection ? `前 ${DEEP.beginnerProtection} 次保护`
    : state.deepSpace.lastBlackhole > 0 && nextIndex - state.deepSpace.lastBlackhole <= DEEP.blackholeCooldown ? "黑洞后冷却保护"
    : fraction > DEEP.fleetShareProtection ? "舰队价值超过帝国 50% 的保护" : "无黑洞保护";
  const load = request.cargo.metal.add(request.cargo.crystal).add(request.cargo.deuterium);
  return {
    risk: `当前预计：${protection}；本支占移动舰队价值 ${(fraction * 100).toFixed(1)}%。结算时重新判定，并发任务可能改变保护状态。海盗与异星仍可造成战损。`,
    capacity: `货物 ${formatAmount(load)} · 装载及预留燃料后余舱 ${formatAmount(quote.capacity.sub(load).sub(quote.fuel).max(0))} · 常规往返含驻留约 ${formatDuration(Math.ceil(quote.duration * 2 + (quote.holdSeconds ?? 0)))}。战损可能减少舱容，超舱奖品会明确记录放弃。`,
  };
}

export function deepFlightDetails(state: GameState): Array<{ id: number; text: string }> {
  return state.fleets.map(fleet => {
    const ships = SHIP_IDS.filter(id => (fleet.ships[id] ?? 0) > 0)
      .map(id => `${unitById(id).nameZh} ×${formatUnits(fleet.ships[id]!)}`).join("、");
    const stock = `金属 ${formatAmount(fleet.cargo.metal)} / 晶体 ${formatAmount(fleet.cargo.crystal)} / 重氢 ${formatAmount(fleet.cargo.deuterium)}`;
    const pending = fleet.charge ? ` · 待入库暗物质 ${formatAmount(big(fleet.charge.dm))}` : "";
    const protection = fleet.charge && !fleet.returning ? blackholeProtection(state, fleet) : "";
    return { id: fleet.id, text: `${ships}；舰载 ${stock}${pending}${protection ? ` · 当前黑洞保护：${protection}` : ""}` };
  });
}
