import type { ResourceId } from "./types";

/** Read-only production baseline. No spending or mutable NPC wallets are supported. */
export const NPC_ECONOMY_MODEL = "fixed-production-v1";
export const MAX_NPC_ECONOMY_SECONDS = 11_900;
export type NpcResourceAmounts = Readonly<Record<ResourceId, number>>;

export const NPC_ECONOMY_INITIAL_STOCK: NpcResourceAmounts = Object.freeze({ metal: 500, crystal: 250, deuterium: 0 });
export const NPC_ECONOMY_PRODUCTION_PER_SECOND: NpcResourceAmounts = Object.freeze({ metal: 5, crystal: 2.5, deuterium: 1 });
export const NPC_ECONOMY_CAPACITY: NpcResourceAmounts = Object.freeze({ metal: 50_000, crystal: 30_000, deuterium: 10_000 });

/** One global, bounded age; callers must advance it once per adopted game-time segment. */
export interface NpcEconomyState {
  readonly model: typeof NPC_ECONOMY_MODEL;
  readonly elapsedSeconds: number;
}

export interface NpcEconomySnapshot extends NpcEconomyState {
  readonly resources: NpcResourceAmounts;
  readonly capacity: NpcResourceAmounts;
  /** Fixed rates, including for full stores. `full` identifies paused production. */
  readonly productionPerSecond: NpcResourceAmounts;
  /** Cumulative actual production admitted to storage; excludes initial assets and overflow. */
  readonly produced: NpcResourceAmounts;
  readonly full: Readonly<Record<ResourceId, boolean>>;
}

export function createNpcEconomyState(): NpcEconomyState {
  return Object.freeze({ model: NPC_ECONOMY_MODEL, elapsedSeconds: 0 });
}

/**
 * Exactly two own data fields on a plain object; null prototypes are allowed.
 * Accessors and extra keys are rejected. Negative zero is accepted as numeric zero.
 * This checks only the standalone domain object, not a save envelope or its location.
 */
export function isNpcEconomyState(value: unknown): value is NpcEconomyState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("model") || !keys.includes("elapsedSeconds")) return false;
  const model = Object.getOwnPropertyDescriptor(value, "model");
  const elapsed = Object.getOwnPropertyDescriptor(value, "elapsedSeconds");
  if (!model || !("value" in model) || model.value !== NPC_ECONOMY_MODEL
    || !elapsed || !("value" in elapsed)) return false;
  const seconds: unknown = elapsed.value;
  return typeof seconds === "number" && Number.isFinite(seconds)
    && seconds >= 0 && seconds <= MAX_NPC_ECONOMY_SECONDS;
}

function assertNpcEconomyState(state: NpcEconomyState): void {
  if (!isNpcEconomyState(state)) throw new TypeError("Invalid NPC economy state");
}

/**
 * Pure bounded advancement. Invalid states throw; nonpositive/nonfinite or nonnumber
 * steps do not advance time and preserve the original object, including -0.
 * A valid positive step also returns the original object if the age is unchanged.
 * Fractional seconds use native numbers without per-segment rounding; arbitrary
 * decimal partitions can therefore differ by normal floating-point roundoff.
 */
export function advanceNpcEconomy(state: NpcEconomyState, stepSeconds: number): NpcEconomyState {
  assertNpcEconomyState(state);
  if (typeof stepSeconds !== "number" || !Number.isFinite(stepSeconds) || stepSeconds <= 0) return state;
  const elapsedSeconds = Math.min(MAX_NPC_ECONOMY_SECONDS, state.elapsedSeconds + stepSeconds);
  if (elapsedSeconds === state.elapsedSeconds) return state;
  return Object.freeze({ model: NPC_ECONOMY_MODEL, elapsedSeconds });
}

/** A detached, immutable observation. Reading never advances time or grants resources. */
export function npcEconomySnapshot(state: NpcEconomyState): NpcEconomySnapshot {
  assertNpcEconomyState(state);
  const age = state.elapsedSeconds === 0 ? 0 : state.elapsedSeconds;
  const resources: NpcResourceAmounts = Object.freeze({
    metal: Math.min(NPC_ECONOMY_CAPACITY.metal, NPC_ECONOMY_INITIAL_STOCK.metal + NPC_ECONOMY_PRODUCTION_PER_SECOND.metal * age),
    crystal: Math.min(NPC_ECONOMY_CAPACITY.crystal, NPC_ECONOMY_INITIAL_STOCK.crystal + NPC_ECONOMY_PRODUCTION_PER_SECOND.crystal * age),
    deuterium: Math.min(NPC_ECONOMY_CAPACITY.deuterium, NPC_ECONOMY_INITIAL_STOCK.deuterium + NPC_ECONOMY_PRODUCTION_PER_SECOND.deuterium * age),
  });
  return Object.freeze({
    model: NPC_ECONOMY_MODEL,
    elapsedSeconds: age,
    resources,
    capacity: NPC_ECONOMY_CAPACITY,
    productionPerSecond: NPC_ECONOMY_PRODUCTION_PER_SECOND,
    produced: Object.freeze({
      metal: resources.metal - NPC_ECONOMY_INITIAL_STOCK.metal,
      crystal: resources.crystal - NPC_ECONOMY_INITIAL_STOCK.crystal,
      deuterium: resources.deuterium - NPC_ECONOMY_INITIAL_STOCK.deuterium,
    }),
    full: Object.freeze({
      metal: resources.metal === NPC_ECONOMY_CAPACITY.metal,
      crystal: resources.crystal === NPC_ECONOMY_CAPACITY.crystal,
      deuterium: resources.deuterium === NPC_ECONOMY_CAPACITY.deuterium,
    }),
  });
}
