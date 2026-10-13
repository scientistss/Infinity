import { describe, expect, it } from "vitest";
import { big, bigToString } from "../src/game/decimal";
import {
  accumulateScoreUnits,
  computeProductionContributionUnits,
  ENERGY_CHALLENGE_SCORE_INPUT_LIMIT,
  ENERGY_CHALLENGE_TARGET_UNITS,
  ENERGY_CHALLENGE_UNITS_PER_POINT,
  evaluateProductionContribution,
  isCanonicalScoreUnits,
  type EnergyChallengeWeight,
} from "../src/game/energy-challenge-score";

// Independent, deliberately unbounded rational oracle, for moderate test exponents
// only. Production uses sparse decimal digits; this oracle expands integer powers.
const CAP = 1_000_000_000_000_000_000n;
type Rational = { numerator: bigint; denominator: bigint };
function rational(raw: string): Rational {
  const [coefficient, exponent = "0"] = raw.split(/e/i);
  const [whole, decimals = ""] = coefficient.split(".");
  const numerator = BigInt(whole + decimals);
  const scale = decimals.length - Number(exponent);
  return scale >= 0
    ? { numerator, denominator: 10n ** BigInt(scale) }
    : { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n };
}
function exactGain(before: string, after: string, weight: EnergyChallengeWeight): Rational {
  const a = rational(after);
  const b = rational(before);
  return {
    numerator: (a.numerator * b.denominator - b.numerator * a.denominator) * BigInt(weight) * 1_000_000_000_000n,
    denominator: a.denominator * b.denominator,
  };
}
function oracle(before: string, after: string, weight: EnergyChallengeWeight): bigint {
  const exact = exactGain(before, after, weight);
  if (exact.numerator <= 0n) return 0n;
  const units = exact.numerator / exact.denominator;
  return units > CAP ? CAP : units;
}
function fixed(value: bigint, places: number): string {
  const text = value.toString().padStart(places + 1, "0");
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`;
}

const golden: [string, string, EnergyChallengeWeight, bigint][] = [
  ["0", "0", 1, 0n],
  ["1", "0", 10, 0n],
  ["-0", "0.000000000001", 1, 1n],
  ["0", "-0.000", 3, 0n],
  ["0", "0.00000000000099999999999", 1, 0n],
  ["0", "0.000000000001", 1, 1n],
  ["0", "0.00000000000100000000001", 1, 1n],
  ["0", "0.0000000000001", 10, 1n],
  ["0", "0.000000000000333333333333333333", 3, 0n],
  ["0", "0.000000000000333333333333333334", 3, 1n],
  ["0.0000000000001", "0.000000000001", 1, 0n],
  ["0.0000000000001", "0.0000000000011", 1, 1n],
  ["999999.999999999999", "1000000", 1, 1n],
  ["1000000", "1000000.000000000001", 1, 1n],
  ["0", "999999.999999999999", 1, 999_999_999_999_999_999n],
  ["0", "1000000", 1, CAP],
  ["0", "1000000.000000000001", 1, CAP],
  ["1e-1000", "1000000", 1, 999_999_999_999_999_999n],
  ["1e-1000", "1", 1, 999_999_999_999n],
  ["1e-1000", "333333.333333333333333333333333333333", 3, CAP - 1n],
  ["1e-1000", "333333.333333333333333333333333333334", 3, CAP],
  ["1e-1000", "0.08666666666666666", 1, 86_666_666_666n],
  ["1e-1000", "0.08666666666666666", 3, 259_999_999_999n],
  ["1e-1000", "0.08666666666666666", 10, 866_666_666_666n],
  ["99999999999999999999999999999999999999999999999999", "1e+50", 1, 1_000_000_000_000n],
  ["99999999999999999999999999999999999999999999999999.999999999999", "1e+50", 1, 1n],
];

describe("bounded exact production challenge score", () => {
  it.each(golden)("uses exact literal boundary %s → %s, weight %s", (before, after, weight, expected) => {
    expect(computeProductionContributionUnits(before, after, weight)).toBe(expected);
    expect(oracle(before, after, weight)).toBe(expected);
  });

  it("matches an independent rational oracle across positive, equal, and decreasing values", () => {
    let seed = 713_061;
    const next = () => { seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; return seed; };
    for (let index = 0; index < 600; index++) {
      const before = `${next() + 1}e${next() % 51 - 30}`;
      const after = index % 11 === 0 ? before : `${next() + 1}e${next() % 51 - 30}`;
      for (const weight of [1, 3, 10] as const) {
        const actual = computeProductionContributionUnits(before, after, weight);
        expect(actual, `${before} → ${after}, weight ${weight}`).toBe(oracle(before, after, weight));
        expect(actual).toBeGreaterThanOrEqual(0n);
        expect(actual).toBeLessThanOrEqual(CAP);
      }
    }
  });

  it("loses strictly less than one unit per uncapped positive contribution", () => {
    for (let i = 1; i <= 200; i++) {
      const before = fixed(BigInt(i * 7919), 17);
      const after = fixed(BigInt(i * 104729), 17);
      for (const weight of [1, 3, 10] as const) {
        const exact = exactGain(before, after, weight);
        const units = computeProductionContributionUnits(before, after, weight);
        const remainder = exact.numerator - units * exact.denominator;
        expect(remainder).toBeGreaterThanOrEqual(0n);
        expect(remainder).toBeLessThan(exact.denominator);
      }
    }
  });

  it("splitting the same actual nonnegative wallet gain cannot increase score", () => {
    for (const weight of [1, 3, 10] as const) {
      for (let run = 1; run <= 80; run++) {
        let previous = BigInt(run * 37);
        const start = fixed(previous, 15);
        let total = 0n;
        for (let segment = 1; segment <= 13; segment++) {
          const next = previous + BigInt((run * segment * 7919) % 100003);
          total += computeProductionContributionUnits(fixed(previous, 15), fixed(next, 15), weight);
          previous = next;
        }
        const unsplit = computeProductionContributionUnits(start, fixed(previous, 15), weight);
        expect(total).toBeLessThanOrEqual(unsplit);
      }
    }
    expect(computeProductionContributionUnits("0", "1.2e-12", 1)).toBe(1n);
    expect(computeProductionContributionUnits("0", "4e-13", 1)
      + computeProductionContributionUnits("4e-13", "8e-13", 1)
      + computeProductionContributionUnits("8e-13", "1.2e-12", 1)).toBe(0n);
  });

  it.each([
    ["0", "1e+1000000", CAP],
    ["1e+1000000", "1.0000000000000002e+1000000", CAP],
    ["1e+1000000", "1e+1000000", 0n],
    ["1e+1000000", "9.999999999999999e+999999", 0n],
    ["9.999999999999999e+999999", "1e+1000000", CAP],
    ["1e-1000000", "1000000", CAP - 1n],
    ["1e-1000000", "1e-999999", 0n],
    ["0", "1e+8999999999999999", CAP],
    ["1e+8999999999999999", "2e+8999999999999999", CAP],
    ["1e-8999999999999999", "1000000", CAP - 1n],
  ] as const)("keeps extreme exponent work bounded: %s → %s", (before, after, expected) => {
    const result = evaluateProductionContribution(before, after, 1);
    expect(result.units).toBe(expected);
    expect(result.work.integerDigitSteps).toBeLessThanOrEqual(2 * ENERGY_CHALLENGE_SCORE_INPUT_LIMIT + 19);
    expect(result.work.digitComparisons).toBeLessThanOrEqual(2 * ENERGY_CHALLENGE_SCORE_INPUT_LIMIT + 2);
    expect(result.work.zeroRunSkips).toBeLessThanOrEqual(22);
    expect(result.reason).not.toMatch(/^invalid/);
  });

  it("subtracts a full bounded coefficient across a long carry boundary without precision loss", () => {
    const before = `${"9".repeat(500)}.99999999999`;
    expect(before.length).toBe(ENERGY_CHALLENGE_SCORE_INPUT_LIMIT);
    const result = evaluateProductionContribution(before, "1e+500", 1);
    expect(result.units).toBe(10n);
    expect(result.units).toBe(oracle(before, "1e+500", 1));
    expect(result.work.integerDigitSteps).toBeLessThanOrEqual(2 * ENERGY_CHALLENGE_SCORE_INPUT_LIMIT + 19);
  });

  it("bounds untrusted coefficient and exponent text before parsing or allocating powers", () => {
    const longCoefficient = "1".repeat(100_000);
    const longExponent = `1e${"9".repeat(100_000)}`;
    for (const text of [longCoefficient, longExponent]) {
      expect(evaluateProductionContribution("0", text, 1)).toEqual({
        units: 0n, reason: "invalid-after", work: { digitComparisons: 0, integerDigitSteps: 0, zeroRunSkips: 0 },
      });
    }
    // Even finite syntax exceeding the game's canonical exponent range stays bounded.
    const hugeExponent = `1e${"9".repeat(400)}`;
    expect(computeProductionContributionUnits("0", hugeExponent, 1)).toBe(CAP);
    expect(computeProductionContributionUnits(`1e-${"9".repeat(400)}`, "1000000", 1)).toBe(CAP - 1n);
  });

  it.each(["", " ", " 1", "1 ", "+1", "01", ".1", "1.", "1e", "1e1.5", "1e+01", "NaN", "Infinity", "-Infinity", "-1", "1_000", "0x10", "1;throw", "1\n"])(
    "fails closed and diagnoses invalid raw text %j", raw => {
      expect(evaluateProductionContribution(raw, "1", 1).reason).toBe("invalid-before");
      expect(evaluateProductionContribution("0", raw, 1).reason).toBe("invalid-after");
      expect(computeProductionContributionUnits(raw, "1", 1)).toBe(0n);
      expect(computeProductionContributionUnits("0", raw, 1)).toBe(0n);
    },
  );

  it("rejects runtime-invalid types/weights without hiding exceptions behind catch-all", () => {
    for (const raw of [null, undefined, 3, {}, [], true]) {
      expect(computeProductionContributionUnits("0", raw as unknown as string, 1)).toBe(0n);
    }
    for (const weight of [0, 2, -1, NaN, Infinity]) {
      expect(evaluateProductionContribution("0", "1", weight as EnergyChallengeWeight).reason).toBe("invalid-weight");
    }
  });

  it("accepts actual canonical wallet outputs and preserves both wallet inputs", () => {
    for (const [beforeRaw, afterRaw, weight] of golden.filter(([before]) => before !== "-0")) {
      const before = big(beforeRaw);
      const after = big(afterRaw);
      const beforeSnapshot = { mantissa: before.mantissa, exponent: before.exponent, text: bigToString(before) };
      const afterSnapshot = { mantissa: after.mantissa, exponent: after.exponent, text: bigToString(after) };
      expect(computeProductionContributionUnits(beforeSnapshot.text, afterSnapshot.text, weight))
        .toBe(oracle(beforeSnapshot.text, afterSnapshot.text, weight));
      expect({ mantissa: before.mantissa, exponent: before.exponent, text: bigToString(before) }).toEqual(beforeSnapshot);
      expect({ mantissa: after.mantissa, exponent: after.exponent, text: bigToString(after) }).toEqual(afterSnapshot);
    }
    expect(bigToString(big("1e1000000"))).toBe("1e+1000000");
    expect(computeProductionContributionUnits("0", bigToString(big("1e1000000")), 1)).toBe(CAP);
    expect(bigToString(big("1e-1000"))).toBe("1e-1000");
  });

  it("documents the pre-existing non-roundtrippable runtime Infinity boundary", () => {
    const huge = big("1e9000000000000000");
    expect(Number.isFinite(huge.exponent)).toBe(true);
    expect(bigToString(huge)).toBe("Infinity");
    expect(evaluateProductionContribution("0", bigToString(huge), 1).reason).toBe("invalid-after");
    expect(bigToString(big("1e-9000000000000000"))).toBe("0");
  });
});

describe("canonical bounded score storage", () => {
  it("uses 10^12 integer units per point and a one-million-point target", () => {
    expect(ENERGY_CHALLENGE_UNITS_PER_POINT).toBe(1_000_000_000_000n);
    expect(ENERGY_CHALLENGE_TARGET_UNITS).toBe("1000000000000000000");
    expect(CAP / ENERGY_CHALLENGE_UNITS_PER_POINT).toBe(1_000_000n);
  });

  it.each(["0", "1", "999999999999999999", "1000000000000000000"])("accepts canonical bounded %s", value => {
    expect(isCanonicalScoreUnits(value)).toBe(true);
  });

  it.each(["", "00", "01", "+0", "-0", "-1", "1.0", "1e3", " 1", "1\n", "1000000000000000001", "9999999999999999999", "10000000000000000000", null, 0])(
    "rejects noncanonical or out-of-range persisted score %j", value => {
      expect(isCanonicalScoreUnits(value)).toBe(false);
    },
  );

  it("accumulates without floats, saturates, and never decreases valid score", () => {
    expect(accumulateScoreUnits("0", 1n)).toBe("1");
    expect(accumulateScoreUnits("999999999999999998", 1n)).toBe("999999999999999999");
    expect(accumulateScoreUnits("999999999999999999", 1n)).toBe(ENERGY_CHALLENGE_TARGET_UNITS);
    expect(accumulateScoreUnits("999999999999999999", 10n ** 1000n)).toBe(ENERGY_CHALLENGE_TARGET_UNITS);
    expect(accumulateScoreUnits(ENERGY_CHALLENGE_TARGET_UNITS, 1n)).toBe(ENERGY_CHALLENGE_TARGET_UNITS);
    for (const contribution of [0n, -1n]) expect(accumulateScoreUnits("123", contribution)).toBe("123");
    expect(accumulateScoreUnits("01", 1n)).toBe("0");
  });
});
