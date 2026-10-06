import balance from "../data/balance.json";
import { BUILDING_IDS, PRODUCTION_IDS, type BuildingId, type ProductionBuildingId } from "../data/buildings";
import type { BigNumber } from "./decimal";

export type OrderSource = "manual" | "protocol";

/** One build-queue entry. Index 0 of the queue is the order under construction. */
export interface BuildOrder {
  building: BuildingId;
  targetLevel: number;
  /** Charged when queued; refunded in full on cancel. */
  paid: { metal: BigNumber; crystal: BigNumber; deuterium: BigNumber };
  /** Written when construction starts (robotics/nanite levels at that moment). 0 while waiting. */
  totalSeconds: number;
  remainingSeconds: number;
  source: OrderSource;
}

/**
 * The single planet of P1. Resources stay on GameState until P4 moves everything into planets[].
 */
export interface PlanetState {
  name: string;
  /** Max temperature in °C. Drives deuterium output. */
  tempMax: number;
  fieldsMax: number;
  buildings: Record<BuildingId, number>;
  /** 0–100 in steps of 10. */
  productionPct: Record<ProductionBuildingId, number>;
  buildQueue: BuildOrder[];
}

export const HOMEWORLD = balance.universe.homeworld;

export function emptyBuildings(): Record<BuildingId, number> {
  const out = {} as Record<BuildingId, number>;
  for (const id of BUILDING_IDS) out[id] = 0;
  return out;
}

export function fullProduction(): Record<ProductionBuildingId, number> {
  const out = {} as Record<ProductionBuildingId, number>;
  for (const id of PRODUCTION_IDS) out[id] = 100;
  return out;
}

export function createPlanet(): PlanetState {
  return {
    name: HOMEWORLD.name,
    tempMax: HOMEWORLD.tempMax,
    fieldsMax: HOMEWORLD.fields,
    buildings: emptyBuildings(),
    productionPct: fullProduction(),
    buildQueue: [],
  };
}

/** Every building level takes one field. */
export function usedFields(planet: PlanetState): number {
  let used = 0;
  for (const id of BUILDING_IDS) used += planet.buildings[id];
  return used;
}

export function clonePlanet(planet: PlanetState): PlanetState {
  return {
    ...planet,
    buildings: { ...planet.buildings },
    productionPct: { ...planet.productionPct },
    buildQueue: planet.buildQueue.map((order) => ({ ...order, paid: { ...order.paid } })),
  };
}
