import { describe, expect, it } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { addInventory, buyShopItem, speedUp, useInventory } from "../src/game/dark-matter";
import { advanceFleets, emptyCargo, recallFleet, type Fleet } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { creditPaidJob } from "../src/game/order-ledger";
import { subtractOrderAmounts } from "../src/game/order-money";
import type { OrderMoney, OrderTarget, PaidJobRef } from "../src/game/order-state";
import { createOrderTask } from "../src/game/orders";
import { createPlanet } from "../src/game/planet";
import { cancel, completeActive, enqueue } from "../src/game/queue";
import { cancelResearch, completeActiveResearch, enqueueResearch } from "../src/game/research";
import { deserializeState, serializeState } from "../src/game/save";
import {
  advanceShipyard, canBuildUnits, cancelUnits, enqueueUnits, exactUnitCost,
  MAX_PLANET_UNITS, nextShipyardEvent, shipOutputCapacity, shipyardPausedReason, unitSeconds,
} from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
import { rich, stateWith, withResearch } from "./helpers";

const budget = (amount = "1000000000"): OrderMoney => ({ metal: amount, crystal: amount, deuterium: amount });
function plan(state: GameState, target: OrderTarget, cap = budget()): { state: GameState; id: number } {
  const id = state.orders.nextTaskId;
  const created = createOrderTask(state, { ...target, expectedNextTaskId: id, budget: cap });
  expect(created.ok).toBe(true);
  return { state: created.state, id };
}
function ready(): GameState {
  return withResearch(rich(stateWith({ research_lab: 3, shipyard: 2 }), 1e7), { combustion_drive: 2 });
}
function shipPlan(count = 5): GameState {
  const created = plan(ready(), { kind: "shipyard", planetId: "homeworld", unit: "light_fighter", quantity: count });
  const queued = enqueueUnits(created.state, "light_fighter", count, "plan", created.id);
  expect(queued.ok).toBe(true);
  return queued.state;
}
function fleet(_state: GameState, ships: Fleet["ships"], overrides: Partial<Fleet> = {}): Fleet {
  return {
    id: 1, originId: "homeworld", target: { galaxy: 1, system: 51, position: 8 },
    mission: "transport", ships, cargo: emptyCargo(), duration: 30, remaining: 30,
    elapsed: 0, returning: true, ...overrides,
  };
}

