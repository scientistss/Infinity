import { big } from "./decimal";
import type { FleetMessage } from "./fleet";
import { coordinateKey, coordinateRandom, homeCoordinates, SPACE } from "./galaxy";
import { isNpcGarrison, isNpcUniverseSeed } from "./npc-garrison";
import { canonicalNpcScoutTime, NPC_SCOUT_SNAPSHOT_MODEL, readNpcScoutSnapshot } from "./npc-scout-state";
import type { GameState } from "./types";

const fail = (): never => { throw new TypeError("NPC 侦察消息、快照或关联无效"); };
function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === names.length && names.every(key => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      return !!field && "value" in field && field.enumerable;
    });
}
function denseArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable) return false;
  }
  return true;
}

/** The new exact message shape is checked before map/spread/JSON can erase information. */
export function readNpcScoutMessages(value: unknown): FleetMessage[] {
  if (!denseArray(value, SPACE.maxMessages)) return fail();
  const ids = new Set<string>();
  return value.map(message => {
    if (!fields(message, ["id", "at", "text", "npcScoutSnapshot"])
      || typeof message.id !== "string" || message.id.length > 100 || ids.has(message.id)
      || typeof message.text !== "string" || message.text.length > 1000
      || typeof message.at !== "number" || !Number.isFinite(message.at) || message.at < 0 || message.at > 1e12) return fail();
    ids.add(message.id);
    const npcScoutSnapshot = message.npcScoutSnapshot === null ? null : readNpcScoutSnapshot(message.npcScoutSnapshot);
    if (npcScoutSnapshot && (message.id !== `scout-${npcScoutSnapshot.fleetId}`
      || message.at !== big(npcScoutSnapshot.observedAt).min(1e12).toNumber())) return fail();
    return { id: message.id, at: message.at, text: message.text, npcScoutSnapshot };
  });
}

/** Static identity and history crosslinks only. Never read/project/materialize a live NPC wallet. */
export function validateNpcScoutReferences(state: GameState, messages = readNpcScoutMessages(state.messages)): void {
  if (!isNpcUniverseSeed(state.universe.seed) || !Number.isSafeInteger(state.nextFleetId)
    || state.nextFleetId < 1 || state.nextFleetId > Number.MAX_SAFE_INTEGER) return fail();
  const now = big(canonicalNpcScoutTime(state.totalTime.toString()));
  const occupied = new Set(state.planets.map(planet => coordinateKey(planet.coordinates)));
  occupied.add(coordinateKey(homeCoordinates(state.universe.seed)));
  const live = new Map(state.fleets.map(fleet => [fleet.id, fleet]));
  const attacks = new Set(state.npcBattles.reports.map(report => report.fleetId));
  const observed = new Set<number>();
  for (const message of messages) {
    const snapshot = message.npcScoutSnapshot;
    if (snapshot === null) continue;
    const key = coordinateKey(snapshot.target);
    if (observed.has(snapshot.fleetId) || snapshot.fleetId >= state.nextFleetId || attacks.has(snapshot.fleetId)
      || occupied.has(key) || coordinateRandom(state.universe.seed, snapshot.target) >= SPACE.npcDensity
      || !isNpcGarrison(snapshot.garrison, state.universe.seed, snapshot.target)
      || big(snapshot.observedAt).gt(now)) return fail();
    observed.add(snapshot.fleetId);
    const fleet = live.get(snapshot.fleetId);
    if (fleet && (fleet.mission !== "scout" || fleet.returning !== true || fleet.originId !== snapshot.originId
      || coordinateKey(fleet.target) !== key)) return fail();
  }
}

type Location = "envelope" | "state" | "messages" | "message" | "snapshot" | "snapshot-child" | "other";
const decimalPrototype: object = Object.getPrototypeOf(big(0));
const builtinPrototypes = new Set<object>([Object.prototype, Array.prototype, Function.prototype, decimalPrototype]);

/**
 * Scan the untouched source once, before normalization. Shared ordinary values are
 * memoized, but aliases of the message/snapshot graph are refused, wherever found.
 * Custom prototypes are inspected as misplaced data, never read through accessors.
 * Unrelated historical projection rules (e.g. ordinary fleet array extras) stay intact.
 */
export function rejectNpcScoutFields(raw: unknown, legacy: boolean, envelope = false): void {
  const nodes = new WeakMap<object, { active: boolean; protected: boolean; authority: boolean }>();
  let work = 0;
  const visit = (value: unknown, location: Location, depth: number): boolean => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
    if (depth > 256 || ++work > 1_000_000) return fail();
    const protectedNode = location === "messages" || location === "message" || location === "snapshot" || location === "snapshot-child";
    const previous = nodes.get(value);
    if (previous) {
      if (previous.active) throw Error("NPC 存档格式不能包含循环对象");
      if (previous.protected || previous.authority || protectedNode) return fail();
      return false;
    }
    const node = { active: true, protected: protectedNode, authority: protectedNode };
    nodes.set(value, node);
    if (location === "messages" && (!Array.isArray(value) || value.length > SPACE.maxMessages)) return fail();
    if (!legacy && location === "messages" && !denseArray(value, SPACE.maxMessages)) return fail();
    const proto = Object.getPrototypeOf(value);
    if (proto && !builtinPrototypes.has(proto)) node.authority = visit(proto, "other", depth + 1) || node.authority;
    const own = Reflect.ownKeys(value);
    if (own.length + work > 1_000_000) return fail();
    for (const key of own) {
      if (++work > 1_000_000) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw Error("NPC 存档格式不接受访问器字段");
      const child: unknown = descriptor.value;
      if (key === "npcScoutSnapshot" && (legacy || location !== "message" || !descriptor.enumerable)) return fail();
      if (child === NPC_SCOUT_SNAPSHOT_MODEL && (legacy || location !== "snapshot" || key !== "model" || !descriptor.enumerable)) return fail();
      let childLocation: Location = "other";
      if (location === "envelope" && key === "state" && descriptor.enumerable) childLocation = "state";
      if (location === "state" && key === "messages" && descriptor.enumerable) childLocation = "messages";
      if (location === "messages" && Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
        && typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length && descriptor.enumerable) childLocation = "message";
      if (location === "message" && key === "npcScoutSnapshot" && descriptor.enumerable) childLocation = "snapshot";
      if (location === "snapshot" || location === "snapshot-child") childLocation = "snapshot-child";
      node.authority = visit(child, childLocation, depth + 1) || node.authority;
    }
    node.active = false;
    return node.authority;
  };
  visit(raw, envelope ? "envelope" : "state", 0);
}
