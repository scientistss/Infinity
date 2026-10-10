/** Read-only batch presentation. Never inspect outcomes or authorize a run here. */
import { unlockedSlotCount } from "../automation/engine";
import { ARCADE, BET_SYMBOLS, arcadeSymbolDef, type BetSymbol } from "../data/arcade";
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
  const ringUnlocked = arcadeUnlocked(state);
  const manualComplete = state.arcade.stats.manualRuns >= ARCADE.autoCardManualRuns;
  const manualProgress = `${Math.min(state.arcade.stats.manualRuns, ARCADE.autoCardManualRuns)}/${ARCADE.autoCardManualRuns}`;
  const cardUnlocked = state.unlockedCards.includes("auto_runner");
  const open = unlockedSlotCount(state);
  const slots = cardUnlocked ? state.protocols.slots.flatMap((slot, index) =>
    index < open && slot.card?.id === "auto_runner" && slot.card.action.kind === "runLights"
      ? [{ index, label: `槽位 ${index + 1} · 自动跑灯` }] : []) : [];
  const source = state.planets.find(planet => planet.id === state.activePlanetId)!;
  const batchSource = batch && state.planets.find(planet => planet.id === batch.planetId);
  const maxCount = Math.min(state.arcade.runs.length, storedRunLimit(state));
  // Presentation follows actual permissions, not just the progress counter or queue.
  // A reached threshold does not refresh unlocks, equip a card, or authorize a batch.
  const setupAvailable = ringUnlocked && manualComplete && cardUnlocked && slots.length > 0;
  const prerequisite = !ringUnlocked ? "先研究天体物理学 1 级。"
    : !manualComplete ? `先手动开奖 ${ARCADE.autoCardManualRuns} 次解锁「自动跑灯」，再到协议页装配到已开启槽位。`
    : !cardUnlocked ? `手动开奖 ${manualProgress} 次已达标，等待解锁状态更新；尚不能授权。`
    : !slots.length ? "请到协议页把「自动跑灯」装配到已开启槽位，动作选择「跑灯开奖」。装配默认关闭。"
    : !maxCount ? "暂无待揭晓结果；新信标、奖励和加注不会自动加入已授权批次。" : "";
  const manualHint = !ringUnlocked ? `先研究天体物理学 1 级开启星环机。自动跑灯解锁进度：${manualProgress} 次手动开奖。`
    : !manualComplete ? `手动开奖 ${manualProgress} 次 · 达标后解锁「自动跑灯」。`
    : !cardUnlocked ? prerequisite
    : !slots.length ? "「自动跑灯」已解锁；到协议页装配到已开启槽位，装配默认关闭。"
    : "「自动跑灯」已装配；授权范围与状态见下方。装配或开关不等于授权。";
  const currentCost = BET_SYMBOLS.reduce((sum, symbol) => sum + state.arcade.bets[symbol], 0) * betUnitDeut(state);
  return {
    slots, maxCount, prerequisite, manualHint, setupAvailable,
    showPanel: setupAvailable || batch !== null, armed: batch?.armed ?? false,
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