describe("paid job identities and primitive payment", () => {
  it("issues globally increasing IDs only after successful payment across all queues", () => {
    let state = ready();
    const failed = enqueueUnits(state, "deathstar", 1, "manual");
    expect(failed.ok).toBe(false);
    expect(failed.state.orders.nextJobId).toBe(1);
    const build = enqueue(state, "metal_mine", "manual");
    const study = enqueueResearch(build.state, "energy_tech", "protocol");
    const ship = enqueueUnits(study.state, "light_fighter", 1, "manual");
    state = ship.state;
    expect([build.jobId, study.jobId, ship.jobId]).toEqual([1, 2, 3]);
    expect(activePlanet(state).buildQueue[0]?.taskId).toBeNull();
    expect(state.research.queue[0]?.taskId).toBeNull();
    expect(activePlanet(state).shipyardQueue[0]?.taskId).toBeNull();
    expect(state.orders.nextJobId).toBe(4);
  });

  it("requires a matching running owner and charges each plan primitive exactly once", () => {
    let state = ready();
    const build = plan(state, { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 1 });
    const before = activePlanet(build.state).resources.metal;
    const result = enqueue(build.state, "metal_mine", "plan", build.id);
    expect(result.ok).toBe(true);
    expect(before.sub(activePlanet(result.state).resources.metal).toNumber()).toBe(60);
    expect(result.state.orders.tasks[0]?.charged.metal).toBe("60");
    expect(result.state.orders.tasks[0]?.activeJob).toEqual({ jobId: result.jobId, quantity: 1, credited: 0 });
    const invalid = enqueue(state, "metal_mine", "plan");
    expect(invalid.ok).toBe(false);
    expect(invalid.state.orders.nextJobId).toBe(state.orders.nextJobId);
    expect(activePlanet(invalid.state).resources).toEqual(activePlanet(state).resources);
    expect(enqueue(state, "metal_mine", "manual", 1).ok).toBe(false);
    expect(enqueueResearch(state, "energy_tech", "plan").ok).toBe(false);
    expect(enqueueUnits(state, "light_fighter", 1, "plan").ok).toBe(false);
  });

  it("cannot spend a plan from another planet or on a different target", () => {
    const other = createPlanet("other", { galaxy: 1, system: 50, position: 9 });
    let state = ready();
    state = { ...state, planets: [...state.planets, { ...other, resources: { ...activePlanet(state).resources } }] };
    const created = plan(state, { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 2 });
    const wrongPlanet = enqueue(selectPlanet(created.state, "other"), "metal_mine", "plan", created.id);
    expect(wrongPlanet.ok).toBe(false);
    expect(wrongPlanet.state.orders.tasks[0]?.status).toBe("paused");
    expect(wrongPlanet.state.orders.nextJobId).toBe(1);
    expect(enqueue(created.state, "crystal_mine", "plan", created.id).ok).toBe(false);
  });

  it("keeps manual-only high-value research cancellation and repricing outside the plan ledger bounds", () => {
    let state = withResearch(rich(stateWith({ research_lab: 3 }), 1e220), { energy_tech: 640 });
    const first = enqueueResearch(state, "energy_tech", "manual");
    expect(first.ok).toBe(true);
    const second = enqueueResearch(first.state, "energy_tech", "protocol");
    expect(second.ok).toBe(true);
    state = second.state;
    expect(state.research.queue[1]!.paid.crystal.gt("1e190")).toBe(true);
    const cancelled = cancelResearch(state, 0);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.research.queue[0]?.targetLevel).toBe(641);
    expect(cancelResearch(cancelled.state, 0).ok).toBe(true);
  });

  it("does not consume the exhausted ID sentinel or reject ordinary legacy floating wallets", () => {
    const state = ready();
    const exhausted = { ...state, orders: { ...state.orders, nextJobId: Number.MAX_SAFE_INTEGER } };
    expect(enqueue(exhausted, "metal_mine", "manual").state).toBe(exhausted);
    const huge = rich(state, 1e200);
    expect(enqueue(huge, "metal_mine", "manual").ok).toBe(true);
    const created = plan(huge, { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 1 });
    const failed = enqueue(created.state, "metal_mine", "plan", created.id);
    expect(failed.ok).toBe(false);
    expect(failed.state.orders.tasks[0]?.status).toBe("paused");
    expect(failed.state.orders.nextJobId).toBe(1);
    expect(failed.state.orders.tasks[0]?.charged.metal).toBe("0");
    expect(activePlanet(failed.state).resources).toEqual(activePlanet(huge).resources);
  });
});

