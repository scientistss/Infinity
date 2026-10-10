import { describe, expect, it, vi } from "vitest";
import { RESEARCH_IDS, type ResearchId } from "../src/data/research";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { prestige, tick } from "../src/game/logic";
import { addOrderAmounts, normalizeOrderAmount } from "../src/game/order-money";
import { zeroOrderMoney } from "../src/game/order-ledger";
import type { OrderMoney, OrderTask } from "../src/game/order-state";
import * as orders from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import * as research from "../src/game/research";
import {
  MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH, normalizeResearchTemplateDraft,
  type ResearchGoal, type ResearchTemplateAction, type ResearchTemplateApplyRequest, type ResearchTemplateDraft,
} from "../src/game/research-template-state";
import {
  applyResearchTemplate, applyResearchTemplateAction, createResearchTemplate, deleteResearchTemplate,
  editResearchTemplate, mapResearchTemplate, quoteResearchTemplate,
} from "../src/game/research-templates";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

const generous: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const energy: ResearchGoal = { tech: "energy_tech", targetLevel: 2 };
const computer: ResearchGoal = { tech: "computer_tech", targetLevel: 1 };
function template(state = rich(stateWith({ research_lab: 1 }), 1e6), goals: ResearchGoal[] = [energy]): GameState {
  const result = createResearchTemplate(state, { name: "合成研究目标", goals }, state.researchTemplates.nextTemplateId);
  expect(result.ok).toBe(true);
  return result.state;
}
function applyRequest(state: GameState, money: OrderMoney = generous, planetId = state.activePlanetId, templateId = 1): ResearchTemplateApplyRequest {
  const quote = quoteResearchTemplate(state, templateId, planetId);
  return { templateId, expectedTemplateRevision: quote.templateRevision, planetId, expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
    budgets: quote.rows.filter(row => row.status === "new").map(row => ({ tech: row.tech, budget: { ...money } })) };
}
function colony(state = rich(stateWith({ research_lab: 1 }), 1e6)): GameState {
  const extra = createPlanet("synthetic-payer", { galaxy: 1, system: 2, position: 8 });
  extra.buildings.research_lab = 1;
  extra.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  return { ...state, planets: [...state.planets, extra] };
}
function researchOrder(state: GameState, tech: ResearchId = "energy_tech", level = 2, payer = state.activePlanetId): GameState {
  const result = orders.createOrderTask(state, { kind: "research", tech, targetLevel: level, planetId: payer, budget: { ...generous }, expectedNextTaskId: state.orders.nextTaskId });
  expect(result.ok).toBe(true);
  return result.state;
}
function withoutTemplates(state: GameState) { const { researchTemplates: _ignored, ...rest } = state; return rest; }
function withDummyOrders(state: GameState, count: number, status: "running" | "cancelled"): GameState {
  const created = orders.createOrderTask(state, { kind: "building", building: "metal_mine", targetLevel: 1, planetId: state.activePlanetId, budget: generous, expectedNextTaskId: state.orders.nextTaskId }).state.orders.tasks.at(-1)!;
  const tasks: OrderTask[] = Array.from({ length: count }, (_, index) => ({ ...created, id: index + 1, status }));
  return { ...state, orders: { ...state.orders, tasks, nextTaskId: count + 1 } };
}

