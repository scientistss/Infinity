import type { Coordinates } from "./galaxy";
import balance from "../data/balance.json";
import { BUILDING_IDS, PRODUCTION_IDS, type BuildingId, type ProductionBuildingId } from "../data/buildings";
import { big, type BigNumber } from "./decimal";
import type { ResourceAmounts } from "./types";
import { emptyUnits, type UnitId } from "../data/units";
import type { ShipyardOrder } from "./shipyard";
import type { PaidJobIdentity } from "./order-state";

export type OrderSource = "manual" | "protocol" | "plan";

/** One build-queue entry. Index 0 of the queue is the order under construction. */
export interface BuildOrder extends PaidJobIdentity {
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
 * Local state of one world; empire-wide systems stay in GameState.
 */
export interface PlanetState {
  id: string;
  coordinates: Coordinates;
  resources: ResourceAmounts;
  name: string;
  /** Max temperature in °C. Drives deuterium output. */
  tempMax: number;
  fieldsMax: number;
  buildings: Record<BuildingId, number>;
  /** 0–100 in steps of 10. */
  productionPct: Record<ProductionBuildingId, number>;
  buildQueue: BuildOrder[];
  /** Ships and defenses standing on the planet (P3). Whole numbers. */
  units: Record<UnitId, number>;
  /** Shipyard batches; index 0 is being built (P3). */
  shipyardQueue: ShipyardOrder[];
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

export const HOMEWORLD_ID = "homeworld";
/** Empty local inventory; the new-game factory alone grants starting stock. */
export function createPlanet(id = HOMEWORLD_ID, coordinates: Coordinates = {galaxy:1,system:50,position:8}): PlanetState {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("星球 ID 无效");
  return {
    id,
    coordinates: { ...coordinates },
    resources: { metal: big(0), crystal: big(0), deuterium: big(0) },
    name: HOMEWORLD.name,
    tempMax: HOMEWORLD.tempMax,
    fieldsMax: HOMEWORLD.fields,
    buildings: emptyBuildings(),
    productionPct: fullProduction(),
    buildQueue: [],
    units: emptyUnits(),
    shipyardQueue: [],
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
    coordinates: { ...planet.coordinates },
    resources: { ...planet.resources },
    buildings: { ...planet.buildings },
    productionPct: { ...planet.productionPct },
    buildQueue: planet.buildQueue.map((order) => ({ ...order, paid: { ...order.paid } })),
    units: { ...planet.units },
    shipyardQueue: planet.shipyardQueue.map((order) => ({ ...order, paidPerUnit: { ...order.paidPerUnit } })),
  };
}
