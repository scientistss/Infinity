import type { BigNumber } from "./decimal";
import type { CardCatalogId, ProducerId, ProtocolCard } from "../data/protocol-cards";

export type { CardCatalogId, ProducerId, ProtocolCard };

export const RESOURCE_IDS = ["metal", "crystal", "deuterium"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const PRODUCER_IDS = [
  "metal_mine",
  "solar_plant",
  "crystal_mine",
  "deuterium_synth",
  "robotics_factory",
] as const satisfies readonly ProducerId[];

export const CURVATURE_IDS = [
  "seed_stock",
  "output_double",
  "growth_cut",
  "offline_extend",
  "slot_plus",
  "manual_ten",
  "early_protocols",
  "score_boost",
] as const;
export type CurvatureId = (typeof CURVATURE_IDS)[number];

export const PROTOCOL_SLOT_COUNT = 6;

export type CardLamp = "green" | "gray" | "red";

/** One rack slot. `card` is a catalog template plus the player's dropdown edits. */
export interface ProtocolSlotState {
  card: ProtocolCard | null;
  /** Seconds since this card's interval trigger last attempted. */
  elapsed: number;
  lamp: CardLamp;
  /** Shown on hover. */
  reason: string;
}

export interface ProtocolLoadout {
  /** Seconds toward the next engine pass (1s live, 60s offline). */
  accumulator: number;
  slots: ProtocolSlotState[];
}

/** Counters that achievements read. Kept across colonial launches except `manualActions`. */
export interface PlayerStats {
  /** Lifetime manual mining clicks. */
  scrapes: number;
  /** Successful colonial launches. */
  launches: number;
  /** True once energy demand has exceeded supply. */
  seenEnergyShort: boolean;
  /** Manual mining and manual purchases since the last launch. */
  manualActions: number;
  /** Launches finished with zero manual actions that run. */
  automatedLaunches: number;
}

export interface GameState {
  resources: Record<ResourceId, BigNumber>;
  producers: Record<ProducerId, BigNumber>;
  /** Resources gained this run. Prestige clears this. */
  lifetime: Record<ResourceId, BigNumber>;
  /** Curvature cores earned. Spent ranks live in `curvature`, not in this total. */
  warpCores: BigNumber;
  /** Purchased ranks on the curvature tree. Kept across launches. */
  curvature: Record<CurvatureId, number>;
  /** Seconds the save has been ticking, including offline catch-up. */
  totalTime: BigNumber;
  /** Manual collect clicks. Auto-collect does not increment this. */
  manualClicks: number;
  /** Sticky once demand has exceeded supply. */
  seenEnergyShortage: boolean;
  /** Sticky once a colony ship has launched. */
  hasPrestiged: boolean;
  /** Catalog ids that have ever met their unlock. */
  unlockedCards: CardCatalogId[];
  protocols: ProtocolLoadout;
  /** Unlocked achievement ids, in catalog order. Kept across launches. */
  unlocked: string[];
  stats: PlayerStats;
  /**
   * Extra offline hours from curvature tech. 0 until that tech exists.
   * Total cap is min(8h, 2h + this).
   */
  offlineBonusHours: number;
}

export interface ResourceAmounts {
  metal: BigNumber;
  crystal: BigNumber;
  deuterium: BigNumber;
}
