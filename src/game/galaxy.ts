import config from "../data/space-balance.json";
import type { GameState, ResourceId } from "./types";
export const SPACE = config;
export interface Coordinates { galaxy: number; system: number; position: number }
export interface Universe { seed: number; layout: "ring-v1" }
export function validCoordinates(c: unknown, deep = false): c is Coordinates {
  if (!c || typeof c !== "object") return false;
  const p = c as Coordinates;
  return Number.isInteger(p.galaxy) && p.galaxy >= 1 && p.galaxy <= SPACE.galaxies
    && Number.isInteger(p.system) && p.system >= 1 && p.system <= SPACE.systems
    && Number.isInteger(p.position) && p.position >= 1 && p.position <= (deep ? 16 : 15);
}
export function coordinateKey(c: Coordinates): string { return `${c.galaxy}:${c.system}:${c.position}`; }
export function sameCoordinates(a: Coordinates,b: Coordinates): boolean { return coordinateKey(a) === coordinateKey(b); }
export function wrap(value: number,max: number): number { return ((value - 1) % max + max) % max + 1; }
export function distance(a: Coordinates,b: Coordinates): number {
  if (!validCoordinates(a,true) || !validCoordinates(b,true)) throw Error("坐标超出宇宙范围");
  const ring = (x: number,y: number,n: number) => Math.min(Math.abs(x-y),n-Math.abs(x-y));
  if (a.galaxy !== b.galaxy) return 20000*ring(a.galaxy,b.galaxy,5);
  if (a.system !== b.system) return 2700+95*ring(a.system,b.system,100);
  return a.position === b.position ? 5 : 1000+5*Math.abs(a.position-b.position);
}
/** Coordinate hashing is independent of the saved arcade RNG. */
export function coordinateRandom(seed: number,c: Coordinates,salt = 0): number {
  let x = (seed ^ Math.imul(c.galaxy,73856093) ^ Math.imul(c.system,19349663) ^ Math.imul(c.position,83492791) ^ Math.imul(salt,2654435761)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x,0x7feb352d); x ^= x >>> 15; x = Math.imul(x,0x846ca68b); x ^= x >>> 16;
  return (x >>> 0)/4294967296;
}
export function homeCoordinates(seed: number): Coordinates {
  const c={galaxy:1,system:50,position:8};
  return {galaxy:1,system:40+Math.floor(coordinateRandom(seed,c,20)*21),position:4+Math.floor(coordinateRandom(seed,c,21)*9)};
}
export function positionBonus(p: number,res: ResourceId): number {
  if(res === "crystal" && p>=1 && p<=3) return 1+SPACE.crystalBonus[p-1]!;
  if(res === "metal" && p>=6 && p<=10) return 1+SPACE.metalBonus[p-6]!;
  return 1;
}
/** Provisional colony generation curve, not a claim to the full OGame size distribution. */
export function planetProperties(seed: number,c: Coordinates): {tempMax:number; fieldsMax:number} {
  if(!validCoordinates(c)) throw Error("深空没有可殖民行星");
  const [lo,hi]=SPACE.colonyFields;
  return {tempMax:Math.round(180-20*c.position+40*coordinateRandom(seed,c,2)), fieldsMax:lo!+Math.floor((hi!-lo!)*coordinateRandom(seed,c,3))};
}
export interface NpcSite { name:string; faction:string; id:string }
export function npcAt(state: GameState,c: Coordinates): NpcSite|null {
  if(!validCoordinates(c) || state.planets.some(p=>sameCoordinates(p.coordinates,c)) || sameCoordinates(homeCoordinates(state.universe.seed),c)) return null;
  if(coordinateRandom(state.universe.seed,c) >= SPACE.npcDensity) return null;
  const names=["晨星共同体","奥尔特联邦","白矮星财团","远日点议会"];
  const faction=names[Math.floor(coordinateRandom(state.universe.seed,c,1)*names.length)]!;
  return {name:`${faction} ${c.system}-${c.position}`, faction,id:`npc-${coordinateKey(c)}`};
}
