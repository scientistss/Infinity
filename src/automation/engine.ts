import {
  CARD_CATALOG,
  SLOT_RULES,
  type Action,
  type CardCatalogId,
  type Condition,
  type ProtocolCard,
  type ResId,
  type StoredResId,
  type Trigger,
} from "../data/protocol-cards";
import { PRODUCTION_IDS, activeBuildings, buildingById, isBuildingId, isProductionId } from "../data/buildings";
import { protocolSlotBonus, protocolsRelaxed, relaxedWarpCoreCount } from "../prestige/tree";
import { big, isValidAmount, type BigNumber } from "../game/decimal";
import { formatAmount, formatDuration } from "../game/format";
import { baseCollectAmount, economy, energyReport, storageCaps } from "../game/economy";
import { markEnergyShortage, prestige, warpGain } from "../game/logic";
import { costFor, enqueue, nextTargetLevel, queueCapacity, secondsFor } from "../game/queue";
import { emptyProtocolSlot } from "../game/state";
import type { GameState, ProtocolSlotState } from "../game/types";

export interface ProtocolResult {
  state: GameState;
  status: string;
}

export interface ParamOption {
  value: string;
  label: string;
}

export interface ParamField {
  path: string;
  label: string;
  value: string;
  options: ParamOption[];
}

/** Event-driven triggers raised inside tick() between the regular passes. */
export interface ProtocolEvents {
  queueIdle: boolean;
  storageFull: StoredResId[];
}

const RES_LABEL: Record<ResId, string> = {
  metal: "金属",
  crystal: "晶体",
  deuterium: "重氢",
  energy: "能源",
  warp_core: "曲率核心",
};

const RES_IDS: readonly ResId[] = ["metal", "crystal", "deuterium", "energy", "warp_core"];
const STORED_IDS: readonly StoredResId[] = ["metal", "crystal", "deuterium"];

const TRIGGER_LABEL: Record<Trigger["kind"], string> = {
  interval: "间隔",
  onResource: "资源达到",
  queueIdle: "队列空闲",
  storageFull: "仓库满",
};

const ACTION_LABEL: Record<Action["kind"], string> = {
  enqueue: "入队",
  setProduction: "设产量",
  collect: "采集",
  prestige: "重置",
};

export function isCatalogId(value: string): value is CardCatalogId {
  return CARD_CATALOG.some((entry) => entry.id === value);
}

export function isResId(value: string): value is ResId {
  return (RES_IDS as readonly string[]).includes(value);
}

export function isStoredResId(value: string): value is StoredResId {
  return (STORED_IDS as readonly string[]).includes(value);
}

export function unlockedSlotCount(state: GameState): number {
  const levels = Math.max(0, Math.min(1000, state.planet.buildings.robotics_factory));
  const extra = Math.floor(levels / SLOT_RULES.roboticsPerLevels);
  return Math.min(SLOT_RULES.hardCap, SLOT_RULES.initial + extra + protocolSlotBonus(state));
}

export function slotUnlockHint(state: GameState, index: number): string {
  const fromRobotics = index - protocolSlotBonus(state);
  if (fromRobotics <= 0) return `槽位 ${index + 1} 未开启`;
  const need = fromRobotics * SLOT_RULES.roboticsPerLevels;
  return `槽位 ${index + 1} 未开启 · 需要机器人工厂等级 ${need}`;
}

export function unlockHint(state: GameState, id: CardCatalogId): string {
  const unlock = catalogEntry(id).unlock;
  if (unlock.kind === "manualClicks") return `手动采集 ${unlock.count} 次`;
  if (unlock.kind === "levelGte") return `${buildingById(unlock.building).nameZh}达到 ${unlock.value} 级`;
  if (unlock.kind === "firstEnergyShortage") return "首次能源不足";
  if (unlock.kind === "firstPrestige") return protocolsRelaxed(state) ? "开局即可配置" : "首次重置后";
  if (unlock.kind === "firstQueueIdle") return `建造队列首次跑空，且机器人工厂达到 ${unlock.roboticsLevel} 级`;
  if (unlock.kind === "firstStorageFull") return "首次有资源到达仓库上限";
  return `累计 ${relaxedWarpCoreCount(state, unlock.count)} 曲率核心`;
}

