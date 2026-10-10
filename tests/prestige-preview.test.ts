import { describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { emptyCargo, type Fleet } from "../src/game/fleet";
import { immutableFormationOrigin } from "../src/game/formation-state";
import { evaluatePrestige, expansionScore } from "../src/game/logic";
import { advanceOrderPlans, createOrderTask } from "../src/game/orders";
import type { OrderTask, OrderTripReceipt } from "../src/game/order-state";
import { createPlanet } from "../src/game/planet";
import { serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { passiveCoreBonus, unspentCores } from "../src/prestige/tree";
import { PRESTIGE_PREVIEW_ROW_LIMIT, prestigeConfirmation, prestigePreview } from "../src/ui/prestige-preview-model";

const money = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
const amounts = (metal = 0, crystal = 0, deuterium = 0) => ({ metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) });
function base(): GameState {
  const state = createInitialState(0x11112222, 0x33334444);
  state.lifetime.metal = big(1e8);
  state.warpCores = big(20);
  state.stats.manualActions = 1;
  return state;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
function fleet(id: number): Fleet {
  return { id, orderTransport: null, originId: "homeworld", target: { galaxy: 1, system: 50, position: 16 }, mission: "charge", ships: { small_cargo: 2 }, cargo: amounts(7, 11, 13), duration: 50, remaining: 20, elapsed: 30, returning: false,
    charge: { slots: 1, phase: "holding", cargoFactor: 1, bets: { metal: 1, crystal: 0, deuterium: 0, drifter: 0 }, stake: 17, betUnit: 17, dm: 0, items: {}, offerId: null, reportId: null } };
}
function task(id: number): OrderTask {
  return { id, kind: "building", planetId: "old-colony", building: "metal_mine", targetLevel: 3, status: "running", reason: "", budget: money("900000"), charged: money("800000"), refunded: money("100000"), activeJob: null, completedUnits: 0, transport: null, currentWork: null, formationOrigin: null };
}
function rich(): GameState {
  let state = base();
  const home = state.planets[0]!;
  home.resources = amounts(101, 103, 107);
  home.buildings.robotics_factory = 8;
  home.units.small_cargo = 3;
  home.units.solar_satellite = 5;
  home.units.rocket_launcher = 7;
  home.buildQueue = [{ jobId: 1, taskId: null, building: "metal_mine", targetLevel: 1, paid: amounts(61, 17), totalSeconds: 10, remainingSeconds: 4, source: "manual" }];
  const colony = createPlanet("old-colony");
  colony.name = "边界 <img onerror=boom> & colony";
  colony.resources = amounts(109, 113, 127);
  colony.units.light_fighter = 11;
  colony.buildings.metal_mine = 4;
  colony.shipyardQueue = [{ jobId: 2, taskId: 2, unit: "light_fighter", count: 2, orderedCount: 5, paidPerUnit: amounts(31, 13), progress: .5, source: "plan" }];
  state.planets.push(colony);
  state.curvature.seed_stock = 1;
  state.research.levels.computer_tech = 4;
  state.research.levels.energy_tech = 3;
  state.research.queue = [{ jobId: 3, taskId: null, planetId: colony.id, tech: "energy_tech", targetLevel: 4, paid: amounts(0, 137, 139), totalSeconds: 20, remainingSeconds: 7, source: "manual" }];
  state.formations = { nextFormationId: 2, entries: [{ id: 1, revision: 3, name: "新版编成 <b>", ships: { light_fighter: 23 } }] };
  state.researchTemplates = { nextTemplateId: 2, templates: [{ id: 1, revision: 2, name: "科研 <script>", goals: [{ tech: "energy_tech", targetLevel: 5 }] }] };
  const origin = immutableFormationOrigin({ id: 1, revision: 1, name: "旧版编成", ships: { light_fighter: 5 } }, money("31", "13"));
  // A real transport plan freezes pending work, then waits because the donor lacks the gap.
  // A local plan is never allowed to carry currentWork.
  const pending = createOrderTask(state, { kind: "building", planetId: colony.id, building: "metal_mine", targetLevel: 5,
    expectedNextTaskId: 1, budget: money("900000", "900000", "900000"),
    transport: { donorPlanetId: home.id, ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 1, grossCargoCap: money("900000", "900000", "900000") } });
  expect(pending.ok, pending.reason).toBe(true);
  state = advanceOrderPlans(pending.state, 10);
  expect(state.orders.tasks[0]!.currentWork?.stage).toBe("pending");
  expect(state.fleets).toHaveLength(0);
  state.orders.tasks = [
    state.orders.tasks[0]!,
    { id: 2, kind: "shipyard", planetId: colony.id, unit: "light_fighter", quantity: 5, status: "paused", reason: "", budget: money("155", "65"), charged: money("155", "65"), refunded: money(), activeJob: { jobId: 2, quantity: 5, credited: 3 }, completedUnits: 3, transport: null, currentWork: null, formationOrigin: origin },
  ];
  state.orders.nextTaskId = 3;
  state.orders.nextJobId = 4;
  state.orders.nextWorkId = 2;
  const outbound = fleet(1), settled = fleet(2);
  settled.returning = true;
  settled.charge = { ...settled.charge!, phase: "return", reportId: "old-report", dm: 19, items: { kraken_box: 2 }, stake: 999 };
  state.fleets = [outbound, settled];
  state.nextFleetId = 3;
  state.darkMatter = big(211);
  state.items.kraken_box = 3;
  state.totalTime = big(101);
  state.boosters = [{ res: "metal", pct: 10, until: 500 }];
  state.protocols.slots[0]!.card = { id: "auto_collect", enabled: true, trigger: { kind: "interval", seconds: 5 }, conditions: [], action: { kind: "collect" } };
  state.protocols.slots[1]!.card = { id: "ring", enabled: true, trigger: { kind: "interval", seconds: 5 }, conditions: [], action: { kind: "runLights", count: 1 } };
  state.arcade.autoBatch = { armed: true, planetId: home.id, ticketIds: [], completed: 0, maxDeuterium: "10", spentDeuterium: "0", bets: { metal: 0, crystal: 0, deuterium: 0, drifter: 0 }, stopReason: "" };
  state.deepSpace.offers = [{ id: "offer", planetId: colony.id, startsAt: 0, expiresAt: 1000, ratios: { metal: 1, crystal: 2, deuterium: 3 }, remainingMe: "100" }];
  state.deepSpace.debris = [{ target: { galaxy: 1, system: 50, position: 16 }, metal: "23", crystal: "29" }];
  return state;
}

describe("read-only actual curvature candidate preview", () => {
  it("shows shared-rule gain, actual balances and actual seed-stock without another reset formula", () => {
    const state = rich(), evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.eligible).toBe(true);
    expect(model.gain).toBe(evaluation.gain.toString());
    expect(model.score).toBe(expansionScore(state).toString());
    expect(model.cores.after).toBe(evaluation.next.warpCores.toString());
    expect(model.cores.change).toBe(evaluation.next.warpCores.sub(state.warpCores).toString());
    expect(model.unspent.after).toBe(unspentCores(evaluation.next).toString());
    expect(model.passivePercent.after).toBe(passiveCoreBonus(evaluation.next).mul(100).toString());
    expect(model.newHome).toEqual(Object.fromEntries(Object.entries(evaluation.next.planets[0]!.resources).map(([id, value]) => [id, value.toString()])));
    expect(model.rewards.darkMatter.after).toBe(evaluation.next.darkMatter.toString());
    expect(model.rewards.achievements).toBe(evaluation.next.unlocked.filter(id => !state.unlocked.includes(id)).length);
    expect(model.rewards.tickets).toBe(evaluation.next.arcade.runs.filter(run => !state.arcade.runs.some(old => old.id === run.id)).length);
  });
  it("does not assume nominal gain equals the actual candidate balance or starting inventory", () => {
    const state = base(), evaluation = evaluatePrestige(state);
    const next = { ...evaluation.next, warpCores: state.warpCores.add(11), darkMatter: state.darkMatter.add(7), planets: evaluation.next.planets.map(planet => ({ ...planet, resources: amounts(733, 719, 701) })) };
    const model = prestigePreview(state, { gain: big(3), next });
    expect(model.gain).toBe("3");
    expect(model.cores.change).toBe("11");
    expect(model.newHome).toEqual(money("733", "719", "701"));
    expect(model.rewards.darkMatter.change).toBe("7");
  });
  it("keeps current inventory, remaining paid work and fleet rights separate with no duplicate costs", () => {
    const state = rich(), model = prestigePreview(state, evaluatePrestige(state));
    expect(model.worlds).toEqual({ count: 2, colonies: 1, resources: money("210", "216", "234"), buildingLevels: "12", units: "26" });
    expect(model.paid).toEqual({ buildings: 1, research: 1, shipyard: 1, remainingUnits: "2", buildingPaid: money("61", "17"), researchPaid: money("0", "137", "139"), remainingUnitPaid: money("62", "26") });
    expect(model.fleets).toEqual({ count: 2, ships: "4", cargo: money("14", "22", "26"), unsettledStake: "17", darkMatter: "19", items: { kraken_box: "2" } });
    expect(model.orders.stopped).toBe(2);
    expect(model.orders.releasedWork).toBe(1);
    expect(model.orders.releasedPending).toBe(1);
    expect(model.worlds.resources.deuterium).toBe("234"); // escrow, spent stake and budgets are not bank stock
  });
  it("preserves current design revisions separately from old origins and quoted price history", () => {
    const state = rich(), evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.retained.formations).toBe(1);
    expect(model.retained.templates).toBe(1);
    expect(model.retained.referencedFormations).toBe(1);
    expect(model.orders.formationOrigins).toBe(1);
    const text = model.rows.map(row => row.text).join("\n");
    expect(text).toContain("旧版编成 · 修订 1");
    expect(text).toContain("新版编成 <b> · 修订 3");
    expect(text).toContain("原报价 金属 31 / 晶体 13 / 重氢 0 保留");
    expect(text).toContain("历史计划仍引用，仍阻止直接删除");
    expect(text).toContain("科研 <script> · 修订 2"); // literal text; the panel exclusively uses textContent
    expect(evaluation.next.orders.tasks[1]!.formationOrigin).toEqual(state.orders.tasks[1]!.formationOrigin);
  });
  it("reads actual protocol stop behavior, slot reduction, clocks and retained inventory", () => {
    const state = rich(), evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.protocols).toEqual({ slotsBefore: 7, slotsAfter: 3, enabledAfter: 1, ringCardsStopped: 1, armedBatchStopped: true });
    expect(model.retained.totalTime).toBe("101");
    expect(model.retained.boosters).toBe(1);
    expect(evaluation.next.boosters[0]!.until).toBe(500);
    expect(model.retained.items).toBe(3);
    expect(model.removed).toEqual({ offers: 1, debris: 1 });
    expect(model.retained.researchLevels).toBe(7);
  });
  it("uses actual transport lifecycle and never values historical cargo or fuel as live assets", () => {
    const state = base();
    const phases: OrderTripReceipt["phase"][] = [
      { kind: "outbound" },
      { kind: "returning", outcome: { kind: "delivered" }, dockBlocked: false },
      { kind: "returning", outcome: { kind: "not-delivered", reason: "manual-recall" }, dockBlocked: true },
      { kind: "returned", outcome: { kind: "delivered" } },
    ];
    state.orders.tasks = [{ ...task(1), transport: { authorization: { donorPlanetId: "homeworld", ship: "small_cargo", count: 1, speedPercent: 100, maxTrips: 4, grossCargoCap: money("1e20") }, trips: phases.map((phase, index) => ({ fleetId: index + 1, workId: index + 1, targetPlanetId: "old-colony", target: { galaxy: 1, system: 50, position: 9 }, cargo: money("1e10"), fuel: "1e9", duration: 100, phase })) } }];
    const model = prestigePreview(state, evaluatePrestige(state));
    expect(model.orders).toMatchObject({ retiredTrips: 3, deliveredRetiredTrips: 1, undeliveredRetiredTrips: 1, unresolvedRetiredTrips: 1, returnedTrips: 1 });
    expect(model.fleets.cargo).toEqual(money());
    expect(model.fleets.count).toBe(0);
    expect(model.worlds.resources.metal).toBe(state.planets[0]!.resources.metal.toString());
    expect(model.rows.filter(row => row.kind === "trip")).toHaveLength(4);
    expect(model.rows.find(row => row.text.includes("回执 #4"))!.text).toContain("returned → returned；已交付结果保留");
  });
  it("is pure on deeply frozen state/candidate and performs no entropy, ticking or repricing", () => {
    const state = rich(), evaluation = evaluatePrestige(state);
    const before = serializeState(state), after = serializeState(evaluation.next);
    freeze(state); freeze(evaluation);
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("random forbidden"); });
    const time = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("clock forbidden"); });
    try {
      const first = prestigePreview(state, evaluation);
      expect(prestigePreview(state, evaluation)).toEqual(first);
      expect(prestigeConfirmation(state, evaluation)).toContain(`扩张分 ${first.score}`);
      expect(random).not.toHaveBeenCalled(); expect(time).not.toHaveBeenCalled();
      expect(serializeState(state)).toEqual(before); expect(serializeState(evaluation.next)).toEqual(after);
    } finally { random.mockRestore(); time.mockRestore(); }
  });
  it("explicitly blocks below-threshold launch instead of presenting a zero-loss reset", () => {
    const state = createInitialState(1, 2), evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(evaluation.next).toBe(state);
    expect(model.eligible).toBe(false);
    expect(model.rows).toEqual([]);
    expect(model.worlds.count).toBe(0);
    expect(model.fleets.count).toBe(0);
    expect(model.cores.change).toBe("0");
    expect(prestigeConfirmation(state, evaluation)).toContain("当前无法发射");
    expect(prestigeConfirmation(state, evaluation)).not.toContain("不退款");
  });
  it("truthfully distinguishes a nonzero rule gain from a rounded-away huge-balance increment", () => {
    const state = base(); state.warpCores = big("1e190");
    const evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(evaluation.gain.gt(0)).toBe(true);
    expect(model.gain).toBe(evaluation.gain.toString());
    expect(model.cores.change).toBe("0");
    expect(model.cores.after).toBe("1e+190");
    expect(prestigeConfirmation(state, evaluation)).toContain("实际变化 0");
  });
  it("aggregates all large bounded collections while retaining at most 20 detail rows", () => {
    const state = base();
    state.planets = Array.from({ length: 100 }, (_, index) => { const planet = createPlanet(index ? `colony-${index}` : "homeworld"); planet.resources = amounts(1, 2, 3); planet.units.small_cargo = 4; return planet; });
    state.fleets = Array.from({ length: 1000 }, (_, index) => ({ ...fleet(index + 1), charge: undefined, cargo: emptyCargo() }));
    state.orders.tasks = Array.from({ length: 100 }, (_, index) => ({ ...task(index + 1), status: index < 32 ? "running" : "completed" }));
    const model = prestigePreview(state, evaluatePrestige(state));
    expect(model.worlds.resources).toEqual(money("100", "200", "300"));
    expect(model.worlds.units).toBe("400");
    expect(model.fleets.count).toBe(1000);
    expect(model.fleets.ships).toBe("2000");
    expect(model.orders.stopped).toBe(32);
    expect(model.rows).toHaveLength(PRESTIGE_PREVIEW_ROW_LIMIT);
    expect(model.totalRows).toBe(1200);
    expect(model.omittedRows).toBe(1180);
  });
  it("recomputes confirmation facts from the supplied fresh click state, never an old display", () => {
    const state = base(), displayed = prestigePreview(state, evaluatePrestige(state));
    const changed = { ...state, lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(1e8) }, planets: state.planets.map(planet => ({ ...planet, resources: { ...planet.resources, metal: planet.resources.metal.add(71) } })) };
    const text = prestigeConfirmation(changed, evaluatePrestige(changed));
    expect(text).toContain(`扩张分 ${expansionScore(changed)}`);
    expect(text).not.toContain(`扩张分 ${displayed.score}；`);
    expect(text).toContain("金属 571");
    expect(text).toContain("不退款");
    expect(text).toContain("须重新应用，不自动补船");
  });
});
