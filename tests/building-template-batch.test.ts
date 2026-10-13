import { describe, expect, it, vi } from "vitest";
import { BUILDING_IDS, type BuildingId } from "../src/data/buildings";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import {
  applyBuildingTemplateBatch, applyBuildingTemplateBatchAction, buildingTemplateBatchAuthorityKey, quoteBuildingTemplateBatch,
} from "../src/game/building-template-batch";
import {
  MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH,
  type BuildingTemplateBatchAction, type BuildingTemplateBatchRequest,
} from "../src/game/building-template-batch-state";
import type { BuildingGoal } from "../src/game/building-template-state";
import { createBuildingTemplate, deleteBuildingTemplate, editBuildingTemplate } from "../src/game/building-templates";
import { zeroOrderMoney } from "../src/game/order-ledger";
import { normalizeOrderAmount } from "../src/game/order-money";
import type { OrderMoney, OrderTask } from "../src/game/order-state";
import * as orders from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import * as queue from "../src/game/queue";
import * as save from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const generous: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
const metal: BuildingGoal = { building: "metal_mine", targetLevel: 2 };
const crystal: BuildingGoal = { building: "crystal_mine", targetLevel: 1 };

/** Independent synthetic API fixture; no historical files, reports or imported saves. */
function fixture(count = 2, goals: BuildingGoal[] = [metal]): GameState {
  const initial = createInitialState(7341, 29);
  const extras = Array.from({ length: count - 1 }, (_, index) => createPlanet(`batch-synthetic-${index + 1}`, { galaxy: 1, system: 1 + index, position: 8 }));
  const state = { ...initial, planets: [...initial.planets, ...extras].map(planet => ({ ...planet,
    resources: { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) } })) };
  const result = createBuildingTemplate(state, { name: "独立合成批量目标", goals }, 1);
  expect(result.ok).toBe(true);
  return result.state;
}
function ids(state: GameState): string[] { return state.planets.map(planet => planet.id); }
function requestFor(state: GameState, selected = ids(state), money: OrderMoney = generous): BuildingTemplateBatchRequest {
  const quote = quoteBuildingTemplateBatch(state, 1, selected);
  return { templateId: 1, expectedTemplateRevision: quote.templateRevision, expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
    planets: quote.planets.map(({ planetId, quote: local }) => ({ planetId, budgets: local.rows.filter(row => row.status === "new")
      .map(row => ({ building: row.building, budget: { ...money } })) })) };
}
function order(state: GameState, planetId: string, building: BuildingId = "metal_mine", targetLevel = 2): GameState {
  const result = orders.createOrderTask(state, { kind: "building", planetId, building, targetLevel, budget: generous, expectedNextTaskId: state.orders.nextTaskId });
  expect(result.ok).toBe(true);
  return result.state;
}
function paid(state: GameState, planetId: string, building: BuildingId = "metal_mine", source: "manual" | "protocol" = "manual"): GameState {
  const result = queue.enqueue(selectPlanet(state, planetId), building, source);
  expect(result.ok).toBe(true);
  return selectPlanet(result.state, state.activePlanetId);
}
function assertRejected(state: GameState, request: unknown): void {
  const bytes = JSON.stringify(save.serializeState(state));
  const result = applyBuildingTemplateBatch(state, request as BuildingTemplateBatchRequest);
  expect(result.ok).toBe(false);
  expect(result.state).toBe(state);
  expect(result.createdTaskIds).toEqual([]);
  expect(JSON.stringify(save.serializeState(state))).toBe(bytes);
}
function achieved(state: GameState): GameState {
  return { ...state, planets: state.planets.map(planet => ({ ...planet, buildings: { ...planet.buildings, metal_mine: 2 } })) };
}
function fillRecords(state: GameState, count: number, status: "live" | "cancelled"): GameState {
  let next = state;
  for (let index = 0; index < count; index++) {
    const choices = BUILDING_IDS.filter(building => building !== "metal_mine" && building !== "crystal_mine");
    const building = choices[index % choices.length]!;
    const planetId = state.planets[Math.floor(index / choices.length) % state.planets.length]!.id;
    next = order(next, planetId, building, 1);
    if (status === "cancelled") next = orders.cancelOrderTask(next, next.orders.tasks.at(-1)!.id).state;
  }
  return next;
}

