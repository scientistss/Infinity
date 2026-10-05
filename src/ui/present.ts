import { CARD_CATALOG, SLOT_RULES } from "../data/protocol-cards";
import { protocolSentence, slotFields, slotUnlockHint, unlockProgress, unlockedSlotCount, type ParamField } from "../automation/engine";
import { offlineCapSeconds, type OfflineCatchup } from "../core/offline";
import { ACHIEVEMENTS, ACHIEVEMENT_BONUS } from "../data/achievements";
import {
  OFFLINE_BASE_HOURS,
  OFFLINE_MAX_HOURS,
  OFFLINE_TECH_STEP_HOURS,
  PROTOCOL_OFFLINE_EVAL_SECONDS,
  PRODUCERS,
  RESOURCES,
  producerById,
  type ProducerDef,
} from "../game/content";
import { formatAmount, formatCount, formatDuration, formatMultiplier, formatPlayed, formatRate } from "../game/format";
import {
  energyReport,
  expansionScore,
  globalMultiplier,
  isProducerUnlocked,
  maxBuyCount,
  nextUnitCost,
  productionPerSecond,
  resourceMultiplier,
  warpGain,
} from "../game/logic";
import { PROTOCOL_SLOT_COUNT, RESOURCE_IDS, type CardLamp, type GameState, type ProducerId, type ResourceId } from "../game/types";

export interface ResourceView {
  id: ResourceId;
  amount: string;
  rate: string;
}

export interface ProducerView {
  id: ProducerId;
  owned: string;
  rates: string;
  cost: string;
  maxLabel: string;
  canBuyOne: boolean;
  canBuyMax: boolean;
}

export interface CatalogView {
  id: string;
  label: string;
  unlocked: boolean;
  hint: string;
}

export interface SlotView {
  index: number;
  unlocked: boolean;
  lockHint: string;
  enabled: boolean;
  sentence: string;
  lamp: CardLamp;
  reason: string;
  fields: ParamField[];
  fieldsKey: string;
}

export interface AchievementView {
  id: string;
  unlocked: boolean;
  progress: string;
}

export interface OfflineGainView {
  id: ResourceId;
  name: string;
  amount: string;
}

export interface OfflineView {
  applied: string;
  detail: string;
  gains: OfflineGainView[];
  protocol: string;
}

export interface ViewModel {
  telemetry: string;
  multiplier: string;
  played: string;
  passive: string;
  resources: ResourceView[];
  producers: ProducerView[];
  score: string;
  gain: string;
  canPrestige: boolean;
  status: string;
  banner: string | null;
  offlineCap: string;
  protocolEnergy: string;
  protocolMeta: string;
  catalog: CatalogView[];
  slots: SlotView[];
  achievements: AchievementView[];
  achievementSummary: string;
  offline: OfflineView | null;
}

export function present(
  state: GameState,
  status: string,
  banner: string | null,
  catchup: OfflineCatchup | null,
): ViewModel {
  const scale = resourceMultiplier(state);
  const open = unlockedSlotCount(state);
  return {
    telemetry: formatCount(state.warpCores),
    multiplier: `全局 ${formatMultiplier(globalMultiplier(state))}`,
    played: formatPlayed(state.totalTime),
    passive: `手动采集 ${state.manualClicks} 次`,
    resources: RESOURCES.map((resource) => ({
      id: resource.id,
      amount: formatAmount(state.resources[resource.id]),
      rate: formatRate(productionPerSecond(state, resource.id)),
    })),
    producers: PRODUCERS.map((producer) => {
      const owned = state.producers[producer.id];
      const unlocked = isProducerUnlocked(state, producer.id);
      const max = unlocked ? maxBuyCount(state, producer.id) : owned.mul(0);
      return {
        id: producer.id,
        owned: formatCount(owned),
        rates: describeRates(producer.id, scale),
        cost: describeCost(state, producer.id),
        maxLabel: max.gte(1) ? `最大购买 ${formatCount(max)}` : "最大购买",
        canBuyOne: unlocked && max.gte(1),
        canBuyMax: unlocked && max.gte(1),
      };
    }),
    score: formatAmount(expansionScore(state)),
    gain: formatCount(warpGain(state)),
    canPrestige: warpGain(state).gte(1),
    status,
    banner,
    offlineCap: `${formatDuration(offlineCapSeconds(state))}（基础 ${OFFLINE_BASE_HOURS} 小时，曲率科技每次 +${OFFLINE_TECH_STEP_HOURS} 小时，最高 ${OFFLINE_MAX_HOURS} 小时）`,
    protocolEnergy: describeEnergy(state),
    protocolMeta: `槽位 ${open}/${SLOT_RULES.hardCap} · 每 ${SLOT_RULES.roboticsPerLevels} 座机器人工厂 +1`,
    catalog: CARD_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.labelZh,
      unlocked: state.unlockedCards.includes(entry.id),
      hint: unlockProgress(state, entry.id),
    })),
    slots: presentSlots(state, open),
    achievements: ACHIEVEMENTS.map((def) => {
      const unlocked = state.unlocked.includes(def.id);
      const progress = def.progress(state);
      const current = progress.amount ? formatAmount(progress.current) : formatCount(progress.current);
      const goal = progress.amount ? formatAmount(progress.goal) : formatCount(progress.goal);
      return {
        id: def.id,
        unlocked,
        progress: unlocked ? "已达成 · +1%" : `${current} / ${goal}`,
      };
    }),
    achievementSummary: achievementSummary(state),
    offline: presentOffline(catchup),
  };
}

