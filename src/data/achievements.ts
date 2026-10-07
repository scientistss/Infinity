import { activePlanet } from "../game/empire";
import { big, type BigNumber } from "../game/decimal";
import type { GameState } from "../game/types";
import { DEFENSE_IDS, SHIP_IDS } from "./units";

/** Each unlocked achievement adds this much global output. Bonuses add, they do not compound. */
export const ACHIEVEMENT_BONUS = 0.01;

export interface AchievementProgress {
  current: BigNumber;
  goal: BigNumber;
  /** Amounts use scientific formatting. Counts stay as integers. */
  amount: boolean;
}

export interface AchievementDef {
  id: string;
  name: string;
  detail: string;
  met: (state: GameState) => boolean;
  progress: (state: GameState) => AchievementProgress;
}

function count(current: number, goal: number): AchievementProgress {
  return { current: big(Math.max(0, current)), goal: big(goal), amount: false };
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first_metal_mine",
    name: "金属矿 1 级",
    detail: "金属矿达到 1 级",
    met: (state) => activePlanet(state).buildings.metal_mine >= 1,
    progress: (state) => count(activePlanet(state).buildings.metal_mine, 1),
  },
  {
    id: "energy_short",
    name: "能源不足",
    detail: "能源需求曾经高于供给",
    met: (state) => state.stats.seenEnergyShort,
    progress: (state) => count(state.stats.seenEnergyShort ? 1 : 0, 1),
  },
  {
    id: "first_protocol",
    name: "首张协议卡",
    detail: "手动采集 100 次，达到「自动采集」解锁线",
    met: (state) => state.stats.scrapes >= 100,
    progress: (state) => count(state.stats.scrapes, 100),
  },
  {
    id: "mines_10",
    name: "金属矿 10 级",
    detail: "金属矿达到 10 级",
    met: (state) => activePlanet(state).buildings.metal_mine >= 10,
    progress: (state) => count(activePlanet(state).buildings.metal_mine, 10),
  },
  {
    id: "first_crystal",
    name: "晶体开采",
    detail: "晶体矿达到 1 级",
    met: (state) => activePlanet(state).buildings.crystal_mine >= 1,
    progress: (state) => count(activePlanet(state).buildings.crystal_mine, 1),
  },
  {
    id: "first_deuterium",
    name: "重氢合成",
    detail: "重氢合成器达到 1 级",
    met: (state) => activePlanet(state).buildings.deuterium_synth >= 1,
    progress: (state) => count(activePlanet(state).buildings.deuterium_synth, 1),
  },
  {
    id: "first_robotics",
    name: "机器上线",
    detail: "机器人工厂达到 1 级",
    met: (state) => activePlanet(state).buildings.robotics_factory >= 1,
    progress: (state) => count(activePlanet(state).buildings.robotics_factory, 1),
  },
  {
    id: "metal_1e9",
    name: "十亿金属",
    detail: "本轮累计获得 1e9 金属",
    met: (state) => state.lifetime.metal.gte(1e9),
    progress: (state) => ({ current: state.lifetime.metal, goal: big(1e9), amount: true }),
  },
  {
    id: "first_launch",
    name: "首次发射",
    detail: "成功发射殖民舰 1 次",
    met: (state) => state.stats.launches >= 1,
    progress: (state) => count(state.stats.launches, 1),
  },
  {
    id: "automated_loop",
    name: "完全自动化一轮",
    detail: "一整轮不手动采集、不手动入队建筑，并完成发射",
    met: (state) => state.stats.automatedLaunches >= 1,
    progress: (state) => count(state.stats.automatedLaunches, 1),
  },
  {
    id: "first_storage",
    name: "第一座仓库",
    detail: "任意一种仓库（金属仓库、晶体仓库、重氢罐）达到 1 级",
    met: (state) => storageLevel(state) >= 1,
    progress: (state) => count(storageLevel(state), 1),
  },
  {
    id: "fusion_ignition",
    name: "核聚变点火",
    detail: "核聚变反应堆达到 1 级",
    met: (state) => activePlanet(state).buildings.fusion_reactor >= 1,
    progress: (state) => count(activePlanet(state).buildings.fusion_reactor, 1),
  },
  {
    id: "nanite_age",
    name: "纳米时代",
    detail: "纳米机器人工厂达到 1 级",
    met: (state) => activePlanet(state).buildings.nanite_factory >= 1,
    progress: (state) => count(activePlanet(state).buildings.nanite_factory, 1),
  },
  {
    id: "first_lab",
    name: "研究实验室落成",
    detail: "研究实验室达到 1 级",
    met: (state) => activePlanet(state).buildings.research_lab >= 1,
    progress: (state) => count(activePlanet(state).buildings.research_lab, 1),
  },
  {
    id: "first_research",
    name: "第一项研究",
    detail: "完成任意一级研究",
    met: (state) => researchTotal(state) >= 1,
    progress: (state) => count(researchTotal(state), 1),
  },
  {
    id: "computer_4",
    name: "协议扩容",
    detail: "计算机技术达到 4 级（多 2 个协议卡槽）",
    met: (state) => state.research.levels.computer_tech >= 4,
    progress: (state) => count(state.research.levels.computer_tech, 4),
  },
  {
    id: "astrophysics_1",
    name: "仰望深空",
    detail: "天体物理学达到 1 级",
    met: (state) => state.research.levels.astrophysics >= 1,
    progress: (state) => count(state.research.levels.astrophysics, 1),
  },
  {
    id: "plasma_1",
    name: "等离子时代",
    detail: "等离子技术达到 1 级",
    met: (state) => state.research.levels.plasma_tech >= 1,
    progress: (state) => count(state.research.levels.plasma_tech, 1),
  },
  {
    id: "first_shipyard",
    name: "造船厂",
    detail: "造船厂达到 1 级（打开造船厂与防御标签）",
    met: (state) => activePlanet(state).buildings.shipyard >= 1,
    progress: (state) => count(activePlanet(state).buildings.shipyard, 1),
  },
  {
    id: "first_ship",
    name: "第一艘舰船",
    detail: "造出第一艘能飞的舰船（太阳能卫星不算）",
    met: (state) => flyingShips(state) >= 1,
    progress: (state) => count(Math.min(1, flyingShips(state)), 1),
  },
  {
    id: "first_satellite",
    name: "轨道电站",
    detail: "造出第一颗太阳能卫星",
    met: (state) => activePlanet(state).units.solar_satellite >= 1,
    progress: (state) => count(Math.min(1, activePlanet(state).units.solar_satellite), 1),
  },
  {
    id: "first_defense",
    name: "设防",
    detail: "造出第一座防御设施",
    met: (state) => defenseCount(state) >= 1,
    progress: (state) => count(Math.min(1, defenseCount(state)), 1),
  },
];

