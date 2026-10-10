/** Read-only control permissions. Protection never changes saved batch authority. */
import { BET_SYMBOLS } from "../data/arcade";
import { maxBetUnits, topUpReason, totalBetUnits } from "../game/arcade";
import type { GameState } from "../game/types";
import { ringAutoInput, ringAutoView } from "./ring-auto-model";

export interface RingAutoDraft {
  slot: string;
  count: string;
  cap: string;
}

export function ringControlsView(state: GameState, writable: boolean, draft: RingAutoDraft) {
  const auto = ringAutoView(state);
  const input = ringAutoInput(state, draft.slot, draft.count, draft.cap);
  const total = totalBetUnits(state);
  return {
    auto, input,
    canRun: writable && state.arcade.runs.length > 0,
    canRunAll: writable && state.arcade.runs.length > 0,
    topUpEnabled: writable && topUpReason(state) === "",
    bets: BET_SYMBOLS.map(symbol => ({
      symbol,
      canAdd: writable && total < maxBetUnits(),
      canSub: writable && state.arcade.bets[symbol] > 0,
    })),
    clearEnabled: writable,
    autoFieldsEnabled: writable && auto.setupAvailable,
    autoArmEnabled: writable && input.valid,
    autoStopEnabled: writable && state.arcade.autoBatch?.armed === true,
    autoStatus: !writable && auto.armed ? "存档受保护 · 授权记录保留，执行冻结" : auto.status,
  };
}
