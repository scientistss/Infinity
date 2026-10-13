import { describe, expect, it, vi } from "vitest";
import { checkedMerchantTransfer, merchantCanonicalMovementWithinBound } from "../src/game/merchant-transfer";
import { checkedWalletTransfer } from "../src/game/order-wallet";
import { big } from "../src/game/decimal";
import { createInitialState } from "../src/game/state";
import { trade, tradeQuote } from "../src/game/merchant";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";

// Regression expectations for the atomic merchant transfer guard.
// All fixtures are mathematical synthetic cases. No imported wallets or gameplay reports are used.
function fixture(metal = "5000", crystal = "100", quota = "200000"): GameState {
  const state = createInitialState(42);
  state.planets[0]!.resources = { metal: big(metal), crystal: big(crystal), deuterium: big(0) };
  // A reader-valid large storage makes the large destination-wallet case reach
  // the transfer boundary instead of being rejected by an unrelated capacity rule.
  state.planets[0]!.buildings.crystal_storage = 400;
  state.deepSpace.nextOfferId = 2;
  state.deepSpace.offers = [{ id: "merchant-1", planetId: "homeworld", startsAt: 0, expiresAt: 600,
    ratios: { metal: 3, crystal: 2, deuterium: 1 }, remainingMe: quota }];
  return deserializeState(importSave(exportSave(state, 1234)).state);
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function completeTyped(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if ("mantissa" in value && "exponent" in value) {
    return { text: String(value), mantissa: value.mantissa, exponent: value.exponent };
  }
  if (Array.isArray(value)) return value.map(completeTyped);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, completeTyped(item)]));
}
function inspect(state: GameState, amount = "1000") {
  const beforeTyped = completeTyped(state), beforeRaw = exportSave(state, 1234);
  frozen(state);
  const quote = tradeQuote(state, "merchant-1", "metal", "crystal", amount);
  const result = trade(state, "merchant-1", "metal", "crystal", amount);
  expect(completeTyped(state)).toEqual(beforeTyped);
  expect(exportSave(state, 1234)).toBe(beforeRaw);
  const outputRaw = exportSave(result.state, 1234);
  const reloaded = deserializeState(importSave(outputRaw).state);
  expect(serializeState(reloaded)).toEqual(serializeState(result.state));
  return { quote, result, beforeRaw, outputRaw };
}

