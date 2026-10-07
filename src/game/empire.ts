import type { GameState, PlanetState, ResourceAmounts } from "./types";

/** Canonical lookup. A corrupt active id is an error, never an implicit homeworld fallback. */
export function activePlanet(state: GameState): PlanetState {
  const planet = state.planets.find(p => p.id === state.activePlanetId);
  if (!planet) throw new Error("当前星球不存在");
  return planet;
}

/** Immutable local update; refuse a replacement belonging to a different world. */
export function withPlanet(state: GameState, patch: { planet?: PlanetState; resources?: ResourceAmounts }): GameState {
  const current = activePlanet(state);
  const planet = patch.planet ?? current;
  if (planet.id !== current.id) throw new Error("星球更新目标不一致");
  const next = patch.resources ? { ...planet, resources: patch.resources } : planet;
  return { ...state, planets: state.planets.map(p => p.id === current.id ? next : p) };
}

export function selectPlanet(state: GameState, id: string): GameState {
  if (id === state.activePlanetId || !state.planets.some(p => p.id === id)) return state;
  return { ...state, activePlanetId: id };
}

/** Run a local rule without changing the player's selection. Reset rules may remove that selection. */
export function onPlanet(state: GameState, id: string, run: (local: GameState) => GameState): GameState {
  if (!state.planets.some(p => p.id === id)) throw new Error("星球不存在");
  return selectPlanet(run(selectPlanet(state, id)), state.activePlanetId);
}

export function empireResources(state: GameState): ResourceAmounts {
  const first = state.planets[0];
  if (!first) throw new Error("帝国必须至少有一颗星球");
  return state.planets.slice(1).reduce((sum,p) => ({
    metal: sum.metal.add(p.resources.metal),
    crystal: sum.crystal.add(p.resources.crystal),
    deuterium: sum.deuterium.add(p.resources.deuterium),
  }), { ...first.resources });
}
