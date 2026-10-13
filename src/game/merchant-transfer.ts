import { big, isValidAmount, type BigNumber } from "./decimal";

// Merchant-only compatibility contract: the error is bounded relative to this
// quoted movement, never to the wallet. NPC exact transfers and remainders, the
// shared order wallet, and save/schema validation are deliberately unchanged.
const SCALE = 1_000_000_000n;
const MAX_TEXT = 256;
const MAX_SHIFT = BigInt(MAX_TEXT + 16);
interface Term { coefficient: bigint; exponent: bigint }

function decimal(value: unknown): Term | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { coefficient: BigInt(match[1] + fraction), exponent: BigInt(match[3] ?? "0") - BigInt(fraction.length) };
}

/**
 * Exact sign of at most three bounded decimal terms, without exponent-sized work.
 * There are at most two shifts of <= 272 decimal places. Including coefficient
 * scaling and carries, the intermediate integer is bounded by 811 digits.
 */
function sumSign(terms: Term[]): -1 | 0 | 1 {
  const ordered = terms.filter(term => term.coefficient !== 0n)
    .sort((a, b) => a.exponent > b.exponent ? -1 : a.exponent < b.exponent ? 1 : 0);
  if (!ordered.length) return 0;
  let coefficient = ordered[0]!.coefficient, exponent = ordered[0]!.exponent;
  for (const term of ordered.slice(1)) {
    if (coefficient === 0n) {
      coefficient = term.coefficient; exponent = term.exponent; continue;
    }
    const gap = exponent - term.exponent;
    // Each input coefficient has <= MAX_TEXT digits and scaling adds <= 10.
    // At most two lower terms remain. Across this gap their entire sum cannot
    // cancel even one unit of the current coefficient. Do not expand the gap.
    if (gap > MAX_SHIFT) return coefficient < 0n ? -1 : 1;
    coefficient = coefficient * 10n ** gap + term.coefficient;
    exponent = term.exponent;
  }
  return coefficient < 0n ? -1 : coefficient > 0n ? 1 : 0;
}

/** Independent canonical decimal proof; unsupported text fails closed. */
export function merchantCanonicalMovementWithinBound(beforeText: unknown, afterText: unknown,
  quotedText: unknown, credit: boolean): boolean {
  const before = decimal(beforeText), after = decimal(afterText), quoted = decimal(quotedText);
  if (!before || !after || !quoted || quoted.coefficient <= 0n) return false;
  const positive = credit ? after : before, negative = credit ? before : after;
  const movement = [positive, { coefficient: -negative.coefficient, exponent: negative.exponent }];
  // A zero movement is never accepted, even at an enormous wallet magnitude.
  if (sumSign(movement) <= 0) return false;
  const scaled = movement.map(term => ({ coefficient: term.coefficient * SCALE, exponent: term.exponent }));
  // |actual - quoted| * 1e9 <= quoted, expressed without Decimal subtraction.
  return sumSign([...scaled, { coefficient: -quoted.coefficient * (SCALE - 1n), exponent: quoted.exponent }]) >= 0
    && sumSign([...scaled, { coefficient: -quoted.coefficient * (SCALE + 1n), exponent: quoted.exponent }]) <= 0;
}

function stableCanonical(value: BigNumber): string | null {
  if (!isValidAmount(value)) return null;
  const text = value.toString();
  if (!decimal(text)) return null;
  const restored = big(text);
  // Canonical text is authority. Ordinary production may use a different
  // internal mantissa that saves and reloads to exactly the same stable text.
  return isValidAmount(restored) && restored.toString() === text ? text : null;
}

/** Validate the original Decimal candidate, optionally captured by a prior capacity check. */
export function checkedMerchantTransfer(before: BigNumber, quoted: BigNumber, credit: boolean, capturedCandidate?: BigNumber): BigNumber | null {
  const sourceText = stableCanonical(before), quotedText = stableCanonical(quoted);
  if (sourceText === null || quotedText === null || quoted.lte(0) || (!credit && before.lt(quoted))) return null;
  const after = capturedCandidate ?? (credit ? before.add(quoted) : before.sub(quoted));
  const afterText = stableCanonical(after);
  return afterText !== null && merchantCanonicalMovementWithinBound(sourceText, afterText, quotedText, credit)
    ? after : null;
}
