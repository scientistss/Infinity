import { OFFLINE_CAP_LABEL, PASSIVE_RATES, PRODUCERS, RESOURCES, producerById } from "../game/content";
import { formatAmount, formatCount, formatMultiplier, formatPlayed, formatRate } from "../game/format";
import {
  expansionScore,
  maxBuyCount,
  nextUnitCost,
  outputMultiplier,
  productionPerSecond,
  telemetryGain,
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
  rates: string;
  cost: string;
  maxLabel: string;
  canBuyOne: boolean;
  canBuyMax: boolean;
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
}

export function present(state: GameState, status: string, banner: string | null): ViewModel {
  const multiplier = outputMultiplier(state);
  return {
    telemetry: formatCount(state.telemetry),
    multiplier: formatMultiplier(multiplier),
    played: formatPlayed(state.totalTime),
    passive: `风化拾取 ${formatRate(multiplier.mul(PASSIVE_RATES.metal))} 金属`,
    resources: RESOURCES.map((resource) => ({
      id: resource.id,
      amount: formatAmount(state.resources[resource.id]),
      rate: formatRate(productionPerSecond(state, resource.id)),
    })),
    producers: PRODUCERS.map((producer) => {
      const owned = state.producers[producer.id];
      const max = maxBuyCount(state, producer.id);
      return {
        id: producer.id,
        owned: formatCount(owned),
        rates: describeRates(producer.id, multiplier),
        cost: describeCost(state, producer.id),
        maxLabel: max.gte(1) ? `最大购买 ${formatCount(max)}` : "最大购买",
        canBuyOne: max.gte(1),
        canBuyMax: max.gte(1),
      };
    }),
    score: formatAmount(expansionScore(state)),
    gain: formatCount(telemetryGain(state)),
    canPrestige: telemetryGain(state).gte(1),
    status,
    banner,
    offlineCap: OFFLINE_CAP_LABEL,
  };
}

function describeRates(id: ProducerId, multiplier: ReturnType<typeof outputMultiplier>): string {
  const def = producerById(id);
  const parts: string[] = [];
  for (const resourceId of RESOURCE_IDS) {
    const base = def.rates[resourceId];
    if (base <= 0) continue;
    const resource = RESOURCES.find((entry) => entry.id === resourceId);
    parts.push(`${resource?.name ?? resourceId} ${formatRate(multiplier.mul(base))}`);
  }
  return parts.length > 0 ? `每台 ${parts.join(" · ")}` : "无产出";
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
  return parts.length > 0 ? `下一台 ${parts.join(" · ")}` : "免费";
}