describe("atomic explicit 2–4 planet building-template quotes", () => {
  it("uses independent floor-by-floor golden prices for each payer and a display-only total", () => {
    let state = fixture(2, [{ building: "metal_mine", targetLevel: 3 }, { building: "crystal_mine", targetLevel: 2 }, { building: "solar_plant", targetLevel: 3 }]);
    state = { ...state, planets: state.planets.map((planet, index) => index === 0 ? planet : { ...planet,
      buildings: { ...planet.buildings, metal_mine: 1, crystal_mine: 1, solar_plant: 2 } }) };
    const before = JSON.stringify(save.serializeState(state));
    const quote = quoteBuildingTemplateBatch(state, 1, ids(state));
    expect(quote.ok).toBe(true);
    expect(quote.newCount).toBe(6);
    expect(quote.planets[0]!.quote.rows.map(row => row.quote)).toEqual([
      { metal: "285", crystal: "70", deuterium: "0" }, { metal: "124", crystal: "62", deuterium: "0" }, { metal: "355", crystal: "142", deuterium: "0" },
    ]);
    expect(quote.planets[1]!.quote.rows.map(row => row.quote)).toEqual([
      { metal: "225", crystal: "55", deuterium: "0" }, { metal: "76", crystal: "38", deuterium: "0" }, { metal: "168", crystal: "67", deuterium: "0" },
    ]);
    expect(quote.totalQuote).toEqual({ metal: "1233", crystal: "434", deuterium: "0" });
    expect(JSON.stringify(save.serializeState(state))).toBe(before);
    expect(quote.authorityKey).toBe(buildingTemplateBatchAuthorityKey(state, 1, ids(state)));
  });
  it.each([2, 4])("creates the exact ordered local leaf IDs for %i explicit planets without spending", count => {
    const state = fixture(count, [metal, crystal]), selected = ids(state).reverse();
    const before = JSON.stringify(save.serializeState(state)), request = requestFor(state, selected);
    const result = applyBuildingTemplateBatch(state, request);
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual(Array.from({ length: count * 2 }, (_, index) => index + 1));
    expect(result.state.orders.nextTaskId).toBe(count * 2 + 1);
    expect(result.state.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(result.state.orders.nextWorkId).toBe(state.orders.nextWorkId);
    expect(result.state.orders.tasks.map(task => [task.planetId, task.kind === "building" ? task.building : "other"])).toEqual(selected.flatMap(id => [[id, "metal_mine"], [id, "crystal_mine"]]));
    for (const task of result.state.orders.tasks) expect(task).toMatchObject({ status: "running", charged: zeroOrderMoney(), refunded: zeroOrderMoney(), activeJob: null, transport: null, currentWork: null, formationOrigin: null });
    const { orders: _beforeOrders, ...beforeOther } = state, { orders: _afterOrders, ...afterOther } = result.state;
    expect(afterOther).toEqual(beforeOther);
    expect(result.state.planets).toBe(state.planets);
    expect(result.state.buildingTemplates).toBe(state.buildingTemplates);
    expect(result.state.research).toBe(state.research);
    expect(result.state.fleets).toBe(state.fleets);
    expect(JSON.stringify(save.serializeState(state))).toBe(before);
    const serialized = save.serializeState(result.state);
    expect(save.serializeState(save.deserializeState(serialized))).toEqual(serialized);
    request.planets[0]!.budgets[0]!.budget.metal = "999";
    expect(result.state.orders.tasks[0]!.budget.metal).toBe("1000000");
    assertRejected(result.state, request);
  });
  it("rejects 0, 1, 5, duplicate and non-existent selections before pricing or ID allocation", () => {
    const state = fixture(5), all = ids(state), cost = vi.spyOn(queue, "costFor");
    try {
      for (const selected of [[], all.slice(0, 1), all, [all[0]!, all[0]!], [all[0]!, "missing"]]) {
        const quote = quoteBuildingTemplateBatch(state, 1, selected);
        expect(quote.ok).toBe(false);
        expect(quote.planets).toEqual([]);
        expect(quote.reviewKey).toBe("");
        expect(buildingTemplateBatchAuthorityKey(state, 1, selected)).toBe("");
      }
      expect(cost).not.toHaveBeenCalled();
    } finally { cost.mockRestore(); }
  });
  it("keeps ordinary batch authority entirely free of future-level pricing", () => {
    const state = fixture(4, [{ building: "metal_mine", targetLevel: 1000 }]), cost = vi.spyOn(queue, "costFor");
    try {
      for (let index = 0; index < 10; index++) expect(buildingTemplateBatchAuthorityKey(state, 1, ids(state))).not.toBe("");
      expect(cost).not.toHaveBeenCalled();
    } finally { cost.mockRestore(); }
  });
  it("rejects an unrepresentable cross-planet display total without turning it into a shared cap", () => {
    const state = fixture(), cost = vi.spyOn(queue, "costFor").mockReturnValue({ metal: big("1e190"), crystal: big(0), deuterium: big(0) });
    try {
      const oneLevel = editBuildingTemplate(state, 1, 1, { name: "one", goals: [{ building: "metal_mine", targetLevel: 1 }] }).state;
      const quote = quoteBuildingTemplateBatch(oneLevel, 1, ids(oneLevel));
      expect(quote.planets.every(planet => planet.quote.totalQuote !== null)).toBe(true);
      expect(quote.totalQuote).toBeNull();
      expect(quote.ok).toBe(false);
      expect(quote.reason).toContain("整批合计报价");
      assertRejected(oneLevel, requestFor(oneLevel));
    } finally { cost.mockRestore(); }
  });
});

describe("building-template batch no-op and existing authority", () => {
  it("accepts a reviewed all-achieved no-op with the same state and no IDs", () => {
    const state = achieved(fixture());
    const quote = quoteBuildingTemplateBatch(state, 1, ids(state));
    expect(quote.ok).toBe(true);
    expect(quote.newCount).toBe(0);
    expect(quote.totalQuote).toEqual(zeroOrderMoney());
    expect(quote.planets.every(planet => planet.quote.ok === false && planet.quote.newCount === 0)).toBe(true);
    const result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result).toMatchObject({ state, ok: true, createdTaskIds: [] });
    expect(result.state).toBe(state);
    expect(result.reason).toContain("未创建计划");
  });
  it.each(["live", "cancelled"] as const)("all-achieved no-op succeeds with full %s capacity and exhausted ID sentinel", status => {
    const full = fillRecords(achieved(fixture()), status === "live" ? 32 : 100, status);
    const state = { ...full, orders: { ...full.orders, nextTaskId: Number.MAX_SAFE_INTEGER } };
    expect(quoteBuildingTemplateBatch(state, 1, ids(state)).ok).toBe(true);
    const result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result.ok).toBe(true);
    expect(result.state).toBe(state);
    expect(result.createdTaskIds).toEqual([]);
  });
  it("keeps covered paused plans untouched while a different selected planet creates new work", () => {
    let state = fixture(2, [metal, crystal]);
    state = order(order(state, ids(state)[0]!, "metal_mine", 3), ids(state)[0]!, "crystal_mine", 1);
    state = orders.pauseOrderTask(orders.pauseOrderTask(state, 1).state, 2).state;
    const old = state.orders.tasks.slice(), quote = quoteBuildingTemplateBatch(state, 1, ids(state));
    expect(quote.newCount).toBe(2);
    expect(quote.planets[0]!.quote.newCount).toBe(0);
    expect(quote.planets[0]!.quote.rows.every(row => row.status === "covered")).toBe(true);
    const result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual([3, 4]);
    expect(result.state.orders.tasks[0]).toBe(old[0]);
    expect(result.state.orders.tasks[1]).toBe(old[1]);
    expect(result.state.orders.tasks.slice(0, 2).every(task => task.status === "paused")).toBe(true);
  });
  it("all-covered paused plans form a same-state no-op, never a resume or budget change", () => {
    let state = fixture();
    for (const id of ids(state)) state = order(state, id, "metal_mine", 3);
    for (const task of state.orders.tasks) state = orders.pauseOrderTask(state, task.id).state;
    const result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result.ok).toBe(true);
    expect(result.state).toBe(state);
    expect(result.createdTaskIds).toEqual([]);
    const wrong = requestFor(state);
    wrong.planets[1]!.budgets.push({ building: "metal_mine", budget: generous });
    assertRejected(state, wrong);
  });
  it("retains a covered paused transport plan without copying its transport authority", () => {
    let state = fixture(2, [metal, crystal]);
    state = { ...state, research: { ...state.research, levels: { ...state.research.levels, combustion_drive: 2 } } };
    const result = orders.createOrderTask(state, { kind: "building", planetId: ids(state)[0]!, building: "metal_mine", targetLevel: 3,
      budget: generous, expectedNextTaskId: 1, transport: { donorPlanetId: ids(state)[1]!, ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 2, grossCargoCap: generous } });
    expect(result.ok).toBe(true);
    state = orders.pauseOrderTask(result.state, 1).state;
    const applied = applyBuildingTemplateBatch(state, requestFor(state));
    expect(applied.ok).toBe(true);
    expect(applied.state.orders.tasks[0]).toBe(state.orders.tasks[0]);
    expect(applied.state.orders.tasks.slice(1).every(task => task.transport === null)).toBe(true);
  });
});

