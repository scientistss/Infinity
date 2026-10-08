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

/** Keep pending return reports even while many faster fleets complete behind them. */
export function retainChargeReports(reports: ChargeReport[], fleets: GameState["fleets"]): ChargeReport[] {
  const pinned = new Set(fleets.flatMap(f => f.charge?.reportId ? [f.charge.reportId] : []));
  // Include a just-completed report: its fleet's phase may not yet have been replaced by the caller.
  const activeIds = new Set(fleets.map(f => f.id));
  for (const report of reports) if (!report.returned && !report.destroyed && activeIds.has(report.fleetId)) pinned.add(report.id);
  const required = reports.filter(r => pinned.has(r.id));
  const room = Math.max(0, DEEP.reportLimit - required.length);
  const recent = reports.filter(r => !pinned.has(r.id));
  const kept = new Set([...required, ...(room ? recent.slice(-room) : [])].map(r => r.id));
  return reports.filter(r => kept.has(r.id));
}

/** An absent fleet is not "still returning" after the player has reset the lower layer. */
export function chargeDeliveryStatus(state: GameState, report: ChargeReport): string {
  if (report.destroyed) return "舰队全损";
  if (report.returned) return "已返航入库";
  if (state.fleets.some(f => f.id === report.fleetId && f.charge?.reportId === report.id)) return "返航中";
  return "任务已结束（未入港奖励不保留）";
}
