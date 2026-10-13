/** Exact, bounded challenge points. This module never reads or changes a wallet. */
export const ENERGY_CHALLENGE_TARGET_UNITS = "1000000000000000000";
export const ENERGY_CHALLENGE_UNITS_PER_POINT = 1_000_000_000_000n;
export const ENERGY_CHALLENGE_SCORE_INPUT_LIMIT = 512;
const TARGET = 1_000_000_000_000_000_000n;
const INTEGER_LIMIT = TARGET + 1n;

export type EnergyChallengeWeight = 1 | 3 | 10;
export type ContributionReason = "credited" | "no-gain" | "invalid-before" | "invalid-after" | "invalid-weight";
export interface ContributionEvaluation {
  units: bigint;
  reason: ContributionReason;
  /** Deterministic operation counts, not wall-clock performance measurements. */
  work: { digitComparisons: number; integerDigitSteps: number; zeroRunSkips: number };
}

type DecimalText = { digits: string; exponent: bigint };
type Work = ContributionEvaluation["work"];
const ZERO: DecimalText = { digits: "0", exponent: 0n };

/** Coefficient length is bounded; the exponent never becomes a zero-filled string. */
function parseAmount(raw: unknown): DecimalText | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ENERGY_CHALLENGE_SCORE_INPUT_LIMIT) return null;
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:e([+-]?(?:0|[1-9]\d*)))?$/.exec(raw);
  if (!match || match[0] !== raw) return null;
  const fraction = match[3] ?? "";
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (digits.length === 0) return ZERO; // Includes negative zero; it never contributes.
  if (match[1] === "-") return null;
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length);
  return normalize(digits, exponent);
}

function normalize(digits: string, exponent: bigint): DecimalText {
  const trimmed = digits.replace(/0+$/, "");
  return { digits: trimmed, exponent: exponent + BigInt(digits.length - trimmed.length) };
}

function scale(value: DecimalText, weight: EnergyChallengeWeight): DecimalText {
  if (value.digits === "0") return ZERO;
  return normalize((BigInt(value.digits) * BigInt(weight)).toString(), value.exponent + 12n);
}

/** Compare sparse positive decimals without rounding, powers, or padding. */
function compare(a: DecimalText, b: DecimalText, work: Work): number {
  if (a.digits === "0") return b.digits === "0" ? 0 : -1;
  if (b.digits === "0") return 1;
  const aOrder = a.exponent + BigInt(a.digits.length);
  const bOrder = b.exponent + BigInt(b.digits.length);
  if (aOrder !== bOrder) return aOrder > bOrder ? 1 : -1;
  for (let i = 0; i < Math.max(a.digits.length, b.digits.length); i++) {
    work.digitComparisons++;
    const aDigit = a.digits[i] ?? "0";
    const bDigit = b.digits[i] ?? "0";
    if (aDigit !== bDigit) return aDigit > bDigit ? 1 : -1;
  }
  return 0;
}

function fraction(value: DecimalText): DecimalText {
  if (value.exponent >= 0n || value.digits === "0") return ZERO;
  const integerDigits = BigInt(value.digits.length) + value.exponent;
  if (integerDigits <= 0n) return value;
  const digits = value.digits.slice(Number(integerDigits)).replace(/^0+/, "");
  return digits.length === 0 ? ZERO : { digits, exponent: value.exponent };
}

type IntegerDigits = { digits: string; exponent: bigint; first: bigint; last: bigint };
function integerDigits(value: DecimalText): IntegerDigits {
  return {
    ...value,
    first: value.exponent > 0n ? value.exponent : 0n,
    last: value.digits === "0" ? -1n : value.exponent + BigInt(value.digits.length) - 1n,
  };
}
function contains(value: IntegerDigits, position: bigint): boolean {
  return position >= value.first && position <= value.last;
}
function digitAt(value: IntegerDigits, position: bigint): number {
  return contains(value, position)
    ? Number(value.digits[value.digits.length - 1 - Number(position - value.exponent)])
    : 0;
}

