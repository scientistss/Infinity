import { createNpcEconomyState, isNpcEconomyState, type NpcEconomyState } from "./npc-economy";

/** r12 owns exactly one model and finite, bounded economic age. No repair/default. */
export function readNpcEconomy(raw: unknown): NpcEconomyState {
  if (!isNpcEconomyState(raw)) throw Error("NPC 经济模型、年龄或字段无效");
  return Object.freeze({ model: raw.model, elapsedSeconds: raw.elapsedSeconds });
}

/** Runtime invalidity must fail before JSON can erase an extra field or NaN. */
export function serializeNpcEconomy(raw: NpcEconomyState): NpcEconomyState {
  return readNpcEconomy(raw);
}

/**
 * Only the dedicated marker is reserved; generic model/elapsedSeconds names in
 * unrelated domains remain legal. Inspect descriptors without invoking getters.
 * Paths, rather than a global visited set, also catch misplaced shared objects.
 */
function inspectNpcEconomyFields(raw: unknown, legacy: boolean, envelope: boolean): void {
  const pending: Array<{ value: unknown; path: PropertyKey[]; ancestors: Set<object> }> = [
    { value: raw, path: [], ancestors: new Set() },
  ];
  while (pending.length) {
    const { value, path, ancestors } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (ancestors.has(value)) throw Error("NPC 存档格式不能包含循环对象");
    const atState = envelope ? path.length === 1 && path[0] === "state" : path.length === 0;
    const nextAncestors = new Set(ancestors); nextAncestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (key === "npcEconomy") {
        if (legacy) throw Error("旧修订不能夹带 r12 NPC 经济字段");
        if (!atState) throw Error("NPC 经济字段只能位于 state.npcEconomy");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw Error("NPC 存档格式不接受访问器字段");
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === "object") {
        pending.push({ value: child, path: [...path, key], ancestors: nextAncestors });
      }
    }
  }
}

/** Called on the entire original envelope before any historical normalization. */
export function rejectLegacyNpcEconomyFields(raw: unknown): void {
  inspectNpcEconomyFields(raw, true, true);
}

export function rejectMisplacedNpcEconomyFields(raw: unknown, envelope = false): void {
  inspectNpcEconomyFields(raw, false, envelope);
}

/** The historical source reader owns every old field; never infer age from time. */
export function migrateLegacyNpcEconomy(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw Error("存档状态格式不正确");
  if (Object.hasOwn(raw, "npcEconomy")) throw Error("旧修订不能夹带 r12 NPC 经济字段");
  return { ...raw, npcEconomy: createNpcEconomyState() };
}
