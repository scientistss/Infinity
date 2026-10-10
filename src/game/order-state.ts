import type { FormationOrigin } from "./formation-state";
import type { BuildingId } from "../data/buildings";
import type { ResearchId } from "../data/research";
import type { UnitId } from "../data/units";
import type { OrderCurrentWork, OrderTransportAuthorization, OrderTransportState } from "./order-transport-state";
export * from "./order-transport-state";
import type { OrderSource } from "./planet";
import type { GameState, ResourceId } from "./types";

export const ORDER_PASS_SECONDS = 10;
export const MAX_ORDER_TASKS = 100;
export const MAX_LIVE_ORDER_TASKS = 32;
export const MAX_ORDER_LEVEL = 1000;
export const MAX_ORDER_QUANTITY = 1_000_000;
export const MAX_ORDER_REASON_LENGTH = 240;

export type OrderMoney = Record<ResourceId, string>;
export type OrderKind = "building" | "research" | "shipyard";
export type OrderStatus = "running" | "paused" | "completed" | "cancelled";
export type OrderTarget =
  | { kind: "building"; planetId: string; building: BuildingId; targetLevel: number }
  | { kind: "research"; planetId: string; tech: ResearchId; targetLevel: number }
  | { kind: "shipyard"; planetId: string; unit: UnitId; quantity: number };
export interface OrderJobReceipt { jobId: number; quantity: number; credited: number }
export type OrderTask = OrderTarget & {
  id: number;
  status: OrderStatus;
  reason: string;
  budget: OrderMoney;
  charged: OrderMoney;
  refunded: OrderMoney;
  activeJob: OrderJobReceipt | null;
  completedUnits: number;
  transport: OrderTransportState | null;
  currentWork: OrderCurrentWork | null;
  formationOrigin: FormationOrigin | null;
};
export interface OrderState {
  nextTaskId: number;
  nextJobId: number;
  nextWorkId: number;
  accumulator: number;
  tasks: OrderTask[];
}
export type CreateOrderRequest = OrderTarget & { expectedNextTaskId: number; budget: OrderMoney; transport?: OrderTransportAuthorization | null };
export interface PaidJobIdentity { jobId: number; taskId: number | null }
export type PaidJobRef = PaidJobIdentity & { kind: OrderKind; planetId: string };
export type CancelPaidJobRequest = { kind: OrderKind; planetId: string; jobId: number };
export type NewPaidJob = {
  planetId: string;
  source: OrderSource;
  taskId: number | null;
} & (
  | { kind: "building"; building: BuildingId; targetLevel: number; quantity: 1 }
  | { kind: "research"; tech: ResearchId; targetLevel: number; quantity: 1 }
  | { kind: "shipyard"; unit: UnitId; quantity: number }
);
export interface OrderResult { state: GameState; ok: boolean; reason: string }
export type OrderAction =
  | { type: "order-create"; request: CreateOrderRequest }
  | { type: "order-pause" | "order-resume" | "order-cancel" | "order-dismiss"; taskId: number }
  | { type: "order-retry-dock"; taskId: number; fleetId: number }
  | { type: "cancel-paid-job"; request: CancelPaidJobRequest };

export function createOrderState(): OrderState {
  return { nextTaskId: 1, nextJobId: 1, nextWorkId: 1, accumulator: 0, tasks: [] };
}
