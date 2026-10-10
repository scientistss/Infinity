/** Current-system inspection only: no selection, dispatch, simulation or saved state writes. */
import { buildingById, type BuildingId } from "../data/buildings";
import { researchById, type ResearchId } from "../data/research";
import { unitById, type ShipId, type UnitRequirement } from "../data/units";
import { expeditionSlots } from "../game/deep-state";
import { activePlanet } from "../game/empire";
import { colonyCount, colonyLimit, emptyCargo, fleetSlots, quoteFlight, reservedColonies, type FleetRequest } from "../game/fleet";
import { formatAmount, formatDuration } from "../game/format";
import { coordinateKey, distance, npcAt, planetProperties, positionBonus, SPACE, validCoordinates, type Coordinates } from "../game/galaxy";
import { HOMEWORLD_ID } from "../game/planet";
import type { GameState } from "../game/types";

export type ExpansionPositionStatus = "deep" | "owned" | "npc" | "reserved" | "empty";
export interface ExpansionPosition {
  position: number;
  key: string;
  name: string;
  status: ExpansionPositionStatus;
  statusLabel: string;
  label: string;
}
export interface ExpansionRequirement {
  kind: "building" | "research";
  id: string;
  name: string;
  completed: number;
  required: number;
  met: boolean;
  label: string;
}
export interface ExpansionPrerequisiteGroup {
  id: string;
  label: string;
  note: string;
  requirements: ExpansionRequirement[];
}
/** Failed quotes deliberately have no numerical flight fields: zero is not a free flight. */
export type ExpansionQuote = { ok: false; reason: string; text: string } | {
  ok: true;
  reason: string;
  text: string;
  duration: number;
  fuel: string;
  capacity: string;
  holdSeconds: number;
  stake: number;
};
export interface ExpansionScenario {
  mission: "colonize" | "charge" | "recycle";
  label: string;
  assumptions: string;
  shipId: ShipId;
  availableShips: number;
  risk: string;
  quote: ExpansionQuote;
}
export interface ExpansionNavigationModel {
  origin: { id: string; name: string; coordinates: Coordinates; label: string };
  system: { galaxy: number; system: number; label: string };
  positions: ExpansionPosition[];
  selected: ExpansionPosition & {
    coordinates: Coordinates;
    distance: number;
    properties: { tempMin: number; tempMax: number; fieldsMax: number; source: "stored" | "provisional"; label: string } | null;
    bonuses: { metal: number; crystal: number; deuterium: number; homeBaseline: boolean; label: string } | null;
    note: string;
    scenarios: ExpansionScenario[];
  };
  capacity: {
    colonies: { used: number; limit: number; reserved: number; remaining: number; label: string };
    planets: { used: number; limit: number; reserved: number; remaining: number; label: string };
    fleets: { used: number; limit: number; returning: number; remaining: number; label: string };
    expeditions: { used: number; limit: number; label: string };
  };
  research: { astrophysics: number; computerTech: number; label: string };
  prerequisites: ExpansionPrerequisiteGroup[];
}

const STATUS_LABEL: Record<ExpansionPositionStatus, string> = {
  deep: "深空", owned: "己方", npc: "NPC 邻居", reserved: "殖民在途预留", empty: "空位",
};

function requirementFacts(state: GameState, requirements: readonly UnitRequirement[]): ExpansionRequirement[] {
  const origin = activePlanet(state);
  return requirements.map(requirement => {
    const completed = requirement.kind === "building"
      ? origin.buildings[requirement.id as BuildingId] : state.research.levels[requirement.id as ResearchId];
    const name = requirement.kind === "building"
      ? buildingById(requirement.id as BuildingId).nameZh : researchById(requirement.id as ResearchId).nameZh;
    const met = completed >= requirement.level;
    return { kind: requirement.kind, id: requirement.id, name, completed, required: requirement.level, met,
      label: `${name}：已完成 ${completed} / 需要 ${requirement.level} 级${met ? "（满足）" : "（未满足）"}` };
  });
}

