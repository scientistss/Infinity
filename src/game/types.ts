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

export interface GameState {
  resources: Record<ResourceId, BigNumber>;
  producers: Record<ProducerId, BigNumber>;
  /** Resources gained this run. Prestige clears this. */
  lifetime: Record<ResourceId, BigNumber>;
  /** Warp cores. Persist across a colony launch. */
  warpCores: BigNumber;
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
}

export interface ResourceAmounts {
  metal: BigNumber;
  crystal: BigNumber;
  deuterium: BigNumber;
}
