import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { OFFLINE_CAP_SECONDS, SAVE_VERSION, STORAGE_KEY } from "./content";
import { tick } from "./logic";
import { createInitialState } from "./state";
import {
  PRODUCER_IDS,
  RESOURCE_IDS,
  type GameState,
  type ProducerId,
  type ResourceId,
} from "./types";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SerializedState {
  resources: Record<ResourceId, string>;
  producers: Record<ProducerId, string>;
  lifetime: Record<ResourceId, string>;
    warpCores: string;
  totalTime: string;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  state: SerializedState;
}

export interface OfflineResult {
  state: GameState;
  appliedSeconds: number;
  rawSeconds: number;
  capped: boolean;
}

export function serializeState(state: GameState): SerializedState {
  return {
    resources: mapResources(state.resources, bigToString),
    producers: mapProducers(state.producers, bigToString),
    lifetime: mapResources(state.lifetime, bigToString),
    warpCores: bigToString(state.warpCores),
    totalTime: bigToString(state.totalTime),
  };
}

export function deserializeState(raw: unknown): GameState {
  if (!isRecord(raw)) throw new Error("存档状态格式不正确");
  const state = createInitialState();
  state.resources = readResourceMap(raw.resources, "资源");
  state.producers = readProducerMap(raw.producers, "设施");
  state.lifetime = readResourceMap(raw.lifetime, "累计产出");
  state.warpCores = readAmount(raw.warpCores, "曲率核心");
  state.totalTime = readAmount(raw.totalTime, "游玩时间");
  return state;
}

export function exportSave(state: GameState, savedAt = Date.now()): string {
  const file: SaveFile = {
    version: SAVE_VERSION,
    savedAt,
    state: serializeState(state),
  };
  return JSON.stringify(file, null, 2);
}

export function importSave(json: string): SaveFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("不是有效的 JSON");
  }
  if (!isRecord(parsed)) throw new Error("存档必须是 JSON 对象");
  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`不支持的存档版本（需要 ${SAVE_VERSION}）`);
  }
  if (typeof parsed.savedAt !== "number" || !Number.isFinite(parsed.savedAt)) {
    throw new Error("存档缺少有效的 savedAt");
  }
  return {
    version: SAVE_VERSION,
    savedAt: parsed.savedAt,
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

/** Apply elapsed real time, capped at the offline limit. */
export function applyOffline(state: GameState, elapsedSeconds: number, nowCap = OFFLINE_CAP_SECONDS): OfflineResult {
  const rawSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const appliedSeconds = Math.min(rawSeconds, nowCap);
  return {
    state: tick(state, appliedSeconds),
    appliedSeconds,
    rawSeconds,
    capped: rawSeconds > nowCap,
  };
}

export function loadGame(store: KeyValueStore, now = Date.now()): OfflineResult {
  const file = readSave(store);
  if (!file) {
    return { state: createInitialState(), appliedSeconds: 0, rawSeconds: 0, capped: false };
  }
  const elapsed = (now - file.savedAt) / 1000;
  return applyOffline(deserializeState(file.state), elapsed);
}

function readAmount(raw: unknown, label: string): BigNumber {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`${label} 必须是数字`);
  }
  const value = big(raw);
  if (!isValidAmount(value)) throw new Error(`${label} 无效`);
  return value;
}

function readResourceMap(raw: unknown, label: string): Record<ResourceId, BigNumber> {
  if (!isRecord(raw)) throw new Error(`${label} 格式不正确`);
  return {
    metal: readAmount(raw.metal, `${label}·金属`),
    crystal: readAmount(raw.crystal, `${label}·晶体`),
    deuterium: readAmount(raw.deuterium, `${label}·重氢`),
  };
}

function readProducerMap(raw: unknown, label: string): Record<ProducerId, BigNumber> {
  if (!isRecord(raw)) throw new Error(`${label} 格式不正确`);
  return {
    metal_mine: readAmount(raw.metal_mine, `${label}·金属矿`),
    solar_plant: readAmount(raw.solar_plant, `${label}·太阳能电站`),
    crystal_mine: readAmount(raw.crystal_mine, `${label}·晶体矿`),
    deuterium_synth: readAmount(raw.deuterium_synth, `${label}·重氢合成器`),
    robotics_factory: readAmount(raw.robotics_factory, `${label}·机器人工厂`),
  };
}

function mapResources<T>(values: Record<ResourceId, T>, map: (value: T) => string): Record<ResourceId, string> {
  const out = {} as Record<ResourceId, string>;
  for (const id of RESOURCE_IDS) out[id] = map(values[id]);
  return out;
}

function mapProducers<T>(values: Record<ProducerId, T>, map: (value: T) => string): Record<ProducerId, string> {
  const out = {} as Record<ProducerId, string>;
  for (const id of PRODUCER_IDS) out[id] = map(values[id]);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