/**
 * Subtract floor(a) - floor(b), known nonnegative, saturating at target + 1.
 * Visit coefficient digits only. Empty exponent-sized runs are skipped in one
 * step, unless a borrow fills the run with nines, which reaches the cap within
 * 19 low digits. Thus even exponent ±8,999,999,999,999,999 cannot expand memory
 * or make an exponent-sized loop. The extra unit preserves a later fraction borrow.
 */
function integerDifference(a: DecimalText, b: DecimalText, work: Work): bigint {
  const left = integerDigits(a);
  const right = integerDigits(b);
  const last = left.last > right.last ? left.last : right.last;
  let position = 0n;
  let borrow = 0;
  let difference = 0n;
  while (position <= last) {
    if (!contains(left, position) && !contains(right, position)) {
      let next = last + 1n;
      if (left.first > position && left.first <= left.last && left.first < next) next = left.first;
      if (right.first > position && right.first <= right.last && right.first < next) next = right.first;
      work.zeroRunSkips++;
      if (borrow === 0) {
        position = next;
        continue;
      }
      // A nonempty borrowed zero run contributes a 9 at every position.
      if (position >= 18n) return INTEGER_LIMIT;
    }
    work.integerDigitSteps++;
    let digit = digitAt(left, position) - digitAt(right, position) - borrow;
    borrow = digit < 0 ? 1 : 0;
    if (digit < 0) digit += 10;
    if (digit !== 0) {
      if (position > 18n) return INTEGER_LIMIT;
      difference += BigInt(digit) * 10n ** position; // position is now bounded to 0..18.
      if (difference >= INTEGER_LIMIT) return INTEGER_LIMIT;
    }
    position++;
  }
  return difference;
}

/**
 * floor(max(0, after - before) * weight * 10^12), capped at 10^18.
 * Wallet strings are authoritative: no Decimal subtraction or epsilon is used.
 * Malformed/nonrepresentable input is fail-closed, with an explicit diagnostic;
 * there is deliberately no catch-all that could conceal a programming error.
 * break_infinity's toString emits Infinity at exponent >= 9e15 and 0 at <= -9e15.
 * Infinity cannot round-trip through the public save reader and earns no score.
 */
export function evaluateProductionContribution(
  beforeText: string,
  afterText: string,
  weight: EnergyChallengeWeight,
): ContributionEvaluation {
  const work: Work = { digitComparisons: 0, integerDigitSteps: 0, zeroRunSkips: 0 };
  if (weight !== 1 && weight !== 3 && weight !== 10) return { units: 0n, reason: "invalid-weight", work };
  const before = parseAmount(beforeText);
  if (!before) return { units: 0n, reason: "invalid-before", work };
  const after = parseAmount(afterText);
  if (!after) return { units: 0n, reason: "invalid-after", work };
  if (compare(after, before, work) <= 0) return { units: 0n, reason: "no-gain", work };
  const scaledAfter = scale(after, weight);
  const scaledBefore = scale(before, weight);
  const integerPart = integerDifference(scaledAfter, scaledBefore, work);
  const fractionBorrow = compare(fraction(scaledAfter), fraction(scaledBefore), work) < 0 ? 1n : 0n;
  const units = integerPart - fractionBorrow;
  return { units: units > TARGET ? TARGET : units, reason: units > 0n ? "credited" : "no-gain", work };
}

export function computeProductionContributionUnits(
  beforeText: string,
  afterText: string,
  weight: EnergyChallengeWeight,
): bigint {
  return evaluateProductionContribution(beforeText, afterText, weight).units;
}

export function isCanonicalScoreUnits(value: unknown): value is string {
  return typeof value === "string" && value.length <= 19 && /^(0|[1-9]\d*)$/.exec(value)?.[0] === value
    && (value.length < 19 || value <= ENERGY_CHALLENGE_TARGET_UNITS);
}

/** Persisted score is a bounded canonical integer string, distinct from wallets. */
export function accumulateScoreUnits(currentCanonical: string, contribution: bigint): string {
  if (!isCanonicalScoreUnits(currentCanonical)) return "0";
  if (typeof contribution !== "bigint" || contribution <= 0n) return currentCanonical;
  const current = BigInt(currentCanonical);
  return contribution >= TARGET - current ? ENERGY_CHALLENGE_TARGET_UNITS : (current + contribution).toString();
}
