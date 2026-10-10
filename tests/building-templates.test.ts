import { describe, expect, it, vi } from "vitest";
import { BUILDING_IDS, type BuildingId } from "../src/data/buildings";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet, withPlanet } from "../src/game/empire";
import { prestige, tick } from "../src/game/logic";
import { addOrderAmounts, normalizeOrderAmount } from "../src/game/order-money";
import { zeroOrderMoney } from "../src/game/order-ledger";
import type { OrderMoney, OrderTask } from "../src/game/order-state";
import * as orders from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import * as queue from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import * as save from "../src/game/save";
import {
  MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH, normalizeBuildingTemplateDraft,
  type BuildingGoal, type BuildingTemplateAction, type BuildingTemplateApplyRequest, type BuildingTemplateDraft,
} from "../src/game/building-template-state";
import {
  applyBuildingTemplate, applyBuildingTemplateAction, buildingTemplateAuthorityKey, createBuildingTemplate, deleteBuildingTemplate,
  editBuildingTemplate, mapBuildingTemplate, quoteBuildingTemplate,
} from "../src/game/building-templates";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

const generous: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const metal: BuildingGoal = { building: "metal_mine", targetLevel: 2 };
const crystal: BuildingGoal = { building: "crystal_mine", targetLevel: 1 };
function template(state = rich(stateWith(), 1e6), goals: BuildingGoal[] = [metal]): GameState {
  const result = createBuildingTemplate(state, { name: "合成建造目标", goals }, state.buildingTemplates.nextTemplateId);
  expect(result.ok).toBe(true);
  return result.state;
}
function applyRequest(state: GameState, money: OrderMoney = generous, planetId = state.activePlanetId, templateId = 1): BuildingTemplateApplyRequest {
  const quote = quoteBuildingTemplate(state, templateId, planetId);
  return { templateId, expectedTemplateRevision: quote.templateRevision, planetId, expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
    budgets: quote.rows.filter(row => row.status === "new").map(row => ({ building: row.building, budget: { ...money } })) };
}
function colony(state = rich(stateWith(), 1e6)): GameState {
  const extra = createPlanet("synthetic-payer", { galaxy: 1, system: 2, position: 8 });
  extra.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  return { ...state, planets: [...state.planets, extra] };
}
function buildingOrder(state: GameState, building: BuildingId = "metal_mine", level = 2, payer = state.activePlanetId): GameState {
  const result = orders.createOrderTask(state, { kind: "building", building, targetLevel: level, planetId: payer, budget: { ...generous }, expectedNextTaskId: state.orders.nextTaskId });
  expect(result.ok).toBe(true);
  return result.state;
}
function withoutTemplates(state: GameState) { const { buildingTemplates: _ignored, ...rest } = state; return rest; }
function withDummyOrders(state: GameState, count: number, status: "running" | "cancelled"): GameState {
  const created = orders.createOrderTask(state, { kind: "building", building: "solar_plant", targetLevel: 1, planetId: state.activePlanetId, budget: generous, expectedNextTaskId: state.orders.nextTaskId }).state.orders.tasks.at(-1)!;
  const tasks: OrderTask[] = Array.from({ length: count }, (_, index) => ({ ...created, id: index + 1, status }));
  return { ...state, orders: { ...state.orders, tasks, nextTaskId: count + 1 } };
}

