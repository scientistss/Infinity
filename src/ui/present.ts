import { OFFLINE_CAP_LABEL, PRODUCERS, RESOURCES, producerById } from "../game/content";
import { formatAmount, formatCount, formatMultiplier, formatPlayed, formatRate } from "../game/format";
import {
  energyDemand,
  energyEfficiency,
  energyShortage,
  energySupply,
  expansionScore,
  isUnlocked,
  maxBuyCount,
  nextUnitCost,
  outputMultiplier,
  productionPerSecond,
  protocolSlots,
  scoreToNextCore,
  warpGain,
} from "../game/logic";
import { RESOURCE_IDS, type GameState, type ProducerId, type ResourceId } from "../game/types";

export interface ResourceView {
  id: ResourceId;
  amount: string;
  rate: string;
}

export interface ProducerView {
  id: ProducerId;
  owned: string;
  effect: string;
  cost: string;
  maxLabel: string;
  unlocked: boolean;
  canBuyOne: boolean;
  canBuyTen: boolean;
  canBuyMax: boolean;
}

export interface ViewModel {
  warpCores: string;
  multiplier: string;
  played: string;
  energy: string;
  energyShort: boolean;
  slots: string;
  resources: ResourceView[];
  producers: ProducerView[];
  score: string;
  preview: string;
  canPrestige: boolean;
  status: string;
  banner: string | null;
  offlineCap: string;
}

export function present(state: GameState, status: string, banner: string | null): ViewModel {
  const shortage = energyShortage(state);
  const gain = warpGain(state);
  return {
    warpCores: formatCount(state.warpCores),
    multiplier: formatMultiplier(outputMultiplier(state)),
    played: formatPlayed(state.totalTime),
    energy: `供给 ${formatAmount(energySupply(state))} / 需求 ${formatAmount(energyDemand(state))} · 效率 ${formatAmount(energyEfficiency(state).mul(100))}%`,
    energyShort: shortage.gt(0),
    slots: `卡槽 ${formatCount(protocolSlots(state))} / 6`,
    resources: RESOURCES.map((resource) => ({
      id: resource.id,
      amount: formatAmount(state.resources[resource.id]),
      rate: formatRate(productionPerSecond(state, resource.id)),
    })),
    producers: PRODUCERS.map((producer) => {
      const max = maxBuyCount(state, producer.id);
      const unlocked = isUnlocked(state, producer.id);
      return {
        id: producer.id,
        owned: formatCount(state.producers[producer.id]),
        effect: effectLine(producer.id),
        cost: unlocked ? describeCost(state, producer.id) : `未解锁：${producer.unlockText}`,
        maxLabel: max.gte(1) ? `最大 ${formatCount(max)}` : "最大",
        unlocked,
        canBuyOne: max.gte(1),
        canBuyTen: max.gte(1),
        canBuyMax: max.gte(1),
      };
    }),
    score: formatAmount(expansionScore(state)),
    preview: `可得 ${formatCount(gain)} 核心，下一个还需 ${formatAmount(scoreToNextCore(state))}`,
    canPrestige: gain.gte(1),
    status,
    banner,
    offlineCap: OFFLINE_CAP_LABEL,
  };
}

function effectLine(id: ProducerId): string {
  const def = producerById(id);
  const parts: string[] = [];
  for (const resourceId of RESOURCE_IDS) {
    const rate = def.rates[resourceId];
    if (rate <= 0) continue;
    const resource = RESOURCES.find((entry) => entry.id === resourceId);
    parts.push(`+${rate} ${resource?.name ?? resourceId}/秒`);
  }
  if (def.energySupply > 0) parts.push(`+${def.energySupply} 能源`);
  if (def.note) parts.push(def.note);
  if (def.energyCost > 0) parts.push(`耗 ${def.energyCost} 能源`);
  return parts.join(" · ");
}

function describeCost(state: GameState, id: ProducerId): string {
  const def = producerById(id);
  const costs = nextUnitCost(def, state.producers[id]);
  const parts: string[] = [];
  for (const resourceId of RESOURCE_IDS) {
    if (costs[resourceId].lte(0)) continue;
    const resource = RESOURCES.find((entry) => entry.id === resourceId);
    parts.push(`${resource?.name ?? resourceId} ${formatAmount(costs[resourceId])}`);
  }
  return parts.length > 0 ? `下一座 ${parts.join(" · ")}` : "免费";
}