describe("exact refunds and transactional repricing", () => {
  it("reprices a paid building plan after cancelling an earlier manual level and telescopes its refund", () => {
    let state = enqueue(ready(), "metal_mine", "manual").state;
    const created = plan(state, { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 2 });
    state = enqueue(created.state, "metal_mine", "plan", created.id).state;
    const oldPaid = activePlanet(state).buildQueue[1]!.paid;
    const repriced = cancel(state, 0);
    expect(repriced.ok).toBe(true);
    const left = activePlanet(repriced.state).buildQueue[0]!;
    expect(left.targetLevel).toBe(1);
    const task = repriced.state.orders.tasks[0]!;
    expect(task.refunded.metal).toBe(subtractOrderAmounts(oldPaid.metal.toString(), left.paid.metal.toString()));
    const done = cancel(repriced.state, 0);
    expect(done.ok).toBe(true);
    expect(done.state.orders.tasks[0]?.refunded).toEqual(done.state.orders.tasks[0]?.charged);
    expect(done.state.orders.tasks[0]?.activeJob).toBeNull();
    expect(done.state.orders.tasks[0]?.status).toBe("paused");
  });

  it("refunds research to each original payer even with a different selected planet", () => {
    let state = ready();
    const other = createPlanet("other", { galaxy: 1, system: 50, position: 9 });
    other.buildings.research_lab = 3;
    other.resources = { metal: big(1e7), crystal: big(1e7), deuterium: big(1e7) };
    state = { ...state, planets: [...state.planets, other] };
    state = enqueueResearch(state, "computer_tech", "manual").state;
    const created = plan(state, { kind: "research", planetId: "other", tech: "computer_tech", targetLevel: 2 });
    state = enqueueResearch(selectPlanet(created.state, "other"), "computer_tech", "plan", created.id).state;
    const result = cancelResearch(state, 0);
    expect(result.ok).toBe(true);
    expect(result.state.activePlanetId).toBe("other");
    expect(result.state.planets[0]!.resources.crystal.toNumber()).toBe(1e7);
    expect(result.state.planets[1]!.resources.crystal.toNumber()).toBe(1e7 - 400);
    expect(result.state.orders.tasks[0]?.refunded.crystal).toBe("400");
    expect(result.state.research.queue[0]?.planetId).toBe("other");
  });

  it("rolls back an earlier payer refund when a later plan reprice cannot reach its huge wallet", () => {
    let state = ready();
    const other = createPlanet("other", { galaxy: 1, system: 50, position: 9 });
    other.buildings.research_lab = 3;
    other.resources = { metal: big(1e7), crystal: big(1e7), deuterium: big(1e7) };
    state = { ...state, planets: [...state.planets, other] };
    state = enqueueResearch(state, "computer_tech", "manual").state;
    const created = plan(state, { kind: "research", planetId: "other", tech: "computer_tech", targetLevel: 2 });
    state = enqueueResearch(selectPlanet(created.state, "other"), "computer_tech", "plan", created.id).state;
    state = rich(state, 1e100);
    const before = serializeState(state);
    const failed = cancelResearch(state, 0);
    expect(failed.ok).toBe(false);
    expect(failed.state).toBe(state);
    expect(serializeState(failed.state)).toEqual(before);
    expect(state.research.queue[1]?.targetLevel).toBe(2);
  });

  it("refunds only unfinished ships using the immutable exact per-unit snapshot", () => {
    let state = shipPlan();
    const snapshot = activePlanet(state).shipyardQueue[0]!.paidPerUnit;
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 2.25).state;
    const receipt = state.orders.tasks[0]!.activeJob!;
    expect(receipt.credited).toBe(2);
    expect(state.orders.tasks[0]?.completedUnits).toBe(2);
    const result = cancelUnits(state, 0);
    expect(result.ok).toBe(true);
    expect(result.state.orders.tasks[0]?.refunded).toEqual(exactUnitCost(snapshot, 3));
    expect(result.state.orders.tasks[0]?.completedUnits).toBe(2);
    expect(result.state.orders.tasks[0]?.activeJob).toBeNull();
    expect(activePlanet(result.state).units.light_fighter).toBe(2);
  });
});

