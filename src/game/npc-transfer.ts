import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { RESOURCE_IDS, type ResourceAmounts } from "./types";

/**
 * NPC-only transfers, not a complete save/schema reader. Decimal instances are
 * trusted runtime values from the existing reader; their surrounding containers
 * are validated and captured here. The general wallet and reader are unchanged.
 */
export type NpcLoot = readonly [metal: number, crystal: number, deuterium: number];
export const NPC_LOOT_CAPS: NpcLoot = Object.freeze([25_000, 15_000, 5_000]);
export const NPC_MAX_LOOT = 45_000;
export type NpcTransferFailure = "invalid-amount" | "invalid-loot" | "insufficient-funds" | "precision";
export type NpcTransferResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: NpcTransferFailure };

// This bounds work, not the exponent's numeric value. Decimal's canonical output
// fits comfortably; unsupported positive transfers fail closed, never round.
const MAX_DECIMAL_TEXT = 256;
const MAX_CANDIDATE_DIGITS = 512;
interface ExactDecimal { coefficient: bigint; exponent: bigint }

function parseExact(value: unknown): ExactDecimal | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_DECIMAL_TEXT) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return {
    coefficient: BigInt(match[1] + fraction),
    exponent: BigInt(match[3] ?? "0") - BigInt(fraction.length),
  };
}

function trailingZeros(coefficient: bigint): number {
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString();
  let zeros = 0;
  while (digits[digits.length - zeros - 1] === "0") zeros++;
  return zeros;
}

function isExactInteger(value: ExactDecimal): boolean {
  return value.coefficient === 0n || value.exponent >= 0n || -value.exponent <= BigInt(trailingZeros(value.coefficient));
}

/**
 * Exact three-term elimination, with no expansion across large exponent gaps.
 * At each exponent, all later terms are multiples of the next power of ten.
 * The current coefficient must therefore be divisible by that power, or the
 * sum cannot be zero. Division shrinks coefficients; adding at most three
 * bounded coefficients cannot cause exponent-sized allocations.
 */
function sumEquals(left: ExactDecimal, right: ExactDecimal, total: ExactDecimal): boolean {
  const terms = [left, right, { coefficient: -total.coefficient, exponent: total.exponent }]
    .sort((a, b) => a.exponent < b.exponent ? -1 : a.exponent > b.exponent ? 1 : 0);
  let coefficient = 0n, exponent = terms[0]!.exponent;
  for (const term of terms) {
    const gap = term.exponent - exponent;
    if (coefficient !== 0n && gap > 0n) {
      if (gap > BigInt(trailingZeros(coefficient))) return false;
      coefficient /= 10n ** gap; // gap <= the bounded coefficient's trailing-zero count.
    }
    coefficient += term.coefficient;
    exponent = term.exponent;
  }
  return coefficient === 0n;
}

/** Independent decimal equation proof. False also means unsupported input. */
export function npcExactDecimalSumEquals(left: unknown, right: unknown, total: unknown): boolean {
  const a = parseExact(left), b = parseExact(right), c = parseExact(total);
  return a !== null && b !== null && c !== null && sumEquals(a, b, c);
}

function compareExact(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  if (left.coefficient === 0n || right.coefficient === 0n) {
    return left.coefficient === right.coefficient ? 0 : left.coefficient === 0n ? -1 : 1;
  }
  const a = left.coefficient.toString(), b = right.coefficient.toString();
  const aOrder = BigInt(a.length) + left.exponent, bOrder = BigInt(b.length) + right.exponent;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  // Equal orders need at most MAX_DECIMAL_TEXT digits, not an exponent-sized pad.
  const width = Math.max(a.length, b.length), aDigits = a.padEnd(width, "0"), bDigits = b.padEnd(width, "0");
  return aDigits === bDigits ? 0 : aDigits < bDigits ? -1 : 1;
}

/**
 * The authoritative amount is the canonical decimal text, NOT the exact binary
 * rational represented by the mantissa. For a positive transfer, representation
 * and text must both survive the same stringify/read path used by saves.
 */
function canonicalAmount(value: BigNumber, requireRepresentationIdentity = true): ExactDecimal | null {
  const text = bigToString(value), exact = parseExact(text);
  if (exact === null) return null;
  const restored = big(text);
  return isValidAmount(restored) && bigToString(restored) === text
    && (!requireRepresentationIdentity || (restored.mantissa === value.mantissa && restored.exponent === value.exponent))
    ? exact : null;
}

