import { CURVATURE_TECH, curvatureById } from "../data/curvature-tech";
import { arcadeSymbolDef } from "../data/arcade";
import { arcadeView, type ArcadeView } from "./arcade-present";
import { CARD_CATALOG, SLOT_RULES } from "../data/protocol-cards";
import { protocolSentence, slotFields, slotUnlockHint, unlockProgress, unlockedSlotCount, type ParamField } from "../automation/engine";
import { offlineCapSeconds, type OfflineCatchup } from "../core/offline";
import { ACHIEVEMENTS, ACHIEVEMENT_BONUS } from "../data/achievements";
import {
  CORE_BONUS_PER_CORE,
  OFFLINE_BASE_HOURS,
  OFFLINE_MAX_HOURS,
  OFFLINE_TECH_STEP_HOURS,
  PROTOCOL_OFFLINE_EVAL_SECONDS,
  PRODUCTION_IDS,
  RESOURCES,
  activeBuildings,
  buildingById,
  resourceName,
  type BuildingDef,
  type BuildingId,
  type ProductionBuildingId,
} from "../game/content";
import { big } from "../game/decimal";
import { economy, pctOf, satelliteSupply, type EconomySnapshot } from "../game/economy";
import { formatAmount, formatCount, formatDm, formatDuration, formatMultiplier, formatPlayed, formatRate, formatUnits } from "../game/format";
import {
  BASE_PRODUCTION,
  ECONOMY_SPEED,
  energyUsePerHour,
  fusionOutputPerHour,
  mineOutputPerHour,
  perSecond,
  satelliteEnergyPerUnit,
  solarOutputPerHour,
  storageCapacity,
} from "../game/formulas";
import { expansionScore, scrapeAmount, warpGain } from "../game/logic";
import { usedFields } from "../game/planet";
import { SILO_SLOTS_PER_LEVEL, unitById } from "../data/units";
import { shipyardView, type ShipyardView } from "./shipyard-present";
import { canEnqueue, missingRequirements, queueCapacity, secondsFor } from "../game/queue";
import type { CompletedBuild } from "../game/queue";
import {
  canEnqueueResearch,
  effectiveLabLevel,
  labBusyReason,
  researchCapacity,
  researchSecondsFor,
  type CompletedResearch,
} from "../game/research";
import { requirementLevel, requirementName } from "../game/requirements";
import {
  PLASMA_BONUS,
  RESEARCH,
  researchById,
  type ResearchDef,
  type ResearchGroup,
  type ResearchId,
} from "../data/research";
import { RESEARCH_SPEED, researchEnergyRequirement } from "../game/formulas";
import {
  DM_ACHIEVEMENT_REWARD,
  INVENTORY_IDS,
  INVENTORY_LABEL,
  PACKAGE_FRACTIONS,
  dmClockSeconds,
  SHOP_ITEMS,
  type InventoryItemId,
  type ShopItemId,
} from "../data/dark-matter";
import {
  packageQuote,
  shopItemReason,
  speedupQuote,
  type PackageKind,
  type SpeedupMode,
  type SpeedupTarget,
} from "../game/dark-matter";
import { outputScale, spentCores, techRank, unspentCores } from "../prestige/tree";
import { PROTOCOL_SLOT_COUNT, RESOURCE_IDS, type CardLamp, type CurvatureId, type GameState, type ResourceId } from "../game/types";

/** Metal-equivalent weights for payback time (OGame trade ratio 3 : 2 : 1). */
const METAL_EQUIV: Record<ResourceId, number> = { metal: 1, crystal: 1.5, deuterium: 3 };
const WARN_RATIO = 0.9;

export type FillLevel = "ok" | "warn" | "full";

export interface ResourceView {
  id: ResourceId;
  amount: string;
  cap: string;
  fillPct: number;
  fill: FillLevel;
  rate: string;
  eta: string;
}

export interface DmButtonView {
  label: string;
  enabled: boolean;
  title: string;
}

export interface QueueItemView {
  index: number;
  key: string;
  label: string;
  detail: string;
  progressPct: number;
  active: boolean;
  /** Dark matter halve / finish buttons, only on the running order. */
  halve: DmButtonView | null;
  finish: DmButtonView | null;
}

export interface QueueView {
  summary: string;
  items: QueueItemView[];
  signature: string;
  idleHint: string;
}

export interface BuildingView {
  id: BuildingId;
  level: string;
  cost: string;
  time: string;
  effect: string;
  payback: string;
  requires: string;
  locked: boolean;
  button: string;
  canEnqueue: boolean;
  reason: string;
}

export interface RequirementChip {
  label: string;
  met: boolean;
}

export interface ResearchView {
  id: ResearchId;
  group: ResearchGroup;
  level: string;
  cost: string;
  time: string;
  effect: string;
  later: string;
  chain: RequirementChip[];
  chainKey: string;
  locked: boolean;
  button: string;
  canEnqueue: boolean;
  reason: string;
}

