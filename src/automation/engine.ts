import {
  CARD_CATALOG,
  SLOT_RULES,
  type Action,
  type CardCatalogId,
  type Condition,
  type ProducerId,
  type ProtocolCard,
  type ResId,
  type Trigger,
} from "../data/protocol-cards";
import { MANUAL_METAL_PER_CLICK, PRODUCERS, isProducerId, producerById } from "../game/content";
import { big, isValidAmount, type BigNumber } from "../game/decimal";
import { buy, energyReport, isProducerUnlocked, markEnergyShortage, prestige, warpGain } from "../game/logic";
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

const RES_LABEL: Record<ResId, string> = {
  metal: "金属",
  crystal: "晶体",
  deuterium: "重氢",
  energy: "能源",
  warp_core: "曲率核心",
};

const RES_IDS: readonly ResId[] = ["metal", "crystal", "deuterium", "energy", "warp_core"];

export function isCatalogId(value: string): value is CardCatalogId {
  return CARD_CATALOG.some((entry) => entry.id === value);
}

export function isResId(value: string): value is ResId {
  return (RES_IDS as readonly string[]).includes(value);
}

export function unlockedSlotCount(state: GameState): number {
  const robotics = state.producers.robotics_factory;
  const levels = robotics.gt(1000) ? 1000 : Math.max(0, Math.floor(robotics.toNumber()));
  const extra = Math.floor(levels / SLOT_RULES.roboticsPerLevels);
  return Math.min(SLOT_RULES.hardCap, SLOT_RULES.initial + extra);
}

export function slotUnlockHint(index: number): string {
  if (index <= 0) return "";
  const need = index * SLOT_RULES.roboticsPerLevels;
  return `槽位 ${index + 1} 未开启 · 需要 ${need} 座机器人工厂`;
}

export function unlockHint(id: CardCatalogId): string {
  const entry = catalogEntry(id);
  const unlock = entry.unlock;
  if (unlock.kind === "manualClicks") return `手动点击 ${unlock.count} 次`;
  if (unlock.kind === "ownedGte") return `拥有 ${unlock.value} 座${producerById(unlock.producer).name}`;
  if (unlock.kind === "firstEnergyShortage") return "首次能源不足";
  if (unlock.kind === "firstPrestige") return "首次重置后";
  return `累计 ${unlock.count} 曲率核心`;
}