export function unlockProgress(state: GameState, id: CardCatalogId): string {
  if (state.unlockedCards.includes(id)) return "已解锁";
  const unlock = catalogEntry(id).unlock;
  if (unlock.kind === "manualClicks") return `${unlockHint(state, id)}（${state.manualClicks}/${unlock.count}）`;
  if (unlock.kind === "levelGte") {
    return `${unlockHint(state, id)}（${state.planet.buildings[unlock.building]}/${unlock.value}）`;
  }
  if (unlock.kind === "warpCoreTotal") {
    return `${unlockHint(state, id)}（${state.warpCores.toFixed(0)}/${relaxedWarpCoreCount(state, unlock.count)}）`;
  }
  if (unlock.kind === "firstQueueIdle") {
    const idle = state.stats.seenQueueIdle ? "已跑空" : "未跑空";
    return `${unlockHint(state, id)}（${idle}，机器人 ${state.planet.buildings.robotics_factory}/${unlock.roboticsLevel}）`;
  }
  return unlockHint(state, id);
}

export function refreshUnlocks(state: GameState): GameState {
  const have = new Set(state.unlockedCards);
  let changed = false;
  for (const entry of CARD_CATALOG) {
    if (have.has(entry.id) || !meetsUnlock(state, entry.unlock)) continue;
    have.add(entry.id);
    changed = true;
  }
  if (!changed) return state;
  return {
    ...state,
    unlockedCards: CARD_CATALOG.filter((entry) => have.has(entry.id)).map((entry) => entry.id),
  };
}

export function hasRunnableProtocol(state: GameState): boolean {
  const open = unlockedSlotCount(state);
  for (let index = 0; index < open; index += 1) {
    const card = state.protocols.slots[index]?.card;
    if (card?.enabled && isCatalogId(card.id) && state.unlockedCards.includes(card.id)) return true;
  }
  return false;
}

/**
 * One regular engine pass. Slots run top to bottom. Each armed card acts at most once.
 * `periodSeconds` is added to interval triggers (1 live, 60 offline).
 */
export function evaluateLoadout(state: GameState, periodSeconds: number): GameState {
  let next = refreshUnlocks(markEnergyShortage(state));
  const open = unlockedSlotCount(next);
  for (let index = 0; index < open; index += 1) {
    next = runSlot(next, index, periodSeconds);
  }
  return next;
}

/**
 * Event pass (design doc §13): only `queueIdle` / `storageFull` cards whose event just happened run.
 * Interval timers do not advance. Used online and offline so a finished build is refilled at once.
 */
export function evaluateEvents(state: GameState, events: ProtocolEvents): GameState {
  if (!events.queueIdle && events.storageFull.length === 0) return state;
  let next = refreshUnlocks(state);
  const open = unlockedSlotCount(next);
  for (let index = 0; index < open; index += 1) {
    const card = next.protocols.slots[index]?.card;
    if (!card?.enabled) continue;
    const trigger = card.trigger;
    const hit =
      (trigger.kind === "queueIdle" && events.queueIdle) ||
      (trigger.kind === "storageFull" && events.storageFull.includes(trigger.res));
    if (hit) next = runSlot(next, index, 0);
  }
  return next;
}

export function equipCard(state: GameState, index: number, cardId: string): ProtocolResult {
  if (!isCatalogId(cardId)) return { state, status: "未知协议卡" };
  if (!state.unlockedCards.includes(cardId)) return { state, status: `未解锁：${unlockHint(state, cardId)}` };
  if (!isOpenSlot(state, index)) return { state, status: slotUnlockHint(state, index) || "槽位未开启" };
  const card = instantiate(cardId);
  return {
    state: writeSlot(state, index, { card, elapsed: 0, lamp: "gray", reason: "已装配" }),
    status: `已装配${catalogEntry(cardId).labelZh}`,
  };
}

