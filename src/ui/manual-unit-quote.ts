import { isUnitId, unitById, type UnitId } from "../data/units";
import { canBuildUnits, queuedUnits, resolveUnitAmount, unitTotal, SHIPYARD } from "../game/shipyard";
import type { GameState } from "../game/types";

export type ManualUnitMode = "count" | "max" | "fill";

/** Bound work before trimming, validating or converting an untrusted input string. */
export const MAX_MANUAL_QUANTITY_INPUT_LENGTH = 128;

export type ManualQuantityParse =
  | { ok: true; raw: string; value: number }
  | { ok: false; raw: string; reason: string };

/**
 * Manual text entry is deliberately stricter than the shared numeric game API.
 * Keep the original text for the input; never floor, clamp or silently repair it.
 * A fill target may exceed the batch limit: the domain checks the actual deficit.
 */
export function parseManualQuantity(raw: string): ManualQuantityParse {
  if (raw.length > MAX_MANUAL_QUANTITY_INPUT_LENGTH) {
    return { ok: false, raw, reason: `数量输入过长（最多 ${MAX_MANUAL_QUANTITY_INPUT_LENGTH} 个字符）` };
  }
  const text = raw.trim();
  if (!/^[0-9]+$/.test(text)) {
    return { ok: false, raw, reason: "请输入只含十进制数字的正整数" };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) {
    return { ok: false, raw, reason: "数量至少 1 且必须在安全整数范围内" };
  }
  return { ok: true, raw, value };
}

export interface ManualUnitRequest {
  unit: UnitId;
  mode: ManualUnitMode;
  raw: string;
}

export interface ManualUnitCost {
  metal: string;
  crystal: string;
  deuterium: string;
}

/** A detached snapshot for this manual dialog only, never payment authority. */
export interface ManualUnitQuote extends ManualUnitRequest {
  ok: boolean;
  reason: string;
  planetId: string;
  count: number;
  owned: number;
  /** Remaining paid queue quantities; original ordered quantities do not count. */
  queued: number;
  /** Owned plus the remaining paid queue, excluding all in-flight ships. */
  total: number;
  /** Parsed N for count/fill; null when invalid or ignored in max mode. */
  target: number | null;
  /** Full integer resource values, with neither compact suffixes nor shared Decimals. */
  cost: ManualUnitCost;
}

/** Display a complete quote amount without a Number conversion or K/M rounding. */
export function formatManualUnitCost(amount: string): string {
  return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Read-only manual preview. All positive-count eligibility and pricing come from
 * the existing domain. Call again against the latest state immediately before
 * payment; a returned quote must never be cached as authority to enqueue a job.
 */
export function quoteManualUnits(state: GameState, request: ManualUnitRequest): ManualUnitQuote {
  const base: ManualUnitQuote = {
    unit: request.unit, mode: request.mode, raw: request.raw,
    ok: false, reason: "", planetId: state.activePlanetId,
    count: 0, owned: 0, queued: 0, total: 0, target: null,
    cost: { metal: "0", crystal: "0", deuterium: "0" },
  };
  const planet = state.planets.find(value => value.id === state.activePlanetId);
  if (!planet) return { ...base, reason: "当前支付星球不存在" };
  if (!isUnitId(request.unit)) return { ...base, reason: "单位无效" };
  if (request.mode !== "count" && request.mode !== "max" && request.mode !== "fill") {
    return { ...base, reason: "手动建造模式无效" };
  }
  base.owned = planet.units[request.unit];
  base.queued = queuedUnits(planet, request.unit);
  base.total = unitTotal(planet, request.unit);

  if (request.mode === "max") {
    // The disabled input retains its text but has no role in this mode.
    base.count = resolveUnitAmount(state, request.unit, "max");
  } else {
    const parsed = parseManualQuantity(request.raw);
    if (!parsed.ok) return { ...base, reason: parsed.reason };
    base.target = parsed.value;
    base.count = request.mode === "count" ? parsed.value
      : resolveUnitAmount(state, request.unit, { fillTo: parsed.value });
  }

  if (base.count === 0) {
    if (request.mode === "fill") {
      return { ...base, reason: `${unitById(request.unit).nameZh}已有 ${base.total.toLocaleString("zh-CN")}（含已付费排队），不少于目标 ${base.target!.toLocaleString("zh-CN")}；本次无需新增，不扣资源` };
    }
    // One-unit eligibility may explain why max is zero, but its one-unit price
    // is never presented as the cost of this zero-unit quote.
    const check = canBuildUnits(state, request.unit, 1);
    return { ...base, reason: `本次可新增 0；${check.ok ? "当前资源不足以建造一个单位" : check.reason}；不扣资源` };
  }

  const check = canBuildUnits(state, request.unit, base.count);
  return {
    ...base, ok: check.ok, reason: check.reason,
    // Valid bounded batches retain the domain's integer price. Rejected
    // over-cap intent may exceed Decimal integer display precision; show its
    // bounded catalog product exactly, without making it executable or payable.
    cost: base.count > SHIPYARD.maxBatch ? {
      metal: (BigInt(unitById(request.unit).cost.metal) * BigInt(base.count)).toString(),
      crystal: (BigInt(unitById(request.unit).cost.crystal) * BigInt(base.count)).toString(),
      deuterium: (BigInt(unitById(request.unit).cost.deuterium) * BigInt(base.count)).toString(),
    } : {
      metal: check.cost.metal.toFixed(0),
      crystal: check.cost.crystal.toFixed(0),
      deuterium: check.cost.deuterium.toFixed(0),
    },
  };
}
