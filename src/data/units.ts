/**
 * OGame ships and defenses (design doc §7.2–§7.4, P3). Pure data: costs, combat stats, cargo, speed,
 * fuel, drives, requirements and the rapid-fire table. Combat itself arrives in P5, flights in P4;
 * P3 builds the units and shows their stats.
 */
import type { ResearchId } from "./research";

export const SHIP_IDS = [
  "small_cargo",
  "large_cargo",
  "light_fighter",
  "heavy_fighter",
  "cruiser",
  "battleship",
  "battlecruiser",
  "bomber",
  "destroyer",
  "deathstar",
  "recycler",
  "espionage_probe",
  "solar_satellite",
  "colony_ship",
] as const;

export const DEFENSE_IDS = [
  "rocket_launcher",
  "light_laser",
  "heavy_laser",
  "gauss_cannon",
  "ion_cannon",
  "plasma_turret",
  "small_shield_dome",
  "large_shield_dome",
  "anti_ballistic_missile",
  "interplanetary_missile",
] as const;

export type ShipId = (typeof SHIP_IDS)[number];
export type DefenseId = (typeof DEFENSE_IDS)[number];
export type UnitId = ShipId | DefenseId;
export const UNIT_IDS: readonly UnitId[] = [...SHIP_IDS, ...DEFENSE_IDS];

export type DriveId = "combustion_drive" | "impulse_drive" | "hyperspace_drive";

/** Speed bonus per drive level (OGame): combustion +10%, impulse +20%, hyperspace +30%. */
export const DRIVE_BONUS: Record<DriveId, number> = { combustion_drive: 0.1, impulse_drive: 0.2, hyperspace_drive: 0.3 };
export const DRIVE_NAME: Record<DriveId, string> = { combustion_drive: "燃烧", impulse_drive: "脉冲", hyperspace_drive: "超空间" };

/** One engine stage: from `level` of `drive` on, the ship flies with this base speed and fuel use. */
export interface DriveStage {
  drive: DriveId;
  level: number;
  speed: number;
  fuel: number;
}

export interface UnitRequirement {
  kind: "building" | "research";
  id: string;
  level: number;
}

export interface UnitDef {
  id: UnitId;
  kind: "ship" | "defense";
  nameZh: string;
  nameEn: string;
  cost: { metal: number; crystal: number; deuterium: number };
  /** OGame display value (metal + crystal); combat hull is this / 10 (P5). */
  structure: number;
  shield: number;
  attack: number;
  cargo: number;
  /** Engine stages, lowest first; the last stage whose requirement is met applies. Empty = cannot fly. */
  drives: readonly DriveStage[];
  requires: readonly UnitRequirement[];
  /** Shield domes: at most one each. */
  maxCount?: number;
  /** Missile silo slots taken by one missile (10 slots per silo level). */
  siloSlots?: number;
  blurb: string;
}

const c = (metal: number, crystal: number, deuterium: number) => ({ metal, crystal, deuterium });
const sy = (level: number): UnitRequirement => ({ kind: "building", id: "shipyard", level });
const silo = (level: number): UnitRequirement => ({ kind: "building", id: "missile_silo", level });
const t = (id: ResearchId, level: number): UnitRequirement => ({ kind: "research", id, level });
const stage = (drive: DriveId, level: number, speed: number, fuel: number): DriveStage => ({ drive, level, speed, fuel });

