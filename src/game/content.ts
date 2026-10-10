import balance from "../data/balance.json";
import type { ResourceId } from "./types";

export {
  BUILDINGS,
  BUILDING_IDS,
  CURRENT_PHASE,
  PRODUCTION_IDS,
  activeBuildings,
  buildingById,
  isBuildingId,
  isProductionId,
  type BuildingDef,
  type BuildingId,
  type ProductionBuildingId,
} from "../data/buildings";

export interface ResourceDef {
  id: ResourceId;
  name: string;
  nameEn: string;
  blurb: string;
}

/**
 * v6 (P1): OGame buildings by level, build queue, storage caps, planet fields.
 * v7 (P2): research levels + research queue, dark matter, 12 protocol slots (design doc §4).
 * v8 (P3): planet.units (ships and defenses) and planet.shipyardQueue (design doc §17).
 * Unsupported versions remain protected. Same-schema v9 r2/r3/r4/r5 migrate to the current revision.
 */
export const SAVE_VERSION = 9;
/** r6 adds fixed single-source transport authority, immutable work and actual fleet receipts. */
export const SAVE_REVISION = 6;
export const SAVE_SCHEMA = "infinity-original-p4";
/** Same key as v1 so existing browsers still find the save. Version lives inside the file. */
export const STORAGE_KEY = "infinity.original-p4.save.v1";

/** Base offline cap. Curvature tech adds {@link OFFLINE_TECH_STEP_HOURS} up to the max. */
export const OFFLINE_BASE_HOURS = balance.offline.baseCapHours;
export const OFFLINE_MAX_HOURS = balance.offline.techMaxHours;
export const OFFLINE_TECH_STEP_HOURS = 2;
export const OFFLINE_BASE_SECONDS = OFFLINE_BASE_HOURS * 60 * 60;
export const OFFLINE_MAX_SECONDS = OFFLINE_MAX_HOURS * 60 * 60;
export const OFFLINE_CAP_SECONDS = OFFLINE_BASE_SECONDS;
export const OFFLINE_PROTOCOL_SECONDS = balance.offline.protocolEvalIntervalSeconds;
/** Offline protocol cards are considered on this cadence. Online play uses 1 second. */
export const PROTOCOL_OFFLINE_EVAL_SECONDS = OFFLINE_PROTOCOL_SECONDS;
export const PROTOCOL_LIVE_EVAL_SECONDS = 1;

/** gain = floor(sqrt(score / PRESTIGE_SCORE_UNIT)) */
export const PRESTIGE_SCORE_UNIT = balance.prestige.divisor;
export const SCORE_WEIGHTS = balance.prestige.scoreWeights;
export const CORE_BONUS_PER_CORE = balance.prestige.unspentCoreBonusPerCore;

export const STARTING_RESOURCES = { metal: balance.starting.metal, crystal: balance.starting.crystal, deuterium: 0 };
/** Manual collect = max(this, one second of metal output), ×10 with the curvature tech. */
export const MANUAL_MIN_METAL = balance.starting.manualMinMetal;
export const QUEUE_BASE_CAPACITY = balance.queue.baseCapacity;

export const RESOURCES: readonly ResourceDef[] = [
  { id: "metal", name: "金属", nameEn: "Metal", blurb: "结构材料。金属矿与星球基础产出。" },
  { id: "crystal", name: "晶体", nameEn: "Crystal", blurb: "晶体矿抽出的光学矿。" },
  { id: "deuterium", name: "重氢", nameEn: "Deuterium", blurb: "重氢合成器产出的推进剂，核聚变的燃料。" },
];

export function resourceName(id: ResourceId): string {
  return RESOURCES.find((entry) => entry.id === id)?.name ?? id;
}

export function isResourceId(value: string): value is ResourceId {
  return (["metal", "crystal", "deuterium"] as readonly string[]).includes(value);
}
