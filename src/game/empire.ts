import type { GameState, PlanetState, ResourceAmounts } from "./types";

/** Return the canonical planet, never a second copy of its inventory. */
export function activePlanet(state: GameState): PlanetState {
  const planet = state.planets.find((p) => p.id === state.activePlanetId);
  if (!planet) throw new Error("当前星球不存在");
  return planet;
}

/** Pure adapter for rules that act on one planet. */
export function withPlanet(state: GameState, patch: { planet?: PlanetState; resources?: ResourceAmounts }): GameState {
  const planet = patch.planet ?? activePlanet(state);
  const next = patch.resources ? { ...planet, resources: patch.resources } : planet;
  return { ...state, planets: state.planets.map((p) => p.id === state.activePlanetId ? next : p) };
}

export function selectPlanet(state: GameState, id: string): GameState {
  if (!state.planets.some((p) => p.id === id)) return state;
  return id === state.activePlanetId ? state : { ...state, activePlanetId: id };
}

/** Evaluate a local rule and restore the UI selection. Shared state changes are retained. */
export function onPlanet(state: GameState, id: string, fn: (s: GameState) => GameState): GameState {
  if (!state.planets.some((p) => p.id === id)) throw new Error("星球不存在");
  const result = fn(selectPlanet(state, id));
  return selectPlanet(result, state.activePlanetId);
}
