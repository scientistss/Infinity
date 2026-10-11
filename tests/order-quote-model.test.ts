import { afterEach, describe, expect, it, vi } from "vitest";
import { buildingById } from "../src/data/buildings";
import { researchById } from "../src/data/research";
import { unitById } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { quoteOrderMoney, zeroOrderMoney } from "../src/game/order-ledger";
import { addOrderAmounts, compareOrderAmounts } from "../src/game/order-money";
import { MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, type OrderMoney, type OrderTarget } from "../src/game/order-state";
import { createOrderTask, runDueOrderPass } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import * as queue from "../src/game/queue";
import * as research from "../src/game/research";
import { enqueueUnits } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
import * as unitCosts from "../src/game/unit-cost";
import { localOrderQuoteContextKey, quoteLocalOrder } from "../src/ui/order-quote-model";
import { rich, stateWith } from "./helpers";

const building = (state: GameState, targetLevel = 3): OrderTarget => ({ kind: "building", planetId: state.activePlanetId, building: "metal_mine", targetLevel });
const tech = (state: GameState, targetLevel = 3): OrderTarget => ({ kind: "research", planetId: state.activePlanetId, tech: "energy_tech", targetLevel });
const ships = (state: GameState, quantity = 3): OrderTarget => ({ kind: "shipyard", planetId: state.activePlanetId, unit: "rocket_launcher", quantity });
function colony(state: GameState): GameState {
  const planet = createPlanet("quote-colony", { galaxy: 1, system: 2, position: 8 });
  planet.name = "固定支付星球";
  planet.buildings.research_lab = 1;
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  return { ...state, planets: [...state.planets, planet] };
}
function exactSum(...amounts: OrderMoney[]): OrderMoney {
  const result = zeroOrderMoney();
  for (const amount of amounts) for (const id of ["metal", "crystal", "deuterium"] as const) result[id] = addOrderAmounts(result[id], amount[id])!;
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

afterEach(() => vi.restoreAllMocks());

describe("finite local order cost preview", () => {
  it("quotes metal mine 0 to 3 as exactly 285 metal and 70 crystal without mutating state", () => {
    const state = freeze(stateWith());
    const before = JSON.stringify(state);
    const result = quoteLocalOrder(state, building(state));
    expect(result).toMatchObject({ available: true, completed: 0, paidCoverage: 0, remaining: 3, unit: "levels", cost: { metal: "285", crystal: "70", deuterium: "0" } });
    expect(result.payer).toEqual({ id: state.activePlanetId, name: activePlanet(state).name });
    expect(result.contextKey).toBe(localOrderQuoteContextKey(state, building(state)));
    expect(JSON.stringify(state)).toBe(before);
    expect(state.orders.nextTaskId).toBe(1);
    expect(state.orders.nextJobId).toBe(1);
  });

  it("excludes completed levels and only actual paid queue coverage", () => {
    let state = rich(stateWith({ metal_mine: 1 }));
    const paid = queue.enqueue(state, "metal_mine", "manual");
    expect(paid.ok).toBe(true);
    state = paid.state;
    expect(quoteLocalOrder(state, building(state))).toMatchObject({ completed: 1, paidCoverage: 1, remaining: 1, cost: { metal: "135", crystal: "33", deuterium: "0" } });
    const cancelled = queue.cancel(state, 0);
    expect(cancelled.ok).toBe(true);
    expect(quoteLocalOrder(cancelled.state, building(state))).toMatchObject({ paidCoverage: 0, remaining: 2, cost: { metal: "225", crystal: "55", deuterium: "0" } });
  });

  it("uses queue repricing after cancelling an earlier paid level", () => {
    let state = rich(stateWith());
    state = queue.enqueue(state, "metal_mine", "manual").state;
    state = queue.enqueue(state, "metal_mine", "protocol").state;
    expect(quoteLocalOrder(state, building(state)).paidCoverage).toBe(2);
    state = queue.cancel(state, 0).state;
    expect(activePlanet(state).buildQueue[0]?.targetLevel).toBe(1);
    expect(quoteLocalOrder(state, building(state))).toMatchObject({ paidCoverage: 1, remaining: 2, cost: { metal: "225", crystal: "55", deuterium: "0" } });
  });

  it("does not count an unstarted plan, and validates the receipt of an actual paid plan job", () => {
    let state = rich(stateWith());
    const target = building(state);
    state = createOrderTask(state, { ...target, expectedNextTaskId: 1, budget: { metal: "285", crystal: "70", deuterium: "0" } }).state;
    const unpaid = quoteLocalOrder(state, target);
    expect(unpaid.paidCoverage).toBe(0);
    expect(unpaid.warnings.join(" ")).toContain("未结束计划");
    state = runDueOrderPass(state);
    expect(quoteLocalOrder(state, target)).toMatchObject({ available: true, paidCoverage: 1, cost: { metal: "225", crystal: "55", deuterium: "0" } });
    state = { ...state, orders: { ...state.orders, tasks: state.orders.tasks.map(task => ({ ...task, activeJob: null })) } };
    expect(quoteLocalOrder(state, target)).toMatchObject({ available: false, cost: null });
  });

  it("uses empire research coverage while retaining the selected fixed payer", () => {
    let state = colony(rich(stateWith({ research_lab: 1 })));
    state = research.enqueueResearch(state, "energy_tech", "manual").state;
    const target: OrderTarget = { kind: "research", tech: "energy_tech", targetLevel: 3, planetId: "quote-colony" };
    const result = quoteLocalOrder(state, target);
    expect(result).toMatchObject({ payer: { id: "quote-colony", name: "固定支付星球" }, completed: 0, paidCoverage: 1, remaining: 2, cost: { metal: "0", crystal: "4800", deuterium: "2400" } });
    expect(state.activePlanetId).toBe("homeworld");
    expect(quoteLocalOrder(selectPlanet(state, "quote-colony"), target)).toEqual(result);
    state = research.cancelResearch(state, 0).state;
    expect(quoteLocalOrder(state, target)).toMatchObject({ paidCoverage: 0, cost: { metal: "0", crystal: "5600", deuterium: "2800" } });
  });

  it("never offsets NEW units with inventory, manual queues or another paid plan", () => {
    let state = rich(stateWith({ shipyard: 1 }));
    activePlanet(state).units.rocket_launcher = 900;
    state = enqueueUnits(state, "rocket_launcher", 7, "manual").state;
    const target = ships(state);
    const quote = quoteLocalOrder(state, target);
    expect(quote).toMatchObject({ completed: 0, paidCoverage: 0, remaining: 3, unit: "units", cost: { metal: "6000", crystal: "0", deuterium: "0" } });
    state = createOrderTask(state, { ...target, expectedNextTaskId: 1, budget: quote.cost! }).state;
    state = runDueOrderPass(state);
    expect(activePlanet(state).shipyardQueue).toHaveLength(2);
    expect(quoteLocalOrder(state, target)).toMatchObject({ paidCoverage: 0, remaining: 3, cost: quote.cost });
  });

  it("uses the current building discount without repricing already-paid coverage", () => {
    let state = rich(stateWith({ metal_mine: 1 }));
    state = queue.enqueue(state, "metal_mine", "manual").state;
    const before = quoteLocalOrder(state, building(state));
    const oldPaid = activePlanet(state).buildQueue[0]!.paid.metal.toString();
    state = { ...state, curvature: { ...state.curvature, growth_cut: 1 } };
    const discounted = quoteLocalOrder(state, building(state));
    expect(discounted.cost).toEqual(quoteOrderMoney(queue.costFor(state, "metal_mine", 3)));
    expect(compareOrderAmounts(discounted.cost!.metal, before.cost!.metal)).toBe(-1);
    expect(discounted.paidCoverage).toBe(1);
    expect(activePlanet(state).buildQueue[0]!.paid.metal.toString()).toBe(oldPaid);
    expect(discounted.contextKey).not.toBe(before.contextKey);
  });

  it("makes cost available independently of prerequisites, phases, queues, fields and conflicts", () => {
    let state = stateWith();
    activePlanet(state).fieldsMax = 1;
    const quote = quoteLocalOrder(state, building(state));
    expect(quote.available).toBe(true);
    expect(quote.warnings.join(" ")).toContain("格子不足");
    const locked: OrderTarget = { ...building(state), building: "jump_gate" } as OrderTarget;
    const lockedQuote = quoteLocalOrder(state, locked);
    expect(lockedQuote.available).toBe(true);
    expect(lockedQuote.warnings.join(" ")).toContain("前置条件");
    expect(lockedQuote.warnings.join(" ")).toContain("阶段开放");
    expect(quoteLocalOrder(state, tech(state)).warnings.join(" ")).toContain("支付星球前置条件");
    expect(quoteLocalOrder(state, ships(state)).warnings.join(" ")).toContain("造船厂");
    state = rich(stateWith());
    state = queue.enqueue(state, "crystal_mine", "manual").state;
    state = queue.enqueue(state, "crystal_mine", "manual").state;
    expect(quoteLocalOrder(state, building(state)).warnings.join(" ")).toContain("建造队列已满");
  });

  it("warns about empire lab conflicts and future energy requirements without quoting fuel", () => {
    let state = colony(rich(stateWith({ research_lab: 1 })));
    state = queue.enqueue(state, "research_lab", "manual").state;
    const target = { ...tech(state), planetId: "quote-colony" };
    expect(quoteLocalOrder(state, target).warnings.join(" ")).toContain("研究实验室正在升级");
    const graviton: OrderTarget = { kind: "research", tech: "graviton_tech", planetId: "quote-colony", targetLevel: 1000 };
    expect(quoteLocalOrder(state, graviton)).toMatchObject({ available: true, cost: zeroOrderMoney() });
    expect(quoteLocalOrder(state, graviton).warnings.join(" ")).toContain("供能要求超出");
  });

  it("returns zero cost for a satisfied or fully paid target without inventing work", () => {
    let state = rich(stateWith({ metal_mine: 3 }));
    expect(quoteLocalOrder(state, building(state))).toMatchObject({ completed: 3, remaining: 0, cost: zeroOrderMoney() });
    state = rich(stateWith({ metal_mine: 2 }));
    state = queue.enqueue(state, "metal_mine", "manual").state;
    expect(quoteLocalOrder(state, building(state))).toMatchObject({ completed: 2, paidCoverage: 1, remaining: 0, cost: zeroOrderMoney() });
  });

  it("rejects invalid targets before evaluating prices and accepts exact target boundaries", () => {
    const state = stateWith();
    const price = vi.spyOn(queue, "costFor");
    const invalid: unknown[] = [null, {}, { ...building(state), kind: "transport" }, { ...building(state), building: "unknown" }, { ...tech(state), tech: "unknown" }, { ...ships(state), unit: "unknown" },
      ...[0, -1, 1.1, NaN, Infinity, MAX_ORDER_LEVEL + 1].map(targetLevel => ({ ...building(state), targetLevel })),
      ...[0, -1, 1.1, NaN, Infinity, MAX_ORDER_QUANTITY + 1].map(quantity => ({ ...ships(state), quantity }))];
    for (const target of invalid) expect(quoteLocalOrder(state, target as OrderTarget)).toMatchObject({ available: false, cost: null });
    expect(price).not.toHaveBeenCalled();
    expect(quoteLocalOrder(state, building(state, MAX_ORDER_LEVEL)).available).toBe(true);
    expect(price).toHaveBeenCalledTimes(MAX_ORDER_LEVEL);
    expect(quoteLocalOrder(state, ships(state, MAX_ORDER_QUANTITY))).toMatchObject({ available: true, remaining: MAX_ORDER_QUANTITY, cost: { metal: "2000000000", crystal: "0", deuterium: "0" } });
    expect(quoteLocalOrder(state, { ...building(state), planetId: "missing" })).toMatchObject({ available: false, payer: null, cost: null });
  });

  it("rejects unsupported per-step costs and exact-sum overflow without partial budgets", () => {
    const state = stateWith();
    const price = vi.spyOn(queue, "costFor");
    for (const metal of [big(NaN), big(Infinity), big(-1), big("1e191"), big("1e-19")]) {
      price.mockReturnValue({ metal, crystal: big(0), deuterium: big(0) });
      expect(quoteLocalOrder(state, building(state, 1))).toMatchObject({ available: false, cost: null });
    }
    price.mockReturnValue({ metal: big("1e190"), crystal: big(0), deuterium: big(0) });
    expect(quoteLocalOrder(state, building(state, 1)).available).toBe(true);
    expect(quoteLocalOrder(state, building(state, 2))).toMatchObject({ available: false, cost: null });
  });

  it("rejects overflowing research and unit quotes at the same order-money boundary", () => {
    const state = stateWith();
    expect(quoteLocalOrder(state, tech(state, 1000))).toMatchObject({ available: false, cost: null });
    const price = vi.spyOn(unitCosts, "unitCost").mockReturnValue({ metal: big("1e190"), crystal: big(0), deuterium: big(0) });
    expect(quoteLocalOrder(state, ships(state, 1)).available).toBe(true);
    expect(quoteLocalOrder(state, ships(state, 2))).toMatchObject({ available: false, cost: null });
    price.mockReturnValue({ metal: big(Infinity), crystal: big(0), deuterium: big(0) });
    expect(quoteLocalOrder(state, ships(state, 1))).toMatchObject({ available: false, cost: null });
  });

  it("fails closed for malformed completed levels or purported paid coverage", () => {
    let state = rich(stateWith());
    state = queue.enqueue(state, "metal_mine", "manual").state;
    for (const patch of [{ jobId: 0 }, { jobId: state.orders.nextJobId }, { targetLevel: 2 }, { taskId: 3 }, { paid: { metal: big(Infinity), crystal: big(0), deuterium: big(0) } }]) {
      const bad = { ...state, planets: state.planets.map(planet => ({ ...planet, buildQueue: planet.buildQueue.map(job => ({ ...job, ...patch })) })) };
      expect(quoteLocalOrder(bad, building(state))).toMatchObject({ available: false, cost: null });
    }
    const bad = stateWith({ metal_mine: NaN });
    expect(quoteLocalOrder(bad, building(bad))).toMatchObject({ available: false, cost: null });
  });

  it("matches actual same-rule building payments exactly including discounts", () => {
    let state = rich(stateWith(), 1e6);
    state.curvature.growth_cut = 1;
    const target = building(state, 5);
    const quote = quoteLocalOrder(state, target);
    const expected = exactSum(...[1, 2, 3, 4, 5].map(level => quoteOrderMoney(queue.costFor(state, "metal_mine", level))!));
    expect(quote.cost).toEqual(expected);
    state = createOrderTask(state, { ...target, expectedNextTaskId: 1, budget: quote.cost! }).state;
    for (let level = 1; level <= 5; level += 1) {
      state = runDueOrderPass(state);
      expect(activePlanet(state).buildQueue).toHaveLength(1);
      state = queue.completeActive(state).state;
    }
    expect(state.orders.tasks[0]?.charged).toEqual(quote.cost);
    expect(activePlanet(state).buildings.metal_mine).toBe(5);
  });

  it("matches actual same-rule research and additional-unit plan payments", () => {
    let state = rich(stateWith({ research_lab: 1, shipyard: 1 }), 1e6);
    const target = tech(state);
    const quote = quoteLocalOrder(state, target);
    state = createOrderTask(state, { ...target, expectedNextTaskId: 1, budget: quote.cost! }).state;
    for (let level = 1; level <= 3; level += 1) {
      state = runDueOrderPass(state);
      state = research.completeActiveResearch(state).state;
    }
    expect(state.orders.tasks[0]?.charged).toEqual(quote.cost);
    activePlanet(state).units.rocket_launcher = 99;
    const unitQuote = quoteLocalOrder(state, ships(state, 9));
    state = createOrderTask(state, { ...ships(state, 9), expectedNextTaskId: 2, budget: unitQuote.cost! }).state;
    state = runDueOrderPass(state);
    expect(state.orders.tasks[1]?.charged).toEqual(unitQuote.cost);
    expect(activePlanet(state).shipyardQueue[0]?.orderedCount).toBe(9);
  });
});

describe("cheap quote context invalidation", () => {
  it("retires previews when current catalog prices or rounding rules change", () => {
    const state = stateWith();
    const mine = buildingById("metal_mine"), science = researchById("astrophysics"), unit = unitById("rocket_launcher");
    const researchTarget: OrderTarget = { kind: "research", planetId: state.activePlanetId, tech: "astrophysics", targetLevel: 3 };
    const buildKey = localOrderQuoteContextKey(state, building(state));
    const researchKey = localOrderQuoteContextKey(state, researchTarget);
    const unitKey = localOrderQuoteContextKey(state, ships(state));
    const original = { metal: mine.baseCost.metal, factor: mine.factor, roundTo: science.roundTo, unitMetal: unit.cost.metal };
    try {
      mine.baseCost.metal += 1;
      expect(localOrderQuoteContextKey(state, building(state))).not.toBe(buildKey);
      mine.baseCost.metal = original.metal;
      mine.factor += 0.01;
      expect(localOrderQuoteContextKey(state, building(state))).not.toBe(buildKey);
      science.roundTo = 1000;
      expect(localOrderQuoteContextKey(state, researchTarget)).not.toBe(researchKey);
      unit.cost.metal += 1;
      expect(localOrderQuoteContextKey(state, ships(state))).not.toBe(unitKey);
    } finally {
      mine.baseCost.metal = original.metal;
      mine.factor = original.factor;
      science.roundTo = original.roundTo;
      unit.cost.metal = original.unitMetal;
    }
  });

  it("never computes cost and stays stable across wallets, passive timers and UI selection", () => {
    let state = colony(rich(stateWith({ research_lab: 1 })));
    state = queue.enqueue(state, "metal_mine", "manual").state;
    state = research.enqueueResearch(state, "energy_tech", "manual").state;
    const target = building(state);
    const key = localOrderQuoteContextKey(state, target);
    const build = vi.spyOn(queue, "costFor"), science = vi.spyOn(research, "researchCostFor"), unit = vi.spyOn(unitCosts, "unitCost");
    state = { ...state, totalTime: big(9999), activePlanetId: "quote-colony", orders: { ...state.orders, accumulator: 9 },
      planets: state.planets.map(planet => ({ ...planet, resources: { metal: big(1), crystal: big(2), deuterium: big(3) }, buildQueue: planet.buildQueue.map(job => ({ ...job, remainingSeconds: job.remainingSeconds / 2 })) })),
      research: { ...state.research, queue: state.research.queue.map(job => ({ ...job, remainingSeconds: job.remainingSeconds / 2 })) } };
    for (let frame = 0; frame < 100; frame += 1) expect(localOrderQuoteContextKey(state, target)).toBe(key);
    expect(build).not.toHaveBeenCalled();
    expect(science).not.toHaveBeenCalled();
    expect(unit).not.toHaveBeenCalled();
  });

  it("changes on payer, target, completion, paid cancellation, discount and field changes", () => {
    let state = colony(rich(stateWith()));
    const target = building(state), key = localOrderQuoteContextKey(state, target);
    expect(localOrderQuoteContextKey(state, { ...target, planetId: "quote-colony" })).not.toBe(key);
    expect(localOrderQuoteContextKey(state, building(state, 4))).not.toBe(key);
    const discounted = { ...state, curvature: { ...state.curvature, growth_cut: 1 } };
    expect(localOrderQuoteContextKey(discounted, target)).not.toBe(key);
    const fewerFields = { ...state, planets: state.planets.map(planet => ({ ...planet, fieldsMax: 1 })) };
    expect(localOrderQuoteContextKey(fewerFields, target)).not.toBe(key);
    state = queue.enqueue(state, "metal_mine", "manual").state;
    const paidKey = localOrderQuoteContextKey(state, target);
    expect(paidKey).not.toBe(key);
    expect(localOrderQuoteContextKey(queue.cancel(state, 0).state, target)).not.toBe(paidKey);
    expect(localOrderQuoteContextKey(queue.completeActive(state).state, target)).not.toBe(paidKey);
  });

  it("changes on global research coverage, other-world labs, conflicts and removed payer", () => {
    let state = colony(rich(stateWith({ research_lab: 1 })));
    const target = { ...tech(state), planetId: "quote-colony" };
    const key = localOrderQuoteContextKey(state, target);
    expect(localOrderQuoteContextKey(research.enqueueResearch(state, "energy_tech", "manual").state, target)).not.toBe(key);
    expect(localOrderQuoteContextKey(queue.enqueue(state, "research_lab", "manual").state, target)).not.toBe(key);
    state = createOrderTask(state, { ...tech(state), expectedNextTaskId: 1, budget: { metal: "0", crystal: "5600", deuterium: "2800" } }).state;
    expect(localOrderQuoteContextKey(state, target)).not.toBe(key);
    expect(localOrderQuoteContextKey({ ...state, planets: state.planets.filter(planet => planet.id !== target.planetId) }, target)).not.toBe(key);
  });
});
