import type { BigNumber } from "./decimal";

export const RESOURCE_IDS = ["metal", "crystal", "deuterium"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const PRODUCER_IDS = ["miner", "drill", "well", "smelter", "survey"] as const;
export type ProducerId = (typeof PRODUCER_IDS)[number];

export interface GameState {
  resources: Record<ResourceId, BigNumber>;
  producers: Record<ProducerId, BigNumber>;
  /** Resources gained this run. Prestige clears this. */
  lifetime: Record<ResourceId, BigNumber>;
  /** Sqrt-layer prestige currency. Survives an orbital uplink. */
  telemetry: BigNumber;
  /** Seconds the save has been ticking, including offline catch-up. */
  totalTime: BigNumber;
}

export interface ResourceAmounts {
  metal: BigNumber;
  crystal: BigNumber;
  deuterium: BigNumber;
}
