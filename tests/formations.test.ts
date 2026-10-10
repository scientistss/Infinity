import { describe, expect, it, vi } from "vitest";
import { unitById } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { abandonColony, advanceFleets, emptyCargo, recallFleet, resolveFleetArrivals, sendFleet } from "../src/game/fleet";
import {
  FLYABLE_SHIP_IDS, MAX_FORMATION_AUTHORITY_KEY_LENGTH, normalizeFormationDraft,
  type FormationAction, type FormationDraft, type FormationReplenishmentRequest,
} from "../src/game/formation-state";
import {
  applyFormationAction, createFormation, createFormationReplenishment, deleteFormation, editFormation,
  formationAuthorityKey, previewFormationReplenishment,
} from "../src/game/formations";
import { prestige, tick } from "../src/game/logic";
import { FORMATION_PRICE_REASON, preparePaidJob, zeroOrderMoney } from "../src/game/order-ledger";
import type { CreateOrderRequest } from "../src/game/order-state";
import * as orders from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import { advanceShipyard, cancelUnits, enqueueUnits, MAX_PLANET_UNITS, unitCost, unitSeconds } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

function ready(): GameState { return withResearch(rich(stateWith({ shipyard: 4 }), 1e8), { combustion_drive: 6, computer_tech: 3 }); }
function design(state = ready(), ships: FormationDraft["ships"] = { light_fighter: 10 }): GameState {
  const result = createFormation(state, { expectedNextFormationId: state.formations.nextFormationId, name: "外环守备 🛰️", ships });
  expect(result.ok).toBe(true);
  return result.state;
}
function review(state: GameState, planetId = state.activePlanetId): FormationReplenishmentRequest {
  const result = previewFormationReplenishment(state, { formationId: 1, formationRevision: state.formations.entries[0]!.revision, planetId });
  expect(result.ok, result.reason).toBe(true);
  expect(result.request, result.reason).not.toBeNull();
  return result.request!;
}
function replenish(state: GameState, planetId = state.activePlanetId): GameState {
  const result = createFormationReplenishment(state, review(state, planetId));
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function colony(state: GameState): GameState {
  const coordinate = activePlanet(state).coordinates;
  const planet = createPlanet("formation-colony", { ...coordinate, position: coordinate.position === 15 ? 14 : coordinate.position + 1 });
  planet.buildings.shipyard = 4;
  planet.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
  return { ...state, planets: [...state.planets, planet] };
}
function flight(state: GameState, count: number, mission: "transport" | "deploy" = "transport"): GameState {
  const result = sendFleet(state, { mission, target: state.planets.find(value => value.id === "formation-colony")!.coordinates,
    ships: { light_fighter: count }, cargo: emptyCargo(), speedPercent: 100 });
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

describe("named formations are bounded reusable intent", () => {
  it("canonicalizes flyable counts, trims ordinary names, permits duplicates and never spends", () => {
    const state = ready();
    const request = { expectedNextFormationId: 1, name: "  自由名称 🪐  ", ships: { light_fighter: 2, small_cargo: 3, cruiser: 0 } };
    const result = createFormation(state, request);
    expect(result.ok).toBe(true);
    expect(result.state.planets).toBe(state.planets);
    expect(result.state.orders).toBe(state.orders);
    expect(result.state.fleets).toBe(state.fleets);
    expect(result.state.formations.entries[0]).toEqual({ id: 1, revision: 1, name: "自由名称 🪐", ships: { small_cargo: 3, light_fighter: 2 } });
    request.ships.small_cargo = 999;
    expect(result.state.formations.entries[0]!.ships.small_cargo).toBe(3);
    expect(createFormation(result.state, { expectedNextFormationId: 2, name: "自由名称 🪐", ships: { deathstar: 1 } }).ok).toBe(true);
    expect(createFormation(result.state, request).state).toBe(result.state);
  });
  it("counts Unicode codepoints and applies the same bounded technical name rules as research", () => {
    expect(normalizeFormationDraft({ name: "🪐".repeat(64), ships: { light_fighter: 1 } })).not.toBeNull();
    for (const name of ["", "  ", "🪐".repeat(65), "a\nb", "a\u007fb", " ".repeat(257) + "x"]) {
      expect(normalizeFormationDraft({ name, ships: { light_fighter: 1 } })).toBeNull();
    }
  });
  it.each([{}, { solar_satellite: 1 }, { rocket_launcher: 1 }, { unknown: 1 }, { light_fighter: 0 }, { light_fighter: -1 }, { light_fighter: 1.5 }, { light_fighter: 1_000_001 }, { light_fighter: Infinity }, { light_fighter: "1" }])("rejects invalid ship intent %j", ships => {
    const state = ready();
    expect(createFormation(state, { expectedNextFormationId: 1, name: "x", ships } as unknown as Parameters<typeof createFormation>[1]).state).toBe(state);
  });
  it("rejects hidden authority fields, including origins supplied through ordinary createOrderTask", () => {
    const state = ready();
    expect(applyFormationAction(state, { type: "formation-create", expectedNextFormationId: 1, name: "x", ships: { light_fighter: 1 }, planetId: state.activePlanetId } as unknown as FormationAction).state).toBe(state);
    expect(applyFormationAction(state, { type: "other" } as unknown as FormationAction).state).toBe(state);
    const request: CreateOrderRequest = { kind: "shipyard", planetId: state.activePlanetId, unit: "light_fighter", quantity: 1, expectedNextTaskId: 1, budget: { metal: "3000", crystal: "1000", deuterium: "0" } };
    expect(orders.createOrderTask(state, { ...request, formationOrigin: null } as CreateOrderRequest).state).toBe(state);
    expect(orders.createOrderTask(state, request).state.orders.tasks[0]!.formationOrigin).toBeNull();
  });
  it("enforces 32 designs, exhausted IDs, monotonic deletion and terminal revision", () => {
    let state = ready();
    for (let i = 1; i <= 32; i++) state = createFormation(state, { expectedNextFormationId: i, name: "x", ships: { light_fighter: 1 } }).state;
    expect(createFormation(state, { expectedNextFormationId: 33, name: "x", ships: { light_fighter: 1 } }).state).toBe(state);
    state = deleteFormation(state, { formationId: 1, expectedRevision: 1 }).state;
    expect(state.formations.nextFormationId).toBe(33);
    const max = Number.MAX_SAFE_INTEGER;
    state = { ...state, formations: { nextFormationId: max, entries: [{ id: max - 1, revision: max - 1, name: "x", ships: { light_fighter: 1 } }] } };
    expect(createFormation(state, { expectedNextFormationId: max, name: "x", ships: { light_fighter: 1 } }).state).toBe(state);
    const edited = editFormation(state, { formationId: max - 1, expectedRevision: max - 1, name: "y", ships: { light_fighter: 1 } });
    expect(edited.ok).toBe(true);
    expect(edited.state.formations.entries[0]!.revision).toBe(max);
    expect(editFormation(edited.state, { formationId: max - 1, expectedRevision: max, name: "z", ships: { light_fighter: 1 } }).state).toBe(edited.state);
    expect(deleteFormation(edited.state, { formationId: max - 1, expectedRevision: max }).ok).toBe(true);
  });
  it("edits only future designs, no-op edit does not consume revision, and all retained origins block deletion", () => {
    let state = replenish(design());
    const original = state.orders.tasks[0]!.formationOrigin!;
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(original.formation.ships)).toBe(true);
    expect(editFormation(state, { formationId: 1, expectedRevision: 1, name: "外环守备 🛰️", ships: { light_fighter: 10 } }).state).toBe(state);
    state = editFormation(state, { formationId: 1, expectedRevision: 1, name: "未来队形", ships: { small_cargo: 4 } }).state;
    expect(state.orders.tasks[0]!.formationOrigin).toBe(original);
    expect(original.formation.ships).toEqual({ light_fighter: 10 });
    expect(deleteFormation(state, { formationId: 1, expectedRevision: 2 }).ok).toBe(false);
    state = orders.cancelOrderTask(state, 1).state;
    expect(deleteFormation(state, { formationId: 1, expectedRevision: 2 }).reason).toContain("#1");
    state = orders.dismissOrderTask(state, 1).state;
    expect(deleteFormation(state, { formationId: 1, expectedRevision: 2 }).ok).toBe(true);
  });
});

describe("one reviewed finite replenishment", () => {
  it("uses local stock plus actual paid remaining, ignores flights, unpaid plans and other planets", () => {
    let state = colony(ready());
    activePlanet(state).units.light_fighter = 7;
    state = flight(state, 4);
    state = enqueueUnits(state, "light_fighter", 2, "manual").state;
    state = design(state);
    state.planets[1]!.units.light_fighter = 999;
    const quote = review(state);
    expect(quote.lines).toEqual([{ unit: "light_fighter", quantity: 5, quotedUnitCost: { metal: "3000", crystal: "1000", deuterium: "0" }, budget: { metal: "15000", crystal: "5000", deuterium: "0" } }]);
    const created = createFormationReplenishment(state, quote);
    expect(created.ok).toBe(true);
    expect(created.state.planets).toBe(state.planets);
    expect(created.state.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(created.state.orders.nextWorkId).toBe(state.orders.nextWorkId);
    expect(created.state.orders.tasks[0]).toMatchObject({ kind: "shipyard", quantity: 5, completedUnits: 0, planetId: state.activePlanetId, currentWork: null, transport: null, activeJob: null, charged: zeroOrderMoney(), refunded: zeroOrderMoney() });
    expect(createFormationReplenishment(created.state, quote).state).toBe(created.state);
  });
  it("canonicalizes mixed lines and allocates exact independent budgets, without spending or transport", () => {
    const state = design(ready(), { light_fighter: 5, small_cargo: 2 });
    const request = review(state);
    expect(request.lines.map(line => line.unit)).toEqual(["small_cargo", "light_fighter"]);
    expect(request.totalBudget).toEqual({ metal: "19000", crystal: "9000", deuterium: "0" });
    const result = createFormationReplenishment(state, request);
    expect(result.createdTaskIds).toEqual([1, 2]);
    expect(result.state.orders.tasks.map(task => task.budget)).toEqual([{ metal: "4000", crystal: "4000", deuterium: "0" }, { metal: "15000", crystal: "5000", deuterium: "0" }]);
    request.lines[0]!.budget.metal = "1";
    request.lines[0]!.quotedUnitCost.metal = "1";
    state.formations.entries[0]!.ships.small_cargo = 100;
    expect(result.state.orders.tasks[0]!.formationOrigin!.formation.ships.small_cargo).toBe(2);
    expect(result.state.orders.tasks[0]!.formationOrigin!.quotedUnitCost.metal).toBe("2000");
    expect(result.state.orders.tasks[0]!.budget.metal).toBe("4000");
  });
  it("allows paid completion transferring queue into stock when the economic deficit is unchanged", () => {
    const state = design(enqueueUnits(ready(), "light_fighter", 3, "protocol").state);
    const request = review(state), key = formationAuthorityKey(state, 1, state.activePlanetId);
    const completed = advanceShipyard(state, unitSeconds(state, "light_fighter") * 2).state;
    expect(activePlanet(completed).shipyardQueue[0]!.count).toBe(1);
    expect(activePlanet(completed).shipyardQueue[0]!.orderedCount).toBe(3);
    expect(formationAuthorityKey(completed, 1, completed.activePlanetId)).toBe(key);
    const result = createFormationReplenishment(completed, request);
    expect(result.ok, result.reason).toBe(true);
    expect(result.state.orders.tasks[0]).toMatchObject({ quantity: 7 });
  });
  it("invalidates old review after paid queue cancellation, design edits, payer/world changes or catalog repricing", () => {
    const state = design(enqueueUnits(ready(), "light_fighter", 2, "manual").state), request = review(state);
    const cancelled = cancelUnits(state, 0).state;
    expect(createFormationReplenishment(cancelled, request).state).toBe(cancelled);
    const edited = editFormation(state, { formationId: 1, expectedRevision: 1, name: "changed", ships: { light_fighter: 10 } }).state;
    expect(createFormationReplenishment(edited, request).state).toBe(edited);
    const newWorld = { ...state, stats: { ...state.stats, launches: 1 } };
    expect(createFormationReplenishment(newWorld, request).state).toBe(newWorld);
    const cost = unitById("light_fighter").cost, original = cost.metal;
    try { cost.metal += 1; expect(createFormationReplenishment(state, request).state).toBe(state); }
    finally { cost.metal = original; }
  });
  it("requires whole-group conflict resolution only for positive deficits", () => {
    let state = design(ready(), { small_cargo: 2, light_fighter: 3 });
    state = orders.createOrderTask(state, { kind: "shipyard", unit: "light_fighter", quantity: 5, planetId: state.activePlanetId, expectedNextTaskId: 1, budget: { metal: "15000", crystal: "5000", deuterium: "0" } }).state;
    state = orders.pauseOrderTask(state, 1).state;
    const blocked = previewFormationReplenishment(state, { formationId: 1, formationRevision: 1, planetId: state.activePlanetId });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("#1");
    expect(state.orders.tasks).toHaveLength(1);
    activePlanet(state).units.light_fighter = 3;
    const permitted = review(state);
    expect(permitted.lines.map(line => line.unit)).toEqual(["small_cargo"]);
    expect(createFormationReplenishment(state, permitted).ok).toBe(true);
  });
  it("returns no work and consumes no identity for a completely covered formation", () => {
    const state = design();
    activePlanet(state).units.light_fighter = 10;
    const preview = previewFormationReplenishment(state, { formationId: 1, formationRevision: 1, planetId: state.activePlanetId });
    expect(preview.ok).toBe(true);
    expect(preview.request).toBeNull();
    expect(preview.reason).toContain("无需补船");
    expect(state.orders.nextTaskId).toBe(1);
  });
  it("binds the explicit payer while active planet changes", () => {
    let state = colony(design());
    const homeId = state.activePlanetId, request = review(state, "formation-colony");
    state = createFormationReplenishment(state, request).state;
    const homeWallet = activePlanet(state).resources;
    state = orders.advanceOrderPlans(state, 10);
    expect(state.activePlanetId).toBe(homeId);
    expect(activePlanet(state).resources).toBe(homeWallet);
    expect(state.planets[1]!.shipyardQueue[0]!.taskId).toBe(1);
    expect(state.orders.tasks[0]!.planetId).toBe("formation-colony");
  });
  it("prechecks all IDs and task capacities; no successful prefix escapes a later creator failure", () => {
    const state = design(ready(), { small_cargo: 1, light_fighter: 1 });
    const maxed = { ...state, orders: { ...state.orders, nextTaskId: Number.MAX_SAFE_INTEGER - 1 } };
    expect(previewFormationReplenishment(maxed, { formationId: 1, formationRevision: 1, planetId: state.activePlanetId }).ok).toBe(false);
    const original = orders.createOrderTask, request = review(state);
    const spy = vi.spyOn(orders, "createOrderTask").mockImplementation((candidate, input) => input.kind === "shipyard" && input.unit === "light_fighter" ? { state: candidate, ok: false, reason: "last child failed" } : original(candidate, input));
    try {
      const result = createFormationReplenishment(state, request);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(false);
      expect(result.state).toBe(state);
      expect(result.createdTaskIds).toEqual([]);
      expect(state.orders.nextTaskId).toBe(1);
    } finally { spy.mockRestore(); }
    const sample = orders.createOrderTask(state, { kind: "building", building: "metal_mine", targetLevel: 100, planetId: state.activePlanetId, budget: zeroOrderMoney(), expectedNextTaskId: 1 }).state.orders.tasks[0]!;
    for (const [length, status] of [[99, "cancelled"], [31, "running"]] as const) {
      const full = { ...state, orders: { ...state.orders, nextTaskId: 101, tasks: Array.from({ length }, (_, index) => ({ ...sample, id: index + 1, status })) } };
      expect(previewFormationReplenishment(full, { formationId: 1, formationRevision: 1, planetId: state.activePlanetId }).ok).toBe(false);
    }
  });
  it("rejects exact per-line or group budget overflow before publishing any order", () => {
    const state = design(ready(), { small_cargo: 1, light_fighter: 2 });
    const cost = unitById("light_fighter").cost, original = cost.metal;
    try {
      cost.metal = 1e190;
      const preview = previewFormationReplenishment(state, { formationId: 1, formationRevision: 1, planetId: state.activePlanetId });
      expect(preview.ok).toBe(false);
      expect(preview.request).toBeNull();
      expect(state.orders.nextTaskId).toBe(1);
      expect(state.orders.tasks).toHaveLength(0);
    } finally { cost.metal = original; }
  });
  it("rejects tampered reviewed fields and overlong input without consuming anything", () => {
    const state = design(), base = review(state);
    const mutations = [
      { ...base, expectedAuthorityKey: "x".repeat(MAX_FORMATION_AUTHORITY_KEY_LENGTH + 1) },
      { ...base, totalBudget: { ...base.totalBudget, metal: "1" } },
      { ...base, formationOrigin: { authority: true } },
      { ...base, lines: [{ ...base.lines[0]!, quantity: 9 }] },
      { ...base, lines: [{ ...base.lines[0]!, budget: { ...base.lines[0]!.budget, metal: "1e191" } }] },
      { ...base, lines: [{ ...base.lines[0]!, transport: null }] },
      { ...base, lines: [base.lines[0]!, base.lines[0]!] },
    ];
    for (const request of mutations) expect(createFormationReplenishment(state, request as FormationReplenishmentRequest).state).toBe(state);
  });
  it("authority checks are cheap and do not recalculate exact prices during UI refresh", () => {
    const state = design(ready(), { light_fighter: 4, small_cargo: 2 });
    const cost = unitById("light_fighter").cost, original = cost.metal;
    const key = formationAuthorityKey(state, 1, state.activePlanetId);
    state.orders.accumulator = 9;
    activePlanet(state).resources.metal = big(3);
    expect(formationAuthorityKey(state, 1, state.activePlanetId)).toBe(key);
    try { cost.metal += 1; expect(formationAuthorityKey(state, 1, state.activePlanetId)).not.toBe(key); }
    finally { cost.metal = original; }
    expect(FLYABLE_SHIP_IDS).not.toContain("solar_satellite");
  });
});

describe("formation plans use the real existing paid queue", () => {
  it("pays actual exact batches, credits partial completions, refunds remaining, reloads and finishes only fixed quantity", () => {
    let state = replenish(design(ready(), { light_fighter: 5 }));
    state = orders.advanceOrderPlans(state, 10);
    expect(state.orders.tasks[0]!.charged).toEqual({ metal: "15000", crystal: "5000", deuterium: "0" });
    expect(activePlanet(state).resources.metal.toNumber()).toBe(1e8 - 15000);
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 2).state;
    expect(state.orders.tasks[0]!.completedUnits).toBe(2);
    expect(activePlanet(state).shipyardQueue[0]!.count).toBe(3);
    state = cancelUnits(state, 0).state;
    expect(state.orders.tasks[0]!.refunded).toEqual({ metal: "9000", crystal: "3000", deuterium: "0" });
    expect(state.orders.tasks[0]!.status).toBe("paused");
    state = deserializeState(serializeState(state));
    activePlanet(state).units.light_fighter = 0; // Previously completed hulls are lost; authorization never grows.
    state = orders.advanceOrderPlans(orders.resumeOrderTask(state, 1).state, 10);
    expect(activePlanet(state).shipyardQueue[0]!.count).toBe(3);
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 3).state;
    expect(state.orders.tasks[0]).toMatchObject({ quantity: 5, completedUnits: 5, status: "completed", activeJob: null });
    expect(activePlanet(state).units.light_fighter).toBe(3);
    expect(tick(state, 100).orders.nextJobId).toBe(state.orders.nextJobId);
  });
  it("never expands after unrelated queue cancellation, departures, returns or flight losses", () => {
    let state = colony(ready());
    activePlanet(state).units.light_fighter = 7;
    state = flight(state, 4);
    state = enqueueUnits(state, "light_fighter", 2, "manual").state;
    state = replenish(design(state));
    expect(state.orders.tasks[0]).toMatchObject({ quantity: 5 });
    state = cancelUnits(state, 0).state;
    state = recallFleet(state, state.fleets[0]!.id).state;
    state = resolveFleetArrivals(advanceFleets(state, 1e6));
    expect(activePlanet(state).units.light_fighter).toBe(7);
    state = flight(state, 3);
    state = { ...state, fleets: [] }; // Battle loss does not issue any new authorization.
    state = orders.advanceOrderPlans(state, 10);
    expect(activePlanet(state).shipyardQueue[0]!.count).toBe(5);
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 5).state;
    expect(state.orders.tasks[0]).toMatchObject({ quantity: 5, completedUnits: 5, status: "completed" });
    expect(activePlanet(state).units.light_fighter).toBe(9);
  });
  it("keeps all inflight output reservations in the real payment capacity gate", () => {
    let state = colony(ready());
    activePlanet(state).units.light_fighter = 1;
    state = flight(state, 1);
    state.fleets[0]!.ships.light_fighter = MAX_PLANET_UNITS;
    state = replenish(design(state, { light_fighter: 2 }));
    const next = orders.advanceOrderPlans(state, 10);
    expect(next.orders.tasks[0]!.activeJob).toBeNull();
    expect(next.orders.tasks[0]!.reason).toContain("安全上限");
    expect(next.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(next.orders.tasks[0]).toMatchObject({ quantity: 2, charged: zeroOrderMoney() });
  });
  it.each([0.5, 2])("pauses new payments after catalog price x%s, including direct old-price primitive bypass", factor => {
    const state = replenish(design(ready(), { light_fighter: 2 }));
    const cost = unitById("light_fighter").cost, original = cost.metal;
    const historicalCost = unitCost(unitById("light_fighter"), 2);
    try {
      cost.metal *= factor;
      const scheduled = orders.advanceOrderPlans(state, 10);
      expect(scheduled.orders.tasks[0]!.reason).toBe(FORMATION_PRICE_REASON);
      expect(scheduled.orders.tasks[0]!.status).toBe("paused");
      expect(scheduled.orders.nextJobId).toBe(state.orders.nextJobId);
      expect(activePlanet(scheduled).resources).toEqual(activePlanet(state).resources);
      const primitive = preparePaidJob(state, { kind: "shipyard", planetId: state.activePlanetId, unit: "light_fighter", quantity: 2, source: "plan", taskId: 1 }, historicalCost, { metal: "6000", crystal: "2000", deuterium: "0" });
      expect(primitive.ok).toBe(false);
      expect(primitive.reason).toBe(FORMATION_PRICE_REASON);
      expect(primitive.state.orders.nextJobId).toBe(state.orders.nextJobId);
      expect(activePlanet(primitive.state).resources).toEqual(activePlanet(state).resources);
      expect(enqueueUnits(state, "light_fighter", 2, "plan", 1).ok).toBe(false);
    } finally { cost.metal = original; }
  });
  it("rejects forged exact batch products at the primitive even with valid catalog price", () => {
    const state = replenish(design(ready(), { light_fighter: 2 }));
    const result = preparePaidJob(state, { kind: "shipyard", planetId: state.activePlanetId, unit: "light_fighter", quantity: 2, source: "plan", taskId: 1 }, unitCost(unitById("light_fighter")), { metal: "3000", crystal: "1000", deuterium: "0" });
    expect(result.ok).toBe(false);
    expect(result.state.orders.nextJobId).toBe(1);
    expect(activePlanet(result.state).resources).toEqual(activePlanet(state).resources);
  });
  it.each(["finish", "refund"] as const)("allows historical paid work to %s after catalog changes and reload", outcome => {
    let state = orders.advanceOrderPlans(replenish(design(ready(), { light_fighter: 5 })), 10);
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 2).state;
    const cost = unitById("light_fighter").cost, original = cost.metal;
    try {
      cost.metal = 9999;
      state = deserializeState(serializeState(state));
      expect(activePlanet(state).shipyardQueue[0]!.paidPerUnit.metal.toNumber()).toBe(3000);
      if (outcome === "finish") {
        state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 3).state;
        expect(state.orders.tasks[0]).toMatchObject({ status: "completed", completedUnits: 5, charged: { metal: "15000", crystal: "5000", deuterium: "0" } });
      } else {
        state = cancelUnits(state, 0).state;
        expect(state.orders.tasks[0]!.refunded.metal).toBe("9000");
        state = orders.advanceOrderPlans(orders.resumeOrderTask(state, 1).state, 10);
        expect(state.orders.tasks[0]!.reason).toBe(FORMATION_PRICE_REASON);
        expect(activePlanet(state).shipyardQueue).toHaveLength(0);
      }
    } finally { cost.metal = original; }
  });
  it("waits for requirements, insufficient wallets and full paid queues without changing authorization", () => {
    const locked = replenish(design(stateWith(), { deathstar: 1 }));
    expect(orders.advanceOrderPlans(locked, 10).orders.tasks[0]!.charged).toEqual(zeroOrderMoney());
    let full = ready();
    for (let i = 0; i < 10; i++) full = enqueueUnits(full, "small_cargo", 1, "manual").state;
    full = replenish(design(full, { light_fighter: 2 }));
    expect(orders.advanceOrderPlans(full, 10).orders.tasks[0]!.activeJob).toBeNull();
    expect(orders.advanceOrderPlans(full, 10).orders.tasks[0]!.reason).toContain("队列已满");
  });
  it("preserves designs and terminal origin history through prestige, including retired colony payer", () => {
    let state = colony(design());
    state = replenish(state, "formation-colony");
    state = { ...state, lifetime: { metal: big(1e12), crystal: big(1e12), deuterium: big(1e12) } };
    const origin = state.orders.tasks[0]!.formationOrigin;
    const launched = prestige(state);
    expect(launched.stats.launches).toBe(state.stats.launches + 1);
    expect(launched.formations).toEqual(state.formations);
    expect(launched.formations.entries[0]!.ships).not.toBe(state.formations.entries[0]!.ships);
    expect(launched.orders.tasks[0]).toMatchObject({ status: "cancelled", planetId: "formation-colony", formationOrigin: origin });
    const reloaded = deserializeState(serializeState(launched));
    expect(deleteFormation(reloaded, { formationId: 1, expectedRevision: 1 }).ok).toBe(false);
    expect(createInitialState().formations).toEqual({ nextFormationId: 1, entries: [] });
  });
  it("retains terminal origin audit after ordinary colony abandonment until history is dismissed", () => {
    let state = colony(design(ready(), { light_fighter: 1 }));
    state = replenish(state, "formation-colony");
    state = orders.advanceOrderPlans(state, 10);
    state = selectPlanet(state, "formation-colony");
    state = advanceShipyard(state, unitSeconds(state, "light_fighter")).state;
    expect(state.orders.tasks[0]!.status).toBe("completed");
    const abandoned = abandonColony(state, "formation-colony");
    expect(abandoned.ok).toBe(true);
    state = deserializeState(serializeState(abandoned.state));
    expect(deleteFormation(state, { formationId: 1, expectedRevision: 1 }).ok).toBe(false);
    state = orders.dismissOrderTask(state, 1).state;
    expect(deleteFormation(state, { formationId: 1, expectedRevision: 1 }).ok).toBe(true);
  });
});
