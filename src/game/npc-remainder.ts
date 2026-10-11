import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { readNpcLootCargo, type NpcTransferResult } from "./npc-transfer";
import { RESOURCE_IDS, type ResourceAmounts, type ResourceId } from "./types";

/** Per-planet, exact pending entitlement. Ordinary wallet actions never spend it. */
export type NpcResourceRemainder = Record<ResourceId, string>;
const MAX_DECIMAL_TEXT = 256;
const MAX_REMAINDER_PLACES = 256;
const MAX_ALIGNED_DIGITS = 512;
const MAX_DOWN_STEPS = 64;
interface ExactDecimal { coefficient: bigint; exponent: bigint }
interface Settlement { wallet: BigNumber; remainder: string }

export function createNpcResourceRemainder(): NpcResourceRemainder {
  return { metal: "0", crystal: "0", deuterium: "0" };
}

/** Snapshot only own data descriptors: no getters or later container reads. */
function captureResources<T>(value: unknown): Record<ResourceId, T> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== RESOURCE_IDS.length) return null;
  const captured = {} as Record<ResourceId, T>;
  for (const id of RESOURCE_IDS) {
    const field = Object.getOwnPropertyDescriptor(fields, id)?.value as PropertyDescriptor | undefined;
    if (!field || !("value" in field) || !field.enumerable) return null;
    captured[id] = field.value as T;
  }
  return captured;
}

function normalize(value: ExactDecimal): ExactDecimal {
  if (value.coefficient === 0n) return { coefficient: 0n, exponent: 0n };
  let { coefficient, exponent } = value;
  while (coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
  return { coefficient, exponent };
}

function parseExact(value: unknown): ExactDecimal | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DECIMAL_TEXT) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return normalize({ coefficient: BigInt(match[1] + fraction), exponent: BigInt(match[3] ?? "0") - BigInt(fraction.length) });
}

/** Deliberately independent of the main wallet's 256-character text limit. */
function parseRemainder(value: unknown): ExactDecimal | null {
  if (value === "0") return { coefficient: 0n, exponent: 0n };
  if (typeof value !== "string" || value.length > MAX_REMAINDER_PLACES + 2
    || !/^0\.\d{0,255}[1-9]$/.test(value)) return null;
  return { coefficient: BigInt(value.slice(2)), exponent: -BigInt(value.length - 2) };
}

export function readNpcResourceRemainder(value: unknown): NpcResourceRemainder | null {
  const captured = captureResources<unknown>(value);
  if (captured === null) return null;
  for (const id of RESOURCE_IDS) if (parseRemainder(captured[id]) === null) return null;
  return captured as NpcResourceRemainder;
}

function compareExact(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  if (left.coefficient === 0n || right.coefficient === 0n) {
    return left.coefficient === right.coefficient ? 0 : left.coefficient === 0n ? -1 : 1;
  }
  const a = left.coefficient.toString(), b = right.coefficient.toString();
  const aOrder = BigInt(a.length) + left.exponent, bOrder = BigInt(b.length) + right.exponent;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  const width = Math.max(a.length, b.length), aDigits = a.padEnd(width, "0"), bDigits = b.padEnd(width, "0");
  return aDigits === bDigits ? 0 : aDigits < bDigits ? -1 : 1;
}

/** Original canonical text is authority; only a source may differ in bits. */
function canonicalAmount(value: BigNumber, requireRepresentationIdentity: boolean): ExactDecimal | null {
  const text = bigToString(value), exact = parseExact(text);
  if (exact === null) return null;
  const restored = big(text);
  return isValidAmount(restored) && bigToString(restored) === text
    && (!requireRepresentationIdentity || (restored.mantissa === value.mantissa && restored.exponent === value.exponent))
    ? exact : null;
}

