/**
 * Planet economy at one instant (design doc §5.2–§5.3). Rates are constant between events,
 * which is what lets tick() integrate exactly (§5.10).
 */
import { achievementFactor } from "../data/achievements";
import { PRODUCTION_IDS, type ProductionBuildingId } from "../data/buildings";
import { PLASMA_BONUS } from "../data/research";
import { outputScale, passiveCoreBonus } from "../prestige/tree";
import { MANUAL_MIN_METAL } from "./content";
import { big, type BigNumber } from "./decimal";
import {
  BASE_PRODUCTION,
  ECONOMY_SPEED,
  energyUsePerHour,
  fusionDeutPerHour,
  fusionOutputPerHour,
  mineOutputPerHour,
  perSecond,
  solarOutputPerHour,
  storageCapacity,
} from "./formulas";
import type { PlanetState } from "./planet";
import { RESOURCE_IDS, type GameState, type ResourceId } from "./types";

export type ResourceRates = Record<ResourceId, number>;

export interface EconomySnapshot {
  /** Energy supply / demand (OGame energy units, not per second). */
  supply: number;
  demand: number;
  efficiency: number;
  /** 1 normally; < 1 when deuterium is empty and fusion burns faster than it is made. */
  fusionFactor: number;
  /** (1 + 2% × unspent cores) × (1 + 1% × achievements) × output double. */
  global: number;
  caps: ResourceRates;
  /** Production per second if storage allowed it (after energy and global multipliers). */
  gross: ResourceRates;
  /** Consumption per second actually burned (fusion deuterium). */
  consumption: ResourceRates;
  /** Stock change per second in the current regime (full storage, empty deuterium). */
  net: ResourceRates;
  /** Mines stopped because the resource is at or above its cap. */
  stopped: Record<ResourceId, boolean>;
}

export function pctOf(planet: PlanetState, id: ProductionBuildingId): number {
  return Math.min(100, Math.max(0, planet.productionPct[id] ?? 100)) / 100;
}

export function globalMultiplier(state: GameState): number {
  return (1 + passiveCoreBonus(state).toNumber()) * achievementFactor(state).toNumber() * outputScale(state);
}

export function storageCaps(state: GameState): ResourceRates {
  const b = state.planet.buildings;
  return {
    metal: storageCapacity(b.metal_storage),
    crystal: storageCapacity(b.crystal_storage),
    deuterium: storageCapacity(b.deuterium_tank),
  };
}

/** Energy demand of the three mines at their production settings. */
export function energyDemand(planet: PlanetState): number {
  const b = planet.buildings;
  return (
    energyUsePerHour("metal_mine", b.metal_mine) * pctOf(planet, "metal_mine") +
    energyUsePerHour("crystal_mine", b.crystal_mine) * pctOf(planet, "crystal_mine") +
    energyUsePerHour("deuterium_synth", b.deuterium_synth) * pctOf(planet, "deuterium_synth")
  );
}

interface Flow {
  supply: number;
  demand: number;
  efficiency: number;
  gross: ResourceRates;
  fusionBurn: number;
}

