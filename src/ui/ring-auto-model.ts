/** Read-only batch presentation. Never inspect outcomes or authorize a run here. */
import { unlockedSlotCount } from "../automation/engine";
import { BET_SYMBOLS, arcadeSymbolDef, type BetSymbol } from "../data/arcade";
import { arcadeUnlocked, betUnitDeut, isRingAmount } from "../game/arcade";
import { storedRunLimit } from "../game/deep-state";
import type { GameState } from "../game/types";

export function ringBetSummary(bets: Record<BetSymbol, number>): string {
  const parts = BET_SYMBOLS.filter(symbol => bets[symbol] > 0)
    .map(symbol => `${arcadeSymbolDef(symbol).nameZh} ${bets[symbol]} 注`);
  return parts.join("、") || "无押注（每次扣费 0 重氢）";
}

export function ringAutoView(state: GameState) {
  const batch = state.arcade.autoBatch;
  const open = unlockedSlotCount(state);
  const slots = state.unlockedCards.includes("auto_runner") ? state.protocols.slots.flatMap((slot, index) =>
    index < open && slot.card?.id === "auto_runner" && slot.card.action.kind === "runLights"
      ? [{ index, label: `槽位 ${index + 1} · 自动跑灯` }] : []) : [];
  const source = state.planets.find(planet => planet.id === state.activePlanetId)!;
  const batchSource = batch && state.planets.find(planet => planet.id === batch.planetId);
  const maxCount = Math.min(state.arcade.runs.length, storedRunLimit(state));
  const prerequisite = !arcadeUnlocked(state) ? "先研究天体物理学 1 级。"
    : !state.unlockedCards.includes("auto_runner") ? "先手动开奖 10 次解锁「自动跑灯」，再到协议页装配到已开启槽位。"
    : !slots.length ? "请到协议页把「自动跑灯」装配到已开启槽位，动作选择「跑灯开奖」。装配默认关闭。"
    : !maxCount ? "暂无待揭晓结果；新信标、奖励和加注不会自动加入已授权批次。" : "";
  const currentCost = BET_SYMBOLS.reduce((sum, symbol) => sum + state.arcade.bets[symbol], 0) * betUnitDeut(state);
  return {
    slots, maxCount, prerequisite, armed: batch?.armed ?? false,
    source: `当前来源星球：${source.name} [${source.coordinates.galaxy}:${source.coordinates.system}:${source.coordinates.position}]`,
    bets: `待授权押注：${ringBetSummary(state.arcade.bets)}${currentCost > 0 ? ` · 当前单次 ${currentCost} 重氢` : ""}`,
    status: batch?.armed ? "已授权本批次" : batch ? "已停止 · 需重新授权" : "关闭 · 默认未授权",
    progress: batch ? `已完成 ${batch.completed}/${batch.ticketIds.length} 次 · 已扣重氢 ${batch.spentDeuterium} / 上限 ${batch.maxDeuterium}` : "已完成 0/0 次 · 已扣重氢 0 / 上限 0",
    frozen: batch ? `固定来源：${batchSource?.name ?? batch.planetId} · 冻结押注：${ringBetSummary(batch.bets)}` : "授权时固定来源星球、当前待揭晓队列前缀和押注。",
    stopReason: batch?.stopReason ? `停止原因：${batch.stopReason}` : "",
  };
}

/** Validate text only. The domain rechecks permissions, queue and budget at action time. */
export function ringAutoInput(state: GameState, slotValue: string, countValue: string, capValue: string) {
  const model = ringAutoView(state);
  const count = /^\d+$/.test(countValue.trim()) ? Number(countValue) : NaN;
  const slotIndex = /^\d+$/.test(slotValue) ? Number(slotValue) : NaN;
  const cap = capValue.trim();
  let reason = model.armed ? "本批次已授权；先停止，才能重新授权。" : model.prerequisite;
  if (!reason && !model.slots.some(slot => slot.index === slotIndex)) reason = "请选择已装配的自动跑灯槽位。";
  if (!reason && (!Number.isInteger(count) || count < 1 || count > model.maxCount)) reason = `授权次数须为 1–${model.maxCount} 的整数。`;
  if (!reason && !isRingAmount(cap)) reason = "重氢总上限须为有效的非负数。";
  return { valid: !reason, reason, slotIndex, count, maxDeuterium: cap };
}
