/**
 * OGame research table (design doc §6.2). Costs are ⌊base × factor^(L−1)⌋ at the target level.
 * Requirements are checked against finished levels only (queued research does not count).
 */
export const RESEARCH_IDS = [
  "energy_tech",
  "laser_tech",
  "ion_tech",
  "hyperspace_tech",
  "plasma_tech",
  "combustion_drive",
  "impulse_drive",
  "hyperspace_drive",
  "espionage_tech",
  "computer_tech",
  "astrophysics",
  "intergalactic_research_network",
  "graviton_tech",
  "weapons_tech",
  "shielding_tech",
  "armour_tech",
] as const;

export type ResearchId = (typeof RESEARCH_IDS)[number];

export type ResearchGroup = "basic" | "drive" | "advanced" | "combat";

export const RESEARCH_GROUP_LABEL: Record<ResearchGroup, string> = {
  basic: "基础研究",
  drive: "引擎",
  advanced: "高级研究",
  combat: "战斗研究",
};

export interface ResearchRequirement {
  kind: "building" | "research";
  id: string;
  level: number;
}

export interface ResearchDef {
  id: ResearchId;
  nameZh: string;
  nameEn: string;
  group: ResearchGroup;
  /** Level-1 cost. `energy` is a requirement on current energy supply, not spent (graviton). */
  baseCost: { metal: number; crystal: number; deuterium: number; energy: number };
  factor: number;
  /** OGame rounds astrophysics costs to the nearest 100. */
  roundTo?: number;
  requires: readonly ResearchRequirement[];
  /** What it does in Infinity right now. */
  effect: string;
  /** Effects that arrive with later phases. */
  later?: string;
}

const cost = (metal: number, crystal: number, deuterium: number, energy = 0) => ({ metal, crystal, deuterium, energy });
const lab = (level: number): ResearchRequirement => ({ kind: "building", id: "research_lab", level });
const tech = (id: ResearchId, level: number): ResearchRequirement => ({ kind: "research", id, level });