describe("research templates are bounded pure intent", () => {
  it("creates canonical detached goals and trims names without changing any simulation state", () => {
    const initial = stateWith(), goals: ResearchGoal[] = [{ ...computer }, { ...energy }];
    const draft = { name: "  合成研究  ", goals };
    const saved = createResearchTemplate(initial, draft, 1);
    expect(saved.ok).toBe(true);
    expect(saved.state.researchTemplates).toEqual({ nextTemplateId: 2, templates: [{ id: 1, revision: 1, name: "合成研究", goals: [energy, computer] }] });
    expect(withoutTemplates(saved.state)).toEqual(withoutTemplates(initial));
    expect(saved.state.orders).toBe(initial.orders);
    goals[0]!.targetLevel = 900;
    goals.push({ tech: "laser_tech", targetLevel: 5 });
    draft.name = "changed";
    expect(saved.state.researchTemplates.templates[0]!.goals).toEqual([energy, computer]);
    expect(Object.keys(saved.state.researchTemplates.templates[0]!)).toEqual(["id", "revision", "name", "goals"]);
    expect(createResearchTemplate(saved.state, { name: "duplicate submit", goals: [energy] }, 1).state).toBe(saved.state);
  });
  it("edits only future intent, increments revision and deletes without touching orders, wallets or queues", () => {
    const paid = research.enqueueResearch(rich(stateWith({ research_lab: 1 }), 1e6), "energy_tech", "manual").state;
    const before = researchOrder(template(paid));
    const edited = editResearchTemplate(before, 1, 1, { name: "新意图", goals: [{ tech: "energy_tech", targetLevel: 9 }] });
    expect(edited.ok).toBe(true);
    expect(edited.state.researchTemplates.templates[0]!.revision).toBe(2);
    expect(withoutTemplates(edited.state)).toEqual(withoutTemplates(before));
    expect(edited.state.orders).toBe(before.orders);
    expect(editResearchTemplate(edited.state, 1, 1, { name: "stale", goals: [energy] }).state).toBe(edited.state);
    expect(deleteResearchTemplate(edited.state, 1, 1).state).toBe(edited.state);
    const removed = deleteResearchTemplate(edited.state, 1, 2);
    expect(removed.ok).toBe(true);
    expect(removed.state.researchTemplates).toEqual({ nextTemplateId: 2, templates: [] });
    expect(withoutTemplates(removed.state)).toEqual(withoutTemplates(before));
    expect(createResearchTemplate(removed.state, { name: "new", goals: [energy] }, 2).state.researchTemplates.templates[0]!.id).toBe(2);
  });
  it("accepts same names, all sixteen goals, 64 Unicode code points and endpoint levels", () => {
    const name = "🚀".repeat(64), goals = RESEARCH_IDS.map(tech => ({ tech, targetLevel: 1000 }));
    const a = createResearchTemplate(stateWith(), { name, goals }, 1);
    expect(a.ok).toBe(true);
    expect(a.state.researchTemplates.templates[0]!.name).toBe(name);
    expect(createResearchTemplate(a.state, { name, goals: [{ tech: "energy_tech", targetLevel: 1 }] }, 2).ok).toBe(true);
  });
  it.each([
    null, {}, { name: "", goals: [energy] }, { name: "   ", goals: [energy] }, { name: "x".repeat(65), goals: [energy] },
    { name: "🚀".repeat(65), goals: [energy] }, { name: "a\nb", goals: [energy] }, { name: "\u0085", goals: [energy] },
    { name: "\0x", goals: [energy] }, { name: "x", goals: [] }, { name: "x", goals: Array(17).fill(energy) },
    { name: "x", goals: [energy, energy] }, { name: "x", goals: [{ tech: "unknown", targetLevel: 1 }] },
    { name: "x", goals: [{ tech: "energy_tech", targetLevel: 0 }] }, { name: "x", goals: [{ tech: "energy_tech", targetLevel: 1.5 }] },
    { name: "x", goals: [{ tech: "energy_tech", targetLevel: 1001 }] }, { name: "x", goals: [{ tech: "energy_tech", targetLevel: Infinity }] },
    { name: "x", goals: [{ tech: "energy_tech", targetLevel: "1" }] }, { name: "x", goals: [null] },
    { name: "x", goals: [energy], budget: generous }, { name: "x", goals: [energy], planetId: "synthetic-payer" },
    { name: "x", goals: [energy], runId: 1 }, { name: "x", goals: [{ ...energy, taskId: 1 }] },
    { name: "x", goals: [{ ...energy, budget: generous }] }, { name: "x", goals: new Array(2) },
  ])("rejects malformed or authorization-bearing draft %j without allocating IDs", draft => {
    const state = stateWith();
    expect(normalizeResearchTemplateDraft(draft)).toBeNull();
    const result = createResearchTemplate(state, draft as ResearchTemplateDraft, 1);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
  });
  it("rejects inherited, symbolic and non-record draft properties", () => {
    const drafts = [Object.assign(Object.create({ authority: true }), { name: "x", goals: [energy] }), { name: "x", goals: [energy], [Symbol("payer")]: "x" }];
    for (const draft of drafts) expect(normalizeResearchTemplateDraft(draft)).toBeNull();
  });
  it("enforces the 32-template cap and monotonic safe ID and revision exhaustion", () => {
    let state = stateWith();
    for (let i = 1; i <= 32; i++) state = createResearchTemplate(state, { name: "same", goals: [energy] }, i).state;
    expect(state.researchTemplates.templates).toHaveLength(32);
    expect(createResearchTemplate(state, { name: "full", goals: [energy] }, 33).state).toBe(state);
    const max = Number.MAX_SAFE_INTEGER;
    const last = { ...stateWith(), researchTemplates: { nextTemplateId: max - 1, templates: [] } };
    const issued = createResearchTemplate(last, { name: "last", goals: [energy] }, max - 1).state;
    expect(issued.researchTemplates.nextTemplateId).toBe(max);
    expect(createResearchTemplate(issued, { name: "overflow", goals: [energy] }, max).state).toBe(issued);
    const nearRevision = { ...issued, researchTemplates: { ...issued.researchTemplates, templates: issued.researchTemplates.templates.map(value => ({ ...value, revision: max - 1 })) } };
    const finalRevision = editResearchTemplate(nearRevision, max - 1, max - 1, { name: "final", goals: [energy] }).state;
    expect(finalRevision.researchTemplates.templates[0]!.revision).toBe(max);
    expect(editResearchTemplate(finalRevision, max - 1, max, { name: "exhausted", goals: [energy] }).state).toBe(finalRevision);
    expect(deleteResearchTemplate(finalRevision, max - 1, max).ok).toBe(true);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("rejects unsafe template identity %s", id => {
    const state = template();
    expect(editResearchTemplate(state, id, 1, { name: "x", goals: [energy] }).state).toBe(state);
    expect(deleteResearchTemplate(state, id, 1).state).toBe(state);
    expect(quoteResearchTemplate(state, id, state.activePlanetId).ok).toBe(false);
  });
  it("preserves detached templates and counters on real prestige, while a new game is empty", () => {
    let state = template();
    state = { ...state, lifetime: { metal: big(1e12), crystal: big(1e12), deuterium: big(1e12) } };
    const launched = prestige(state);
    expect(launched.stats.launches).toBe(state.stats.launches + 1);
    expect(launched.researchTemplates).toEqual(state.researchTemplates);
    expect(launched.researchTemplates).not.toBe(state.researchTemplates);
    expect(launched.researchTemplates.templates[0]!.goals[0]).not.toBe(state.researchTemplates.templates[0]!.goals[0]);
    expect(createInitialState().researchTemplates).toEqual({ nextTemplateId: 1, templates: [] });
  });
  it("dispatcher follows the shared action union and rejects extra authorization fields", () => {
    const state = stateWith();
    const result = applyResearchTemplateAction(state, { type: "research-template-create", draft: { name: "x", goals: [energy] }, expectedNextTemplateId: 1 });
    expect(result.ok).toBe(true);
    expect(applyResearchTemplateAction(state, { type: "research-template-create", draft: { name: "x", goals: [energy] }, expectedNextTemplateId: 1, payer: "x" } as unknown as ResearchTemplateAction).state).toBe(state);
    expect(applyResearchTemplateAction(state, { type: "unknown" } as unknown as ResearchTemplateAction).state).toBe(state);
  });
});

describe("research template mapping and exact quotes", () => {
  it("maps completed levels from reality rather than cancelled or completed historical plans", () => {
    let state = template(researchOrder(stateWith(), "energy_tech", 1));
    state = orders.cancelOrderTask(state, 1).state;
    expect(mapResearchTemplate(state, 1, state.activePlanetId).rows[0]!.status).toBe("new");
    const completedHistory = { ...state, orders: { ...state.orders, tasks: state.orders.tasks.map(task => ({ ...task, status: "completed" as const })) } };
    expect(mapResearchTemplate(completedHistory, 1, state.activePlanetId).rows[0]!.status).toBe("new");
    const real = withResearch(state, { energy_tech: 2 });
    expect(mapResearchTemplate(real, 1, real.activePlanetId).rows[0]!.status).toBe("achieved");
    expect(quoteResearchTemplate(real, 1, real.activePlanetId).newCount).toBe(0);
    expect(applyResearchTemplate(real, applyRequest(real)).state).toBe(real);
    const dismissed = orders.dismissOrderTask(state, 1).state;
    expect(mapResearchTemplate(dismissed, 1, dismissed.activePlanetId).rows[0]!.status).toBe("new");
  });
  it.each(["running", "paused"] as const)("maps a %s higher goal across payers without changing old authorization", status => {
    let state = template(colony(rich(stateWith({ research_lab: 1 }), 1e6)), [energy, computer]);
    state = researchOrder(state, "energy_tech", 3);
    if (status === "paused") state = orders.pauseOrderTask(state, 1).state;
    const original = state.orders.tasks[0]!;
    const mapping = mapResearchTemplate(state, 1, "synthetic-payer");
    expect(mapping.rows[0]).toMatchObject({ status: "covered", existingTask: { id: 1, planetId: state.activePlanetId, targetLevel: 3, status } });
    const applied = applyResearchTemplate(state, applyRequest(state, zeroOrderMoney(), "synthetic-payer"));
    expect(applied.ok).toBe(true);
    expect(applied.createdTaskIds).toEqual([2]);
    expect(applied.state.orders.tasks[0]).toBe(original);
    expect(applied.state.orders.tasks[1]!.planetId).toBe("synthetic-payer");
    expect(applied.state.orders.tasks[1]!.transport).toBeNull();
  });
  it("keeps paused transport research coverage tied to its original payer and transport authorization", () => {
    let state = template(colony(withResearch(rich(stateWith({ research_lab: 1 }), 1e6), { combustion_drive: 2 })), [energy, computer]);
    const created = orders.createOrderTask(state, { kind: "research", tech: "energy_tech", targetLevel: 3, planetId: "synthetic-payer", budget: generous, expectedNextTaskId: 1,
      transport: { donorPlanetId: state.activePlanetId, ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 2, grossCargoCap: generous } });
    expect(created.ok).toBe(true);
    state = orders.pauseOrderTask(created.state, 1).state;
    const original = state.orders.tasks[0]!;
    const mapped = mapResearchTemplate(state, 1, state.activePlanetId).rows[0]!;
    expect(mapped.existingTask).toMatchObject({ planetId: "synthetic-payer", status: "paused", hasTransport: true });
    const applied = applyResearchTemplate(state, applyRequest(state));
    expect(applied.ok).toBe(true);
    expect(applied.state.orders.tasks[0]).toBe(original);
    expect(applied.state.fleets).toBe(state.fleets);
  });
  it("blocks a lower active target for the entire batch without a prefix task or ID loss", () => {
    const state = template(researchOrder(stateWith(), "computer_tech", 1), [energy, { tech: "computer_tech", targetLevel: 2 }]);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.rows.map(row => row.status)).toEqual(["new", "conflict"]);
    expect(quote.ok).toBe(false);
    const result = applyResearchTemplate(state, applyRequest(state));
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.createdTaskIds).toEqual([]);
    expect(state.orders.nextTaskId).toBe(2);
  });
  it("excludes already-paid research from exact level-by-level quotations", () => {
    const initial = rich(stateWith({ research_lab: 1 }), 1e6);
    const paid = research.enqueueResearch(initial, "energy_tech", "manual").state;
    const state = template(paid);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.rows[0]).toMatchObject({ status: "new", currentLevel: 0, nextUnpaidLevel: 2, quote: { metal: "0", crystal: "1600", deuterium: "800" } });
    expect(quote.rows[0]!.paidJobs[0]).toMatchObject({ jobId: paid.research.queue[0]!.jobId, taskId: null, source: "manual", targetLevel: 1, planetId: initial.activePlanetId });
    expect(quote.totalQuote).toEqual({ metal: "0", crystal: "1600", deuterium: "800" });
    expect(state.research).toBe(paid.research);
  });
  it("uses astrophysics per-level rounding rather than a geometric shortcut", () => {
    const state = template(stateWith(), [{ tech: "astrophysics", targetLevel: 4 }]);
    const quoted = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quoted.totalQuote).toEqual({ metal: "44700", crystal: "89400", deuterium: "44700" });
  });
  it("retains locked goals and exposes real prerequisites without adding research or buildings", () => {
    const state = template(stateWith(), [{ tech: "plasma_tech", targetLevel: 1 }]);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.warnings.join(" ")).toContain("需要");
    const applied = applyResearchTemplate(state, applyRequest(state));
    expect(applied.state.orders.tasks).toHaveLength(1);
    expect(applied.state.orders.tasks[0]).toMatchObject({ kind: "research", tech: "plasma_tech" });
    const waiting = orders.runDueOrderPass(applied.state);
    expect(waiting.research.queue).toHaveLength(0);
    expect(activePlanet(waiting).buildQueue).toHaveLength(0);
    expect(waiting.orders.tasks[0]!.reason).toContain("需要");
  });
  it("permits actual zero-price graviton goals while showing their energy prerequisite", () => {
    const state = template(stateWith({ research_lab: 12 }), [{ tech: "graviton_tech", targetLevel: 1 }]);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.totalQuote).toEqual(zeroOrderMoney());
    expect(quote.rows[0]!.warnings.join(" ")).toContain("能源");
    const applied = applyResearchTemplate(state, applyRequest(state, zeroOrderMoney()));
    const waiting = orders.runDueOrderPass(applied.state);
    expect(waiting.research.queue).toHaveLength(0);
    expect(waiting.orders.tasks[0]!.reason).toContain("能源");
  });
  it("keeps large intent but blocks prices outside the exact amount range", () => {
    const state = template(stateWith(), [{ tech: "energy_tech", targetLevel: 1000 }]);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(false);
    expect(quote.rows[0]!.quote).toBeNull();
    expect(quote.reason).toContain("精确");
    expect(applyResearchTemplate(state, applyRequest(state)).state).toBe(state);
    expect(state.researchTemplates.templates[0]!.goals[0]!.targetLevel).toBe(1000);
  });
  it("adds large representable step prices as decimal strings without Number summation", () => {
    const state = template(stateWith(), [{ tech: "energy_tech", targetLevel: 100 }]);
    let expected = "0";
    for (let level = 1; level <= 100; level++) expected = addOrderAmounts(expected, research.researchCostFor("energy_tech", level).crystal.toString())!;
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.quote!.crystal).toBe(expected);
  });
  it("blocks an aggregate quote overflow even if every individual goal is representable", () => {
    const cost = vi.spyOn(research, "researchCostFor").mockReturnValue({ metal: big("7e189"), crystal: big(0), deuterium: big(0) });
    try {
      const state = template(stateWith(), [{ tech: "energy_tech", targetLevel: 1 }, computer]);
      const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
      expect(quote.rows.every(row => row.quote !== null)).toBe(true);
      expect(quote.totalQuote).toBeNull();
      expect(quote.ok).toBe(false);
      expect(applyResearchTemplate(state, applyRequest(state)).state).toBe(state);
    } finally { cost.mockRestore(); }
  });
  it("lightweight mapping does not quote future levels or mutate the simulation", () => {
    const state = template(stateWith(), [{ tech: "energy_tech", targetLevel: 1000 }]);
    const cost = vi.spyOn(research, "researchCostFor");
    try {
      const before = JSON.stringify(state);
      for (let i = 0; i < 20; i++) mapResearchTemplate(state, 1, state.activePlanetId);
      expect(cost).not.toHaveBeenCalled();
      expect(JSON.stringify(state)).toBe(before);
    } finally { cost.mockRestore(); }
  });
});

