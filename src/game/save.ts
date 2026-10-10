import { DEEP } from "../data/deep-space";
import { readDeepState, readReceipt } from "./deep-save";
import { createDeepState, storedRunLimit, chargeReservations, type DeepState } from "./deep-state";
import { readSpaceState, serializeFleets } from "./space-save";
import { validCoordinates, type Universe, type Coordinates } from "./galaxy";
import type { FleetMessage } from "./fleet";
import type { Action, Condition, ProtocolCard, Trigger } from "../data/protocol-cards";
import { ACHIEVEMENTS, isAchievementId } from "../data/achievements";
import { BUILDING_IDS, PRODUCTION_IDS, isBuildingId, isProductionId } from "../data/buildings";
import { isCatalogId, isResId, isStoredResId, refreshUnlocks } from "../automation/engine";
import { catchUp, emptyCatchup, type OfflineCatchup } from "../core/offline";
import { OFFLINE_BASE_HOURS, OFFLINE_MAX_HOURS, OFFLINE_PROTOCOL_SECONDS, SAVE_VERSION, SAVE_SCHEMA, STORAGE_KEY } from "./content";
import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { markEnergyShortage } from "./logic";
import { curvatureById } from "../data/curvature-tech";
import { emptyCurvature, offlineHoursFromTech } from "../prestige/tree";
import { createPlanet, HOMEWORLD_ID, type BuildOrder, type PlanetState } from "./planet";
import { UNIT_IDS, isUnitId, type UnitId } from "../data/units";
import { SHIPYARD, type ShipyardOrder } from "./shipyard";
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
  id: string;
  coordinates: Coordinates;
  resources: Record<ResourceId, string>;
  name: string;
  tempMax: number;
  fieldsMax: number;
  buildings: Record<BuildingId, number>;
  productionPct: Record<ProductionBuildingId, number>;
  buildQueue: SerializedOrder[];
  /** v8 (P3). */
  units: Record<UnitId, number>;
  shipyardQueue: ShipyardOrder[];
}

export interface SerializedResearchOrder {
  planetId: string;
  tech: ResearchId;
  targetLevel: number;
  paid: Record<ResourceId, string>;
  totalSeconds: number;
  remainingSeconds: number;
  source: "manual" | "protocol";
}

export interface SerializedState {
  planets: SerializedPlanet[];
  activePlanetId: string;
  universe: Universe;
  deepSpace: DeepState;
  fleets: ReturnType<typeof serializeFleets>;
  messages: FleetMessage[];
  nextFleetId: number;
  research: { levels: Record<ResearchId, number>; queue: SerializedResearchOrder[] };
  darkMatter: string;
  /** Optional (added during v7); missing means empty. */
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
  schema: typeof SAVE_SCHEMA;
  revision: 3;
  version: number;
  savedAt: number;
  /** Wall clock of the last simulated tick. */
  lastTickAt: number;
  state: SerializedState;
}

/** Unsupported versions are protected; only same-schema v9 r2 → r3 is migrated. */
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
  /** Optional load notice. Unsupported saves throw and must remain protected. */
  notice: string | null;
}

export function outdatedSaveNotice(version: number): string {
  return `存档版本 v${version} 与当前 v${SAVE_VERSION} 不兼容，原件已保留，未重置。`;
}

