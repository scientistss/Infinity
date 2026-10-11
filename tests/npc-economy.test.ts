import { describe, expect, it, vi } from "vitest";
import {
  advanceNpcEconomy, createNpcEconomyState, isNpcEconomyState, npcEconomySnapshot,
  MAX_NPC_ECONOMY_SECONDS, NPC_ECONOMY_CAPACITY, NPC_ECONOMY_INITIAL_STOCK,
  NPC_ECONOMY_MODEL, NPC_ECONOMY_PRODUCTION_PER_SECOND, type NpcEconomyState,
} from "../src/game/npc-economy";

const resourceIds = ["metal", "crystal", "deuterium"] as const;
function at(elapsedSeconds: number): NpcEconomyState { return { model: NPC_ECONOMY_MODEL, elapsedSeconds }; }

describe("standalone NPC fixed-production baseline", () => {
  it("freezes the single model and starts each new standalone state at zero", () => {
    expect(NPC_ECONOMY_MODEL).toBe("fixed-production-v1");
    expect(MAX_NPC_ECONOMY_SECONDS).toBe(11_900);
    expect(NPC_ECONOMY_INITIAL_STOCK).toEqual({ metal: 500, crystal: 250, deuterium: 0 });
    expect(NPC_ECONOMY_PRODUCTION_PER_SECOND).toEqual({ metal: 5, crystal: 2.5, deuterium: 1 });
    expect(NPC_ECONOMY_CAPACITY).toEqual({ metal: 50_000, crystal: 30_000, deuterium: 10_000 });
    const first = createNpcEconomyState(), second = createNpcEconomyState();
    expect(first).toEqual({ model: "fixed-production-v1", elapsedSeconds: 0 });
    expect(second).toEqual(first); expect(second).not.toBe(first);
    for (const value of [first, NPC_ECONOMY_INITIAL_STOCK, NPC_ECONOMY_PRODUCTION_PER_SECOND, NPC_ECONOMY_CAPACITY]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  // Handwritten design goldens, never generated through the production implementation.
  const goldens = [
    { age: 0, stock: [500, 250, 0], produced: [0, 0, 0], full: [false, false, false] },
    { age: 0.25, stock: [501.25, 250.625, 0.25], produced: [1.25, 0.625, 0.25], full: [false, false, false] },
    { age: 60, stock: [800, 400, 60], produced: [300, 150, 60], full: [false, false, false] },
    { age: 7_200, stock: [36_500, 18_250, 7_200], produced: [36_000, 18_000, 7_200], full: [false, false, false] },
    { age: 9_900, stock: [50_000, 25_000, 9_900], produced: [49_500, 24_750, 9_900], full: [true, false, false] },
    { age: 10_000, stock: [50_000, 25_250, 10_000], produced: [49_500, 25_000, 10_000], full: [true, false, true] },
    { age: 11_900, stock: [50_000, 30_000, 10_000], produced: [49_500, 29_750, 10_000], full: [true, true, true] },
  ];
  for (const golden of goldens) it(`matches the exact independent design values at ${golden.age} seconds`, () => {
    const snapshot = npcEconomySnapshot(at(golden.age));
    expect(snapshot.model).toBe("fixed-production-v1"); expect(snapshot.elapsedSeconds).toBe(golden.age);
    expect(resourceIds.map(id => snapshot.resources[id])).toEqual(golden.stock);
    expect(resourceIds.map(id => snapshot.produced[id])).toEqual(golden.produced);
    expect(resourceIds.map(id => snapshot.full[id])).toEqual(golden.full);
    expect(snapshot.capacity).toEqual({ metal: 50_000, crystal: 30_000, deuterium: 10_000 });
    expect(snapshot.productionPerSecond).toEqual({ metal: 5, crystal: 2.5, deuterium: 1 });
    for (const id of resourceIds) {
      expect(snapshot.resources[id] - NPC_ECONOMY_INITIAL_STOCK[id]).toBe(snapshot.produced[id]);
      expect(snapshot.resources[id]).toBeLessThanOrEqual(snapshot.capacity[id]);
    }
  });

  const boundaries = [
    { age: 9_899.75, stock: [49_998.75, 24_999.375, 9_899.75], full: [false, false, false] },
    { age: 9_900.25, stock: [50_000, 25_000.625, 9_900.25], full: [true, false, false] },
    { age: 9_999.75, stock: [50_000, 25_249.375, 9_999.75], full: [true, false, false] },
    { age: 10_000.25, stock: [50_000, 25_250.625, 10_000], full: [true, false, true] },
    { age: 11_899.75, stock: [50_000, 29_999.375, 10_000], full: [true, false, true] },
  ];
  for (const golden of boundaries) it(`caps resources independently near ${golden.age} seconds`, () => {
    const snapshot = npcEconomySnapshot(at(golden.age));
    expect(resourceIds.map(id => snapshot.resources[id])).toEqual(golden.stock);
    expect(resourceIds.map(id => snapshot.full[id])).toEqual(golden.full);
  });

  it("bounds the age after long adopted steps without crediting overflow as production", () => {
    const initial = createNpcEconomyState();
    for (const seconds of [11_900, 11_900.25, 28_800, 100_000, Number.MAX_VALUE]) {
      const state = advanceNpcEconomy(initial, seconds), snapshot = npcEconomySnapshot(state);
      expect(state).toEqual(at(11_900)); expect(isNpcEconomyState(state)).toBe(true);
      expect(snapshot.resources).toEqual({ metal: 50_000, crystal: 30_000, deuterium: 10_000 });
      expect(snapshot.produced).toEqual({ metal: 49_500, crystal: 29_750, deuterium: 10_000 });
      expect(snapshot.full).toEqual({ metal: true, crystal: true, deuterium: true });
      expect(advanceNpcEconomy(state, Number.MAX_VALUE)).toBe(state);
    }
    expect(initial).toEqual(at(0));
    expect(advanceNpcEconomy(at(11_899.75), 0.5)).toEqual(at(11_900));
  });

  it("keeps exactly representable partitions and a JSON interruption exactly equivalent", () => {
    let partitioned = createNpcEconomyState();
    for (let i = 0; i < 240; i += 1) {
      partitioned = advanceNpcEconomy(partitioned, 0.25);
      if (i === 119) {
        const reloaded: unknown = JSON.parse(JSON.stringify(partitioned));
        expect(isNpcEconomyState(reloaded)).toBe(true);
        if (!isNpcEconomyState(reloaded)) throw new Error("Expected standalone JSON state");
        partitioned = reloaded;
      }
    }
    const single = advanceNpcEconomy(createNpcEconomyState(), 60);
    expect(partitioned).toEqual(single);
    expect(npcEconomySnapshot(partitioned)).toEqual(npcEconomySnapshot(single));
    expect(npcEconomySnapshot(partitioned).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
  });

  it("keeps ordinary decimal partitions within a fixed, declared native-number tolerance", () => {
    // Fixed before execution: age <= 1e-9 s and each stock <= 1e-8 units from this independent target.
    let partitioned = createNpcEconomyState();
    for (let i = 0; i < 10_000; i += 1) partitioned = advanceNpcEconomy(partitioned, 0.1);
    const snapshot = npcEconomySnapshot(partitioned);
    expect(Math.abs(partitioned.elapsedSeconds - 1_000)).toBeLessThanOrEqual(1e-9);
    const expected = { metal: 5_500, crystal: 2_750, deuterium: 1_000 };
    for (const id of resourceIds) expect(Math.abs(snapshot.resources[id] - expected[id])).toBeLessThanOrEqual(1e-8);
  });

  it("does not round tiny positive fractional steps into whole seconds or resource units", () => {
    const state = advanceNpcEconomy(createNpcEconomyState(), 2 ** -10);
    expect(state.elapsedSeconds).toBe(0.0009765625);
    expect(npcEconomySnapshot(state).resources).toEqual({ metal: 500.0048828125, crystal: 250.00244140625, deuterium: 0.0009765625 });
  });

  it("preserves identity when a positive step is below the current age's representable increment", () => {
    const state = Object.freeze(at(8_192)), step = 2 ** -42;
    // The next binary64 number above 2^13 is 2^-39 away; this positive step is smaller than half that gap.
    expect(step).toBeGreaterThan(0); expect(Number.isFinite(step)).toBe(true);
    expect(state.elapsedSeconds + step).toBe(state.elapsedSeconds);
    expect(advanceNpcEconomy(state, step)).toBe(state);
    expect(npcEconomySnapshot(state).resources).toEqual({ metal: 41_460, crystal: 20_730, deuterium: 8_192 });
  });

  it("treats zero, negative, nonfinite and runtime nonnumber steps as unchanged states", () => {
    const state = Object.freeze(at(60));
    const invalidSteps: unknown[] = [0, -0, -0.25, -1, -Number.MAX_VALUE, NaN, Infinity, -Infinity, undefined, null, true, "60", {}, []];
    for (const step of invalidSteps) {
      expect(advanceNpcEconomy(state, step as number)).toBe(state);
      expect(npcEconomySnapshot(state).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
    }
  });

  it("observes and advances without mutation, wall-clock reads or random-number consumption", () => {
    const state = Object.freeze(at(60)), before = JSON.stringify(state);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("NPC economy must not read wall time"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("NPC economy must not consume RNG"); });
    try {
      const first = npcEconomySnapshot(state), nextState = advanceNpcEconomy(state, 60), next = npcEconomySnapshot(nextState);
      expect(first).toEqual(npcEconomySnapshot(state)); expect(first).not.toBe(npcEconomySnapshot(state));
      expect(first.resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
      expect(next.resources).toEqual({ metal: 1_100, crystal: 550, deuterium: 120 });
      expect(JSON.stringify(state)).toBe(before); expect(nextState).not.toBe(state);
      expect(clock).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
      for (const value of [first, first.resources, first.produced, first.full, first.capacity, first.productionPerSecond, nextState]) {
        expect(Object.isFrozen(value)).toBe(true);
      }
      expect(first.resources).not.toBe(next.resources);
    } finally { clock.mockRestore(); random.mockRestore(); }
  });
});

describe("strict standalone NPC state validation", () => {
  it("accepts finite bounded fractional ages, frozen and null-prototype data objects", () => {
    for (const age of [0, -0, Number.MIN_VALUE, 0.25, 60, 7_200, 11_899.999, 11_900]) {
      expect(isNpcEconomyState(at(age))).toBe(true);
      expect(isNpcEconomyState(Object.freeze(at(age)))).toBe(true);
      expect(isNpcEconomyState(Object.assign(Object.create(null), at(age)))).toBe(true);
    }
    expect(isNpcEconomyState(Object.defineProperty({ model: NPC_ECONOMY_MODEL }, "elapsedSeconds", { value: 0 }))).toBe(true);
  });

  it("accepts negative zero numerically without changing the queried input", () => {
    const state = Object.freeze(at(-0));
    expect(isNpcEconomyState(state)).toBe(true);
    expect(npcEconomySnapshot(state)).toEqual(npcEconomySnapshot(at(0)));
    expect(Object.is(npcEconomySnapshot(state).elapsedSeconds, 0)).toBe(true);
    for (const step of [0, -0, -1, NaN, Infinity]) {
      const next = advanceNpcEconomy(state, step);
      expect(next).toBe(state); expect(Object.is(next.elapsedSeconds, -0)).toBe(true);
    }
    expect(advanceNpcEconomy(state, 0.25)).toEqual(at(0.25));
    expect(Object.is(state.elapsedSeconds, -0)).toBe(true);
    // JSON preserves the numeric value, not the original sign or textual spelling of zero.
    expect(JSON.stringify(state)).toBe(JSON.stringify(at(0)));
  });

  const invalidStates: [string, unknown][] = [
    ["undefined", undefined], ["null", null], ["boolean", false], ["number", 0], ["string", "fixed-production-v1"],
    ["array", []], ["empty object", {}], ["missing age", { model: NPC_ECONOMY_MODEL }],
    ["missing model", { elapsedSeconds: 0 }], ["unknown model", { model: "fixed-production-v2", elapsedSeconds: 0 }],
    ["numeric model", { model: 1, elapsedSeconds: 0 }], ["extra field", { ...at(0), resources: {} }],
    ["symbol field", { ...at(0), [Symbol("extra")]: true }], ["nested state", { npcEconomy: at(0) }],
    ["negative age", at(-0.25)], ["too old", at(11_900.25)],
    ["NaN age", at(NaN)], ["positive infinity", at(Infinity)], ["negative infinity", at(-Infinity)],
    ["string age", { model: NPC_ECONOMY_MODEL, elapsedSeconds: "0" }],
    ["null age", { model: NPC_ECONOMY_MODEL, elapsedSeconds: null }],
    ["boolean age", { model: NPC_ECONOMY_MODEL, elapsedSeconds: false }],
    ["inherited state", Object.create(at(0))],
    ["custom prototype", Object.assign(Object.create({ extra: true }), at(0))],
    ["nonenumerable extra", Object.defineProperty(at(0), "extra", { value: 0 })],
  ];
  for (const [label, input] of invalidStates) it(`rejects ${label} without silently repairing it`, () => {
    expect(isNpcEconomyState(input)).toBe(false);
    expect(() => npcEconomySnapshot(input as NpcEconomyState)).toThrow(new TypeError("Invalid NPC economy state"));
    for (const step of [0, -1, NaN, 60]) {
      expect(() => advanceNpcEconomy(input as NpcEconomyState, step)).toThrow(new TypeError("Invalid NPC economy state"));
    }
  });

  it("rejects accessor fields without invoking them", () => {
    let reads = 0;
    for (const field of ["model", "elapsedSeconds"] as const) {
      const state = Object.defineProperty(at(0), field, { enumerable: true, get: () => { reads += 1; throw new Error("Accessor must not run"); } });
      expect(isNpcEconomyState(state)).toBe(false);
      expect(() => npcEconomySnapshot(state)).toThrow(new TypeError("Invalid NPC economy state"));
      expect(() => advanceNpcEconomy(state, 60)).toThrow(new TypeError("Invalid NPC economy state"));
    }
    expect(reads).toBe(0);
  });
});
