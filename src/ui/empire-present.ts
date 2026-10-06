import { SHIP_IDS, unitById } from "../data/units";
import { activePlanet, selectPlanet } from "../game/empire";
import { economy } from "../game/economy";
import { colonyCount, colonyLimit, fleetSlots, MISSION_LABEL, reservedColonies } from "../game/fleet";
import { coordinateKey, GALAXY, npcAt } from "../game/galaxy";
import { formatAmount, formatDuration } from "../game/format";
import { usedFields } from "../game/planet";
import { big } from "../game/decimal";
import { RESOURCE_IDS, type GameState } from "../game/types";

export interface GalaxyCursor { galaxy: number; system: number }
export function presentEmpire(state: GameState, cursor?: GalaxyCursor) {
  const active = activePlanet(state);
  const g = cursor?.galaxy ?? active.coordinates.galaxy;
  const system = cursor?.system ?? active.coordinates.system;
  return {
    activeId: state.activePlanetId,
    activeName: active.name,
    activeCoordinate: coordinateKey(active.coordinates),
    cursor: { galaxy: g, system },
    dimensions: `${GALAXY.galaxies} 个银河 · ${GALAXY.systems} 恒星系/银河 · ${GALAXY.positions} 个位置/恒星系`,
    colonyStatus: `${colonyCount(state)} / ${colonyLimit(state)} 殖民地 · ${reservedColonies(state)} 个名额已预留`,
    fleetStatus: `${state.fleets.length} / ${fleetSlots(state)} 舰队槽位`,
    canAbandon: !active.homeworld,
    planets: state.planets.map((p) => {
      const eco = economy(selectPlanet(state, p.id));
      return { id: p.id, name: p.name, coordinate: coordinateKey(p.coordinates), climate: `${p.tempMax}°C · ${usedFields(p)}/${p.fieldsMax} 格`,
        resources: RESOURCE_IDS.map((r) => formatAmount(p.resources[r])), rates: RESOURCE_IDS.map((r) => formatAmount(big(eco.net[r]))), energy: `${Math.round(eco.efficiency * 100)}%`,
        queue: `${p.buildQueue.length} 建造 · ${p.shipyardQueue.length} 造船`, active: p.id === state.activePlanetId };
    }),
    ships: SHIP_IDS.filter((id) => id !== "solar_satellite").map((id) => ({ id, name: unitById(id).nameZh, available: active.units[id] })),
    fleets: state.fleets.map((f) => ({ id: f.id, mission: MISSION_LABEL[f.mission], origin: state.planets.find((p) => p.id === f.originId)?.name ?? f.originId,
      coordinate: coordinateKey(f.target), phase: f.returning ? "返航" : "去程", remaining: formatDuration(f.remaining), returning: f.returning,
      ships: Object.entries(f.ships).filter(([, n]) => n).map(([id, n]) => `${unitById(id as typeof SHIP_IDS[number]).nameZh} ×${n}`).join("、"),
      cargo: RESOURCE_IDS.map((r) => formatAmount(f.cargo[r])).join(" / "), progress: Math.min(100, Math.max(0, (1 - f.remaining / f.duration) * 100)) })),
    rows: Array.from({ length: GALAXY.positions }, (_, i) => {
      const c = { galaxy: g, system, position: i + 1 };
      const own = state.planets.find((p) => coordinateKey(p.coordinates) === coordinateKey(c));
      const npc = npcAt(state, c);
      const reserved = state.fleets.some((f) => f.mission === "colonize" && !f.returning && coordinateKey(f.target) === coordinateKey(c));
      return { position: c.position, coordinate: coordinateKey(c), name: own?.name ?? npc?.name ?? "未占据", faction: own ? "己方殖民地" : npc?.faction ?? (reserved ? "殖民舰队在途" : "可探索空域"),
        kind: own ? "own" : npc ? "npc" : "empty", planetId: own?.id ?? "", selected: own?.id === state.activePlanetId, reserved };
    }),
    messages: state.messages.slice().reverse().map((m) => ({ ...m, when: formatDuration(m.at) })),
    guide: active.units.colony_ship > 0 ? "选择空位 → 殖民 → 计算航程 → 派遣舰队。殖民船抵达后，顶栏即可切换星球。"
      : "扩张路线：研究实验室 3 → 间谍技术 4、脉冲引擎 3 → 天体物理学 1；造船厂 4 建造殖民船。",
  };
}
export type EmpireView = ReturnType<typeof presentEmpire>;
