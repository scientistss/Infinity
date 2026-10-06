import type { Action, Condition, ProtocolCard, Trigger } from "../data/protocol-cards";
import { ACHIEVEMENTS, isAchievementId } from "../data/achievements";
import { BUILDING_IDS, PRODUCTION_IDS, isBuildingId, isProductionId } from "../data/buildings";
import { isCatalogId, isResId, isStoredResId, refreshUnlocks } from "../automation/engine";
import { catchUp, emptyCatchup, type OfflineCatchup } from "../core/offline";
import { OFFLINE_BASE_HOURS, OFFLINE_MAX_HOURS, OFFLINE_PROTOCOL_SECONDS, SAVE_VERSION, STORAGE_KEY } from "./content";
import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { markEnergyShortage } from "./logic";
import { curvatureById } from "../data/curvature-tech";
import { emptyCurvature, offlineHoursFromTech } from "../prestige/tree";
import { createPlanet, type BuildOrder, type PlanetState } from "./planet";
import { RESEARCH_IDS, isResearchId, type ResearchId } from "../data/research";
import { createResearch, type ResearchOrder, type ResearchState } from "./research";
import { INVENTORY_IDS, type InventoryItemId } from "../data/dark-matter";
import type { Booster } from "./boosters";
import { cloneArcade, createArcade, emptyHits, type ArcadeState, type LightRoll, type PendingRun } from "./arcade";
import { ARCADE, ARCADE_SYMBOLS, BET_SYMBOLS, BOARD, LUCKY_TABLE, isArcadeSymbol, isBetSymbol } from "../data/arcade";
import { createDefaultProtocols, createInitialState, emptyProtocolSlot, emptyStats } from "./state";
import {
  CURVATURE_IDS,
  PROTOCOL_SLOT_COUNT,
  RESOURCE_IDS,
  type BuildingId,
  type CardLamp,
  type CurvatureId,
  type GameState,
  type PlayerStats,
  type ProductionBuildingId,
  type ProtocolLoadout,
  type ProtocolSlotState,
  type ResourceId,
} from "./types";

/** Highest level accepted from a file. OGame levels stay far below this. */
const MAX_LEVEL = 1000;
/** Longest queue a file may carry (OGame commander queue length; P1 capacity is 2). */
const MAX_QUEUE = 5;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SerializedOrder {
  building: BuildingId;
  targetLevel: number;
  paid: Record<ResourceId, string>;
  totalSeconds: number;
  remainingSeconds: number;
  source: "manual" | "protocol";
}

export interface SerializedPlanet {
  name: string;
  tempMax: number;
  fieldsMax: number;
  buildings: Record<BuildingId, number>;
  productionPct: Record<ProductionBuildingId, number>;
  buildQueue: SerializedOrder[];
}

export interface SerializedResearchOrder {
  tech: ResearchId;
  targetLevel: number;
  paid: Record<ResourceId, string>;
  totalSeconds: number;
  remainingSeconds: number;
  source: "manual" | "protocol";
}

export interface SerializedState {
  resources: Record<ResourceId, string>;
  planet: SerializedPlanet;
  research: { levels: Record<ResearchId, number>; queue: SerializedResearchOrder[] };
  darkMatter: string;
  /** Optional within v7 (added after the first v7 release); missing means empty. */
  items?: Record<InventoryItemId, number>;
  boosters?: Booster[];
  arcade?: ArcadeState;
  lifetime: Record<ResourceId, string>;
  warpCores: string;
  curvature: Record<CurvatureId, number>;
  totalTime: string;
  manualClicks: number;
  seenEnergyShortage: boolean;
  hasPrestiged: boolean;
  unlockedCards: string[];
  protocols: {
    accumulator: number;
    slots: Array<{
      elapsed: number;
      lamp: CardLamp;
      reason: string;
      card: ProtocolCard | null;
    }>;
  };
  unlocked: string[];
  stats: PlayerStats;
  offlineBonusHours: number;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  /** Wall clock of the last simulated tick. */
  lastTickAt: number;
  state: SerializedState;
}

