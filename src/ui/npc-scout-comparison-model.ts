import { big } from "../game/decimal";
import { SPACE, type Coordinates } from "../game/galaxy";
import type { NpcResourceTuple } from "../game/npc-loot";
import { readNpcScoutSnapshot, type NpcScoutSnapshotV1 } from "../game/npc-scout-state";

export const NPC_SCOUT_COMPARISON_WARNING = "只是两次观察差，不代表净产量、战利品或当前库存";
export const NPC_SCOUT_COMPARISON_UNAVAILABLE = "无法对照：请选择当前保留的两份同坐标、身份不同且完整有效的 V1 历史侦察报告。";
export const NPC_SCOUT_COMPARISON_PRECISION = "原始库存为 Number；观察差按各原值 Number.toString() 的完整十进制表示计算，不代表更高精度。";

export interface NpcScoutComparisonCandidate {
  readonly messageId: string;
  readonly fleetId: number;
  readonly observedAt: string;
  /** Index in the current, oldest-to-newest messages array. Never a time sort. */
  readonly index: number;
}

export interface NpcScoutComparisonObservation {
  readonly messageId: string;
  readonly fleetId: number;
  readonly originId: string;
  readonly observedAt: string;
  readonly stock: NpcResourceTuple;
  readonly garrison: NpcScoutSnapshotV1["garrison"];
  readonly defenderTech: NpcScoutSnapshotV1["defenderTech"];
}

/** Detached display data only. No state, command, draft, quote or write capability. */
export interface NpcScoutComparisonModel {
  readonly target: Readonly<Coordinates>;
  readonly before: NpcScoutComparisonObservation;
  readonly after: NpcScoutComparisonObservation;
  readonly delta: Readonly<{
    readonly stock: readonly [metal: string, crystal: string, deuterium: string];
    readonly garrison: Readonly<{ light_fighter: number; heavy_fighter: number }>;
  }>;
  readonly warning: typeof NPC_SCOUT_COMPARISON_WARNING;
  readonly precision: typeof NPC_SCOUT_COMPARISON_PRECISION;
}

interface CheckedMessage {
  readonly source: object;
  readonly messageId: string;
  readonly snapshot: NpcScoutSnapshotV1 | null;
  readonly snapshotNodes: readonly object[];
  readonly index: number;
}

const NO_CANDIDATES: readonly NpcScoutComparisonCandidate[] = Object.freeze([]);
const fail = (): never => { throw new TypeError(NPC_SCOUT_COMPARISON_UNAVAILABLE); };

function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === names.length && names.every(name => {
      const field = Object.getOwnPropertyDescriptor(value, name);
      return !!field && "value" in field && field.enumerable;
    });
}

/** Inspect untouched stock data before handing it to the shared V1 reader. */
function preflightStock(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== "object") return fail();
  const field = Object.getOwnPropertyDescriptor(snapshot, "stock");
  if (!field || !("value" in field) || !field.enumerable) return fail();
  const stock: unknown = field.value;
  if (!Array.isArray(stock) || Object.getPrototypeOf(stock) !== Array.prototype
    || stock.length !== 3 || Reflect.ownKeys(stock).length !== 4) return fail();
  for (let index = 0; index < 3; index++) {
    const item = Object.getOwnPropertyDescriptor(stock, String(index));
    if (!item || !("value" in item) || !item.enumerable || typeof item.value !== "number"
      || !Number.isFinite(item.value) || item.value < 0) return fail();
  }
}

function checkMessage(value: unknown, index: number): CheckedMessage {
  if (!fields(value, ["id", "at", "text", "npcScoutSnapshot"])
    || typeof value.id !== "string" || value.id.length > 100
    || typeof value.text !== "string" || value.text.length > 1000
    || typeof value.at !== "number" || !Number.isFinite(value.at) || value.at < 0 || value.at > 1e12) return fail();
  if (value.npcScoutSnapshot === null) {
    return { source: value, messageId: value.id, snapshot: null, snapshotNodes: [], index };
  }
  preflightStock(value.npcScoutSnapshot);
  const checked = readNpcScoutSnapshot(value.npcScoutSnapshot);
  if (value.id !== `scout-${checked.fleetId}` || value.at !== big(checked.observedAt).min(1e12).toNumber()) return fail();
  // Keep every original Number, including economic -0. The V1 reader above
  // validates the untouched stock array before these ordinary data reads.
  const raw = value.npcScoutSnapshot as NpcScoutSnapshotV1;
  const stock: NpcResourceTuple = Object.freeze([raw.stock[0], raw.stock[1], raw.stock[2]]);
  const snapshot = Object.freeze({ ...checked, stock });
  return { source: value, messageId: value.id, snapshot, index,
    snapshotNodes: [raw, raw.target, raw.stock, raw.garrison, raw.defenderTech] };
}

