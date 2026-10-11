import type { BuildingDef } from "../data/buildings";
import { big, isValidAmount, type BigNumber } from "./decimal";
import { validDemolitionSeconds } from "./demolition-state";
import { buildSeconds } from "./formulas";
import { compareOrderAmounts, isOrderAmount } from "./order-money";
import { MAX_ORDER_LEVEL, type OrderMoney } from "./order-state";
import { RESOURCE_IDS, type ResourceAmounts } from "./types";

interface Rational { n: bigint; d: bigint }
/** Decimal text is parsed independently of the approximate wallet implementation. */
function rational(value: string): Rational | null {
  if (value.length > 4096) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 4096) return null;
  const digits = BigInt(match[1]! + fraction), shift = exponent - fraction.length;
  return shift >= 0 ? { n: digits * 10n ** BigInt(shift), d: 1n } : { n: digits, d: 10n ** BigInt(-shift) };
}
export function exactIntegerString(value: string): string | null {
  const number = rational(value);
  return number && number.n % number.d === 0n ? (number.n / number.d).toString() : null;
}
/** B has no order-budget ceiling, but must independently survive the resource representation. */
function exactResource(integer: bigint, payment: boolean): BigNumber | null {
  const expected = integer.toString();
  if (payment && !isOrderAmount(expected)) return null;
  const value = big(expected);
  if (!isValidAmount(value) || exactIntegerString(value.toString()) !== expected) return null;
  const restored = big(JSON.parse(JSON.stringify(value.toString())) as string);
  if (!isValidAmount(restored) || exactIntegerString(restored.toString()) !== expected) return null;
  if (payment && compareOrderAmounts(expected, value.toString()) !== 0) return null;
  return value;
}
export interface DemolitionExactCosts {
  paidExact: OrderMoney;
  timeExact: Record<keyof ResourceAmounts, string>;
}
export type DemolitionExactResult = { ok: true; exact: DemolitionExactCosts; reason: "" } | { ok: false; exact: null; reason: string };
/** Auditable mathematical result before the separate resource-representation gate. */
export function demolitionExactCosts(def: BuildingDef, fromLevel: number, ionLevel: number, growthCut: number): DemolitionExactResult {
  const fail = (reason: string): DemolitionExactResult => ({ ok: false, exact: null, reason });
  if (!Number.isSafeInteger(fromLevel) || fromLevel < 1 || fromLevel > MAX_ORDER_LEVEL
    || !Number.isSafeInteger(ionLevel) || ionLevel < 0 || ionLevel > MAX_ORDER_LEVEL) return fail("拆除等级无效");
  if (!Number.isFinite(def.factor) || def.factor <= 0 || def.factor > 10
    || !Number.isFinite(growthCut) || growthCut < 0 || growthCut > 10) return fail("拆除增长因子无效");
  const raw = rational(String(def.factor)), cut = rational(String(growthCut));
  if (!raw || !cut) return fail("拆除增长因子无法精确表示");
  const sub = { n: raw.n * cut.d - cut.n * raw.d, d: raw.d * cut.d };
  const effective = sub.n * 100n < sub.d * 101n ? { n: 101n, d: 100n } : sub;
  const power = BigInt(Math.max(0, fromLevel - 2));
  const numeratorFactor = fromLevel === 1 ? raw.d : effective.n ** power;
  const denominator = fromLevel === 1 ? raw.n : effective.d ** power;
  const discount = BigInt(Math.max(0, 25 - Math.min(ionLevel, 25)));
  const paidExact = {} as OrderMoney, timeExact = {} as Record<keyof ResourceAmounts, string>;
  for (const id of RESOURCE_IDS) {
    const base = def.baseCost[id];
    if (!Number.isSafeInteger(base) || base < 0) return fail("拆除目录成本无效");
    const numerator = BigInt(base) * numeratorFactor;
    paidExact[id] = (numerator * discount / (denominator * 25n)).toString();
    timeExact[id] = (numerator / denominator).toString();
  }
  return { ok: true, reason: "", exact: { paidExact, timeExact } };
}
export interface DemolitionPrice extends DemolitionExactCosts {
  paid: ResourceAmounts;
  timeCost: ResourceAmounts;
  totalSeconds: number;
}
export type DemolitionPriceResult = { ok: true; price: DemolitionPrice; reason: "" } | { ok: false; price: null; reason: string };

/** Exact P/B first, then fail closed on unsupported resource representation or timer. */
export function demolitionPrice(def: BuildingDef, fromLevel: number, ionLevel: number, growthCut: number, robotics: number, nanite: number): DemolitionPriceResult {
  const fail = (reason: string): DemolitionPriceResult => ({ ok: false, price: null, reason });
  if (!Number.isSafeInteger(robotics) || robotics < 0 || robotics > MAX_ORDER_LEVEL
    || !Number.isSafeInteger(nanite) || nanite < 0 || nanite > MAX_ORDER_LEVEL) return fail("拆除计时条件无效");
  const result = demolitionExactCosts(def, fromLevel, ionLevel, growthCut);
  if (!result.ok) return fail(result.reason);
  const { paidExact, timeExact } = result.exact;
  const paid = {} as ResourceAmounts, timeCost = {} as ResourceAmounts;
  for (const id of RESOURCE_IDS) {
    const p = exactResource(BigInt(paidExact[id]), true), b = exactResource(BigInt(timeExact[id]), false);
    if (p === null || b === null) return fail("拆除报价或计时基价无法精确保存，未扣款");
    paid[id] = p; timeCost[id] = b;
  }
  const totalSeconds = buildSeconds(timeCost, fromLevel - 1, def, robotics, nanite);
  if (!validDemolitionSeconds(totalSeconds, totalSeconds)) return fail("拆除耗时超出安全范围（至少 1 秒且小于 2³³ 秒），未扣款");
  return { ok: true, reason: "", price: { paid, timeCost, paidExact, timeExact, totalSeconds } };
}