/** Thrown when a file's version is not {@link SAVE_VERSION}. Test phase: no migration. */
export class SaveVersionError extends Error {
  constructor(readonly version: number) {
    super(
      version < SAVE_VERSION
        ? `存档版本 v${version} 已过时（当前 v${SAVE_VERSION}）。测试期不迁移旧存档，未导入，当前进度保持不变。`
        : `存档版本 v${version} 比游戏更新（当前 v${SAVE_VERSION}），未导入，当前进度保持不变。`,
    );
    this.name = "SaveVersionError";
  }
}

export interface LoadResult extends OfflineCatchup {
  /** One-time notice, e.g. an outdated save was replaced by a fresh game. */
  notice: string | null;
}

export function outdatedSaveNotice(version: number): string {
  return `测试版存档格式已更新（v${version} → v${SAVE_VERSION}），旧进度已重置。`;
}

export function serializeState(state: GameState): SerializedState {
  return {
    resources: mapResources(state.resources),
    planet: serializePlanet(state.planet),
    research: serializeResearch(state.research),
    darkMatter: bigToString(state.darkMatter),
    items: { ...state.items },
    boosters: state.boosters.map((booster) => ({ ...booster })),
    arcade: cloneArcade(state.arcade),
    lifetime: mapResources(state.lifetime),
    warpCores: bigToString(state.warpCores),
    curvature: { ...state.curvature },
    totalTime: bigToString(state.totalTime),
    manualClicks: state.manualClicks,
    seenEnergyShortage: state.seenEnergyShortage,
    hasPrestiged: state.hasPrestiged,
    unlockedCards: state.unlockedCards.slice(),
    protocols: serializeProtocols(state.protocols),
    unlocked: state.unlocked.slice(),
    stats: { ...state.stats },
    offlineBonusHours: state.offlineBonusHours,
  };
}

export function deserializeState(raw: unknown): GameState {
  if (!isRecord(raw)) throw new Error("存档状态格式不正确");
  const state = createInitialState();
  state.resources = readResourceMap(raw.resources, "资源");
  state.planet = readPlanet(raw.planet);
  state.research = readResearch(raw.research);
  state.darkMatter = raw.darkMatter === undefined ? big(0) : readAmount(raw.darkMatter, "暗物质");
  state.items = readItems(raw.items);
  state.boosters = readBoosters(raw.boosters);
  state.arcade = readArcade(raw.arcade);
  state.lifetime = readResourceMap(raw.lifetime, "累计产出");
  state.warpCores = readAmount(raw.warpCores, "曲率核心");
  state.curvature = readCurvature(raw.curvature);
  state.totalTime = readAmount(raw.totalTime, "游玩时间");
  state.manualClicks = readCount(raw.manualClicks);
  state.seenEnergyShortage = raw.seenEnergyShortage === true;
  state.hasPrestiged = raw.hasPrestiged === true || state.warpCores.gt(0);
  state.unlockedCards = readUnlocked(raw.unlockedCards);
  state.protocols = readProtocols(raw.protocols);
  state.unlocked = readAchievements(raw.unlocked);
  state.stats = readStats(raw.stats);
  state.offlineBonusHours = Math.max(readBonusHours(raw.offlineBonusHours), offlineHoursFromTech(state));
  if (state.stats.seenEnergyShort) state.seenEnergyShortage = true;
  return refreshUnlocks(markEnergyShortage(state));
}

export function exportSave(state: GameState, savedAt = Date.now()): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt,
    lastTickAt: savedAt,
    state: serializeState(state),
  };
  return JSON.stringify(file, null, 2);
}

/** Validate a file. Only the current version (v7) is accepted; anything else throws without touching the current game. */
export function importSave(json: string): SaveFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("不是有效的 JSON");
  }
  if (!isRecord(parsed)) throw new Error("存档必须是 JSON 对象");
  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version)) throw new Error("存档缺少有效的版本号");
  if (version !== SAVE_VERSION) throw new SaveVersionError(version);
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
    throw new Error("存档缺少有效的 savedAt");
  }
  const lastTickAt =
    typeof parsed.lastTickAt === "number" && Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : parsed.savedAt;
  return {
    version: SAVE_VERSION,
    savedAt: parsed.savedAt,
    lastTickAt,
    state: serializeState(deserializeState(parsed.state)),
  };
}