export const RESEARCH: readonly ResearchDef[] = [
  {
    id: "energy_tech",
    nameZh: "能源技术",
    nameEn: "Energy Technology",
    group: "basic",
    baseCost: cost(0, 800, 400),
    factor: 2,
    requires: [lab(1)],
    effect: "核聚变供电 30·L·(1.05 + 0.01·能源技术)^L；核聚变需要 3 级",
  },
  {
    id: "laser_tech",
    nameZh: "激光技术",
    nameEn: "Laser Technology",
    group: "basic",
    baseCost: cost(200, 100, 0),
    factor: 2,
    requires: [lab(1), tech("energy_tech", 2)],
    effect: "离子、等离子技术的前置；轻 / 重型激光炮、战列巡洋舰的前置",
  },
  {
    id: "ion_tech",
    nameZh: "离子技术",
    nameEn: "Ion Technology",
    group: "basic",
    baseCost: cost(1000, 300, 100),
    factor: 2,
    requires: [lab(4), tech("energy_tech", 4), tech("laser_tech", 5)],
    effect: "等离子技术、离子炮、巡洋舰的前置",
    later: "拆除费用 −4%/级（拆除随第 4 阶段）",
  },
  {
    id: "hyperspace_tech",
    nameZh: "超空间技术",
    nameEn: "Hyperspace Technology",
    group: "basic",
    baseCost: cost(0, 4000, 2000),
    factor: 2,
    requires: [lab(7), tech("energy_tech", 5), tech("shielding_tech", 5)],
    effect: "超空间引擎、星际研究网络的前置",
    later: "货舱 +5%/级（第 4 阶段舰队）",
  },
  {
    id: "plasma_tech",
    nameZh: "等离子技术",
    nameEn: "Plasma Technology",
    group: "basic",
    baseCost: cost(2000, 4000, 1000),
    factor: 2,
    requires: [lab(4), tech("energy_tech", 8), tech("laser_tech", 10), tech("ion_tech", 5)],
    effect: "矿产量：金属 +1%、晶体 +0.66%、重氢 +0.33%（每级）",
  },
  {
    id: "combustion_drive",
    nameZh: "燃烧引擎",
    nameEn: "Combustion Drive",
    group: "drive",
    baseCost: cost(400, 0, 600),
    factor: 2,
    requires: [lab(1), tech("energy_tech", 1)],
    effect: "燃烧引擎舰船速度 +10%/级（舰船卡片显示）",
    later: "飞行时间（第 4 阶段）",
  },
  {
    id: "impulse_drive",
    nameZh: "脉冲引擎",
    nameEn: "Impulse Drive",
    group: "drive",
    baseCost: cost(2000, 4000, 600),
    factor: 2,
    requires: [lab(2), tech("energy_tech", 1)],
    effect: "天体物理学的前置",
    later: "脉冲引擎舰船速度 +20%/级（舰船卡片显示，飞行第 4 阶段）；导弹射程 5L−1 个恒星系（第 5 阶段）",
  },
  {
    id: "hyperspace_drive",
    nameZh: "超空间引擎",
    nameEn: "Hyperspace Drive",
    group: "drive",
    baseCost: cost(10000, 20000, 6000),
    factor: 2,
    requires: [lab(7), tech("hyperspace_tech", 3)],
    effect: "高级舰船前置；超空间引擎舰船速度 +30%/级（舰船卡片显示）",
    later: "飞行时间（第 4 阶段）",
  },
  {
    id: "espionage_tech",
    nameZh: "间谍技术",
    nameEn: "Espionage Technology",
    group: "advanced",
    baseCost: cost(200, 1000, 200),
    factor: 2,
    requires: [lab(3)],
    effect: "天体物理学的前置",
    later: "侦察报告详细度、看清来袭舰队（第 4–5 阶段）",
  },
  {
    id: "computer_tech",
    nameZh: "计算机技术",
    nameEn: "Computer Technology",
    group: "advanced",
    baseCost: cost(0, 400, 600),
    factor: 2,
    requires: [lab(1)],
    effect: "每 2 级 +1 协议卡槽（上限 12）；纳米机器人工厂需要 10 级",
    later: "舰队槽 +1/级（第 4 阶段）",
  },
  {
    id: "astrophysics",
    nameZh: "天体物理学",
    nameEn: "Astrophysics",
    group: "advanced",
    baseCost: cost(4000, 8000, 4000),
    factor: 1.75,
    roundTo: 100,
    requires: [lab(3), tech("espionage_tech", 4), tech("impulse_drive", 3)],
    effect: "1 级解锁深空星环机（信标版）",
    later: "殖民地数 ⌈L/2⌉、远征槽 ⌊√L⌋（第 4 阶段）",
  },
  {
    id: "intergalactic_research_network",
    nameZh: "星际研究网络",
    nameEn: "Intergalactic Research Network",
    group: "advanced",
    baseCost: cost(240000, 400000, 160000),
    factor: 2,
    requires: [lab(10), tech("computer_tech", 8), tech("hyperspace_tech", 8)],
    effect: "联通 L 个额外研究实验室（只有一颗星球时没有效果）",
    later: "多星球后生效（第 4 阶段）",
  },
  {
    id: "graviton_tech",
    nameZh: "引力技术",
    nameEn: "Graviton Technology",
    group: "advanced",
    baseCost: cost(0, 0, 0, 300000),
    factor: 3,
    requires: [lab(12)],
    effect: "不花资源，要求当前能源供给 ≥ 所需能源（不消耗）",
    later: "死星前置",
  },
  {
    id: "weapons_tech",
    nameZh: "武器技术",
    nameEn: "Weapons Technology",
    group: "combat",
    baseCost: cost(800, 200, 0),
    factor: 2,
    requires: [lab(4)],
    effect: "舰船与防御攻击 +10%/级（卡片显示）",
    later: "战斗第 5 阶段",
  },
  {
    id: "shielding_tech",
    nameZh: "护盾技术",
    nameEn: "Shielding Technology",
    group: "combat",
    baseCost: cost(200, 600, 0),
    factor: 2,
    requires: [lab(6), tech("energy_tech", 3)],
    effect: "舰船与防御护盾 +10%/级（卡片显示）；超空间技术的前置",
    later: "战斗第 5 阶段",
  },
  {
    id: "armour_tech",
    nameZh: "装甲技术",
    nameEn: "Armour Technology",
    group: "combat",
    baseCost: cost(1000, 0, 0),
    factor: 2,
    requires: [lab(2)],
    effect: "舰船与防御结构 +10%/级（卡片显示）",
    later: "战斗第 5 阶段",
  },
];

const BY_ID = Object.fromEntries(RESEARCH.map((def) => [def.id, def])) as Record<ResearchId, ResearchDef>;

export function researchById(id: ResearchId): ResearchDef {
  return BY_ID[id];
}

export function isResearchId(value: string): value is ResearchId {
  return Object.prototype.hasOwnProperty.call(BY_ID, value);
}

/** Plasma technology bonus per level on mine output (OGame). */
export const PLASMA_BONUS = { metal: 0.01, crystal: 0.0066, deuterium: 0.0033 } as const;