describe("explicit atomic research template authorization", () => {
  it("creates exactly N local fixed-payer tasks with independent copied budgets and no payment", () => {
    const state = template(colony(), [energy, computer]);
    const request = applyRequest(state, generous, "synthetic-payer");
    request.budgets[1]!.budget = { metal: "0", crystal: "1e-18", deuterium: "1e190" };
    const result = applyResearchTemplate(state, request);
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual([1, 2]);
    expect(result.state.orders.nextTaskId).toBe(3);
    expect(result.state.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(result.state.orders.nextWorkId).toBe(state.orders.nextWorkId);
    expect(result.state.planets).toBe(state.planets);
    expect(result.state.research).toBe(state.research);
    expect(result.state.fleets).toBe(state.fleets);
    expect(result.state.totalTime).toBe(state.totalTime);
    expect(result.state.researchTemplates).toBe(state.researchTemplates);
    for (const task of result.state.orders.tasks) expect(task).toMatchObject({ planetId: "synthetic-payer", transport: null, activeJob: null, charged: zeroOrderMoney(), refunded: zeroOrderMoney() });
    expect(result.state.orders.tasks[1]!.budget).toEqual({ metal: "0", crystal: "0.000000000000000001", deuterium: normalizeOrderAmount("1e190") });
    request.budgets[0]!.budget.crystal = "0";
    expect(result.state.orders.tasks[0]!.budget.crystal).toBe("1000000");
    expect(applyResearchTemplate(result.state, request).state).toBe(result.state);
  });
  it.each(["missing", "extra", "duplicate", "foreign", "invalid-last", "extra-money-key", "extra-entry-key"])("rolls back %s budgets before creating any prefix", variant => {
    const state = template(undefined, [energy, computer]), request = applyRequest(state);
    if (variant === "missing") request.budgets.pop();
    if (variant === "extra") request.budgets.push({ tech: "laser_tech", budget: generous });
    if (variant === "duplicate") request.budgets[1] = { tech: "energy_tech", budget: generous };
    if (variant === "foreign") request.budgets[1] = { tech: "laser_tech", budget: generous };
    if (variant === "invalid-last") request.budgets[1]!.budget = { ...generous, metal: "1e191" };
    if (variant === "extra-money-key") request.budgets[1]!.budget = { ...generous, transport: true } as unknown as OrderMoney;
    if (variant === "extra-entry-key") request.budgets[1] = { ...request.budgets[1]!, payer: "unexpected" } as typeof request.budgets[number];
    const result = applyResearchTemplate(state, request);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.createdTaskIds).toEqual([]);
  });
  it.each(["1e-19", "9".repeat(257), "1e191", "NaN", "Infinity", "-1", ".5", "1e999999999"])("rejects malformed exact budget %s without ID consumption", amount => {
    const state = template(), request = applyRequest(state, { ...generous, metal: amount });
    expect(applyResearchTemplate(state, request).state).toBe(state);
  });
  it("returns the original state if the existing order creator rejects the last candidate", () => {
    const state = template(undefined, [energy, computer]), request = applyRequest(state), actual = orders.createOrderTask;
    const creator = vi.spyOn(orders, "createOrderTask").mockImplementation((candidate, input) => input.kind === "research" && input.tech === "computer_tech"
      ? { state: candidate, ok: false, reason: "synthetic final-candidate rejection" } : actual(candidate, input));
    try {
      const result = applyResearchTemplate(state, request);
      expect(creator).toHaveBeenCalledTimes(2);
      expect(result.state).toBe(state);
      expect(result.createdTaskIds).toEqual([]);
      expect(state.orders.nextTaskId).toBe(1);
      expect(state.orders.tasks).toHaveLength(0);
    } finally { creator.mockRestore(); }
  });
  it.each([[99, "cancelled"], [31, "running"]] as const)("preflights all slots at %s %s records", (count, status) => {
    const state = withDummyOrders(template(undefined, [energy, computer]), count, status);
    const result = applyResearchTemplate(state, applyRequest(state));
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
  });
  it("issues the last two safe IDs atomically but never issues the exhausted sentinel", () => {
    const base = template(undefined, [energy, computer]);
    const state = { ...base, orders: { ...base.orders, nextTaskId: Number.MAX_SAFE_INTEGER - 2 } };
    const applied = applyResearchTemplate(state, applyRequest(state));
    expect(applied.ok).toBe(true);
    expect(applied.createdTaskIds).toEqual([Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1]);
    expect(applied.state.orders.nextTaskId).toBe(Number.MAX_SAFE_INTEGER);
    const short = { ...base, orders: { ...base.orders, nextTaskId: Number.MAX_SAFE_INTEGER - 1 } };
    expect(applyResearchTemplate(short, applyRequest(short)).state).toBe(short);
  });
  it.each(["template-edit", "template-delete", "payer-gone", "new-task", "world-launch", "finished-level", "queue-added", "queue-cancelled", "queue-completed", "covered-paused"])("invalidates a review after %s", change => {
    let state = template(colony(rich(stateWith({ research_lab: 1 }), 1e6)), [energy, computer]);
    if (["queue-cancelled", "queue-completed"].includes(change)) state = research.enqueueResearch(state, "energy_tech", "manual").state;
    if (change === "covered-paused") state = researchOrder(state, "energy_tech", 2);
    const request = applyRequest(state, generous, "synthetic-payer");
    let changed = state;
    if (change === "template-edit") changed = editResearchTemplate(state, 1, 1, { name: "edited", goals: [energy, computer] }).state;
    if (change === "template-delete") changed = deleteResearchTemplate(state, 1, 1).state;
    if (change === "payer-gone") changed = { ...state, planets: state.planets.filter(planet => planet.id !== "synthetic-payer") };
    if (change === "new-task") changed = orders.createOrderTask(state, { kind: "building", building: "metal_mine", targetLevel: 1, planetId: state.activePlanetId, budget: generous, expectedNextTaskId: state.orders.nextTaskId }).state;
    if (change === "world-launch") changed = { ...state, stats: { ...state.stats, launches: state.stats.launches + 1 } };
    if (change === "finished-level") changed = withResearch(state, { energy_tech: 1 });
    if (change === "queue-added") changed = research.enqueueResearch(state, "energy_tech", "manual").state;
    if (change === "queue-cancelled") changed = research.cancelResearch(state, 0).state;
    if (change === "queue-completed") changed = research.completeActiveResearch(state).state;
    if (change === "covered-paused") changed = orders.pauseOrderTask(state, 1).state;
    const result = applyResearchTemplate(changed, request);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(changed);
  });
  it("invalidates on paid-job identity, payer, source and price changes even with the same queue target", () => {
    const state = template(research.enqueueResearch(rich(stateWith({ research_lab: 1 }), 1e6), "energy_tech", "manual").state);
    const request = applyRequest(state), head = state.research.queue[0]!;
    for (const patch of [{ jobId: head.jobId + 1 }, { planetId: "different" }, { source: "protocol" as const }, { paid: { ...head.paid, crystal: head.paid.crystal.add(1) } }]) {
      const changed = { ...state, research: { ...state.research, queue: [{ ...head, ...patch }] } };
      expect(applyResearchTemplate(changed, request).state).toBe(changed);
    }
  });
  it("rejects forged, oversized and unknown-field requests", () => {
    const state = template(), original = applyRequest(state);
    for (const patch of [{ expectedReviewKey: "forged" }, { expectedReviewKey: "x".repeat(MAX_RESEARCH_TEMPLATE_REVIEW_KEY_LENGTH + 1) }, { expectedNextTaskId: 2 }, { expectedTemplateRevision: 2 }, { transport: { enabled: true } }]) {
      const result = applyResearchTemplate(state, { ...original, ...patch });
      expect(result.state).toBe(state);
    }
  });
  it("keeps review valid through inventory growth, countdowns, scheduler reasons and selected planet changes", () => {
    let state = template(colony(rich(stateWith({ research_lab: 1 }), 1e6)), [energy, computer]);
    state = research.enqueueResearch(state, "energy_tech", "manual").state;
    state = researchOrder(state, "computer_tech", 1);
    const request = applyRequest(state), key = request.expectedReviewKey;
    let changed = research.withResearchRemaining(state, state.research.queue[0]!.remainingSeconds / 2);
    changed = selectPlanet(rich(changed, 2e6), "synthetic-payer");
    changed = { ...changed, totalTime: big(999), orders: { ...changed.orders, accumulator: 4, tasks: changed.orders.tasks.map(task => ({ ...task, reason: "changing display status" })) } };
    expect(quoteResearchTemplate(changed, 1, request.planetId).reviewKey).toBe(key);
    const result = applyResearchTemplate(changed, request);
    expect(result.ok).toBe(true);
    expect(result.state.activePlanetId).toBe("synthetic-payer");
    expect(result.state.orders.accumulator).toBe(4);
    expect(result.state.orders.tasks.at(-1)!.planetId).toBe(request.planetId);
  });
});

