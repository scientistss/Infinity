import { coordinateRandom, SPACE, type Coordinates } from "./galaxy";

export interface NpcGarrison {
  readonly light_fighter: number;
  readonly heavy_fighter: number;
}

export const NPC_GARRISON_SALT = 101;
export const NPC_COMBAT_TECH = Object.freeze({ weapons: 0, shields: 0, armour: 0 });

function plainFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return !!field && "value" in field && field.enumerable;
  });
}

export function isNpcUniverseSeed(seed: unknown): seed is number {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}

/** Unlike the older permissive galaxy helper, this is a strict plain-data boundary. */
export function isNpcCoordinates(value: unknown): value is Coordinates {
  if (!plainFields(value, ["galaxy", "system", "position"])) return false;
  return typeof value.galaxy === "number" && Number.isInteger(value.galaxy) && value.galaxy >= 1 && value.galaxy <= SPACE.galaxies
    && typeof value.system === "number" && Number.isInteger(value.system) && value.system >= 1 && value.system <= SPACE.systems
    && typeof value.position === "number" && Number.isInteger(value.position) && value.position >= 1 && value.position <= 15;
}

/** This derives a coordinate's initial counts; NPC occupancy is checked by the wallet context. */
export function initialNpcGarrison(seed: number, coordinate: Coordinates): NpcGarrison {
  if (!isNpcUniverseSeed(seed) || !isNpcCoordinates(coordinate)) throw new TypeError("Invalid NPC garrison coordinate or seed");
  return Object.freeze(coordinateRandom(seed, coordinate, NPC_GARRISON_SALT) < 0.75
    ? { light_fighter: 4, heavy_fighter: 0 }
    : { light_fighter: 8, heavy_fighter: 1 });
}

export function isNpcGarrison(value: unknown, seed: number, coordinate: Coordinates): value is NpcGarrison {
  if (!isNpcUniverseSeed(seed) || !isNpcCoordinates(coordinate)
    || !plainFields(value, ["light_fighter", "heavy_fighter"])) return false;
  const initial = initialNpcGarrison(seed, coordinate);
  return (["light_fighter", "heavy_fighter"] as const).every(id => {
    const count = value[id];
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= initial[id];
  });
}

/** Only counts survive between encounters; the combat kernel supplies fresh hull/shields. */
export function survivingNpcGarrison(
  before: NpcGarrison, survivors: NpcGarrison, seed: number, coordinate: Coordinates,
): NpcGarrison {
  if (!isNpcGarrison(before, seed, coordinate) || !isNpcGarrison(survivors, seed, coordinate)
    || survivors.light_fighter > before.light_fighter || survivors.heavy_fighter > before.heavy_fighter) {
    throw new TypeError("Invalid NPC garrison survivors");
  }
  return Object.freeze({ light_fighter: survivors.light_fighter, heavy_fighter: survivors.heavy_fighter });
}