export function equipFirstEmpty(state: GameState, cardId: string): ProtocolResult {
  if (!isCatalogId(cardId)) return { state, status: "未知协议卡" };
  if (!state.unlockedCards.includes(cardId)) return { state, status: `未解锁：${unlockHint(state, cardId)}` };
  const open = unlockedSlotCount(state);
  const index = state.protocols.slots.findIndex((slot, slotIndex) => slotIndex < open && slot.card === null);
  if (index < 0) return { state, status: "槽位已满" };
  return equipCard(state, index, cardId);
}

export function toggleSlot(state: GameState, index: number, enabled: boolean): GameState {
  if (!isOpenSlot(state, index)) return state;
  const slot = state.protocols.slots[index];
  if (!slot?.card) return state;
  const card: ProtocolCard = { ...slot.card, enabled };
  return writeSlot(state, index, { ...slot, card, lamp: "gray", reason: enabled ? "已启用" : "已关闭" });
}

export function clearSlot(state: GameState, index: number): GameState {
  if (!isOpenSlot(state, index)) return state;
  return writeSlot(state, index, emptyProtocolSlot());
}

export function moveSlot(state: GameState, from: number, to: number): GameState {
  if (from === to || !isOpenSlot(state, from) || !isOpenSlot(state, to)) return state;
  const slots = state.protocols.slots.slice();
  const a = slots[from];
  const b = slots[to];
  if (!a || !b) return state;
  slots[from] = b;
  slots[to] = a;
  return { ...state, protocols: { ...state.protocols, slots } };
}

export function patchSlot(state: GameState, index: number, path: string, value: string): GameState {
  if (!isOpenSlot(state, index)) return state;
  const slot = state.protocols.slots[index];
  if (!slot?.card) return state;
  const card = structuredClone(slot.card) as ProtocolCard;
  if (!applyPatch(state, card, path, value)) return state;
  return writeSlot(state, index, { ...slot, card, elapsed: 0, lamp: "gray", reason: "已调整参数" });
}

export function protocolSentence(card: ProtocolCard): string {
  const when = triggerPhrase(card.trigger);
  const guards = card.conditions.map(conditionPhrase);
  const cond = guards.length > 0 ? guards.join("，且") : "无附加条件";
  return `当${when}，若${cond}，则${actionPhrase(card.action)}。`;
}