export function serializeState(state: GameState): SerializedState {
  return {
    planets: state.planets.map(serializePlanet),
    activePlanetId: state.activePlanetId,
    deepSpace: structuredClone(state.deepSpace),
    universe: { ...state.universe }, fleets: serializeFleets(state.fleets),
    messages: state.messages.map(m=>({...m})), nextFleetId: state.nextFleetId,
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
  if ("planet" in raw || "resources" in raw) throw new Error("存在旧版重复星球状态，未导入");
  if (!Array.isArray(raw.planets) || raw.planets.length < 1 || raw.planets.length > 100) throw new Error("星球列表必须包含 1–100 颗星球");
  state.planets = raw.planets.map(readPlanet);
  const ids = new Set(state.planets.map(p => p.id));
  if (ids.size !== state.planets.length) throw new Error("星球 ID 重复");
  if (!ids.has(HOMEWORLD_ID)) throw new Error("缺少母星");
  state.activePlanetId = readPlanetId(raw.activePlanetId);
  if (!ids.has(state.activePlanetId)) throw new Error("当前星球不存在");
  state.research = readResearch(raw.research);
  if (state.research.queue.some(o => !ids.has(o.planetId))) throw new Error("研究出资星球不存在");
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
  Object.assign(state, readSpaceState(raw, state));
  state.deepSpace=readDeepState(raw.deepSpace,state);
  if(state.arcade.runs.length+chargeReservations(state)>storedRunLimit(state))throw Error("开奖总量超出预留上限");
  const receipts=state.arcade.runs.flatMap(r=>r.receipt?[r.receipt.reportId]:[]);
  if(new Set(receipts).size!==receipts.length)throw Error("充能回放凭证重复");
  if (state.stats.seenEnergyShort) state.seenEnergyShortage = true;
  return refreshUnlocks(markEnergyShortage(state));
}

export function exportSave(state: GameState, savedAt = Date.now()): string {
  const file: SaveFile = {
    schema: SAVE_SCHEMA,
    revision: 3,
    version: SAVE_VERSION,
    savedAt,
    lastTickAt: savedAt,
    state: serializeState(state),
  };
  return JSON.stringify(file, null, 2);
}

/** Validate a file. Only the current version and original-P4 schema is accepted; anything else throws without touching the current game. */
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
  if (parsed.schema !== SAVE_SCHEMA) throw new Error("存档不属于原版 P4 分支，未导入，当前进度保持不变");
  if (parsed.revision !== 2 && parsed.revision !== 3) throw Error("原版 P4 存档修订不兼容（需要 r2/r3）；原件保留，未导入");
  if(parsed.revision===2){
    if(!isRecord(parsed.state)||!isRecord(parsed.state.universe))throw Error("r2 宇宙数据缺失");
    if("deepSpace" in parsed.state || (Array.isArray(parsed.state.fleets)&&parsed.state.fleets.some(f=>isRecord(f)&&(f.mission==="charge"||f.mission==="recycle"||"charge" in f))))throw Error("r2 不能夹带深空数据");
    parsed.state={...parsed.state,deepSpace:createDeepState(Number(parsed.state.universe.seed))};
  }
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
    throw new Error("存档缺少有效的 savedAt");
  }
  const lastTickAt =
    typeof parsed.lastTickAt === "number" && Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : parsed.savedAt;
  return {
    schema: SAVE_SCHEMA,
    revision: 3,
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
  if (raw === null) return null;
  return importSave(raw);
}

export function clearSave(store: KeyValueStore): void {
  store.removeItem(STORAGE_KEY);
}

/**
 * Low-level compatibility reader. Unsupported, newer and corrupt saves throw;
 * callers must preserve their raw bytes rather than autosave a fresh game.
 * Production uses SaveSession for verified writes and replacement transactions.
 */
export function loadGame(store: KeyValueStore, now = Date.now()): LoadResult {
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return { ...emptyCatchup(createInitialState()), notice: null };
  const file = importSave(raw);
  if (JSON.parse(raw).revision === 2) backupRawSave(store);
  const elapsed = (now - file.lastTickAt) / 1000;
  return { ...catchUp(deserializeState(file.state), elapsed), notice: null };
}

function serializePlanet(planet: PlanetState): SerializedPlanet {
  return {
    id: planet.id,
    coordinates: { ...planet.coordinates },
    resources: mapResources(planet.resources),
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
    units: { ...planet.units },
    shipyardQueue: planet.shipyardQueue.map((order) => ({ ...order })),
  };
}

function readPlanet(raw: unknown): PlanetState {
  if (!isRecord(raw)) throw new Error("星球数据格式不正确");
  if (!validCoordinates(raw.coordinates)) throw Error("星球坐标无效");
  const planet = createPlanet(readPlanetId(raw.id), raw.coordinates);
  planet.resources = readResourceMap(raw.resources, "星球资源");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 40) throw new Error("星球名称无效");
  planet.name = raw.name;
  if (typeof raw.tempMax !== "number" || !Number.isFinite(raw.tempMax) || Math.abs(raw.tempMax) > 1000) throw new Error("星球温度无效");
  planet.tempMax = raw.tempMax;
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

  if (!isRecord(raw.units)) throw new Error("舰船与防御数量格式不正确");
  for (const id of UNIT_IDS) {
    const value = raw.units[id];
    planet.units[id] = value === undefined ? 0 : readInteger(value, `${id} 数量`, 0, MAX_UNITS);
  }
  if (!Array.isArray(raw.shipyardQueue)) throw new Error("造船队列格式不正确");
  if (raw.shipyardQueue.length > SHIPYARD.maxOrders) throw new Error("造船队列过长");
  planet.shipyardQueue = raw.shipyardQueue.map((entry, index) => readShipyardOrder(entry, index));
  return planet;
}

const MAX_UNITS = 1e15;

