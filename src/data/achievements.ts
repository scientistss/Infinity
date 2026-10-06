import { big, type BigNumber } from "../game/decimal";
import type { GameState } from "../game/types";

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
    met: (state) => state.planet.buildings.metal_mine >= 1,
    progress: (state) => count(state.planet.buildings.metal_mine, 1),
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
    met: (state) => state.planet.buildings.metal_mine >= 10,
    progress: (state) => count(state.planet.buildings.metal_mine, 10),
  },
  {
    id: "first_crystal",
    name: "晶体开采",
    detail: "晶体矿达到 1 级",
    met: (state) => state.planet.buildings.crystal_mine >= 1,
    progress: (state) => count(state.planet.buildings.crystal_mine, 1),
  },
  {
    id: "first_deuterium",
    name: "重氢合成",
    detail: "重氢合成器达到 1 级",
    met: (state) => state.planet.buildings.deuterium_synth >= 1,
    progress: (state) => count(state.planet.buildings.deuterium_synth, 1),
  },
  {
    id: "first_robotics",
    name: "机器上线",
    detail: "机器人工厂达到 1 级",
    met: (state) => state.planet.buildings.robotics_factory >= 1,
    progress: (state) => count(state.planet.buildings.robotics_factory, 1),
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
    met: (state) => state.planet.buildings.fusion_reactor >= 1,
    progress: (state) => count(state.planet.buildings.fusion_reactor, 1),
  },
  {
    id: "nanite_age",
    name: "纳米时代",
    detail: "纳米机器人工厂达到 1 级",
    met: (state) => state.planet.buildings.nanite_factory >= 1,
    progress: (state) => count(state.planet.buildings.nanite_factory, 1),
  },
];

function storageLevel(state: GameState): number {
  const b = state.planet.buildings;
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