export interface ResearchPanelView {
  visible: boolean;
  queue: QueueView;
  summary: string;
  items: ResearchView[];
}

export interface ShopItemView {
  id: ShopItemId;
  name: string;
  detail: string;
  price: string;
  /** Boosters get one button per resource; time items one button. */
  buttons: Array<{ res: ResourceId | ""; label: string; enabled: boolean; title: string }>;
}

export interface PackageView {
  kind: PackageKind;
  label: string;
  buttons: Array<{ fraction: number; label: string; enabled: boolean; title: string }>;
}

export interface InventoryView {
  id: InventoryItemId;
  name: string;
  detail: string;
  count: string;
  enabled: boolean;
  title: string;
}

export interface DarkMatterView {
  visible: boolean;
  chip: string;
  summary: string;
  shop: ShopItemView[];
  packages: PackageView[];
  inventory: InventoryView[];
  boosters: string[];
}

export interface ProductionSettingView {
  id: ProductionBuildingId;
  value: string;
  note: string;
}

export interface TableRowView {
  key: string;
  cells: string[];
}

export interface OverviewView {
  planet: string;
  temperature: string;
  fields: string;
  global: string;
  production: TableRowView[];
  energy: TableRowView[];
  energySummary: string;
}

export interface CatalogView {
  id: string;
  label: string;
  unlocked: boolean;
  hint: string;
}

export interface SlotView {
  index: number;
  unlocked: boolean;
  lockHint: string;
  enabled: boolean;
  sentence: string;
  lamp: CardLamp;
  reason: string;
  fields: ParamField[];
  fieldsKey: string;
}

export interface AchievementView {
  id: string;
  unlocked: boolean;
  progress: string;
}

export interface OfflineGainView {
  id: ResourceId;
  name: string;
  amount: string;
}

export interface OfflineView {
  applied: string;
  detail: string;
  gains: OfflineGainView[];
  builds: string[];
  research: string[];
  units: string[];
  arcade: string[];
  protocol: string;
}

export interface TechView {
  id: CurvatureId;
  owned: string;
  detail: string;
  preview: string;
  button: string;
  canBuy: boolean;
}

export interface ViewModel {
  telemetry: string;
  multiplier: string;
  played: string;
  passive: string;
  resources: ResourceView[];
  energy: string;
  energyShort: boolean;
  queue: QueueView;
  research: ResearchPanelView;
  shipyard: ShipyardView;
  darkMatter: DarkMatterView;
  arcade: ArcadeView;
  buildings: BuildingView[];
  production: ProductionSettingView[];
  overview: OverviewView;
  score: string;
  gain: string;
  canPrestige: boolean;
  status: string;
  banner: string | null;
  notice: string | null;
  offlineCap: string;
  protocolEnergy: string;
  protocolMeta: string;
  catalog: CatalogView[];
  slots: SlotView[];
  achievements: AchievementView[];
  achievementSummary: string;
  offline: OfflineView | null;
  techs: TechView[];
  unspentLine: string;
  scrapeLabel: string;
}

export interface PresentInput {
  status: string;
  banner: string | null;
  notice: string | null;
  catchup: OfflineCatchup | null;
}

export function present(state: GameState, input: PresentInput): ViewModel {
  const eco = economy(state);
  const open = unlockedSlotCount(state);
  const unspent = unspentCores(state);
  return {
    telemetry: formatCount(state.warpCores),
    multiplier: `全局 ${formatMultiplier(big(eco.global))}`,
    played: formatPlayed(state.totalTime),
    passive: `手动操作 ${state.stats.manualActions} 次 · 已完成建造 ${state.stats.buildsCompleted} 次`,
    resources: RESOURCES.map((resource) => resourceView(state, eco, resource.id)),
    energy: energyLine(eco),
    energyShort: eco.efficiency < 1,
    queue: queueView(state),
    research: researchPanel(state),
    shipyard: shipyardView(state),
    darkMatter: darkMatterView(state),
    arcade: arcadeView(state),
    buildings: activeBuildings().map((def) => buildingView(state, eco, def)),
    production: PRODUCTION_IDS.map((id) => productionSetting(state, id)),
    overview: overviewView(state, eco),
    score: formatAmount(expansionScore(state)),
    gain: formatCount(warpGain(state)),
    canPrestige: warpGain(state).gte(1),
    status: input.status,
    banner: input.banner,
    notice: input.notice,
    offlineCap: `${formatDuration(offlineCapSeconds(state))}（基础 ${OFFLINE_BASE_HOURS} 小时，曲率科技每次 +${OFFLINE_TECH_STEP_HOURS} 小时，最高 ${OFFLINE_MAX_HOURS} 小时）`,
    protocolEnergy: energyLine(eco),
    protocolMeta: `槽位 ${open}/${SLOT_RULES.hardCap} · 机器人工厂每 ${SLOT_RULES.roboticsPerLevels} 级 +1 · 计算机技术每 ${SLOT_RULES.computerPerLevels} 级 +1`,
    catalog: CARD_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.labelZh,
      unlocked: state.unlockedCards.includes(entry.id),
      hint: unlockProgress(state, entry.id),
    })),
    slots: presentSlots(state, open),
    achievements: ACHIEVEMENTS.map((def) => {
      const unlocked = state.unlocked.includes(def.id);
      const progress = def.progress(state);
      const current = progress.amount ? formatAmount(progress.current) : formatCount(progress.current);
      const goal = progress.amount ? formatAmount(progress.goal) : formatCount(progress.goal);
      return { id: def.id, unlocked, progress: unlocked ? "已达成 · +1%" : `${current} / ${goal}` };
    }),
    achievementSummary: achievementSummary(state),
    offline: presentOffline(input.catchup),
    techs: CURVATURE_TECH.map((node) => techView(state, node.id)),
    unspentLine: `未花费 ${formatCount(unspent)} / 已花费 ${formatCount(spentCores(state))} · 被动 ${passiveLabel(unspent)}`,
    scrapeLabel: `手动采集 +${formatAmount(big(scrapeAmount(state)))} 金属`,
  };
}

