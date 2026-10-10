import { describe, expect, it } from "vitest";
import { RESEARCH_IDS } from "../src/data/research";
import { SAVE_REVISION, STORAGE_KEY } from "../src/game/content";
import { createInitialState } from "../src/game/state";
import { exportSave, importSave, deserializeState, serializeState, BACKUP_KEY } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { readResearchTemplates, serializeResearchTemplates } from "../src/game/research-templates-save";
import { createResearchTemplateState } from "../src/game/research-template-state";

function library(): any {
  return { nextTemplateId: 4, templates: [
    { id: 1, revision: 3, name: "合成目标 🚀", goals: [{ tech: RESEARCH_IDS[0], targetLevel: 4 }, { tech: RESEARCH_IDS[1], targetLevel: 1000 }] },
    { id: 3, revision: 1, name: "合成目标 🚀", goals: [{ tech: RESEARCH_IDS[0], targetLevel: 1 }] },
  ] };
}
function file(): any {
  const state = createInitialState(71);
  state.researchTemplates = library();
  return JSON.parse(exportSave(state, 1000));
}
function read(value: any) { return importSave(JSON.stringify(value)); }
function legacy(revision: 2 | 3 | 4 | 5 | 6): any {
  const value = JSON.parse(exportSave(createInitialState(71), 1000));
  value.revision = revision;
  delete value.state.buildingTemplates;
  delete value.state.researchTemplates;
  delete value.state.formations;
  for (const task of value.state.orders.tasks) delete task.formationOrigin;
  if (revision < 6) { delete value.state.orders.nextWorkId; }
  if (revision < 5) delete value.state.orders;
  if (revision < 4) { delete value.state.arcade.nextRunId; delete value.state.arcade.autoBatch; }
  if (revision === 2) delete value.state.deepSpace;
  return value;
}

