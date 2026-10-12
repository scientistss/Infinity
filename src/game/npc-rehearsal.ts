import { SHIP_IDS, type ShipId } from "../data/units";
import { fightEncounter, type BattleResult, type BattleRound, type CombatTech } from "./encounter-combat";
import { allocateNpcLoot, npcSurvivingWholeCapacity, type NpcResourceTuple, type NpcSurvivingShips } from "./npc-loot";
import { readNpcScoutSnapshot, type NpcScoutSnapshotV1 } from "./npc-scout-state";

/** Public illustrative examples. Never derive these from a world, flight or real battle. */
export const NPC_REHEARSAL_SEED_GROUP = "npc-rehearsal-public-v1" as const;
export const NPC_REHEARSAL_SEEDS = Object.freeze([608135816, 2242054355, 320440878] as const);
const TECH_KEYS = ["weapons", "shields", "armour"] as const;
const FLYING_IDS = SHIP_IDS.filter(id => id !== "solar_satellite");
const MAX_SHIPS_PER_TYPE = 1e12;
const CARGO_FACTORS = new Set(Array.from({ length: 1001 }, (_, level) => 1 + .05 * level));

export type NpcRehearsalBattle = Readonly<Omit<BattleResult, "rounds" | "attackerBefore" | "defenderBefore" | "attackerAfter" | "defenderAfter">> & {
  readonly rounds: readonly Readonly<BattleRound>[];
  readonly attackerBefore: NpcSurvivingShips;
  readonly defenderBefore: NpcSurvivingShips;
  readonly attackerAfter: NpcSurvivingShips;
  readonly defenderAfter: NpcSurvivingShips;
};
export interface NpcRehearsalSample {
  readonly seed: (typeof NPC_REHEARSAL_SEEDS)[number];
  readonly battle: NpcRehearsalBattle;
  /** Whole surviving capacity, capped by the historical stock's half-loot eligibility. */
  readonly survivingCapacity: number;
  readonly loot: NpcResourceTuple;
  readonly undefended: boolean;
  readonly destroyed: boolean;
}
export interface NpcRehearsalResult {
  readonly seedGroup: typeof NPC_REHEARSAL_SEED_GROUP;
  readonly sampleCount: 3;
  readonly interpretation: "illustrative-samples-not-probabilities";
  readonly snapshot: NpcScoutSnapshotV1;
  readonly selectedShips: NpcSurvivingShips;
  readonly attackerTech: Readonly<CombatTech>;
  readonly cargoFactor: number;
  readonly samples: readonly [NpcRehearsalSample, NpcRehearsalSample, NpcRehearsalSample];
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function own(value: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && "value" in field && field.enumerable ? field.value : undefined;
}
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => own(value, key) !== undefined);
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function canonicalTech(value: unknown, max: number): Readonly<CombatTech> {
  if (!fields(value, TECH_KEYS) || !TECH_KEYS.every(key => integer(value[key], 0, max))) {
    throw new TypeError("Invalid NPC rehearsal combat technology");
  }
  return Object.freeze({ weapons: value.weapons as number, shields: value.shields as number, armour: value.armour as number });
}
function canonicalShips(value: unknown): NpcSurvivingShips {
  if (!plain(value)) throw new TypeError("Invalid NPC rehearsal fleet");
  const keys = Reflect.ownKeys(value);
  if (keys.length > FLYING_IDS.length) throw new TypeError("Invalid NPC rehearsal fleet size");
  const counts = new Map<ShipId, number>();
  let total = 0;
  for (const key of keys) {
    const count = own(value, key);
    if (typeof key !== "string" || !FLYING_IDS.includes(key as typeof FLYING_IDS[number])
      || !integer(count, 0, MAX_SHIPS_PER_TYPE)) throw new TypeError("Invalid NPC rehearsal ship count");
    total += count;
    if (!Number.isSafeInteger(total)) throw new TypeError("Invalid NPC rehearsal fleet total");
    counts.set(key as ShipId, count);
  }
  const ships: Partial<Record<ShipId, number>> = {};
  for (const id of FLYING_IDS) {
    const count = counts.get(id) ?? 0;
    if (count > 0) ships[id] = count;
  }
  return Object.freeze(ships);
}
function freezeBattle(battle: BattleResult): NpcRehearsalBattle {
  return Object.freeze({
    mode: battle.mode, winner: battle.winner,
    rounds: Object.freeze(battle.rounds.map(round => Object.freeze({ ...round }))),
    attackerBefore: canonicalShips(battle.attackerBefore), defenderBefore: canonicalShips(battle.defenderBefore),
    attackerAfter: canonicalShips(battle.attackerAfter), defenderAfter: canonicalShips(battle.defenderAfter),
  });
}

/**
 * Three bounded historical examples, not win-rate estimates or dispatch quotes.
 * The caller captures completed technology and its exact 1 + .05 * hyperspace
 * level at the explicit Run click. No queued/due research or inventory is read.
 * Real dispatch locks cargo then; real combat reads technology on arrival.
 * At most 13 attacking types, 2 defending types, 6 rounds and 3 public seeds.
 * No world identity, payment, stock, fleet, clock, persistence or RNG is changed.
 */
export function rehearseNpcScout(
  snapshot: unknown, selectedShips: unknown, attackerTech: unknown, cargoFactor: unknown,
): NpcRehearsalResult {
  const historical = readNpcScoutSnapshot(snapshot), ships = canonicalShips(selectedShips);
  if (Object.keys(ships).length === 0) throw new TypeError("NPC rehearsal requires a nonempty attacking fleet");
  const tech = canonicalTech(attackerTech, 1000);
  if (typeof cargoFactor !== "number" || !CARGO_FACTORS.has(cargoFactor)) {
    throw new TypeError("Invalid NPC rehearsal completed cargo factor");
  }
  const defenders = canonicalShips(historical.garrison), undefended = Object.keys(defenders).length === 0;
  const sample = (seed: NpcRehearsalSample["seed"]): NpcRehearsalSample => {
    const battle = freezeBattle(fightEncounter(ships, defenders, tech, historical.defenderTech, seed));
    const destroyed = Object.keys(battle.attackerAfter).length === 0;
    const survivingCapacity = npcSurvivingWholeCapacity(battle.attackerAfter, cargoFactor, historical.stock);
    const loot: NpcResourceTuple = battle.winner === "attacker" && !destroyed
      ? allocateNpcLoot(historical.stock, survivingCapacity) : Object.freeze([0, 0, 0]);
    return Object.freeze({ seed, battle, survivingCapacity, loot, undefended, destroyed });
  };
  return Object.freeze({
    seedGroup: NPC_REHEARSAL_SEED_GROUP, sampleCount: 3, interpretation: "illustrative-samples-not-probabilities",
    snapshot: historical, selectedShips: ships, attackerTech: tech, cargoFactor,
    samples: Object.freeze([sample(608135816), sample(2242054355), sample(320440878)] as const),
  });
}
