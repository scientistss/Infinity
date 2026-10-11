import { isResearchId } from "../data/research";
import { SHIP_IDS, type ShipId } from "../data/units";
import { fightEncounter, type BattleResult, type BattleRound, type CombatTech } from "./encounter-combat";
import { coordinateKey, SPACE, type Coordinates } from "./galaxy";
import { isNpcCoordinates, isNpcGarrison, isNpcUniverseSeed, NPC_COMBAT_TECH, survivingNpcGarrison, type NpcGarrison } from "./npc-garrison";
import { allocateNpcLoot, isNpcResourceTuple, npcSurvivingWholeCapacity, type NpcResourceTuple, type NpcSurvivingShips } from "./npc-loot";
import type { ResearchState } from "./research";

const TECH_KEYS = ["weapons", "shields", "armour"] as const;
const RESEARCH_KEYS = { weapons: "weapons_tech", shields: "shielding_tech", armour: "armour_tech" } as const;

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function own(value: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  return field && "value" in field && field.enumerable ? field.value : undefined;
}
function fields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Reflect.ownKeys(value).length === keys.length
    && keys.every(key => own(value, key) !== undefined);
}
function level(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}
function combatTech(value: CombatTech): CombatTech {
  if (!fields(value, TECH_KEYS) || !TECH_KEYS.every(key => level(value[key], 1002))) throw new TypeError("Invalid NPC combat technology");
  return Object.freeze({ weapons: value.weapons, shields: value.shields, armour: value.armour });
}

