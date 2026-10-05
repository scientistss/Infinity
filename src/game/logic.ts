import { evaluateLoadout, hasRunnableProtocol, refreshUnlocks } from "../automation/engine";
import { achievementFactor, ACHIEVEMENTS } from "../data/achievements";
import {
  CORE_BONUS_PER_CORE,
  MANUAL_METAL_PER_CLICK,
  OFFLINE_PROTOCOL_SECONDS,
  PRESTIGE_SCORE_UNIT,
  PRODUCERS,
  SCORE_WEIGHTS,
  producerById,
  type ProducerDef,
} from "./content";
import {
  affordableCount,
  big,
  bigFloor,
  bigMin,
  bigSqrt,
  seriesCost,
  type BigNumber,
} from "./decimal";
import { createInitialState } from "./state";
import { RESOURCE_IDS, type GameState, type ProducerId, type ResourceId } from "./types";

export type BuyMode = 1 | 10 | "max";
export type TickMode = "live" | "offline";

const LIVE_PROTOCOL_SECONDS = 1;

export interface EnergyReport {
  supply: BigNumber;
  demand: BigNumber;
  efficiency: BigNumber;
  shortage: BigNumber;
}

/**
 * Advance the simulation by `dtSeconds`.
 * Live play evaluates armed protocol cards about once per second.
 * Offline catch-up evaluates them on the balance interval (60s).
 * Pure: the input state is not mutated.
 */
export function tick(state: GameState, dtSeconds: number, mode: TickMode = "live"): GameState {
  const ready = applyAchievementUnlocks(state);
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return ready;
  const period = mode === "offline" ? OFFLINE_PROTOCOL_SECONDS : LIVE_PROTOCOL_SECONDS;
  if (!hasRunnableProtocol(ready)) {
    return applyAchievementUnlocks(refreshUnlocks(markEnergyShortage(produce(ready, dtSeconds))));
  }

  let current = ready;
  let remaining = dtSeconds;
  let guard = 0;
  const limit = Math.ceil(dtSeconds / period) + 2;
  while (remaining > 1e-6 && guard < limit) {
    guard += 1;
    const accrued = current.protocols.accumulator;
    if (accrued >= period) {
      current = evaluateLoadout(current, period);
      current = setAccumulator(current, 0);
      continue;
    }
    const step = Math.min(remaining, period - accrued);
    current = produce(current, step);
    const accruedNext = accrued + step;
    remaining -= step;
    if (accruedNext >= period - 1e-8) current = evaluateLoadout(setAccumulator(current, 0), period);
    else current = setAccumulator(current, accruedNext);
  }
  return applyAchievementUnlocks(refreshUnlocks(markEnergyShortage(current)));
}

/** Record an energy shortage, then append any newly met achievements. Already unlocked stays unlocked. */
export function applyAchievementUnlocks(state: GameState): GameState {
  const marked = markEnergyShortage(state);
  const owned = new Set(marked.unlocked);
  let added = false;
  for (const def of ACHIEVEMENTS) {
    if (owned.has(def.id)) continue;
    if (def.met(marked)) {
      owned.add(def.id);
      added = true;
    }
  }
  if (!added && marked === state) return state;
  return {
    ...marked,
    unlocked: ACHIEVEMENTS.filter((def) => owned.has(def.id)).map((def) => def.id),
  };
}

function produce(state: GameState, dtSeconds: number): GameState {
  const resources = { ...state.resources };
  const lifetime = { ...state.lifetime };
  for (const id of RESOURCE_IDS) {
    const gain = productionPerSecond(state, id).mul(dtSeconds);
    resources[id] = resources[id].add(gain);
    lifetime[id] = lifetime[id].add(gain);
  }
  return { ...state, resources, lifetime, totalTime: state.totalTime.add(dtSeconds) };
}

function setAccumulator(state: GameState, accumulator: number): GameState {
  return { ...state, protocols: { ...state.protocols, accumulator } };
}

/** Unspent warp cores, robotics factories, and +1% per achievement. Does not include energy efficiency. */
export function globalMultiplier(state: GameState): BigNumber {
  let mult = big(1).add(state.warpCores.mul(CORE_BONUS_PER_CORE));
  for (const producer of PRODUCERS) {
    if (producer.globalProductionMult === 1) continue;
    mult = mult.mul(big(producer.globalProductionMult).pow(state.producers[producer.id]));
  }
  return mult.mul(achievementFactor(state));
}

export function energyReport(state: GameState): EnergyReport {
  let supply = big(0);
  let demand = big(0);
  for (const producer of PRODUCERS) {
    const owned = state.producers[producer.id];
    if (producer.producesEnergy > 0) supply = supply.add(owned.mul(producer.producesEnergy));
    if (producer.consumesEnergy > 0) demand = demand.add(owned.mul(producer.consumesEnergy));
  }
  const efficiency = demand.gt(0) ? bigMin(big(1), supply.div(demand)) : big(1);
  const shortage = demand.gt(supply) ? demand.sub(supply) : big(0);
  return { supply, demand, efficiency, shortage };
}

