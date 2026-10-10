import {
  createResearchTemplateState, MAX_RESEARCH_TEMPLATES, normalizeResearchTemplateDraft, hasResearchTemplateFields,
  type ResearchTemplate, type ResearchTemplateState,
} from "./research-template-state";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (!hasResearchTemplateFields(value, expected)) {
    throw Error(`${label}字段无效`);
  }
}
function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw Error(`${label}整数无效`);
  }
  return value;
}

/** r7 stores reusable intent only. Never deserialize budgets, payers or execution authority. */
export function readResearchTemplates(raw: unknown): ResearchTemplateState {
  if (!record(raw)) throw Error("研究模板数据缺失");
  keys(raw, ["nextTemplateId", "templates"], "研究模板库");
  const nextTemplateId = integer(raw.nextTemplateId, "研究模板计数器");
  if (!Array.isArray(raw.templates) || raw.templates.length > MAX_RESEARCH_TEMPLATES) throw Error("研究模板列表过长或无效");
  const ids = new Set<number>();
  const templates: ResearchTemplate[] = raw.templates.map(value => {
    if (!record(value)) throw Error("研究模板格式无效");
    keys(value, ["id", "revision", "name", "goals"], "研究模板");
    const id = integer(value.id, "研究模板 ID", Number.MAX_SAFE_INTEGER - 1);
    if (id >= nextTemplateId || ids.has(id)) throw Error("研究模板 ID 重复或计数器过期");
    ids.add(id);
    const revision = integer(value.revision, "研究模板修订");
    const draft = normalizeResearchTemplateDraft({ name: value.name, goals: value.goals });
    if (!draft || draft.name !== value.name) throw Error("研究模板名称或目标无效");
    // Files are canonical, so accepting a file cannot silently rewrite its goal order.
    if (draft.goals.some((goal, index) => {
      const stored = (value.goals as Array<Record<string, unknown>>)[index]!;
      return goal.tech !== stored.tech || goal.targetLevel !== stored.targetLevel;
    })) throw Error("研究模板目标顺序无效");
    return { id, revision, name: draft.name, goals: draft.goals.map(goal => ({ ...goal })) };
  });
  return { nextTemplateId, templates };
}

/** Validation and cloning share one path; invalid live intent cannot be silently stripped. */
export function serializeResearchTemplates(state: ResearchTemplateState): ResearchTemplateState {
  return readResearchTemplates(state);
}

/** Add an empty library only after a genuine older revision passes its own migration. */
export function migrateResearchTemplates(raw: unknown): Record<string, unknown> {
  if (!record(raw)) throw Error("存档状态格式不正确");
  rejectLegacyResearchTemplateFields(raw);
  return { ...raw, researchTemplates: createResearchTemplateState() };
}

/** Reject uniquely named new metadata anywhere; unrelated old IDs/names remain valid. */
export function rejectLegacyResearchTemplateFields(raw: unknown): void {
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { for (const entry of value) inspect(entry); return; }
    if (!record(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "researchTemplates" || key === "nextTemplateId") throw Error("旧修订不能夹带 r7 研究模板数据");
      inspect(entry);
    }
  }
  inspect(raw);
}