export function writeSave(store: KeyValueStore, state: GameState, savedAt = Date.now()): void {
  store.setItem(STORAGE_KEY, exportSave(state, savedAt));
}

export function readSave(store: KeyValueStore): SaveFile | null {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return null;
  return importSave(raw);
}

export function clearSave(store: KeyValueStore): void {
  store.removeItem(STORAGE_KEY);
}

/** Version number stored in localStorage, or null when absent or unreadable. */
function storedVersion(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.version === "number" && Number.isFinite(parsed.version)) return parsed.version;
  } catch {
    // Unreadable JSON falls through to importSave, which reports it.
  }
  return null;
}

/**
 * Load the local save and apply elapsed real time (capped at the offline limit).
 * A save older than the current version is discarded: fresh game plus a one-time notice (design doc §5.9).
 * Newer or corrupt saves throw so the caller can report it.
 */
export function loadGame(store: KeyValueStore, now = Date.now()): LoadResult {
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return { ...emptyCatchup(createInitialState()), notice: null };
  const version = storedVersion(raw);
  if (version !== null && version < SAVE_VERSION) {
    return { ...emptyCatchup(createInitialState()), notice: outdatedSaveNotice(version) };
  }
  const file = importSave(raw);
  const elapsed = (now - file.lastTickAt) / 1000;
  return { ...catchUp(deserializeState(file.state), elapsed), notice: null };
}

function serializePlanet(planet: PlanetState): SerializedPlanet {
  return {
    name: planet.name,
    tempMax: planet.tempMax,
    fieldsMax: planet.fieldsMax,
    buildings: { ...planet.buildings },
    productionPct: { ...planet.productionPct },
    buildQueue: planet.buildQueue.map((order) => ({
      building: order.building,
      targetLevel: order.targetLevel,
      paid: mapResources(order.paid),
      totalSeconds: order.totalSeconds,
      remainingSeconds: order.remainingSeconds,
      source: order.source,
    })),
  };
}

function readPlanet(raw: unknown): PlanetState {
  if (!isRecord(raw)) throw new Error("星球数据格式不正确");
  const planet = createPlanet();
  if (typeof raw.name === "string" && raw.name.trim()) planet.name = raw.name.slice(0, 40);
  if (typeof raw.tempMax === "number" && Number.isFinite(raw.tempMax)) planet.tempMax = raw.tempMax;
  if (raw.fieldsMax !== undefined) planet.fieldsMax = readInteger(raw.fieldsMax, "星球格子", 1, 10000);

  if (!isRecord(raw.buildings)) throw new Error("建筑等级格式不正确");
  for (const id of BUILDING_IDS) {
    const value = raw.buildings[id];
    planet.buildings[id] = value === undefined ? 0 : readInteger(value, `建筑 ${id} 等级`, 0, MAX_LEVEL);
  }

  if (raw.productionPct !== undefined) {
    if (!isRecord(raw.productionPct)) throw new Error("产量设置格式不正确");
    for (const id of PRODUCTION_IDS) {
      const value = raw.productionPct[id];
      if (value === undefined) continue;
      const pct = readInteger(value, `产量设置 ${id}`, 0, 100);
      if (pct % 10 !== 0) throw new Error(`产量设置 ${id} 必须是 10 的倍数`);
      planet.productionPct[id] = pct;
    }
  }

  if (!Array.isArray(raw.buildQueue)) throw new Error("建造队列格式不正确");
  if (raw.buildQueue.length > MAX_QUEUE) throw new Error("建造队列过长");
  planet.buildQueue = raw.buildQueue.map((entry, index) => readOrder(entry, index));
  return planet;
}