// ---------- top bar ----------

function resourceView(state: GameState, eco: EconomySnapshot, id: ResourceId): ResourceView {
  const stock = state.resources[id].toNumber();
  const cap = eco.caps[id];
  const ratio = cap > 0 ? stock / cap : 0;
  const net = eco.net[id];
  let eta = "";
  if (ratio >= 1 && eco.stopped[id]) eta = "已满 · 产出已停止";
  else if (ratio >= 1) eta = "已满";
  else if (net > 0) eta = `约 ${formatDuration((cap - stock) / net)} 后满`;
  else if (net < 0 && stock > 0) eta = `约 ${formatDuration(stock / -net)} 后耗尽`;
  return {
    id,
    amount: formatAmount(state.resources[id]),
    cap: `/ ${formatAmount(big(cap))}`,
    fillPct: Math.max(0, Math.min(100, ratio * 100)),
    fill: ratio >= 1 ? "full" : ratio >= WARN_RATIO ? "warn" : "ok",
    rate: formatRate(big(net)),
    eta,
  };
}

function energyLine(eco: EconomySnapshot): string {
  const lack = eco.demand > eco.supply ? ` · 缺 ${formatAmount(big(eco.demand - eco.supply))}` : "";
  return `供给 ${formatAmount(big(eco.supply))} / 需求 ${formatAmount(big(eco.demand))} · 效率 ${(eco.efficiency * 100).toFixed(0)}%${lack}`;
}

// ---------- queue ----------

function queueView(state: GameState): QueueView {
  const planet = state.planet;
  const capacity = queueCapacity(state);
  const items = planet.buildQueue.map((order, index): QueueItemView => {
    const def = buildingById(order.building);
    const active = index === 0 && order.totalSeconds > 0;
    const progress = active ? (1 - order.remainingSeconds / order.totalSeconds) * 100 : 0;
    const estimate = secondsFor(state, def, order.targetLevel, order.paid);
    return {
      index,
      key: `${order.building}:${order.targetLevel}:${index}`,
      label: `${def.nameZh} → 等级 ${order.targetLevel}`,
      detail: active
        ? `剩余 ${formatDuration(Math.ceil(order.remainingSeconds))} / 共 ${formatDuration(Math.ceil(order.totalSeconds))}`
        : `等待中 · 已付款 · 预计 ${formatDuration(Math.ceil(estimate))}`,
      progressPct: Math.max(0, Math.min(100, progress)),
      active,
      ...speedupButtons(state, active ? order.remainingSeconds : null, "build"),
    };
  });
  return {
    summary: `建造队列 ${planet.buildQueue.length}/${capacity} · 格子 ${usedFields(planet)}/${planet.fieldsMax}`,
    items,
    signature: items.map((item) => item.key).join("|"),
    idleHint: items.length === 0 ? "队列空闲。选择下方建筑入队，入队时扣费，取消全额退还。" : "",
  };
}

// ---------- dark matter ----------

export function speedupButtons(
  state: GameState,
  remaining: number | null,
  target: SpeedupTarget,
): { halve: DmButtonView | null; finish: DmButtonView | null } {
  if (remaining === null) return { halve: null, finish: null };
  const button = (mode: SpeedupMode): DmButtonView => {
    const quote = speedupQuote(remaining, target, mode);
    const affordable = state.darkMatter.gte(quote.dm);
    const verb = mode === "halve" ? "减半" : "完成";
    return {
      label: `${verb} ${formatDm(quote.dm)}`,
      enabled: quote.allowed && affordable,
      title: !quote.allowed
        ? quote.reason
        : affordable
          ? `花 ${formatDm(quote.dm)} 暗物质${mode === "halve" ? "把剩余时间减半" : "立即完成"}（OGame 价格：每 30 分钟 750）`
          : `暗物质不足：需要 ${formatDm(quote.dm)}`,
    };
  };
  return { halve: button("halve"), finish: button("finish") };
}