function readShipyardOrder(raw: unknown, index: number): ShipyardOrder {
  const label = `造船队列第 ${index + 1} 项`;
  if (!isRecord(raw) || !isUnitId(raw.unit)) throw new Error(`${label}单位无效`);
  const count = readInteger(raw.count, `${label}数量`, 1, SHIPYARD.maxBatch);
  if (typeof raw.progress !== "number" || !Number.isFinite(raw.progress) || raw.progress < 0 || raw.progress >= 1) {
    throw new Error(`${label}进度无效`);
  }
  const source = raw.source === "protocol" ? "protocol" : raw.source === "manual" ? "manual" : null;
  if (!source) throw new Error(`${label}来源无效`);
  return { unit: raw.unit, count, progress: raw.progress, source };
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
  if (source !== "beacon" && source !== "topup" && source !== "bonus" && source !== "charge") throw new Error(`${label}来源无效`);
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
  const receipt=source==="charge"?readReceipt(raw.receipt):undefined;
  if(source!=="charge"&&raw.receipt!==undefined)throw Error("信标不能夹带充能凭证");
  return { source, outcome: { main: readLight(outcome.main, label), lucky, forced }, ...(receipt?{receipt}:{}) };
}

function readFinite(raw: unknown, label: string, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`${label}无效`);
  return raw;
}

/** Ring machine state; optional (absent = fresh machine). */
function readArcade(raw: unknown): ArcadeState {
  if (raw === undefined) return createArcade();
  if (!isRecord(raw)) throw new Error("星环机数据格式不正确");
  const arcade = createArcade(readInteger(raw.seed, "星环机随机数状态", 0, 0xffffffff));
  if (raw.runs !== undefined) {
    if (!Array.isArray(raw.runs) || raw.runs.length > DEEP.maxStoredRuns) throw new Error("星环机开奖次数无效");
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
        summary: entry.summary.slice(0, 8000),
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
      planetId: order.planetId,
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
  return { planetId: readPlanetId(raw.planetId), tech: raw.tech, targetLevel, paid, totalSeconds, remainingSeconds, source };
}

export const BACKUP_KEY = `${STORAGE_KEY}.backup`;
/** Bounded, append-only recovery slots. A full archive fails closed instead of deleting a backup. */
export const MAX_SAVE_BACKUPS = 64;

/** Preserve exact bytes, including empty/corrupt saves. Never rotate over an existing original. */
export function preserveRawSave(store: KeyValueStore, raw: string): string {
  for (let index = 0; index < MAX_SAVE_BACKUPS; index += 1) {
    const key = index === 0 ? BACKUP_KEY : `${BACKUP_KEY}.${index}`;
    const previous = store.getItem(key);
    if (previous === raw) return key;
    if (previous !== null) continue;
    // Recheck the empty slot before writing. localStorage has no atomic compare-and-swap.
    if (store.getItem(key) !== null) continue;
    store.setItem(key, raw);
    if (store.getItem(key) !== raw) throw new Error("原存档备份失败，已停止替换");
    return key;
  }
  throw new Error("存档备份槽已满，已停止替换；请先导出并妥善保留备份");
}

/** Compatibility helper. Production replacements also compare and verify the current slot. */
export function backupRawSave(store: KeyValueStore): void {
  const raw = store.getItem(STORAGE_KEY);
  if (raw !== null) preserveRawSave(store, raw);
}

function readPlanetId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) throw new Error("星球 ID 无效");
  return raw;
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
  if (typeof raw === "number" && !Number.isFinite(raw)) throw new Error(`${label} 无效`);
  if (typeof raw === "string" && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) throw new Error(`${label} 无效`);
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
    unitsBuilt: raw.unitsBuilt === undefined ? 0 : readCount(raw.unitsBuilt),
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
  if (raw.kind === "shipyardIdle") return { kind: "shipyardIdle" };
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
  if (raw.kind === "unitCountLt" && isUnitId(raw.unit) && isWholeCount(raw.value)) {
    return { kind: "unitCountLt", unit: raw.unit, value: raw.value };
  }
  if (raw.kind === "energyDeficitGte" && typeof raw.value === "number" && Number.isFinite(raw.value) && raw.value > 0) {
    return { kind: "energyDeficitGte", value: raw.value };
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
  if (raw.kind === "buildUnits" && isUnitId(raw.unit)) {
    const count = raw.count;
    if (count === "max" || count === "deficit" || isWholeCount(count)) return { kind: "buildUnits", unit: raw.unit, count };
    if (isRecord(count) && isWholeCount(count.fillTo)) return { kind: "buildUnits", unit: raw.unit, count: { fillTo: count.fillTo } };
  }
  return null;
}

function isWholeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000;
}

function mapResources(values: Record<ResourceId, BigNumber>): Record<ResourceId, string> {
  const out = {} as Record<ResourceId, string>;
  for (const id of RESOURCE_IDS) out[id] = bigToString(values[id]);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
