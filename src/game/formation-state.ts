import { SHIP_IDS, type ShipId } from "../data/units";
import { MAX_ORDER_QUANTITY, type OrderMoney } from "./order-state";
import type { GameState } from "./types";

export const MAX_FORMATIONS = 32;
export const MAX_FORMATION_NAME_LENGTH = 64;
export const MAX_FORMATION_QUANTITY = MAX_ORDER_QUANTITY;
export const MAX_FORMATION_AUTHORITY_KEY_LENGTH = 32_768;
export type FlyableShipId = Exclude<ShipId, "solar_satellite">;
export const FLYABLE_SHIP_IDS: readonly FlyableShipId[] = SHIP_IDS.filter((id): id is FlyableShipId => id !== "solar_satellite");
/** Pure reusable intent. A design carries no payer, mission, cargo, or standing authorization. */
export interface FleetFormation { id: number; revision: number; name: string; ships: Partial<Record<FlyableShipId, number>> }
export interface FleetFormationState { nextFormationId: number; entries: FleetFormation[] }
export interface FormationDraft { name: string; ships: Partial<Record<FlyableShipId, number>> }
export interface FormationOrigin { formation: FleetFormation; quotedUnitCost: OrderMoney }
export interface CreateFormationRequest extends FormationDraft { expectedNextFormationId: number }
export interface EditFormationRequest extends FormationDraft { formationId: number; expectedRevision: number }
export interface DeleteFormationRequest { formationId: number; expectedRevision: number }
export interface FormationPreviewRequest { formationId: number; formationRevision: number; planetId: string }
export interface FormationReplenishmentLine { unit: FlyableShipId; quantity: number; quotedUnitCost: OrderMoney; budget: OrderMoney }
export interface FormationReplenishmentRequest extends FormationPreviewRequest {
  expectedNextTaskId: number;
  expectedAuthorityKey: string;
  lines: FormationReplenishmentLine[];
  totalBudget: OrderMoney;
}
export interface FormationPreviewRow {
  unit: FlyableShipId;
  target: number;
  localStock: number;
  paidQueueRemaining: number;
  deficit: number;
  quotedUnitCost: OrderMoney | null;
  budget: OrderMoney | null;
  conflictingTaskIds: number[];
  warnings: string[];
}
export interface FormationReplenishmentPreview {
  ok: boolean;
  reason: string;
  rows: FormationPreviewRow[];
  request: FormationReplenishmentRequest | null;
}
export interface FormationResult { state: GameState; ok: boolean; reason: string; createdTaskIds: number[] }
export type FormationAction =
  | ({ type: "formation-create" } & CreateFormationRequest)
  | ({ type: "formation-edit" } & EditFormationRequest)
  | ({ type: "formation-delete" } & DeleteFormationRequest)
  | { type: "formation-replenish"; request: FormationReplenishmentRequest };

export function createFormationState(): FleetFormationState { return { nextFormationId: 1, entries: [] }; }
export function isFlyableShipId(value: unknown): value is FlyableShipId { return typeof value === "string" && (FLYABLE_SHIP_IDS as readonly string[]).includes(value); }
export function hasFormationFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key));
}
export function normalizeFormationDraft(value: unknown): FormationDraft | null {
  if (!hasFormationFields(value, ["name", "ships"]) || typeof value.name !== "string") return null;
  if (value.name.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) return null;
  const name = value.name.trim();
  if (!name || Array.from(name).length > MAX_FORMATION_NAME_LENGTH) return null;
  if (!value.ships || typeof value.ships !== "object" || Array.isArray(value.ships)) return null;
  const prototype = Object.getPrototypeOf(value.ships);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value.ships);
  if (keys.length > FLYABLE_SHIP_IDS.length || keys.some(key => !isFlyableShipId(key))) return null;
  const input = value.ships as Record<string, unknown>;
  const ships: FormationDraft["ships"] = {};
  for (const id of FLYABLE_SHIP_IDS) {
    if (!Object.hasOwn(input, id)) continue;
    const count = input[id];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_FORMATION_QUANTITY) return null;
    if (count > 0) ships[id] = count;
  }
  return Object.keys(ships).length ? { name, ships } : null;
}
export function cloneFormation(value: FleetFormation): FleetFormation { return { id: value.id, revision: value.revision, name: value.name, ships: { ...value.ships } }; }
/** A detached snapshot: editing the design or a preview cannot mutate an accepted order. */
export function immutableFormationOrigin(formation: FleetFormation, quotedUnitCost: OrderMoney): FormationOrigin {
  const snapshot = cloneFormation(formation);
  Object.freeze(snapshot.ships);
  return Object.freeze({ formation: Object.freeze(snapshot), quotedUnitCost: Object.freeze({ ...quotedUnitCost }) });
}