describe("building-template batch preflight and atomic rollback", () => {
  it("preflights a conflict on the last planet before creating even the first leaf", () => {
    let state = fixture(4);
    state = order(state, ids(state)[3]!, "metal_mine", 1);
    const creator = vi.spyOn(orders, "createOrderTask");
    try {
      expect(quoteBuildingTemplateBatch(state, 1, ids(state)).ok).toBe(false);
      assertRejected(state, requestFor(state));
      expect(creator).not.toHaveBeenCalled();
    } finally { creator.mockRestore(); }
  });
  it.each([[31, "live"], [99, "cancelled"]] as const)("rejects combined capacity at %s %s records although each planet alone fits", (count, status) => {
    const state = fillRecords(fixture(), count, status), creator = vi.spyOn(orders, "createOrderTask");
    try {
      const quote = quoteBuildingTemplateBatch(state, 1, ids(state));
      expect(quote.planets.every(planet => planet.quote.ok)).toBe(true);
      expect(quote.ok).toBe(false);
      expect(quote.reason).toContain("容量");
      assertRejected(state, requestFor(state));
      expect(creator).not.toHaveBeenCalled();
    } finally { creator.mockRestore(); }
  });
  it.each([[30, "live"], [98, "cancelled"]] as const)("accepts the exact combined capacity at %s %s records", (count, status) => {
    const state = fillRecords(fixture(), count, status), result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result.ok).toBe(true);
    expect(result.state.orders.tasks).toHaveLength(count + 2);
    expect(result.createdTaskIds).toEqual([count + 1, count + 2]);
  });
  it("issues only the final real task IDs and never the exhausted sentinel", () => {
    const initial = fixture(4), max = Number.MAX_SAFE_INTEGER;
    const state = { ...initial, orders: { ...initial.orders, nextTaskId: max - 4 } };
    const result = applyBuildingTemplateBatch(state, requestFor(state));
    expect(result.ok).toBe(true);
    expect(result.createdTaskIds).toEqual([max - 4, max - 3, max - 2, max - 1]);
    expect(result.state.orders.nextTaskId).toBe(max);
    for (const nextTaskId of [max - 3, max - 1, max]) {
      const short = { ...initial, orders: { ...initial.orders, nextTaskId } };
      assertRejected(short, requestFor(short));
    }
  });
  it("discards every private prefix when the final planet's leaf creator fails", () => {
    const state = fixture(4, [metal, crystal]), request = requestFor(state), original = orders.createOrderTask;
    const bytes = JSON.stringify(save.serializeState(state));
    const creator = vi.spyOn(orders, "createOrderTask").mockImplementation((candidate, input) => input.expectedNextTaskId === 8
      ? { state: candidate, ok: false, reason: "synthetic last-planet last-row failure" } : original(candidate, input));
    try {
      const result = applyBuildingTemplateBatch(state, request);
      expect(creator).toHaveBeenCalledTimes(8);
      expect(result).toMatchObject({ ok: false, createdTaskIds: [], reason: "synthetic last-planet last-row failure" });
      expect(result.state).toBe(state);
      expect(JSON.stringify(save.serializeState(state))).toBe(bytes);
      expect(state.orders.nextTaskId).toBe(1);
    } finally { creator.mockRestore(); }
  });
  it("discards the private candidate if a later leaf creator throws", () => {
    const state = fixture(), request = requestFor(state), original = orders.createOrderTask;
    const creator = vi.spyOn(orders, "createOrderTask").mockImplementationOnce(original).mockImplementation(() => { throw Error("synthetic leaf exception"); });
    try { assertRejected(state, request); expect(creator).toHaveBeenCalledTimes(2); }
    finally { creator.mockRestore(); }
  });
  it.each(["serialize", "deserialize"])("rolls back the whole candidate on strict %s failure", stage => {
    const state = fixture(4), request = requestFor(state), bytes = JSON.stringify(state);
    const original = save.serializeState;
    const validation = stage === "serialize" ? vi.spyOn(save, "serializeState").mockImplementationOnce(original).mockImplementation(() => { throw Error("synthetic strict write failure"); })
      : vi.spyOn(save, "deserializeState").mockImplementation(() => { throw Error("synthetic strict read failure"); });
    try {
      const result = applyBuildingTemplateBatch(state, request);
      expect(validation).toHaveBeenCalledTimes(stage === "serialize" ? 2 : 1);
      expect(result.state).toBe(state);
      expect(result.ok).toBe(false);
      expect(result.createdTaskIds).toEqual([]);
      expect(result.reason).toContain("完整性");
      expect(JSON.stringify(state)).toBe(bytes);
    } finally { validation.mockRestore(); }
  });
  it("rejects a source accessor before it can mutate the original state during mapping", () => {
    const state = fixture(), request = requestFor(state), originalPlanetId = state.activePlanetId;
    const wallet = state.planets[0]!.resources, originalNextTaskId = state.orders.nextTaskId;
    const getter = vi.fn(() => { state.activePlanetId = ids(state)[1]!; state.planets[0]!.resources = { ...wallet, metal: big(0) }; return 2; });
    const goal = state.buildingTemplates.templates[0]!.goals[0]!;
    Object.defineProperty(goal, "targetLevel", { get: getter, enumerable: true, configurable: true });
    const descriptor = Object.getOwnPropertyDescriptor(goal, "targetLevel");
    const result = applyBuildingTemplateBatch(state, request);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.createdTaskIds).toEqual([]);
    expect(getter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(goal, "targetLevel")).toEqual(descriptor);
    expect(state.activePlanetId).toBe(originalPlanetId);
    expect(state.planets[0]!.resources).toBe(wallet);
    expect(state.orders.nextTaskId).toBe(originalNextTaskId);
  });
  it("validates a no-op before accepting it and does not substitute the normalized reader state", () => {
    const state = achieved(fixture()), request = requestFor(state), original = save.deserializeState;
    const reader = vi.spyOn(save, "deserializeState").mockImplementation(value => ({ ...original(value), manualClicks: 123 }));
    try {
      const result = applyBuildingTemplateBatch(state, request);
      expect(reader).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(result.state).toBe(state);
    } finally { reader.mockRestore(); }
  });
});

