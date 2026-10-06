import { describe, expect, it } from "vitest";
import { canEnqueue, cancel, completeActive, enqueue, nextTargetLevel } from "../src/game/queue";
import { usedFields } from "../src/game/planet";
import { stateWith, rich, withResearch } from "./helpers";

describe("build queue", () => {
  it("charges on enqueue and refunds in full on cancel", () => {
    const start = stateWith({}, { metal: 1000, crystal: 1000 });
    const queued = enqueue(start, "metal_mine", "manual");
    expect(queued.ok).toBe(true);
    expect(queued.state.resources.metal.toNumber()).toBe(940);
    expect(queued.state.resources.crystal.toNumber()).toBe(985);
    expect(queued.state.planet.buildQueue).toHaveLength(1);
    const cancelled = cancel(queued.state, 0);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state.resources.metal.toNumber()).toBe(1000);
    expect(cancelled.state.resources.crystal.toNumber()).toBe(1000);
    expect(cancelled.state.planet.buildQueue).toHaveLength(0);
  });

  it("rejects a third order at capacity 2 with a reason", () => {
    let state = rich(stateWith());
    state = enqueue(state, "metal_mine", "manual").state;
    state = enqueue(state, "crystal_mine", "manual").state;
    const third = enqueue(state, "solar_plant", "manual");
    expect(third.ok).toBe(false);
    expect(third.reason).toContain("建造队列已满（2/2）");
    expect(third.state).toBe(state);
  });

  it("queues the same building twice at L+1 and L+2 with different prices", () => {
    let state = rich(stateWith({ metal_mine: 4 }));
    const before = state.resources.metal;
    state = enqueue(state, "metal_mine", "manual").state;
    state = enqueue(state, "metal_mine", "manual").state;
    const [a, b] = state.planet.buildQueue;
    expect(a?.targetLevel).toBe(5);
    expect(b?.targetLevel).toBe(6);
    expect(a?.paid.metal.toNumber()).toBe(Math.floor(60 * 1.5 ** 4));
    expect(b?.paid.metal.toNumber()).toBe(Math.floor(60 * 1.5 ** 5));
    expect(before.sub(state.resources.metal).toNumber()).toBe(303 + 455);
  });

  it("computes duration only when an order starts", () => {
    let state = rich(stateWith({ robotics_factory: 0, metal_mine: 15 }));
    state = enqueue(state, "robotics_factory", "manual").state;
    state = enqueue(state, "metal_mine", "manual").state;
    const waiting = state.planet.buildQueue[1];
    expect(state.planet.buildQueue[0]?.totalSeconds).toBeGreaterThan(0);
    expect(waiting?.totalSeconds).toBe(0);
    const done = completeActive(state);
    expect(done.completed).toEqual({ building: "robotics_factory", level: 1 });
    const started = done.state.planet.buildQueue[0];
    // Metal mine 16 at S=600 with R=1: (M+C)/(2500·1·2) h → ×6 s.
    const m = Math.floor(60 * 1.5 ** 15);
    const c = Math.floor(15 * 1.5 ** 15);
    expect(started?.totalSeconds).toBeCloseTo(((m + c) / (2500 * 2)) * 6, 6);
  });

  it("cancelling an earlier order re-levels later orders of the same building and refunds the difference", () => {
    let state = rich(stateWith({ metal_mine: 4 }));
    state = enqueue(state, "metal_mine", "manual").state; // → 5
    state = enqueue(state, "metal_mine", "manual").state; // → 6
    const metal = state.resources.metal;
    const result = cancel(state, 0);
    const left = result.state.planet.buildQueue[0];
    expect(left?.targetLevel).toBe(5);
    expect(left?.paid.metal.toNumber()).toBe(303);
    expect(left?.totalSeconds).toBeGreaterThan(0);
    // Refund: the cancelled 303 plus the 455 − 303 price difference.
    expect(result.state.resources.metal.sub(metal).toNumber()).toBe(303 + (455 - 303));
  });

  it("refunds may exceed the storage cap", () => {
    let state = stateWith({}, { metal: 9_990, crystal: 600 });
    state = enqueue(state, "metal_mine", "manual").state;
    state = { ...state, resources: { ...state.resources, metal: state.resources.metal.add(60) } };
    const result = cancel(state, 0);
    expect(result.state.resources.metal.toNumber()).toBe(10_050);
  });

  it("checks built prerequisites, not queued ones", () => {
    let state = rich(stateWith({ robotics_factory: 1 }));
    expect(canEnqueue(state, "shipyard").reason).toBe("需要 机器人工厂 等级 2");
    state = enqueue(state, "robotics_factory", "manual").state;
    expect(canEnqueue(state, "shipyard").ok).toBe(false);
    expect(canEnqueue(state, "fusion_reactor").reason).toBe("需要 重氢合成器 等级 5、能源技术 等级 3");
    expect(canEnqueue(rich(stateWith({ deuterium_synth: 5 })), "fusion_reactor").reason).toBe("需要 能源技术 等级 3");
    expect(canEnqueue(rich(withResearch(stateWith({ deuterium_synth: 5 }), { energy_tech: 3 })), "fusion_reactor").ok).toBe(true);
  });

  it("refuses buildings from later phases", () => {
    expect(canEnqueue(rich(stateWith({ shipyard: 2 })), "space_dock").reason).toBe("第 5 阶段开放");
    // The missile silo opens with P3.
    expect(canEnqueue(rich(stateWith({ shipyard: 1 })), "missile_silo").ok).toBe(true);
  });

  it("names the missing resources", () => {
    const check = canEnqueue(stateWith({}, { metal: 10, crystal: 0 }), "metal_mine");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("缺 金属 50.00、晶体 15.00");
  });

  it("counts queued orders against planet fields", () => {
    let state = rich(stateWith({ metal_mine: 100, crystal_mine: 62 }));
    expect(usedFields(state.planet)).toBe(162);
    state = enqueue(state, "solar_plant", "manual").state;
    expect(canEnqueue(state, "solar_plant").reason).toContain("星球格子已满");
  });

  it("next target level includes queued orders", () => {
    let state = rich(stateWith({ solar_plant: 3 }));
    state = enqueue(state, "solar_plant", "manual").state;
    expect(nextTargetLevel(state.planet, "solar_plant")).toBe(5);
  });

  it("manual orders count as manual actions, protocol orders do not", () => {
    const state = rich(stateWith());
    expect(enqueue(state, "metal_mine", "manual").state.stats.manualActions).toBe(1);
    expect(enqueue(state, "metal_mine", "protocol").state.stats.manualActions).toBe(0);
  });
});

describe("enqueue reasons", () => {
  it("points at the storage when the next level costs more than the cap", () => {
    const state = stateWith({ metal_mine: 19 }, { metal: 9000, crystal: 9000 });
    const check = canEnqueue(state, "metal_mine");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("缺 金属");
    expect(check.reason).toContain("先升级金属仓库");
  });

  it("does not mention storage when the cost fits", () => {
    const state = stateWith({ metal_mine: 3 }, { metal: 10, crystal: 10 });
    expect(canEnqueue(state, "metal_mine").reason).not.toContain("仓库");
  });
});