const RES_SHORT: Record<ResourceId, string> = { metal: "金属", crystal: "晶体", deuterium: "重氢" };

function darkMatterView(state: GameState): DarkMatterView {
  const visible = state.stats.darkMatterEarned > 0 || state.darkMatter.gt(0);
  const shop: ShopItemView[] = SHOP_ITEMS.map((def) => {
    const price = `${formatDm(def.dm)} 暗物质`;
    if (def.kind === "booster") {
      const seconds = dmClockSeconds((def.ogameDays ?? 7) * 24);
      return {
        id: def.id,
        name: def.nameZh,
        detail: `所选资源矿产量 +${def.pct}%，持续 ${formatDuration(seconds)}（OGame ${def.ogameDays} 天）。同一资源只保留最强的一个。`,
        price,
        buttons: RESOURCE_IDS.map((res) => {
          const reason = shopItemReason(state, def.id, res);
          return { res, label: RES_SHORT[res], enabled: reason === "", title: reason || `购买并激活：${RES_SHORT[res]}` };
        }),
      };
    }
    const seconds = dmClockSeconds(def.ogameHours ?? 0);
    const reason = shopItemReason(state, def.id);
    return {
      id: def.id,
      name: def.nameZh,
      detail: `${def.kind === "kraken" ? "正在建造的建筑" : "正在进行的研究"}缩短 ${formatDuration(seconds)}（OGame ${def.ogameHours} 小时），多余的时间顺延到下一项，不受单次上限限制。`,
      price,
      buttons: [{ res: "", label: "购买并使用", enabled: reason === "", title: reason || "立即生效" }],
    };
  });
  const kinds: PackageKind[] = ["metal", "crystal", "deuterium", "bundle"];
  const packages: PackageView[] = kinds.map((kind) => ({
    kind,
    label: kind === "bundle" ? "三资源套餐" : `${RES_SHORT[kind]}包`,
    buttons: PACKAGE_FRACTIONS.map((fraction) => {
      const quote = packageQuote(state, kind, fraction);
      const got = RESOURCE_IDS.filter((id) => quote.amounts[id].gt(0))
        .map((id) => `${RES_SHORT[id]} ${formatAmount(quote.amounts[id])}`)
        .join("、");
      return {
        fraction,
        label: `${Math.round(fraction * 100)}% · ${formatDm(quote.dm)}`,
        enabled: quote.ok,
        title: quote.ok ? `获得 ${got}` : quote.reason || "不可购买",
      };
    }),
  }));
  const inventory: InventoryView[] = INVENTORY_IDS.map((id) => ({
    id,
    name: INVENTORY_LABEL[id].name,
    detail: INVENTORY_LABEL[id].detail,
    count: `×${state.items[id]}`,
    enabled: state.items[id] > 0,
    title: state.items[id] > 0 ? "使用一个" : "背包里没有（深空星环机的补给箱会掉落）",
  }));
  const now = state.totalTime.toNumber();
  const boosters = state.boosters
    .filter((booster) => booster.until > now)
    .map((booster) => `${RES_SHORT[booster.res]}矿 +${booster.pct}% · 剩余 ${formatDuration(Math.ceil(booster.until - now))}`);
  return {
    visible,
    chip: formatDm(state.darkMatter),
    summary: `现有 ${formatDm(state.darkMatter)} 暗物质 · 累计获得 ${formatDm(state.stats.darkMatterEarned)}。来源：每个新成就 +${DM_ACHIEVEMENT_REWARD}；深空星环机（天体物理学 1 级后开放）。`,
    shop,
    packages,
    inventory,
    boosters: boosters.length > 0 ? boosters : ["没有生效中的资源加成"],
  };
}

// ---------- research ----------

/** The research tab appears once a research lab stands (or any research exists, e.g. after a launch). */
export function researchVisible(state: GameState): boolean {
  if (state.planet.buildings.research_lab >= 1 || state.research.queue.length > 0) return true;
  return Object.values(state.research.levels).some((level) => level > 0);
}