function flyingShips(state: GameState): number {
  let total = 0;
  for (const id of SHIP_IDS) if (id !== "solar_satellite") total += activePlanet(state).units[id];
  return total;
}

function defenseCount(state: GameState): number {
  let total = 0;
  for (const id of DEFENSE_IDS) total += activePlanet(state).units[id];
  return total;
}

function researchTotal(state: GameState): number {
  let total = 0;
  for (const level of Object.values(state.research.levels)) total += level;
  return total;
}

function storageLevel(state: GameState): number {
  const b = activePlanet(state).buildings;
  return Math.max(b.metal_storage, b.crystal_storage, b.deuterium_tank);
}

const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((def) => [def.id, def])) as Record<string, AchievementDef>;

export function achievementById(id: string): AchievementDef | undefined {
  return BY_ID[id];
}

export function isAchievementId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(BY_ID, id);
}

/** 1 + 1% per unlocked achievement. */
export function achievementFactor(state: GameState): BigNumber {
  return big(1).add(state.unlocked.length * ACHIEVEMENT_BONUS);
}

export function unlockBanner(ids: readonly string[]): string | null {
  if (ids.length === 0) return null;
  const names = ids.map((id) => achievementById(id)?.name ?? id).join("、");
  return `成就解锁：${names}。每项 +1% 全局产出。`;
}
