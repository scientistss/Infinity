import type { CurvatureId } from "../game/types";

/** One node on the post-launch curvature tree. Ranks are small integers, not resources. */
export interface CurvatureTechDef {
  id: CurvatureId;
  name: string;
  nameEn: string;
  effect: string;
  /** Shown under the effect. The eighth node is a score bonus, not a global multiplier. */
  note: string;
  cost: number;
  maxRank: number;
}

/**
 * Effect numbers live here so the panel and the rules stay on the same constants.
 * Offline hours stack on the 2h base in content.ts, up to 8h.
 */
export const CURVATURE_EFFECTS = {
  seed: { metal: 100, crystal: 20, deuterium: 0 },
  outputMultiplier: 2,
  growthReduction: 0.01,
  minGrowth: 1.01,
  offlineHoursPerRank: 2,
  offlineMaxHours: 8,
  slotBonus: 1,
  manualAmount: 10,
  scoreMultiplier: 1.25,
} as const;

const NODES: Record<CurvatureId, CurvatureTechDef> = {
  seed_stock: {
    id: "seed_stock",
    name: "开局储备",
    nameEn: "Seed Stock",
    effect: "每次发射后，在 500 金属 / 500 晶体的开局资源之上再得 100 金属、20 晶体（不计入产出分）",
    note: "只在下一次发射后发放。",
    cost: 1,
    maxRank: 1,
  },
  output_double: {
    id: "output_double",
    name: "产线翻倍",
    nameEn: "Output Double",
    effect: "矿产量（含星球基础产出）与电站供电 ×2，不含能源消耗",
    note: "与未花费核心的 +2% 和成就加成相乘。",
    cost: 2,
    maxRank: 1,
  },
  growth_cut: {
    id: "growth_cut",
    name: "成本缓和",
    nameEn: "Growth Cut",
    effect: "全部建筑成本因子 −0.01（最低 1.01），例如金属矿 1.5 → 1.49",
    note: "已建等级不变；之后入队的价格按新因子计算。",
    cost: 1,
    maxRank: 1,
  },
  offline_extend: {
    id: "offline_extend",
    name: "深空待机",
    nameEn: "Offline Extend",
    effect: "离线上限 +2 小时，可叠 3 次，最高 8 小时",
    note: "基础上限 2 小时。",
    cost: 1,
    maxRank: 3,
  },
  slot_plus: {
    id: "slot_plus",
    name: "协议扩容",
    nameEn: "Slot Plus",
    effect: "永久协议卡槽 +1",
    note: "与机器人工厂的卡槽相加，硬顶仍是 6。",
    cost: 1,
    maxRank: 1,
  },
  manual_ten: {
    id: "manual_ten",
    name: "手采矿镐",
    nameEn: "Manual Ten",
    effect: "手动采集 ×10",
    note: "每次点击得到 10 倍的 max(10, 1 秒金属产量)，计入本轮产出分。",
    cost: 1,
    maxRank: 1,
  },
  early_protocols: {
    id: "early_protocols",
    name: "协议预热",
    nameEn: "Early Protocols",
    effect: "放宽协议卡 5、6 的解锁条件",
    note: "卡 5 改为开局可配置；卡 6 从累计 10 核心降为 3。不执行卡牌。",
    cost: 2,
    maxRank: 1,
  },
  score_boost: {
    id: "score_boost",
    name: "航迹加权",
    nameEn: "Score Boost",
    effect: "重置产出分 ×1.25",
    note: "第 8 节点：重置分加成，不是全局产量倍率。",
    cost: 2,
    maxRank: 1,
  },
};

export const CURVATURE_TECH: readonly CurvatureTechDef[] = [
  NODES.seed_stock,
  NODES.output_double,
  NODES.growth_cut,
  NODES.offline_extend,
  NODES.slot_plus,
  NODES.manual_ten,
  NODES.early_protocols,
  NODES.score_boost,
];

const BY_ID = NODES;

export function curvatureById(id: CurvatureId): CurvatureTechDef {
  return BY_ID[id];
}

export function isCurvatureId(value: string): value is CurvatureId {
  return Object.prototype.hasOwnProperty.call(BY_ID, value);
}