function readOrder(raw: unknown, index: number): BuildOrder {
  const label = `建造队列第 ${index + 1} 项`;
  if (!isRecord(raw) || typeof raw.building !== "string" || !isBuildingId(raw.building)) {
    throw new Error(`${label}建筑无效`);
  }
  const targetLevel = readInteger(raw.targetLevel, `${label}目标等级`, 1, MAX_LEVEL);
  const totalSeconds = readSeconds(raw.totalSeconds, `${label}总时长`);
  const remainingSeconds = Math.min(readSeconds(raw.remainingSeconds, `${label}剩余时间`), totalSeconds);
  const source = raw.source === "protocol" ? "protocol" : raw.source === "manual" ? "manual" : null;
  if (!source) throw new Error(`${label}来源无效`);
  const paid = readResourceMap(raw.paid, `${label}已付`);
  return { building: raw.building, targetLevel, paid, totalSeconds, remainingSeconds, source };
}

function readItems(raw: unknown): Record<InventoryItemId, number> {
  const items = createInitialState().items;
  if (raw === undefined) return items;
  if (!isRecord(raw)) throw new Error("背包格式不正确");
  for (const id of INVENTORY_IDS) {
    if (raw[id] === undefined) continue;
    items[id] = readInteger(raw[id], `背包 ${id}`, 0, 1_000_000);
  }
  return items;
}

function readBoosters(raw: unknown): Booster[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error("资源加成格式不正确");
  const out: Booster[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.res !== "string" || !(RESOURCE_IDS as readonly string[]).includes(entry.res)) {
      throw new Error("资源加成资源无效");
    }
    const pct = readInteger(entry.pct, "资源加成百分比", 1, 100);
    const until = readSeconds(entry.until, "资源加成结束时间");
    if (out.some((booster) => booster.res === entry.res)) throw new Error("同一资源只能有一个加成");
    out.push({ res: entry.res as ResourceId, pct, until });
  }
  return out;
}

function readUnit(raw: unknown, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) throw new Error(`${label}无效`);
  return raw;
}

function readLight(raw: unknown, label: string): LightRoll {
  if (!isRecord(raw) || typeof raw.big !== "boolean") throw new Error(`${label}格式不正确`);
  return {
    tile: readInteger(raw.tile, `${label}图块`, 0, BOARD.length - 1),
    big: raw.big,
    u: readUnit(raw.u, label),
    v: readUnit(raw.v, label),
  };
}

function readPendingRun(raw: unknown, index: number): PendingRun {
  const label = `星环机开奖第 ${index + 1} 次`;
  if (!isRecord(raw) || !isRecord(raw.outcome)) throw new Error(`${label}格式不正确`);
  const source = raw.source;
  if (source !== "beacon" && source !== "topup" && source !== "bonus") throw new Error(`${label}来源无效`);
  const outcome = raw.outcome;
  const forced = outcome.forced === "empty" || outcome.forced === "jackpot" ? outcome.forced : null;
  let lucky: PendingRun["outcome"]["lucky"] = null;
  if (outcome.lucky !== null && outcome.lucky !== undefined) {
    const rawLucky = outcome.lucky;
    if (!isRecord(rawLucky) || !LUCKY_TABLE.some((row) => row.kind === rawLucky.kind) || !Array.isArray(rawLucky.lights)) {
      throw new Error(`${label}送灯无效`);
    }
    if (rawLucky.lights.length > 6) throw new Error(`${label}送灯过多`);
    lucky = {
      kind: rawLucky.kind as NonNullable<PendingRun["outcome"]["lucky"]>["kind"],
      lights: rawLucky.lights.map((light, i) => readLight(light, `${label}送灯 ${i + 1}`)),
    };
  }
  return { source, outcome: { main: readLight(outcome.main, label), lucky, forced } };
}

function readFinite(raw: unknown, label: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`${label}无效`);
  return raw;
}

