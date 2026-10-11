import { coordinateKey, npcAt, type Coordinates } from "./galaxy";
import { npcWalletContext } from "./npc-attack";
import { NPC_WALLET_CAPS, NPC_WALLET_RATES } from "./npc-loot";
import { projectNpc } from "./npc-wallet";
import { RESOURCE_IDS, type GameState, type ResourceId } from "./types";

const RESOURCE_NAMES: Record<ResourceId, string> = { metal: "金属", crystal: "晶体", deuterium: "重氢" };
const display = (value: number): string => value.toFixed(3);

/** Save only the arrival's detached historical text. Reading never materializes or reanchors a wallet. */
export function npcScoutReportText(state: GameState, coordinates: Coordinates): string | null {
  const npc = npcAt(state, coordinates);
  if (!npc) return null;
  const snapshot = projectNpc(state.npcEconomy, coordinates, npcWalletContext(state));
  const resources = RESOURCE_IDS.map((id, index) =>
    `${RESOURCE_NAMES[id]} ${display(snapshot.stock[index]!)}/${display(NPC_WALLET_CAPS[index]!)}，固定产量 ${display(NPC_WALLET_RATES[index]!)}/秒，${snapshot.stock[index] === NPC_WALLET_CAPS[index] ? "满仓停产" : "生产中"}`,
  ).join("；");
  const largeTime = state.totalTime.gt(1e12);
  const gameTime = largeTime ? state.totalTime.toString() : display(state.totalTime.toNumber());
  const garrison = snapshot.garrison;
  const guard = garrison.light_fighter || garrison.heavy_fighter
    ? `轨道驻军：轻型战斗机 ${garrison.light_fighter}，重型战斗机 ${garrison.heavy_fighter}；驻军战斗科技 0`
    : "轨道驻军：已清空（无驻军）；驻军战斗科技 0";
  return `侦察报告 [${coordinateKey(coordinates)}]：${npc.name}（NPC ${npc.id}；派系：${npc.faction}）。抵达时快照（数值保留3位小数）：游戏时间 ${gameTime} 秒。${resources}。${guard}。历史快照不会随时间更新。`;
}
