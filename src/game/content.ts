import type { GameState, ProducerId, ResourceId } from "./types";

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
  /** Resource per second per building, before global multipliers and energy efficiency. */
  rates: Record<ResourceId, number>;
  costs: Record<ResourceId, number>;
  ratio: number;
  /** Energy demanded per building. */
  energyCost: number;
  /** Energy supplied per building. */
  energySupply: number;
  /** Extra effect that is not a direct resource rate. */
  note: string;
  unlockText: string;
  unlock: (state: GameState) => boolean;
}

export const SAVE_VERSION = 1;
export const STORAGE_KEY = "infinity.save.v1";

/** Base offline cap. Warp tech may raise this later; the scaffold does not. */
export const OFFLINE_CAP_SECONDS = 2 * 60 * 60;
export const OFFLINE_CAP_LABEL = "2 小时";

/** gain = floor(sqrt(score / PRESTIGE_SCORE_UNIT)) */
export const PRESTIGE_SCORE_UNIT = 1e6;

/** Each unspent curvature core adds this much global output. */
export const WARP_CORE_BONUS = 0.02;

export const ROBOTICS_MULTIPLIER = 1.25;
export const PROTOCOL_SLOT_CAP = 6;

export const RESOURCES: readonly ResourceDef[] = [
  { id: "metal", name: "金属", nameEn: "Metal", blurb: "基础资源，几乎所有建造都用。" },
  { id: "crystal", name: "晶体", nameEn: "Crystal", blurb: "中级资源，用于高级建筑与协议卡。" },
  { id: "deuterium", name: "重氢", nameEn: "Deuterium", blurb: "高级资源，主要用于殖民舰与机器人。" },
];

export const PRODUCERS: readonly ProducerDef[] = [
  {
    id: "metal_mine",
    name: "金属矿",
    nameEn: "Metal Mine",
    description: "开采金属。",
    rates: { metal: 1, crystal: 0, deuterium: 0 },
    costs: { metal: 10, crystal: 0, deuterium: 0 },
    ratio: 1.15,
    energyCost: 1,
    energySupply: 0,
    note: "",
    unlockText: "开局可用",
    unlock: () => true,
  },
  {
    id: "solar_plant",
    name: "太阳能电站",
    nameEn: "Solar Plant",
    description: "提供能源。开局赠送 1 座，避免没有电。",
    rates: { metal: 0, crystal: 0, deuterium: 0 },
    costs: { metal: 30, crystal: 10, deuterium: 0 },
    ratio: 1.17,
    energyCost: 0,
    energySupply: 5,
    note: "",
    unlockText: "拥有 3 座金属矿",
    unlock: (state) => state.producers.metal_mine.gte(3),
  },
  {
    id: "crystal_mine",
    name: "晶体矿",
    nameEn: "Crystal Mine",
    description: "开采晶体。",
    rates: { metal: 0, crystal: 0.4, deuterium: 0 },
    costs: { metal: 60, crystal: 0, deuterium: 0 },
    ratio: 1.18,
    energyCost: 2,
    energySupply: 0,
    note: "",
    unlockText: "本轮累计 100 金属",
    unlock: (state) => state.lifetime.metal.gte(100),
  },
  {
    id: "deuterium_synth",
    name: "重氢合成器",
    nameEn: "Deuterium Synthesizer",
    description: "合成重氢。",
    rates: { metal: 0, crystal: 0, deuterium: 0.1 },
    costs: { metal: 300, crystal: 100, deuterium: 0 },
    ratio: 1.22,
    energyCost: 3,
    energySupply: 0,
    note: "",
    unlockText: "本轮累计 500 晶体",
    unlock: (state) => state.lifetime.crystal.gte(500),
  },
  {
    id: "robotics_factory",
    name: "机器人工厂",
    nameEn: "Robotics Factory",
    description: "放大全部资源产出。每 2 座 +1 协议卡槽。",
    rates: { metal: 0, crystal: 0, deuterium: 0 },
    costs: { crystal: 1000, metal: 0, deuterium: 200 },
    ratio: 2,
    energyCost: 0,
    energySupply: 0,
    note: "全部产出 ×1.25",
    unlockText: "本轮累计 50 重氢",
    unlock: (state) => state.lifetime.deuterium.gte(50),
  },
];

/** Visual catalog only. The scaffold does not evaluate cards. */
export const PROTOCOL_CARDS: readonly { name: string; unlock: string }[] = [
  { name: "自动采集", unlock: "手动点击 100 次" },
  { name: "自动建造", unlock: "拥有 10 座金属矿" },
  { name: "资源 / 拥有条件", unlock: "首次能源不足" },
  { name: "成本比例", unlock: "拥有 1 座机器人工厂" },
  { name: "能源效率", unlock: "首次发射殖民舰后" },
  { name: "自动发射", unlock: "累计 10 曲率核心" },
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
