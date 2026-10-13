/** Read-only salvage amounts for the current manual recycling draft. */
import { big, isValidAmount, type BigNumber } from "../game/decimal";
import { quoteFlight, type FleetRequest, type FlightQuote } from "../game/fleet";
import { coordinateKey, validCoordinates } from "../game/galaxy";
import { calculateRecycleAmounts, type RecycleAmounts } from "../game/recycle-amounts";
import { RESOURCE_IDS, type GameState } from "../game/types";

export type RecyclePreviewAmounts = { [K in keyof RecycleAmounts]: string };

export interface RecyclePreview {
  available: boolean;
  status: "ready" | "no-visible-debris" | "unavailable";
  reason: string;
  summary: string;
  target: string;
  notice: string;
  visibleDebris: { metal: string; crystal: string } | null;
  /** Exact engine strings. Null is unavailable, never a fabricated zero. */
  amounts: RecyclePreviewAmounts | null;
}

const NOTICE = "仅按当前可见残骸、当前舰船与货物及当前超空间科技计算；抵达前残骸或科技可能变化，实际以抵达时结算为准。燃料由正式派遣扣除，回收计算不再次扣除；回收货物返航后才入库。预览不会派遣、占用或预留残骸。";
const INVALID = "当前回收参数无效，无法安全预览";
const NO_DEBRIS = "目标当前没有可见残骸，无法预览回收量";
const AMOUNT_TEXT = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function validAmount(value: unknown): value is BigNumber {
  const amount = value as BigNumber | null | undefined;
  if (!amount || typeof amount.add !== "function" || typeof amount.eq !== "function"
    || typeof amount.gte !== "function" || !isValidAmount(amount)) return false;
  const text = amount.toString();
  // Validate Decimal's text boundary, without rejecting valid values such as
  // 1e999 through Number conversion. Its overflow/underflow sentinels are unsafe.
  return AMOUNT_TEXT.test(text) && (text !== "0" || amount.eq(0));
}

function unavailable(reason: string, target: string, missing = false): RecyclePreview {
  return { available: false, status: missing ? "no-visible-debris" : "unavailable",
    reason, summary: `回收预览不可用：${reason}`, target, notice: NOTICE,
    visibleDebris: null, amounts: null };
}

/**
 * Pass only the quote for this same state and draft from the current render to
 * avoid quoting twice. Neither the quote nor this display model grants dispatch
 * authority, reserves debris, advances time, or predicts other fleet arrivals.
 */
export function recyclePreview(state: GameState, request: FleetRequest, currentQuote?: FlightQuote): RecyclePreview | null {
  if (request?.mission !== "recycle") return null;
  let target = "—";
  try {
    const coordinatesOK = validCoordinates(request.target, true);
    if (coordinatesOK) target = coordinateKey(request.target);
    // Reuse the real engine's current mission, fleet, cargo, fuel and slot gates.
    const quote = currentQuote ?? quoteFlight(state, request);
    if (!quote.ok) return quote.reason === "目标没有可回收残骸"
      ? unavailable(NO_DEBRIS, target, true) : unavailable(quote.reason, target);
    if (!coordinatesOK) return unavailable("目标坐标无效", target);
    const field = state.deepSpace.debris.find(value => coordinateKey(value.target) === target);
    if (!field) return unavailable(NO_DEBRIS, target, true);
    if (RESOURCE_IDS.some(id => !validAmount(request.cargo?.[id]))) {
      return unavailable("货物必须为有限的非负大数", target);
    }
    if (typeof field.metal !== "string" || typeof field.crystal !== "string"
      || !AMOUNT_TEXT.test(field.metal) || !AMOUNT_TEXT.test(field.crystal)
      || !validAmount(big(field.metal)) || !validAmount(big(field.crystal))) {
      return unavailable("当前可见残骸数量无效，无法安全预览", target);
    }
    const hyperspace = state.research.levels.hyperspace_tech;
    if (!Number.isSafeInteger(hyperspace) || hyperspace < 0) return unavailable(INVALID, target);
    // Settlement uses all three carried resources, current technology and the
    // collector cap. Fuel is already paid by dispatch, so do not subtract it here.
    const result = calculateRecycleAmounts({ ships: request.ships, cargo: request.cargo, hyperspace, debris: field });
    if (Object.values(result).some(value => !validAmount(value))) return unavailable(INVALID, target);
    const amounts: RecyclePreviewAmounts = {
      capacity: result.capacity.toString(), collector: result.collector.toString(),
      used: result.used.toString(), room: result.room.toString(),
      metal: result.metal.toString(), crystal: result.crystal.toString(),
      leftMetal: result.leftMetal.toString(), leftCrystal: result.leftCrystal.toString(),
    };
    return { available: true, status: "ready", reason: "按当前可见残骸计算",
      summary: `预计回收（当前条件）：金属 ${amounts.metal} · 晶体 ${amounts.crystal}`,
      target, notice: NOTICE, visibleDebris: { metal: big(field.metal).toString(), crystal: big(field.crystal).toString() }, amounts };
  } catch {
    // Incomplete or externally malformed drafts must never break fleet rendering.
    return unavailable(INVALID, target);
  }
}
