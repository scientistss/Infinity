import type { Condition, ProtocolCard, Trigger } from "../data/protocol-cards";
import { isCatalogId, isResId, refreshUnlocks } from "../automation/engine";
import {
  FREE_SOLAR_PLANTS,
  OFFLINE_CAP_SECONDS,
  OFFLINE_PROTOCOL_SECONDS,
  SAVE_VERSION,
  STORAGE_KEY,
  producerById,
} from "./content";
import { big, bigToString, isValidAmount, type BigNumber } from "./decimal";
import { markEnergyShortage, tick } from "./logic";
import { createDefaultProtocols, createInitialState, emptyProtocolSlot } from "./state";
import {
  PROTOCOL_SLOT_COUNT,
  PRODUCER_IDS,
  RESOURCE_IDS,
  type CardLamp,
  type GameState,
  type ProducerId,
  type ProtocolLoadout,
  type ProtocolSlotState,
  type ResourceId,
} from "./types";

const LEGACY_PRODUCER: Partial<Record<ProducerId, string>> = {
  metal_mine: "miner",
  crystal_mine: "drill",
  deuterium_synth: "well",
  solar_plant: "solar",
};

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
    manualClicks: state.manualClicks,
    seenEnergyShortage: state.seenEnergyShortage,
    hasPrestiged: state.hasPrestiged,
    unlockedCards: state.unlockedCards.slice(),
    protocols: serializeProtocols(state.protocols),
  };
}

export function deserializeState(raw: unknown): GameState {
  if (!isRecord(raw)) throw new Error("存档状态格式不正确");
  const state = createInitialState();
  state.resources = readResourceMap(raw.resources, "资源");
  state.producers = readProducerMap(raw.producers, "设施");
  state.lifetime = readResourceMap(raw.lifetime, "累计产出");
  state.warpCores = readAmount(raw.warpCores ?? raw.telemetry, "曲率核心");
  state.totalTime = readAmount(raw.totalTime, "游玩时间");
  state.manualClicks = readCount(raw.manualClicks);
  state.seenEnergyShortage = raw.seenEnergyShortage === true;
  state.hasPrestiged = raw.hasPrestiged === true || state.warpCores.gt(0);
  state.unlockedCards = readUnlocked(raw.unlockedCards);
  state.protocols = readProtocols(raw.protocols);
  return refreshUnlocks(markEnergyShortage(state));
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
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== SAVE_VERSION) {
    throw new Error(`不支持的存档版本（需要 1、2 或 ${SAVE_VERSION}）`);
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

/** Apply elapsed real time, capped at the offline limit. Protocols step on the offline interval. */
export function applyOffline(state: GameState, elapsedSeconds: number, nowCap = OFFLINE_CAP_SECONDS): OfflineResult {
  const rawSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const appliedSeconds = Math.min(rawSeconds, nowCap);
  return {
    state: tick(state, appliedSeconds, "offline"),
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

function readProducerMap(raw: unknown, label: string): Record<ProducerId, BigNumber> {
  if (!isRecord(raw)) throw new Error(`${label} 格式不正确`);
  const out = {} as Record<ProducerId, BigNumber>;
  let solarExplicit = false;
  for (const id of PRODUCER_IDS) {
    const legacy = LEGACY_PRODUCER[id];
    const value = raw[id] !== undefined ? raw[id] : legacy ? raw[legacy] : undefined;
    if (id === "solar_plant" && value !== undefined) solarExplicit = true;
    out[id] = value === undefined ? big(0) : readAmount(value, `${label}·${producerById(id).name}`);
  }
  if (!solarExplicit) out.solar_plant = big(FREE_SOLAR_PLANTS);
  return out;
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
  if ("cardId" in raw && !("card" in raw)) return emptyProtocolSlot();
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
  return null;
}

function readCondition(raw: unknown): Condition | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  if ((raw.kind === "resourceGte" || raw.kind === "resourceLt") && typeof raw.res === "string" && isResId(raw.res)) {
    const value = typeof raw.value === "string" || typeof raw.value === "number" ? String(raw.value) : "";
    if (!value) return null;
    return { kind: raw.kind, res: raw.res, value };
  }
  if (raw.kind === "energyEffLt" && typeof raw.value === "number") return { kind: "energyEffLt", value: raw.value };
  if (raw.kind === "ownedLt" && typeof raw.producer === "string" && isKnownProducer(raw.producer) && typeof raw.value === "number") {
    return { kind: "ownedLt", producer: raw.producer, value: raw.value };
  }
  if (raw.kind === "costRatioLt" && typeof raw.producer === "string" && isKnownProducer(raw.producer) && typeof raw.ratio === "number") {
    return { kind: "costRatioLt", producer: raw.producer, ratio: raw.ratio };
  }
  return null;
}

function readAction(raw: unknown): ProtocolCard["action"] | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  if (raw.kind === "collect") return { kind: "collect" };
  if (raw.kind === "prestige" && typeof raw.minGain === "number") return { kind: "prestige", minGain: raw.minGain };
  if (raw.kind === "buy" && typeof raw.producer === "string" && isKnownProducer(raw.producer)) {
    const amount = raw.amount === "max" || raw.amount === 10 || raw.amount === 1 ? raw.amount : null;
    if (amount === null) return null;
    return { kind: "buy", producer: raw.producer, amount };
  }
  return null;
}

function isKnownProducer(value: string): value is ProducerId {
  return (PRODUCER_IDS as readonly string[]).includes(value);
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