describe("building-template batch bounded request boundary", () => {
  it.each(["", "-1", ".5", "NaN", "Infinity", "1e-19", "1e191", "1e999999999", "9".repeat(257)])("rejects invalid last-planet exact cap %s atomically", amount => {
    const state = fixture(), request = requestFor(state);
    request.planets[1]!.budgets[0]!.budget.metal = amount;
    assertRejected(state, request);
  });
  it("accepts independent zero, subunit and exact maximum caps without making a payment", () => {
    const state = fixture(), request = requestFor(state);
    request.planets[0]!.budgets[0]!.budget = zeroOrderMoney();
    request.planets[1]!.budgets[0]!.budget = { metal: "1e190", crystal: "1e-18", deuterium: "0" };
    const result = applyBuildingTemplateBatch(state, request);
    expect(result.ok).toBe(true);
    expect(result.state.orders.tasks.map(task => task.budget)).toEqual([zeroOrderMoney(), { metal: normalizeOrderAmount("1e190"), crystal: "0.000000000000000001", deuterium: "0" }]);
    expect(result.state.planets).toBe(state.planets);
  });
  it("rejects malformed, unknown, duplicate, sparse and inherited inputs before invoking any leaf", () => {
    const state = fixture(2, [metal, crystal]), request = requestFor(state);
    const clone = () => structuredClone(request);
    const invalid: unknown[] = [null, {}, [], { ...request, transport: null }, { ...request, [Symbol("authority")]: true },
      { ...request, expectedNextTaskId: 0 }, { ...request, expectedTemplateRevision: 0 }, { ...request, templateId: Number.MAX_SAFE_INTEGER },
      { ...request, expectedReviewKey: "x".repeat(MAX_BUILDING_TEMPLATE_BATCH_REVIEW_KEY_LENGTH + 1) },
      { ...request, planets: [] }, { ...request, planets: [request.planets[0]] }, { ...request, planets: Array(5).fill(request.planets[0]) },
      { ...request, planets: [request.planets[0], request.planets[0]] }, { ...request, planets: new Array(2) },
      Object.assign(Object.create({ transport: null }), request)];
    for (const location of ["request", "planets", "planet", "budgets", "row", "money"]) {
      const value = clone();
      const target = location === "request" ? value : location === "planets" ? value.planets : location === "planet" ? value.planets[1]!
        : location === "budgets" ? value.planets[1]!.budgets : location === "row" ? value.planets[1]!.budgets[0]! : value.planets[1]!.budgets[0]!.budget;
      Object.defineProperty(target, "unknown", { value: null, enumerable: false });
      invalid.push(value);
      const inherited = clone();
      const inheritedTarget = location === "request" ? inherited : location === "planets" ? inherited.planets : location === "planet" ? inherited.planets[1]!
        : location === "budgets" ? inherited.planets[1]!.budgets : location === "row" ? inherited.planets[1]!.budgets[0]! : inherited.planets[1]!.budgets[0]!.budget;
      Object.setPrototypeOf(inheritedTarget, Object.create(Object.getPrototypeOf(inheritedTarget)));
      invalid.push(inherited);
    }
    for (const budgets of [[], [request.planets[1]!.budgets[0]], [request.planets[1]!.budgets[0], request.planets[1]!.budgets[0]],
      [{ building: "solar_plant", budget: generous }, request.planets[1]!.budgets[1]], Array(17).fill(request.planets[1]!.budgets[0]), new Array(2)]) {
      invalid.push({ ...request, planets: [request.planets[0], { ...request.planets[1], budgets }] });
    }
    const creator = vi.spyOn(orders, "createOrderTask");
    try { for (const value of invalid) assertRejected(state, value); expect(creator).not.toHaveBeenCalled(); }
    finally { creator.mockRestore(); }
  });
  it("does not execute accessors at any nested request or selection boundary", () => {
    const state = fixture(), request = requestFor(state), getter = vi.fn(() => { throw Error("accessor must never run"); });
    const paths: Array<[string | number, ...Array<string | number>]> = [["templateId"], ["planets"], ["planets", 1], ["planets", 1, "planetId"],
      ["planets", 1, "budgets"], ["planets", 1, "budgets", 0], ["planets", 1, "budgets", 0, "building"],
      ["planets", 1, "budgets", 0, "budget"], ["planets", 1, "budgets", 0, "budget", "metal"]];
    for (const path of paths) {
      const malformed = structuredClone(request);
      let parent: any = malformed;
      for (const part of path.slice(0, -1)) parent = parent[part];
      Object.defineProperty(parent, path.at(-1)!, { get: getter, enumerable: true });
      assertRejected(state, malformed);
    }
    const selected = ids(state);
    Object.defineProperty(selected, "1", { get: getter, enumerable: true });
    expect(quoteBuildingTemplateBatch(state, 1, selected).ok).toBe(false);
    expect(buildingTemplateBatchAuthorityKey(state, 1, selected)).toBe("");
    expect(getter).not.toHaveBeenCalled();
  });
  it("checks the action envelope before extracting its request", () => {
    const state = fixture(), request = requestFor(state), getter = vi.fn();
    const malformed: unknown[] = [{ type: "building-template-batch-apply", request, repeat: true }, { type: "unknown", request }, null,
      Object.defineProperty({ type: "building-template-batch-apply" }, "request", { get: getter, enumerable: true })];
    for (const action of malformed) {
      const result = applyBuildingTemplateBatchAction(state, action as BuildingTemplateBatchAction);
      expect(result.ok).toBe(false); expect(result.state).toBe(state);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(applyBuildingTemplateBatchAction(state, { type: "building-template-batch-apply", request }).ok).toBe(true);
  });
});

describe("building-template batch review freshness", () => {
  it.each(["template-edit", "template-delete", "last-planet-gone", "last-level", "last-coordinates", "last-fields", "last-queue", "new-task", "world", "research", "growth"])("rejects stale %s authority without any prefix", change => {
    const state = fixture(4), request = requestFor(state), last = ids(state)[3]!;
    let changed = state;
    if (change === "template-edit") changed = editBuildingTemplate(state, 1, 1, { name: "new", goals: [metal] }).state;
    if (change === "template-delete") changed = deleteBuildingTemplate(state, 1, 1).state;
    if (change === "last-planet-gone") changed = { ...state, planets: state.planets.filter(planet => planet.id !== last) };
    if (change === "last-level") changed = { ...state, planets: state.planets.map(planet => planet.id !== last ? planet : { ...planet, buildings: { ...planet.buildings, metal_mine: 1 } }) };
    if (change === "last-coordinates") changed = { ...state, planets: state.planets.map(planet => planet.id !== last ? planet : { ...planet, coordinates: { ...planet.coordinates, system: 21 } }) };
    if (change === "last-fields") changed = { ...state, planets: state.planets.map(planet => planet.id !== last ? planet : { ...planet, fieldsMax: planet.fieldsMax + 1, terraformerFields: { ...planet.terraformerFields, base: planet.terraformerFields.base + 1 } }) };
    if (change === "last-queue") changed = paid(state, last);
    if (change === "new-task") changed = order(state, last, "solar_plant", 1);
    if (change === "world") changed = { ...state, stats: { ...state.stats, launches: state.stats.launches + 1 } };
    if (change === "research") changed = { ...state, research: { ...state.research, levels: { ...state.research.levels, computer_tech: 1 } } };
    if (change === "growth") changed = { ...state, curvature: { ...state.curvature, growth_cut: 1 } };
    assertRejected(changed, request);
  });
  it("binds explicit selection order and requires fresh review when all targets become met", () => {
    const state = fixture(), request = requestFor(state);
    assertRejected(state, { ...request, planets: request.planets.slice().reverse() });
    const done = achieved(state);
    assertRejected(done, request);
    const result = applyBuildingTemplateBatch(done, requestFor(done));
    expect(result.ok).toBe(true);
    expect(result.state).toBe(done);
  });
  it("binds paid job identity, ownership, source, target and amount on the last selected planet", () => {
    let state = fixture();
    state = paid(state, ids(state)[1]!);
    const request = requestFor(state), last = state.planets[1]!, head = last.buildQueue[0]!;
    for (const patch of [{ jobId: head.jobId + 10 }, { taskId: 999 }, { source: "protocol" as const }, { targetLevel: 2 }, { paid: { ...head.paid, metal: head.paid.metal.add(1) } }]) {
      const changed = { ...state, planets: state.planets.map(planet => planet.id === last.id ? { ...planet, buildQueue: [{ ...head, ...patch }] } : planet) };
      const bytes = JSON.stringify(changed), result = applyBuildingTemplateBatch(changed, request);
      expect(result.ok).toBe(false); expect(result.state).toBe(changed); expect(JSON.stringify(changed)).toBe(bytes);
    }
  });
  it("binds covered task authorization but ignores wallet growth, countdowns, reasons and UI selection", () => {
    let state = fixture(2, [metal, crystal]);
    state = paid(order(state, ids(state)[1]!, "metal_mine", 3), ids(state)[0]!);
    const request = requestFor(state);
    const changed = { ...selectPlanet(state, ids(state)[1]!), planets: state.planets.map(planet => ({ ...planet,
      resources: { metal: planet.resources.metal.add(500), crystal: planet.resources.crystal.add(700), deuterium: planet.resources.deuterium },
      buildQueue: planet.buildQueue.map(job => ({ ...job, remainingSeconds: job.remainingSeconds / 2 })) })),
      orders: { ...state.orders, accumulator: 4, tasks: state.orders.tasks.map(task => ({ ...task, reason: "display change" })) } };
    expect(quoteBuildingTemplateBatch(changed, 1, ids(state)).reviewKey).toBe(request.expectedReviewKey);
    const result = applyBuildingTemplateBatch(changed, request);
    expect(result.ok).toBe(true);
    expect(result.state.activePlanetId).toBe(ids(state)[1]);
    expect(result.state.orders.accumulator).toBe(4);
    const updates: Array<(task: OrderTask) => OrderTask> = [task => ({ ...task, status: "paused" }), task => ({ ...task, budget: { ...task.budget, metal: "2000000" } })];
    for (const update of updates) assertRejected({ ...state, orders: { ...state.orders, tasks: state.orders.tasks.map(update) } }, request);
  });
});

describe("batch-created leaves retain local scheduler and historical payment semantics", () => {
  it("treats each resource cap as independent and charges only on the later ordinary scheduler pass", () => {
    const state = fixture(2, [{ building: "metal_mine", targetLevel: 1 }]), request = requestFor(state);
    request.planets[0]!.budgets[0]!.budget = { metal: "60", crystal: "14", deuterium: "0" };
    request.planets[1]!.budgets[0]!.budget = { metal: "60", crystal: "15", deuterium: "0" };
    const applied = applyBuildingTemplateBatch(state, request);
    expect(applied.ok).toBe(true);
    expect(applied.state.planets).toBe(state.planets);
    const early = orders.advanceOrderPlans(applied.state, 9);
    expect(early.planets.every(planet => planet.buildQueue.length === 0)).toBe(true);
    const due = orders.advanceOrderPlans(early, 1);
    expect(due.planets[0]!.buildQueue).toEqual([]);
    expect(due.orders.tasks[0]!.charged).toEqual(zeroOrderMoney());
    expect(due.orders.tasks[0]!.reason).toContain("预算");
    expect(due.planets[1]!.buildQueue[0]).toMatchObject({ source: "plan", taskId: 2, jobId: 1, building: "metal_mine", targetLevel: 1 });
    expect(due.orders.tasks[1]!.charged).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
    expect(due.planets[0]!.resources).toBe(state.planets[0]!.resources);
    expect(due.planets[1]!.resources.metal.eq(999940)).toBe(true);
    expect(due.planets[1]!.resources.crystal.eq(999985)).toBe(true);
    const cancelled = orders.cancelOrderTask(save.deserializeState(save.serializeState(due)), 2);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.orders.tasks[1]).toMatchObject({ status: "cancelled", refunded: { metal: "60", crystal: "15", deuterium: "0" } });
    expect(cancelled.state.planets[1]!.resources.metal.eq(1e6)).toBe(true);
    expect(cancelled.state.planets[0]!.resources.metal.eq(1e6)).toBe(true);
  });
  it.each(["manual", "protocol"] as const)("waits on old paid %s jobs without adopting or refunding their receipts", source => {
    let state = fixture(2, [{ building: "metal_mine", targetLevel: 1 }]);
    for (const id of ids(state)) state = paid(state, id, "metal_mine", source);
    const originalJobs = state.planets.map(planet => planet.buildQueue[0]);
    const quote = quoteBuildingTemplateBatch(state, 1, ids(state));
    expect(quote.newCount).toBe(2);
    expect(quote.totalQuote).toEqual(zeroOrderMoney());
    const result = applyBuildingTemplateBatch(state, requestFor(state, ids(state), zeroOrderMoney()));
    expect(result.ok).toBe(true);
    for (let index = 0; index < 2; index++) expect(result.state.planets[index]!.buildQueue[0]).toBe(originalJobs[index]);
    const waiting = orders.runDueOrderPass(result.state);
    expect(waiting.orders.nextJobId).toBe(state.orders.nextJobId);
    for (const task of waiting.orders.tasks) expect(task).toMatchObject({ charged: zeroOrderMoney(), refunded: zeroOrderMoney(), activeJob: null, status: "running" });
    const cancelled = orders.cancelOrderTask(waiting, 2).state;
    expect(cancelled.planets[1]!.buildQueue[0]).toBe(originalJobs[1]);
    expect(cancelled.planets[1]!.resources).toBe(state.planets[1]!.resources);
    expect(cancelled.orders.tasks[1]!.refunded).toEqual(zeroOrderMoney());
    const completeHome = selectPlanet(queue.completeActive(selectPlanet(waiting, ids(state)[0]!)).state, state.activePlanetId);
    const completeBoth = selectPlanet(queue.completeActive(selectPlanet(completeHome, ids(state)[1]!)).state, state.activePlanetId);
    const completed = orders.runDueOrderPass(completeBoth);
    expect(completed.orders.tasks.every(task => task.status === "completed")).toBe(true);
    expect(completed.orders.tasks.every(task => task.charged.metal === "0")).toBe(true);
  });
  it("never expands a zero cap when historical paid coverage is cancelled later", () => {
    let state = fixture(2, [{ building: "metal_mine", targetLevel: 1 }]);
    for (const id of ids(state)) state = paid(state, id);
    const result = applyBuildingTemplateBatch(state, requestFor(state, ids(state), zeroOrderMoney()));
    expect(result.ok).toBe(true);
    const last = ids(state)[1]!;
    const removed = selectPlanet(queue.cancel(selectPlanet(result.state, last), 0).state, state.activePlanetId);
    const waiting = orders.runDueOrderPass(removed);
    expect(waiting.planets[1]!.buildQueue).toEqual([]);
    expect(waiting.orders.tasks[1]).toMatchObject({ budget: zeroOrderMoney(), charged: zeroOrderMoney(), activeJob: null });
    expect(waiting.orders.tasks[1]!.reason).toContain("预算");
    expect(waiting.orders.nextJobId).toBe(state.orders.nextJobId);
  });
});