/** Bound work with BigInt comparisons BEFORE exponentiation or Number conversion. */
function alignedSum(terms: readonly ExactDecimal[]): ExactDecimal | null {
  const nonzero = terms.map(normalize).filter(term => term.coefficient !== 0n);
  if (nonzero.length === 0) return { coefficient: 0n, exponent: 0n };
  const exponent = nonzero.reduce((least, term) => term.exponent < least ? term.exponent : least, nonzero[0]!.exponent);
  let coefficient = 0n;
  for (const term of nonzero) {
    const gap = term.exponent - exponent;
    const digits = (term.coefficient < 0n ? -term.coefficient : term.coefficient).toString().length;
    if (gap < 0n || BigInt(digits) + gap > BigInt(MAX_ALIGNED_DIGITS)) return null;
    coefficient += term.coefficient * 10n ** gap;
  }
  // A temporary result may have the single carry digit; normalization precedes
  // any later alignment check. No persisted tail is rounded to fit its bound.
  return normalize({ coefficient, exponent });
}

const negated = (value: ExactDecimal): ExactDecimal => ({ coefficient: -value.coefficient, exponent: value.exponent });

/**
 * Independent five-term equation proof by exponent elimination. Unlike target
 * and difference construction, this never expands onto a common fixed grid.
 */
function equationIsZero(terms: readonly ExactDecimal[]): boolean {
  const ordered = terms.filter(term => term.coefficient !== 0n)
    .sort((a, b) => a.exponent < b.exponent ? -1 : a.exponent > b.exponent ? 1 : 0);
  if (ordered.length === 0) return true;
  let coefficient = 0n, exponent = ordered[0]!.exponent;
  for (const term of ordered) {
    const gap = term.exponent - exponent;
    if (coefficient !== 0n && gap > 0n) {
      const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
      let zeros = 0;
      while (digits[digits.length - zeros - 1] === "0") zeros++;
      if (gap > BigInt(zeros)) return false;
      coefficient /= 10n ** gap;
    }
    coefficient += term.coefficient;
    exponent = term.exponent;
  }
  return coefficient === 0n;
}

function remainderText(value: ExactDecimal): string | null {
  const exact = normalize(value);
  if (exact.coefficient === 0n) return "0";
  if (exact.coefficient < 0n || exact.exponent >= 0n || exact.exponent < -BigInt(MAX_REMAINDER_PLACES)) return null;
  const digits = exact.coefficient.toString(), places = Number(-exact.exponent);
  if (digits.length > places) return null; // Exact value must be strictly below 1.
  const text = `0.${digits.padStart(places, "0")}`;
  return parseRemainder(text) === null ? null : text;
}

function constructExact(value: ExactDecimal): BigNumber {
  if (value.coefficient === 0n) return big(0);
  const digits = value.coefficient.toString(), order = value.exponent + BigInt(digits.length - 1);
  if (order >= -6n && order <= 20n) {
    const point = Number(order + 1n); // Proven bounded to [-5, 21].
    const text = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return big(text);
  }
  const fraction = digits.slice(1).replace(/0+$/, "");
  return big(`${digits[0]}${fraction ? `.${fraction}` : ""}e${order}`);
}

/** Adjacent positive binary64 mantissa, not a relative epsilon approximation. */
function nextDown(value: BigNumber): BigNumber | null {
  if (!isValidAmount(value) || value.mantissa <= 0) return null;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value.mantissa);
  bits.setBigUint64(0, bits.getBigUint64(0) - 1n);
  return big(0).fromMantissaExponent(bits.getFloat64(0), value.exponent);
}