function researchQueueView(state: GameState): QueueView {
  const capacity = researchCapacity(state);
  const items = state.research.queue.map((order, index): QueueItemView => {
    const def = researchById(order.tech);
    const active = index === 0 && order.totalSeconds > 0;
    const progress = active ? (1 - order.remainingSeconds / order.totalSeconds) * 100 : 0;
    const estimate = researchSecondsFor(state, def, order.targetLevel, order.paid);
    return {
      index,
      key: `${order.tech}:${order.targetLevel}:${index}`,
      label: `${def.nameZh} → 等级 ${order.targetLevel}`,
      detail: active
        ? `剩余 ${formatDuration(Math.ceil(order.remainingSeconds))} / 共 ${formatDuration(Math.ceil(order.totalSeconds))}`
        : `等待中 · 已付款 · 预计 ${formatDuration(Math.ceil(estimate))}`,
      progressPct: Math.max(0, Math.min(100, progress)),
      active,
      ...speedupButtons(state, active ? order.remainingSeconds : null, "research"),
    };
  });
  const lab = effectiveLabLevel(state);
  const busy = labBusyReason(state);
  let idleHint = "";
  if (items.length === 0) {
    idleHint = lab < 1 ? "先建造研究实验室（建筑页）。" : busy ? `${busy}。` : "研究队列空闲。研究同一时间只进行 1 项，入队时扣费，取消全额退还。";
  }
  return {
    summary: `研究队列 ${state.research.queue.length}/${capacity} · 研究实验室 ${lab} 级`,
    items,
    signature: items.map((item) => item.key).join("|"),
    idleHint,
  };
}

function researchPanel(state: GameState): ResearchPanelView {
  const total = Object.values(state.research.levels).reduce((sum, level) => sum + level, 0);
  return {
    visible: researchVisible(state),
    queue: researchQueueView(state),
    summary: `研究总等级 ${total} · 研究速度 ×${RESEARCH_SPEED} · 研究等级在发射殖民舰后保留`,
    items: RESEARCH.map((def) => researchView(state, def)),
  };
}

function researchView(state: GameState, def: ResearchDef): ResearchView {
  const check = canEnqueueResearch(state, def.id);
  const target = check.targetLevel;
  const level = state.research.levels[def.id];
  const queued = target - 1 - level;
  const energy = researchEnergyRequirement(def, target);
  const seconds = researchSecondsFor(state, def, target, check.cost);
  const chain: RequirementChip[] = def.requires.map((req) => {
    const have = requirementLevel(state, req);
    return { label: `${requirementName(req)} ${Math.min(have, req.level)}/${req.level}`, met: have >= req.level };
  });
  const cost = energy > 0 ? `需能源供给 ${formatAmount(big(energy))}（不消耗）` : costLine(check.cost);
  return {
    id: def.id,
    group: def.group,
    level: queued > 0 ? `${level}（队列中 +${queued}）` : String(level),
    cost,
    time: `研究时间 ${formatDuration(Math.ceil(seconds))}`,
    effect: researchEffect(state, def, target),
    later: def.later ? `后续：${def.later}` : "",
    chain,
    chainKey: chain.map((chip) => `${chip.label}:${chip.met ? 1 : 0}`).join("|"),
    locked: chain.some((chip) => !chip.met),
    button: `研究 等级 ${target}`,
    canEnqueue: check.ok,
    reason: check.ok ? "可以研究" : check.reason,
  };
}

function researchEffect(state: GameState, def: ResearchDef, target: number): string {
  const levels = state.research.levels;
  if (def.id === "energy_tech") {
    const b = state.planet.buildings.fusion_reactor;
    const now = fusionOutputPerHour(b, target - 1);
    const next = fusionOutputPerHour(b, target);
    return `${def.effect}。下一级：核聚变供电 ${formatAmount(big(now))} → ${formatAmount(big(next))}`;
  }
  if (def.id === "computer_tech") {
    const slot = target % SLOT_RULES.computerPerLevels === 0 ? "，多开 1 个协议卡槽" : "";
    return `${def.effect}。下一级：等级 ${target}${slot}`;
  }
  if (def.id === "plasma_tech") {
    const pct = (rate: number) => `${(rate * target * 100).toFixed(2)}%`;
    return `${def.effect}。下一级合计：金属 +${pct(PLASMA_BONUS.metal)}、晶体 +${pct(PLASMA_BONUS.crystal)}、重氢 +${pct(PLASMA_BONUS.deuterium)}`;
  }
  if (def.id === "astrophysics" && levels.astrophysics < 1) return `${def.effect}（第 2 阶段后续版本开放）`;
  return def.effect;
}

// ---------- building cards ----------

function withLevel(state: GameState, id: BuildingId, level: number): GameState {
  return { ...state, planet: { ...state.planet, buildings: { ...state.planet.buildings, [id]: level } } };
}

