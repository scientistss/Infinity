import {
  affordableCount,
  big,
  bigFloor,
  bigMin,
  bigSqrt,
  seriesCost,
  type BigNumber,
} from "./decimal";
import {
  PRESTIGE_SCORE_UNIT,
  PRODUCERS,
  PROTOCOL_SLOT_CAP,
  ROBOTICS_MULTIPLIER,
  WARP_CORE_BONUS,
  producerById,
  type ProducerDef,
} from "./content";
import { createInitialState } from "./state";
import { RESOURCE_IDS, type GameState, type ProducerId, type ResourceId } from "./types";

export type BuyMode = "one" | "ten" | "max";

/** Pure. Production is linear in dt, so one call can cover a frame or an offline gap. */
export function tick(state: GameState, dtSeconds: number): GameState {
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return state;

  const resources = { ...state.resources };
  const lifetime = { ...state.lifetime };
  for (const id of RESOURCE_IDS) {
    const gain = productionPerSecond(state, id).mul(dtSeconds);
    resources[id] = resources[id].add(gain);
    lifetime[id] = lifetime[id].add(gain);
  }

  return {
    ...state,
    resources,
    lifetime,
    totalTime: state.totalTime.add(dtSeconds),
  };
}

export function isUnlocked(state: GameState, id: ProducerId): boolean {
  return producerById(id).unlock(state);
}

/** (1 + 2% per unspent core) × (1.25 ^ robotics factories). */
export function outputMultiplier(state: GameState): BigNumber {
  const cores = big(1).add(state.warpCores.mul(WARP_CORE_BONUS));
  const robots = big(ROBOTICS_MULTIPLIER).pow(state.producers.robotics_factory);
  return cores.mul(robots);
}

export function energySupply(state: GameState): BigNumber {
  let supply = big(0);
  for (const producer of PRODUCERS) {
    if (producer.energySupply <= 0) continue;
    supply = supply.add(state.producers[producer.id].mul(producer.energySupply));
  }
  return supply;
}

export function energyDemand(state: GameState): BigNumber {
  let demand = big(0);
  for (const producer of PRODUCERS) {
    if (producer.energyCost <= 0) continue;
    demand = demand.add(state.producers[producer.id].mul(producer.energyCost));
  }
  return demand;
}

/** min(1, supply/demand). No demand means full efficiency. */
export function energyEfficiency(state: GameState): BigNumber {
  const demand = energyDemand(state);
  if (demand.lte(0)) return big(1);
  const supply = energySupply(state);
  if (supply.gte(demand)) return big(1);
  return supply.div(demand);
}

export function energyShortage(state: GameState): BigNumber {
  const gap = energyDemand(state).sub(energySupply(state));
  return gap.gt(0) ? gap : big(0);
}

export function productionPerSecond(state: GameState, id: ResourceId): BigNumber {
  let rate = big(0);
  for (const producer of PRODUCERS) {
    const each = producer.rates[id];
    if (each === 0) continue;
    rate = rate.add(state.producers[producer.id].mul(each));
  }
  return rate.mul(outputMultiplier(state)).mul(energyEfficiency(state));
}

export function expansionScore(state: GameState): BigNumber {
  return state.lifetime.metal.add(state.lifetime.crystal.mul(3)).add(state.lifetime.deuterium.mul(10));
}

export function warpGain(state: GameState): BigNumber {
  const score = expansionScore(state);
  if (score.lt(PRESTIGE_SCORE_UNIT)) return big(0);
  return bigFloor(bigSqrt(score.div(PRESTIGE_SCORE_UNIT)));
}

/** Score still needed before the next curvature core. */
export function scoreToNextCore(state: GameState): BigNumber {
  const next = warpGain(state).add(1);
  const target = next.pow(2).mul(PRESTIGE_SCORE_UNIT);
  const gap = target.sub(expansionScore(state));
  return gap.gt(0) ? gap : big(0);
}

/** Launch a colony ship. Keeps cores and play time, and grants the starting solar plant again. */
export function prestige(state: GameState): GameState {
  const gain = warpGain(state);
  if (gain.lt(1)) return state;
  const next = createInitialState();
  next.warpCores = state.warpCores.add(gain);
  next.totalTime = state.totalTime;
  return next;
}

/** Manual mining: +1 metal, counted toward this run. */
export function scrape(state: GameState): GameState {
  return {
    ...state,
    resources: { ...state.resources, metal: state.resources.metal.add(1) },
    lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(1) },
  };
}

export function protocolSlots(state: GameState): BigNumber {
  const slots = big(1).add(state.producers.robotics_factory.div(2).floor());
  return slots.gt(PROTOCOL_SLOT_CAP) ? big(PROTOCOL_SLOT_CAP) : slots;
}

export function nextUnitCost(def: ProducerDef, owned: BigNumber): Record<ResourceId, BigNumber> {
  const costs = emptyCosts();
  for (const id of RESOURCE_IDS) {
    const base = def.costs[id];
    costs[id] = base > 0 ? big(base).mul(big(def.ratio).pow(owned)) : big(0);
  }
  return costs;
}

export function bulkCost(def: ProducerDef, owned: BigNumber, count: BigNumber): Record<ResourceId, BigNumber> {
  const costs = emptyCosts();
  if (count.lte(0)) return costs;
  for (const id of RESOURCE_IDS) {
    const base = def.costs[id];
    costs[id] = base > 0 ? seriesCost(count, base, def.ratio, owned) : big(0);
  }
  return costs;
}

export function canAfford(state: GameState, costs: Record<ResourceId, BigNumber>): boolean {
  return RESOURCE_IDS.every((id) => state.resources[id].gte(costs[id]));
}

export function maxBuyCount(state: GameState, id: ProducerId): BigNumber {
  if (!isUnlocked(state, id)) return big(0);
  const def = producerById(id);
  const owned = state.producers[id];
  let cap: BigNumber | null = null;

  for (const resourceId of RESOURCE_IDS) {
    const base = def.costs[resourceId];
    if (base <= 0) continue;
    const affordable = affordableCount(state.resources[resourceId], base, def.ratio, owned);
    cap = cap === null ? affordable : bigMin(cap, affordable);
  }

  if (cap === null) return big(0);
  let count = bigFloor(cap);
  if (count.lt(0)) count = big(0);

  const fits = (qty: BigNumber): boolean => canAfford(state, bulkCost(def, owned, qty));
  for (let step = 0; step < 6 && fits(count.add(1)); step += 1) count = count.add(1);
  for (let step = 0; step < 6 && count.gt(0) && !fits(count); step += 1) count = count.sub(1);
  return count;
}

export function buy(state: GameState, id: ProducerId, mode: BuyMode): GameState {
  const affordable = maxBuyCount(state, id);
  const requested = mode === "one" ? big(1) : mode === "ten" ? big(10) : affordable;
  const qty = bigMin(requested, affordable);
  if (qty.lt(1)) return state;

  const def = producerById(id);
  const owned = state.producers[id];
  const costs = bulkCost(def, owned, qty);
  if (!canAfford(state, costs)) return state;

  const resources = { ...state.resources };
  for (const resourceId of RESOURCE_IDS) {
    const next = resources[resourceId].sub(costs[resourceId]);
    resources[resourceId] = next.lt(0) ? big(0) : next;
  }

  return {
    ...state,
    resources,
    producers: { ...state.producers, [id]: owned.add(qty) },
  };
}

function emptyCosts(): Record<ResourceId, BigNumber> {
  return { metal: big(0), crystal: big(0), deuterium: big(0) };
}
