import { bigToString, isValidAmount, type BigNumber } from "./decimal";
import type { NpcTransferResult } from "./npc-transfer";

/** An ephemeral quote fact, not a saved fuel wallet or a second charge. */
export interface NpcFuelIntent {
  readonly rawFuelText: string;
  readonly expectedFuelInteger: string;
}

// Bounds text/BigInt work, not the existing wallet or save reader. Ordinary
// flight operands are much smaller. Never allocate a power for a huge exponent.
const MAX_TEXT = 256;
const MAX_INTEGER_DIGITS = 256;

/**
 * Call with the existing Decimal accumulation BEFORE ceil().add(1).mul(2).
 * Capture its toString() ONCE as the authoritative raw amount, then independently
 * compute 2 * (ceil(raw) + 1) in integer arithmetic. This deliberately preserves
 * earlier Number/Decimal approximation; it is not the ideal real-number formula.
 *
 * The raw intermediate is not saved, so restoring its binary mantissa is NOT a
 * prerequisite. The final Decimal quote and actual wallet movement must still
 * pass checkedNpcFuelDebit with this independent expectedFuelInteger. Do not
 * pass the already-final quote here or replace that quote with a repaired one.
 * Decimal instances themselves are trusted runtime values, as in npc-transfer.
 */
export function checkedNpcFuelIntent(rawFuel: BigNumber): NpcTransferResult<NpcFuelIntent> {
  if (!isValidAmount(rawFuel)) return { ok: false, reason: "invalid-amount" };
  const text = bigToString(rawFuel);
  if (text.length === 0 || text.length > MAX_TEXT) return { ok: false, reason: "precision" };
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) return { ok: false, reason: "precision" };
  const fraction = match[2] ?? "";
  const coefficient = BigInt(match[1] + fraction);
  const exponent = BigInt(match[3] ?? "0") - BigInt(fraction.length);
  let ceiling: bigint;
  if (coefficient === 0n) ceiling = 0n;
  else {
    const digits = coefficient.toString().length;
    if (exponent >= 0n) {
      if (exponent > BigInt(MAX_INTEGER_DIGITS - digits)) return { ok: false, reason: "precision" };
      ceiling = coefficient * 10n ** exponent;
    } else {
      const places = -exponent;
      // A positive number smaller than one has ceiling one, even with an
      // exponent far beyond a machine integer. No huge divisor is constructed.
      if (places >= BigInt(digits)) ceiling = 1n;
      else {
        const divisor = 10n ** places; // places < the bounded coefficient length.
        ceiling = (coefficient + divisor - 1n) / divisor;
      }
    }
  }
  const integer = (2n * (ceiling + 1n)).toString();
  if (integer.length > MAX_INTEGER_DIGITS) return { ok: false, reason: "precision" };
  return { ok: true, value: { rawFuelText: text, expectedFuelInteger: integer } };
}
