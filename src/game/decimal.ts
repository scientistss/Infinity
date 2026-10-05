/**
 * Thin big-number boundary. Game systems import from here so
 * break_infinity.js can be swapped without touching the rules.
 */
import Decimal, { type DecimalSource } from "break_infinity.js";

export type BigNumber = Decimal;
export type { DecimalSource };

export function big(value: DecimalSource = 0): BigNumber {
  return new Decimal(value);
}

export function bigAdd(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.add(a, b);
}

export function bigSub(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.sub(a, b);
}

export function bigMul(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.mul(a, b);
}

export function bigDiv(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.div(a, b);
}

export function bigSqrt(value: DecimalSource): BigNumber {
  return Decimal.sqrt(value);
}

export function bigFloor(value: DecimalSource): BigNumber {
  return Decimal.floor(value);
}

export function bigMin(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.min(a, b);
}

export function bigMax(a: DecimalSource, b: DecimalSource): BigNumber {
  return Decimal.max(a, b);
}

export function bigPow(base: DecimalSource, exp: number | Decimal): BigNumber {
  return Decimal.pow(base, exp);
}

/** How many geometric-cost purchases `resources` can afford. */
export function affordableCount(
  resources: DecimalSource,
  priceStart: DecimalSource,
  priceRatio: DecimalSource,
  owned: number | BigNumber,
): BigNumber {
  return Decimal.affordGeometricSeries(resources, priceStart, priceRatio, owned);
}

/** Total cost of `count` purchases at a geometric price. */
export function seriesCost(
  count: number | BigNumber,
  priceStart: DecimalSource,
  priceRatio: DecimalSource,
  owned: number | BigNumber,
): BigNumber {
  return Decimal.sumGeometricSeries(count, priceStart, priceRatio, owned);
}

export function isValidAmount(value: BigNumber): boolean {
  return Number.isFinite(value.mantissa) && Number.isFinite(value.exponent) && value.gte(0);
}

export function bigToString(value: BigNumber): string {
  return value.toString();
}
