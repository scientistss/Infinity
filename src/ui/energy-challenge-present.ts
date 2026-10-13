import { buildingById } from "../data/buildings";
import { CARD_CATALOG } from "../data/protocol-cards";
import { energyChallengePrestigeEvaluation, energyChallengeScoreText as exactEnergyChallengeScore, energyChallengeStatus, type EnergyChallengeAction, type EnergyChallengeQuote } from "../game/energy-challenge";
import { ENERGY_CHALLENGE_BUILDINGS } from "../game/energy-challenge-state";
import { HOMEWORLD_ID } from "../game/planet";
import type { GameState } from "../game/types";
import { prestigeConfirmation, prestigePreview, previewResources } from "./prestige-preview-model";

export const ENERGY_CHALLENGE_RULES = [
  "挑战中，所有星球的矿场耗能 ×2；发电不变。自动曲率不可启用，其它自动化照常运行。",
  "只计挑战开始后，所有星球生产后实际保留的净增量：金属 ×1、晶体 ×3、重氢 ×10。满仓溢出、领取、运输及交易不计分。每次贡献按 10⁻¹² 分向下取整，目标 1,000,000 分。",
  "入场后须实际付款并完成母星的金属矿、晶体矿、重氢合成器和太阳能电站各一次；结束时这四项仍须至少 1 级。",
  "完成仍须达到普通曲率门槛，并手动确认发射。首次完成永久解锁第 3 个普通建筑 / 研究总队列槽；不会自动领奖。",
  "读档保留进行中的限制、分数与完工记录；导入不会额外计分或领奖。完成记录跨普通曲率保留，重新开始归零。",
] as const;

