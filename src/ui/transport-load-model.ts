/** Read-only assistance for an explicitly edited, ordinary manual transport draft. */
import { big, isValidAmount, type BigNumber } from "../game/decimal";
import { activePlanet } from "../game/empire";
import { emptyCargo, quoteFlight, type FleetRequest, type FlightQuote } from "../game/fleet";
import { RESOURCE_IDS, type GameState, type ResourceAmounts, type ResourceId } from "../game/types";

export interface TransportCargoMaximum {
  ok: boolean;
  reason: string;
  /** Largest representable amount that can replace this field, or no safe result. */
  amount: BigNumber | null;
}

export interface TransportLoadPreview {
  /** The empty-cargo route is valid and its capacity/fuel can be represented. */
  available: boolean;
  reason: string;
  capacity: BigNumber | null;
  fuel: BigNumber | null;
  /** Cargo only; fuel is reported separately. Null never means zero. */
  load: BigNumber | null;
  remaining: BigNumber | null;
  excess: BigNumber | null;
  /** The actual current draft quote, independent of the empty-cargo preview. */
  quote: FlightQuote;
  maxima: Record<ResourceId, TransportCargoMaximum>;
}

export interface TransportCargoFill extends TransportCargoMaximum {
  /** Failure returns the identical request. Success only replaces one cargo value. */
  request: FleetRequest;
}

const TRANSPORT_ONLY = "最大装载仅用于普通手动运输";
const INVALID_CARGO = "货物必须为有限的非负大数";
const PRECISION = "金额超过当前可表示精度，无法安全计算最大装载；原输入已保留";

function validAmount(value: unknown): value is BigNumber {
  const amount = value as BigNumber | null | undefined;
  return !!amount && typeof amount.add === "function" && typeof amount.sub === "function"
    && typeof amount.gte === "function" && isValidAmount(amount)
    // Decimal's Infinity sentinel has finite mantissa/exponent. Validate the
    // actual text boundary without toNumber(), which would reject valid 1e999.
    && /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(amount.toString())
    // The opposite sentinel serializes a still-positive value as "0". A draft
    // helper must not erase that positive cargo or stock at the text boundary.
    && (amount.toString() !== "0" || amount.eq(0));
}

function failedQuote(reason: string): FlightQuote {
  return { ok: false, reason, capacity: big(0), fuel: big(0), duration: 0 };
}

function currentQuote(state: GameState, request: FleetRequest): FlightQuote {
  // Bad external drafts or a missing active planet must not make the UI throw.
  try { return quoteFlight(state, request); }
  catch { return failedQuote("当前航程或星球参数无效，无法安全报价"); }
}

function near(actual: BigNumber, expected: BigNumber): boolean {
  return validAmount(actual) && (expected.eq(0) ? actual.eq(0)
    : actual.sub(expected).abs().div(expected).lte(1e-9));
}

/** Refuse swallowed positive operands; ordinary decimal rounding is not a free resource. */
function checkedAdd(left: BigNumber, right: BigNumber): BigNumber | null {
  const sum = left.add(right);
  if (!validAmount(sum) || !near(sum.sub(left), right) || !near(sum.sub(right), left)) return null;
  return sum;
}

function checkedSubtract(left: BigNumber, right: BigNumber): BigNumber | null {
  if (left.lt(right)) return null;
  const difference = left.sub(right);
  if (!validAmount(difference) || !near(left.sub(difference), right)
    || !near(difference.add(right), left)) return null;
  return difference;
}

function cargoLoad(cargo: ResourceAmounts): BigNumber | null {
  let load = big(0);
  for (const id of RESOURCE_IDS) {
    if (!validAmount(cargo?.[id])) return null;
    const next = checkedAdd(load, cargo[id]);
    if (next === null) return null;
    load = next;
  }
  return load;
}

interface LoadContext {
  capacity: BigNumber;
  fuel: BigNumber;
  cargoCapacity: BigNumber;
  stock: ResourceAmounts;
  deuteriumAfterFuel: BigNumber;
}

function contextFor(state: GameState, request: FleetRequest): LoadContext | string {
  if (request?.mission !== "transport") return TRANSPORT_ONLY;
  // Reuse the real engine for route, ship, drive, speed, fuel, slot and ID checks.
  // Do not let an invalid field being replaced prevent correcting that field.
  const base = currentQuote(state, { ...request, cargo: emptyCargo() });
  if (!base.ok) return base.reason;
  if (!validAmount(base.capacity) || !validAmount(base.fuel)) return PRECISION;
  const stock = activePlanet(state).resources;
  if (RESOURCE_IDS.some(id => !validAmount(stock[id]))) return "出发星球库存无效，无法安全计算最大装载";
  const cargoCapacity = checkedSubtract(base.capacity, base.fuel);
  const deuteriumAfterFuel = checkedSubtract(stock.deuterium, base.fuel);
  if (cargoCapacity === null || deuteriumAfterFuel === null) return PRECISION;
  return { capacity: base.capacity, fuel: base.fuel, cargoCapacity, stock, deuteriumAfterFuel };
}