/** Ring machine state; optional inside v7 (absent = fresh machine). */
function readArcade(raw: unknown): ArcadeState {
  if (raw === undefined) return createArcade();
  if (!isRecord(raw)) throw new Error("星环机数据格式不正确");
  const arcade = createArcade(readInteger(raw.seed, "星环机随机数状态", 0, 0xffffffff));
  if (raw.runs !== undefined) {
    if (!Array.isArray(raw.runs) || raw.runs.length > ARCADE.storedMax) throw new Error("星环机开奖次数无效");
    arcade.runs = raw.runs.map(readPendingRun);
  }
  arcade.beaconRequired = Math.min(
    ARCADE.beaconSeconds * 3,
    Math.max(1, readFinite(raw.beaconRequired, "信标冷却", ARCADE.beaconSeconds)),
  );
  arcade.beaconProgress = Math.min(arcade.beaconRequired, readFinite(raw.beaconProgress, "信标进度", 0));
  if (raw.topUps !== undefined) {
    if (!Array.isArray(raw.topUps) || raw.topUps.length > 64) throw new Error("重氢加注记录无效");
    arcade.topUps = raw.topUps.map((at) => readFinite(at, "重氢加注时间", 0));
  }
  if (raw.bets !== undefined) {
    if (!isRecord(raw.bets)) throw new Error("押注格式不正确");
    let total = 0;
    for (const symbol of BET_SYMBOLS) {
      const units = raw.bets[symbol] === undefined ? 0 : readInteger(raw.bets[symbol], `押注 ${symbol}`, 0, 1000);
      arcade.bets[symbol] = units;
      total += units;
    }
    if (total > Math.floor(ARCADE.betMaxSeconds / ARCADE.betUnitSeconds)) throw new Error("押注超过上限");
  }
  for (const key of ["rollPity", "pity"] as const) {
    const pity = raw[key];
    if (pity === undefined) continue;
    if (!isRecord(pity)) throw new Error("保底计数格式不正确");
    arcade[key] = {
      empty: readInteger(pity.empty ?? 0, "空灯保底", 0, 1_000_000),
      jackpot: readInteger(pity.jackpot ?? 0, "大奖保底", 0, 1_000_000),
    };
  }
  if (raw.position !== undefined) arcade.position = readInteger(raw.position, "星环机灯位", 0, BOARD.length - 1);
  if (raw.history !== undefined) {
    if (!Array.isArray(raw.history)) throw new Error("星环机历史格式不正确");
    arcade.history = raw.history.slice(-ARCADE.historySize).map((entry) => {
      if (!isRecord(entry) || !isArcadeSymbol(entry.symbol) || typeof entry.summary !== "string") {
        throw new Error("星环机历史无效");
      }
      return {
        symbol: entry.symbol,
        big: entry.big === true,
        at: readFinite(entry.at, "星环机历史时间", 0),
        auto: entry.auto === true,
        summary: entry.summary.slice(0, 600),
      };
    });
  }
  if (raw.stats !== undefined) {
    const stats = raw.stats;
    if (!isRecord(stats)) throw new Error("星环机统计格式不正确");
    const hits = emptyHits();
    if (isRecord(stats.hits)) {
      for (const symbol of ARCADE_SYMBOLS) hits[symbol] = readFinite(stats.hits[symbol], "星环机命中", 0);
    }
    arcade.stats = {
      runs: readFinite(stats.runs, "星环机次数", 0),
      manualRuns: readFinite(stats.manualRuns, "手动开奖次数", 0),
      autoRuns: readFinite(stats.autoRuns, "自动开奖次数", 0),
      hits,
      darkMatter: readFinite(stats.darkMatter, "星环机暗物质", 0),
      betSpent: readFinite(stats.betSpent, "押注花费", 0),
      betWon: readFinite(stats.betWon, "押注赢得", 0),
    };
  }
  return arcade;
}

function serializeResearch(research: ResearchState): SerializedState["research"] {
  return {
    levels: { ...research.levels },
    queue: research.queue.map((order) => ({
      tech: order.tech,
      targetLevel: order.targetLevel,
      paid: mapResources(order.paid),
      totalSeconds: order.totalSeconds,
      remainingSeconds: order.remainingSeconds,
      source: order.source,
    })),
  };
}