export function slotFields(state: GameState, card: ProtocolCard): ParamField[] {
  const fields: ParamField[] = [];
  const triggers = availableKinds(state, card.trigger.kind, "triggers");
  if (triggers.length > 1) {
    fields.push({
      path: "trigger.kind",
      label: "触发",
      value: card.trigger.kind,
      options: triggers.map((kind) => ({ value: kind, label: TRIGGER_LABEL[kind] })),
    });
  }
  const trigger = card.trigger;
  if (trigger.kind === "interval") {
    fields.push({
      path: "trigger.seconds",
      label: "秒",
      value: String(trigger.seconds),
      options: withCurrent([1, 5, 10, 30, 60].map((n) => ({ value: String(n), label: `${n} 秒` })), String(trigger.seconds)),
    });
  } else if (trigger.kind === "onResource") {
    fields.push({ path: "trigger.res", label: "资源", value: trigger.res, options: resOptions() });
    fields.push({ path: "trigger.gte", label: "≥", value: trigger.gte, options: amountOptions(trigger.gte) });
  } else if (trigger.kind === "storageFull") {
    fields.push({ path: "trigger.res", label: "仓库", value: trigger.res, options: storedOptions() });
  }

  card.conditions.forEach((condition, index) => {
    const at = (field: string) => `condition.${index}.${field}`;
    if (condition.kind === "resourceGte" || condition.kind === "resourceLt") {
      fields.push({
        path: at("res"),
        label: condition.kind === "resourceGte" ? "资源≥" : "资源<",
        value: condition.res,
        options: resOptions(),
      });
      fields.push({ path: at("value"), label: "数值", value: condition.value, options: amountOptions(condition.value) });
    } else if (condition.kind === "energyEffLt") {
      fields.push({
        path: at("eff"),
        label: "效率<",
        value: String(condition.value),
        options: withCurrent([0.5, 0.75, 0.9, 1].map((n) => ({ value: String(n), label: `${n * 100}%` })), String(condition.value)),
      });
    } else if (condition.kind === "levelLt") {
      fields.push({ path: at("building"), label: "建筑", value: condition.building, options: buildingOptions() });
      fields.push({
        path: at("level"),
        label: "等级<",
        value: String(condition.value),
        options: withCurrent([5, 10, 15, 20, 25, 30, 40, 99].map((n) => ({ value: String(n), label: String(n) })), String(condition.value)),
      });
    } else if (condition.kind === "costRatioLt") {
      fields.push({ path: at("building"), label: "花费建筑", value: condition.building, options: buildingOptions() });
      fields.push({
        path: at("ratio"),
        label: "低于库存",
        value: String(condition.ratio),
        options: withCurrent(
          [0.1, 0.25, 0.5, 0.75, 0.9].map((n) => ({ value: String(n), label: `${Math.round(n * 100)}%` })),
          String(condition.ratio),
        ),
      });
    } else if (condition.kind === "storageGte") {
      fields.push({ path: at("res"), label: "仓库", value: condition.res, options: storedOptions() });
      fields.push({
        path: at("ratio"),
        label: "占比≥",
        value: String(condition.ratio),
        options: withCurrent(
          [0.5, 0.75, 0.9, 0.95, 1].map((n) => ({ value: String(n), label: `${Math.round(n * 100)}%` })),
          String(condition.ratio),
        ),
      });
    } else if (condition.kind === "queueLenLt") {
      fields.push({
        path: at("qlen"),
        label: "队列项数<",
        value: String(condition.value),
        options: withCurrent([1, 2].map((n) => ({ value: String(n), label: String(n) })), String(condition.value)),
      });
    } else if (condition.kind === "buildTimeLt") {
      fields.push({ path: at("building"), label: "建筑", value: condition.building, options: buildingOptions() });
      fields.push({
        path: at("seconds"),
        label: "建造时间<",
        value: String(condition.seconds),
        options: withCurrent(
          [10, 30, 60, 120, 300, 600, 1800, 3600].map((n) => ({ value: String(n), label: formatDuration(n) })),
          String(condition.seconds),
        ),
      });
    }
  });

  const actions = availableKinds(state, card.action.kind, "actions");
  if (actions.length > 1) {
    fields.push({
      path: "action.kind",
      label: "动作",
      value: card.action.kind,
      options: actions.map((kind) => ({ value: kind, label: ACTION_LABEL[kind] })),
    });
  }
  const action = card.action;
  if (action.kind === "enqueue") {
    fields.push({ path: "action.building", label: "入队建筑", value: action.building, options: buildingOptions() });
  } else if (action.kind === "setProduction") {
    fields.push({ path: "action.building", label: "产线", value: action.building, options: productionOptions() });
    fields.push({
      path: "action.pct",
      label: "产量",
      value: String(action.pct),
      options: Array.from({ length: 11 }, (_, i) => ({ value: String(i * 10), label: `${i * 10}%` })),
    });
  } else if (action.kind === "prestige") {
    fields.push({
      path: "action.minGain",
      label: "至少核心",
      value: String(action.minGain),
      options: withCurrent([1, 2, 4, 10].map((n) => ({ value: String(n), label: String(n) })), String(action.minGain)),
    });
  }
  return fields;
}

function triggerReady(state: GameState, trigger: Trigger): string | null {
  if (trigger.kind === "onResource") return amountOf(state, trigger.res).lt(trigger.gte) ? "资源未达触发" : null;
  if (trigger.kind === "queueIdle") {
    const capacity = queueCapacity(state);
    return state.planet.buildQueue.length >= capacity ? `队列已满（${state.planet.buildQueue.length}/${capacity}）` : null;
  }
  if (trigger.kind === "storageFull") {
    const cap = storageCaps(state)[trigger.res];
    return state.resources[trigger.res].lt(cap) ? `${RES_LABEL[trigger.res]}未满仓` : null;
  }
  return null;
}