describe("r7 pure research-intent persistence", () => {
  it("round-trips the complete library and every unchanged world field", () => {
    const original = file(), imported = read(original);
    expect(imported.revision).toBe(SAVE_REVISION);
    expect(imported.state).toEqual(original.state);
    expect(serializeState(deserializeState(imported.state))).toEqual(original.state);
    expect(read(imported)).toEqual(imported);
    expect(imported.state.researchTemplates.templates[0]!.name).toBe(imported.state.researchTemplates.templates[1]!.name);
  });
  it("deep-copies libraries, templates, goal arrays and every goal in both directions", () => {
    const input = library(), restored = readResearchTemplates(input), serialized = serializeResearchTemplates(restored);
    input.templates[0].goals[0].targetLevel = 99;
    input.templates[0].name = "changed";
    serialized.templates[0]!.goals[0]!.targetLevel = 2;
    serialized.templates[1]!.goals.push({ tech: RESEARCH_IDS[2]!, targetLevel: 1 });
    serialized.nextTemplateId = 12;
    expect(restored).toEqual(library());
    expect(restored.templates).not.toBe(serialized.templates);
    expect(restored.templates[0]).not.toBe(serialized.templates[0]);
    expect(restored.templates[0]!.goals).not.toBe(serialized.templates[0]!.goals);
  });
  it("accepts 64 Unicode code points, 16 canonical goals, 32 templates and exhausted counters", () => {
    const value = library();
    value.nextTemplateId = Number.MAX_SAFE_INTEGER;
    value.templates = Array.from({ length: 32 }, (_, index) => ({ id: index + 1, revision: Number.MAX_SAFE_INTEGER,
      name: "🚀".repeat(64), goals: RESEARCH_IDS.slice(0, 16).map(tech => ({ tech, targetLevel: 1000 })) }));
    expect(readResearchTemplates(value)).toEqual(value);
    value.templates[31].id = Number.MAX_SAFE_INTEGER - 1;
    expect(readResearchTemplates(value)).toEqual(value);
  });
  it("ignores JSON object key order while preserving canonical goal array order", () => {
    const value = library();
    value.templates[0].goals[0] = { targetLevel: 4, tech: RESEARCH_IDS[0] };
    expect(readResearchTemplates(value)).toEqual(library());
  });
  it.each([
    ["missing", (_v: any): undefined => undefined], ["null", (_v: any): null => null], ["array", (_v: any) => []],
    ["missing counter", (v: any) => { delete v.nextTemplateId; return v; }],
    ["zero counter", (v: any) => { v.nextTemplateId = 0; return v; }],
    ["fractional counter", (v: any) => { v.nextTemplateId = 4.5; return v; }],
    ["unsafe counter", (v: any) => { v.nextTemplateId = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["stale counter", (v: any) => { v.nextTemplateId = 3; return v; }],
    ["numeric-string counter", (v: any) => { v.nextTemplateId = "4"; return v; }],
    ["missing templates", (v: any) => { delete v.templates; return v; }],
    ["33 templates", (v: any) => { v.templates = Array.from({ length: 33 }, (_, i) => ({ ...v.templates[0], id: i + 1 })); v.nextTemplateId = 34; return v; }],
    ["library authority", (v: any) => { v.runId = 1; return v; }],
    ["zero id", (v: any) => { v.templates[0].id = 0; return v; }],
    ["duplicate id", (v: any) => { v.templates[1].id = 1; return v; }],
    ["issued exhausted id", (v: any) => { v.nextTemplateId = Number.MAX_SAFE_INTEGER; v.templates[0].id = Number.MAX_SAFE_INTEGER; return v; }],
    ["missing revision", (v: any) => { delete v.templates[0].revision; return v; }],
    ["zero revision", (v: any) => { v.templates[0].revision = 0; return v; }],
    ["unsafe revision", (v: any) => { v.templates[0].revision = Number.MAX_SAFE_INTEGER + 1; return v; }],
    ["fractional revision", (v: any) => { v.templates[0].revision = 1.5; return v; }],
    ["empty name", (v: any) => { v.templates[0].name = ""; return v; }],
    ["untrimmed name", (v: any) => { v.templates[0].name = " name "; return v; }],
    ["65 codepoints", (v: any) => { v.templates[0].name = "🚀".repeat(65); return v; }],
    ["control", (v: any) => { v.templates[0].name = "name\u0085"; return v; }],
    ["empty goals", (v: any) => { v.templates[0].goals = []; return v; }],
    ["17 goals", (v: any) => { v.templates[0].goals = Array.from({ length: 17 }, () => v.templates[0].goals[0]); return v; }],
    ["duplicate tech", (v: any) => { v.templates[0].goals[1].tech = RESEARCH_IDS[0]; return v; }],
    ["unsorted goals", (v: any) => { v.templates[0].goals.reverse(); return v; }],
    ["unknown tech", (v: any) => { v.templates[0].goals[0].tech = "unknown"; return v; }],
    ["missing target", (v: any) => { delete v.templates[0].goals[0].targetLevel; return v; }],
    ["zero target", (v: any) => { v.templates[0].goals[0].targetLevel = 0; return v; }],
    ["fractional target", (v: any) => { v.templates[0].goals[0].targetLevel = 1.5; return v; }],
    ["1001 target", (v: any) => { v.templates[0].goals[0].targetLevel = 1001; return v; }],
  ] as const)("rejects %s without manufacturing a fresh library", (_label, mutate) => {
    const value = file(); value.state.researchTemplates = mutate(library());
    expect(() => read(value)).toThrow();
  });
  it.each(["planetId", "payer", "budget", "charged", "refunded", "taskId", "runId", "status", "transport", "currentWork"])("rejects %s at all template data boundaries", key => {
    for (const location of ["library", "template", "goal"]) {
      const value = library();
      const target = location === "library" ? value : location === "template" ? value.templates[0] : value.templates[0].goals[0];
      target[key] = null;
      expect(() => readResearchTemplates(value), location).toThrow();
      expect(() => serializeResearchTemplates(value), location).toThrow();
    }
  });
  it("rejects symbolic or inherited live fields instead of stripping them on save", () => {
    const symbolic = library(); symbolic.templates[0][Symbol("payer")] = "homeworld";
    expect(() => serializeResearchTemplates(symbolic)).toThrow();
    const inherited = library(); Object.setPrototypeOf(inherited, { runId: 1 });
    expect(() => serializeResearchTemplates(inherited)).toThrow();
  });
  it("requires the r7 field even for an otherwise empty new game", () => {
    const value = file(); delete value.state.researchTemplates;
    expect(() => read(value)).toThrow("研究模板");
  });
});

describe("r7 additive migration boundaries", () => {
  it.each([2, 3, 4, 5, 6] as const)("adds only empty research intent when accepting r%d", revision => {
    const source = legacy(revision), original = structuredClone(source), imported = read(source);
    expect(source).toEqual(original);
    expect(imported.state.researchTemplates).toEqual(createResearchTemplateState());
    expect(imported.state.orders.tasks).toEqual([]);
    if (revision === 6) {
      const { researchTemplates: _templates, buildingTemplates, formations, ...projection } = imported.state;
      expect(buildingTemplates).toEqual({ nextTemplateId: 1, templates: [] });
      expect(formations).toEqual({ nextFormationId: 1, entries: [] });
      expect(projection).toEqual(source.state);
    }
    expect(read(imported)).toEqual(imported);
  });
  it.each([2, 3, 4, 5, 6] as const)("rejects even empty/null r7 intent smuggled into r%d", revision => {
    for (const value of [null, {}, createResearchTemplateState(), library()]) {
      const source = legacy(revision); source.state.researchTemplates = value;
      expect(() => read(source)).toThrow("不能夹带 r7");
    }
    const nested = legacy(revision); nested.state.planets[0].researchTemplates = null;
    expect(() => read(nested)).toThrow("不能夹带 r7");
    const counter = legacy(revision); counter.state.planets[0].nextTemplateId = 1;
    expect(() => read(counter)).toThrow("不能夹带 r7");
  });
  it("keeps the complete imported library and resets to empty without merging IDs", () => {
    const source = JSON.stringify(file()), data = new Map([[STORAGE_KEY, source]]);
    const store = { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const session = new SaveSession(store, 1000), incoming = file();
    incoming.state.researchTemplates.templates[0].name = "替换库";
    const imported = session.importText(JSON.stringify(incoming), 1000);
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw Error(imported.message);
    expect(imported.state.researchTemplates).toEqual(incoming.state.researchTemplates);
    expect(data.get(BACKUP_KEY)).toBe(source);
    const reset = session.reset(1000);
    expect(reset.ok).toBe(true);
    if (!reset.ok) throw Error(reset.message);
    expect(reset.state.researchTemplates).toEqual(createResearchTemplateState());
    expect(JSON.parse(data.get(STORAGE_KEY)!).state.researchTemplates).toEqual(createResearchTemplateState());
  });
});
