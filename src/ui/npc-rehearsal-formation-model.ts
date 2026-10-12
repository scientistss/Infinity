import {
  FLYABLE_SHIP_IDS, MAX_FORMATIONS, MAX_FORMATION_NAME_LENGTH, MAX_FORMATION_QUANTITY, type FlyableShipId,
} from "../game/formation-state";

export const NPC_REHEARSAL_FORMATION_UNAVAILABLE = "编成来源已改变或无效，请重新选择当前保存的编成。";

export interface NpcRehearsalFormationOrigin {
  readonly id: number;
  readonly revision: number;
  readonly name: string;
}
export interface NpcRehearsalFormationCandidate extends NpcRehearsalFormationOrigin {
  /** Display order only. The controller captures the actual current object. */
  readonly index: number;
}
export interface NpcRehearsalFormationRow {
  readonly unit: FlyableShipId;
  readonly target: number;
  readonly landed: number;
  readonly deficit: number;
}
/** Detached display/copy data, with no live template or execution capability. */
export interface NpcRehearsalFormationCopy {
  readonly origin: NpcRehearsalFormationOrigin;
  readonly values: Readonly<Record<FlyableShipId, string>>;
  readonly rows: readonly NpcRehearsalFormationRow[];
  readonly total: number;
  readonly totalDeficit: number;
}

interface CheckedFormation extends NpcRehearsalFormationCandidate {
  readonly source: object;
  readonly sourceShips: object;
  readonly ships: Readonly<Partial<Record<FlyableShipId, number>>>;
}

const NO_FORMATIONS: readonly NpcRehearsalFormationCandidate[] = Object.freeze([]);
const fail = (): never => { throw new TypeError(NPC_REHEARSAL_FORMATION_UNAVAILABLE); };

/** Read descriptors, not properties: malformed input never gets accessor calls. */
function dataRecord(value: unknown, allowed: readonly string[], exact: boolean): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length || exact && keys.length !== allowed.length) return fail();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.includes(key)) return fail();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !("value" in field) || !field.enumerable) return fail();
    result[key] = field.value;
  }
  return result;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) return fail();
  return value;
}

function checkFormation(value: unknown, index: number): CheckedFormation {
  const fields = dataRecord(value, ["id", "revision", "name", "ships"], true);
  const id = integer(fields.id, 1, Number.MAX_SAFE_INTEGER - 1);
  const revision = integer(fields.revision, 1, Number.MAX_SAFE_INTEGER);
  const name = fields.name;
  if (typeof name !== "string" || !name || name.length > 256 || name.trim() !== name
    || Array.from(name).length > MAX_FORMATION_NAME_LENGTH || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) return fail();
  const counts = dataRecord(fields.ships, FLYABLE_SHIP_IDS, false);
  if (!Object.keys(counts).length) return fail();
  const ships: Partial<Record<FlyableShipId, number>> = Object.create(null);
  // Saved formations are canonical positive sparse records. Omitted IDs copy 0.
  for (const unit of FLYABLE_SHIP_IDS) if (Object.hasOwn(counts, unit)) {
    ships[unit] = integer(counts[unit], 1, MAX_FORMATION_QUANTITY);
  }
  return { source: value as object, sourceShips: fields.ships as object, id, revision, name, ships, index };
}

/** Strict bounded array before iteration, including no custom array methods. */
function currentFormations(value: unknown): CheckedFormation[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const lengthField = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthField || !("value" in lengthField) || lengthField.enumerable) return fail();
  const length = integer(lengthField.value, 0, MAX_FORMATIONS);
  if (Reflect.ownKeys(value).length !== length + 1) return fail();
  const entries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !("value" in field) || !field.enumerable) return fail();
    entries.push(field.value);
  }
  const nodes = new Set<object>([value]), ids = new Set<number>(), checked: CheckedFormation[] = [];
  for (let index = 0; index < length; index++) {
    const entry = checkFormation(entries[index], index);
    if (ids.has(entry.id) || nodes.has(entry.source) || nodes.has(entry.sourceShips) || entry.source === entry.sourceShips) return fail();
    ids.add(entry.id); nodes.add(entry.source); nodes.add(entry.sourceShips); checked.push(entry);
  }
  return checked;
}

/** Invalid retained graphs fail closed, rather than silently skipping a source. */
export function listNpcRehearsalFormations(entries: unknown): readonly NpcRehearsalFormationCandidate[] {
  try {
    return Object.freeze(currentFormations(entries).map(({ id, revision, name, index }) => Object.freeze({ id, revision, name, index })));
  } catch { return NO_FORMATIONS; }
}

/** Current membership is by original object, never ID, revision or equal values.
 * The controller owns world/origin/DOM lifetime and checks its captured source
 * and ships identities plus values again at copy time. This function has no
 * session state. Inventory input contains only flyable IDs; absent means zero.
 * Short stock does not reject or clip the requested formation. */
export function buildNpcRehearsalFormationCopy(entries: unknown, selected: unknown, landed: unknown): NpcRehearsalFormationCopy | null {
  try {
    const current = currentFormations(entries), formation = current.find(entry => entry.source === selected);
    if (!formation || current.some(entry => entry.source === landed || entry.sourceShips === landed)) return null;
    const stock = dataRecord(landed, FLYABLE_SHIP_IDS, false);
    const values: Record<FlyableShipId, string> = Object.create(null), rows: NpcRehearsalFormationRow[] = [];
    let total = 0, totalDeficit = 0;
    for (const unit of FLYABLE_SHIP_IDS) {
      const target = formation.ships[unit] ?? 0;
      const available = Object.hasOwn(stock, unit) ? integer(stock[unit], 0, Number.MAX_SAFE_INTEGER) : 0;
      // Only subtract within the target bound; both totals are <= 13 * 1e6.
      const deficit = available >= target ? 0 : target - available;
      values[unit] = String(target); total += target; totalDeficit += deficit;
      rows.push(Object.freeze({ unit, target, landed: available, deficit }));
    }
    return Object.freeze({ origin: Object.freeze({ id: formation.id, revision: formation.revision, name: formation.name }),
      values: Object.freeze(values), rows: Object.freeze(rows), total, totalDeficit });
  } catch { return null; }
}