function runSlot(state: GameState, index: number, periodSeconds: number): GameState {
  const slot = state.protocols.slots[index] ?? emptyProtocolSlot();
  const card = slot.card;
  if (!card) return writeSlot(state, index, { ...slot, lamp: "gray", reason: "空槽位" });
  if (!card.enabled) return writeSlot(state, index, { ...slot, lamp: "gray", reason: "已关闭" });
  if (!isCatalogId(card.id) || !state.unlockedCards.includes(card.id)) {
    return writeSlot(state, index, { ...slot, lamp: "red", reason: "未解锁，不执行" });
  }

  const elapsed = slot.elapsed + periodSeconds;
  if (card.trigger.kind === "interval" && elapsed + 1e-9 < card.trigger.seconds) {
    return writeSlot(state, index, {
      ...slot,
      elapsed,
      lamp: "gray",
      reason: `等待间隔 ${Math.floor(elapsed)}/${card.trigger.seconds} 秒`,
    });
  }
  const waiting = triggerReady(state, card.trigger);
  if (waiting) return writeSlot(state, index, { ...slot, elapsed, lamp: "gray", reason: waiting });

  const failed = failedCondition(state, card);
  const spent = card.trigger.kind === "interval" ? 0 : elapsed;
  if (failed) return writeSlot(state, index, { ...slot, elapsed: spent, lamp: "red", reason: failed });

  const acted = applyAction(state, card);
  const host = acted.state;
  const current = host.protocols.slots[index] ?? slot;
  return writeSlot(host, index, {
    ...current,
    card: current.card ?? card,
    elapsed: spent,
    lamp: acted.ok ? "green" : "red",
    reason: acted.reason,
  });
}

function applyAction(state: GameState, card: ProtocolCard): { state: GameState; ok: boolean; reason: string } {
  const action = card.action;
  if (action.kind === "collect") {
    const amount = baseCollectAmount(state);
    const gain = big(amount);
    return {
      ok: true,
      reason: `自动采集 +${formatAmount(gain)} 金属`,
      state: {
        ...state,
        resources: { ...state.resources, metal: state.resources.metal.add(gain) },
        lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(gain) },
      },
    };
  }
  if (action.kind === "prestige") {
    const gain = warpGain(state);
    if (gain.lt(action.minGain)) return { state, ok: false, reason: `增益 ${gain.toFixed(0)} 低于 ${action.minGain}` };
    const next = prestige(state);
    if (next === state) return { state, ok: false, reason: "还不能重置" };
    return { state: next, ok: true, reason: `已重置，获得 ${gain.toFixed(0)} 曲率核心` };
  }
  if (action.kind === "setProduction") {
    const name = buildingById(action.building).nameZh;
    if (state.planet.productionPct[action.building] === action.pct) {
      return { state, ok: true, reason: `${name}产量已是 ${action.pct}%` };
    }
    return {
      state: setProductionPct(state, action.building, action.pct),
      ok: true,
      reason: `${name}产量设为 ${action.pct}%`,
    };
  }
  const result = enqueue(state, action.building, "protocol");
  return { state: result.state, ok: result.ok, reason: result.reason };
}

/** Production setting 0–100 in steps of 10. Invalid values are ignored. */
export function setProductionPct(state: GameState, id: string, pct: number): GameState {
  if (!isProductionId(id) || !Number.isInteger(pct) || pct < 0 || pct > 100 || pct % 10 !== 0) return state;
  if (state.planet.productionPct[id] === pct) return state;
  return {
    ...state,
    planet: { ...state.planet, productionPct: { ...state.planet.productionPct, [id]: pct } },
  };
}

function failedCondition(state: GameState, card: ProtocolCard): string | null {
  for (const condition of card.conditions) {
    const reason = conditionFails(state, condition);
    if (reason) return reason;
  }
  return null;
}

