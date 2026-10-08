/** Presentation only: use the published rule tables, never inspect unrevealed outcomes. */
import art from "../data/ring-art.json";
import { ARCADE_SYMBOLS, arcadeSymbolDef, type ArcadeSymbol } from "../data/arcade";
import { chargeChances } from "../data/deep-space";
import { SYMBOL_CHANCE, type ArcadeHistoryEntry } from "../game/arcade";
import { chargeReservations, expeditionSlots, storedRunLimit } from "../game/deep-state";
import type { GameState } from "../game/types";

export type RingOddsSource = "beacon" | "charge-1" | "charge-2" | "charge-3";
export function ringArt(symbol: ArcadeSymbol) { return art[symbol]; }
export function ringArtUrl(symbol: ArcadeSymbol, base: string): string {
  return `${base.endsWith("/") ? base : `${base}/`}${ringArt(symbol).file}`;
}
export function validOddsSource(value: string): RingOddsSource {
  return value === "charge-1" || value === "charge-2" || value === "charge-3" ? value : "beacon";
}
export function ringOdds(source: RingOddsSource) {
  const chances = source === "beacon" ? SYMBOL_CHANCE : chargeChances(Number(source.at(-1)));
  return ARCADE_SYMBOLS.map(symbol => ({
    symbol, name: arcadeSymbolDef(symbol).nameZh,
    percent: chances[symbol] * (source === "beacon" ? 100 : 1),
  }));
}
export function historyKey(entry: ArcadeHistoryEntry): string {
  return JSON.stringify([entry.at, entry.symbol, entry.big, entry.auto, entry.summary]);
}
/** r3 has no source field in history; only the explicit charge receipt prefix is distinguishable. */
export function historySource(entry: ArcadeHistoryEntry): string {
  return entry.summary.startsWith("深空事件回放：") ? "舰队充能回放" : "信标／加注／奖励";
}
export function ringQueue(state: GameState) {
  const charge = state.arcade.runs.filter(r => r.source === "charge").length;
  const next = state.arcade.runs[0];
  return {
    count: state.arcade.runs.length, limit: storedRunLimit(state),
    charge, direct: state.arcade.runs.length - charge,
    reserved: chargeReservations(state),
    expeditions: state.fleets.filter(f => f.mission === "charge").length,
    expeditionLimit: expeditionSlots(state),
    next: !next ? "暂无待揭晓结果" : next.source === "charge" ? "下一次：舰队事件回放，不再次发奖" : "下一次：信标／加注／奖励，揭晓时结算",
    action: next?.source === "charge" ? "回放下一次" : "开始跑灯",
  };
}
