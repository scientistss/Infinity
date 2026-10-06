import balance from "../data/balance.json";
import type { GameState } from "./types";

export const GALAXY = balance.galaxy;
export interface Coordinates { galaxy: number; system: number; position: number }
export function validCoordinates(c: Coordinates, deepSpace = false): boolean {
  return !!c && Number.isInteger(c.galaxy) && c.galaxy >= 1 && c.galaxy <= GALAXY.galaxies
    && Number.isInteger(c.system) && c.system >= 1 && c.system <= GALAXY.systems
    && Number.isInteger(c.position) && c.position >= 1 && c.position <= (deepSpace ? GALAXY.deepSpacePosition : GALAXY.positions);
}
export function coordinateKey(c: Coordinates): string { return `${c.galaxy}:${c.system}:${c.position}`; }
export function sameCoordinates(a: Coordinates, b: Coordinates): boolean { return coordinateKey(a) === coordinateKey(b); }
function ring(a: number, b: number, size: number): number { const d = Math.abs(a - b); return Math.min(d, size - d); }
export function distance(a: Coordinates, b: Coordinates): number {
  if (!validCoordinates(a, true) || !validCoordinates(b, true)) throw new Error("坐标超出宇宙范围");
  if (a.galaxy !== b.galaxy) return 20000 * ring(a.galaxy, b.galaxy, GALAXY.galaxies);
  if (a.system !== b.system) return 2700 + 95 * ring(a.system, b.system, GALAXY.systems);
  if (a.position !== b.position) return 1000 + 5 * Math.abs(a.position - b.position);
  return 5;
}
/** Stateless integer hash: procedural space does not allocate thousands of planets per tick. */
export function coordinateRandom(seed: number, c: Coordinates, salt = 0): number {
  let x = (seed ^ Math.imul(c.galaxy, 73856093) ^ Math.imul(c.system, 19349663) ^ Math.imul(c.position, 83492791) ^ Math.imul(salt, 2654435761)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export interface NpcSite { id: string; name: string; faction: string; coordinates: Coordinates }
export function npcAt(state: GameState, c: Coordinates): NpcSite | null {
  if (!validCoordinates(c) || state.planets.some((p) => sameCoordinates(p.coordinates, c))) return null;
  // The initial home coordinate stays reserved after first-layer resets.
  if (sameCoordinates(c, { galaxy: 1, system: 50, position: 8 })) return null;
  if (coordinateRandom(state.universe.seed, c) >= GALAXY.npcDensity) return null;
  const names = ["晨星共同体", "奥尔特联邦", "白矮星财团", "远日点议会"];
  const i = Math.floor(coordinateRandom(state.universe.seed, c, 1) * names.length);
  return { id: `npc-${coordinateKey(c)}`, name: `${names[i]} ${c.system}-${c.position}`, faction: names[i]!, coordinates: { ...c } };
}
export function planetProperties(seed: number, c: Coordinates): { tempMax: number; fieldsMax: number } {
  const r = coordinateRandom(seed, c, 2);
  const [lo, hi] = GALAXY.colonyFields;
  return { tempMax: Math.round(180 - c.position * 20 + 40 * r), fieldsMax: Math.floor(lo! + (hi! - lo!) * coordinateRandom(seed, c, 3)) };
}
export function positionBonus(position: number, resource: "metal" | "crystal" | "deuterium"): number {
  if (resource === "crystal" && position <= 3) return 1 + (GALAXY.crystalBonus[position - 1] ?? 0);
  if (resource === "metal" && position >= 6 && position <= 10) return 1 + (GALAXY.metalBonus[position - 6] ?? 0);
  return 1;
}