function flow(state: GameState, fusionFactor: number, global: number): Flow {
  const planet = state.planet;
  const b = planet.buildings;
  const doubled = outputScale(state);
  const tech = state.research.levels;
  const supply =
    (solarOutputPerHour(b.solar_plant) * pctOf(planet, "solar_plant") +
      fusionOutputPerHour(b.fusion_reactor, tech.energy_tech) * pctOf(planet, "fusion_reactor") * fusionFactor) *
    doubled;
  const demand = energyDemand(planet);
  const efficiency = demand > 0 ? Math.min(1, supply / demand) : 1;
  const plasma = {
    metal_mine: 1 + PLASMA_BONUS.metal * tech.plasma_tech,
    crystal_mine: 1 + PLASMA_BONUS.crystal * tech.plasma_tech,
    deuterium_synth: 1 + PLASMA_BONUS.deuterium * tech.plasma_tech,
  };
  // Plasma technology scales mine output only, not the planet's base production (OGame).
  const mine = (id: "metal_mine" | "crystal_mine" | "deuterium_synth") =>
    mineOutputPerHour(id, b[id], planet.tempMax) * pctOf(planet, id) * efficiency * plasma[id];
  const gross: ResourceRates = {
    metal: perSecond(BASE_PRODUCTION.metal + mine("metal_mine"), ECONOMY_SPEED) * global,
    crystal: perSecond(BASE_PRODUCTION.crystal + mine("crystal_mine"), ECONOMY_SPEED) * global,
    deuterium: perSecond(mine("deuterium_synth"), ECONOMY_SPEED) * global,
  };
  const fusionBurn = perSecond(fusionDeutPerHour(b.fusion_reactor) * pctOf(planet, "fusion_reactor"), ECONOMY_SPEED);
  return { supply, demand, efficiency, gross, fusionBurn };
}

/**
 * Full economy for the current state. When deuterium is empty and fusion would burn more than the
 * synthesizers make, fusion is derated to the largest factor f with production(f) ≥ burn(f) (§5.2).
 */
export function economy(state: GameState): EconomySnapshot {
  const global = globalMultiplier(state);
  const caps = storageCaps(state);
  const stock = state.resources;

  let fusionFactor = 1;
  let current = flow(state, 1, global);
  let derated = false;
  if (current.fusionBurn > 0 && stock.deuterium.lte(0) && current.gross.deuterium < current.fusionBurn) {
    derated = true;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      const probe = flow(state, mid, global);
      if (probe.gross.deuterium >= probe.fusionBurn * mid) lo = mid;
      else hi = mid;
    }
    fusionFactor = lo;
    current = flow(state, fusionFactor, global);
  }

  const consumption: ResourceRates = { metal: 0, crystal: 0, deuterium: current.fusionBurn * fusionFactor };
  const net = { metal: 0, crystal: 0, deuterium: 0 } as ResourceRates;
  const stopped = { metal: false, crystal: false, deuterium: false } as Record<ResourceId, boolean>;
  for (const id of RESOURCE_IDS) {
    const gross = current.gross[id];
    const use = consumption[id];
    const cap = big(caps[id]);
    if (stock[id].gt(cap)) {
      stopped[id] = gross > 0;
      net[id] = -use;
    } else if (stock[id].eq(cap)) {
      stopped[id] = gross > 0;
      net[id] = Math.min(0, gross - use);
    } else {
      net[id] = gross - use;
    }
  }
  // Derated fusion burns exactly what is produced; force 0 so float noise cannot spin events.
  if (derated) net.deuterium = 0;

  return {
    supply: current.supply,
    demand: current.demand,
    efficiency: current.efficiency,
    fusionFactor,
    global,
    caps,
    gross: current.gross,
    consumption,
    net,
    stopped,
  };
}

export interface EnergyReport {
  supply: BigNumber;
  demand: BigNumber;
  efficiency: BigNumber;
  shortage: BigNumber;
}

export function energyReport(state: GameState): EnergyReport {
  const eco = economy(state);
  return {
    supply: big(eco.supply),
    demand: big(eco.demand),
    efficiency: big(eco.efficiency),
    shortage: big(Math.max(0, eco.demand - eco.supply)),
  };
}

/** Net stock change per second right now (0 for a mine stopped by full storage). */
export function productionPerSecond(state: GameState, id: ResourceId): BigNumber {
  return big(economy(state).net[id]);
}

export function isProductionBuilding(id: string): id is ProductionBuildingId {
  return (PRODUCTION_IDS as readonly string[]).includes(id);
}

/** One collect click before curvature: max(10, one second of gross metal output). */
export function baseCollectAmount(state: GameState): number {
  return Math.max(MANUAL_MIN_METAL, economy(state).gross.metal);
}
