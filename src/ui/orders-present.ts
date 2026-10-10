import { activeBuildings, buildingById } from "../data/buildings";
import { RESEARCH, researchById } from "../data/research";
import { UNITS, unitById } from "../data/units";
import { subtractOrderAmounts } from "../game/order-money";
import type { OrderKind, OrderStatus, OrderTask } from "../game/order-state";
import type { GameState } from "../game/types";

export const ORDER_KIND_LABEL: Record<OrderKind, string> = { building: "建筑", research: "研究", shipyard: "造船 / 防御" };
const STATUS: Record<OrderStatus, string> = { running: "运行中", paused: "已暂停", completed: "已完成", cancelled: "已取消" };
export const ORDER_RESOURCES = [["metal", "金属"], ["crystal", "晶体"], ["deuterium", "重氢"]] as const;
export function orderChoices(kind: OrderKind): Array<{id: string; name: string}> {
  const defs = kind === "building" ? activeBuildings() : kind === "research" ? RESEARCH : UNITS;
  return defs.map(def => ({ id: def.id, name: def.nameZh }));
}
export function orderTargetName(task: OrderTask): string {
  return task.kind === "building" ? buildingById(task.building).nameZh : task.kind === "research" ? researchById(task.tech).nameZh : unitById(task.unit).nameZh;
}
export interface OrderRowView {
  id: number;
  status: OrderStatus;
  title: string;
  location: string;
  progress: string;
  progressPct: number;
  spending: string;
  activeJob: string;
  reason: string;
}
export interface OrdersView {
  planets: Array<{id: string; name: string}>;
  initialPlanetId: string;
  nextTaskId: number;
  rows: OrderRowView[];
}
/** Pure inspection: this presenter never plans, pays, or refreshes creation authority. */
export function ordersView(state: GameState): OrdersView {
  return {
    planets: state.planets.map(p => ({id: p.id, name: `${p.name} [${p.coordinates.galaxy}:${p.coordinates.system}:${p.coordinates.position}]`})),
    initialPlanetId: state.activePlanetId,
    nextTaskId: state.orders.nextTaskId,
    rows: state.orders.tasks.map(task => {
      const planet = state.planets.find(p => p.id === task.planetId);
      const current = task.kind === "shipyard" ? task.completedUnits : task.kind === "research" ? state.research.levels[task.tech] : planet?.buildings[task.building] ?? 0;
      const goal = task.kind === "shipyard" ? task.quantity : task.targetLevel;
      const spending = ORDER_RESOURCES.map(([id, label]) => `${label} ${subtractOrderAmounts(task.charged[id], task.refunded[id]) ?? "账目待检查"} / ${task.budget[id]}`).join(" · ");
      return {
        id: task.id, status: task.status,
        title: `#${task.id} ${orderTargetName(task)} · ${STATUS[task.status]}`,
        location: `固定付款 / 执行星球：${planet?.name ?? task.planetId}`,
        progress: task.kind === "shipyard" ? `本计划已完成 ${current} / 额外 ${goal} 个` : `当前 ${current} / 目标 ${goal} 级`,
        progressPct: Math.max(0, Math.min(100, goal > 0 ? current / goal * 100 : 0)),
        spending: `净支出 / 上限：${spending}`,
        activeJob: task.activeJob ? `已付款工作 #${task.activeJob.jobId}${task.kind === "shipyard" ? ` · 本批完成 ${task.activeJob.credited} / ${task.activeJob.quantity}` : ""}` : "暂无已付款工作",
        reason: task.reason || (task.status === "running" ? "等待下一次检查；每 10 游戏秒最多付款入队一次" : ""),
      };
    }),
  };
}
