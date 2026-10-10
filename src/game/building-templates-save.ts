import {
  createBuildingTemplateState, MAX_BUILDING_TEMPLATES, normalizeBuildingTemplateDraft, hasBuildingTemplateFields,
  type BuildingTemplate, type BuildingTemplateState,
} from "./building-template-state";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (!hasBuildingTemplateFields(value, expected)) {
    throw Error(`${label}字段无效`);
  }
}
/** Array.map skips holes and inherited slots are not saved data owned by this library. */
function hasAllOwnItems(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}
function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw Error(`${label}整数无效`);
  }
  return value;
}

/** r9 stores reusable intent only. Never deserialize budgets, payers or execution authority. */
export function readBuildingTemplates(raw: unknown): BuildingTemplateState {
  if (!record(raw)) throw Error("建筑模板数据缺失");
  keys(raw, ["nextTemplateId", "templates"], "建筑模板库");
  const nextTemplateId = integer(raw.nextTemplateId, "建筑模板计数器");
  if (!Array.isArray(raw.templates) || raw.templates.length > MAX_BUILDING_TEMPLATES || !hasAllOwnItems(raw.templates)) throw Error("建筑模板列表过长或无效");
  const ids = new Set<number>();
  const templates: BuildingTemplate[] = raw.templates.map(value => {
    if (!record(value)) throw Error("建筑模板格式无效");
    keys(value, ["id", "revision", "name", "goals"], "建筑模板");
    const id = integer(value.id, "建筑模板 ID", Number.MAX_SAFE_INTEGER - 1);
    if (id >= nextTemplateId || ids.has(id)) throw Error("建筑模板 ID 重复或计数器过期");
    ids.add(id);
    const revision = integer(value.revision, "建筑模板修订");
    const draft = normalizeBuildingTemplateDraft({ name: value.name, goals: value.goals });
    if (!draft || draft.name !== value.name || !hasAllOwnItems(value.goals as unknown[])) throw Error("建筑模板名称或目标无效");
    // Files are canonical, so accepting a file cannot silently rewrite its goal order.
    if (draft.goals.some((goal, index) => {
      const stored = (value.goals as Array<Record<string, unknown>>)[index]!;
      return goal.building !== stored.building || goal.targetLevel !== stored.targetLevel;
    })) throw Error("建筑模板目标顺序无效");
    return { id, revision, name: draft.name, goals: draft.goals.map(goal => ({ ...goal })) };
  });
  return { nextTemplateId, templates };
}

/** Validation and cloning share one path; invalid live intent cannot be silently stripped. */
export function serializeBuildingTemplates(state: BuildingTemplateState): BuildingTemplateState {
  return readBuildingTemplates(state);
}

/** Add an empty library only after a genuine older revision passes its own migration. */
export function migrateBuildingTemplates(raw: unknown): Record<string, unknown> {
  if (!record(raw)) throw Error("存档状态格式不正确");
  rejectLegacyBuildingTemplateFields(raw);
  return { ...raw, buildingTemplates: createBuildingTemplateState() };
}

/** Only the unique r9 marker is forbidden: r7/r8 research libraries already own nextTemplateId. */
export function rejectLegacyBuildingTemplateFields(raw: unknown): void {
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { for (const entry of value) inspect(entry); return; }
    if (!record(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "buildingTemplates") throw Error("旧修订不能夹带 r9 建筑模板数据");
      inspect(entry);
    }
  }
  inspect(raw);
}
