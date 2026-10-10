/** Bounded exact decimal arithmetic for finite-plan authorization, independent of wallet arithmetic. */
const SCALE = 18;
const UNIT = 10n ** BigInt(SCALE);
const MAX = 10n ** 208n; // 1e190 expressed in 1e-18 units.
const MAX_INPUT = 256;

function parse(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INPUT) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const digits = `${match[1]}${fraction}`.replace(/^0+/, "");
  if (digits.length === 0) return 0n;
  // Read only bounded exponents; a huge exponent cannot describe a supported nonzero amount.
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 512) return null;
  const shift = SCALE + exponent - fraction.length;
  let scaled: bigint;
  if (shift >= 0) {
    if (digits.length + shift > 209) return null;
    scaled = BigInt(digits) * (10n ** BigInt(shift));
  } else {
    if (-shift > digits.length || !digits.endsWith("0".repeat(-shift))) return null;
    scaled = BigInt(digits.slice(0, digits.length + shift) || "0");
  }
  return scaled <= MAX ? scaled : null;
}

function format(value: bigint): string {
  const whole = value / UNIT;
  const fraction = (value % UNIT).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function isOrderAmount(value: unknown): value is string { return parse(value) !== null; }
export function normalizeOrderAmount(value: string): string | null {
  const parsed = parse(value);
  return parsed === null ? null : format(parsed);
}
export function compareOrderAmounts(a: string, b: string): -1 | 0 | 1 | null {
  const left = parse(a), right = parse(b);
  return left === null || right === null ? null : left < right ? -1 : left > right ? 1 : 0;
}
export function addOrderAmounts(a: string, b: string): string | null {
  const left = parse(a), right = parse(b);
  if (left === null || right === null || left + right > MAX) return null;
  return format(left + right);
}
export function subtractOrderAmounts(a: string, b: string): string | null {
  const left = parse(a), right = parse(b);
  if (left === null || right === null || left < right) return null;
  return format(left - right);
}
export function multiplyOrderAmountInteger(amount: string, count: number): string | null {
  if (!Number.isSafeInteger(count) || count < 0) return null;
  const parsed = parse(amount);
  if (parsed === null) return null;
  const product = parsed * BigInt(count);
  return product <= MAX ? format(product) : null;
}
