import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { committedOrderMoney, creditPaidJob, preparePaidJob, refundPaidJob } from "../src/game/order-ledger";
import type { NewPaidJob, OrderMoney, PaidJobRef } from "../src/game/order-state";
import { advanceOrderPlans, cancelOrderTask, cancelPaidJob, createOrderTask, resumeOrderTask } from "../src/game/orders";
import { enqueue } from "../src/game/queue";
import { advanceShipyard, unitSeconds } from "../src/game/shipyard";
import type { GameState } from "../src/game/types";
import { rich, stateWith } from "./helpers";

const budget: OrderMoney = { metal: "1000000", crystal: "1000000", deuterium: "1000000" };
function buildPlan(state = rich(stateWith(), 1e6), cap = budget): GameState {
  return createOrderTask(state, { kind: "building", planetId: state.activePlanetId, building: "metal_mine", targetLevel: 1, expectedNextTaskId: state.orders.nextTaskId, budget: cap }).state;
}
const buildJob = (state: GameState): NewPaidJob => ({ kind: "building", planetId: state.activePlanetId, building: "metal_mine", targetLevel: 1, quantity: 1, source: "plan", taskId: 1 });
const quote = { metal: big(60), crystal: big(15), deuterium: big(0) };
const ref = (state: GameState): PaidJobRef => ({ kind: "building", planetId: state.activePlanetId, jobId: activePlanet(state).buildQueue[0]!.jobId, taskId: 1 });

describe("finite order real payment ledger", () => {
  it("performs a single wallet debit and records the identical quote", () => {
    const state = buildPlan();
    const payment = preparePaidJob(state, buildJob(state), quote);
    expect(payment.ok).toBe(true);
    expect(activePlanet(payment.state).resources.metal.toNumber()).toBeCloseTo(999940, 6);
    expect(payment.state.orders.nextJobId).toBe(2);
    expect(payment.state.orders.tasks[0]?.charged).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
    expect(state.orders.tasks[0]?.charged.metal).toBe("0");
    expect(activePlanet(state).resources.metal.toNumber()).toBe(1e6);
    const enqueued = enqueue(state, "metal_mine", "plan", 1);
    expect(enqueued.ok).toBe(true);
    expect(activePlanet(enqueued.state).resources.metal.toNumber()).toBeCloseTo(999940, 6);
  });
  it("does not consume identifiers or money on cap, target or quantity failure", () => {
    const state = buildPlan(undefined, { ...budget, metal: "59.999999999999999999" });
    const cap = preparePaidJob(state, buildJob(state), quote);
    expect(cap.ok).toBe(false);
    expect(cap.state).toBe(state);
    expect(cap.state.orders.nextJobId).toBe(1);
    const wrong = preparePaidJob(state, { ...buildJob(state), kind: "building", building: "crystal_mine", targetLevel: 1, quantity: 1 }, quote);
    expect(wrong.ok).toBe(false);
    expect(wrong.state.orders.tasks[0]?.status).toBe("paused");
    expect(wrong.state.orders.nextJobId).toBe(1);
    expect(activePlanet(wrong.state).resources).toEqual(activePlanet(state).resources);
  });
  it("keeps legacy manual debit arithmetic while guarding plan wallet representability", () => {
    const state = buildPlan(rich(stateWith(), 1e100));
    const plan = preparePaidJob(state, buildJob(state), quote);
    expect(plan.ok).toBe(false);
    expect(plan.state.orders.tasks[0]?.status).toBe("paused");
    expect(plan.state.orders.nextJobId).toBe(1);
    expect(plan.state.orders.tasks[0]?.charged.metal).toBe("0");
    const manual = preparePaidJob(state, { ...buildJob(state), source: "manual", taskId: null }, quote);
    expect(manual.ok).toBe(true);
    expect(activePlanet(manual.state).resources.metal.eq(activePlanet(state).resources.metal.sub(60))).toBe(true);
  });
  it("rejects exhausted IDs before any debit", () => {
    const start = buildPlan();
    const state = { ...start, orders: { ...start.orders, nextJobId: Number.MAX_SAFE_INTEGER } };
    const result = preparePaidJob(state, buildJob(state), quote);
    expect(result.ok).toBe(false);
    expect(result.state.orders.nextJobId).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.state.orders.tasks[0]?.charged.metal).toBe("0");
  });
  it("releases only successful real refunds and protects stale or oversized refunds", () => {
    const state = advanceOrderPlans(buildPlan(), 10);
    const job = ref(state);
    expect(refundPaidJob(state, { ...job, jobId: job.jobId + 1 }, { metal: "60", crystal: "15", deuterium: "0" }).ok).toBe(false);
    expect(refundPaidJob(state, job, { metal: "61", crystal: "15", deuterium: "0" }).state).toBe(state);
    const done = cancelPaidJob(state, job);
    expect(done.ok).toBe(true);
    expect(done.state.orders.tasks[0]?.status).toBe("paused");
    expect(done.state.orders.tasks[0]?.activeJob).toBeNull();
    expect(committedOrderMoney(done.state.orders.tasks[0]!)).toEqual({ metal: "0", crystal: "0", deuterium: "0" });
    const resumed = advanceOrderPlans(resumeOrderTask(done.state, 1).state, 10);
    expect(resumed.orders.tasks[0]?.charged.metal).toBe("120");
    expect(resumed.orders.tasks[0]?.refunded.metal).toBe("60");
    expect(committedOrderMoney(resumed.orders.tasks[0]!)?.metal).toBe("60");
  });
  it("retains paid work and pauses if a refund cannot move the current wallet", () => {
    const state = advanceOrderPlans(buildPlan(), 10);
    activePlanet(state).resources.metal = big("1e100");
    const result = cancelOrderTask(state, 1);
    expect(result.ok).toBe(false);
    expect(result.state.orders.tasks[0]?.status).toBe("paused");
    expect(result.state.orders.tasks[0]?.refunded.metal).toBe("0");
    expect(result.state.orders.tasks[0]?.activeJob).toEqual(state.orders.tasks[0]?.activeJob);
    expect(activePlanet(result.state).buildQueue).toEqual(activePlanet(state).buildQueue);
    expect(activePlanet(result.state).resources).toEqual(activePlanet(state).resources);
  });
  it("uses cumulative ship credit and ignores duplicate or stale completion hooks", () => {
    let state = rich(stateWith({ shipyard: 1 }), 1e6);
    state = createOrderTask(state, { kind: "shipyard", planetId: state.activePlanetId, unit: "rocket_launcher", quantity: 4, expectedNextTaskId: 1, budget }).state;
    state = advanceOrderPlans(state, 10);
    const batch = activePlanet(state).shipyardQueue[0]!;
    const job: PaidJobRef = { kind: "shipyard", planetId: state.activePlanetId, jobId: batch.jobId, taskId: 1 };
    state = advanceShipyard(state, unitSeconds(state, "rocket_launcher")).state;
    expect(state.orders.tasks[0]?.completedUnits).toBe(1);
    expect(state.orders.tasks[0]?.activeJob?.credited).toBe(1);
    expect(creditPaidJob(state, job, 1, false)).toBe(state);
    expect(creditPaidJob(state, { ...job, jobId: job.jobId + 99 }, 4, true)).toBe(state);
    const cancelled = cancelOrderTask(state, 1);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.orders.tasks[0]?.completedUnits).toBe(1);
    expect(committedOrderMoney(cancelled.state.orders.tasks[0]!)?.metal).toBe("2000");
    expect(creditPaidJob(cancelled.state, job, 4, true)).toBe(cancelled.state);
  });
});