export const UNITS: readonly UnitDef[] = [
  {
    id: "small_cargo", kind: "ship", nameZh: "小型运输舰", nameEn: "Small Cargo", cost: c(2000, 2000, 0),
    structure: 4000, shield: 10, attack: 5, cargo: 5000,
    drives: [stage("combustion_drive", 0, 5000, 10), stage("impulse_drive", 5, 10000, 20)],
    requires: [sy(2), t("combustion_drive", 2)],
    blurb: "便宜的运输舰。脉冲引擎 5 级后换装脉冲引擎，速度翻倍。",
  },
  {
    id: "large_cargo", kind: "ship", nameZh: "大型运输舰", nameEn: "Large Cargo", cost: c(6000, 6000, 0),
    structure: 12000, shield: 25, attack: 5, cargo: 25000,
    drives: [stage("combustion_drive", 0, 7500, 50)],
    requires: [sy(4), t("combustion_drive", 6)],
    blurb: "货舱是小运的 5 倍，搬运主力。",
  },
  {
    id: "light_fighter", kind: "ship", nameZh: "轻型战斗机", nameEn: "Light Fighter", cost: c(3000, 1000, 0),
    structure: 4000, shield: 10, attack: 50, cargo: 50,
    drives: [stage("combustion_drive", 0, 12500, 20)],
    requires: [sy(1), t("combustion_drive", 1)],
    blurb: "最早的战斗舰，便宜、量大。",
  },
  {
    id: "heavy_fighter", kind: "ship", nameZh: "重型战斗机", nameEn: "Heavy Fighter", cost: c(6000, 4000, 0),
    structure: 10000, shield: 25, attack: 150, cargo: 100,
    drives: [stage("impulse_drive", 0, 10000, 75)],
    requires: [sy(3), t("armour_tech", 2), t("impulse_drive", 2)],
    blurb: "比轻战更结实，对小型运输舰有快速射击。",
  },
  {
    id: "cruiser", kind: "ship", nameZh: "巡洋舰", nameEn: "Cruiser", cost: c(20000, 7000, 2000),
    structure: 27000, shield: 50, attack: 400, cargo: 800,
    drives: [stage("impulse_drive", 0, 15000, 300)],
    requires: [sy(5), t("impulse_drive", 4), t("ion_tech", 2)],
    blurb: "快速的中型战舰，克制轻型战斗机和火箭发射器。",
  },
  {
    id: "battleship", kind: "ship", nameZh: "战列舰", nameEn: "Battleship", cost: c(45000, 15000, 0),
    structure: 60000, shield: 200, attack: 1000, cargo: 1500,
    drives: [stage("hyperspace_drive", 0, 10000, 500)],
    requires: [sy(7), t("hyperspace_drive", 4)],
    blurb: "舰队的中坚，攻防均衡。",
  },
  {
    id: "battlecruiser", kind: "ship", nameZh: "战列巡洋舰", nameEn: "Battlecruiser", cost: c(30000, 40000, 15000),
    structure: 70000, shield: 400, attack: 700, cargo: 750,
    drives: [stage("hyperspace_drive", 0, 10000, 250)],
    requires: [sy(8), t("hyperspace_tech", 5), t("hyperspace_drive", 5), t("laser_tech", 12)],
    blurb: "专门拦截舰队的快船，对多种舰船有快速射击。",
  },
  {
    id: "bomber", kind: "ship", nameZh: "轰炸机", nameEn: "Bomber", cost: c(50000, 25000, 15000),
    structure: 75000, shield: 500, attack: 1000, cargo: 500,
    drives: [stage("impulse_drive", 0, 4000, 700), stage("hyperspace_drive", 8, 5000, 700)],
    requires: [sy(8), t("impulse_drive", 6), t("plasma_tech", 5)],
    blurb: "拆防御用，对所有炮台有快速射击。超空间引擎 8 级后换装。",
  },
  {
    id: "destroyer", kind: "ship", nameZh: "毁灭者", nameEn: "Destroyer", cost: c(60000, 50000, 15000),
    structure: 110000, shield: 500, attack: 2000, cargo: 2000,
    drives: [stage("hyperspace_drive", 0, 5000, 1000)],
    requires: [sy(9), t("hyperspace_drive", 6), t("hyperspace_tech", 5)],
    blurb: "重型战舰，克制轻型激光炮和战列巡洋舰。",
  },
  {
    id: "deathstar", kind: "ship", nameZh: "死星", nameEn: "Deathstar", cost: c(5_000_000, 4_000_000, 1_000_000),
    structure: 9_000_000, shield: 50000, attack: 200000, cargo: 1_000_000,
    drives: [stage("hyperspace_drive", 0, 100, 1)],
    requires: [sy(12), t("hyperspace_drive", 7), t("hyperspace_tech", 6), t("graviton_tech", 1)],
    blurb: "月球大小的战斗站，对几乎所有单位有极高的快速射击。",
  },
  {
    id: "recycler", kind: "ship", nameZh: "回收船", nameEn: "Recycler", cost: c(10000, 6000, 2000),
    structure: 16000, shield: 10, attack: 1, cargo: 20000,
    drives: [stage("combustion_drive", 0, 2000, 300), stage("impulse_drive", 17, 4000, 600), stage("hyperspace_drive", 15, 6000, 900)],
    requires: [sy(4), t("combustion_drive", 6), t("shielding_tech", 2)],
    blurb: "回收残骸场（第 5 阶段）。脉冲 17 级、超空间 15 级后先后换装。",
  },
  {
    id: "espionage_probe", kind: "ship", nameZh: "间谍卫星", nameEn: "Espionage Probe", cost: c(0, 1000, 0),
    structure: 1000, shield: 0.01, attack: 0.01, cargo: 5,
    drives: [stage("combustion_drive", 0, 100_000_000, 1)],
    requires: [sy(3), t("combustion_drive", 3), t("espionage_tech", 2)],
    blurb: "侦察用（第 4 阶段起）。极快，几乎没有战斗力。",
  },
  {
    id: "solar_satellite", kind: "ship", nameZh: "太阳能卫星", nameEn: "Solar Satellite", cost: c(0, 2000, 500),
    structure: 2000, shield: 1, attack: 1, cargo: 0,
    drives: [],
    requires: [sy(1)],
    blurb: "停在轨道上供电，每颗 ⌊(最高温度 + 140) / 6⌋ 能源，不能飞。第 5 阶段起会被攻击。",
  },
  {
    id: "colony_ship", kind: "ship", nameZh: "殖民船", nameEn: "Colony Ship", cost: c(10000, 20000, 10000),
    structure: 30000, shield: 100, attack: 50, cargo: 7500,
    drives: [stage("impulse_drive", 0, 2500, 1000)],
    requires: [sy(4), t("impulse_drive", 3)],
    blurb: "开拓殖民地用（第 4 阶段）。与重置用的「发射殖民舰」不是一回事。",
  },
  {
    id: "rocket_launcher", kind: "defense", nameZh: "火箭发射器", nameEn: "Rocket Launcher", cost: c(2000, 0, 0),
    structure: 2000, shield: 20, attack: 80, cargo: 0, drives: [],
    requires: [sy(1)],
    blurb: "最便宜的防御，只要金属。",
  },
  {
    id: "light_laser", kind: "defense", nameZh: "轻型激光炮", nameEn: "Light Laser", cost: c(1500, 500, 0),
    structure: 2000, shield: 25, attack: 100, cargo: 0, drives: [],
    requires: [sy(2), t("energy_tech", 1), t("laser_tech", 3)],
    blurb: "火箭发射器的升级版。",
  },
  {
    id: "heavy_laser", kind: "defense", nameZh: "重型激光炮", nameEn: "Heavy Laser", cost: c(6000, 2000, 0),
    structure: 8000, shield: 100, attack: 250, cargo: 0, drives: [],
    requires: [sy(4), t("energy_tech", 3), t("laser_tech", 6)],
    blurb: "中期防御主力。",
  },
  {
    id: "gauss_cannon", kind: "defense", nameZh: "高斯炮", nameEn: "Gauss Cannon", cost: c(20000, 15000, 2000),
    structure: 35000, shield: 200, attack: 1100, cargo: 0, drives: [],
    requires: [sy(6), t("energy_tech", 6), t("weapons_tech", 3), t("shielding_tech", 1)],
    blurb: "电磁加速炮，单发伤害高。",
  },
  {
    id: "ion_cannon", kind: "defense", nameZh: "离子炮", nameEn: "Ion Cannon", cost: c(2000, 6000, 0),
    structure: 8000, shield: 500, attack: 150, cargo: 0, drives: [],
    requires: [sy(4), t("ion_tech", 4)],
    blurb: "护盾很厚的防御。",
  },
  {
    id: "plasma_turret", kind: "defense", nameZh: "等离子炮塔", nameEn: "Plasma Turret", cost: c(50000, 50000, 30000),
    structure: 100000, shield: 300, attack: 3000, cargo: 0, drives: [],
    requires: [sy(8), t("plasma_tech", 7)],
    blurb: "最强的炮台。",
  },
  {
    id: "small_shield_dome", kind: "defense", nameZh: "小型护盾罩", nameEn: "Small Shield Dome", cost: c(10000, 10000, 0),
    structure: 20000, shield: 2000, attack: 1, cargo: 0, drives: [],
    requires: [sy(1), t("shielding_tech", 2)], maxCount: 1,
    blurb: "罩住整个星球的护盾，每颗星球只能有 1 个。",
  },
  {
    id: "large_shield_dome", kind: "defense", nameZh: "大型护盾罩", nameEn: "Large Shield Dome", cost: c(50000, 50000, 0),
    structure: 100000, shield: 10000, attack: 1, cargo: 0, drives: [],
    requires: [sy(6), t("shielding_tech", 6)], maxCount: 1,
    blurb: "更强的星球护盾，同样限 1 个。",
  },
  {
    id: "anti_ballistic_missile", kind: "defense", nameZh: "反弹道导弹", nameEn: "Anti-Ballistic Missile", cost: c(8000, 0, 2000),
    structure: 8000, shield: 1, attack: 1, cargo: 0, drives: [],
    requires: [silo(2)], siloSlots: 1,
    blurb: "拦截来袭的星际导弹（第 5 阶段）。占导弹井 1 格。",
  },
  {
    id: "interplanetary_missile", kind: "defense", nameZh: "星际导弹", nameEn: "Interplanetary Missile", cost: c(12500, 2500, 10000),
    structure: 15000, shield: 1, attack: 12000, cargo: 0, drives: [],
    requires: [silo(4), t("impulse_drive", 1)], siloSlots: 2,
    blurb: "打击别人的防御（第 5 阶段）。占导弹井 2 格。",
  },
];

