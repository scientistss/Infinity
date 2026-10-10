import type { BuildingId } from "../data/buildings";
import type { ResearchId } from "../data/research";
import type { ShipId, UnitId } from "../data/units";
import type { Coordinates } from "./galaxy";
import type { OrderMoney } from "./order-state";

export const MAX_ORDER_TRIPS = 100;
export const MAX_ORDER_TRIP_RECEIPTS = 256;
export const MIN_ORDER_SPEED_PERCENT = 10;
export const MAX_ORDER_SPEED_PERCENT = 100;
export const ORDER_SPEED_STEP = 10;

export interface OrderTransportAuthorization {
  donorPlanetId: string;
  ship: Exclude<ShipId, "solar_satellite">;
  count: number;
  speedPercent: number;
  maxTrips: number;
  grossCargoCap: OrderMoney;
}
export type OrderWorkSpec =
  | { kind: "building"; building: BuildingId; targetLevel: number; price: OrderMoney }
  | { kind: "research"; tech: ResearchId; targetLevel: number; price: OrderMoney }
  | { kind: "shipyard"; unit: UnitId; quantity: number; completedUnitsAtStart: number; paidPerUnit: OrderMoney };
export interface OrderWorkIdentity {
  workId: number;
  spec: OrderWorkSpec;
  shipmentFleetId: number | null;
}
export type OrderCurrentWork = OrderWorkIdentity & (
  | { stage: "pending"; reserved: OrderMoney }
  | { stage: "paid"; jobId: number }
);
export interface OrderFleetIdentity { taskId: number; workId: number }
export type OrderNonDelivery = "manual-recall" | "plan-cancel" | "goal-satisfied" | "target-invalid" | "precision-rejected";
export type OrderDeliveryOutcome = { kind: "delivered" } | { kind: "not-delivered"; reason: OrderNonDelivery };
export type OrderTripPhase =
  | { kind: "outbound" }
  | { kind: "returning"; outcome: OrderDeliveryOutcome; dockBlocked: boolean }
  | { kind: "returned"; outcome: OrderDeliveryOutcome }
  | { kind: "prestige-retired"; outcome: OrderDeliveryOutcome | null };
export interface OrderTripReceipt {
  fleetId: number;
  workId: number;
  targetPlanetId: string;
  target: Coordinates;
  cargo: OrderMoney;
  fuel: string;
  duration: number;
  phase: OrderTripPhase;
}
export interface OrderTransportState {
  authorization: OrderTransportAuthorization;
  trips: OrderTripReceipt[];
}