function achievementSummary(state: GameState): string {
  const unlocked = state.unlocked.length;
  const bonus = Math.round(unlocked * ACHIEVEMENT_BONUS * 100);
  return `已解锁 ${unlocked} / ${ACHIEVEMENTS.length} · 全局产出 +${bonus}%`;
}

function presentOffline(catchup: OfflineCatchup | null): OfflineView | null {
  if (!catchup || catchup.appliedSeconds < 1) return null;
  const cap = formatDuration(catchup.capSeconds);
  const applied = formatDuration(catchup.appliedSeconds);
  const raw = formatDuration(catchup.rawSeconds);
  const limit = catchup.capped ? `已触顶，超出 ${cap} 的部分不结算。` : "未触顶。";
  return {
    applied,
    detail: `离开 ${raw}，结算 ${applied}。当前上限 ${cap}。${limit} 基础上限 ${OFFLINE_BASE_HOURS} 小时，曲率科技每次 +${OFFLINE_TECH_STEP_HOURS} 小时，最高 ${OFFLINE_MAX_HOURS} 小时。`,
    gains: RESOURCES.map((resource) => ({
      id: resource.id,
      name: resource.name,
      amount: `+${formatAmount(catchup.gains[resource.id])}`,
    })),
    protocol: `协议卡已按每 ${PROTOCOL_OFFLINE_EVAL_SECONDS} 秒求值 ${catchup.protocolEvaluations} 次。`,
  };
}

function presentSlots(state: GameState, open: number): SlotView[] {
  return state.protocols.slots.slice(0, PROTOCOL_SLOT_COUNT).map((slot, index) => {
    const unlocked = index < open;
    const fields = unlocked && slot.card ? slotFields(state, slot.card) : [];
    return {
      index,
      unlocked,
      lockHint: unlocked ? "" : slotUnlockHint(index),
      enabled: slot.card?.enabled ?? false,
      sentence: unlocked && slot.card ? protocolSentence(slot.card) : "",
      lamp: slot.lamp,
      reason: slot.reason,
      fields,
      fieldsKey: fields.map((field) => `${field.path}=${field.value}:${field.options.map((option) => option.value).join(",")}`).join("|"),
    };
  });
}

function describeEnergy(state: GameState): string {
  const energy = energyReport(state);
  const lack = energy.shortage.gt(0) ? ` · 缺 ${formatAmount(energy.shortage)}` : "";
  return `供给 ${formatAmount(energy.supply)}/s · 需求 ${formatAmount(energy.demand)}/s · 效率 ${energy.efficiency.mul(100).toFixed(0)}%${lack}`;
}

function describeRates(id: ProducerId, scale: ReturnType<typeof resourceMultiplier>): string {
  const def = producerById(id);
  const parts: string[] = [];
  for (const resourceId of RESOURCE_IDS) {
    const base = def.rates[resourceId];
    if (base <= 0) continue;
    const resource = RESOURCES.find((entry) => entry.id === resourceId);
    parts.push(`${resource?.name ?? resourceId} ${formatRate(scale.mul(base))}`);
  }
  if (def.producesEnergy > 0) parts.push(`能源 +${def.producesEnergy}/s`);
  if (def.globalProductionMult !== 1) parts.push(`全局 ×${def.globalProductionMult}`);
  if (def.consumesEnergy > 0) parts.push(`负载 ${def.consumesEnergy}`);
  return parts.length > 0 ? `每台 ${parts.join(" · ")}` : "无产出";
}

function describeCost(state: GameState, id: ProducerId): string {
  const def = producerById(id);
  if (!isProducerUnlocked(state, id)) return `未解锁 · ${unlockLine(def)}`;
  const costs = nextUnitCost(def, state.producers[id]);
  const parts: string[] = [];
  for (const resourceId of RESOURCE_IDS) {
    if (costs[resourceId].lte(0)) continue;
    const resource = RESOURCES.find((entry) => entry.id === resourceId);
    parts.push(`${resource?.name ?? resourceId} ${formatAmount(costs[resourceId])}`);
  }
  return parts.length > 0 ? `下一台 ${parts.join(" · ")}` : "免费";
}

function unlockLine(def: ProducerDef): string {
  const unlock = def.unlock;
  if (unlock.kind === "ownedGte") return `需要 ${unlock.value} 座${producerById(unlock.producer).name}`;
  if (unlock.kind === "lifetimeGte") {
    const resId = unlock.res;
    const resource = RESOURCES.find((entry) => entry.id === resId);
    return `本轮累计${resource?.name ?? resId}达到 ${unlock.value}`;
  }
  return "初始可用";
}
