import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { big, isValidAmount } from "./decimal";
import { SPACE } from "./galaxy";

export type NpcResourceTuple = readonly [metal: number, crystal: number, deuterium: number];
export type NpcFlyingShipId = Exclude<ShipId, "solar_satellite">;
export type NpcSurvivingShips = Readonly<Partial<Record<NpcFlyingShipId, number>>>;

export const NPC_WALLET_INITIAL_STOCK: NpcResourceTuple = Object.freeze([500, 250, 0]);
export const NPC_WALLET_RATES: NpcResourceTuple = Object.freeze([5, 2.5, 1]);
export const NPC_WALLET_CAPS: NpcResourceTuple = Object.freeze([50_000, 30_000, 10_000]);

/** Dense plain arrays only: no holes, accessors, extra fields, symbols or coercion. */
export function isNpcResourceTuple(value: unknown): value is NpcResourceTuple {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (Reflect.ownKeys(value).length !== 4 || value.length !== 3) return false;
  return [0, 1, 2].every(i => {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    return !!field && "value" in field && field.enumerable && typeof field.value === "number"
      && Number.isFinite(field.value) && field.value >= 0 && field.value <= NPC_WALLET_CAPS[i];
  });
}

export function npcLootEligibility(stock: NpcResourceTuple): NpcResourceTuple {
  if (!isNpcResourceTuple(stock)) throw new TypeError("Invalid NPC stock");
  // The actual represented stock is authoritative. No epsilon or continuous-time correction.
  return Object.freeze([Math.floor(stock[0] / 2), Math.floor(stock[1] / 2), Math.floor(stock[2] / 2)]);
}

/** Proportional integer floors, then M, C, D remainder priority; never deduct unshipped loot. */
export function allocateNpcLoot(stock: NpcResourceTuple, survivingCapacity: number): NpcResourceTuple {
  const eligible = npcLootEligibility(stock);
  if (typeof survivingCapacity !== "number" || !Number.isFinite(survivingCapacity) || survivingCapacity < 0) {
    throw new TypeError("Invalid NPC surviving capacity");
  }
  const total = eligible[0] + eligible[1] + eligible[2];
  const wanted = Math.min(total, Math.floor(survivingCapacity));
  if (wanted === 0) return Object.freeze([0, 0, 0]);
  const loot: [number, number, number] = [
    Math.floor(eligible[0] * wanted / total),
    Math.floor(eligible[1] * wanted / total),
    Math.floor(eligible[2] * wanted / total),
  ];
  let left = wanted - loot[0] - loot[1] - loot[2];
  for (let i = 0; i < 3 && left > 0; i += 1) {
    if (loot[i] < eligible[i]) { loot[i] += 1; left -= 1; }
  }
  if (left !== 0) throw new Error("Invalid NPC loot remainder");
  return Object.freeze(loot);
}

/**
 * Sum catalogue cargo in Decimal and apply the locked dispatch factor. Clamp to
 * bounded eligibility BEFORE converting to Number; fuel was already paid once.
 * This accepts an empty survivor map, but never satellites, defenses or bad counts.
 */
export function npcSurvivingWholeCapacity(
  ships: NpcSurvivingShips, cargoFactor: number, stock: NpcResourceTuple,
): number {
  const eligible = npcLootEligibility(stock);
  if (!ships || typeof ships !== "object" || Array.isArray(ships)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(ships))
    || typeof cargoFactor !== "number" || !Number.isFinite(cargoFactor) || cargoFactor < 1) {
    throw new TypeError("Invalid NPC surviving fleet or cargo factor");
  }
  for (const key of Reflect.ownKeys(ships)) {
    const field = Object.getOwnPropertyDescriptor(ships, key);
    if (typeof key !== "string" || !SHIP_IDS.includes(key as ShipId) || key === "solar_satellite"
      || !field || !("value" in field) || !field.enumerable || typeof field.value !== "number"
      || !Number.isSafeInteger(field.value) || field.value < 0 || field.value > SPACE.maxShips) {
      throw new TypeError("Invalid NPC surviving fleet");
    }
  }
  let capacity = big(0);
  // Catalogue order also prevents insertion-order-dependent Decimal addition.
  for (const id of SHIP_IDS) {
    if (id !== "solar_satellite") capacity = capacity.add(big(unitById(id).cargo).mul(ships[id] ?? 0));
  }
  capacity = capacity.mul(cargoFactor);
  if (!isValidAmount(capacity)) throw new TypeError("Invalid NPC surviving capacity");
  const bounded = capacity.min(eligible[0] + eligible[1] + eligible[2]).floor().toNumber();
  if (!Number.isSafeInteger(bounded) || bounded < 0 || bounded > 45_000) throw new TypeError("Invalid NPC bounded capacity");
  return bounded;
}
