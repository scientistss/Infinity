import { describe, expect, it } from "vitest";
import { equipCard, setProductionPct } from "../src/automation/engine";
import { catchUp } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { storageCapacity } from "../src/game/formulas";
import { emptyTickLog, prestige, tick, type TickLog } from "../src/game/logic";
import { cancel, enqueue } from "../src/game/queue";
import type { GameState } from "../src/game/types";
import { relErr, rich, stateWith } from "./helpers";

function withCard(state: GameState, cardId: Parameters<typeof equipCard>[2], index = 0): GameState {
  const unlocked = { ...state, unlockedCards: [...state.unlockedCards, cardId as GameState["unlockedCards"][number]] };
  const result = equipCard(unlocked, index, cardId);
  expect(result.status.startsWith("已装配")).toBe(true);
  return result.state;
}

describe("production", () => {
  it("a new planet makes base 30/15 per hour × S (5/s and 2.5/s at S=600)", () => {
    const eco = economy(stateWith());
    expect(eco.gross.metal).toBeCloseTo(5, 9);
    expect(eco.gross.crystal).toBeCloseTo(2.5, 9);
    expect(eco.gross.deuterium).toBe(0);
  });

  it("energy shortage scales mine output proportionally", () => {
    const full = economy(stateWith({ metal_mine: 10, solar_plant: 20 }));
    expect(full.efficiency).toBe(1);
    const short = economy(stateWith({ metal_mine: 10, solar_plant: 5 }));
    const eff = short.supply / short.demand;
    expect(short.efficiency).toBeCloseTo(eff, 12);
    const mineFull = full.gross.metal - 5;
    const mineShort = short.gross.metal - 5;
    expect(mineShort / mineFull).toBeCloseTo(eff, 9);
  });

  it("0% production removes both output and energy use of that mine", () => {
    let state = stateWith({ metal_mine: 10, crystal_mine: 8, solar_plant: 12 });
    const before = economy(state);
    state = setProductionPct(state, "metal_mine", 0);
    const after = economy(state);
    expect(after.gross.metal).toBeCloseTo(5, 9); // base production only
    expect(after.demand).toBeCloseTo(before.demand - 10 * 10 * 1.1 ** 10, 9);
  });

  it("fusion burns deuterium and is derated when the tank is empty", () => {
    const running = economy(stateWith({ deuterium_synth: 5, fusion_reactor: 5, metal_mine: 10 }, { deuterium: 1000 }));
    expect(running.fusionFactor).toBe(1);
    expect(running.consumption.deuterium).toBeGreaterThan(0);
    const dry = economy(stateWith({ deuterium_synth: 1, fusion_reactor: 10, metal_mine: 10 }, { deuterium: 0 }));
    expect(dry.fusionFactor).toBeLessThan(1);
    expect(dry.net.deuterium).toBe(0);
    expect(dry.consumption.deuterium).toBeCloseTo(dry.gross.deuterium, 6);
  });
});

describe("storage caps", () => {
  it("mines stop at the cap and lifetime counts only real output", () => {
    const state = stateWith({ metal_mine: 5, solar_plant: 5 }, { metal: 9_000, crystal: 0 });
    const rate = economy(state).net.metal;
    const after = tick(state, 3600);
    expect(after.resources.metal.toNumber()).toBe(10_000);
    expect(after.lifetime.metal.toNumber()).toBeCloseTo(1_000, 6);
    expect(after.stats.seenStorageFull).toBe(true);
    expect(rate).toBeGreaterThan(0);
    expect(economy(after).net.metal).toBe(0);
    expect(economy(after).stopped.metal).toBe(true);
  });

  it("a refund above the cap is kept, and mines stay stopped until stock drops below it", () => {
    let state = stateWith({ metal_mine: 5, solar_plant: 5 }, { metal: 9_990, crystal: 1000 });
    state = enqueue(state, "metal_mine", "manual").state;
    state = tick(state, 0.5);
    state = { ...state, resources: { ...state.resources, metal: big(10_000) } };
    state = cancel(state, 0).state;
    const over = state.resources.metal.toNumber();
    expect(over).toBeGreaterThan(10_000);
    const later = tick(state, 600);
    expect(later.resources.metal.toNumber()).toBe(over);
    expect(later.lifetime.metal.sub(state.lifetime.metal).toNumber()).toBe(0);
  });

  it("caps follow the storage level", () => {
    const eco = economy(stateWith({ metal_storage: 3, crystal_storage: 1, deuterium_tank: 7 }));
    expect(eco.caps).toEqual({ metal: storageCapacity(3), crystal: 20_000, deuterium: 865_000 });
  });
});

