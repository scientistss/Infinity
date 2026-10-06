/**
 * OGame community formulas (design doc §5.2–§5.4, appendix A). Pure functions, no state.
 * Hourly values are at universe speed 1; use {@link perSecond} / {@link buildSeconds} to apply S.
 */
import balance from "../data/balance.json";
import type { BuildingDef } from "../data/buildings";
import type { ResearchDef } from "../data/research";
import { big, type BigNumber } from "./decimal";

export interface ResourceCost {
  metal: BigNumber;
  crystal: BigNumber;
  deuterium: BigNumber;
}

export const ECONOMY_SPEED = balance.universe.economySpeed;
export const MIN_BUILD_SECONDS = balance.universe.minBuildSeconds;
export const BASE_PRODUCTION = balance.universe.baseProduction;
/** Research speed (design doc §3.1); equal to S by default, kept separate for tuning. */
export const RESEARCH_SPEED = balance.universe.researchSpeed;
/** Lowest cost factor after curvature "growth cut". */
export const MIN_COST_FACTOR = 1.01;

/** Cost factor after the curvature growth cut, floored at 1.01. */
export function effectiveFactor(def: BuildingDef, growthCut = 0): number {
  return Math.max(MIN_COST_FACTOR, def.factor - growthCut);
}

function scaledFloor(base: number, factor: number, power: number, roundTo = 0): BigNumber {
  if (base <= 0) return big(0);
  const plain = base * Math.pow(factor, power);
  if (roundTo > 0 && Number.isFinite(plain) && plain < 1e15) return big(Math.round(plain / roundTo) * roundTo);
  if (Number.isFinite(plain) && plain < 1e15) {
    // Tiny relative nudge so exact products such as 1000·2^n never floor to n−1 on a rounding error.
    return big(Math.floor(plain * (1 + 1e-12)));
  }
  return big(base).mul(big(factor).pow(power)).floor();
}

/** Cost of upgrading to `level` (the target level, ≥ 1): ⌊base × factor^(L−1)⌋ per resource. */
export function buildingCost(def: BuildingDef, level: number, growthCut = 0): ResourceCost {
  const factor = effectiveFactor(def, growthCut);
  const power = Math.max(0, level - 1);
  return {
    metal: scaledFloor(def.baseCost.metal, factor, power),
    crystal: scaledFloor(def.baseCost.crystal, factor, power),
    deuterium: scaledFloor(def.baseCost.deuterium, factor, power),
  };
}

/** Total spent to raise a building from 0 to `level`. */
export function cumulativeCost(def: BuildingDef, level: number, growthCut = 0): ResourceCost {
  const total: ResourceCost = { metal: big(0), crystal: big(0), deuterium: big(0) };
  for (let target = 1; target <= level; target += 1) {
    const step = buildingCost(def, target, growthCut);
    total.metal = total.metal.add(step.metal);
    total.crystal = total.crystal.add(step.crystal);
    total.deuterium = total.deuterium.add(step.deuterium);
  }
  return total;
}

/** Build hours at speed 1: (M + C) / (2500 × max(4 − L/2, 1) × (1 + R) × 2^N). */
export function buildHours(cost: ResourceCost, level: number, def: BuildingDef, robotics: number, nanite: number): number {
  const early = def.earlyLevelSpeedup ? Math.max(4 - level / 2, 1) : 1;
  const spend = cost.metal.add(cost.crystal).toNumber();
  return spend / (2500 * early * (1 + Math.max(0, robotics)) * Math.pow(2, Math.max(0, nanite)));
}

/** Build seconds at universe speed `speed`, never below the minimum build time. */
export function buildSeconds(
  cost: ResourceCost,
  level: number,
  def: BuildingDef,
  robotics: number,
  nanite: number,
  speed: number = ECONOMY_SPEED,
  minSeconds: number = MIN_BUILD_SECONDS,
): number {
  const seconds = (buildHours(cost, level, def, robotics, nanite) * 3600) / speed;
  return Math.max(minSeconds, seconds);
}

/** Research cost at the target level: ⌊base × factor^(L−1)⌋ (astrophysics rounds to 100, as in OGame). */
export function researchCost(def: ResearchDef, level: number): ResourceCost {
  const power = Math.max(0, level - 1);
  const round = def.roundTo ?? 0;
  return {
    metal: scaledFloor(def.baseCost.metal, def.factor, power, round),
    crystal: scaledFloor(def.baseCost.crystal, def.factor, power, round),
    deuterium: scaledFloor(def.baseCost.deuterium, def.factor, power, round),
  };
}

/** Energy supply a research level requires (graviton). Not consumed. */
export function researchEnergyRequirement(def: ResearchDef, level: number): number {
  if (def.baseCost.energy <= 0) return 0;
  return Math.floor(def.baseCost.energy * Math.pow(def.factor, Math.max(0, level - 1)));
}

/** Research hours at speed 1: (M + C) / (1000 × (1 + lab level)). */
export function researchHours(cost: ResourceCost, labLevel: number): number {
  const spend = cost.metal.add(cost.crystal).toNumber();
  return spend / (1000 * (1 + Math.max(0, labLevel)));
}

export function researchSeconds(
  cost: ResourceCost,
  labLevel: number,
  speed: number = RESEARCH_SPEED,
  minSeconds: number = MIN_BUILD_SECONDS,
): number {
  return Math.max(minSeconds, (researchHours(cost, labLevel) * 3600) / speed);
}

const growth = (level: number): number => level * Math.pow(1.1, level);

/** Mine output per hour at 100% and full energy. Metal 30·L·1.1^L, crystal 20·L·1.1^L, deuterium 10·L·1.1^L·(1.44 − 0.004·T). */
export function mineOutputPerHour(id: string, level: number, tempMax: number): number {
  if (level <= 0) return 0;
  if (id === "metal_mine") return 30 * growth(level);
  if (id === "crystal_mine") return 20 * growth(level);
  if (id === "deuterium_synth") return 10 * growth(level) * (1.44 - 0.004 * tempMax);
  return 0;
}

/** Energy drawn at 100%: metal and crystal mines 10·L·1.1^L, deuterium synthesizer 20·L·1.1^L. */
export function energyUsePerHour(id: string, level: number): number {
  if (level <= 0) return 0;
  if (id === "metal_mine" || id === "crystal_mine") return 10 * growth(level);
  if (id === "deuterium_synth") return 20 * growth(level);
  return 0;
}

export function solarOutputPerHour(level: number): number {
  return level <= 0 ? 0 : 20 * growth(level);
}

export function fusionOutputPerHour(level: number, energyTech = 0): number {
  return level <= 0 ? 0 : 30 * level * Math.pow(1.05 + 0.01 * energyTech, level);
}

export function fusionDeutPerHour(level: number): number {
  return level <= 0 ? 0 : 10 * growth(level);
}

/** Storage cap: 5000 × ⌊2.5 × e^(20·L/33)⌋. Level 0 = 10,000. */
export function storageCapacity(level: number): number {
  return balance.storage.base * Math.floor(balance.storage.k * Math.exp((20 * Math.max(0, level)) / 33));
}

export function perSecond(perHour: number, speed: number = ECONOMY_SPEED): number {
  return (perHour * speed) / 3600;
}
