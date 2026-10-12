import { big, isValidAmount } from "./decimal";
import type { Coordinates } from "./galaxy";
import { isNpcCoordinates } from "./npc-garrison";
import { isNpcResourceTuple, type NpcResourceTuple } from "./npc-loot";

export const NPC_SCOUT_SNAPSHOT_MODEL = "npc-scout-snapshot-v1";

/** Historical data only. No launch, payment, live-world or random-seed authority. */
export interface NpcScoutSnapshotV1 {
  readonly model: typeof NPC_SCOUT_SNAPSHOT_MODEL;
  readonly fleetId: number;
  readonly originId: string;
  readonly target: Readonly<Coordinates>;
  readonly observedAt: string;
  readonly stock: NpcResourceTuple;
  readonly garrison: Readonly<{ light_fighter: number; heavy_fighter: number }>;
  readonly defenderTech: Readonly<{ weapons: 0; shields: 0; armour: 0 }>;
}

const fail = (): never => { throw new TypeError("NPC 侦察历史快照无效"); };
function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== names.length) return false;
  return names.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return !!field && "value" in field && field.enumerable;
  });
}
function count(value: unknown, max: number, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** Accept only the actual canonical Decimal representation, without coercion. */
export function canonicalNpcScoutTime(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100
    || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/.test(value)) return fail();
  const time = big(value);
  if (!isValidAmount(time) || time.toString() !== value) return fail();
  return value;
}

/** Strict, detached, deeply frozen input boundary; deliberately knows no world or seed. */
export function readNpcScoutSnapshot(value: unknown): NpcScoutSnapshotV1 {
  if (!fields(value, ["model", "fleetId", "originId", "target", "observedAt", "stock", "garrison", "defenderTech"])
    || value.model !== NPC_SCOUT_SNAPSHOT_MODEL || !count(value.fleetId, Number.MAX_SAFE_INTEGER - 1, 1)
    || typeof value.originId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.originId)
    || !isNpcCoordinates(value.target) || !Array.isArray(value.stock) || value.stock.length !== 3 || !isNpcResourceTuple(value.stock)
    || !fields(value.garrison, ["light_fighter", "heavy_fighter"])
    || !count(value.garrison.light_fighter, 8) || !count(value.garrison.heavy_fighter, 1)
    || !fields(value.defenderTech, ["weapons", "shields", "armour"])
    || value.defenderTech.weapons !== 0 || value.defenderTech.shields !== 0 || value.defenderTech.armour !== 0) return fail();
  const observedAt = canonicalNpcScoutTime(value.observedAt);
  // Economic zero follows JSON's policy, while every represented nonzero Number survives.
  const stock: NpcResourceTuple = Object.freeze([
    value.stock[0] === 0 ? 0 : value.stock[0], value.stock[1] === 0 ? 0 : value.stock[1], value.stock[2] === 0 ? 0 : value.stock[2],
  ]);
  return Object.freeze({ model: NPC_SCOUT_SNAPSHOT_MODEL, fleetId: value.fleetId, originId: value.originId,
    target: Object.freeze({ galaxy: value.target.galaxy, system: value.target.system, position: value.target.position }),
    observedAt, stock,
    garrison: Object.freeze({ light_fighter: value.garrison.light_fighter, heavy_fighter: value.garrison.heavy_fighter }),
    defenderTech: Object.freeze({ weapons: 0, shields: 0, armour: 0 }),
  });
}