function projectSettlement(source: ExactDecimal, prior: ExactDecimal, movement: ExactDecimal): Settlement | null {
  const target = alignedSum([source, prior, movement]);
  if (target === null || target.coefficient < 0n) return null;
  const accepted: { best: { value: Settlement; exact: ExactDecimal } | null } = { best: null };
  const consider = (wallet: BigNumber): void => {
    if (!isValidAmount(wallet)) return;
    const exact = canonicalAmount(wallet, true);
    if (exact === null || compareExact(exact, target) > 0
      || (accepted.best && compareExact(exact, accepted.best.exact) <= 0)) return;
    const difference = alignedSum([target, negated(exact)]);
    if (difference === null) return;
    const remainder = remainderText(difference);
    if (remainder === null) return;
    const parsedRemainder = parseRemainder(remainder)!;
    if (!equationIsZero([source, prior, movement, negated(exact), negated(parsedRemainder)])) return;
    accepted.best = { value: { wallet, remainder }, exact };
  };
  const considerBoth = (raw: BigNumber): void => {
    consider(raw);
    const text = bigToString(raw);
    if (parseExact(text) !== null) consider(big(text));
  };
  // 65 raw + 65 hydrated probes. Hydration escapes integer-snap plateaus;
  // every proposal must separately pass stability and the same exact proofs.
  let candidate: BigNumber | null = constructExact(target);
  for (let step = 0; candidate !== null && step <= MAX_DOWN_STEPS; step++) {
    considerBoth(candidate);
    if (accepted.best?.value.remainder === "0") return accepted.best.value;
    candidate = step < MAX_DOWN_STEPS ? nextDown(candidate) : null;
  }
  // 17 raw + 17 hydrated fallback probes. Truncate exact decimal digits,
  // independently of binary64 probes; never round with floating arithmetic.
  const digits = target.coefficient.toString();
  for (let count = 17; count >= 1; count--) {
    if (count >= digits.length) continue;
    const omitted = digits.length - count;
    considerBoth(constructExact(normalize({ coefficient: BigInt(digits.slice(0, count)), exponent: target.exponent + BigInt(omitted) })));
    if (accepted.best?.value.remainder === "0") return accepted.best.value;
  }
  // At most 164 candidate checks, regardless of exponent or plateau width.
  return accepted.best?.value ?? null;
}

function checkedTransfer(before: BigNumber, remainder: string, amount: BigNumber, credit: boolean,
  expected?: ExactDecimal): NpcTransferResult<Settlement> {
  const prior = parseRemainder(remainder);
  if (prior === null || !isValidAmount(before) || !isValidAmount(amount)) return { ok: false, reason: "invalid-amount" };
  // Preserve the established zero-operation contract, including unusual valid
  // wallet representations. A preview or zero-loot return never sweeps a tail.
  if (amount.mantissa === 0) return expected && expected.coefficient !== 0n
    ? { ok: false, reason: "precision" } : { ok: true, value: { wallet: before, remainder } };
  const source = canonicalAmount(before, false), movement = canonicalAmount(amount, true);
  if (source === null || movement === null) return { ok: false, reason: "precision" };
  if (expected && compareExact(movement, expected) !== 0) return { ok: false, reason: "precision" };
  // Pending entitlement never authorizes a launch the main wallet cannot pay.
  if (!credit && compareExact(source, movement) < 0) return { ok: false, reason: "insufficient-funds" };
  const result = projectSettlement(source, prior, credit ? movement : negated(movement));
  return result === null ? { ok: false, reason: "precision" } : { ok: true, value: result };
}

/** Fuel quote is unchanged and must match its independently retained integer. */
export function checkedNpcFuelDebitWithRemainder(before: BigNumber, remainder: string, fuel: BigNumber,
  expectedFuelInteger: string | bigint): NpcTransferResult<Settlement> {
  const expected = parseExact(typeof expectedFuelInteger === "bigint" ? expectedFuelInteger.toString() : expectedFuelInteger);
  if (expected === null || (expected.coefficient !== 0n && expected.exponent < 0n)) return { ok: false, reason: "invalid-amount" };
  return checkedTransfer(before, remainder, fuel, false, expected);
}

/** Preflight all three rights together; the caller atomically adopts ships too. */
export function checkedNpcCargoCreditWithRemainder(before: ResourceAmounts, remainder: NpcResourceRemainder,
  cargo: ResourceAmounts): NpcTransferResult<{ resources: ResourceAmounts; remainder: NpcResourceRemainder }> {
  const source = captureResources<BigNumber>(before), incoming = captureResources<BigNumber>(cargo);
  const prior = readNpcResourceRemainder(remainder);
  if (source === null || incoming === null || prior === null) return { ok: false, reason: "invalid-amount" };
  const loot = readNpcLootCargo(incoming);
  if (!loot.ok) return loot;
  const resources = { ...source }, pending = { ...prior };
  let changed = false;
  for (const id of RESOURCE_IDS) {
    const transfer = checkedTransfer(source[id], prior[id], incoming[id], true);
    if (!transfer.ok) return transfer;
    resources[id] = transfer.value.wallet;
    pending[id] = transfer.value.remainder;
    changed ||= transfer.value.wallet !== source[id] || transfer.value.remainder !== prior[id];
  }
  return { ok: true, value: { resources: changed ? resources : before, remainder: changed ? pending : remainder } };
}