function refusal(reason: string): TransportCargoMaximum { return { ok: false, reason, amount: null }; }

/** The input field reparses text. Normalize downward only, with a bounded budget. */
function writableMaximum(room: BigNumber, stock: BigNumber): BigNumber | null {
  let amount = big(room.lte(stock) ? room : stock);
  for (let step = 0; step < 3; step += 1) {
    const text = amount.toString();
    if (!validAmount(amount) || text.length >= 100) return null;
    const decoded = big(text);
    if (!validAmount(decoded) || decoded.gt(amount) || decoded.gt(room) || decoded.gt(stock)) return null;
    if (decoded.eq(amount) && decoded.toString() === text) return decoded;
    amount = decoded;
  }
  return null;
}

function maximumFor(state: GameState, request: FleetRequest, resource: ResourceId, context: LoadContext): TransportCargoMaximum {
  const without = { ...request, cargo: { ...request.cargo, [resource]: big(0) } };
  const otherQuote = currentQuote(state, without);
  if (!otherQuote.ok) return refusal(otherQuote.reason);
  const otherLoad = cargoLoad(without.cargo);
  if (otherLoad === null) return refusal(INVALID_CARGO);
  const room = checkedSubtract(context.cargoCapacity, otherLoad);
  if (room === null) return refusal(PRECISION);
  const stock = resource === "deuterium" ? context.deuteriumAfterFuel : context.stock[resource];
  const amount = writableMaximum(room, stock);
  if (amount === null) return refusal(PRECISION);
  const filled = { ...request, cargo: { ...request.cargo, [resource]: amount } };
  const load = cargoLoad(filled.cargo);
  if (load === null || checkedAdd(load, context.fuel) === null) return refusal(PRECISION);
  // A nominally affordable amount must also survive the source wallet's existing
  // cargo-then-fuel debit order. This only validates; it never changes that wallet.
  for (const id of RESOURCE_IDS) {
    const afterCargo = checkedSubtract(context.stock[id], filled.cargo[id]);
    if (afterCargo === null || id === "deuterium" && checkedSubtract(afterCargo, context.fuel) === null) return refusal(PRECISION);
  }
  // Authoritative final validation also handles decimal boundary effects. Never
  // silently reduce another field or substitute a different flight when it fails.
  const finalQuote = currentQuote(state, filled);
  return finalQuote.ok ? { ok: true, reason: "可填入的最大运输量；尚未派遣", amount }
    : refusal(finalQuote.reason);
}

/** No state writes, dispatch, payment, authorization, storage, or time advancement. */
export function transportLoadPreview(state: GameState, request: FleetRequest): TransportLoadPreview {
  const quote = currentQuote(state, request);
  const context = contextFor(state, request);
  const load = cargoLoad(request?.cargo);
  const maxima = {} as Record<ResourceId, TransportCargoMaximum>;
  if (typeof context === "string") {
    for (const id of RESOURCE_IDS) maxima[id] = refusal(context);
    return { available: false, reason: context, capacity: null, fuel: null, load,
      remaining: null, excess: null, quote, maxima };
  }
  for (const id of RESOURCE_IDS) maxima[id] = maximumFor(state, request, id, context);
  const occupied = load === null ? null : checkedAdd(load, context.fuel);
  const remaining = occupied === null ? null : occupied.gt(context.capacity) ? big(0) : checkedSubtract(context.capacity, occupied);
  const excess = occupied === null ? null : occupied.gt(context.capacity) ? checkedSubtract(occupied, context.capacity) : big(0);
  return { available: true, reason: load === null ? INVALID_CARGO : occupied === null ? PRECISION : quote.reason,
    capacity: context.capacity, fuel: context.fuel, load, remaining, excess, quote, maxima };
}

/** Explicitly replace a single draft field. A preview never supplies dispatch authority. */
export function fillTransportCargo(state: GameState, request: FleetRequest, resource: ResourceId): TransportCargoFill {
  if (!RESOURCE_IDS.includes(resource)) return { ...refusal("货物资源类型无效"), request };
  const context = contextFor(state, request);
  if (typeof context === "string") return { ...refusal(context), request };
  const result = maximumFor(state, request, resource, context);
  if (!result.ok || result.amount === null) return { ...result, request };
  return { ...result, request: { ...request, cargo: { ...request.cargo, [resource]: result.amount } } };
}