function readResearch(raw: unknown): ResearchState {
  const research = createResearch();
  if (raw === undefined) return research;
  if (!isRecord(raw)) throw new Error("研究数据格式不正确");
  if (raw.levels !== undefined) {
    if (!isRecord(raw.levels)) throw new Error("研究等级格式不正确");
    for (const id of RESEARCH_IDS) {
      const value = raw.levels[id];
      research.levels[id] = value === undefined ? 0 : readInteger(value, `研究 ${id} 等级`, 0, MAX_LEVEL);
    }
  }
  if (raw.queue !== undefined) {
    if (!Array.isArray(raw.queue)) throw new Error("研究队列格式不正确");
    if (raw.queue.length > MAX_QUEUE) throw new Error("研究队列过长");
    research.queue = raw.queue.map((entry, index) => readResearchOrder(entry, index));
  }
  return research;
}

function readResearchOrder(raw: unknown, index: number): ResearchOrder {
  const label = `研究队列第 ${index + 1} 项`;
  if (!isRecord(raw) || typeof raw.tech !== "string" || !isResearchId(raw.tech)) throw new Error(`${label}研究无效`);
  const targetLevel = readInteger(raw.targetLevel, `${label}目标等级`, 1, MAX_LEVEL);
  const totalSeconds = readSeconds(raw.totalSeconds, `${label}总时长`);
  const remainingSeconds = Math.min(readSeconds(raw.remainingSeconds, `${label}剩余时间`), totalSeconds);
  const source = raw.source === "protocol" ? "protocol" : raw.source === "manual" ? "manual" : null;
  if (!source) throw new Error(`${label}来源无效`);
  const paid = readResourceMap(raw.paid, `${label}已付`);
  return { tech: raw.tech, targetLevel, paid, totalSeconds, remainingSeconds, source };
}

function readInteger(raw: unknown, label: string, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new Error(`${label}必须是 ${min}–${max} 的整数`);
  }
  return raw;
}

function readSeconds(raw: unknown, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`${label}无效`);
  return raw;
}

function readAmount(raw: unknown, label: string): BigNumber {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`${label} 必须是数字`);
  }
  const value = big(raw);
  if (!isValidAmount(value)) throw new Error(`${label} 无效`);
  return value;
}

function readCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

function readResourceMap(raw: unknown, label: string): Record<ResourceId, BigNumber> {
  if (!isRecord(raw)) throw new Error(`${label} 格式不正确`);
  return {
    metal: readAmount(raw.metal, `${label}·金属`),
    crystal: readAmount(raw.crystal, `${label}·晶体`),
    deuterium: readAmount(raw.deuterium, `${label}·重氢`),
  };
}

function readCurvature(raw: unknown): Record<CurvatureId, number> {
  const ranks = emptyCurvature();
  if (raw === undefined) return ranks;
  if (!isRecord(raw)) throw new Error("曲率科技格式不正确");
  for (const id of CURVATURE_IDS) {
    if (raw[id] === undefined) continue;
    ranks[id] = readRank(raw[id], id);
  }
  return ranks;
}

function readRank(raw: unknown, id: CurvatureId): number {
  const max = curvatureById(id).maxRank;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`曲率科技 ${id} 等级无效`);
  }
  return value;
}

function readAchievements(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const found = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && isAchievementId(entry)) found.add(entry);
  }
  return ACHIEVEMENTS.map((def) => def.id).filter((id) => found.has(id));
}

function readStats(raw: unknown): PlayerStats {
  if (!isRecord(raw)) return emptyStats();
  return {
    scrapes: readCount(raw.scrapes),
    launches: readCount(raw.launches),
    seenEnergyShort: raw.seenEnergyShort === true,
    manualActions: readCount(raw.manualActions),
    automatedLaunches: readCount(raw.automatedLaunches),
    buildsCompleted: readCount(raw.buildsCompleted),
    seenStorageFull: raw.seenStorageFull === true,
    seenQueueIdle: raw.seenQueueIdle === true,
    researchCompleted: readCount(raw.researchCompleted),
    darkMatterEarned: readCount(raw.darkMatterEarned),
  };
}