function costLine(cost: ReturnType<typeof canEnqueue>["cost"]): string {
  const parts: string[] = [];
  for (const id of RESOURCE_IDS) {
    if (cost[id].gt(0)) parts.push(`${resourceName(id)} ${formatAmount(cost[id])}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "免费";
}

function signed(value: number, unit: string): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatAmount(big(Math.abs(value)))} ${unit}`;
}

function buildingView(state: GameState, eco: EconomySnapshot, def: BuildingDef): BuildingView {
  const planet = state.planet;
  const check = canEnqueue(state, def.id);
  const target = check.targetLevel;
  const missing = missingRequirements(state, def);
  const seconds = secondsFor(state, def, target, check.cost);
  const { effect, gainPerSecond } = effectOf(state, eco, def, target);
  const costEquiv = RESOURCE_IDS.reduce((sum, id) => sum + check.cost[id].toNumber() * METAL_EQUIV[id], 0);
  const payback = gainPerSecond > 0 ? `回本约 ${formatDuration(costEquiv / gainPerSecond)}（按 3:2:1 折算金属）` : "";
  const queued = target - 1 - planet.buildings[def.id];
  return {
    id: def.id,
    level: queued > 0 ? `${planet.buildings[def.id]}（队列中 +${queued}）` : String(planet.buildings[def.id]),
    cost: costLine(check.cost),
    time: `建造时间 ${formatDuration(Math.ceil(seconds))}`,
    effect,
    payback,
    requires: missing.length > 0 ? `前置未满足：${missing.join("、")}` : "",
    locked: missing.length > 0,
    button: `升级到 等级 ${target}`,
    canEnqueue: check.ok,
    reason: check.ok ? "可以入队" : check.reason,
  };
}

/** Next-level change in production and energy, from the real economy with the level raised by one. */
function effectOf(
  state: GameState,
  eco: EconomySnapshot,
  def: BuildingDef,
  target: number,
): { effect: string; gainPerSecond: number } {
  const id = def.id;
  const b = state.planet.buildings;
  if (id === "metal_storage" || id === "crystal_storage" || id === "deuterium_tank") {
    return { effect: `容量 ${formatAmount(big(storageCapacity(target - 1)))} → ${formatAmount(big(storageCapacity(target)))}`, gainPerSecond: 0 };
  }
  if (id === "robotics_factory") {
    const slot = target % SLOT_RULES.roboticsPerLevels === 0 ? " · 多开 1 个协议卡槽" : "";
    return { effect: `建造速度 ×${target} → ×${target + 1}${slot}`, gainPerSecond: 0 };
  }
  if (id === "nanite_factory") {
    return { effect: `建造速度 ×${2 ** (target - 1)} → ×${2 ** target}`, gainPerSecond: 0 };
  }
  if (id === "shipyard") {
    return { effect: target === 1 ? "解锁造船厂与防御标签" : `造船速度 ×${target} → ×${target + 1}（造船时间 ÷(1+等级)）`, gainPerSecond: 0 };
  }
  if (id === "missile_silo") {
    return { effect: `导弹井容量 ${(target - 1) * SILO_SLOTS_PER_LEVEL} → ${target * SILO_SLOTS_PER_LEVEL} 格`, gainPerSecond: 0 };
  }
  if (id === "research_lab") {
    return { effect: `研究速度 ×${target} → ×${target + 1}（研究时间 ÷(1+等级)）`, gainPerSecond: 0 };
  }

  const before = economy(withLevel(state, id, target - 1));
  const after = economy(withLevel(state, id, target));
  const parts: string[] = [];
  let gain = 0;
  for (const res of RESOURCE_IDS) {
    const delta = after.gross[res] - after.consumption[res] - (before.gross[res] - before.consumption[res]);
    if (Math.abs(delta) > 1e-9) parts.push(signed(delta, `${resourceName(res)}/秒`));
    gain += delta * METAL_EQUIV[res];
  }
  const supply = after.supply - before.supply;
  const demand = after.demand - before.demand;
  if (Math.abs(supply) > 1e-9) parts.push(signed(supply, "供电"));
  if (Math.abs(demand) > 1e-9) parts.push(signed(-demand, "能源"));
  if (parts.length === 0) parts.push(b[id] === 0 && eco.efficiency === 0 ? "无电时不产出" : "无变化");
  return { effect: `下一级：${parts.join("，")}`, gainPerSecond: gain };
}

function productionSetting(state: GameState, id: ProductionBuildingId): ProductionSettingView {
  const level = state.planet.buildings[id];
  return {
    id,
    value: String(Math.round(pctOf(state.planet, id) * 100)),
    note: `等级 ${level}`,
  };
}

// ---------- overview ----------

function overviewView(state: GameState, eco: EconomySnapshot): OverviewView {
  const planet = state.planet;
  const b = planet.buildings;
  const g = eco.global;
  const fmt = (n: number) => (n === 0 ? "—" : formatRate(big(n)));
  const plasma = state.research.levels.plasma_tech;
  const plasmaFactor = {
    metal_mine: 1 + PLASMA_BONUS.metal * plasma,
    crystal_mine: 1 + PLASMA_BONUS.crystal * plasma,
    deuterium_synth: 1 + PLASMA_BONUS.deuterium * plasma,
  };
  const mine = (id: "metal_mine" | "crystal_mine" | "deuterium_synth") =>
    perSecond(
      mineOutputPerHour(id, b[id], planet.tempMax) * pctOf(planet, id) * eco.efficiency * plasmaFactor[id],
      ECONOMY_SPEED,
    ) * g;
  const production: TableRowView[] = [
    { key: "base", cells: ["星球基础产出", fmt(perSecond(BASE_PRODUCTION.metal) * g), fmt(perSecond(BASE_PRODUCTION.crystal) * g), "—"] },
    { key: "metal_mine", cells: [`金属矿（${b.metal_mine} 级）`, fmt(mine("metal_mine")), "—", "—"] },
    { key: "crystal_mine", cells: [`晶体矿（${b.crystal_mine} 级）`, "—", fmt(mine("crystal_mine")), "—"] },
    { key: "deuterium_synth", cells: [`重氢合成器（${b.deuterium_synth} 级）`, "—", "—", fmt(mine("deuterium_synth"))] },
    { key: "fusion", cells: [`核聚变消耗（${b.fusion_reactor} 级）`, "—", "—", fmt(-eco.consumption.deuterium)] },
    {
      key: "net",
      cells: ["净变化（含满仓停产）", fmt(eco.net.metal), fmt(eco.net.crystal), fmt(eco.net.deuterium)],
    },
    {
      key: "caps",
      cells: [
        "库存 / 上限",
        ...RESOURCE_IDS.map((id) => `${formatAmount(state.resources[id])} / ${formatAmount(big(eco.caps[id]))}`),
      ],
    },
  ];
  const doubled = outputScale(state);
  const solar = solarOutputPerHour(b.solar_plant) * pctOf(planet, "solar_plant") * doubled;
  const fusion = fusionOutputPerHour(b.fusion_reactor, state.research.levels.energy_tech) * pctOf(planet, "fusion_reactor") * eco.fusionFactor * doubled;
  const use = (id: "metal_mine" | "crystal_mine" | "deuterium_synth") => energyUsePerHour(id, b[id]) * pctOf(planet, id);
  const energy: TableRowView[] = [
    { key: "solar", cells: [`太阳能电站（${b.solar_plant} 级）`, `+${formatAmount(big(solar))}`] },
    {
      key: "fusion",
      cells: [
        `核聚变反应堆（${b.fusion_reactor} 级）${eco.fusionFactor < 1 ? ` · 缺重氢降额 ${(eco.fusionFactor * 100).toFixed(0)}%` : ""}`,
        `+${formatAmount(big(fusion))}`,
      ],
    },
    {
      key: "satellite",
      cells: [`太阳能卫星（${formatUnits(planet.units.solar_satellite)} 颗 × ${satelliteEnergyPerUnit(planet.tempMax)}）`, `+${formatAmount(big(satelliteSupply(planet) * doubled))}`],
    },
    { key: "metal_mine", cells: [`金属矿（${b.metal_mine} 级）`, `−${formatAmount(big(use("metal_mine")))}`] },
    { key: "crystal_mine", cells: [`晶体矿（${b.crystal_mine} 级）`, `−${formatAmount(big(use("crystal_mine")))}`] },
    { key: "deuterium_synth", cells: [`重氢合成器（${b.deuterium_synth} 级）`, `−${formatAmount(big(use("deuterium_synth")))}`] },
  ];
  return {
    planet: planet.name,
    temperature: `最高温度 ${planet.tempMax}°C`,
    fields: `${usedFields(planet)} / ${planet.fieldsMax}`,
    global: `全局倍率 ${formatMultiplier(big(g))}（未花费曲率核心、成就、产线翻倍）· 宇宙速度 ×${ECONOMY_SPEED}${
      plasma > 0 ? ` · 等离子技术 ${plasma} 级：矿产 +${(PLASMA_BONUS.metal * plasma * 100).toFixed(2)}% / +${(PLASMA_BONUS.crystal * plasma * 100).toFixed(2)}% / +${(PLASMA_BONUS.deuterium * plasma * 100).toFixed(2)}%` : ""
    }`,
    production,
    energy,
    energySummary: energyLine(eco),
  };
}

// ---------- other tabs ----------

function techView(state: GameState, id: CurvatureId): TechView {
  const node = curvatureById(id);
  const rank = techRank(state, id);
  const maxed = rank >= node.maxRank;
  const unspent = unspentCores(state);
  const canBuy = !maxed && unspent.gte(node.cost);
  const owned = node.maxRank > 1 ? `${rank}/${node.maxRank}` : rank > 0 ? "已购" : "未购";
  return {
    id,
    owned,
    detail: `${node.effect}。${node.note}`,
    preview: maxed ? "效果已生效" : spendPreview(unspent, node.cost),
    button: maxed ? "已购" : `花费 ${node.cost}`,
    canBuy,
  };
}

function spendPreview(unspent: GameState["warpCores"], cost: number): string {
  const after = unspent.sub(cost);
  const next = after.gt(0) ? after : unspent.sub(unspent);
  return `花费后未花费 ${formatCount(unspent)} → ${formatCount(next)}，被动 ${passiveLabel(unspent)} → ${passiveLabel(next)}`;
}

function passiveLabel(cores: GameState["warpCores"]): string {
  return `+${cores.mul(CORE_BONUS_PER_CORE).mul(100).toFixed(0)}%`;
}

function achievementSummary(state: GameState): string {
  const unlocked = state.unlocked.length;
  const bonus = Math.round(unlocked * ACHIEVEMENT_BONUS * 100);
  return `已解锁 ${unlocked} / ${ACHIEVEMENTS.length} · 全局产出 +${bonus}%`;
}

/** Group consecutive levels: "金属矿 等级 10 → 13（4 次）". */
export function summarizeBuilds(builds: readonly CompletedBuild[]): string[] {
  const groups = new Map<BuildingId, { min: number; max: number; count: number }>();
  for (const build of builds) {
    const group = groups.get(build.building);
    if (group) {
      group.min = Math.min(group.min, build.level);
      group.max = Math.max(group.max, build.level);
      group.count += 1;
    } else {
      groups.set(build.building, { min: build.level, max: build.level, count: 1 });
    }
  }
  return [...groups.entries()].map(([id, group]) => {
    const name = buildingById(id).nameZh;
    return group.count === 1 ? `${name} → 等级 ${group.max}` : `${name} 等级 ${group.min} → ${group.max}（${group.count} 次）`;
  });
}

/** Group consecutive research levels: "能源技术 等级 1 → 3（3 次）". */
export function summarizeResearch(done: readonly CompletedResearch[]): string[] {
  const groups = new Map<ResearchId, { min: number; max: number; count: number }>();
  for (const item of done) {
    const group = groups.get(item.tech);
    if (group) {
      group.min = Math.min(group.min, item.level);
      group.max = Math.max(group.max, item.level);
      group.count += 1;
    } else {
      groups.set(item.tech, { min: item.level, max: item.level, count: 1 });
    }
  }
  return [...groups.entries()].map(([id, group]) => {
    const name = researchById(id).nameZh;
    return group.count === 1 ? `${name} → 等级 ${group.max}` : `${name} 等级 ${group.min} → ${group.max}（${group.count} 次）`;
  });
}

function summarizeArcadeOffline(catchup: OfflineCatchup): string[] {
  const lines = catchup.arcadeRuns.map((entry) => `${arcadeSymbolDef(entry.symbol).nameZh}${entry.big ? "（大）" : ""}：${entry.summary}`);
  if (catchup.arcadeStored > 0) lines.push(`星环机现有 ${catchup.arcadeStored} 次开奖等你揭晓`);
  return lines;
}

function presentOffline(catchup: OfflineCatchup | null): OfflineView | null {
  if (!catchup || catchup.appliedSeconds < 1) return null;
  const cap = formatDuration(catchup.capSeconds);
  const applied = formatDuration(catchup.appliedSeconds);
  const raw = formatDuration(catchup.rawSeconds);
  const limit = catchup.capped ? `已触顶，超出 ${cap} 的部分不结算。` : "未触顶。";
  const builds = summarizeBuilds(catchup.completedBuilds);
  return {
    applied,
    detail: `离开 ${raw}，结算 ${applied}。当前上限 ${cap}。${limit}`,
    gains: RESOURCES.map((resource) => ({
      id: resource.id,
      name: resource.name,
      amount: `+${formatAmount(catchup.gains[resource.id])}`,
    })),
    builds: builds.length > 0 ? builds : ["离线期间没有完成的建造"],
    research: summarizeResearch(catchup.completedResearch),
    units: catchup.completedUnits.map((done) => `${unitById(done.unit).nameZh} +${formatUnits(done.count)}`),
    arcade: summarizeArcadeOffline(catchup),
    protocol: `协议卡已按每 ${PROTOCOL_OFFLINE_EVAL_SECONDS} 秒求值 ${catchup.protocolEvaluations} 次（建造完成、满仓时也会触发）。`,
  };
}

function presentSlots(state: GameState, open: number): SlotView[] {
  return state.protocols.slots.slice(0, PROTOCOL_SLOT_COUNT).map((slot, index) => {
    const unlocked = index < open;
    const fields = unlocked && slot.card ? slotFields(state, slot.card) : [];
    return {
      index,
      unlocked,
      lockHint: unlocked ? "" : slotUnlockHint(state, index),
      enabled: slot.card?.enabled ?? false,
      sentence: unlocked && slot.card ? protocolSentence(slot.card) : "",
      lamp: slot.lamp,
      reason: slot.reason,
      fields,
      fieldsKey: fields.map((field) => `${field.path}=${field.value}:${field.options.map((option) => option.value).join(",")}`).join("|"),
    };
  });
}