function conditionFails(state: GameState, condition: Condition): string | null {
  switch (condition.kind) {
    case "resourceGte":
      return amountOf(state, condition.res).lt(condition.value) ? `${RES_LABEL[condition.res]}未达到 ${condition.value}` : null;
    case "resourceLt":
      return amountOf(state, condition.res).lt(condition.value) ? null : `${RES_LABEL[condition.res]}不低于 ${condition.value}`;
    case "energyEffLt":
      return energyReport(state).efficiency.lt(condition.value) ? null : `能源效率不低于 ${condition.value * 100}%`;
    case "levelLt": {
      const level = state.planet.buildings[condition.building];
      return level < condition.value ? null : `${buildingById(condition.building).nameZh}等级不低于 ${condition.value}`;
    }
    case "storageGte": {
      const cap = storageCaps(state)[condition.res];
      const ratio = state.resources[condition.res].div(cap);
      return ratio.gte(condition.ratio) ? null : `${RES_LABEL[condition.res]}仓库占比低于 ${Math.round(condition.ratio * 100)}%`;
    }
    case "queueLenLt":
      return state.planet.buildQueue.length < condition.value ? null : `队列项数不少于 ${condition.value}`;
    case "buildTimeLt": {
      const def = buildingById(condition.building);
      const seconds = secondsFor(state, def, nextTargetLevel(state.planet, def.id));
      return seconds < condition.seconds ? null : `${def.nameZh}建造时间 ${formatDuration(seconds)} 不低于 ${formatDuration(condition.seconds)}`;
    }
    case "costRatioLt": {
      const name = buildingById(condition.building).nameZh;
      const costs = costFor(state, condition.building, nextTargetLevel(state.planet, condition.building));
      for (const id of STORED_IDS) {
        if (costs[id].lte(0)) continue;
        const stock = state.resources[id];
        if (stock.lte(0) || !costs[id].div(stock).lt(condition.ratio)) {
          return `${name}花费达到库存的 ${Math.round(condition.ratio * 100)}%`;
        }
      }
      return null;
    }
  }
}

function amountOf(state: GameState, res: ResId): BigNumber {
  if (res === "energy") {
    const eco = economy(state);
    return big(eco.supply - eco.demand);
  }
  if (res === "warp_core") return state.warpCores;
  return state.resources[res];
}

function meetsUnlock(state: GameState, unlock: (typeof CARD_CATALOG)[number]["unlock"]): boolean {
  switch (unlock.kind) {
    case "manualClicks":
      return state.manualClicks >= unlock.count;
    case "levelGte":
      return state.planet.buildings[unlock.building] >= unlock.value;
    case "firstEnergyShortage":
      return state.seenEnergyShortage;
    case "firstPrestige":
      return protocolsRelaxed(state) || state.hasPrestiged;
    case "firstQueueIdle":
      return state.stats.seenQueueIdle && state.planet.buildings.robotics_factory >= unlock.roboticsLevel;
    case "firstStorageFull":
      return state.stats.seenStorageFull;
    case "warpCoreTotal":
      return state.warpCores.gte(relaxedWarpCoreCount(state, unlock.count));
  }
}

function instantiate(id: CardCatalogId): ProtocolCard {
  const entry = catalogEntry(id);
  return {
    id: entry.id,
    enabled: true,
    trigger: structuredClone(entry.template.trigger) as Trigger,
    conditions: structuredClone(entry.template.conditions) as Condition[],
    action: structuredClone(entry.template.action) as Action,
  };
}

function catalogEntry(id: CardCatalogId): (typeof CARD_CATALOG)[number] {
  const entry = CARD_CATALOG.find((item) => item.id === id);
  if (!entry) throw new Error(`Missing catalog card ${id}`);
  return entry;
}

function isOpenSlot(state: GameState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < unlockedSlotCount(state);
}

function writeSlot(state: GameState, index: number, slot: ProtocolSlotState): GameState {
  const slots = state.protocols.slots.slice();
  slots[index] = slot;
  return { ...state, protocols: { ...state.protocols, slots } };
}

function isTriggerKind(value: string): value is Trigger["kind"] {
  return value === "interval" || value === "onResource" || value === "queueIdle" || value === "storageFull";
}

