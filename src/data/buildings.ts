/**
 * OGame building table (design doc §5.1). Every building of every phase is listed so later
 * phases only flip `phase` and add logic. Buildings with `phase > CURRENT_PHASE` are hidden
 * in the UI and cannot be queued.
 */

/**
 * Gameplay phase currently shipped. P1 = buildings, storage, build times and the build queue;
 * P2 = research (research queue, prerequisites, research effects); P3 = shipyard, ships, defenses, missile silo.
 */
export const CURRENT_PHASE = 3;

export const BUILDING_IDS = [
  "metal_mine",
  "crystal_mine",
  "deuterium_synth",
  "solar_plant",
  "fusion_reactor",
  "metal_storage",
  "crystal_storage",
  "deuterium_tank",
  "robotics_factory",
  "nanite_factory",
  "shipyard",
  "research_lab",
  "missile_silo",
  "alliance_depot",
  "terraformer",
  "space_dock",
  "lunar_base",
  "sensor_phalanx",
  "jump_gate",
] as const;

export type BuildingId = (typeof BUILDING_IDS)[number];

/** Buildings with a 0–100% production setting (OGame "resource settings"). */
export const PRODUCTION_IDS = [
  "metal_mine",
  "crystal_mine",
  "deuterium_synth",
  "solar_plant",
  "fusion_reactor",
] as const satisfies readonly BuildingId[];

export type ProductionBuildingId = (typeof PRODUCTION_IDS)[number];

export type BuildingCategory = "resource" | "facility" | "moon";

export interface BuildingRequirement {
  kind: "building" | "research";
  id: string;
  level: number;
}

export interface BuildingDef {
  id: BuildingId;
  nameZh: string;
  nameEn: string;
  category: BuildingCategory;
  /** First phase in which the building can be seen and queued. */
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  /** Cost of level 1. Level L costs ⌊base × factor^(L−1)⌋. Energy is a requirement, not spent (P4+). */
  baseCost: { metal: number; crystal: number; deuterium: number; energy: number };
  factor: number;
  /** Building and research requirements. Checked from P2 on (finished levels only). */
  requires: readonly BuildingRequirement[];
  /** OGame's MAX(4 − L/2, 1) low-level speed-up. Nanite factory and moon buildings do not get it. */
  earlyLevelSpeedup: boolean;
  blurb: string;
}

const cost = (metal: number, crystal: number, deuterium: number, energy = 0) => ({ metal, crystal, deuterium, energy });

