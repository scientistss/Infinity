import { expect } from "vitest";
import { expectedFreshNpcWallet, expectedEmptyNpcBattles, expectedZeroNpcRemainder } from "./npc-wallet-expectations";
import { activePlanet, withPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { createInitialState } from "../src/game/state";
import type { BuildingId, GameState } from "../src/game/types";
import type { ResearchId } from "../src/data/research";

export function stateWith(
  buildings: Partial<Record<BuildingId, number>> = {},
  resources: Partial<Record<"metal" | "crystal" | "deuterium", number>> = {},
): GameState {
  const state = createInitialState();
  activePlanet(state).buildings = { ...activePlanet(state).buildings, ...buildings };
  activePlanet(state).resources = {
    metal: big(resources.metal ?? activePlanet(state).resources.metal.toNumber()),
    crystal: big(resources.crystal ?? activePlanet(state).resources.crystal.toNumber()),
    deuterium: big(resources.deuterium ?? activePlanet(state).resources.deuterium.toNumber()),
  };
  return state;
}

export function rich(state: GameState, amount = 1e12): GameState {
  return { ...withPlanet(state, { resources: { metal: big(amount), crystal: big(amount), deuterium: big(amount) } }) };
}

export function relErr(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}

export function withResearch(state: GameState, levels: Partial<Record<ResearchId, number>>): GameState {
  return { ...state, research: { ...state.research, levels: { ...state.research.levels, ...levels } } };
}

/** Validate every added tail before dropping any field from an old-world comparison. */
export function stripVerifiedNpcRemainders(state: any): void {
  expect(Array.isArray(state.planets)).toBe(true);
  for (const planet of state.planets) {
    const descriptor = Object.getOwnPropertyDescriptor(planet, "npcResourceRemainder");
    expect(descriptor && "value" in descriptor && descriptor.enumerable).toBe(true);
    expect(Reflect.ownKeys(planet.npcResourceRemainder).sort()).toEqual(["crystal", "deuterium", "metal"]);
    expect(planet.npcResourceRemainder).toEqual(expectedZeroNpcRemainder());
  }
  for (const planet of state.planets) delete planet.npcResourceRemainder;
}

/** Assert every r14-only slot before any old-schema projection removes it. */
function assertVerifiedNullNpcScoutSnapshots(state: any): void {
  expect(Array.isArray(state.messages)).toBe(true);
  for (const message of state.messages) {
    const descriptor = Object.getOwnPropertyDescriptor(message, "npcScoutSnapshot");
    expect(descriptor && "value" in descriptor && descriptor.enumerable).toBe(true);
    expect(descriptor!.value).toBeNull();
  }
}

/** Remove only explicit null slots, never real or malformed historical snapshots. */
export function stripVerifiedNullNpcScoutSnapshots(state: any): void {
  assertVerifiedNullNpcScoutSnapshots(state);
  for (const message of state.messages) delete message.npcScoutSnapshot;
}

/** Remove only independently verified r13 metadata and null r14 slots from an explicit old-schema projection. */
export function stripVerifiedNpcMetadata(state: any, expectedElapsedSeconds: number): void {
  expect(Object.hasOwn(state, "npcEconomy")).toBe(true);
  expect(Object.hasOwn(state, "npcBattles")).toBe(true);
  expect(Reflect.ownKeys(state.npcEconomy).sort()).toEqual(["baseline", "model", "now", "sites"]);
  expect(state.npcEconomy).toEqual(expectedFreshNpcWallet(expectedElapsedSeconds));
  expect(Reflect.ownKeys(state.npcBattles).sort()).toEqual(["model", "reports"]);
  expect(state.npcBattles).toEqual(expectedEmptyNpcBattles());
  // Every assertion precedes any deletion, so a failed projection is atomic.
  assertVerifiedNullNpcScoutSnapshots(state);
  stripVerifiedNpcRemainders(state);
  stripVerifiedNullNpcScoutSnapshots(state);
  delete state.npcEconomy;
  delete state.npcBattles;
}

/** Deliberate synthetic legacy-schema input, never evidence of a historical export. */
export function stripSyntheticTerraformerMetadata(state: any, expectedNpcAge: number): void {
  stripVerifiedNpcMetadata(state, expectedNpcAge);
  // These older feature tests have no earned r10 rewards to erase.
  expect(Number.isSafeInteger(state.terraformerGrantJobFloor)).toBe(true);
  for (const planet of state.planets) {
    expect(planet.terraformerFields).toEqual({ base: planet.fieldsMax, grantedLevels: 0 });
    expect(Object.hasOwn(planet, "demolition")).toBe(true);
    expect(planet.demolition).toBeNull();
    delete planet.demolition;
    delete planet.terraformerFields;
  }
  delete state.terraformerGrantJobFloor;
}

/** Validate the entire additive r10 ledger before comparing prior-schema fields. */
export function expectTerraformerMigration<T extends { terraformerGrantJobFloor: number;
  planets: Array<{ id: string; fieldsMax: number; terraformerFields: { base: number; grantedLevels: number } }> }>(
  actual: T, historical: any, expectedNpcAge: number,
): T {
  // Pre-r5 identities are independently assigned in planet/build/ship/research order.
  const floor = historical.orders?.nextJobId ?? 1 + historical.planets.reduce((sum: number, planet: any) =>
    sum + planet.buildQueue.length + planet.shipyardQueue.length, 0) + historical.research.queue.length;
  expect(actual.terraformerGrantJobFloor).toBe(floor);
  expect(actual.planets.map(planet => planet.id)).toEqual(historical.planets.map((planet: any) => planet.id));
  for (let index = 0; index < actual.planets.length; index++) {
    expect(actual.planets[index]!.terraformerFields).toEqual({ base: historical.planets[index].fieldsMax, grantedLevels: 0 });
    expect(actual.planets[index]!.fieldsMax).toBe(historical.planets[index].fieldsMax);
  }
  const prior = structuredClone(actual);
  stripSyntheticTerraformerMetadata(prior, expectedNpcAge);
  return prior;
}