describe("completion provenance inside economic primitives", () => {
  it("credits partial batches once across reloads and ignores duplicate or stale hooks", () => {
    let state = shipPlan();
    const original = activePlanet(state).shipyardQueue[0]!;
    const ref: PaidJobRef = { kind: "shipyard", planetId: "homeworld", jobId: original.jobId, taskId: original.taskId };
    state = advanceShipyard(state, unitSeconds(state, "light_fighter") * 2.5).state;
    state = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
    expect(creditPaidJob(state, ref, 2, false)).toBe(state);
    expect(creditPaidJob(state, ref, 1, false)).toBe(state);
    state = advanceShipyard(state, 100).state;
    expect(state.orders.tasks[0]?.completedUnits).toBe(5);
    expect(state.orders.tasks[0]?.activeJob).toBeNull();
    expect(creditPaidJob(state, ref, 5, true)).toBe(state);
  });

  it("clears building and research receipts in their direct completion primitives", () => {
    const build = plan(ready(), { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 1 });
    const built = completeActive(enqueue(build.state, "metal_mine", "plan", build.id).state).state;
    expect(built.orders.tasks[0]?.activeJob).toBeNull();
    const research = plan(ready(), { kind: "research", planetId: "homeworld", tech: "energy_tech", targetLevel: 1 });
    const studied = completeActiveResearch(enqueueResearch(research.state, "energy_tech", "plan", research.id).state).state;
    expect(studied.orders.tasks[0]?.activeJob).toBeNull();
    expect(studied.research.levels.energy_tech).toBe(1);
  });

  it("dark-matter finishes and all three time-reduction items keep plan receipts synchronized", () => {
    for (const item of ["kraken_bronze", "newtron_bronze", "detroit_bronze"] as const) {
      let state = { ...ready(), darkMatter: big(1e6) };
      if (item === "kraken_bronze") {
        const created = plan(state, { kind: "building", planetId: "homeworld", building: "metal_mine", targetLevel: 1 });
        state = enqueue(created.state, "metal_mine", "plan", created.id).state;
      } else if (item === "newtron_bronze") {
        const created = plan(state, { kind: "research", planetId: "homeworld", tech: "energy_tech", targetLevel: 1 });
        state = enqueueResearch(created.state, "energy_tech", "plan", created.id).state;
      } else state = { ...shipPlan(), darkMatter: big(1e6) };
      const done = buyShopItem(state, item);
      expect(done.ok).toBe(true);
      expect(done.state.orders.tasks[0]?.activeJob).toBeNull();
    }
    const finished = speedUp({ ...shipPlan(), darkMatter: big(1e6) }, "shipyard", "finish");
    expect(finished.state.orders.tasks[0]?.completedUnits).toBe(5);
    let partial = addInventory(shipPlan(10), "detroit_box", 1);
    partial = useInventory(partial, "detroit_box").state;
    expect(partial.orders.tasks[0]?.completedUnits).toBe(3);
    expect(partial.orders.tasks[0]?.activeJob?.credited).toBe(3);
  });
});

