import { activePlanet } from "../game/empire";
/**
 * Presenter for the shipyard and defense tabs (P3): unit cards with live stats, the shipyard queue,
 * missile silo and pause state. Pure: GameState in, plain view data out.
 */
import { DRIVE_BONUS, DRIVE_NAME, SHIPS, DEFENSES, unitById, type DriveStage, type UnitDef, type UnitId } from "../data/units";
import { big } from "../game/decimal";
import { formatAmount, formatDuration, formatUnits } from "../game/format";
import { requirementLevel, requirementName } from "../game/requirements";
import {
  SHIPYARD,
  canBuildUnits,
  maxBuildable,
  queuedUnits,
  satelliteEnergy,
  shipyardPausedReason,
  shipyardQueueSeconds,
  siloCapacity,
  siloUsed,
  unitCost,
  unitSeconds,
} from "../game/shipyard";
import { outputScale } from "../prestige/tree";
import type { GameState } from "../game/types";
import { speedupButtons, type QueueItemView, type QueueView, type RequirementChip } from "./present";

export interface UnitCardView {
  id: UnitId;
  owned: string;
  queued: string;
  stats: string;
  mobility: string;
  cost: string;
  time: string;
  chain: RequirementChip[];
  chainKey: string;
  locked: boolean;
  canBuild: boolean;
  reason: string;
  max: number;
  maxLabel: string;
}

export interface ShipyardView {
  visible: boolean;
  summary: string;
  queue: QueueView;
  ships: UnitCardView[];
  defenses: UnitCardView[];
  silo: string;
}

export function shipyardVisible(state: GameState): boolean {
  return activePlanet(state).buildings.shipyard >= 1 || activePlanet(state).shipyardQueue.length > 0;
}

/** The engine stage a ship flies with now: the last stage whose drive level is met. */
export function currentDrive(state: GameState, def: UnitDef): DriveStage | null {
  let pick: DriveStage | null = null;
  for (const stage of def.drives) {
    if (stage.level === 0 || state.research.levels[stage.drive] >= stage.level) pick = stage;
  }
  return pick;
}

/** Speed with the drive bonus (combustion +10%, impulse +20%, hyperspace +30% per level). */
export function shipSpeed(state: GameState, def: UnitDef): number {
  const stage = currentDrive(state, def);
  if (!stage) return 0;
  return Math.floor(stage.speed * (1 + DRIVE_BONUS[stage.drive] * state.research.levels[stage.drive]));
}

/** Combat values with weapons / shielding / armour (+10% per level each). Hull = structure / 10 in combat (P5). */
export function combatStats(state: GameState, def: UnitDef): { attack: number; shield: number; structure: number } {
  const r = state.research.levels;
  return {
    attack: def.attack * (1 + 0.1 * r.weapons_tech),
    shield: def.shield * (1 + 0.1 * r.shielding_tech),
    structure: def.structure * (1 + 0.1 * r.armour_tech),
  };
}

/** Ship stats are whole numbers: thousands separators, one decimal only when a tech bonus leaves a fraction. */
const num = (n: number): string => {
  if (!Number.isFinite(n) || n >= 1e9) return formatAmount(big(n));
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
};

/** Per-unit time: below 10 s keep two decimals so 0.96 s does not read as 0 s. */
const unitTime = (seconds: number): string => (seconds < 10 ? `${seconds.toFixed(2)} 秒` : formatDuration(seconds));

function costLine(def: UnitDef): string {
  const cost = unitCost(def);
  const parts: string[] = [];
  if (cost.metal.gt(0)) parts.push(`金属 ${formatAmount(cost.metal)}`);
  if (cost.crystal.gt(0)) parts.push(`晶体 ${formatAmount(cost.crystal)}`);
  if (cost.deuterium.gt(0)) parts.push(`重氢 ${formatAmount(cost.deuterium)}`);
  return parts.join(" · ");
}