describe("building templates are bounded pure intent", () => {
  it("creates canonical detached goals and trims names without changing any simulation state", () => {
    const initial = stateWith(), goals: BuildingGoal[] = [{ ...crystal }, { ...metal }];
    const draft = { name: "  合成建造  ", goals };
    const saved = createBuildingTemplate(initial, draft, 1);
    expect(saved.ok).toBe(true);
    expect(saved.state.buildingTemplates).toEqual({ nextTemplateId: 2, templates: [{ id: 1, revision: 1, name: "合成建造", goals: [metal, crystal] }] });
    expect(withoutTemplates(saved.state)).toEqual(withoutTemplates(initial));
    expect(saved.state.orders).toBe(initial.orders);
    goals[0]!.targetLevel = 900;
    goals.push({ building: "solar_plant", targetLevel: 5 });
    draft.name = "changed";
    expect(saved.state.buildingTemplates.templates[0]!.goals).toEqual([metal, crystal]);
    expect(Object.keys(saved.state.buildingTemplates.templates[0]!)).toEqual(["id", "revision", "name", "goals"]);
    expect(createBuildingTemplate(saved.state, { name: "duplicate submit", goals: [metal] }, 1).state).toBe(saved.state);
  });
  it("edits only future intent, increments revision and deletes without touching orders, wallets or queues", () => {
    const paid = queue.enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state;
    const before = buildingOrder(template(paid));
    const edited = editBuildingTemplate(before, 1, 1, { name: "新意图", goals: [{ building: "metal_mine", targetLevel: 9 }] });
    expect(edited.ok).toBe(true);
    expect(edited.state.buildingTemplates.templates[0]!.revision).toBe(2);
    expect(withoutTemplates(edited.state)).toEqual(withoutTemplates(before));
    expect(edited.state.orders).toBe(before.orders);
    expect(editBuildingTemplate(edited.state, 1, 1, { name: "stale", goals: [metal] }).state).toBe(edited.state);
    expect(deleteBuildingTemplate(edited.state, 1, 1).state).toBe(edited.state);
    const removed = deleteBuildingTemplate(edited.state, 1, 2);
    expect(removed.ok).toBe(true);
    expect(removed.state.buildingTemplates).toEqual({ nextTemplateId: 2, templates: [] });
    expect(withoutTemplates(removed.state)).toEqual(withoutTemplates(before));
    expect(createBuildingTemplate(removed.state, { name: "new", goals: [metal] }, 2).state.buildingTemplates.templates[0]!.id).toBe(2);
  });
  it("accepts same names, all sixteen goals, 64 Unicode code points and endpoint levels", () => {
    const name = "🚀".repeat(64), goals = BUILDING_IDS.slice(0, 16).map(building => ({ building, targetLevel: 1000 }));
    const a = createBuildingTemplate(stateWith(), { name, goals }, 1);
    expect(a.ok).toBe(true);
    expect(a.state.buildingTemplates.templates[0]!.name).toBe(name);
    expect(createBuildingTemplate(a.state, { name, goals: [{ building: "metal_mine", targetLevel: 1 }] }, 2).ok).toBe(true);
  });
  it.each([
    null, {}, { name: "", goals: [metal] }, { name: "   ", goals: [metal] }, { name: "x".repeat(65), goals: [metal] },
    { name: "🚀".repeat(65), goals: [metal] }, { name: "a\nb", goals: [metal] }, { name: "\u0085", goals: [metal] },
    { name: "\0x", goals: [metal] }, { name: "x", goals: [] }, { name: "x", goals: Array(17).fill(metal) },
    { name: "x", goals: [metal, metal] }, { name: "x", goals: [{ building: "unknown", targetLevel: 1 }] },
    { name: "x", goals: [{ building: "metal_mine", targetLevel: 0 }] }, { name: "x", goals: [{ building: "metal_mine", targetLevel: 1.5 }] },
    { name: "x", goals: [{ building: "metal_mine", targetLevel: 1001 }] }, { name: "x", goals: [{ building: "metal_mine", targetLevel: Infinity }] },
    { name: "x", goals: [{ building: "metal_mine", targetLevel: "1" }] }, { name: "x", goals: [null] },
    { name: "x", goals: [metal], budget: generous }, { name: "x", goals: [metal], planetId: "synthetic-payer" },
    { name: "x", goals: [metal], runId: 1 }, { name: "x", goals: [{ ...metal, taskId: 1 }] },
    { name: "x", goals: [{ ...metal, budget: generous }] }, { name: "x", goals: new Array(2) },
  ])("rejects malformed or authorization-bearing draft %j without allocating IDs", draft => {
    const state = stateWith();
    expect(normalizeBuildingTemplateDraft(draft)).toBeNull();
    const result = createBuildingTemplate(state, draft as BuildingTemplateDraft, 1);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
  });
  it("rejects inherited, symbolic and non-record draft properties", () => {
    const drafts = [Object.assign(Object.create({ authority: true }), { name: "x", goals: [metal] }), { name: "x", goals: [metal], [Symbol("payer")]: "x" }];
    for (const draft of drafts) expect(normalizeBuildingTemplateDraft(draft)).toBeNull();
  });
  it("enforces the 32-template cap and monotonic safe ID and revision exhaustion", () => {
    let state = stateWith();
    for (let i = 1; i <= 32; i++) state = createBuildingTemplate(state, { name: "same", goals: [metal] }, i).state;
    expect(state.buildingTemplates.templates).toHaveLength(32);
    expect(createBuildingTemplate(state, { name: "full", goals: [metal] }, 33).state).toBe(state);
    const max = Number.MAX_SAFE_INTEGER;
    const last = { ...stateWith(), buildingTemplates: { nextTemplateId: max - 1, templates: [] } };
    const issued = createBuildingTemplate(last, { name: "last", goals: [metal] }, max - 1).state;
    expect(issued.buildingTemplates.nextTemplateId).toBe(max);
    expect(createBuildingTemplate(issued, { name: "overflow", goals: [metal] }, max).state).toBe(issued);
    const nearRevision = { ...issued, buildingTemplates: { ...issued.buildingTemplates, templates: issued.buildingTemplates.templates.map(value => ({ ...value, revision: max - 1 })) } };
    const finalRevision = editBuildingTemplate(nearRevision, max - 1, max - 1, { name: "final", goals: [metal] }).state;
    expect(finalRevision.buildingTemplates.templates[0]!.revision).toBe(max);
    expect(editBuildingTemplate(finalRevision, max - 1, max, { name: "exhausted", goals: [metal] }).state).toBe(finalRevision);
    expect(deleteBuildingTemplate(finalRevision, max - 1, max).ok).toBe(true);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects unsafe template identity %s", id => {
    const state = template();
    expect(editBuildingTemplate(state, id, 1, { name: "x", goals: [metal] }).state).toBe(state);
    expect(deleteBuildingTemplate(state, id, 1).state).toBe(state);
    expect(quoteBuildingTemplate(state, id, state.activePlanetId).ok).toBe(false);
  });
  it("preserves detached templates and counters on real prestige, while a new game is empty", () => {
    let state = template();
    state = { ...state, lifetime: { metal: big(1e12), crystal: big(1e12), deuterium: big(1e12) } };
    const launched = prestige(state);
    expect(launched.stats.launches).toBe(state.stats.launches + 1);
    expect(launched.buildingTemplates).toEqual(state.buildingTemplates);
    expect(launched.buildingTemplates).not.toBe(state.buildingTemplates);
    expect(launched.buildingTemplates.templates[0]!.goals[0]).not.toBe(state.buildingTemplates.templates[0]!.goals[0]);
    expect(createInitialState().buildingTemplates).toEqual({ nextTemplateId: 1, templates: [] });
  });
  it("dispatcher follows the shared action union and rejects extra authorization fields", () => {
    const state = stateWith();
    const result = applyBuildingTemplateAction(state, { type: "building-template-create", draft: { name: "x", goals: [metal] }, expectedNextTemplateId: 1 });
    expect(result.ok).toBe(true);
    expect(applyBuildingTemplateAction(state, { type: "building-template-create", draft: { name: "x", goals: [metal] }, expectedNextTemplateId: 1, payer: "x" } as unknown as BuildingTemplateAction).state).toBe(state);
    expect(applyBuildingTemplateAction(state, { type: "unknown" } as unknown as BuildingTemplateAction).state).toBe(state);
  });
});