/** Validate before array iteration can run accessors or erase malformed shape. */
function currentMessages(value: unknown): CheckedMessage[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > SPACE.maxMessages || Reflect.ownKeys(value).length !== value.length + 1) return fail();
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable) return fail();
  }
  const objects = new Set<object>(), ids = new Set<string>(), fleets = new Set<number>(), snapshots = new Set<object>();
  const messages: CheckedMessage[] = [];
  for (let index = 0; index < value.length; index++) {
    const message = checkMessage(value[index], index);
    if (objects.has(message.source) || ids.has(message.messageId)) return fail();
    objects.add(message.source); ids.add(message.messageId);
    if (message.snapshot) {
      if (fleets.has(message.snapshot.fleetId)) return fail();
      fleets.add(message.snapshot.fleetId);
      for (const node of message.snapshotNodes) {
        if (snapshots.has(node)) return fail();
        snapshots.add(node);
      }
    }
    messages.push(message);
  }
  return messages;
}

function sameTarget(a: NpcScoutSnapshotV1, b: NpcScoutSnapshotV1): boolean {
  return a.target.galaxy === b.target.galaxy && a.target.system === b.target.system && a.target.position === b.target.position;
}

/** Only for a report's entry affordance; current membership is checked separately. */
export function isNpcScoutComparisonMessage(message: unknown): boolean {
  try { return checkMessage(message, 0).snapshot !== null; } catch { return false; }
}

/** Distinguish an invalid retained graph from a valid graph with no partner. */
export function isNpcScoutComparisonHistory(messages: unknown): boolean {
  try { currentMessages(messages); return true; } catch { return false; }
}

/** Metadata is detached; the controller must capture the actual indexed object. */
export function listNpcScoutComparisonCandidates(messages: unknown, anchor: unknown): readonly NpcScoutComparisonCandidate[] {
  try {
    const current = currentMessages(messages), selected = current.find(message => message.source === anchor);
    if (!selected?.snapshot) return NO_CANDIDATES;
    return Object.freeze(current.filter(message => message.source !== anchor && message.snapshot && sameTarget(selected.snapshot!, message.snapshot))
      .map(message => Object.freeze({ messageId: message.messageId, fleetId: message.snapshot!.fleetId,
        observedAt: message.snapshot!.observedAt, index: message.index })));
  } catch { return NO_CANDIDATES; }
}

/** Bounded display arithmetic, not an economy decimal or a binary-exact claim. */
function stockDecimal(value: number): { units: bigint; scale: number } {
  if (!Number.isFinite(value) || value < 0 || value > 50_000) return fail();
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = coefficient!.split(".");
  let units = BigInt(whole! + fraction), scale = fraction.length - Number(exponent);
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  // Finite capped Number strings need at most 324 places and 329 aligned digits.
  if (!Number.isSafeInteger(scale) || scale > 324 || units.toString().length > 329) return fail();
  return { units, scale };
}

function stockDifference(before: number, after: number): string {
  const a = stockDecimal(before), b = stockDecimal(after), scale = Math.max(a.scale, b.scale);
  const difference = b.units * 10n ** BigInt(scale - b.scale) - a.units * 10n ** BigInt(scale - a.scale);
  if (difference === 0n) return "0";
  const sign = difference < 0n ? "-" : "", digits = (difference < 0n ? -difference : difference).toString();
  if (scale === 0) return sign + digits;
  const padded = digits.padStart(scale + 1, "0"), whole = padded.slice(0, -scale), fraction = padded.slice(-scale).replace(/0+$/, "");
  return sign + whole + (fraction ? `.${fraction}` : "");
}

function observation(message: CheckedMessage): NpcScoutComparisonObservation {
  const snapshot = message.snapshot!;
  return Object.freeze({ messageId: message.messageId, fleetId: snapshot.fleetId, originId: snapshot.originId,
    observedAt: snapshot.observedAt, stock: snapshot.stock, garrison: snapshot.garrison, defenderTech: snapshot.defenderTech });
}

/** Both arguments must be actual retained objects; ID equality cannot resurrect one. */
export function buildNpcScoutComparison(messages: unknown, anchor: unknown, other: unknown): NpcScoutComparisonModel | null {
  try {
    if (anchor === other) return null;
    const current = currentMessages(messages), a = current.find(message => message.source === anchor), b = current.find(message => message.source === other);
    if (!a?.snapshot || !b?.snapshot || !sameTarget(a.snapshot, b.snapshot)) return null;
    // Fleet IDs and both timestamp forms are deliberately irrelevant to order.
    const [earlier, later] = a.index < b.index ? [a, b] : [b, a];
    const before = observation(earlier), after = observation(later);
    const stock: readonly [string, string, string] = Object.freeze([
      stockDifference(before.stock[0], after.stock[0]), stockDifference(before.stock[1], after.stock[1]), stockDifference(before.stock[2], after.stock[2]),
    ]);
    return Object.freeze({ target: earlier.snapshot!.target, before, after,
      delta: Object.freeze({ stock, garrison: Object.freeze({ light_fighter: after.garrison.light_fighter - before.garrison.light_fighter,
        heavy_fighter: after.garrison.heavy_fighter - before.garrison.heavy_fighter }) }),
      warning: NPC_SCOUT_COMPARISON_WARNING, precision: NPC_SCOUT_COMPARISON_PRECISION });
  } catch { return null; }
}