function unitCard(state: GameState, def: UnitDef): UnitCardView {
  const planet = activePlanet(state);
  const chain: RequirementChip[] = def.requires.map((req) => ({
    label: `${requirementName(req)} ${req.level}`,
    met: requirementLevel(state, req) >= req.level,
  }));
  const locked = chain.some((chip) => !chip.met);
  const check = canBuildUnits(state, def.id, 1);
  const max = locked ? 0 : maxBuildable(state, def.id);
  const stats = combatStats(state, def);
  let mobility: string;
  if (def.id === "solar_satellite") {
    mobility = `每颗供电 +${num(satelliteEnergy(planet) * outputScale(state))}（最高温度 ${planet.tempMax}°C）· 不能飞`;
  } else if (def.kind === "defense") {
    mobility = def.siloSlots
      ? `占导弹井 ${def.siloSlots} 格`
      : def.maxCount !== undefined
        ? `每颗星球限 ${def.maxCount} 个`
        : "防御设施，不能移动";
  } else {
    const stage = currentDrive(state, def);
    mobility = stage
      ? `速度 ${num(shipSpeed(state, def))}（${DRIVE_NAME[stage.drive]}引擎 ${state.research.levels[stage.drive]} 级）· 货舱 ${num(def.cargo * (1 + 0.05 * state.research.levels.hyperspace_tech))} · 油耗 ${stage.fuel}`
      : "不能飞";
  }
  const queued = queuedUnits(planet, def.id);
  return {
    id: def.id,
    owned: formatUnits(planet.units[def.id]),
    queued: queued > 0 ? `排队 ${formatUnits(queued)}` : "",
    stats: `攻击 ${num(stats.attack)} · 护盾 ${num(stats.shield)} · 结构 ${num(stats.structure)}`,
    mobility,
    cost: costLine(def),
    time: `每${def.kind === "ship" ? "艘" : "座"} ${unitTime(unitSeconds(state, def.id))}`,
    chain,
    chainKey: chain.map((chip) => `${chip.label}:${chip.met ? 1 : 0}`).join("|"),
    locked,
    canBuild: check.ok,
    reason: check.ok ? `可造 ${formatUnits(max)}` : check.reason,
    max,
    maxLabel: `最大 ${formatUnits(max)}`,
  };
}

function shipyardQueueView(state: GameState): QueueView {
  const paused = shipyardPausedReason(state);
  const items = activePlanet(state).shipyardQueue.map((order, index): QueueItemView => {
    const def = unitById(order.unit);
    const per = unitSeconds(state, order.unit);
    const active = index === 0;
    const left = (order.count - order.progress) * per;
    return {
      index,
      key: `${order.unit}:${index}:${order.count}`,
      label: `${def.nameZh} ×${formatUnits(order.count)}`,
      detail: active
        ? paused
          ? `${paused} · 每${def.kind === "ship" ? "艘" : "座"} ${unitTime(per)}`
          : `本${def.kind === "ship" ? "艘" : "座"} ${(order.progress * 100).toFixed(0)}% · 批次剩余 ${formatDuration(Math.ceil(left))} · 每${def.kind === "ship" ? "艘" : "座"} ${unitTime(per)}`
        : `等待中 · 已付款 · 预计 ${formatDuration(Math.ceil(left))}`,
      progressPct: active ? Math.max(0, Math.min(100, order.progress * 100)) : 0,
      active,
      ...speedupButtons(state, active && !paused ? left : null, "shipyard"),
    };
  });
  let idleHint = "";
  if (items.length === 0) {
    idleHint = activePlanet(state).buildings.shipyard < 1 ? "先建造造船厂（建筑页）。" : "造船厂空闲。下单时按批次扣费，逐艘完成；取消时退还所有未完成的单位。";
  }
  const total = shipyardQueueSeconds(state);
  return {
    summary: `造船队列 ${activePlanet(state).shipyardQueue.length}/${SHIPYARD.maxOrders}${total > 0 ? ` · 全部完成约 ${formatDuration(Math.ceil(total))}` : ""}${paused ? ` · ${paused}` : ""}`,
    items,
    signature: items.map((item) => item.key.split(":").slice(0, 2).join(":")).join("|"),
    idleHint,
  };
}

export function shipyardView(state: GameState): ShipyardView {
  const planet = activePlanet(state);
  const visible = shipyardVisible(state);
  const ships = visible ? SHIPS.map((def) => unitCard(state, def)) : [];
  const defenses = visible ? DEFENSES.map((def) => unitCard(state, def)) : [];
  const fleet = SHIPS.reduce((sum, def) => sum + (def.id === "solar_satellite" ? 0 : planet.units[def.id]), 0);
  return {
    visible,
    summary: `造船厂 ${planet.buildings.shipyard} 级 · 纳米机器人工厂 ${planet.buildings.nanite_factory} 级 · 舰船 ${formatUnits(fleet)} 艘 · 太阳能卫星 ${formatUnits(planet.units.solar_satellite)} 颗`,
    queue: shipyardQueueView(state),
    ships,
    defenses,
    silo:
      planet.buildings.missile_silo > 0
        ? `导弹井 ${planet.buildings.missile_silo} 级：已用 ${siloUsed(planet)} / ${siloCapacity(planet)} 格（反弹道导弹 1 格，星际导弹 2 格）`
        : "导弹井 0 级：建造导弹井（建筑页）后才能造导弹",
  };
}