function readBonusHours(raw: unknown): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(OFFLINE_MAX_HOURS - OFFLINE_BASE_HOURS, value);
}

function readUnlocked(raw: unknown): GameState["unlockedCards"] {
  if (!Array.isArray(raw)) return [];
  const ids: GameState["unlockedCards"] = [];
  for (const item of raw) {
    if (typeof item === "string" && isCatalogId(item) && !ids.includes(item)) ids.push(item);
  }
  return ids;
}

function serializeProtocols(protocols: ProtocolLoadout): SerializedState["protocols"] {
  return {
    accumulator: protocols.accumulator,
    slots: protocols.slots.map((slot) => ({
      elapsed: slot.elapsed,
      lamp: slot.lamp,
      reason: slot.reason,
      card: slot.card,
    })),
  };
}

function readProtocols(raw: unknown): ProtocolLoadout {
  const defaults = createDefaultProtocols();
  if (!isRecord(raw) || !Array.isArray(raw.slots)) return defaults;
  const slots: ProtocolSlotState[] = [];
  for (let i = 0; i < PROTOCOL_SLOT_COUNT; i += 1) slots.push(readSlot(raw.slots[i]));
  const accumulator = typeof raw.accumulator === "number" && Number.isFinite(raw.accumulator) ? raw.accumulator : 0;
  return {
    accumulator: Math.min(Math.max(accumulator, 0), OFFLINE_PROTOCOL_SECONDS),
    slots,
  };
}

function readSlot(raw: unknown): ProtocolSlotState {
  if (!isRecord(raw)) return emptyProtocolSlot();
  const card = raw.card == null ? null : readCard(raw.card);
  if (raw.card != null && !card) return emptyProtocolSlot();
  const elapsed = typeof raw.elapsed === "number" && Number.isFinite(raw.elapsed) && raw.elapsed >= 0 ? raw.elapsed : 0;
  const lamp: CardLamp = raw.lamp === "green" || raw.lamp === "red" ? raw.lamp : "gray";
  const reason = typeof raw.reason === "string" ? raw.reason : card ? "已装配" : "空槽位";
  return { card, elapsed, lamp, reason };
}

function readCard(raw: unknown): ProtocolCard | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !isCatalogId(raw.id)) return null;
  const trigger = readTrigger(raw.trigger);
  const action = readAction(raw.action);
  if (!trigger || !action || !Array.isArray(raw.conditions)) return null;
  const conditions: Condition[] = [];
  for (const item of raw.conditions) {
    const condition = readCondition(item);
    if (!condition) return null;
    conditions.push(condition);
  }
  return { id: raw.id, enabled: raw.enabled !== false, trigger, conditions, action };
}

function readTrigger(raw: unknown): Trigger | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "interval" && typeof raw.seconds === "number" && raw.seconds > 0) {
    return { kind: "interval", seconds: raw.seconds };
  }
  if (raw.kind === "onResource" && typeof raw.res === "string" && isResId(raw.res)) {
    const gte = typeof raw.gte === "string" || typeof raw.gte === "number" ? String(raw.gte) : "";
    if (gte) return { kind: "onResource", res: raw.res, gte };
  }
  if (raw.kind === "queueIdle") return { kind: "queueIdle" };
  if (raw.kind === "storageFull" && typeof raw.res === "string" && isStoredResId(raw.res)) {
    return { kind: "storageFull", res: raw.res };
  }
  if (raw.kind === "researchIdle") return { kind: "researchIdle" };
  if (raw.kind === "runsReady") return { kind: "runsReady" };
  return null;
}

