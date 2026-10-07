import type { GameState, ResourceId } from "./types";
import type { ArcadeSymbol, BetSymbol } from "../data/arcade";
import type { RunOutcome, RunLight } from "./arcade";
import type { Coordinates } from "./galaxy";
import type { ShipId } from "../data/units";
import type { BattleResult } from "./encounter-combat";
import { DEEP } from "../data/deep-space";
export type ShipCounts=Partial<Record<ShipId,number>>;
export interface ChargeOrder {
  slots:number; phase:"outbound"|"holding"|"return"; cargoFactor:number;
  bets:Record<BetSymbol,number>; stake:number; betUnit:number;
  dm:number; items:Partial<Record<string,number>>; offerId:string|null; reportId:string|null;
}
export interface ChargeReceipt { reportId:string; originId:string; lines:string[]; lights:RunLight[] }
export interface ChargeReport {
  id:string; fleetId:number; originId:string; at:number; target:Coordinates; slots:number;
  rawSymbol:ArcadeSymbol; symbol:ArcadeSymbol; protection:string; outcome:RunOutcome;
  lines:string[]; returned:boolean; destroyed:boolean; battle:BattleResult|null;
}
export interface MerchantOffer {
  id:string; planetId:string; startsAt:number; expiresAt:number;
  ratios:Record<ResourceId,number>; remainingMe:string;
}
export interface DebrisField { target:Coordinates; metal:string; crystal:string }
export interface DeepState {
  seed:number; completed:number; lastBlackhole:number; emptyStreak:number; jackpotStreak:number;
  nextOfferId:number; reports:ChargeReport[]; offers:MerchantOffer[]; debris:DebrisField[];
}
export function createDeepState(seed:number):DeepState {
  return {seed:(seed^0x9e3779b9)>>>0, completed:0,lastBlackhole:0,emptyStreak:0,jackpotStreak:0,
    nextOfferId:1,reports:[],offers:[],debris:[]};
}
export function expeditionSlots(state:GameState):number {
  return Math.min(31,Math.floor(Math.sqrt(state.research.levels.astrophysics)));
}
export function chargeReservations(state:GameState):number {
  return state.fleets.filter(f=>f.mission==="charge" && !f.returning).length;
}
export function storedRunLimit(state:GameState):number {
  return Math.min(DEEP.maxStoredRuns,5+expeditionSlots(state));
}