export const BUILDINGS: readonly BuildingDef[] = [
  {
    id: "metal_mine",
    nameZh: "金属矿",
    nameEn: "Metal Mine",
    category: "resource",
    phase: 1,
    baseCost: cost(60, 15, 0),
    factor: 1.5,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "开采金属。产量 30·L·1.1^L /小时，耗电 10·L·1.1^L。",
  },
  {
    id: "crystal_mine",
    nameZh: "晶体矿",
    nameEn: "Crystal Mine",
    category: "resource",
    phase: 1,
    baseCost: cost(48, 24, 0),
    factor: 1.6,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "开采晶体。产量 20·L·1.1^L /小时，耗电 10·L·1.1^L。",
  },
  {
    id: "deuterium_synth",
    nameZh: "重氢合成器",
    nameEn: "Deuterium Synthesizer",
    category: "resource",
    phase: 1,
    baseCost: cost(225, 75, 0),
    factor: 1.5,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "合成重氢，星球越冷产量越高。产量 10·L·1.1^L·(1.44−0.004·T) /小时，耗电 20·L·1.1^L。",
  },
  {
    id: "solar_plant",
    nameZh: "太阳能电站",
    nameEn: "Solar Plant",
    category: "resource",
    phase: 1,
    baseCost: cost(75, 30, 0),
    factor: 1.5,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "供电 20·L·1.1^L。能源不足时所有矿按比例降效。",
  },
  {
    id: "fusion_reactor",
    nameZh: "核聚变反应堆",
    nameEn: "Fusion Reactor",
    category: "resource",
    phase: 1,
    baseCost: cost(900, 360, 180),
    factor: 1.8,
    requires: [
      { kind: "building", id: "deuterium_synth", level: 5 },
      { kind: "research", id: "energy_tech", level: 3 },
    ],
    earlyLevelSpeedup: true,
    blurb: "燃烧重氢供电 30·L·(1.05+0.01·能源技术)^L，耗重氢 10·L·1.1^L /小时。",
  },
  {
    id: "metal_storage",
    nameZh: "金属仓库",
    nameEn: "Metal Storage",
    category: "resource",
    phase: 1,
    baseCost: cost(1000, 0, 0),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "金属上限 5000·⌊2.5·e^(20L/33)⌋。满仓后金属产出停止。",
  },
  {
    id: "crystal_storage",
    nameZh: "晶体仓库",
    nameEn: "Crystal Storage",
    category: "resource",
    phase: 1,
    baseCost: cost(1000, 500, 0),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "晶体上限 5000·⌊2.5·e^(20L/33)⌋。满仓后晶体产出停止。",
  },
  {
    id: "deuterium_tank",
    nameZh: "重氢罐",
    nameEn: "Deuterium Tank",
    category: "resource",
    phase: 1,
    baseCost: cost(1000, 1000, 0),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "重氢上限 5000·⌊2.5·e^(20L/33)⌋。满仓后重氢产出停止。",
  },
  {
    id: "robotics_factory",
    nameZh: "机器人工厂",
    nameEn: "Robotics Factory",
    category: "facility",
    phase: 1,
    baseCost: cost(400, 120, 200),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "建造时间 ÷(1+等级)。每 2 级额外开放 1 个协议卡槽（与计算机技术合计最多 12 个）。",
  },
  {
    id: "nanite_factory",
    nameZh: "纳米机器人工厂",
    nameEn: "Nanite Factory",
    category: "facility",
    phase: 1,
    baseCost: cost(1_000_000, 500_000, 100_000),
    factor: 2,
    requires: [
      { kind: "building", id: "robotics_factory", level: 10 },
      { kind: "research", id: "computer_tech", level: 10 },
    ],
    earlyLevelSpeedup: false,
    blurb: "建造与造船时间每级 ÷2。不享受低等级加速；升级期间造船暂停。",
  },
  {
    id: "shipyard",
    nameZh: "造船厂",
    nameEn: "Shipyard",
    category: "facility",
    phase: 1,
    baseCost: cost(400, 200, 100),
    factor: 2,
    requires: [{ kind: "building", id: "robotics_factory", level: 2 }],
    earlyLevelSpeedup: true,
    blurb: "建造舰船与防御。每级造船时间 ÷(1+等级)；升级期间造船暂停。",
  },
  {
    id: "research_lab",
    nameZh: "研究实验室",
    nameEn: "Research Lab",
    category: "facility",
    phase: 1,
    baseCost: cost(200, 400, 200),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "进行研究。研究时间 = (金属+晶体)/(1000·(1+等级)) 小时 ÷ 研究速度。研究进行中不能升级。",
  },
  {
    id: "missile_silo",
    nameZh: "导弹井",
    nameEn: "Missile Silo",
    category: "facility",
    phase: 3,
    baseCost: cost(20_000, 20_000, 1_000),
    factor: 2,
    requires: [{ kind: "building", id: "shipyard", level: 1 }],
    earlyLevelSpeedup: true,
    blurb: "每级存 10 枚反导或 5 枚星际导弹。",
  },
  {
    id: "alliance_depot",
    nameZh: "联盟仓库",
    nameEn: "Alliance Depot",
    category: "facility",
    phase: 6,
    baseCost: cost(20_000, 40_000, 0),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: true,
    blurb: "为驻守的友军舰队补给重氢。",
  },
  {
    id: "terraformer",
    nameZh: "地形改造器",
    nameEn: "Terraformer",
    category: "facility",
    phase: 4,
    baseCost: cost(0, 50_000, 100_000, 1_000),
    factor: 2,
    requires: [
      { kind: "building", id: "nanite_factory", level: 1 },
      { kind: "research", id: "energy_tech", level: 12 },
    ],
    earlyLevelSpeedup: true,
    blurb: "每级 +5 格。",
  },
  {
    id: "space_dock",
    nameZh: "太空船坞",
    nameEn: "Space Dock",
    category: "facility",
    phase: 5,
    baseCost: cost(200, 0, 50, 50),
    factor: 5,
    requires: [{ kind: "building", id: "shipyard", level: 2 }],
    earlyLevelSpeedup: true,
    blurb: "战后修复部分舰船。",
  },
  {
    id: "lunar_base",
    nameZh: "月球基地",
    nameEn: "Lunar Base",
    category: "moon",
    phase: 5,
    baseCost: cost(20_000, 40_000, 20_000),
    factor: 2,
    requires: [],
    earlyLevelSpeedup: false,
    blurb: "月球每级 +3 格。仅月球。",
  },
  {
    id: "sensor_phalanx",
    nameZh: "感应相位雷达",
    nameEn: "Sensor Phalanx",
    category: "moon",
    phase: 6,
    baseCost: cost(20_000, 40_000, 20_000),
    factor: 2,
    requires: [{ kind: "building", id: "lunar_base", level: 1 }],
    earlyLevelSpeedup: false,
    blurb: "侦测范围 L²−1 个恒星系。",
  },
  {
    id: "jump_gate",
    nameZh: "跳跃门",
    nameEn: "Jump Gate",
    category: "moon",
    phase: 6,
    baseCost: cost(2_000_000, 4_000_000, 2_000_000),
    factor: 2,
    requires: [
      { kind: "building", id: "lunar_base", level: 1 },
      { kind: "research", id: "hyperspace_tech", level: 7 },
    ],
    earlyLevelSpeedup: false,
    blurb: "月球之间瞬移舰队。",
  },
];

const BY_ID = Object.fromEntries(BUILDINGS.map((def) => [def.id, def])) as Record<BuildingId, BuildingDef>;

export function buildingById(id: BuildingId): BuildingDef {
  return BY_ID[id];
}

export function isBuildingId(value: string): value is BuildingId {
  return Object.prototype.hasOwnProperty.call(BY_ID, value);
}

export function isProductionId(value: string): value is ProductionBuildingId {
  return (PRODUCTION_IDS as readonly string[]).includes(value);
}

/** Buildings the player can see and queue in the current phase, in table order. */
export function activeBuildings(): BuildingDef[] {
  return BUILDINGS.filter((def) => def.phase <= CURRENT_PHASE);
}
