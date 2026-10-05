import type { BigNumber } from "./decimal";

export const RESOURCE_IDS = ["metal", "crystal", "deuterium"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const PRODUCER_IDS = [
  "metal_mine",
  "solar_plant",
  "crystal_mine",
  "deuterium_synth",
  "robotics_factory",
] as const;
export type ProducerId = (typeof PRODUCER_IDS)[number];

export interface GameState {
  resources: Record<ResourceId, BigNumber>;
  producers: Record<ProducerId, BigNumber>;
  /** Resources gained this run. A colonial launch clears this. */
  lifetime: Record<ResourceId, BigNumber>;
  /** Curvature cores. Kept across launches. */
  warpCores: BigNumber;
  /** Seconds the save has been ticking, including offline catch-up. */
  totalTime: BigNumber;
}