describe("tick", () => {
  it("one long tick equals many short ones (relative error < 1e-9, same builds)", () => {
    let start = rich(stateWith({ metal_mine: 12, crystal_mine: 10, deuterium_synth: 6, solar_plant: 14, robotics_factory: 2 }), 0);
    start = { ...start, resources: { metal: big(200_000), crystal: big(120_000), deuterium: big(30_000) } };
    start = enqueue(start, "metal_mine", "manual").state;
    start = enqueue(start, "crystal_mine", "manual").state;
    start = withCard(start, "queue_scheduler");

    const longLog: TickLog = emptyTickLog();
    const long = tick(start, 3600, "live", longLog);
    const shortLog: TickLog = emptyTickLog();
    let short = start;
    for (let i = 0; i < 3600; i += 1) short = tick(short, 1, "live", shortLog);

    for (const id of ["metal", "crystal", "deuterium"] as const) {
      expect(relErr(long.resources[id].toNumber(), short.resources[id].toNumber())).toBeLessThan(1e-9);
      expect(relErr(long.lifetime[id].toNumber(), short.lifetime[id].toNumber())).toBeLessThan(1e-9);
    }
    expect(longLog.completedBuilds.length).toBeGreaterThan(2);
    expect(shortLog.completedBuilds).toEqual(longLog.completedBuilds);
    expect(long.planet.buildings).toEqual(short.planet.buildings);
    expect(long.totalTime.toNumber()).toBeCloseTo(3600, 9);
  });

  it("is pure", () => {
    const start = enqueue(rich(stateWith()), "metal_mine", "manual").state;
    const snapshot = JSON.stringify(start);
    tick(start, 100);
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it("completes a queued build after its build time", () => {
    let state = rich(stateWith({ metal_mine: 9 }));
    state = enqueue(state, "metal_mine", "manual").state;
    const seconds = state.planet.buildQueue[0]?.totalSeconds ?? 0;
    expect(seconds).toBeGreaterThan(1);
    expect(tick(state, seconds - 0.01).planet.buildings.metal_mine).toBe(9);
    const done = tick(state, seconds + 0.01);
    expect(done.planet.buildings.metal_mine).toBe(10);
    expect(done.planet.buildQueue).toHaveLength(0);
    expect(done.stats.buildsCompleted).toBe(1);
    expect(done.stats.seenQueueIdle).toBe(true);
  });
});

describe("offline", () => {
  it("2 hours away finishes several queued builds and lists them", () => {
    let state = rich(stateWith({ metal_mine: 18, crystal_mine: 15, robotics_factory: 10 }));
    state = enqueue(state, "metal_mine", "manual").state;
    state = enqueue(state, "metal_mine", "manual").state;
    state = withCard(state, "queue_scheduler");
    const result = catchUp(state, 7200);
    expect(result.appliedSeconds).toBe(7200);
    expect(result.completedBuilds.length).toBeGreaterThan(2);
    expect(result.completedBuilds[0]).toEqual({ building: "metal_mine", level: 19 });
    expect(result.completedBuilds[1]).toEqual({ building: "metal_mine", level: 20 });
    expect(result.state.planet.buildings.metal_mine).toBeGreaterThanOrEqual(20);
  });

  it("caps offline time at 2 hours", () => {
    const result = catchUp(stateWith(), 10 * 3600);
    expect(result.capped).toBe(true);
    expect(result.appliedSeconds).toBe(7200);
  });
});

describe("protocol cards", () => {
  it("auto build enqueues one level", () => {
    let state = rich(stateWith({ metal_mine: 10 }));
    state = withCard(state, "auto_build");
    const after = tick(state, 5);
    const queued = after.planet.buildQueue.filter((o) => o.building === "metal_mine").length;
    const built = after.planet.buildings.metal_mine - 10;
    expect(queued + built).toBe(1);
    expect(after.protocols.slots[0]?.lamp).toBe("green");
  });

  it("queue scheduler refills the queue when a slot frees, and names the missing resource", () => {
    let state = rich(stateWith({ robotics_factory: 10, metal_mine: 19 }));
    state = withCard(state, "queue_scheduler");
    // One order per pass: one after 1 s, the queue is full (2/2) after 2 s.
    expect(tick(state, 1).planet.buildQueue.length).toBe(1);
    const filled = tick(state, 2);
    expect(filled.planet.buildQueue.map((o) => o.targetLevel)).toEqual([20, 21]);
    // When the head finishes, the event pass refills the free slot at once.
    const head = filled.planet.buildQueue[0]?.remainingSeconds ?? 0;
    const refilled = tick(filled, head + 1e-6);
    expect(refilled.planet.buildings.metal_mine).toBe(20);
    expect(refilled.planet.buildQueue.map((o) => o.targetLevel)).toEqual([21, 22]);
    const poor = withCard(stateWith({ robotics_factory: 1, metal_mine: 5 }, { metal: 0, crystal: 0 }), "queue_scheduler");
    const red = tick(poor, 1);
    expect(red.protocols.slots[0]?.lamp).toBe("red");
    expect(red.protocols.slots[0]?.reason).toContain("缺 金属");
  });

  it("production tuner sets a production percentage when storage fills", () => {
    let state = stateWith({ metal_mine: 5, solar_plant: 5 }, { metal: 9_990 });
    state = withCard(state, "production_tuner");
    const after = tick(state, 30);
    expect(after.planet.productionPct.metal_mine).toBe(0);
  });
});

describe("launch", () => {
  it("resets buildings and queue to the 500/500 start, keeps cards and curvature", () => {
    let state = rich(stateWith({ metal_mine: 20, robotics_factory: 4 }));
    state = enqueue(state, "metal_mine", "manual").state;
    state = withCard(state, "auto_build");
    state = { ...state, lifetime: { metal: big(5e6), crystal: big(0), deuterium: big(0) }, curvature: { ...state.curvature, manual_ten: 1 } };
    const next = prestige(state);
    expect(next.warpCores.toNumber()).toBe(2);
    expect(next.planet.buildings.metal_mine).toBe(0);
    expect(next.planet.buildQueue).toHaveLength(0);
    expect(next.resources.metal.toNumber()).toBe(500);
    expect(next.resources.crystal.toNumber()).toBe(500);
    expect(next.protocols.slots[0]?.card?.id).toBe("auto_build");
    expect(next.curvature.manual_ten).toBe(1);
  });
});