const BY_ID = Object.fromEntries(UNITS.map((def) => [def.id, def])) as Record<UnitId, UnitDef>;

export function emptyUnits(): Record<UnitId, number> {
  const out = {} as Record<UnitId, number>;
  for (const id of UNIT_IDS) out[id] = 0;
  return out;
}

export function unitById(id: UnitId): UnitDef {
  return BY_ID[id];
}

export function isUnitId(value: unknown): value is UnitId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BY_ID, value);
}

export const SHIPS: readonly UnitDef[] = UNITS.filter((def) => def.kind === "ship");
export const DEFENSES: readonly UnitDef[] = UNITS.filter((def) => def.kind === "defense");

/** Missile silo slots per level (10 ABM or 5 IPM per level). */
export const SILO_SLOTS_PER_LEVEL = 10;

/**
 * Rapid fire (design doc §7.4): shooter → target → RF. After a shot at a listed target the shooter fires again
 * with probability (RF − 1) / RF. P3 only shows it; combat uses it from P5.
 * Every ship except the deathstar has RF 5 against probes and satellites; as in OGame, probes and satellites
 * themselves have none.
 */
function buildRapidFire(): Record<UnitId, Partial<Record<UnitId, number>>> {
  const table = Object.fromEntries(UNIT_IDS.map((id) => [id, {}])) as Record<UnitId, Partial<Record<UnitId, number>>>;
  for (const id of SHIP_IDS) {
    if (id === "deathstar" || id === "espionage_probe" || id === "solar_satellite") continue;
    table[id].espionage_probe = 5;
    table[id].solar_satellite = 5;
  }
  Object.assign(table.heavy_fighter, { small_cargo: 3 });
  Object.assign(table.cruiser, { light_fighter: 6, rocket_launcher: 10 });
  Object.assign(table.battlecruiser, { small_cargo: 3, large_cargo: 3, heavy_fighter: 4, cruiser: 4, battleship: 7 });
  Object.assign(table.bomber, { rocket_launcher: 20, light_laser: 20, heavy_laser: 10, ion_cannon: 10, gauss_cannon: 5, plasma_turret: 5 });
  Object.assign(table.destroyer, { light_laser: 10, battlecruiser: 2 });
  Object.assign(table.deathstar, {
    espionage_probe: 1250, solar_satellite: 1250,
    small_cargo: 250, large_cargo: 250, recycler: 250, colony_ship: 250,
    light_fighter: 200, heavy_fighter: 100, cruiser: 33, battleship: 30, battlecruiser: 15, bomber: 25, destroyer: 5,
    rocket_launcher: 200, light_laser: 200, heavy_laser: 100, gauss_cannon: 50, ion_cannon: 100,
  });
  return table;
}

export const RAPID_FIRE: Readonly<Record<UnitId, Partial<Record<UnitId, number>>>> = buildRapidFire();

/** Units that `id` has rapid fire against, and units with rapid fire against `id`. */
export function rapidFireOf(id: UnitId): { against: Array<[UnitId, number]>; from: Array<[UnitId, number]> } {
  const against = Object.entries(RAPID_FIRE[id]) as Array<[UnitId, number]>;
  const from: Array<[UnitId, number]> = [];
  for (const shooter of UNIT_IDS) {
    const rf = RAPID_FIRE[shooter][id];
    if (rf) from.push([shooter, rf]);
  }
  return { against, from };
}

/**
 * Drifting-ships ladder for the ring machine (design doc §8.6.2): only unlocked ships and one tier above,
 * never the deathstar, colony ship, satellites or probes.
 */
export const DRIFTER_LADDER: readonly ShipId[] = [
  "light_fighter",
  "small_cargo",
  "heavy_fighter",
  "large_cargo",
  "cruiser",
  "recycler",
  "battleship",
  "battlecruiser",
  "bomber",
  "destroyer",
];