/** All safe integer ID digits participate; this seed is not a task identity or payment proof. */
export function npcBattleSeed(universeSeed: number, fleetId: number, target: Coordinates): number {
  if (!isNpcUniverseSeed(universeSeed) || !Number.isSafeInteger(fleetId) || fleetId < 1 || !isNpcCoordinates(target)) {
    throw new TypeError("Invalid NPC battle identity");
  }
  const text = `npc-battle-v1|${universeSeed}|${fleetId}|${coordinateKey(target)}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

/**
 * Pure view of an already-validated research state. Only its original active
 * head can contribute at exact zero; this never completes a job or a receipt.
 * This is not a save validator or payment authorization. The existing reader
 * retains full paid-job/plan cross-reference validation.
 */
export function npcArrivalCombatTech(research: Readonly<ResearchState>): Readonly<CombatTech> {
  if (!fields(research, ["levels", "queue"]) || !plain(research.levels)
    || !Array.isArray(research.queue) || Object.getPrototypeOf(research.queue) !== Array.prototype) {
    throw new TypeError("Invalid NPC arrival research");
  }
  const result: CombatTech = { weapons: 0, shields: 0, armour: 0 };
  for (const key of TECH_KEYS) {
    const completed = own(research.levels, RESEARCH_KEYS[key]);
    // The existing research/save domain is 0..1000 (the generic kernel allows 1002).
    if (!level(completed, 1000)) throw new TypeError("Invalid completed NPC combat technology");
    result[key] = completed;
  }
  const head = own(research.queue, "0");
  if (plain(head)) {
    const tech = own(head, "tech"), target = own(head, "targetLevel"), total = own(head, "totalSeconds");
    const jobId = own(head, "jobId"), planetId = own(head, "planetId"), source = own(head, "source"), taskId = own(head, "taskId");
    const validId = (id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id >= 1 && id < Number.MAX_SAFE_INTEGER;
    if (validId(jobId) && typeof planetId === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(planetId)
      && (source === "plan" ? validId(taskId) : (source === "manual" || source === "protocol") && taskId === null)
      && typeof tech === "string" && isResearchId(tech) && level(target, 1000) && target > 0
      && typeof total === "number" && Number.isFinite(total) && total > 0 && own(head, "remainingSeconds") === 0) {
      for (const key of TECH_KEYS) if (RESEARCH_KEYS[key] === tech) result[key] = Math.max(result[key], target);
    }
  }
  return Object.freeze(result);
}

function canonicalShips(value: NpcSurvivingShips): NpcSurvivingShips {
  if (!plain(value)) throw new TypeError("Invalid NPC attacking fleet");
  const counts = new Map<ShipId, number>();
  for (const key of Reflect.ownKeys(value)) {
    const count = own(value, key);
    if (typeof key !== "string" || !SHIP_IDS.includes(key as ShipId) || key === "solar_satellite"
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > SPACE.maxShips) {
      throw new TypeError("Invalid NPC attacking ship count");
    }
    counts.set(key as ShipId, count);
  }
  const ships: Partial<Record<ShipId, number>> = {};
  for (const id of SHIP_IDS) if ((counts.get(id) ?? 0) > 0) ships[id] = counts.get(id);
  return Object.freeze(ships);
}

export interface NpcBattleInput {
  readonly universeSeed: number;
  readonly fleetId: number;
  readonly target: Coordinates;
  readonly ships: NpcSurvivingShips;
  readonly garrison: NpcGarrison;
  readonly attackerTech: CombatTech;
  readonly stock: NpcResourceTuple;
  readonly cargoFactor: number;
}
type NpcBattleSnapshot = Readonly<Omit<BattleResult, "rounds" | "attackerBefore" | "defenderBefore" | "attackerAfter" | "defenderAfter">> & {
  readonly rounds: readonly Readonly<BattleRound>[];
  readonly attackerBefore: NpcSurvivingShips;
  readonly defenderBefore: NpcSurvivingShips;
  readonly attackerAfter: NpcSurvivingShips;
  readonly defenderAfter: NpcSurvivingShips;
};
export interface NpcBattleCandidate {
  readonly seed: number;
  readonly attackerTech: Readonly<CombatTech>;
  readonly battle: NpcBattleSnapshot;
  readonly survivors: NpcSurvivingShips;
  readonly garrison: NpcGarrison;
  readonly stockBefore: NpcResourceTuple;
  readonly cargoFactor: number;
  /** Whole cargo bounded by this stock's half-loot eligibility, even on defeat/draw. */
  readonly survivingCapacity: number;
  readonly loot: NpcResourceTuple;
  readonly destroyed: boolean;
  readonly undefended: boolean;
}

/**
 * Detached calculation only. The integration must authenticate the current paid
 * task, NPC target and arrival boundary, then atomically adopt losses and debit.
 * No GameState, scheduler, saved report, external RNG or return is changed here.
 */
export function resolveNpcBattleCandidate(input: NpcBattleInput): NpcBattleCandidate {
  if (!fields(input, ["universeSeed", "fleetId", "target", "ships", "garrison", "attackerTech", "stock", "cargoFactor"])) {
    throw new TypeError("Invalid NPC battle input");
  }
  const seed = npcBattleSeed(input.universeSeed, input.fleetId, input.target);
  const attackerTech = combatTech(input.attackerTech), ships = canonicalShips(input.ships);
  if (!isNpcGarrison(input.garrison, input.universeSeed, input.target) || !isNpcResourceTuple(input.stock)
    || typeof input.cargoFactor !== "number" || !Number.isFinite(input.cargoFactor) || input.cargoFactor < 1) {
    throw new TypeError("Invalid NPC battle garrison, stock or cargo factor");
  }
  const defenders = canonicalShips(input.garrison);
  const fought = fightEncounter(ships, defenders, attackerTech, NPC_COMBAT_TECH, seed);
  const survivors = canonicalShips(fought.attackerAfter);
  const garrison = survivingNpcGarrison(input.garrison, {
    light_fighter: fought.defenderAfter.light_fighter ?? 0, heavy_fighter: fought.defenderAfter.heavy_fighter ?? 0,
  }, input.universeSeed, input.target);
  const stockBefore: NpcResourceTuple = Object.freeze([input.stock[0], input.stock[1], input.stock[2]]);
  const destroyed = Object.keys(survivors).length === 0;
  const survivingCapacity = npcSurvivingWholeCapacity(survivors, input.cargoFactor, stockBefore);
  const loot: NpcResourceTuple = fought.winner === "attacker" && !destroyed
    ? allocateNpcLoot(stockBefore, survivingCapacity) : Object.freeze([0, 0, 0]);
  const battle: NpcBattleSnapshot = Object.freeze({
    ...fought, rounds: Object.freeze(fought.rounds.map(round => Object.freeze({ ...round }))),
    attackerBefore: canonicalShips(fought.attackerBefore), defenderBefore: canonicalShips(fought.defenderBefore),
    attackerAfter: canonicalShips(fought.attackerAfter), defenderAfter: canonicalShips(fought.defenderAfter),
  });
  return Object.freeze({ seed, attackerTech, battle, survivors, garrison, stockBefore,
    cargoFactor: input.cargoFactor, survivingCapacity, loot, destroyed, undefended: Object.keys(defenders).length === 0 });
}