function scenario(state: GameState, target: Coordinates, mission: ExpansionScenario["mission"], shipId: ShipId): ExpansionScenario {
  const request: FleetRequest = { mission, target: { ...target }, ships: { [shipId]: 1 }, cargo: emptyCargo(), speedPercent: 100,
    ...(mission === "charge" ? { holdSlots: 1, chargeWithBets: false } : {}) };
  // Exactly one authoritative quote per selected scenario; never quote the 16 status rows.
  const quoted = quoteFlight(state, request);
  const quote: ExpansionQuote = quoted.ok ? {
    ok: true, reason: quoted.reason, duration: quoted.duration, fuel: quoted.fuel.toString(), capacity: quoted.capacity.toString(),
    holdSeconds: quoted.holdSeconds ?? 0, stake: quoted.stake ?? 0,
    text: `单程 ${formatDuration(Math.ceil(quoted.duration))} · 往返燃料 ${formatAmount(quoted.fuel)} 重氢 · 总货舱 ${formatAmount(quoted.capacity)}${mission === "charge" ? ` · 驻留 ${quoted.holdSeconds} 秒 · 无押注` : ""}`,
  } : { ok: false, reason: quoted.reason, text: quoted.reason };
  return {
    mission, shipId, availableShips: activePlanet(state).units[shipId], quote,
    label: mission === "colonize" ? "殖民参考情景" : mission === "charge" ? "深空充能参考情景" : "残骸回收参考情景",
    assumptions: `1 艘${unitById(shipId).nameZh} · 100% 速度 · 零货物${mission === "charge" ? " · 驻留 1 段 · 无押注" : ""}`,
    risk: mission === "colonize"
      ? "仅检查此刻能否派遣；抵达时仍会复核目标与名额。成功殖民消耗 1 艘殖民船，往返燃料预先扣除。"
      : mission === "charge"
        ? "深空事件尚未生成，可能有战损或全损；无押注和黑洞保护都不免除遭遇战损。往返燃料预先扣除。"
        : "回收量受抵达时剩余残骸与货舱限制；当前报价不保证回收收益。往返燃料预先扣除。",
  };
}

/**
 * Read-only, bounded to the browsed system. All prerequisites use finished levels on the
 * actual active origin; ship construction requirements are explanatory, not dispatch gates.
 */