describe("merchant atomic transfer boundaries", () => {
  it("uses independent integer 1000→646/1000-volume golden and changes only its three balances", () => {
    // floor(1000 × (2/3) × (97/100)) = 646, proved without Decimal arithmetic.
    expect((1000n * 2n * 97n / (3n * 100n)).toString()).toBe("646");
    expect((1000n * 3n / 3n).toString()).toBe("1000");
    const state = fixture(), expected = serializeState(state);
    const { quote, result } = inspect(state);
    expect(quote.ok).toBe(true);
    expect([quote.spent.toString(), quote.received.toString(), quote.volume.toString()]).toEqual(["1000", "646", "1000"]);
    expect(result.ok).toBe(true);
    expected.planets[0]!.resources.metal = "4000";
    expected.planets[0]!.resources.crystal = "746";
    expected.deepSpace.offers[0]!.remainingMe = "199000";
    expect(serializeState(result.state)).toEqual(expected);
  });

  it.each([
    { name: "swallowed sale debit", metal: "1e100", crystal: "100", quota: "200000" },
    { name: "swallowed purchase credit", metal: "5000", crystal: "1e100", quota: "200000" },
    { name: "swallowed quota debit", metal: "5000", crystal: "100", quota: "1e100" },
    // Decimal's reverse subtraction reports 1000 here, but the persisted
    // canonical result 999999999999000.1 proves only 999.9 actually moved.
    { name: "wrong partial sale debit", metal: "1e15", crystal: "100", quota: "200000" },
    { name: "wrong partial quota debit", metal: "5000", crystal: "100", quota: "1e15" },
    { name: "wrong partial purchase credit", metal: "5000", crystal: "1e15", quota: "200000" },
  ])("rejects $name without changing any typed or raw state", row => {
    const state = fixture(row.metal, row.crystal, row.quota);
    const { quote, result, beforeRaw, outputRaw } = inspect(state);
    expect(quote.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(outputRaw).toBe(beforeRaw);
  });

  it.each([
    { metal: "1000.1", crystal: "1000.25" },
    // Independent rational values: 2469/2 and 1285/4.
    { metal: "1234.5", crystal: "321.25" },
  ])("retains ordinary fractional wallets $metal / $crystal", row => {
    const { quote, result } = inspect(fixture(row.metal, row.crystal));
    expect(quote.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  // Existing legal ratio endpoints, plus the independent interior ratio 11/4.
  it.each([2.55, 3.45, 11 / 4])("retains legitimate fractional quota volume for ratio %s", ratio => {
    const state = fixture();
    state.deepSpace.offers[0]!.ratios.metal = ratio;
    const { quote, result } = inspect(state);
    expect(quote.ok).toBe(true);
    expect(result.ok).toBe(true);
    expect(quote.volume.toString()).not.toBe(quote.volume.floor().toString());
  });

  it.each([
    { crystal: "9354", accepted: true },
    { crystal: "9353.999999999998", accepted: true },
    // Existing Decimal cap comparison rounds this sub-ULP excess to 10000.
    // The merchant guard does not redefine capacity arithmetic.
    { crystal: "9354.000000000002", accepted: true },
    { crystal: "9354.001", accepted: false },
  ])("retains storage-cap boundary $crystal", row => {
    const state = fixture("5000", row.crystal);
    state.planets[0]!.buildings.crystal_storage = 0;
    const { quote, result } = inspect(state);
    expect(quote.ok).toBe(row.accepted);
    expect(result.ok).toBe(row.accepted);
    if (!row.accepted) expect(result.state).toBe(state);
  });
});

// Independent oracle on a fixed 24-place integer grid. It neither uses the
// production sparse-exponent sign algorithm nor Decimal reverse subtraction.
const GRID = 10n ** 24n;
function units(text: string): bigint {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const [integer, fraction = ""] = mantissa!.split(".");
  const shift = 24 + Number(exponent) - fraction.length;
  if (!Number.isInteger(shift) || shift < 0 || shift > 80) throw Error("Independent oracle fixture outside fixed grid");
  return BigInt(integer! + fraction) * 10n ** BigInt(shift);
}
function textUnits(value: bigint): string {
  const digits = value.toString().padStart(25, "0"), fraction = digits.slice(-24).replace(/0+$/, "");
  return digits.slice(0, -24) + (fraction ? `.${fraction}` : "");
}
function oracle(before: string, after: string, amount: string, credit: boolean): boolean {
  const movement = credit ? units(after) - units(before) : units(before) - units(after), quoted = units(amount);
  const error = movement > quoted ? movement - quoted : quoted - movement;
  return quoted > 0n && movement > 0n && error * 1_000_000_000n <= quoted;
}

describe("merchant canonical movement proof", () => {
  it("includes both exact tolerance boundaries and rejects their immediate outside neighbors", () => {
    const amount = 1000n * GRID, boundary = amount / 1_000_000_000n;
    for (const credit of [false, true]) {
      for (const error of [-boundary - 1n, -boundary, -boundary + 1n, 0n, boundary - 1n, boundary, boundary + 1n]) {
        const before = 2000n * GRID, actual = amount + error, after = credit ? before + actual : before - actual;
        const args = [textUnits(before), textUnits(after), textUnits(amount), credit] as const;
        expect(merchantCanonicalMovementWithinBound(...args)).toBe(oracle(...args));
        expect(merchantCanonicalMovementWithinBound(...args)).toBe(error >= -boundary && error <= boundary);
      }
    }
  });

  it("agrees with a fixed-grid oracle across differing decimal scales and cancellation", () => {
    // 1176.4705882352941 is the unchanged quote formula at the legal ratio endpoint: 1000 * 3 / 2.55.
    for (const quoted of ["0.000000001", "0.1", "1", "646", "1000", "1176.4705882352941", "1000000000000000"]) {
      for (const credit of [false, true]) {
        const amount = units(quoted), before = units("2000000000000000");
        for (const factor of [-2n, -1n, 0n, 1n, 2n]) {
          const movement = amount + factor * (amount / 1_000_000_000n), after = credit ? before + movement : before - movement;
          const args = [textUnits(before), textUnits(after), quoted, credit] as const;
          expect(merchantCanonicalMovementWithinBound(...args)).toBe(oracle(...args));
        }
      }
    }
  });

  it("rejects the legacy helper's persisted wrong-partial debit using independent integer arithmetic", () => {
    const before = big("1e15"), amount = big(1000), legacy = checkedWalletTransfer(before, amount, false)!;
    expect(legacy.toString()).toBe("999999999999000.1");
    expect(units(before.toString()) - units(legacy.toString())).toBe(9999n * GRID / 10n);
    expect(oracle(before.toString(), legacy.toString(), amount.toString(), false)).toBe(false);
    expect(checkedMerchantTransfer(before, amount, false)).toBeNull();
  });

  it("keeps stable canonical source authority when internal source mantissa changes on reload", () => {
    const before = big("1.000000000000001");
    expect(before.toString()).toBe("1");
    expect(before.mantissa).not.toBe(big(before.toString()).mantissa);
    const original = completeTyped(before);
    frozen(before);
    expect(checkedMerchantTransfer(before, big(1), false)?.toString()).toBe("0");
    expect(completeTyped(before)).toEqual(original);
  });

  it("uses bounded work for huge exponent gaps and retains a representable tiny movement", () => {
    const huge = "1e9000000000000000", tiny = "1e-9000000000000000";
    expect(merchantCanonicalMovementWithinBound(huge, huge, "1000", false)).toBe(false);
    expect(merchantCanonicalMovementWithinBound(huge, "1", "1000", false)).toBe(false);
    expect(merchantCanonicalMovementWithinBound(huge, "0", huge, false)).toBe(true);
    expect(merchantCanonicalMovementWithinBound("0", tiny, tiny, true)).toBe(true);
    expect(merchantCanonicalMovementWithinBound("1", "1", tiny, false)).toBe(false);
    expect(checkedMerchantTransfer(big("1e400"), big(1000), false)).toBeNull();
    expect(checkedMerchantTransfer(big(0), big("1e-100"), true)?.toString()).toBe("1e-100");
  });

  it("handles both sides of the bounded-alignment threshold without changing exact results", () => {
    for (const gap of [271, 272, 273]) {
      const huge = `1e${gap}`;
      expect(merchantCanonicalMovementWithinBound(huge, "1", huge, false)).toBe(true);
      expect(merchantCanonicalMovementWithinBound("1", huge, huge, true)).toBe(true);
      expect(merchantCanonicalMovementWithinBound(huge, "1", "1", false)).toBe(false);
      expect(merchantCanonicalMovementWithinBound(huge, huge, "1", false)).toBe(false);
    }
  });

  it.each([
    ["1000", "1000", "1000", false], ["1000", "1001", "1", false],
    ["1000", "999", "1", true], ["1000", "1000", "0", true],
    ["-1", "0", "1", true], ["NaN", "0", "1", false],
    ["1e1e21", "0", "1", false], ["1".repeat(257), "0", "1", false],
  ] as const)("rejects zero, wrong direction, or unsupported text: %s / %s / %s", (before, after, amount, credit) => {
    expect(merchantCanonicalMovementWithinBound(before, after, amount, credit)).toBe(false);
  });

  it("rejects invalid amounts and unstable source or candidate canonical readback", () => {
    expect(checkedMerchantTransfer(big(-1), big(1), false)).toBeNull();
    expect(checkedMerchantTransfer(big(1000), big(0), false)).toBeNull();
    expect(checkedMerchantTransfer(big(1000), big(NaN), false)).toBeNull();
    const source = big(1000);
    vi.spyOn(source, "toString").mockReturnValue("1000.00000000000001");
    expect(checkedMerchantTransfer(source, big(1), false)).toBeNull();
    const stableSource = big(1000), unstableCandidate = big(1001);
    vi.spyOn(unstableCandidate, "toString").mockReturnValue("1001.00000000000001");
    vi.spyOn(stableSource, "add").mockReturnValue(unstableCandidate);
    expect(checkedMerchantTransfer(stableSource, big(1), true)).toBeNull();
  });
});

describe("merchant unchanged business semantics", () => {
  it("preserves warehouse-cap error priority and reuses the same buyer candidate", () => {
    const lowCap = fixture("5000", "1e100");
    lowCap.planets[0]!.buildings.crystal_storage = 0;
    const low = inspect(lowCap);
    expect(low.quote.reason).toBe("接收仓库容量不足");
    expect(low.result.reason).toBe(low.quote.reason);
    const highCap = fixture("5000", "1e100");
    const high = inspect(highCap);
    expect(high.quote.reason).toBe("交易精度不足，资源或额度无法可靠转移");
    expect(high.result.state).toBe(highCap);
    const ordinary = fixture();
    const add = vi.spyOn(ordinary.planets[0]!.resources.crystal, "add");
    // Instrumentation-only runtime check: Vitest spies are not valid save data.
    // Reader-valid, frozen whole-state proof is covered separately above.
    expect(tradeQuote(ordinary, "merchant-1", "metal", "crystal", "1000").ok).toBe(true);
    expect(trade(ordinary, "merchant-1", "metal", "crystal", "1000").ok).toBe(true);
    expect(add).toHaveBeenCalledTimes(2); // One per quote/commit preflight, no recomputation.
    add.mockRestore();
  });

  it("uses the existing normalized quote amount rather than reinterpreting raw input", () => {
    const accepted = inspect(fixture(), "1000.00000000000001");
    expect(accepted.quote.spent.toString()).toBe("1000");
    expect(accepted.result.ok).toBe(true);
    const rejected = inspect(fixture(), "1000.0000000000001");
    expect(rejected.quote.ok).toBe(false);
    expect(rejected.result.ok).toBe(false);
  });

  it.each(["missing", "expired", "future", "zero-received"])("keeps %s failures atomic", mode => {
    const state = fixture();
    if (mode === "missing") state.deepSpace.offers = [];
    if (mode === "expired") state.deepSpace.offers[0]!.expiresAt = 0;
    if (mode === "future") state.deepSpace.offers[0]!.startsAt = 1;
    const { quote, result, beforeRaw, outputRaw } = inspect(state, mode === "zero-received" ? "1" : "1000");
    expect(quote.ok).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(outputRaw).toBe(beforeRaw);
  });

  it("permits repeated merchant trades, each paying all three legs", () => {
    const first = inspect(fixture()).result;
    expect(first.ok).toBe(true);
    const second = inspect(first.state).result;
    expect(second.ok).toBe(true);
    expect(second.state.planets[0]!.resources.metal.toString()).toBe("3000");
    expect(second.state.planets[0]!.resources.crystal.toString()).toBe("1392");
    expect(second.state.deepSpace.offers[0]!.remainingMe).toBe("198000");
  });
});