describe("template-created plans reuse real research execution", () => {
  it("creates zero-budget finite intent over a paid manual job without adopting its receipt or payment", () => {
    const initial = research.enqueueResearch(rich(stateWith({ research_lab: 1 }), 1e6), "energy_tech", "manual").state;
    const state = template(initial, [{ tech: "energy_tech", targetLevel: 1 }]);
    const quote = quoteResearchTemplate(state, 1, state.activePlanetId);
    expect(quote.ok).toBe(true);
    expect(quote.rows[0]!.status).toBe("new");
    expect(quote.totalQuote).toEqual(zeroOrderMoney());
    const applied = applyResearchTemplate(state, applyRequest(state, zeroOrderMoney()));
    expect(applied.ok).toBe(true);
    expect(applied.state.research.queue[0]).toBe(initial.research.queue[0]);
    const waiting = orders.advanceOrderPlans(applied.state, 10);
    expect(waiting.orders.tasks[0]).toMatchObject({ activeJob: null, charged: zeroOrderMoney(), budget: zeroOrderMoney(), status: "running" });
    expect(waiting.orders.tasks[0]!.reason).toContain("已有付费研究覆盖目标");
    const completed = orders.runDueOrderPass(research.completeActiveResearch(waiting).state);
    expect(completed.orders.tasks[0]!.status).toBe("completed");
    expect(completed.orders.tasks[0]!.charged).toEqual(zeroOrderMoney());
  });
  it("waits for the expressly authorized zero budget when old paid coverage is cancelled", () => {
    const paid = research.enqueueResearch(rich(stateWith({ research_lab: 1 }), 1e6), "energy_tech", "manual").state;
    const state = template(paid, [{ tech: "energy_tech", targetLevel: 1 }]);
    const applied = applyResearchTemplate(state, applyRequest(state, zeroOrderMoney())).state;
    const cancelled = research.cancelResearch(applied, 0).state;
    const waiting = orders.runDueOrderPass(cancelled);
    expect(waiting.research.queue).toHaveLength(0);
    expect(waiting.orders.tasks[0]).toMatchObject({ activeJob: null, budget: zeroOrderMoney(), charged: zeroOrderMoney(), status: "running" });
    expect(waiting.orders.tasks[0]!.reason).toContain("预算");
    expect(waiting.orders.nextJobId).toBe(cancelled.orders.nextJobId);
    expect(waiting.planets).toBe(cancelled.planets);
  });
  it("pays only after the ten-second pass from the fixed planet and real lab regardless of selection", () => {
    const state = template(colony(), [{ tech: "energy_tech", targetLevel: 1 }]);
    const applied = applyResearchTemplate(state, applyRequest(state, generous, "synthetic-payer")).state;
    const homeMoney = activePlanet(applied).resources;
    const selected = selectPlanet(applied, state.activePlanetId);
    const early = orders.advanceOrderPlans(selected, 9);
    expect(early.research.queue).toHaveLength(0);
    const due = orders.advanceOrderPlans(early, 1);
    expect(due.activePlanetId).toBe(state.activePlanetId);
    expect(activePlanet(due).resources).toBe(homeMoney);
    expect(due.research.queue[0]).toMatchObject({ planetId: "synthetic-payer", source: "plan", taskId: 1, tech: "energy_tech", targetLevel: 1 });
    expect(due.orders.tasks[0]!.charged).toEqual({ metal: "0", crystal: "800", deuterium: "400" });
    expect(due.planets.find(planet => planet.id === "synthetic-payer")!.resources.crystal.eq(big(1e6).sub(800))).toBe(true);
    const labless = { ...state, planets: state.planets.map(planet => planet.id === "synthetic-payer" ? { ...planet, buildings: { ...planet.buildings, research_lab: 0 } } : planet) };
    const waiting = orders.runDueOrderPass(applyResearchTemplate(labless, applyRequest(labless, generous, "synthetic-payer")).state);
    expect(waiting.research.queue).toHaveLength(0);
    expect(waiting.orders.tasks[0]!.reason).toContain("研究实验室");
  });
  it("pause retains paid research and cancel refunds the real original payer", () => {
    const state = template(colony(), [{ tech: "energy_tech", targetLevel: 2 }]);
    const paid = orders.runDueOrderPass(applyResearchTemplate(state, applyRequest(state, generous, "synthetic-payer")).state);
    const paused = orders.pauseOrderTask(paid, 1).state;
    expect(paused.research).toBe(paid.research);
    expect(paused.research.queue).toHaveLength(1);
    const cancelled = orders.cancelOrderTask(paused, 1);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.research.queue).toHaveLength(0);
    expect(cancelled.state.orders.tasks[0]).toMatchObject({ status: "cancelled", refunded: { metal: "0", crystal: "800", deuterium: "400" } });
    expect(cancelled.state.planets.find(planet => planet.id === "synthetic-payer")!.resources.crystal.eq(1e6)).toBe(true);
    expect(activePlanet(cancelled.state).resources).toBe(activePlanet(state).resources);
  });
  it("editing and deleting the template does not drift running targets or their payments", () => {
    const initial = template(undefined, [{ tech: "energy_tech", targetLevel: 2 }]);
    const paid = orders.runDueOrderPass(applyResearchTemplate(initial, applyRequest(initial)).state);
    const edited = editResearchTemplate(paid, 1, 1, { name: "future", goals: [{ tech: "energy_tech", targetLevel: 20 }] }).state;
    const deleted = deleteResearchTemplate(edited, 1, 2).state;
    expect(deleted.orders).toBe(paid.orders);
    expect(deleted.research).toBe(paid.research);
    const completed = tick(deleted, 120);
    expect(completed.research.levels.energy_tech).toBe(2);
    expect(completed.orders.tasks[0]!.status).toBe("completed");
    expect(completed.orders.tasks[0]!.charged).toEqual({ metal: "0", crystal: "2400", deuterium: "1200" });
    expect(completed.researchTemplates.templates).toHaveLength(0);
  });
  it.each(["live", "offline"] as const)("has matching real finite completion in %s catch-up and split ticks", mode => {
    const state = template(undefined, [energy, computer]);
    const authorized = applyResearchTemplate(state, applyRequest(state)).state;
    const long = tick(authorized, 120, mode);
    let split = authorized;
    for (let i = 0; i < 240; i++) split = tick(split, 0.5, mode);
    expect(long.research.levels.energy_tech).toBe(2);
    expect(long.research.levels.computer_tech).toBe(1);
    expect(long.orders.tasks.every(task => task.status === "completed")).toBe(true);
    expect(split.orders).toEqual(long.orders);
    expect(split.research).toEqual(long.research);
    expect(split.researchTemplates).toEqual(state.researchTemplates);
  });
});
