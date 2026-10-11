import type { PaidJobIdentity } from "./order-state";
import type { ResourceAmounts } from "./types";

/** Phase A is an explicit allowlist; later catalog phases do not expand this authority. */
export const DEMOLISHABLE_BUILDING_IDS = [
  "metal_mine", "crystal_mine", "deuterium_synth", "solar_plant", "fusion_reactor",
  "metal_storage", "crystal_storage", "deuterium_tank", "robotics_factory", "nanite_factory",
  "shipyard", "research_lab", "missile_silo",
] as const;
export type DemolishableBuildingId = (typeof DEMOLISHABLE_BUILDING_IDS)[number];
export const DEMOLITION_RULE_VERSION = 1;
export const MAX_DEMOLITION_SECONDS = 2 ** 33;

export function isDemolishableBuildingId(value: unknown): value is DemolishableBuildingId {
  return typeof value === "string" && (DEMOLISHABLE_BUILDING_IDS as readonly string[]).includes(value);
}

/** Shared quote/reader time domain. Preserve fractional seconds without clamping. */
export function validDemolitionSeconds(total: unknown, remaining: unknown): boolean {
  return typeof total === "number" && Number.isFinite(total) && total >= 1 && total < MAX_DEMOLITION_SECONDS
    && typeof remaining === "number" && Number.isFinite(remaining) && remaining >= 0 && remaining <= total
    && Object.is(JSON.parse(JSON.stringify(total)), total) && Object.is(JSON.parse(JSON.stringify(remaining)), remaining);
}

/** Independent manual work; this never extends the finite upgrade/plan authority union. */
export interface DemolitionJob extends PaidJobIdentity {
  kind: "demolition";
  source: "manual";
  taskId: null;
  demolitionRuleVersion: typeof DEMOLITION_RULE_VERSION;
  building: DemolishableBuildingId;
  fromLevel: number;
  toLevel: number;
  paid: ResourceAmounts;
  totalSeconds: number;
  remainingSeconds: number;
}
export interface DemolitionJobRef {
  kind: "demolition";
  planetId: string;
  jobId: number;
  taskId: null;
}