function isActionKind(value: string): value is Action["kind"] {
  return value === "enqueue" || value === "setProduction" || value === "collect" || value === "prestige";
}

function applyPatch(state: GameState, card: ProtocolCard, path: string, value: string): boolean {
  if (path === "trigger.kind") {
    if (!isTriggerKind(value) || !availableKinds(state, card.trigger.kind, "triggers").includes(value)) return false;
    if (value === "interval") card.trigger = { kind: "interval", seconds: card.trigger.kind === "interval" ? card.trigger.seconds : 5 };
    else if (value === "onResource") card.trigger = { kind: "onResource", res: "metal", gte: "100" };
    else if (value === "queueIdle") card.trigger = { kind: "queueIdle" };
    else card.trigger = { kind: "storageFull", res: "metal" };
    return true;
  }
  if (path === "trigger.seconds" && card.trigger.kind === "interval") {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) return false;
    card.trigger = { kind: "interval", seconds };
    return true;
  }
  if (path === "trigger.res" && card.trigger.kind === "onResource" && isResId(value)) {
    card.trigger = { ...card.trigger, res: value };
    return true;
  }
  if (path === "trigger.res" && card.trigger.kind === "storageFull" && isStoredResId(value)) {
    card.trigger = { kind: "storageFull", res: value };
    return true;
  }
  if (path === "trigger.gte" && card.trigger.kind === "onResource" && isAmount(value)) {
    card.trigger = { ...card.trigger, gte: value };
    return true;
  }
  if (path === "action.kind") {
    if (!isActionKind(value) || !availableKinds(state, card.action.kind, "actions").includes(value)) return false;
    if (value === "collect") card.action = { kind: "collect" };
    else if (value === "prestige") card.action = { kind: "prestige", minGain: 2 };
    else if (value === "setProduction") card.action = { kind: "setProduction", building: "metal_mine", pct: 100 };
    else card.action = { kind: "enqueue", building: "metal_mine", levels: 1 };
    return true;
  }
  if (path === "action.building" && card.action.kind === "enqueue" && isActiveBuilding(value)) {
    card.action = { kind: "enqueue", building: value, levels: 1 };
    return true;
  }
  if (path === "action.building" && card.action.kind === "setProduction" && isProductionId(value)) {
    card.action = { ...card.action, building: value };
    return true;
  }
  if (path === "action.pct" && card.action.kind === "setProduction") {
    const pct = Number(value);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100 || pct % 10 !== 0) return false;
    card.action = { ...card.action, pct };
    return true;
  }
  if (path === "action.minGain" && card.action.kind === "prestige") {
    const minGain = Number(value);
    if (!Number.isInteger(minGain) || minGain < 1 || minGain > 100000) return false;
    card.action = { ...card.action, minGain };
    return true;
  }
  const match = /^condition\.(\d+)\.(res|value|building|level|ratio|eff|qlen|seconds)$/.exec(path);
  if (!match) return false;
  const index = Number(match[1]);
  const field = match[2];
  const condition = card.conditions[index];
  if (!condition || !field) return false;
  const patched = patchCondition(condition, field, value);
  if (!patched) return false;
  card.conditions[index] = patched;
  return true;
}

function patchCondition(condition: Condition, field: string, value: string): Condition | null {
  const num = Number(value);
  switch (condition.kind) {
    case "resourceGte":
    case "resourceLt":
      if (field === "res" && isResId(value)) return { ...condition, res: value };
      if (field === "value" && isAmount(value)) return { ...condition, value };
      return null;
    case "energyEffLt":
      return field === "eff" && Number.isFinite(num) && num > 0 && num <= 1 ? { ...condition, value: num } : null;
    case "levelLt":
      if (field === "building" && isActiveBuilding(value)) return { ...condition, building: value };
      if (field === "level" && Number.isInteger(num) && num >= 1) return { ...condition, value: num };
      return null;
    case "costRatioLt":
      if (field === "building" && isActiveBuilding(value)) return { ...condition, building: value };
      if (field === "ratio" && Number.isFinite(num) && num > 0 && num <= 1) return { ...condition, ratio: num };
      return null;
    case "storageGte":
      if (field === "res" && isStoredResId(value)) return { ...condition, res: value };
      if (field === "ratio" && Number.isFinite(num) && num > 0 && num <= 1) return { ...condition, ratio: num };
      return null;
    case "queueLenLt":
      return field === "qlen" && Number.isInteger(num) && num >= 1 && num <= 5 ? { ...condition, value: num } : null;
    case "buildTimeLt":
      if (field === "building" && isActiveBuilding(value)) return { ...condition, building: value };
      if (field === "seconds" && Number.isFinite(num) && num > 0) return { ...condition, seconds: num };
      return null;
  }
}