/** Resource output scale: global multiplier × energy efficiency. */
export function resourceMultiplier(state: GameState): BigNumber {
  return globalMultiplier(state).mul(energyReport(state).efficiency);
}

export function markEnergyShortage(state: GameState): GameState {
  if (state.seenEnergyShortage && state.stats.seenEnergyShort) return state;
  const short = state.seenEnergyShortage || energyReport(state).efficiency.lt(1);
  if (!short) return state;
  return {
    ...state,
    seenEnergyShortage: true,
    stats: { ...state.stats, seenEnergyShort: true },
  };
}

export function productionPerSecond(state: GameState, id: ResourceId): BigNumber {
  let rate = big(0);
  for (const producer of PRODUCERS) {
    const each = producer.rates[id];
    if (each === 0) continue;
    rate = rate.add(state.producers[producer.id].mul(each));
  }
  return rate.mul(resourceMultiplier(state));
}

export function expansionScore(state: GameState): BigNumber {
  return state.lifetime.metal
    .mul(SCORE_WEIGHTS.metal)
    .add(state.lifetime.crystal.mul(SCORE_WEIGHTS.crystal))
    .add(state.lifetime.deuterium.mul(SCORE_WEIGHTS.deuterium));
}

/** Warp cores granted by launching a colony ship from this run. */
export function warpGain(state: GameState): BigNumber {
  const score = expansionScore(state);
  if (score.lt(PRESTIGE_SCORE_UNIT)) return big(0);
  return bigFloor(bigSqrt(score.div(PRESTIGE_SCORE_UNIT)));
}

/**
 * Launch the colony ship. Resets the surface and banks warp cores.
 * Protocol cards, unlocks, achievements, and manual-click progress stay.
 * Returns the same state when the gain would be zero.
 */
export function prestige(state: GameState): GameState {
  const gain = warpGain(state);
  if (gain.lt(1)) return state;
  const next = createInitialState();
  next.warpCores = state.warpCores.add(gain);
  next.totalTime = state.totalTime;
  next.manualClicks = state.manualClicks;
  next.seenEnergyShortage = state.seenEnergyShortage;
  next.hasPrestiged = true;
  next.unlockedCards = state.unlockedCards.slice();
  next.unlocked = state.unlocked.slice();
  next.offlineBonusHours = state.offlineBonusHours;
  next.stats = {
    scrapes: state.stats.scrapes,
    launches: state.stats.launches + 1,
    seenEnergyShort: state.stats.seenEnergyShort,
    manualActions: 0,
    automatedLaunches: state.stats.automatedLaunches + (state.stats.manualActions === 0 ? 1 : 0),
  };
  next.protocols = {
    accumulator: 0,
    slots: state.protocols.slots.map((slot) => ({
      ...slot,
      card: slot.card ? structuredClone(slot.card) : null,
    })),
  };
  return applyAchievementUnlocks(refreshUnlocks(next));
}

/** Manual collect. Counts toward the auto-collect unlock. Auto-collect does not call this. */
export function scrape(state: GameState): GameState {
  const gain = big(MANUAL_METAL_PER_CLICK);
  return applyAchievementUnlocks(
    refreshUnlocks({
      ...state,
      manualClicks: state.manualClicks + 1,
      resources: { ...state.resources, metal: state.resources.metal.add(gain) },
      lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(gain) },
      stats: {
        ...state.stats,
        scrapes: state.stats.scrapes + 1,
        manualActions: state.stats.manualActions + 1,
      },
    }),
  );
}

export function isProducerUnlocked(state: GameState, id: ProducerId): boolean {
  const unlock = producerById(id).unlock;
  if (unlock.kind === "start") return true;
  if (unlock.kind === "ownedGte") return state.producers[unlock.producer].gte(unlock.value);
  return state.lifetime[unlock.res].gte(unlock.value);
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

export function buy(state: GameState, id: ProducerId, mode: BuyMode, manual = true): GameState {
  if (!isProducerUnlocked(state, id)) return state;
  const affordable = maxBuyCount(state, id);
  const qty = mode === "max" ? affordable : affordable.gte(mode) ? big(mode) : big(0);
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

  const bought = markEnergyShortage({
    ...state,
    resources,
    producers: { ...state.producers, [id]: owned.add(qty) },
    stats: manual
      ? { ...state.stats, manualActions: state.stats.manualActions + 1 }
      : state.stats,
  });
  return applyAchievementUnlocks(refreshUnlocks(bought));
}

function emptyCosts(): Record<ResourceId, BigNumber> {
  return { metal: big(0), crystal: big(0), deuterium: big(0) };
}
