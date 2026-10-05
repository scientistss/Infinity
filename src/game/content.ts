import type { ProducerId, ResourceId } from "./types";

export interface ResourceDef {
  id: ResourceId;
  name: string;
  nameEn: string;
  blurb: string;
}

export interface ProducerDef {
  id: ProducerId;
  name: string;
  nameEn: string;
  description: string;
  /** Base production per second per owned building, before the telemetry multiplier. */
  rates: Record<ResourceId, number>;
  /** Cost of the first building. Later copies multiply by `ratio`. */
  costs: Record<ResourceId, number>;
  ratio: number;
}

export const SAVE_VERSION = 1;
export const STORAGE_KEY = "infinity.save.v1";

/** Offline catch-up never exceeds this many seconds. Shown in the UI. */
export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const OFFLINE_CAP_LABEL = "8 小时";

/**
 * Expansion score divisor for the placeholder sqrt prestige.
 * gain = floor(sqrt(score / PRESTIGE_SCORE_UNIT))
 */
export const PRESTIGE_SCORE_UNIT = 200;

/** Always-on planet-surface trickle so the loop is visible before the first purchase. */
export const PASSIVE_RATES: Record<ResourceId, number> = {
  metal: 1,
  crystal: 0,
  deuterium: 0,
};

export const RESOURCES: readonly ResourceDef[] = [
  {
    id: "metal",
    name: "金属",
    nameEn: "Metal",
    blurb: "风化壳里最常见的结构材料。",
  },
  {
    id: "crystal",
    name: "晶体",
    nameEn: "Crystal",
    blurb: "埋在晶壳中的光学矿。",
  },
  {
    id: "deuterium",
    name: "重氢",
    nameEn: "Deuterium",
    blurb: "从稀薄大气里冷凝下来的推进剂。",
  },
];

export const PRODUCERS: readonly ProducerDef[] = [
  {
    id: "miner",
    name: "地表采矿机",
    nameEn: "Surface Miner",
    description: "刮削风化壳，稳定开采金属。",
    rates: { metal: 1, crystal: 0, deuterium: 0 },
    costs: { metal: 10, crystal: 0, deuterium: 0 },
    ratio: 1.15,
  },
  {
    id: "drill",
    name: "晶壳钻探机",
    nameEn: "Crust Drill",
    description: "钻开地表晶壳，抽出晶体。",
    rates: { metal: 0, crystal: 0.2, deuterium: 0 },
    costs: { metal: 80, crystal: 0, deuterium: 0 },
    ratio: 1.16,
  },
  {
    id: "well",
    name: "重氢冷凝井",
    nameEn: "Deuterium Well",
    description: "把大气中的重氢冷凝进储罐。",
    rates: { metal: 0, crystal: 0, deuterium: 0.1 },
    costs: { metal: 150, crystal: 30, deuterium: 0 },
    ratio: 1.17,
  },
  {
    id: "smelter",
    name: "磁选熔炉",
    nameEn: "Magnetic Smelter",
    description: "磁选贫矿并熔炼，大量产出金属。",
    rates: { metal: 8, crystal: 0, deuterium: 0 },
    costs: { metal: 250, crystal: 60, deuterium: 0 },
    ratio: 1.18,
  },
  {
    id: "survey",
    name: "前哨勘测塔",
    nameEn: "Survey Outpost",
    description: "标定富集点，同时提高晶体与重氢采集。",
    rates: { metal: 0, crystal: 1.2, deuterium: 0.35 },
    costs: { metal: 600, crystal: 180, deuterium: 30 },
    ratio: 1.2,
  },
];

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