describe("prospective ship output limits", () => {
  it("guards manual, protocol and plan payments at the per-planet cap including paid queues", () => {
    let state = ready();
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 1;
    expect(canBuildUnits(state, "light_fighter", 1).ok).toBe(true);
    for (const source of ["manual", "protocol"] as const) {
      const queued = enqueueUnits(state, "light_fighter", 1, source);
      expect(queued.ok).toBe(true);
      const failed = enqueueUnits(queued.state, "light_fighter", 1, source);
      expect(failed.ok).toBe(false);
      expect(failed.state).toBe(queued.state);
    }
    const created = plan(state, { kind: "shipyard", planetId: "homeworld", unit: "light_fighter", quantity: 2 });
    expect(enqueueUnits(created.state, "light_fighter", 2, "plan", created.id).ok).toBe(false);
  });

  it("reserves returning and deployment arrivals without double-counting fleet empire totals", () => {
    let state = ready();
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 2;
    state = { ...state, fleets: [fleet(state, { light_fighter: 2 })] };
    expect(shipOutputCapacity(state, "light_fighter")).toBe(0);
    const deployed = { ...state, fleets: [fleet(state, { light_fighter: 2 }, { returning: false, mission: "deploy", target: { ...activePlanet(state).coordinates }, originId: "other" })] };
    expect(shipOutputCapacity(deployed, "light_fighter")).toBe(0);
    const away = { ...state, fleets: [fleet(state, { light_fighter: 2 }, { returning: false, mission: "deploy" })] };
    // The absent destination returns home and therefore also reserves the origin.
    expect(shipOutputCapacity(away, "light_fighter")).toBe(0);
  });

  it("reserves both deployment ports until arrival or recall resolves the destination", () => {
    let state = ready();
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 2;
    const destination = createPlanet("deploy-target", { galaxy: 1, system: 51, position: 8 });
    destination.units.light_fighter = MAX_PLANET_UNITS - 2;
    destination.buildings.shipyard = 2;
    destination.resources = { metal: big(1e7), crystal: big(1e7), deuterium: big(1e7) };
    state = { ...state, planets: [...state.planets, destination], fleets: [
      fleet(state, { light_fighter: 2 }, { returning: false, mission: "deploy", target: destination.coordinates, elapsed: 5, remaining: 25 }),
    ] };
    expect(shipOutputCapacity(state, "light_fighter")).toBe(0);
    expect(shipOutputCapacity(selectPlanet(state, destination.id), "light_fighter")).toBe(0);
    expect(enqueueUnits(state, "light_fighter", 1, "manual").ok).toBe(false);
    expect(enqueueUnits(selectPlanet(state, destination.id), "light_fighter", 1, "protocol").ok).toBe(false);
    const recalled = recallFleet(state, 1);
    expect(recalled.ok).toBe(true);
    expect(shipOutputCapacity(selectPlanet(recalled.state, destination.id), "light_fighter")).toBe(2);
    const returned = advanceFleets(recalled.state, 5);
    expect(activePlanet(returned).units.light_fighter).toBe(MAX_PLANET_UNITS);
    expect(returned.fleets).toHaveLength(0);
    const arrived = advanceFleets(state, 25);
    expect(arrived.planets[1]!.units.light_fighter).toBe(MAX_PLANET_UNITS);
    expect(shipOutputCapacity(arrived, "light_fighter")).toBe(2);
  });

  it("counts a deployment once in the empire even while reserving both local ports", () => {
    let state = ready();
    const planets = Array.from({ length: 10 }, (_, index) => {
      const planet = createPlanet(`reserve-${index}`, { galaxy: 1, system: 60 + index, position: 8 });
      planet.units.light_fighter = index < 9 ? 1e15 : Number.MAX_SAFE_INTEGER - 9e15 - 3;
      return planet;
    });
    state = { ...state, planets: [...state.planets, ...planets], fleets: [
      fleet(state, { light_fighter: 2 }, { returning: false, mission: "deploy", target: planets[9]!.coordinates }),
    ] };
    expect(shipOutputCapacity(state, "light_fighter")).toBe(1);
    expect(shipOutputCapacity(selectPlanet(state, planets[9]!.id), "light_fighter")).toBe(1);
    expect(canBuildUnits(state, "light_fighter", 1).ok).toBe(true);
  });

  it("bounds each empire ship total and does not mix different ship types", () => {
    let state = ready();
    for (const id of SHIP_IDS) activePlanet(state).units[id] = 1e15;
    activePlanet(state).units.light_fighter = 0;
    expect(canBuildUnits(state, "light_fighter", 1).ok).toBe(true);
    const extra = Array.from({ length: 10 }, (_, index) => {
      const planet = createPlanet(`capacity-${index}`, { galaxy: 1, system: 60 + index, position: 8 });
      planet.units.light_fighter = index < 9 ? 1e15 : Number.MAX_SAFE_INTEGER - 9e15;
      return planet;
    });
    state = { ...state, planets: [...state.planets, ...extra] };
    expect(shipOutputCapacity(state, "light_fighter")).toBe(0);
    expect(canBuildUnits(state, "light_fighter", 1).ok).toBe(false);
  });

  it("retains paid remaining units when a later award consumes capacity and does not spin at time zero", () => {
    let state = shipPlan(3);
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 1;
    const done = advanceShipyard(state, 100);
    state = done.state;
    expect(done.completed).toEqual([{ unit: "light_fighter", count: 1 }]);
    expect(activePlanet(state).units.light_fighter).toBe(MAX_PLANET_UNITS);
    expect(activePlanet(state).shipyardQueue[0]?.count).toBe(2);
    expect(state.orders.tasks[0]?.completedUnits).toBe(1);
    expect(shipyardPausedReason(state)).toContain("安全上限");
    expect(nextShipyardEvent(state)).toBe(Infinity);
    const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
    expect(activePlanet(tick(restored, 100)).shipyardQueue[0]?.count).toBe(2);
    activePlanet(state).units.light_fighter -= 2;
    const resumed = advanceShipyard(state, 100).state;
    expect(resumed.orders.tasks[0]?.completedUnits).toBe(3);
    expect(activePlanet(resumed).shipyardQueue).toHaveLength(0);
  });
});