/**
 * Construct from the exact canonical equation rather than Decimal.add/sub,
 * whose intermediate mantissa rounding can miss an otherwise representable
 * answer. This is only a candidate: checkedTransfer still proves the equation
 * and the complete save/read representation before accepting it.
 */
function exactTransferCandidate(source: ExactDecimal, movement: ExactDecimal, credit: boolean): BigNumber | null {
  const exponent = source.coefficient === 0n ? movement.exponent
    : movement.coefficient === 0n ? source.exponent
    : source.exponent < movement.exponent ? source.exponent : movement.exponent;
  const align = (term: ExactDecimal): bigint | null => {
    if (term.coefficient === 0n) return 0n;
    const gap = term.exponent - exponent;
    // Compare bigint work sizes before either exponentiation or Number
    // conversion. Huge exponent gaps must never allocate their powers of ten.
    if (gap < 0n || BigInt(term.coefficient.toString().length) + gap > BigInt(MAX_CANDIDATE_DIGITS)) return null;
    return term.coefficient * 10n ** gap;
  };
  const left = align(source), right = align(movement);
  if (left === null || right === null) return null;
  const coefficient = credit ? left + right : left - right;
  if (coefficient < 0n) return null;
  if (coefficient === 0n) return big(0);
  // Addition can produce one carry digit beyond the alignment bound.
  const digits = coefficient.toString(), order = exponent + BigInt(digits.length - 1);
  if (order >= -6n && order <= 20n) {
    // Match Decimal's ordinary canonical notation. An equivalent scientific
    // string can take a different constructor path and choose another mantissa.
    const point = Number(order + 1n); // Bounded to [-5, 21] above.
    const text = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return big(text);
  }
  const fraction = digits.slice(1).replace(/0+$/, "");
  return big(`${digits[0]}${fraction ? `.${fraction}` : ""}e${order}`);
}

function checkedTransfer(before: BigNumber, amount: BigNumber, credit: boolean, expected?: ExactDecimal): NpcTransferResult<BigNumber> {
  if (!isValidAmount(before) || !isValidAmount(amount)) return { ok: false, reason: "invalid-amount" };
  // Preserve every old-reader-valid zero operation, including noncanonical large
  // wallets and signed zero. The stricter positive-transfer contract is local.
  if (amount.mantissa === 0) return expected && expected.coefficient !== 0n
    ? { ok: false, reason: "precision" } : { ok: true, value: before };
  // Runtime production can yield a different mantissa with the same stable save
  // text. Source authority is that exact canonical text, not an internal bit
  // pattern. Movement and accepted output retain full representation proofs.
  const source = canonicalAmount(before, false), movement = canonicalAmount(amount);
  if (source === null || movement === null) return { ok: false, reason: "precision" };
  if (expected && compareExact(movement, expected) !== 0) return { ok: false, reason: "precision" };
  if (!credit && compareExact(source, movement) < 0) return { ok: false, reason: "insufficient-funds" };
  const after = exactTransferCandidate(source, movement, credit);
  if (after === null || !isValidAmount(after)) return { ok: false, reason: "precision" };
  const result = canonicalAmount(after);
  if (result === null || !(credit ? sumEquals(source, movement, result) : sumEquals(result, movement, source))) {
    return { ok: false, reason: "precision" };
  }
  return { ok: true, value: after };
}

/**
 * Use the actual Decimal quote unchanged, and check it against the independently
 * retained intended integer. The caller must NOT derive expectedFuelInteger by
 * rounding/stringifying the same possibly lossy Decimal. No quote is repaired.
 */
export function checkedNpcFuelDebit(before: BigNumber, fuel: BigNumber, expectedFuelInteger: string | bigint): NpcTransferResult<BigNumber> {
  const expected = parseExact(typeof expectedFuelInteger === "bigint" ? expectedFuelInteger.toString() : expectedFuelInteger);
  if (expected === null || !isExactInteger(expected)) return { ok: false, reason: "invalid-amount" };
  return checkedTransfer(before, fuel, false, expected);
}

/** Capture own data once; never execute a resource-container getter or re-read it. */
function captureResources(value: ResourceAmounts): ResourceAmounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== RESOURCE_IDS.length) return null;
  const captured = {} as ResourceAmounts;
  for (const id of RESOURCE_IDS) {
    const field = Object.getOwnPropertyDescriptor(fields, id)?.value as PropertyDescriptor | undefined;
    if (!field || !("value" in field) || !field.enumerable) return null;
    // Decimal instances themselves remain under the existing trusted-value boundary.
    captured[id] = field.value as BigNumber;
  }
  return captured;
}