export function expansionNavigation(state: GameState, cursor: Coordinates, selectedPosition: number): ExpansionNavigationModel {
  const system = { galaxy: cursor.galaxy, system: cursor.system };
  if (!validCoordinates({ ...system, position: 1 })) throw new Error("浏览星系坐标无效");
  const position = Number.isInteger(selectedPosition) && selectedPosition >= 1 && selectedPosition <= SPACE.deepSpacePosition ? selectedPosition : 1;
  const origin = activePlanet(state);
  const owned = new Map(state.planets.map(planet => [coordinateKey(planet.coordinates), planet]));
  const reservedTargets = new Set(state.fleets.filter(fleet => fleet.mission === "colonize" && !fleet.returning).map(fleet => coordinateKey(fleet.target)));
  const positions: ExpansionPosition[] = Array.from({ length: SPACE.deepSpacePosition }, (_, index) => {
    const coordinates = { ...system, position: index + 1 }, key = coordinateKey(coordinates);
    const planet = owned.get(key), deep = coordinates.position === SPACE.deepSpacePosition;
    const npc = deep || planet ? null : npcAt(state, coordinates);
    const status: ExpansionPositionStatus = deep ? "deep" : planet ? "owned" : npc ? "npc" : reservedTargets.has(key) ? "reserved" : "empty";
    const name = deep ? "深空 · 星环充能区" : planet?.name ?? npc?.name ?? "未占据行星";
    const statusLabel = STATUS_LABEL[status];
    return { position: coordinates.position, key, name, status, statusLabel, label: `${coordinates.position} · ${statusLabel} · ${name}` };
  });
  const row = positions[position - 1]!, target = { ...system, position }, planet = owned.get(row.key);
  const deep = row.status === "deep", homeBaseline = planet?.id === HOMEWORLD_ID;
  const props = deep ? null : planet ?? planetProperties(state.universe.seed, target);
  const metal = homeBaseline ? 1 : positionBonus(position, "metal"), crystal = homeBaseline ? 1 : positionBonus(position, "crystal");
  const colonyUsed = colonyCount(state), colonyMax = colonyLimit(state), reserved = reservedColonies(state);
  const fleetUsed = state.fleets.length, fleetMax = fleetSlots(state), returning = state.fleets.filter(fleet => fleet.returning).length;
  const expeditionUsed = state.fleets.filter(fleet => fleet.mission === "charge").length, expeditionMax = expeditionSlots(state);
  const astrophysics = state.research.levels.astrophysics, computerTech = state.research.levels.computer_tech;
  const ships: ShipId[] = deep ? ["small_cargo", "recycler"] : ["colony_ship"];
  const prerequisites: ExpansionPrerequisiteGroup[] = ships.map(id => ({
    id, label: `建造${unitById(id).nameZh}的前置`,
    note: "仅说明新造舰船的前置；现有舰船能否派遣以参考情景的实际报价为准。排队中等级不计入。",
    requirements: requirementFacts(state, unitById(id).requires),
  }));
  prerequisites.push({ id: "astrophysics", label: "研究天体物理学的前置", note: "建筑等级取当前出发星球，科技等级取帝国已完成研究；排队中等级不计入。",
    requirements: requirementFacts(state, researchById("astrophysics").requires) });
  return {
    origin: { id: origin.id, name: origin.name, coordinates: { ...origin.coordinates }, label: `实际出发星球：${origin.name} [${coordinateKey(origin.coordinates)}]` },
    system: { ...system, label: `浏览星系 [${system.galaxy}:${system.system}]` }, positions,
    selected: { ...row, coordinates: target, distance: distance(origin.coordinates, target),
      properties: props ? { tempMin: props.tempMax - 40, tempMax: props.tempMax, fieldsMax: props.fieldsMax, source: planet ? "stored" : "provisional",
        label: `${planet ? "已保存的行星属性" : "暂定生成属性"}：${props.tempMax - 40}～${props.tempMax} °C · ${props.fieldsMax} 格` } : null,
      bonuses: deep ? null : { metal, crystal, deuterium: positionBonus(position, "deuterium"), homeBaseline,
        label: homeBaseline ? "母星基准：不应用位置矿产加成" : `位置矿产倍率：金属 ×${metal} · 晶体 ×${crystal}；重氢产量另受温度影响` },
      note: deep ? "第 16 位是深空，不能殖民；只展示充能与回收参考情景。"
        : planet ? "显示已有星球的保存属性；查看不会切换当前星球。"
          : "空位或暂定属性不代表可立即殖民；以下报价仅针对明确列出的参考情景。",
      scenarios: deep ? [scenario(state, target, "charge", "small_cargo"), scenario(state, target, "recycle", "recycler")]
        : [scenario(state, target, "colonize", "colony_ship")],
    },
    capacity: {
      colonies: { used: colonyUsed, limit: colonyMax, reserved, remaining: Math.max(0, colonyMax - colonyUsed - reserved),
        label: `殖民地 ${colonyUsed}/${colonyMax}（不含母星）· 出航预留 ${reserved} · 可用 ${Math.max(0, colonyMax - colonyUsed - reserved)}` },
      planets: { used: state.planets.length, limit: SPACE.maxPlanets, reserved, remaining: Math.max(0, SPACE.maxPlanets - state.planets.length - reserved),
        label: `全局星球安全上限 ${state.planets.length}/${SPACE.maxPlanets}（含母星）· 出航预留 ${reserved}` },
      fleets: { used: fleetUsed, limit: fleetMax, returning, remaining: Math.max(0, fleetMax - fleetUsed),
        label: `舰队槽 ${fleetUsed}/${fleetMax} · 其中返航 ${returning}（仍占槽）` },
      expeditions: { used: expeditionUsed, limit: expeditionMax, label: `远征槽 ${expeditionUsed}/${expeditionMax}（含返航充能舰队）` },
    },
    research: { astrophysics, computerTech,
      label: `已完成：天体物理学 ${astrophysics} 级（殖民地上限 ⌈等级/2⌉）· 计算机技术 ${computerTech} 级 · 当前星球造船厂 ${origin.buildings.shipyard} 级；排队中等级不计入。` },
    prerequisites,
  };
}
