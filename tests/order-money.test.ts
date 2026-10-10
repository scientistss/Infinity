import { describe, expect, it } from "vitest";
import { addOrderAmounts, compareOrderAmounts, isOrderAmount, multiplyOrderAmountInteger, normalizeOrderAmount, subtractOrderAmounts } from "../src/game/order-money";

describe("bounded exact order amounts", () => {
  it("keeps decimal quotes exact across addition, difference and multiplication", () => {
    expect(addOrderAmounts("0.1", "0.2")).toBe("0.3");
    expect(subtractOrderAmounts("123.456789012345678901", "23.4567890123456789")).toBe("100.000000000000000001");
    expect(multiplyOrderAmountInteger("0.000000000000000001", 1_000_000)).toBe("0.000000000001");
    expect(normalizeOrderAmount("00012.34000e+2")).toBe("1234");
    expect(compareOrderAmounts("1e3", "1000.000")).toBe(0);
  });
  it("enforces range and effective fractional precision without rounding", () => {
    expect(isOrderAmount("1e190")).toBe(true);
    expect(addOrderAmounts("1e190", "0")).toBe(`1${"0".repeat(190)}`);
    expect(addOrderAmounts("1e190", "0.000000000000000001")).toBeNull();
    expect(subtractOrderAmounts("1", "1.000000000000000001")).toBeNull();
    expect(isOrderAmount("1e-18")).toBe(true);
    expect(isOrderAmount("1e-19")).toBe(false);
    expect(isOrderAmount("0.1000000000000000000")).toBe(true);
    expect(multiplyOrderAmountInteger("1e190", 2)).toBeNull();
  });
  it.each(["-1", "+1", "NaN", "Infinity", "", " 1", "1 ", ".1", "1.", "0x10", "1e100000000", "1e-100000000", "9".repeat(257)])("rejects unsupported input %s", value => {
    expect(isOrderAmount(value)).toBe(false);
    expect(normalizeOrderAmount(value)).toBeNull();
    expect(compareOrderAmounts(value, "1")).toBeNull();
  });
  it("bounds integer multipliers", () => {
    expect(multiplyOrderAmountInteger("1", -1)).toBeNull();
    expect(multiplyOrderAmountInteger("1", 1.5)).toBeNull();
    expect(multiplyOrderAmountInteger("1", Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(multiplyOrderAmountInteger("1e190", 0)).toBe("0");
    expect(isOrderAmount(null)).toBe(false);
    expect(isOrderAmount(1)).toBe(false);
  });
  it("telescopes repricing and final refund with eighteen-place quotes", () => {
    const paid = "800.100000000000000001", repriced = "400.200000000000000001";
    const difference = subtractOrderAmounts(paid, repriced)!;
    expect(addOrderAmounts(difference, repriced)).toBe(paid);
  });
});