function availableKinds<K extends string>(state: GameState, current: K, group: "triggers" | "conditions" | "actions"): K[] {
  const kinds = new Set<K>([current]);
  for (const entry of CARD_CATALOG) {
    if (!state.unlockedCards.includes(entry.id)) continue;
    for (const kind of entry.unlocks[group] ?? []) kinds.add(kind as K);
  }
  return [...kinds];
}

function triggerPhrase(trigger: Trigger): string {
  if (trigger.kind === "interval") return `每 ${trigger.seconds} 秒`;
  if (trigger.kind === "queueIdle") return "建造队列有空位";
  if (trigger.kind === "storageFull") return `${RES_LABEL[trigger.res]}达到仓库上限`;
  return `${RES_LABEL[trigger.res]} ≥ ${trigger.gte}`;
}

function conditionPhrase(condition: Condition): string {
  switch (condition.kind) {
    case "resourceGte":
      return `${RES_LABEL[condition.res]} ≥ ${condition.value}`;
    case "resourceLt":
      return `${RES_LABEL[condition.res]} < ${condition.value}`;
    case "energyEffLt":
      return `能源效率 < ${condition.value * 100}%`;
    case "levelLt":
      return `${buildingById(condition.building).nameZh}等级低于 ${condition.value}`;
    case "costRatioLt":
      return `${buildingById(condition.building).nameZh}下一级花费低于库存的 ${Math.round(condition.ratio * 100)}%`;
    case "storageGte":
      return `${RES_LABEL[condition.res]}仓库占比 ≥ ${Math.round(condition.ratio * 100)}%`;
    case "queueLenLt":
      return `队列项数 < ${condition.value}`;
    case "buildTimeLt":
      return `${buildingById(condition.building).nameZh}建造时间 < ${formatDuration(condition.seconds)}`;
  }
}

function actionPhrase(action: Action): string {
  if (action.kind === "collect") return "采集";
  if (action.kind === "prestige") return `重置（至少 ${action.minGain} 曲率核心）`;
  if (action.kind === "setProduction") return `将${buildingById(action.building).nameZh}产量设为 ${action.pct}%`;
  return `入队 ${buildingById(action.building).nameZh} +1 级`;
}

function isActiveBuilding(value: string): value is ReturnType<typeof activeBuildings>[number]["id"] {
  return isBuildingId(value) && activeBuildings().some((def) => def.id === value);
}

function resOptions(): ParamOption[] {
  return RES_IDS.map((id) => ({ value: id, label: RES_LABEL[id] }));
}

function storedOptions(): ParamOption[] {
  return STORED_IDS.map((id) => ({ value: id, label: RES_LABEL[id] }));
}

function buildingOptions(): ParamOption[] {
  return activeBuildings().map((def) => ({ value: def.id, label: def.nameZh }));
}

function productionOptions(): ParamOption[] {
  return PRODUCTION_IDS.map((id) => ({ value: id, label: buildingById(id).nameZh }));
}

function amountOptions(current: string): ParamOption[] {
  return withCurrent(
    ["10", "50", "100", "1000", "10000", "100000", "1000000"].map((value) => ({ value, label: value })),
    current,
  );
}

function withCurrent(options: ParamOption[], current: string): ParamOption[] {
  if (options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

function isAmount(value: string): boolean {
  try {
    return isValidAmount(big(value));
  } catch {
    return false;
  }
}