function readCondition(raw: unknown): Condition | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  const building = typeof raw.building === "string" && isBuildingId(raw.building) ? raw.building : null;
  if ((raw.kind === "resourceGte" || raw.kind === "resourceLt") && typeof raw.res === "string" && isResId(raw.res)) {
    const value = typeof raw.value === "string" || typeof raw.value === "number" ? String(raw.value) : "";
    if (!value) return null;
    return { kind: raw.kind, res: raw.res, value };
  }
  if (raw.kind === "energyEffLt" && typeof raw.value === "number") return { kind: "energyEffLt", value: raw.value };
  if (raw.kind === "levelLt" && building && typeof raw.value === "number") return { kind: "levelLt", building, value: raw.value };
  if (raw.kind === "costRatioLt" && building && typeof raw.ratio === "number") {
    return { kind: "costRatioLt", building, ratio: raw.ratio };
  }
  if (raw.kind === "storageGte" && typeof raw.res === "string" && isStoredResId(raw.res) && typeof raw.ratio === "number") {
    return { kind: "storageGte", res: raw.res, ratio: raw.ratio };
  }
  if (raw.kind === "queueLenLt" && typeof raw.value === "number") return { kind: "queueLenLt", value: raw.value };
  if (raw.kind === "buildTimeLt" && building && typeof raw.seconds === "number") {
    return { kind: "buildTimeLt", building, seconds: raw.seconds };
  }
  const tech = typeof raw.tech === "string" && isResearchId(raw.tech) ? raw.tech : null;
  if (raw.kind === "researchLevelLt" && tech && typeof raw.value === "number") {
    return { kind: "researchLevelLt", tech, value: raw.value };
  }
  if (raw.kind === "researchTimeLt" && tech && typeof raw.seconds === "number") {
    return { kind: "researchTimeLt", tech, seconds: raw.seconds };
  }
  if (raw.kind === "runsGte" && typeof raw.value === "number" && Number.isInteger(raw.value) && raw.value >= 1) {
    return { kind: "runsGte", value: raw.value };
  }
  if (
    raw.kind === "pityGte" &&
    (raw.pity === "empty" || raw.pity === "jackpot") &&
    typeof raw.value === "number" &&
    Number.isInteger(raw.value) &&
    raw.value >= 1
  ) {
    return { kind: "pityGte", pity: raw.pity, value: raw.value };
  }
  return null;
}

function readAction(raw: unknown): Action | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  if (raw.kind === "collect") return { kind: "collect" };
  if (raw.kind === "prestige" && typeof raw.minGain === "number") return { kind: "prestige", minGain: raw.minGain };
  if (raw.kind === "enqueue" && typeof raw.building === "string" && isBuildingId(raw.building)) {
    return { kind: "enqueue", building: raw.building, levels: 1 };
  }
  if (raw.kind === "setProduction" && typeof raw.building === "string" && isProductionId(raw.building)) {
    const pct = raw.pct;
    if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > 100 || pct % 10 !== 0) return null;
    return { kind: "setProduction", building: raw.building, pct };
  }
  if (raw.kind === "enqueueResearch" && typeof raw.tech === "string" && isResearchId(raw.tech)) {
    return { kind: "enqueueResearch", tech: raw.tech };
  }
  if (raw.kind === "enqueueCheapest" && (raw.group === "mines" || raw.group === "storage" || raw.group === "research")) {
    return { kind: "enqueueCheapest", group: raw.group };
  }
  if (raw.kind === "runLights" && (raw.count === 1 || raw.count === "all")) return { kind: "runLights", count: raw.count };
  if (
    raw.kind === "setBet" &&
    isBetSymbol(raw.symbol) &&
    typeof raw.units === "number" &&
    Number.isInteger(raw.units) &&
    raw.units >= 0 &&
    raw.units <= Math.floor(ARCADE.betMaxSeconds / ARCADE.betUnitSeconds)
  ) {
    return { kind: "setBet", symbol: raw.symbol, units: raw.units };
  }
  return null;
}

function mapResources(values: Record<ResourceId, BigNumber>): Record<ResourceId, string> {
  const out = {} as Record<ResourceId, string>;
  for (const id of RESOURCE_IDS) out[id] = bigToString(values[id]);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
