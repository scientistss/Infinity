/** Timed resource boosters (dark matter shop, ring machine supply box). Kept free of economy imports. */
import type { GameState, ResourceId } from "./types";

export interface Booster {
  res: ResourceId;
  /** Percent added to mine output. */
  pct: number;
  /** Game time (state.totalTime seconds) when it ends. */
  until: number;
}

export function activeBooster(state: GameState, res: ResourceId): Booster | null {
  const found = state.boosters.find((booster) => booster.res === res);
  if (!found) return null;
  return found.until > state.totalTime.toNumber() + 1e-9 ? found : null;
}

/** Mine output multiplier from resource boosters. */
export function boosterFactor(state: GameState, res: ResourceId): number {
  const booster = activeBooster(state, res);
  return booster ? 1 + booster.pct / 100 : 1;
}

/** Seconds until the next booster ends (tick boundary), or Infinity. */
export function nextBoosterExpiry(state: GameState): number {
  const now = state.totalTime.toNumber();
  let soonest = Number.POSITIVE_INFINITY;
  for (const booster of state.boosters) {
    if (booster.until > now) soonest = Math.min(soonest, booster.until - now);
  }
  return soonest;
}

export function pruneBoosters(state: GameState): GameState {
  const now = state.totalTime.toNumber() + 1e-9;
  if (state.boosters.every((booster) => booster.until > now)) return state;
  return { ...state, boosters: state.boosters.filter((booster) => booster.until > now) };
}