/** Dense plain arrays only, captured once without getters or inherited entries. */
function captureLoot(loot: readonly number[]): NpcLoot | null {
  if (!Array.isArray(loot) || Object.getPrototypeOf(loot) !== Array.prototype) return null;
  const fields = Object.getOwnPropertyDescriptors(loot);
  const length = Object.getOwnPropertyDescriptor(fields, "length")?.value as PropertyDescriptor | undefined;
  if (Reflect.ownKeys(fields).length !== RESOURCE_IDS.length + 1 || !length || !("value" in length)
    || length.enumerable || length.value !== RESOURCE_IDS.length) return null;
  const captured: [number, number, number] = [0, 0, 0];
  let total = 0;
  for (let index = 0; index < RESOURCE_IDS.length; index++) {
    const field = Object.getOwnPropertyDescriptor(fields, String(index))?.value as PropertyDescriptor | undefined;
    if (!field || !("value" in field) || !field.enumerable) return null;
    const value: unknown = field.value;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > NPC_LOOT_CAPS[index]!) return null;
    captured[index] = value;
    total += value;
  }
  return total <= NPC_MAX_LOOT ? captured : null;
}

function readCapturedLootCargo(cargo: ResourceAmounts): NpcTransferResult<NpcLoot> {
  const loot: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < RESOURCE_IDS.length; index++) {
    const amount = cargo[RESOURCE_IDS[index]!];
    if (!isValidAmount(amount)) return { ok: false, reason: "invalid-amount" };
    const exact = canonicalAmount(amount);
    if (exact === null) return { ok: false, reason: "precision" };
    const integer = amount.toNumber();
    if (!Number.isSafeInteger(integer) || integer < 0 || integer > NPC_LOOT_CAPS[index]!) {
      return { ok: false, reason: "invalid-loot" };
    }
    const expected = parseExact(String(integer))!;
    if (compareExact(exact, expected) !== 0) return { ok: false, reason: "precision" };
    loot[index] = integer;
  }
  return loot[0] + loot[1] + loot[2] <= NPC_MAX_LOOT ? { ok: true, value: loot } : { ok: false, reason: "invalid-loot" };
}

/** Read in-flight cargo only when its saved decimal text is the original integer. */
export function readNpcLootCargo(cargo: ResourceAmounts): NpcTransferResult<NpcLoot> {
  const captured = captureResources(cargo);
  return captured === null ? { ok: false, reason: "invalid-amount" } : readCapturedLootCargo(captured);
}

/** Construct the entire cargo candidate or reject it; no integer is rounded. */
export function checkedNpcLootCargo(loot: readonly number[]): NpcTransferResult<ResourceAmounts> {
  const captured = captureLoot(loot);
  if (captured === null) return { ok: false, reason: "invalid-loot" };
  const cargo: ResourceAmounts = { metal: big(captured[0]), crystal: big(captured[1]), deuterium: big(captured[2]) };
  const readback = readCapturedLootCargo(cargo);
  if (!readback.ok) return readback;
  if (readback.value.some((value, index) => value !== captured[index])) return { ok: false, reason: "precision" };
  return { ok: true, value: cargo };
}

/**
 * Preflight all three resources without mutating the wallet or cargo. A caller
 * must commit this whole candidate together with the ship landing. On failure,
 * neither argument changes. An all-zero cargo returns the original wallet.
 */
export function checkedNpcCargoCredit(before: ResourceAmounts, cargo: ResourceAmounts): NpcTransferResult<ResourceAmounts> {
  const source = captureResources(before), incoming = captureResources(cargo);
  if (source === null || incoming === null) return { ok: false, reason: "invalid-amount" };
  const loot = readCapturedLootCargo(incoming);
  if (!loot.ok) return loot;
  const candidate: ResourceAmounts = { ...source };
  let changed = false;
  for (const id of RESOURCE_IDS) {
    const transfer = checkedTransfer(source[id], incoming[id], true);
    if (!transfer.ok) return transfer;
    candidate[id] = transfer.value;
    changed ||= transfer.value !== source[id];
  }
  return { ok: true, value: changed ? candidate : before };
}