/** Preserve the fixed-point score exactly; no Number conversion or rounding up. */
export function energyChallengeScoreText(units: string): string {
  const [whole, fraction] = exactEnergyChallengeScore(units).split(".");
  const integer = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${integer}.${fraction}` : integer;
}

export function energyChallengeHomeText(state: GameState): string {
  const home = state.planets.find(planet => planet.id === HOMEWORLD_ID);
  return home ? `${home.name} [${home.coordinates.galaxy}:${home.coordinates.system}:${home.coordinates.position}]` : "母星暂不可用";
}

/** Bounded intent lineage, deliberately excluding score and wallet tick noise. */
export function energyChallengeIntentKey(state: GameState): string {
  const challenge = state.energyChallenge, attempt = challenge.active;
  return [challenge.nextAttemptId, attempt?.attemptId ?? "none", attempt?.universeSeed ?? "none", attempt?.entryJobFloor ?? "none",
    challenge.completion?.attempt.attemptId ?? "none", state.activePlanetId].join(":");
}

export function energyChallengeView(state: GameState) {
  const status = energyChallengeStatus(state), attempt = state.energyChallenge.active;
  const home = state.planets.find(planet => planet.id === HOMEWORLD_ID);
  return {
    ...status,
    title: status.phase === "completed" ? "能源紧缩 · 已完成" : status.phase === "active" ? "能源紧缩 · 进行中" : "能源紧缩 · 可选挑战",
    summary: status.phase === "completed" ? "永久奖励已生效：第 3 个普通建筑 / 研究总队列槽。"
      : status.phase === "active" ? `生产得分 ${energyChallengeScoreText(status.scoreUnits)} / 1,000,000 · 母星完工 ${status.proofCount}/4`
      : "矿场耗能翻倍。完成后永久解锁第 3 个普通建筑 / 研究总队列槽。",
    home: `母星：${energyChallengeHomeText(state)}`,
    checklist: ENERGY_CHALLENGE_BUILDINGS.map(id => {
      const paid = !!attempt?.proofs[id], level = home?.buildings[id] ?? 0;
      return { id, complete: paid && level >= 1, text: `${paid && level >= 1 ? "已完成" : "未完成"} · ${buildingById(id).nameZh}：${paid ? "本次已付费完工" : "本次尚未付费完工"}，当前 ${level} 级` };
    }),
    loadRule: "读档继续限制与进度；仅手动确认发射可完成。",
  };
}

export function energyChallengeCardText(state: GameState, slots: readonly number[]): string {
  if (!slots.length) return "没有已启用的自动曲率动作卡需要停用。";
  return `入场将停用：${slots.map(index => {
    const card = state.protocols.slots[index]?.card;
    const label = CARD_CATALOG.find(entry => entry.id === card?.id)?.labelZh ?? card?.id ?? "卡片已改变";
    return `槽 ${index + 1}「${label}」`;
  }).join("、")}。只关闭 enabled，保留参数配置；离开挑战不会自动重新启用。`;
}

/** Explicit-review-only projection. Never call from observe/RAF. */
export function energyChallengeReview(state: GameState, quote: EnergyChallengeQuote) {
  const home = energyChallengeHomeText(state);
  if (quote.action === "abandon") return {
    title: "核对放弃挑战", summary: "保留当前经济与所有队列；本次挑战进度清零，不重置、不退款、无奖励。",
    details: [`当前母星：${home}。`, "矿场耗能恢复普通规则；自动曲率卡不会重新启用。下次合法手动曲率时可重新入场。"],
  };
  const evaluation = energyChallengePrestigeEvaluation(state, quote.action), preview = prestigePreview(state, evaluation);
  return {
    title: quote.action === "enter" ? "核对入场并发射" : "核对完成并发射",
    summary: `本次普通发射获得 ${quote.gain} 颗曲率核心；重置 ${preview.worlds.count} 颗星球，取消 ${preview.paid.buildings + preview.paid.demolitions + preview.paid.research + preview.paid.shipyard} 项已付工作，不退款。`,
    details: [
      `当前母星：${home}。${quote.action === "enter" ? "发射后在新母星开始能源紧缩；进度从零开始。" : "本次发射完成挑战，一次性解锁第 3 个普通建筑 / 研究总队列槽。"}`,
      `旧库存：${previewResources(preview.worlds.resources)}；驻留单位 ${preview.worlds.units}，在途舰队 ${preview.fleets.count} 支及其货物清除。`,
      `保留研究等级、曲率科技、账上暗物质、物品及已保存设计；${preview.orders.stopped} 个计划停止。最终确认会列出最新普通发射收益与完整损失。`,
      quote.action === "enter" ? energyChallengeCardText(state, quote.disabledPrestigeSlots) : "能源限制解除；已关闭的自动曲率卡保持关闭。",
    ],
  };
}

/** The exact-source quote and this text are made in the same synchronous click. */
export function energyChallengeConfirmation(state: GameState, action: EnergyChallengeAction, quote: EnergyChallengeQuote): string {
  const home = energyChallengeHomeText(state);
  if (action === "abandon") return [
    `确认放弃正在进行的能源紧缩？当前母星：${home}。`,
    "保留当前资源、建筑、研究、队列和舰队；本次分数与完工记录丢失。不重置、不退款、不发奖励。",
    "矿场耗能恢复普通规则。自动曲率卡保持关闭；下次合法手动曲率可重新入场。",
    "先保存校验，成功后才采用放弃结果。",
  ].join("\n\n");
  const evaluation = energyChallengePrestigeEvaluation(state, action);
  return [
    action === "enter" ? `确认发射并进入能源紧缩？当前未入场；母星：${home}。`
      : `确认完成能源紧缩并发射？当前挑战进行中；母星：${home}。`,
    action === "enter" ? "本次普通曲率后，新一轮矿场耗能 ×2，挑战进度从零开始。只有之后实际付款并完成的母星四项建筑才计入。"
      : "本次普通发射同时完成挑战，永久解锁第 3 个普通建筑 / 研究总队列槽。奖励仅一次。",
    action === "enter" ? energyChallengeCardText(state, quote.disabledPrestigeSlots) : "解除能源限制；自动曲率卡不会重新启用。",
    prestigeConfirmation(state, evaluation),
  ].join("\n\n");
}
