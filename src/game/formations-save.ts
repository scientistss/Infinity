import {
  createFormationState, normalizeFormationDraft, hasFormationFields, cloneFormation, immutableFormationOrigin,
  type FleetFormation, type FleetFormationState, type FormationOrigin,
} from "./formation-state";
import { SHIP_IDS } from "../data/units";
import { compareOrderAmounts, isOrderAmount, multiplyOrderAmountInteger } from "./order-money";
import { big } from "./decimal";
import { RESOURCE_IDS, type GameState } from "./types";
import type { OrderMoney } from "./order-state";

const MAX_ID = Number.MAX_SAFE_INTEGER - 1;
function record(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}
function keys(raw: unknown, expected: readonly string[], label: string): asserts raw is Record<string, unknown> {
  if (!hasFormationFields(raw, expected)) throw Error(`${label}字段无效`);
}
function integer(raw: unknown, label: string, maximum = MAX_ID): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1 || raw > maximum) throw Error(`${label}整数无效`);
  return raw;
}

/** The library and immutable order snapshots share the same strictly pure shape. */
export function readFormation(raw: unknown): FleetFormation {
  keys(raw, ["id", "revision", "name", "ships"], "编成");
  const id = integer(raw.id, "编成 ID"), revision = integer(raw.revision, "编成修订", Number.MAX_SAFE_INTEGER);
  const draft = normalizeFormationDraft({ name: raw.name, ships: raw.ships });
  if (!draft || draft.name !== raw.name || !record(raw.ships) ||
      Reflect.ownKeys(raw.ships).length !== Object.keys(draft.ships).length) throw Error("编成名称或舰船清单无效");
  return { id, revision, name: draft.name, ships: { ...draft.ships } };
}

export function readFormations(raw: unknown): FleetFormationState {
  keys(raw, ["nextFormationId", "entries"], "编成库");
  const nextFormationId = integer(raw.nextFormationId, "编成计数器", Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(raw.entries) || raw.entries.length > 32) throw Error("编成列表过长或无效");
  const entries = raw.entries.map(readFormation), ids = new Set<number>();
  for (const entry of entries) {
    if (entry.id >= nextFormationId || ids.has(entry.id)) throw Error("编成 ID 重复或计数器过期");
    ids.add(entry.id);
  }
  return { nextFormationId, entries };
}

export function serializeFormations(state: FleetFormationState): FleetFormationState { return readFormations(state); }

/** Historical prices are internal audit facts, never compared with today's balance catalog. */
export function readFormationOrigin(raw: unknown): FormationOrigin | null {
  if (raw === null) return null;
  keys(raw, ["formation", "quotedUnitCost"], "编成订单来源");
  keys(raw.quotedUnitCost, RESOURCE_IDS, "编成冻结单价");
  const quotedUnitCost = {} as OrderMoney;
  for (const res of RESOURCE_IDS) {
    const amount = raw.quotedUnitCost[res];
    if (!isOrderAmount(amount) || compareOrderAmounts(amount, big(amount).toString()) !== 0) throw Error("编成冻结单价无效或精度无法保留");
    quotedUnitCost[res] = amount;
  }
  return immutableFormationOrigin(readFormation(raw.formation), quotedUnitCost);
}

function equalFormation(a: FleetFormation, b: FleetFormation): boolean {
  return a.id === b.id && a.revision === b.revision && a.name === b.name &&
    SHIP_IDS.every(id => (a.ships[id as keyof typeof a.ships] ?? 0) === (b.ships[id as keyof typeof b.ships] ?? 0));
}

/** All retained records remain traceable, even after their payer has been retired. */
export function validateFormationReferences(state: GameState): void {
  const current = new Map(state.formations.entries.map(entry => [entry.id, entry]));
  const snapshots = new Map<string, FleetFormation>();
  for (const task of state.orders.tasks) {
    const origin = task.formationOrigin;
    if (origin === null) continue;
    const snapshot = origin.formation, formation = current.get(snapshot.id);
    if (!formation || snapshot.revision > formation.revision ||
        (snapshot.revision === formation.revision && !equalFormation(snapshot, formation))) throw Error("编成来源引用或修订不一致");
    const key = `${snapshot.id}:${snapshot.revision}`, prior = snapshots.get(key);
    if (prior && !equalFormation(snapshot, prior)) throw Error("同一编成修订的历史快照不一致");
    snapshots.set(key, cloneFormation(snapshot));
    if (task.kind !== "shipyard" || task.unit === "solar_satellite" || !(SHIP_IDS as readonly string[]).includes(task.unit) ||
        task.transport !== null || task.currentWork !== null ||
        task.quantity > (snapshot.ships[task.unit as keyof typeof snapshot.ships] ?? 0)) throw Error("编成来源只能授权固定本地飞行舰船计划");
    for (const res of RESOURCE_IDS) {
      const budget = multiplyOrderAmountInteger(origin.quotedUnitCost[res], task.quantity);
      if (budget === null || compareOrderAmounts(task.budget[res], budget) !== 0) throw Error("编成预算与固定数量、冻结单价不一致");
    }
    if (!task.activeJob) continue;
    const job = state.planets.find(planet => planet.id === task.planetId)?.shipyardQueue.find(entry => entry.jobId === task.activeJob!.jobId);
    if (!job || RESOURCE_IDS.some(res => compareOrderAmounts(job.paidPerUnit[res].toString(), origin.quotedUnitCost[res]) !== 0)) {
      throw Error("编成真实付款队列与冻结单价不一致");
    }
  }
}

/** Reject new authority anywhere in a legacy document rather than stripping it. */
export function rejectLegacyFormationFields(raw: unknown): void {
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { for (const entry of value) inspect(entry); return; }
    if (!record(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (["formations", "nextFormationId", "formationOrigin", "quotedUnitCost"].includes(key)) throw Error("旧修订不能夹带 r8 编成或来源授权数据");
      inspect(entry);
    }
  }
  inspect(raw);
}

/** Run only after the genuine r6 order subformat has been validated by its reader. */
export function migrateFormations(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, formations: createFormationState() };
}
