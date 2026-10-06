import { big } from "../src/game/decimal";
import { createInitialState } from "../src/game/state";
import type { BuildingId, GameState } from "../src/game/types";

export function stateWith(
  buildings: Partial<Record<BuildingId, number>> = {},
  resources: Partial<Record<"metal" | "crystal" | "deuterium", number>> = {},
): GameState {
  const state = createInitialState();
  state.planet.buildings = { ...state.planet.buildings, ...buildings };
  state.resources = {
    metal: big(resources.metal ?? state.resources.metal.toNumber()),
    crystal: big(resources.crystal ?? state.resources.crystal.toNumber()),
    deuterium: big(resources.deuterium ?? state.resources.deuterium.toNumber()),
  };
  return state;
}

export function rich(state: GameState, amount = 1e12): GameState {
  return { ...state, resources: { metal: big(amount), crystal: big(amount), deuterium: big(amount) } };
}

export function relErr(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}
