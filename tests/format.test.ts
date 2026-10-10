import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import { formatDm, formatUnits } from "../src/game/format";

// Independent, uncached contract from production 9926598f63bbde35389397509412cb7d976c6c44.
// Do not call the candidate's formatAmount: its scientific fallback is part of this comparison.
function originalFormatAmount(value: BigNumber): string {
  const sign = value.sign() < 0 ? "-" : "";
  const abs = value.abs();
  if (abs.lt(1000)) return sign + abs.toFixed(2);

  let exponent = abs.exponent;
  let mantissa = Number(abs.mantissa.toFixed(2));
  if (!Number.isFinite(exponent) || !Number.isFinite(mantissa)) return value.toString();
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${sign}${mantissa.toFixed(2)}e${exponent}`;
}

function originalFormatDm(value: BigNumber | number): string {
  const n = typeof value === "number" ? value : value.toNumber();
  if (!Number.isFinite(n) || Math.abs(n) >= 1e9) {
    return originalFormatAmount(typeof value === "number" ? big(value) : value);
  }
  return Math.floor(n).toLocaleString("en-US");
}

function expectOriginalNumber(value: number): void {
  const label = Object.is(value, -0) ? "-0" : String(value);
  const expected = originalFormatDm(value);
  expect(formatDm(value), `formatDm(${label})`).toBe(expected);
  expect(formatUnits(value), `formatUnits(${label})`).toBe(expected);

  // Decimal conversion can round differently or erase signed zero. Compare its
  // own original result rather than assuming it equals the raw Number result.
  const decimal = big(value);
  expect(formatDm(decimal), `formatDm(big(${label}))`).toBe(originalFormatDm(decimal));
}

describe("whole-number formatting", () => {
  it.each<[number, string]>([
    [0, "0"],
    [-0, "-0"],
    [Number.MIN_VALUE, "0"],
    [-Number.MIN_VALUE, "-1"],
    [0.9999999999999999, "0"],
    [-0.1, "-1"],
    [1, "1"],
    [-1, "-1"],
    [1.9999999999999998, "1"],
    [-1.0000000000000002, "-2"],
    [999.9999999999999, "999"],
    [-999.9999999999999, "-1,000"],
    [1000, "1,000"],
    [1000.0000000000001, "1,000"],
    [-1000.0000000000001, "-1,001"],
    [1_234_567.89, "1,234,567"],
    [-1_234_567.89, "-1,234,568"],
    [999_999_999.9999999, "999,999,999"],
    [-999_999_999.9999999, "-1,000,000,000"],
    [1e9, "1.00e9"],
    [-1e9, "-1.00e9"],
  ])("keeps the original floor, sign, grouping and threshold for %s", (value, expected) => {
    expect(originalFormatDm(value)).toBe(expected);
    expectOriginalNumber(value);
  });

  it("matches the original at integer, notation and legal count boundaries", () => {
    // 1e12 is the fleet limit, 1e15 the local unit limit; also cover safe and
    // unsafe Number inputs without moving the existing scientific threshold.
    for (const boundary of [1, 999, 1000, 1001, 1e6, 1e9 - 1, 1e9, 1e12, 1e15, Number.MAX_SAFE_INTEGER, 1e21]) {
      for (const offset of [-1, -0.5, -Number.EPSILON * boundary, 0, Number.EPSILON * boundary, 0.5, 1]) {
        expectOriginalNumber(boundary + offset);
        expectOriginalNumber(-(boundary + offset));
      }
    }
    for (const value of [Number.MAX_SAFE_INTEGER + 2, Number.MAX_VALUE, -Number.MAX_VALUE, NaN, Infinity, -Infinity]) {
      expectOriginalNumber(value);
    }
  });

  it("matches a deterministic broad sample across every grouped display range", () => {
    let seed = 0x6d2b79f5;
    for (let index = 0; index < 2048; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const fraction = seed / 0x100000000;
      const scale = [1, 1e3, 1e6, 1e9][index % 4]!;
      const value = fraction * scale;
      expectOriginalNumber(value);
      expectOriginalNumber(-value);
      expectOriginalNumber(Math.floor(value));
    }
  });

  it("matches scientific rounding and fallback across the Number exponent range", () => {
    for (let exponent = -323; exponent <= 308; exponent += 1) {
      for (const mantissa of [1.23456789, 9.995]) {
        const value = Number(`${mantissa}e${exponent}`);
        expectOriginalNumber(value);
        expectOriginalNumber(-value);
      }
    }
  });

  it("preserves Decimal conversion around floors and the scientific threshold", () => {
    for (const text of [
      "0", "-0", "0.9999999999999999", "1.0000000000000002", "1.9999999999999998",
      "999.9999999999999", "1000.0000000000001", "999999999.9999999", "1000000000.0000001",
      "9994999999", "9995000000", "9999999999", "9007199254740991", "9007199254740993",
    ]) {
      for (const value of [big(text), big(text).neg()]) {
        expect(formatDm(value), `formatDm(${text}, sign ${value.sign()})`).toBe(originalFormatDm(value));
      }
    }
  });

  it("preserves Decimal values beyond Number range without changing the fallback", () => {
    for (const exponent of [-9e15, -1e6, -1000, -325, -324, 308, 309, 1000, 1e6, 9e15]) {
      for (const mantissa of [1, 1.23456789, 9.9949, 9.995, 9.9999999]) {
        for (const sign of [1, -1]) {
          const value = big(`${sign * mantissa}e${exponent}`);
          expect(formatDm(value), `formatDm(${sign * mantissa}e${exponent})`).toBe(originalFormatDm(value));
        }
      }
    }
  });

  it("formats fresh values on every call and does not mutate Decimal inputs", () => {
    const value = big(0);
    for (const amount of [1234.9, -1234.9, 1e9, 0, 999_999_999.5, -0, 5678.9, 1234.9]) {
      value.fromNumber(amount);
      const before = { mantissa: value.mantissa, exponent: value.exponent };
      const expected = originalFormatDm(value);
      expect(formatDm(value)).toBe(expected);
      expectOriginalNumber(-amount);
      expect(formatDm(value)).toBe(expected);
      expect({ mantissa: value.mantissa, exponent: value.exponent }).toEqual(before);
    }
  });
});
