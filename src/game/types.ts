import type { FleetFormationState } from "./formation-state";
import type { OrderState } from "./order-state";
import type { ResearchTemplateState } from "./research-template-state";
import type { DeepState } from "./deep-state";
import type { Universe } from "./galaxy";
import type { Fleet, FleetMessage } from "./fleet";
import type { BigNumber } from "./decimal";
import type { CardCatalogId, ProtocolCard } from "../data/protocol-cards";
import type { BuildingId, ProductionBuildingId } from "../data/buildings";
import type { BuildOrder, PlanetState } from "./planet";
import type { ResearchOrder, ResearchState } from "./research";
import type { Booster } from "./boosters";
import type { InventoryItemId } from "../data/dark-matter";
import type { ArcadeState } from "./arcade";

export type {
  BuildingId,
  BuildOrder,
  CardCatalogId,
  PlanetState,
  ProductionBuildingId,
  ProtocolCard,
  ResearchOrder,
  ResearchState,
};

export const RESOURCE_IDS = ["metal", "crystal", "deuterium"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

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

/** Rack length in the save. Hard cap from P2 (design doc §8.6): 12. */
export const PROTOCOL_SLOT_COUNT = 12;

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
  /** Manual mining and manual build orders since the last launch. */
  manualActions: number;
  /** Launches finished with zero manual actions that run. */
  automatedLaunches: number;
  /** Build orders finished, all runs. */
  buildsCompleted: number;
  /** Sticky once any resource has reached its storage cap. Unlocks card 8. */
  seenStorageFull: boolean;
  /** Sticky once the build queue has run empty after a completion. Unlocks card 7 (with robotics ≥ 1). */
  seenQueueIdle: boolean;
  /** Research levels finished, all runs. */
  researchCompleted: number;
  /** Dark matter earned from all sources, all runs. */
  darkMatterEarned: number;
  /** Ships and defenses finished, all runs (P3). */
  unitsBuilt: number;
}

export interface GameState {
  /** Finite local plans and globally stable paid queue identities. */
  orders: OrderState;
  /** Named ship-count intentions; replenishment is separately authorized and finite. */
  formations: FleetFormationState;
  /** Reusable research goals; authorization is created separately through finite plans. */
  researchTemplates: ResearchTemplateState;
  /** Canonical per-planet inventories and independent local queues (P4-1). */
  planets: PlanetState[];
  activePlanetId: string;
  universe: Universe;
  deepSpace: DeepState;
  fleets: Fleet[];
  messages: FleetMessage[];
  nextFleetId: number;
  /** Empire research levels and research queue (design doc §6). Levels are kept on launch. */
  research: ResearchState;
  /** Dark matter (design doc §8.8). Empire resource, kept on launch, not affected by production multipliers. */
  darkMatter: BigNumber;
  /** Inventory items (ring machine supply box). Kept on launch. */
  items: Record<InventoryItemId, number>;
  /** Active resource boosters, at most one per resource. Kept on launch until they run out. */
  boosters: Booster[];
  /** Deep-space ring machine (beacon version): stored pre-rolled runs, bets, pity, history. Kept on launch. */
  arcade: ArcadeState;
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
