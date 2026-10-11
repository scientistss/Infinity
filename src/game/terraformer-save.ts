import type { PlanetState } from "./planet";
import { MAX_PLANET_FIELDS } from "./terraformer";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Strict r10 metadata. A lost ledger must never be reconstructed from levels. */
export function readTerraformerFields(raw: unknown): PlanetState["terraformerFields"] {
  if (!record(raw)) throw Error("地形授格账缺失或格式无效");
  const prototype = Object.getPrototypeOf(raw), keys = Reflect.ownKeys(raw);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== 2 ||
      keys.some(key => key !== "base" && key !== "grantedLevels")) throw Error("地形授格账字段无效");
  if (typeof raw.base !== "number" || !Number.isSafeInteger(raw.base) || raw.base < 1 || raw.base > MAX_PLANET_FIELDS) {
    throw Error("地形基础格子整数无效");
  }
  if (typeof raw.grantedLevels !== "number" || !Number.isSafeInteger(raw.grantedLevels) || raw.grantedLevels < 0) {
    throw Error("地形授格次数整数无效");
  }
  return { base: raw.base, grantedLevels: raw.grantedLevels };
}

/** The exhausted MAX_SAFE_INTEGER counter is also a valid empty boundary. */
export function readTerraformerGrantJobFloor(raw: unknown, nextJobId: number): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1 || raw > nextJobId ||
      !Number.isSafeInteger(nextJobId) || nextJobId < 1) throw Error("地形授格付款边界无效");
  return raw;
}

/** Reject both unique r10 markers at any depth before older readers ignore extras. */
export function rejectLegacyTerraformerFields(raw: unknown): void {
  const pending: unknown[] = [raw];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (!record(value)) continue;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "terraformerFields" || key === "terraformerGrantJobFloor") {
        throw Error("旧修订不能夹带 r10 地形授格数据");
      }
      if (entry !== null && typeof entry === "object") pending.push(entry);
    }
  }
}
