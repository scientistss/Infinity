import balance from "../data/balance.json";
import type { ProducerId } from "../data/protocol-cards";
import type { ResourceId } from "./types";

export interface ResourceDef {
  id: ResourceId;
  name: string;
  nameEn: string;
  blurb: string;
}

export type ProducerUnlock =
  | { kind: "start" }
  | { kind: "ownedGte"; producer: ProducerId; value: number }
  | { kind: "lifetimeGte"; res: ResourceId; value: string };

export interface ProducerDef {
  id: ProducerId;
  name: string;
  nameEn: string;
  description: string;
  /** Base resource per second per owned building, before global and energy multipliers. */
  rates: Record<ResourceId, number>;
  costs: Record<ResourceId, number>;
  ratio: number;
  consumesEnergy: number;
  producesEnergy: number;
  /** Each owned copy multiplies global resource output by this (1 = no bonus). */
  globalProductionMult: number;
  unlock: ProducerUnlock;
}

export const SAVE_VERSION = 3;
/** Same key as v1 so existing browsers still find the save. Version lives inside the file. */
export const STORAGE_KEY = "infinity.save.v1";

export const OFFLINE_CAP_SECONDS = balance.offline.baseCapHours * 60 * 60;
export const OFFLINE_CAP_LABEL = `${balance.offline.baseCapHours} 小时`;
export const OFFLINE_PROTOCOL_SECONDS = balance.offline.protocolEvalIntervalSeconds;

/** gain = floor(sqrt(score / PRESTIGE_SCORE_UNIT)) */
export const PRESTIGE_SCORE_UNIT = balance.prestige.divisor;
export const SCORE_WEIGHTS = balance.prestige.scoreWeights;
export const CORE_BONUS_PER_CORE = balance.prestige.unspentCoreBonusPerCore;

export const MANUAL_METAL_PER_CLICK = balance.starting.manualMineMetalPerClick;
export const FREE_SOLAR_PLANTS = balance.starting.freeSolarPlant;

export const RESOURCES: readonly ResourceDef[] = [
  { id: "metal", name: "金属", nameEn: "Metal", blurb: "结构材料。手动采集或金属矿产出。" },
  { id: "crystal", name: "晶体", nameEn: "Crystal", blurb: "晶体矿抽出的光学矿。" },
  { id: "deuterium", name: "重氢", nameEn: "Deuterium", blurb: "重氢合成器产出的推进剂。" },
];

const NAME_EN: Record<ProducerId, string> = {
  metal_mine: "Metal Mine",
  solar_plant: "Solar Plant",
  crystal_mine: "Crystal Mine",
  deuterium_synth: "Deuterium Synthesizer",
  robotics_factory: "Robotics Factory",
};

const BLURB: Record<ProducerId, string> = {
  metal_mine: "开采金属，每座负载 1 能源。",
  solar_plant: "供电。能源效率低于 1 时，矿产量按比例下降。",
  crystal_mine: "开采晶体。",
  deuterium_synth: "合成重氢。",
  robotics_factory: "每座使全局资源产量 ×1.25。每 2 座额外开放 1 个协议槽。",
};

function emptyRates(): Record<ResourceId, number> {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

function readUnlock(raw: { kind: string; producer?: string; res?: string; value?: number | string }): ProducerUnlock {
  if (raw.kind === "ownedGte" && raw.producer && typeof raw.value === "number") {
    return { kind: "ownedGte", producer: raw.producer as ProducerId, value: raw.value };
  }
  if (raw.kind === "lifetimeGte" && raw.res && (typeof raw.value === "string" || typeof raw.value === "number")) {
    return { kind: "lifetimeGte", res: raw.res as ResourceId, value: String(raw.value) };
  }
  return { kind: "start" };
}

export const PRODUCERS: readonly ProducerDef[] = balance.producers.map((raw) => {
  const id = raw.id as ProducerId;
  const rates = emptyRates();
  if ("produces" in raw && raw.produces) {
    for (const key of Object.keys(raw.produces) as ResourceId[]) {
      const amount = raw.produces[key];
      if (typeof amount === "number") rates[key] = amount;
    }
  }
  const costs = emptyRates();
  for (const key of Object.keys(raw.baseCost) as ResourceId[]) {
    const amount = raw.baseCost[key];
    if (typeof amount === "number") costs[key] = amount;
  }
  return {
    id,
    name: raw.labelZh,
    nameEn: NAME_EN[id],
    description: BLURB[id],
    rates,
    costs,
    ratio: raw.growth,
    consumesEnergy: raw.consumesEnergy ?? 0,
    producesEnergy: "producesEnergy" in raw && typeof raw.producesEnergy === "number" ? raw.producesEnergy : 0,
    globalProductionMult: "globalProductionMult" in raw && typeof raw.globalProductionMult === "number" ? raw.globalProductionMult : 1,
    unlock: readUnlock(raw.unlock),
  };
});

const PRODUCER_BY_ID = Object.fromEntries(PRODUCERS.map((producer) => [producer.id, producer])) as Record<
  ProducerId,
  ProducerDef
>;

export function producerById(id: ProducerId): ProducerDef {
  return PRODUCER_BY_ID[id];
}

export function isProducerId(value: string): value is ProducerId {
  return Object.prototype.hasOwnProperty.call(PRODUCER_BY_ID, value);
}

export function isResourceId(value: string): value is ResourceId {
  return (["metal", "crystal", "deuterium"] as readonly string[]).includes(value);
}