export function unlockProgress(state: GameState, id: CardCatalogId): string {
  if (state.unlockedCards.includes(id)) return "已解锁";
  const entry = catalogEntry(id);
  const unlock = entry.unlock;
  if (unlock.kind === "manualClicks") return `${unlockHint(id)}（${state.manualClicks}/${unlock.count}）`;
  if (unlock.kind === "ownedGte") {
    const owned = state.producers[unlock.producer];
    const shown = owned.gt(100000) ? owned.toString() : String(Math.floor(owned.toNumber()));
    return `${unlockHint(id)}（${shown}/${unlock.value}）`;
  }
  if (unlock.kind === "warpCoreTotal") {
    return `${unlockHint(id)}（${state.warpCores.toFixed(0)}/${unlock.count}）`;
  }
  return unlockHint(id);
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
 * One engine pass. Slots run top to bottom. Each armed card acts at most once.
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

export function equipCard(state: GameState, index: number, cardId: string): ProtocolResult {
  if (!isCatalogId(cardId)) return { state, status: "未知协议卡" };
  if (!state.unlockedCards.includes(cardId)) return { state, status: `未解锁：${unlockHint(cardId)}` };
  if (!isOpenSlot(state, index)) return { state, status: slotUnlockHint(index) || "槽位未开启" };
  const card = instantiate(cardId);
  return {
    state: writeSlot(state, index, { card, elapsed: 0, lamp: "gray", reason: "已装配" }),
    status: `已装配${catalogEntry(cardId).labelZh}`,
  };
}

export function equipFirstEmpty(state: GameState, cardId: string): ProtocolResult {
  if (!isCatalogId(cardId)) return { state, status: "未知协议卡" };
  if (!state.unlockedCards.includes(cardId)) return { state, status: `未解锁：${unlockHint(cardId)}` };
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
  return writeSlot(state, index, {
    ...slot,
    card,
    lamp: enabled ? "gray" : "gray",
    reason: enabled ? "已启用" : "已关闭",
  });
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
      options: triggers.map((kind) => ({ value: kind, label: kind === "interval" ? "间隔" : "资源达到" })),
    });
  }
  if (card.trigger.kind === "interval") {
    fields.push({
      path: "trigger.seconds",
      label: "秒",
      value: String(card.trigger.seconds),
      options: withCurrent([1, 5, 10, 30, 60].map((n) => ({ value: String(n), label: `${n} 秒` })), String(card.trigger.seconds)),
    });
  } else {
    fields.push({
      path: "trigger.res",
      label: "资源",
      value: card.trigger.res,
      options: resOptions(),
    });
    fields.push({
      path: "trigger.gte",
      label: "≥",
      value: card.trigger.gte,
      options: amountOptions(card.trigger.gte),
    });
  }

  card.conditions.forEach((condition, index) => {
    if (condition.kind === "resourceGte" || condition.kind === "resourceLt") {
      fields.push({
        path: `condition.${index}.res`,
        label: condition.kind === "resourceGte" ? "资源≥" : "资源<",
        value: condition.res,
        options: resOptions(),
      });
      fields.push({
        path: `condition.${index}.value`,
        label: "数值",
        value: condition.value,
        options: amountOptions(condition.value),
      });
    } else if (condition.kind === "energyEffLt") {
      fields.push({
        path: `condition.${index}.eff`,
        label: "效率<",
        value: String(condition.value),
        options: withCurrent(
          [0.5, 0.75, 0.9, 1].map((n) => ({ value: String(n), label: String(n) })),
          String(condition.value),
        ),
      });
    } else if (condition.kind === "ownedLt") {
      fields.push({
        path: `condition.${index}.producer`,
        label: "设施<",
        value: condition.producer,
        options: producerOptions(),
      });
      fields.push({
        path: `condition.${index}.owned`,
        label: "数量",
        value: String(condition.value),
        options: withCurrent(
          [10, 25, 50, 99, 999].map((n) => ({ value: String(n), label: String(n) })),
          String(condition.value),
        ),
      });
    } else if (condition.kind === "costRatioLt") {
      fields.push({
        path: `condition.${index}.producer`,
        label: "花费设施",
        value: condition.producer,
        options: producerOptions(),
      });
      fields.push({
        path: `condition.${index}.ratio`,
        label: "低于库存",
        value: String(condition.ratio),
        options: withCurrent(
          [0.1, 0.25, 0.5, 0.75, 0.9].map((n) => ({ value: String(n), label: `${Math.round(n * 100)}%` })),
          String(condition.ratio),
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
      options: actions.map((kind) => ({
        value: kind,
        label: kind === "buy" ? "购买" : kind === "collect" ? "采集" : "重置",
      })),
    });
  }
  if (card.action.kind === "buy") {
    fields.push({
      path: "action.producer",
      label: "设施",
      value: card.action.producer,
      options: producerOptions(),
    });
    fields.push({
      path: "action.amount",
      label: "数量",
      value: String(card.action.amount),
      options: [
        { value: "1", label: "×1" },
        { value: "10", label: "×10" },
        { value: "max", label: "最大" },
      ],
    });
  } else if (card.action.kind === "prestige") {
    fields.push({
      path: "action.minGain",
      label: "至少核心",
      value: String(card.action.minGain),
      options: withCurrent(
        [1, 2, 4, 10].map((n) => ({ value: String(n), label: String(n) })),
        String(card.action.minGain),
      ),
    });
  }
  return fields;
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
  if (card.trigger.kind === "onResource" && amountOf(state, card.trigger.res).lt(card.trigger.gte)) {
    return writeSlot(state, index, { ...slot, elapsed, lamp: "gray", reason: "资源未达触发" });
  }

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
    const gain = big(MANUAL_METAL_PER_CLICK);
    return {
      ok: true,
      reason: `自动采集 +${MANUAL_METAL_PER_CLICK} 金属`,
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
  if (!isProducerUnlocked(state, action.producer)) {
    return { state, ok: false, reason: `${producerById(action.producer).name}未解锁` };
  }
  const before = state.producers[action.producer];
  const next = buy(state, action.producer, action.amount === "max" ? "max" : action.amount);
  const gained = next.producers[action.producer].sub(before);
  if (gained.lt(1)) return { state, ok: false, reason: `买不起${producerById(action.producer).name}` };
  const qty = action.amount === "max" ? gained.toFixed(0) : String(action.amount);
  return { state: next, ok: true, reason: `购买 ${qty} 座${producerById(action.producer).name}` };
}

function failedCondition(state: GameState, card: ProtocolCard): string | null {
  for (const condition of card.conditions) {
    const reason = conditionFails(state, condition);
    if (reason) return reason;
  }
  return null;
}

function conditionFails(state: GameState, condition: Condition): string | null {
  if (condition.kind === "resourceGte") {
    if (amountOf(state, condition.res).lt(condition.value)) return `${RES_LABEL[condition.res]}未达到 ${condition.value}`;
    return null;
  }
  if (condition.kind === "resourceLt") {
    if (!amountOf(state, condition.res).lt(condition.value)) return `${RES_LABEL[condition.res]}不低于 ${condition.value}`;
    return null;
  }
  if (condition.kind === "energyEffLt") {
    if (!energyReport(state).efficiency.lt(condition.value)) return `能源效率不低于 ${condition.value}`;
    return null;
  }
  if (condition.kind === "ownedLt") {
    if (!state.producers[condition.producer].lt(condition.value)) {
      return `${producerById(condition.producer).name}不少于 ${condition.value}`;
    }
    return null;
  }
  if (condition.kind !== "costRatioLt") return null;
  const costs = nextCost(condition.producer, state.producers[condition.producer]);
  for (const id of ["metal", "crystal", "deuterium"] as const) {
    if (costs[id].lte(0)) continue;
    const stock = state.resources[id];
    if (stock.lte(0) || !costs[id].div(stock).lt(condition.ratio)) {
      return `${producerById(condition.producer).name}花费达到库存的 ${Math.round(condition.ratio * 100)}%`;
    }
  }
  return null;
}

function nextCost(id: ProducerId, owned: BigNumber): Record<"metal" | "crystal" | "deuterium", BigNumber> {
  const def = producerById(id);
  const costs = { metal: big(0), crystal: big(0), deuterium: big(0) };
  for (const res of ["metal", "crystal", "deuterium"] as const) {
    if (def.costs[res] > 0) costs[res] = big(def.costs[res]).mul(big(def.ratio).pow(owned));
  }
  return costs;
}

function amountOf(state: GameState, res: ResId): BigNumber {
  if (res === "energy") {
    const report = energyReport(state);
    return report.supply.sub(report.demand);
  }
  if (res === "warp_core") return state.warpCores;
  return state.resources[res];
}

function meetsUnlock(state: GameState, unlock: (typeof CARD_CATALOG)[number]["unlock"]): boolean {
  if (unlock.kind === "manualClicks") return state.manualClicks >= unlock.count;
  if (unlock.kind === "ownedGte") return state.producers[unlock.producer].gte(unlock.value);
  if (unlock.kind === "firstEnergyShortage") return state.seenEnergyShortage;
  if (unlock.kind === "firstPrestige") return state.hasPrestiged;
  return state.warpCores.gte(unlock.count);
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

function applyPatch(state: GameState, card: ProtocolCard, path: string, value: string): boolean {
  if (path === "trigger.kind") {
    if (value !== "interval" && value !== "onResource") return false;
    if (!availableKinds(state, card.trigger.kind, "triggers").includes(value)) return false;
    card.trigger =
      value === "interval"
        ? { kind: "interval", seconds: card.trigger.kind === "interval" ? card.trigger.seconds : 5 }
        : { kind: "onResource", res: "metal", gte: "100" };
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
  if (path === "trigger.gte" && card.trigger.kind === "onResource" && isAmount(value)) {
    card.trigger = { ...card.trigger, gte: value };
    return true;
  }
  if (path === "action.kind") {
    if (value !== "buy" && value !== "collect" && value !== "prestige") return false;
    if (!availableKinds(state, card.action.kind, "actions").includes(value)) return false;
    if (value === "collect") card.action = { kind: "collect" };
    else if (value === "prestige") card.action = { kind: "prestige", minGain: 2 };
    else card.action = { kind: "buy", producer: "metal_mine", amount: 1 };
    return true;
  }
  if (path === "action.producer" && card.action.kind === "buy" && isProducerId(value)) {
    card.action = { ...card.action, producer: value };
    return true;
  }
  if (path === "action.amount" && card.action.kind === "buy") {
    const amount = value === "max" ? "max" : value === "10" ? 10 : value === "1" ? 1 : null;
    if (amount === null) return false;
    card.action = { ...card.action, amount };
    return true;
  }
  if (path === "action.minGain" && card.action.kind === "prestige") {
    const minGain = Number(value);
    if (!Number.isInteger(minGain) || minGain < 1 || minGain > 100000) return false;
    card.action = { ...card.action, minGain };
    return true;
  }
  const match = /^condition\.(\d+)\.(res|value|producer|owned|ratio|eff)$/.exec(path);
  if (!match) return false;
  const index = Number(match[1]);
  const field = match[2];
  const condition = card.conditions[index];
  if (!condition || !field) return false;
  card.conditions[index] = patchCondition(condition, field, value) ?? condition;
  return card.conditions[index] !== condition;
}

function patchCondition(condition: Condition, field: string, value: string): Condition | null {
  if ((condition.kind === "resourceGte" || condition.kind === "resourceLt") && field === "res" && isResId(value)) {
    return { ...condition, res: value };
  }
  if ((condition.kind === "resourceGte" || condition.kind === "resourceLt") && field === "value" && isAmount(value)) {
    return { ...condition, value };
  }
  if (condition.kind === "energyEffLt" && field === "eff") {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0 || next > 1) return null;
    return { ...condition, value: next };
  }
  if ((condition.kind === "ownedLt" || condition.kind === "costRatioLt") && field === "producer" && isProducerId(value)) {
    return { ...condition, producer: value };
  }
  if (condition.kind === "ownedLt" && field === "owned") {
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1) return null;
    return { ...condition, value: next };
  }
  if (condition.kind === "costRatioLt" && field === "ratio") {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0 || next > 1) return null;
    return { ...condition, ratio: next };
  }
  return null;
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
  return `${RES_LABEL[trigger.res]} ≥ ${trigger.gte}`;
}

function conditionPhrase(condition: Condition): string {
  if (condition.kind === "resourceGte") return `${RES_LABEL[condition.res]} ≥ ${condition.value}`;
  if (condition.kind === "resourceLt") return `${RES_LABEL[condition.res]} < ${condition.value}`;
  if (condition.kind === "energyEffLt") return `能源效率 < ${condition.value}`;
  if (condition.kind === "ownedLt") return `${producerById(condition.producer).name}少于 ${condition.value}`;
  if (condition.kind === "costRatioLt") {
    return `${producerById(condition.producer).name}下一台花费低于库存的 ${Math.round(condition.ratio * 100)}%`;
  }
  return "条件";
}

function actionPhrase(action: Action): string {
  if (action.kind === "collect") return "采集";
  if (action.kind === "prestige") return `重置（至少 ${action.minGain} 曲率核心）`;
  const qty = action.amount === "max" ? "最大数量" : String(action.amount);
  return `购买 ${qty} 座${producerById(action.producer).name}`;
}

function resOptions(): ParamOption[] {
  return RES_IDS.map((id) => ({ value: id, label: RES_LABEL[id] }));
}

function producerOptions(): ParamOption[] {
  return PRODUCERS.map((producer) => ({ value: producer.id, label: producer.name }));
}

function amountOptions(current: string): ParamOption[] {
  return withCurrent(
    ["10", "50", "100", "1000", "10000", "1000000"].map((value) => ({ value, label: value })),
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
