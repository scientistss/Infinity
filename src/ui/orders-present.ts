import { activeBuildings, buildingById } from "../data/buildings";
import { RESEARCH, researchById } from "../data/research";
import { SHIP_IDS, UNITS, unitById, type ShipId } from "../data/units";
import { addOrderAmounts, subtractOrderAmounts } from "../game/order-money";
import type { OrderDeliveryOutcome, OrderKind, OrderStatus, OrderTask } from "../game/order-state";
import type { GameState } from "../game/types";

export const ORDER_KIND_LABEL: Record<OrderKind, string> = { building: "建筑", research: "研究", shipyard: "造船 / 防御" };
const STATUS: Record<OrderStatus, string> = { running: "运行中", paused: "已暂停", completed: "已完成", cancelled: "已取消" };
export const ORDER_RESOURCES = [["metal", "金属"], ["crystal", "晶体"], ["deuterium", "重氢"]] as const;
export const ORDER_TRANSPORT_SHIPS = SHIP_IDS.filter((id): id is Exclude<ShipId, "solar_satellite"> => id !== "solar_satellite");
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
  work: string;
  transport: string;
  limits: string;
  canDismiss: boolean;
  retryFleetId: number | null;
  reason: string;
}
export interface OrdersView {
  planets: Array<{id: string; name: string}>;
  donorShips: Array<{planetId: string; ships: Array<{id: Exclude<ShipId, "solar_satellite">; count: number}>}>;
  initialPlanetId: string;
  nextTaskId: number;
  rows: OrderRowView[];
}
function sum(values: string[]): string {
  let total: string | null = "0";
  for (const value of values) total = total === null ? null : addOrderAmounts(total, value);
  return total ?? "账目待检查";
}
function outcome(value: OrderDeliveryOutcome): string {
  if (value.kind === "delivered") return "已实际卸货";
  const reasons = {"manual-recall":"手动召回", "plan-cancel":"计划取消", "goal-satisfied":"目标已完成", "target-invalid":"原目标失效", "precision-rejected":"精度检查未通过"};
  return `未交付（${reasons[value.reason]}）`;
}
/** Pure inspection: this presenter never plans, pays, or refreshes creation authority. */
export function ordersView(state: GameState): OrdersView {
  return {
    planets: state.planets.map(p => ({id: p.id, name: `${p.name} [${p.coordinates.galaxy}:${p.coordinates.system}:${p.coordinates.position}]`})),
    donorShips: state.planets.map(p => ({planetId: p.id, ships: ORDER_TRANSPORT_SHIPS.map(id => ({id, count: p.units[id]}))})),
    initialPlanetId: state.activePlanetId,
    nextTaskId: state.orders.nextTaskId,
    rows: state.orders.tasks.map(task => {
      const planet = state.planets.find(p => p.id === task.planetId);
      const current = task.kind === "shipyard" ? task.completedUnits : task.kind === "research" ? state.research.levels[task.tech] : planet?.buildings[task.building] ?? 0;
      const goal = task.kind === "shipyard" ? task.quantity : task.targetLevel;
      const spending = ORDER_RESOURCES.map(([id, label]) => `${label} ${subtractOrderAmounts(task.charged[id], task.refunded[id]) ?? "账目待检查"} / ${task.budget[id]}`).join(" · ");
      const transport = task.transport;
      const liveTrip = transport?.trips.find(trip => trip.phase.kind === "outbound" || trip.phase.kind === "returning");
      const liveFleet = liveTrip ? state.fleets.find(f => f.id === liveTrip.fleetId && f.orderTransport?.taskId === task.id && f.orderTransport.workId === liveTrip.workId) : undefined;
      const lastTrip = liveTrip ?? transport?.trips.at(-1);
      const phase = lastTrip?.phase;
      let transportText = "";
      let limits = "";
      if (transport) {
        const auth = transport.authorization;
        const donor = state.planets.find(p => p.id === auth.donorPlanetId);
        const flight = lastTrip ? `舰队 #${lastTrip.fleetId} · 工作 #${lastTrip.workId} · ${phase?.kind === "outbound" ? "出航，尚未交付" : phase?.kind === "returning" ? `${outcome(phase.outcome)}；${phase.dockBlocked ? "返港入库受阻" : "真实返航中"}` : phase?.kind === "returned" ? `${outcome(phase.outcome)}；已实际返港` : `旧世界已退役${phase?.kind === "prestige-retired" && phase.outcome ? `；${outcome(phase.outcome)}` : "；无交付结论"}`}${liveTrip ? liveFleet ? liveTrip.phase.kind === "returning" && liveTrip.phase.dockBlocked ? " · 等待手动重试" : ` · ${Math.ceil(liveFleet.remaining)} 秒${liveFleet.returning ? "后入港" : "后抵达"}` : " · 真实舰队待核对" : ""}` : "尚未派出真实舰队";
        transportText = `固定单源：${donor?.name ?? auth.donorPlanetId} → ${planet?.name ?? task.planetId} · ${unitById(auth.ship).nameZh} × ${auth.count} · ${auth.speedPercent}%\n${flight}`;
        limits = `运输次数 ${transport.trips.length} / ${auth.maxTrips}；累计毛发出 / 上限：${ORDER_RESOURCES.map(([id,label]) => `${label} ${sum(transport.trips.map(trip => trip.cargo[id]))} / ${auth.grossCargoCap[id]}`).join(" · ")}；不可退往返燃料 ${sum(transport.trips.map(trip => trip.fuel))} 重氢（已计入净支出）`;
      }
      const work = task.currentWork;
      return {
        id: task.id, status: task.status,
        title: `#${task.id} ${orderTargetName(task)} · ${STATUS[task.status]}`,
        location: `固定付款 / 执行星球：${planet?.name ?? task.planetId}`,
        progress: task.kind === "shipyard" ? `本计划已完成 ${current} / 额外 ${goal} 个` : `当前 ${current} / 目标 ${goal} 级`,
        progressPct: Math.max(0, Math.min(100, goal > 0 ? current / goal * 100 : 0)),
        spending: `净支出 / 上限：${spending}`,
        activeJob: task.activeJob ? `已付款工作 #${task.activeJob.jobId}${task.kind === "shipyard" ? ` · 本批完成 ${task.activeJob.credited} / ${task.activeJob.quantity}` : ""}` : "暂无已付款工作",
        work: work ? `固定子任务 #${work.workId} · ${work.stage === "pending" ? `未付款，预算预留：${ORDER_RESOURCES.map(([id,label]) => `${label} ${work.reserved[id]}`).join(" / ")}（不冻结星球库存）` : `已付款 #${work.jobId}，预算预留 0`}${work.shipmentFleetId === null ? "" : `；本子任务已使用唯一运输 #${work.shipmentFleetId}`}` : "",
        transport: transportText,
        limits,
        canDismiss: (task.status === "completed" || task.status === "cancelled") && !task.activeJob && !work && !liveTrip && !state.fleets.some(f => f.orderTransport?.taskId === task.id),
        retryFleetId: liveTrip?.phase.kind === "returning" && liveTrip.phase.dockBlocked && liveFleet ? liveTrip.fleetId : null,
        reason: task.reason || (task.status === "running" ? "等待下一次检查；每 10 游戏秒最多执行一次经济动作" : ""),
      };
    }),
  };
}
