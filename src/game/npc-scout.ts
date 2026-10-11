import { coordinateKey, npcAt, type Coordinates } from "./galaxy";
import { npcEconomySnapshot } from "./npc-economy";
import { RESOURCE_IDS, type GameState, type ResourceId } from "./types";

const RESOURCE_NAMES: Record<ResourceId, string> = { metal: "金属", crystal: "晶体", deuterium: "重氢" };
const display = (value: number): string => value.toFixed(3);

/**
 * Format one detached observation, only for an occupied NPC coordinate. The fleet
 * arrival resolver is the only producer of saved reports; views read their text.
 * Rounding is display-only. The canonical economy and message time stay unchanged.
 */
export function npcScoutReportText(state: GameState, coordinates: Coordinates): string | null {
  const npc = npcAt(state, coordinates);
  if (!npc) return null;
  const snapshot = npcEconomySnapshot(state.npcEconomy);
  const resources = RESOURCE_IDS.map(id =>
    `${RESOURCE_NAMES[id]} ${display(snapshot.resources[id])}/${display(snapshot.capacity[id])}，固定产量 ${display(snapshot.productionPerSecond[id])}/秒，${snapshot.full[id] ? "满仓停产" : "生产中"}`,
  ).join("；");
  const largeTime = state.totalTime.gt(1e12);
  const gameTime = largeTime ? state.totalTime.toString() : display(state.totalTime.toNumber());
  const precision = largeTime ? "资源与经济年龄保留3位小数" : "数值保留3位小数";
  return `侦察报告 [${coordinateKey(coordinates)}]：${npc.name}（NPC ${npc.id}；派系：${npc.faction}）。抵达时快照（${precision}）：游戏时间 ${gameTime} 秒；经济年龄 ${display(snapshot.elapsedSeconds)} 秒。${resources}。历史快照不会随时间更新。`;
}
