import { big, isValidAmount } from "./decimal";
import { DEMOLITION_RULE_VERSION, isDemolishableBuildingId, validDemolitionSeconds, type DemolitionJob } from "./demolition-state";
import { compareOrderAmounts, isOrderAmount, normalizeOrderAmount } from "./order-money";
import { MAX_ORDER_LEVEL } from "./order-state";
import { RESOURCE_IDS, type ResourceAmounts, type ResourceId } from "./types";

export type SerializedDemolitionJob = Omit<DemolitionJob, "paid"> & { paid: Record<ResourceId, string> };
const JOB_KEYS = ["kind", "source", "taskId", "demolitionRuleVersion", "jobId", "building", "fromLevel", "toLevel", "paid", "totalSeconds", "remainingSeconds"] as const;
const RESERVED_KEYS = new Set(["demolition", "demolitionRuleVersion", "fromLevel", "toLevel"]);

function exactRecord(raw: unknown, keys: readonly string[], label: string): asserts raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error(`${label}格式无效`);
  const prototype = Object.getPrototypeOf(raw), actual = Reflect.ownKeys(raw);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length
    || actual.some(key => typeof key !== "string" || !keys.includes(key))) throw Error(`${label}字段无效`);
}
function validateScalars(raw: unknown): asserts raw is Record<string, unknown> {
  exactRecord(raw, JOB_KEYS, "拆除工作");
  if (raw.kind !== "demolition" || raw.source !== "manual" || raw.taskId !== null || raw.demolitionRuleVersion !== DEMOLITION_RULE_VERSION) {
    throw Error("拆除工作类型、来源或规则版本无效");
  }
  if (typeof raw.jobId !== "number" || !Number.isSafeInteger(raw.jobId) || raw.jobId < 1 || raw.jobId >= Number.MAX_SAFE_INTEGER) throw Error("拆除付款 ID 无效");
  if (!isDemolishableBuildingId(raw.building)) throw Error("此建筑不支持普通拆除");
  if (typeof raw.fromLevel !== "number" || !Number.isSafeInteger(raw.fromLevel) || raw.fromLevel < 1 || raw.fromLevel > MAX_ORDER_LEVEL
    || typeof raw.toLevel !== "number" || !Number.isSafeInteger(raw.toLevel) || !Object.is(raw.toLevel, raw.fromLevel - 1)) throw Error("拆除等级快照无效");
  if (!validDemolitionSeconds(raw.totalSeconds, raw.remainingSeconds)) throw Error("拆除总时长或剩余时间无效");
}

/** Canonical integer snapshots only, with an independent exact decimal round-trip check. */
export function readDemolitionJob(raw: unknown): DemolitionJob | null {
  if (raw === null) return null;
  validateScalars(raw);
  exactRecord(raw.paid, RESOURCE_IDS, "拆除已付快照");
  const paid = {} as ResourceAmounts;
  for (const id of RESOURCE_IDS) {
    const amount = raw.paid[id];
    if (!isOrderAmount(amount)) throw Error("拆除已付金额无效");
    const normalized = normalizeOrderAmount(amount);
    if (normalized === null || normalized.includes(".")) throw Error("拆除已付金额必须是整数");
    const value = big(amount);
    if (!isValidAmount(value) || compareOrderAmounts(amount, value.toString()) !== 0 || amount !== value.toString()) {
      throw Error("拆除已付金额不是精确规范快照");
    }
    paid[id] = value;
  }
  return { ...(raw as unknown as SerializedDemolitionJob), paid };
}

/** Validate before emitting; unknown runtime fields must not silently disappear. */
export function serializeDemolitionJob(job: DemolitionJob | null): SerializedDemolitionJob | null {
  if (job === null) return null;
  validateScalars(job);
  exactRecord(job.paid, RESOURCE_IDS, "拆除已付快照");
  const paid = {} as Record<ResourceId, string>;
  for (const id of RESOURCE_IDS) {
    const value = job.paid[id];
    if (!value || typeof value !== "object" || !isValidAmount(value)) throw Error("拆除已付金额对象无效");
    paid[id] = value.toString();
  }
  const result = { ...job, paid };
  readDemolitionJob(result);
  return result;
}

/** Scan the whole envelope before legacy readers can ignore unknown nested fields. */
export function rejectLegacyDemolitionFields(raw: unknown): void {
  const pending = [raw], visited = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (!Array.isArray(value) && (value as Record<string, unknown>).kind === "demolition") throw Error("旧修订不能夹带 r11 拆除工作");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "string" && RESERVED_KEYS.has(key)) throw Error("旧修订不能夹带 r11 拆除字段");
      const entry = (value as Record<PropertyKey, unknown>)[key];
      if (entry !== null && typeof entry === "object") pending.push(entry);
    }
  }
}

/** New markers are valid only at the one typed planet slot, never ignored elsewhere. */
export function rejectMisplacedDemolitionFields(raw: unknown, envelope = false): void {
  const prefix: Array<string | number> = envelope ? ["state"] : [];
  const pending: Array<{ value: unknown; path: Array<string | number>; ancestors: Set<object> }> = [
    { value: raw, path: [], ancestors: new Set() },
  ];
  while (pending.length) {
    const { value, path, ancestors } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    if (ancestors.has(value)) throw Error("拆除格式不能包含循环对象");
    const inState = prefix.every((part, index) => path[index] === part);
    const planet = inState && path.length === prefix.length + 2 && path[prefix.length] === "planets"
      && typeof path[prefix.length + 1] === "number";
    const job = inState && path.length === prefix.length + 3 && path[prefix.length] === "planets"
      && typeof path[prefix.length + 1] === "number" && path[prefix.length + 2] === "demolition";
    if ((value as Record<string, unknown>).kind === "demolition" && !job) {
      throw Error("拆除工作只能位于星球的独立拆除槽");
    }
    const nextAncestors = new Set(ancestors); nextAncestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "string" && RESERVED_KEYS.has(key)
        && !(key === "demolition" ? planet : job)) throw Error("拆除字段位于错误位置，原数据未采用");
      const child = (value as Record<PropertyKey, unknown>)[key];
      if (child !== null && typeof child === "object") {
        const index = typeof key === "string" ? Number(key) : NaN;
        const part = Array.isArray(value) && typeof key === "string" && Number.isSafeInteger(index)
          && index >= 0 && index < value.length && String(index) === key ? index : String(key);
        pending.push({ value: child, path: [...path, part], ancestors: nextAncestors });
      }
    }
  }
}

/** Exactly one additive null slot. This never allocates IDs, rebases grants or touches timers. */
export function migrateLegacyDemolitionSlots(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("存档状态格式不正确");
  const state = raw as Record<string, unknown>;
  if (!Array.isArray(state.planets)) throw Error("星球列表无效");
  return { ...state, planets: state.planets.map(planet => {
    if (!planet || typeof planet !== "object" || Array.isArray(planet) || Object.hasOwn(planet, "demolition")) throw Error("旧版星球拆除槽无效");
    return { ...planet, demolition: null };
  }) };
}