describe("planet-local building mapping and exact quotations", () => {
  it("has the starter golden quotation with each floor included", () => {
    const state = template(stateWith(), [{ building: "metal_mine", targetLevel: 3 }, { building: "crystal_mine", targetLevel: 2 }, { building: "solar_plant", targetLevel: 3 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows.map(row => row.quote)).toEqual([
      { metal: "285", crystal: "70", deuterium: "0" }, { metal: "124", crystal: "62", deuterium: "0" }, { metal: "355", crystal: "142", deuterium: "0" },
    ]);
    expect(quote.totalQuote).toEqual({ metal: "764", crystal: "274", deuterium: "0" });
  });
  it("maps achievement from only the pinned planet and ignores another planet's plans and paid jobs", () => {
    let state = template(colony(stateWith({ metal_mine: 3 })), [metal]);
    state = buildingOrder(state, "metal_mine", 4);
    state = queue.enqueue(rich(state, 1e6), "metal_mine", "manual").state;
    const home = mapBuildingTemplate(state, 1, state.activePlanetId), other = mapBuildingTemplate(state, 1, "synthetic-payer");
    expect(home.rows[0]!.status).toBe("achieved");
    expect(other.rows[0]).toMatchObject({ status: "new", currentLevel: 0, nextUnpaidLevel: 1, existingTask: null, paidJobs: [] });
    expect(quoteBuildingTemplate(state, 1, "synthetic-payer").totalQuote).toEqual({ metal: "150", crystal: "37", deuterium: "0" });
    const applied = applyBuildingTemplate(state, applyRequest(state, generous, "synthetic-payer"));
    expect(applied.ok).toBe(true);
    expect(applied.state.orders.tasks[0]).toBe(state.orders.tasks[0]);
    expect(applied.state.orders.tasks[1]).toMatchObject({ planetId: "synthetic-payer", building: "metal_mine", targetLevel: 2 });
  });
  it.each(["running", "paused"] as const)("leaves one local higher %s plan unchanged and adds only new rows", status => {
    let state = template(buildingOrder(colony(), "metal_mine", 3), [metal, crystal]);
    if (status === "paused") state = orders.pauseOrderTask(state, 1).state;
    const original = state.orders.tasks[0]!;
    const mapped = mapBuildingTemplate(state, 1, state.activePlanetId);
    expect(mapped.rows[0]).toMatchObject({ status: "covered", existingTask: { id: 1, status, targetLevel: 3 } });
    expect(quoteBuildingTemplate(state, 1, state.activePlanetId).rows[0]!.quote).toEqual(zeroOrderMoney());
    const applied = applyBuildingTemplate(state, applyRequest(state, zeroOrderMoney()));
    expect(applied.ok).toBe(true);
    expect(applied.createdTaskIds).toEqual([2]);
    expect(applied.state.orders.tasks[0]).toBe(original);
  });
  it("preserves an existing paused local transport plan without creating transport authorization", () => {
    const base = withResearch(colony(), { combustion_drive: 2 });
    const created = orders.createOrderTask(base, { kind: "building", building: "metal_mine", targetLevel: 3, planetId: base.activePlanetId, budget: generous, expectedNextTaskId: 1,
      transport: { donorPlanetId: "synthetic-payer", ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 2, grossCargoCap: generous } });
    expect(created.ok).toBe(true);
    const state = template(orders.pauseOrderTask(created.state, 1).state, [metal, crystal]);
    expect(mapBuildingTemplate(state, 1, state.activePlanetId).rows[0]!.existingTask).toMatchObject({ hasTransport: true, status: "paused" });
    const applied = applyBuildingTemplate(state, applyRequest(state));
    expect(applied.ok).toBe(true);
    expect(applied.state.orders.tasks[0]).toBe(state.orders.tasks[0]);
    expect(applied.state.orders.tasks[1]!.transport).toBeNull();
    expect(applied.state.fleets).toBe(state.fleets);
  });
  it("does not allocate a task or allow review when every target is already achieved", () => {
    const state = template(stateWith({ metal_mine: 2 }));
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.rows[0]!.status).toBe("achieved");
    expect(quote.newCount).toBe(0);
    expect(quote.ok).toBe(false);
    expect(quote.totalQuote).toEqual(zeroOrderMoney());
    expect(applyBuildingTemplate(state, applyRequest(state)).state).toBe(state);
  });
  it("rejects the entire batch when a local lower target conflicts", () => {
    const state = template(buildingOrder(stateWith(), "crystal_mine", 1), [metal, { building: "crystal_mine", targetLevel: 2 }]);
    expect(mapBuildingTemplate(state, 1, state.activePlanetId).rows.map(row => row.status)).toEqual(["new", "conflict"]);
    const applied = applyBuildingTemplate(state, applyRequest(state));
    expect(applied).toMatchObject({ ok: false, state, createdTaskIds: [] });
    expect(applied.state).toBe(state);
    expect(state.orders.nextTaskId).toBe(2);
  });
  it("ignores ended history and rejects duplicate live coverage", () => {
    const ended = template(orders.cancelOrderTask(buildingOrder(stateWith()), 1).state);
    expect(mapBuildingTemplate(ended, 1, ended.activePlanetId).rows[0]!.status).toBe("new");
    const completed = { ...ended, orders: { ...ended.orders, tasks: ended.orders.tasks.map(task => ({ ...task, status: "completed" as const })) } };
    expect(mapBuildingTemplate(completed, 1, completed.activePlanetId).rows[0]!.status).toBe("new");
    const base = template(buildingOrder(stateWith()));
    const duplicate = { ...base, orders: { ...base.orders, nextTaskId: 3, tasks: [...base.orders.tasks, { ...base.orders.tasks[0]!, id: 2 }] } };
    expect(mapBuildingTemplate(duplicate, 1, duplicate.activePlanetId).rows[0]!.status).toBe("conflict");
    expect(applyBuildingTemplate(duplicate, applyRequest(duplicate)).state).toBe(duplicate);
  });
  it.each(["manual", "protocol"] as const)("excludes local paid %s levels from the unpaid quote", source => {
    const paid = queue.enqueue(rich(stateWith(), 1e6), "metal_mine", source).state;
    const state = template(paid, [{ building: "metal_mine", targetLevel: 3 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.rows[0]).toMatchObject({ status: "new", currentLevel: 0, nextUnpaidLevel: 2, quote: { metal: "225", crystal: "55", deuterium: "0" } });
    expect(quote.rows[0]!.paidJobs[0]).toEqual({ jobId: paid.planets[0]!.buildQueue[0]!.jobId, taskId: null, planetId: paid.activePlanetId,
      targetLevel: 1, source, paid: { metal: "60", crystal: "15", deuterium: "0" } });
  });
  it("quotes every actual next level with growth cut and exact string accumulation", () => {
    const base = template(stateWith({ metal_mine: 4 }), [{ building: "metal_mine", targetLevel: 100 }]);
    const state = { ...base, curvature: { ...base.curvature, growth_cut: 1 } };
    let expected = "0";
    for (let level = 5; level <= 100; level++) expected = addOrderAmounts(expected, queue.costFor(state, "metal_mine", level).metal.toString())!;
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.quote!.metal).toBe(expected);
    expect(quote.rows[0]!.quote!.metal).not.toBe(quoteBuildingTemplate(base, 1, base.activePlanetId).rows[0]!.quote!.metal);
  });
  it("retains phase and prerequisite-locked goals as finite waiting intent without auto-unlocks", () => {
    const state = template(stateWith(), [{ building: "shipyard", targetLevel: 1 }, { building: "jump_gate", targetLevel: 1 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.warnings.join(" ")).toContain("需要");
    expect(quote.rows[1]!.warnings.join(" ")).toContain("阶段");
    const applied = applyBuildingTemplate(state, applyRequest(state));
    expect(applied.ok).toBe(true);
    const waiting = orders.runDueOrderPass(applied.state);
    expect(activePlanet(waiting).buildQueue).toHaveLength(0);
    expect(waiting.orders.tasks).toHaveLength(2);
    expect(activePlanet(waiting).buildings.robotics_factory).toBe(0);
    expect(waiting.orders.tasks[0]!.reason).toContain("需要");
  });
  it("warns about the research-lab lock, full queue, reserved fields and aggregate future shortage", () => {
    let base = enqueueResearch(rich(stateWith({ research_lab: 1 }), 1e6), "energy_tech", "manual").state;
    base = queue.enqueue(base, "metal_mine", "manual").state;
    base = queue.enqueue(base, "metal_mine", "manual").state;
    base = withPlanet(base, { planet: { ...activePlanet(base), fieldsMax: 3 } });
    const state = template(base, [{ building: "crystal_mine", targetLevel: 2 }, { building: "research_lab", targetLevel: 2 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.warnings.join(" ")).toContain("队列已满");
    expect(quote.rows[0]!.warnings.join(" ")).toContain("付费队列预留 2");
    expect(quote.rows[0]!.warnings.join(" ")).toContain("整批目标还需 3");
    expect(quote.rows[1]!.warnings.join(" ")).toContain("研究进行中");
  });
  it("warns when several individually-fitting goals collectively exceed remaining fields", () => {
    const base = stateWith();
    const state = template(withPlanet(base, { planet: { ...activePlanet(base), fieldsMax: 3 } }), [metal, { building: "crystal_mine", targetLevel: 2 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows.every(row => row.warnings.join(" ").includes("整批目标还需 4"))).toBe(true);
    expect(applyBuildingTemplate(state, applyRequest(state)).ok).toBe(true);
  });
  it("keeps ordinary mapping and authority keys entirely free of future-level pricing and mutations", () => {
    const state = template(stateWith(), [{ building: "metal_mine", targetLevel: 1000 }]);
    const cost = vi.spyOn(queue, "costFor");
    try {
      const before = JSON.stringify(state);
      for (let i = 0; i < 20; i++) { mapBuildingTemplate(state, 1, state.activePlanetId); buildingTemplateAuthorityKey(state, 1, state.activePlanetId); }
      expect(cost).not.toHaveBeenCalled();
      expect(JSON.stringify(state)).toBe(before);
    } finally { cost.mockRestore(); }
  });
  it("bounds an explicit maximum-size quote and stops each overflowing row early", () => {
    const state = template(stateWith(), BUILDING_IDS.slice(0, 16).map(building => ({ building, targetLevel: 1000 })));
    const cost = vi.spyOn(queue, "costFor");
    try {
      const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
      expect(quote.ok).toBe(false);
      expect(quote.rows.some(row => row.quote === null)).toBe(true);
      expect(cost.mock.calls.length).toBeLessThan(16000);
      expect(cost.mock.calls.length).toBeGreaterThan(0);
    } finally { cost.mockRestore(); }
  });
  it.each(["1e-19", "1e191"])("blocks an unrepresentable per-step price %s", amount => {
    const cost = vi.spyOn(queue, "costFor").mockReturnValue({ metal: big(amount), crystal: big(0), deuterium: big(0) });
    try {
      const state = template(stateWith(), [{ building: "metal_mine", targetLevel: 1 }]);
      const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
      expect(quote.rows[0]!.quote).toBeNull();
      expect(quote.ok).toBe(false);
      expect(applyBuildingTemplate(state, applyRequest(state)).state).toBe(state);
    } finally { cost.mockRestore(); }
  });
  it("accepts the exact 18-place/1e190 boundaries and rejects only the aggregate when rows overflow it", () => {
    const cost = vi.spyOn(queue, "costFor").mockReturnValue({ metal: big("1e190"), crystal: big("1e-18"), deuterium: big(0) });
    try {
      const one = template(stateWith(), [{ building: "metal_mine", targetLevel: 1 }]);
      const quote = quoteBuildingTemplate(one, 1, one.activePlanetId);
      expect(quote.ok).toBe(true);
      expect(quote.totalQuote).toEqual({ metal: normalizeOrderAmount("1e190"), crystal: "0.000000000000000001", deuterium: "0" });
      const two = template(stateWith(), [{ building: "metal_mine", targetLevel: 1 }, crystal]);
      const aggregate = quoteBuildingTemplate(two, 1, two.activePlanetId);
      expect(aggregate.rows.every(row => row.quote !== null)).toBe(true);
      expect(aggregate.totalQuote).toBeNull();
      expect(aggregate.ok).toBe(false);
      expect(aggregate.reason).toContain("合计报价");
    } finally { cost.mockRestore(); }
  });
});
describe("explicit atomic building-template authorization", () => {
  it("creates local fixed-payer tasks with copied partial budgets, targets and no immediate payment", () => {
    const state = template(colony(), [metal, crystal]);
    const request = applyRequest(state, generous, "synthetic-payer");
    request.budgets[0]!.budget = zeroOrderMoney();
    request.budgets[1]!.budget = { metal: "0", crystal: "1e-18", deuterium: "1e190" };
    const before = JSON.stringify(state);
    const result = applyBuildingTemplate(state, request);
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual([1, 2]);
    expect(result.state.orders.tasks[0]).toMatchObject({ kind: "building", building: "metal_mine", targetLevel: 2, planetId: "synthetic-payer", budget: zeroOrderMoney(), transport: null, formationOrigin: null, charged: zeroOrderMoney() });
    expect(result.state.orders.tasks[1]!.budget).toEqual({ metal: "0", crystal: "0.000000000000000001", deuterium: normalizeOrderAmount("1e190") });
    expect(result.state.planets).toBe(state.planets);
    expect(result.state.research).toBe(state.research);
    expect(result.state.fleets).toBe(state.fleets);
    expect(result.state.activePlanetId).toBe(state.activePlanetId);
    request.budgets[1]!.budget.metal = "999";
    state.buildingTemplates.templates[0]!.goals[0]!.targetLevel = 99;
    expect(result.state.orders.tasks[0]).toMatchObject({ targetLevel: 2 });
    expect(result.state.orders.tasks[1]!.budget.metal).toBe("0");
    state.buildingTemplates.templates[0]!.goals[0]!.targetLevel = 2;
    expect(JSON.stringify(state)).toBe(before);
    expect(applyBuildingTemplate(result.state, request).state).toBe(result.state);
  });
  it.each(["", "-1", ".5", "NaN", "Infinity", "1e-19", "1e191", "1e999999999", "9".repeat(257)])("rejects invalid exact budget %s without consuming IDs", amount => {
    const state = template();
    expect(applyBuildingTemplate(state, applyRequest(state, { ...generous, metal: amount })).state).toBe(state);
  });
  it("requires exactly one strict budget record per new goal", () => {
    const state = template(undefined, [metal, crystal]), request = applyRequest(state);
    const invalid = [[], [request.budgets[0]], [request.budgets[0], request.budgets[0]],
      [...request.budgets, { building: "solar_plant", budget: generous }],
      [{ building: "solar_plant", budget: generous }, request.budgets[1]],
      [{ ...request.budgets[0], transport: null }, request.budgets[1]],
      [{ building: "metal_mine", budget: { ...generous, extra: "0" } }, request.budgets[1]], [null, request.budgets[1]], new Array(2)];
    for (const budgets of invalid) {
      const applied = applyBuildingTemplate(state, { ...request, budgets } as BuildingTemplateApplyRequest);
      expect(applied.state).toBe(state);
      expect(applied.createdTaskIds).toEqual([]);
    }
  });
  it("rolls back a prefix if the existing order creator rejects the final row", () => {
    const state = template(undefined, [metal, crystal]), request = applyRequest(state), actual = orders.createOrderTask;
    const creator = vi.spyOn(orders, "createOrderTask").mockImplementation((candidate, input) => input.kind === "building" && input.building === "crystal_mine"
      ? { state: candidate, ok: false, reason: "synthetic final-row rejection" } : actual(candidate, input));
    try {
      const result = applyBuildingTemplate(state, request);
      expect(creator).toHaveBeenCalledTimes(2);
      expect(result.state).toBe(state);
      expect(result.createdTaskIds).toEqual([]);
      expect(state.orders.nextTaskId).toBe(1);
      expect(state.orders.tasks).toHaveLength(0);
    } finally { creator.mockRestore(); }
  });
  it("strict-validates one assembled candidate and rolls back validation failure", () => {
    const state = template(undefined, [metal, crystal]), request = applyRequest(state);
    const reader = vi.spyOn(save, "deserializeState").mockImplementation(() => { throw new Error("synthetic invalid candidate"); });
    try {
      const result = applyBuildingTemplate(state, request);
      expect(reader).toHaveBeenCalledTimes(1);
      expect(result.state).toBe(state);
      expect(result.createdTaskIds).toEqual([]);
      expect(result.reason).toContain("完整性");
    } finally { reader.mockRestore(); }
  });
  it.each([[99, "cancelled"], [31, "running"]] as const)("preflights whole-batch capacity with %s %s records", (count, status) => {
    const state = withDummyOrders(template(undefined, [metal, crystal]), count, status);
    expect(quoteBuildingTemplate(state, 1, state.activePlanetId).ok).toBe(false);
    expect(applyBuildingTemplate(state, applyRequest(state)).state).toBe(state);
  });
  it("issues the final safe IDs together, then leaves the exhausted sentinel unissued", () => {
    const base = template(undefined, [metal, crystal]);
    const state = { ...base, orders: { ...base.orders, nextTaskId: Number.MAX_SAFE_INTEGER - 2 } };
    const result = applyBuildingTemplate(state, applyRequest(state));
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual([Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1]);
    expect(result.state.orders.nextTaskId).toBe(Number.MAX_SAFE_INTEGER);
    for (const nextTaskId of [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
      const short = { ...base, orders: { ...base.orders, nextTaskId } };
      expect(applyBuildingTemplate(short, applyRequest(short)).state).toBe(short);
    }
  });
  it.each(["template-edit", "template-delete", "payer-gone", "world-seed", "world-launch", "coordinates", "building-level", "research-level", "fields", "growth-cut", "new-task", "queue-added"])("retires review on %s", change => {
    const state = template(colony(), [metal, crystal]), request = applyRequest(state);
    const payer = activePlanet(state);
    let changed = state;
    if (change === "template-edit") changed = editBuildingTemplate(state, 1, 1, { name: "changed", goals: [metal, crystal] }).state;
    if (change === "template-delete") changed = deleteBuildingTemplate(state, 1, 1).state;
    if (change === "payer-gone") changed = { ...state, planets: state.planets.filter(planet => planet.id !== request.planetId) };
    if (change === "world-seed") changed = { ...state, universe: { ...state.universe, seed: state.universe.seed ^ 1 } };
    if (change === "world-launch") changed = { ...state, stats: { ...state.stats, launches: state.stats.launches + 1 } };
    if (change === "coordinates") changed = withPlanet(state, { planet: { ...payer, coordinates: { ...payer.coordinates, system: payer.coordinates.system === 1 ? 2 : 1 } } });
    if (change === "building-level") changed = withPlanet(state, { planet: { ...payer, buildings: { ...payer.buildings, robotics_factory: 1 } } });
    if (change === "research-level") changed = withResearch(state, { computer_tech: 1 });
    if (change === "fields") changed = withPlanet(state, { planet: { ...payer, fieldsMax: payer.fieldsMax + 1 } });
    if (change === "growth-cut") changed = { ...state, curvature: { ...state.curvature, growth_cut: 1 } };
    if (change === "new-task") changed = buildingOrder(state, "solar_plant", 1);
    if (change === "queue-added") changed = queue.enqueue(state, "solar_plant", "manual").state;
    expect(buildingTemplateAuthorityKey(changed, 1, request.planetId)).not.toBe(buildingTemplateAuthorityKey(state, 1, request.planetId));
    expect(applyBuildingTemplate(changed, request).state).toBe(changed);
  });
  it("binds local paid-job identity, target, owner, source and exact payment", () => {
    const state = template(queue.enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state);
    const request = applyRequest(state), planet = activePlanet(state), head = planet.buildQueue[0]!;
    for (const patch of [{ jobId: head.jobId + 1 }, { taskId: 999 }, { targetLevel: 2 }, { source: "protocol" as const }, { paid: { ...head.paid, metal: head.paid.metal.add(1) } }]) {
      const changed = withPlanet(state, { planet: { ...planet, buildQueue: [{ ...head, ...patch }] } });
      expect(applyBuildingTemplate(changed, request).state).toBe(changed);
    }
  });
  it("binds relevant task status and ledger and unrelated global record/live capacity", () => {
    const base = template(buildingOrder(stateWith(), "metal_mine", 3), [metal, crystal]);
    const state = buildingOrder(base, "solar_plant", 1), request = applyRequest(state);
    const updates: Array<(task: OrderTask) => OrderTask> = [
      task => task.id === 1 ? { ...task, status: "paused" } : task,
      task => task.id === 1 ? { ...task, budget: { ...task.budget, metal: "999999" } } : task,
      task => task.id === 1 ? { ...task, charged: { ...task.charged, metal: "60" } } : task,
      task => task.id === 1 ? { ...task, refunded: { ...task.refunded, metal: "1" } } : task,
      task => task.id === 2 ? { ...task, status: "cancelled" } : task,
    ];
    for (const update of updates) {
      const changed = { ...state, orders: { ...state.orders, tasks: state.orders.tasks.map(update) } };
      expect(applyBuildingTemplate(changed, request).state).toBe(changed);
    }
    const removed = { ...state, orders: { ...state.orders, tasks: state.orders.tasks.slice(0, 1) } };
    expect(applyBuildingTemplate(removed, request).state).toBe(removed);
  });
  it("retires lab authorization as global research starts or its paid job changes, while countdowns stay stable", () => {
    const state = template(rich(stateWith({ research_lab: 1 }), 1e6), [{ building: "research_lab", targetLevel: 2 }]);
    const request = applyRequest(state);
    const researching = enqueueResearch(state, "energy_tech", "manual").state;
    expect(applyBuildingTemplate(researching, request).state).toBe(researching);
    const nextRequest = applyRequest(researching);
    const countdown = { ...researching, research: { ...researching.research, queue: researching.research.queue.map(job => ({ ...job, remainingSeconds: job.remainingSeconds / 2 })) } };
    expect(quoteBuildingTemplate(countdown, 1, request.planetId).reviewKey).toBe(nextRequest.expectedReviewKey);
    expect(applyBuildingTemplate(countdown, nextRequest).ok).toBe(true);
  });
  it("rejects forged, oversized and unknown-field request authority", () => {
    const state = template(), request = applyRequest(state);
    for (const patch of [{ expectedReviewKey: "forged" }, { expectedReviewKey: "x".repeat(MAX_BUILDING_TEMPLATE_REVIEW_KEY_LENGTH + 1) }, { expectedTemplateRevision: 2 }, { expectedNextTaskId: 2 }, { transport: null }, { templateOrigin: 1 }]) {
      expect(applyBuildingTemplate(state, { ...request, ...patch }).state).toBe(state);
    }
    expect(quoteBuildingTemplate(state, 1, "missing").ok).toBe(false);
  });
  it("keeps review stable across wallet growth, countdowns, reasons, active selection and another planet's builds", () => {
    let state = template(colony(), [metal, crystal]);
    state = queue.enqueue(state, "metal_mine", "manual").state;
    state = buildingOrder(state, "crystal_mine", 1);
    const request = applyRequest(state), key = request.expectedReviewKey;
    let changed = rich(state, 2e6), planet = activePlanet(changed);
    changed = withPlanet(changed, { planet: { ...planet, buildQueue: planet.buildQueue.map(job => ({ ...job, remainingSeconds: job.remainingSeconds / 2 })) } });
    changed = selectPlanet(changed, "synthetic-payer");
    changed = queue.enqueue(changed, "metal_mine", "manual").state;
    changed = { ...changed, totalTime: big(999), orders: { ...changed.orders, accumulator: 4, tasks: changed.orders.tasks.map(task => ({ ...task, reason: "display-only change" })) } };
    expect(quoteBuildingTemplate(changed, 1, request.planetId).reviewKey).toBe(key);
    const applied = applyBuildingTemplate(changed, request);
    expect(applied.ok).toBe(true);
    expect(applied.state.activePlanetId).toBe("synthetic-payer");
    expect(applied.state.orders.tasks.at(-1)!.planetId).toBe(request.planetId);
    expect(applied.state.orders.accumulator).toBe(4);
  });
});
describe("template-created plans retain existing building execution and payments", () => {
  it("can wait on paid manual coverage with zero budget without adopting payment ownership", () => {
    const paid = queue.enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state;
    const state = template(paid, [{ building: "metal_mine", targetLevel: 1 }]);
    expect(quoteBuildingTemplate(state, 1, state.activePlanetId).totalQuote).toEqual(zeroOrderMoney());
    const applied = applyBuildingTemplate(state, applyRequest(state, zeroOrderMoney()));
    expect(applied.ok).toBe(true);
    expect(activePlanet(applied.state).buildQueue[0]).toBe(activePlanet(paid).buildQueue[0]);
    const waiting = orders.advanceOrderPlans(applied.state, 10);
    expect(waiting.orders.tasks[0]).toMatchObject({ activeJob: null, charged: zeroOrderMoney(), budget: zeroOrderMoney(), status: "running" });
    expect(waiting.orders.tasks[0]!.reason).toContain("已有付费建造覆盖目标");
    const completed = orders.runDueOrderPass(queue.completeActive(waiting).state);
    expect(completed.orders.tasks[0]!.status).toBe("completed");
    expect(completed.orders.tasks[0]!.charged).toEqual(zeroOrderMoney());
  });
  it("never raises the authorized zero budget when existing paid coverage is cancelled", () => {
    const paid = queue.enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state;
    const state = template(paid, [{ building: "metal_mine", targetLevel: 1 }]);
    const applied = applyBuildingTemplate(state, applyRequest(state, zeroOrderMoney())).state;
    const cancelled = queue.cancel(applied, 0).state;
    const waiting = orders.runDueOrderPass(cancelled);
    expect(activePlanet(waiting).buildQueue).toHaveLength(0);
    expect(waiting.orders.tasks[0]).toMatchObject({ activeJob: null, budget: zeroOrderMoney(), charged: zeroOrderMoney(), status: "running" });
    expect(waiting.orders.tasks[0]!.reason).toContain("预算");
    expect(waiting.orders.nextJobId).toBe(cancelled.orders.nextJobId);
  });
  it("reprices unpaid coverage after queue cancellation and preserves already-authorized budgets", () => {
    let paid = queue.enqueue(rich(stateWith(), 1e6), "metal_mine", "manual").state;
    paid = queue.enqueue(paid, "metal_mine", "manual").state;
    const state = template(paid, [{ building: "metal_mine", targetLevel: 3 }]);
    const quote = quoteBuildingTemplate(state, 1, state.activePlanetId);
    expect(quote.totalQuote).toEqual({ metal: "135", crystal: "33", deuterium: "0" });
    const request = applyRequest(state, quote.totalQuote!);
    const cancelledReview = queue.cancel(state, 0).state;
    expect(activePlanet(cancelledReview).buildQueue[0]).toMatchObject({ targetLevel: 1 });
    expect(activePlanet(cancelledReview).buildQueue[0]!.paid.metal.toString()).toBe("60");
    expect(applyBuildingTemplate(cancelledReview, request).state).toBe(cancelledReview);
    expect(quoteBuildingTemplate(cancelledReview, 1, state.activePlanetId).totalQuote).toEqual({ metal: "225", crystal: "55", deuterium: "0" });
    const authorized = applyBuildingTemplate(state, request).state;
    const completed = tick(queue.cancel(authorized, 0).state, 120);
    expect(activePlanet(completed).buildings.metal_mine).toBe(2);
    expect(completed.orders.tasks[0]).toMatchObject({ targetLevel: 3, budget: { metal: "135", crystal: "33", deuterium: "0" }, charged: { metal: "90", crystal: "22", deuterium: "0" } });
    expect(completed.orders.tasks[0]!.reason).toContain("预算");
  });
  it("uses the pinned planet on the ten-second pass and retains real queue/prerequisite rules", () => {
    const state = template(colony(), [{ building: "metal_mine", targetLevel: 1 }]);
    const applied = applyBuildingTemplate(state, applyRequest(state, generous, "synthetic-payer")).state;
    const homeMoney = activePlanet(applied).resources;
    const early = orders.advanceOrderPlans(applied, 9);
    expect(early.planets.every(planet => planet.buildQueue.length === 0)).toBe(true);
    const due = orders.advanceOrderPlans(early, 1), other = due.planets.find(planet => planet.id === "synthetic-payer")!;
    expect(due.activePlanetId).toBe(state.activePlanetId);
    expect(activePlanet(due).resources).toBe(homeMoney);
    expect(other.buildQueue[0]).toMatchObject({ source: "plan", taskId: 1, building: "metal_mine", targetLevel: 1 });
    expect(due.orders.tasks[0]!.charged).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
    expect(other.resources.metal.eq(999940)).toBe(true);
  });
  it("pausing preserves paid work and cancelling refunds only its original planet", () => {
    const state = template(colony());
    const paid = orders.runDueOrderPass(applyBuildingTemplate(state, applyRequest(state, generous, "synthetic-payer")).state);
    const paused = orders.pauseOrderTask(paid, 1).state;
    expect(paused.planets).toBe(paid.planets);
    const cancelled = orders.cancelOrderTask(paused, 1);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.orders.tasks[0]).toMatchObject({ status: "cancelled", refunded: { metal: "60", crystal: "15", deuterium: "0" } });
    expect(cancelled.state.planets.find(planet => planet.id === "synthetic-payer")!.resources.metal.eq(1e6)).toBe(true);
    expect(activePlanet(cancelled.state).resources).toBe(activePlanet(state).resources);
  });
  it("template editing/deletion cannot change running goals, their payments or completion", () => {
    const initial = template();
    const paid = orders.runDueOrderPass(applyBuildingTemplate(initial, applyRequest(initial)).state);
    const edited = editBuildingTemplate(paid, 1, 1, { name: "future", goals: [{ building: "metal_mine", targetLevel: 20 }] }).state;
    const deleted = deleteBuildingTemplate(edited, 1, 2).state;
    expect(deleted.orders).toBe(paid.orders);
    expect(deleted.planets).toBe(paid.planets);
    const completed = tick(deleted, 120);
    expect(activePlanet(completed).buildings.metal_mine).toBe(2);
    expect(completed.orders.tasks[0]!.status).toBe("completed");
    expect(completed.orders.tasks[0]!.charged).toEqual({ metal: "150", crystal: "37", deuterium: "0" });
    expect(completed.buildingTemplates.templates).toHaveLength(0);
  });
  it.each(["live", "offline"] as const)("finishes identically in %s large steps and split ticks", mode => {
    const state = template(undefined, [metal, crystal]);
    const authorized = applyBuildingTemplate(state, applyRequest(state)).state;
    const long = tick(authorized, 120, mode);
    let split = authorized;
    for (let i = 0; i < 240; i++) split = tick(split, 0.5, mode);
    expect(activePlanet(long).buildings.metal_mine).toBe(2);
    expect(activePlanet(long).buildings.crystal_mine).toBe(1);
    expect(long.orders.tasks.every(task => task.status === "completed")).toBe(true);
    expect(split.orders).toEqual(long.orders);
    expect(activePlanet(split).buildQueue).toEqual(activePlanet(long).buildQueue);
    expect(activePlanet(split).buildings).toEqual(activePlanet(long).buildings);
    expect(split.buildingTemplates).toEqual(state.buildingTemplates);
  });
});
