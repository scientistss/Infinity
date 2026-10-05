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
  PASSIVE_RATES,
  PRESTIGE_SCORE_UNIT,
  PRODUCERS,
  producerById,
  type ProducerDef,
} from "./content";
import { createInitialState } from "./state";
import { RESOURCE_IDS, type GameState, type ProducerId, type ResourceId } from "./types";

export type BuyMode = "one" | "max";

/**
 * Advance the simulation by `dtSeconds`.
 * Pure: the input state is not mutated. Production is linear in dt, so a
 * single call can cover a frame or a capped offline gap.
 */
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

/** Global output multiplier from the placeholder sqrt prestige layer. */
export function outputMultiplier(state: GameState): BigNumber {
  return big(1).add(bigSqrt(state.telemetry));
}

/** Current per-second gain of one resource, including passive weathering and telemetry. */
export function productionPerSecond(state: GameState, id: ResourceId): BigNumber {
  let rate = big(PASSIVE_RATES[id]);
  for (const producer of PRODUCERS) {
    const each = producer.rates[id];
    if (each === 0) continue;
    rate = rate.add(state.producers[producer.id].mul(each));
  }
  return rate.mul(outputMultiplier(state));
}

export function expansionScore(state: GameState): BigNumber {
  return state.lifetime.metal
    .add(state.lifetime.crystal.mul(5))
    .add(state.lifetime.deuterium.mul(20));
}

/** Telemetry granted by an uplink from this run. Zero when the score is short. */
export function telemetryGain(state: GameState): BigNumber {
  const score = expansionScore(state);
  if (score.lt(PRESTIGE_SCORE_UNIT)) return big(0);
  return bigFloor(bigSqrt(score.div(PRESTIGE_SCORE_UNIT)));
}

/**
 * Placeholder prestige. Resets the planet surface and banks sqrt(score).
 * Returns the same state when the gain would be zero.
 */
export function prestige(state: GameState): GameState {
  const gain = telemetryGain(state);
  if (gain.lt(1)) return state;
  const next = createInitialState();
  next.telemetry = state.telemetry.add(gain);
  next.totalTime = state.totalTime;
  return next;
}

/** Manual surface scrape: +1 metal, counted toward this run's score. */
export function scrape(state: GameState): GameState {
  return {
    ...state,
    resources: { ...state.resources, metal: state.resources.metal.add(1) },
    lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(1) },
  };
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
  const qty = mode === "one" ? bigMin(big(1), affordable) : affordable;
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
