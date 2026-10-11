import { describe, expect, it } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import { allocateNpcLoot, isNpcResourceTuple, npcLootEligibility, npcSurvivingWholeCapacity, NPC_WALLET_CAPS, type NpcResourceTuple, type NpcSurvivingShips } from "../src/game/npc-loot";

describe("standalone NPC actual-Number half-loot allocation", () => {
  // Frozen independent integration goldens: /tmp/infinity-npc-loot-golden-contract.json.
  it.each([
    { stock: [50_000, 30_000, 10_000], capacity: 10_950, eligible: [25_000, 15_000, 5_000], loot: [6_084, 3_650, 1_216] },
    { stock: [3.75, 11.5, 7.25], capacity: 5, eligible: [1, 5, 3], loot: [1, 3, 1] },
    { stock: [3.75, 11.5, 7.25], capacity: 100, eligible: [1, 5, 3], loot: [1, 5, 3] },
    { stock: [1.999, 0.75, 0.001], capacity: 5, eligible: [0, 0, 0], loot: [0, 0, 0] },
    { stock: [11.5, 7.25, 3.75], capacity: 0, eligible: [5, 3, 1], loot: [0, 0, 0] },
    { stock: [2, 2, 2], capacity: 2, eligible: [1, 1, 1], loot: [1, 1, 0] },
    { stock: [0, 2, 2], capacity: 1, eligible: [0, 1, 1], loot: [0, 1, 0] },
  ])("matches independent golden %j", ({ stock, capacity, eligible, loot }) => {
    const tuple = stock as unknown as NpcResourceTuple;
    expect(npcLootEligibility(tuple)).toEqual(eligible);
    expect(allocateNpcLoot(tuple, capacity)).toEqual(loot);
    expect(Object.isFrozen(allocateNpcLoot(tuple, capacity))).toBe(true);
  });

  it("sequential arrivals use the actual remainder, not the first arrival's snapshot", () => {
    const stock: NpcResourceTuple = [10, 10, 10];
    const first = allocateNpcLoot(stock, 20);
    expect(first).toEqual([5, 5, 5]);
    const secondStock = stock.map((n, i) => n - first[i]) as unknown as NpcResourceTuple;
    const second = allocateNpcLoot(secondStock, 5);
    expect(second).toEqual([2, 2, 1]);
    expect(secondStock.map((n, i) => n - second[i])).toEqual([3, 3, 4]);
    // Event sorting by fleet ID belongs to integration, not this pure allocator.
  });

  it.each([
    [1.9999999999999998, 0], [2, 1], [2.0000000000000004, 1],
    [1.9999999999999978, 0], [2.0000000000000027, 1], [Number.MIN_VALUE, 0],
  ])("keeps actual represented stock threshold %s -> %s with no epsilon", (deuterium, amount) => {
    const stock: NpcResourceTuple = [0, 0, deuterium];
    expect(allocateNpcLoot(stock, 10)).toEqual([0, 0, amount]);
    expect(stock[2]).toBe(deuterium);
    expect(JSON.parse(JSON.stringify(stock))[2]).toBe(deuterium);
  });

  it("floors finite fractional capacity, without clipping negative inputs to zero", () => {
    expect(allocateNpcLoot([10, 10, 10], 4.99)).toEqual([2, 1, 1]);
    expect(allocateNpcLoot([10, 10, 10], Number.MIN_VALUE)).toEqual([0, 0, 0]);
    expect(allocateNpcLoot(NPC_WALLET_CAPS, Number.MAX_VALUE)).toEqual([25_000, 15_000, 5_000]);
  });

  it("agrees with integer arithmetic and preserves every capacity and half-stock bound", () => {
    for (let m = 0; m <= 7; m += 1) for (let c = 0; c <= 7; c += 1) for (let d = 0; d <= 7; d += 1) {
      const total = m + c + d, eligible = [m, c, d];
      for (let capacity = 0; capacity <= total + 1; capacity += 1) {
        const take = Math.min(total, capacity), expected = total === 0 ? [0, 0, 0]
          : eligible.map(n => Number(BigInt(n) * BigInt(take) / BigInt(total)));
        let remainder = take - expected.reduce((a, b) => a + b, 0);
        for (let i = 0; i < 3 && remainder > 0; i += 1) if (expected[i] < eligible[i]) { expected[i] += 1; remainder -= 1; }
        const stock: NpcResourceTuple = [2 * m + 0.125, 2 * c + 0.25, 2 * d + 0.5];
        const actual = allocateNpcLoot(stock, capacity);
        expect(actual).toEqual(expected);
        expect(actual.reduce((a, b) => a + b, 0)).toBe(take);
        actual.forEach((n, i) => { expect(Number.isSafeInteger(n)).toBe(true); expect(n).toBeLessThanOrEqual(stock[i] / 2); });
      }
    }
  });

  it.each([-1, -0.125, NaN, Infinity, -Infinity, "5", null, undefined])("rejects invalid capacity %s", value => {
    expect(() => allocateNpcLoot([1, 1, 1], value as number)).toThrow(TypeError);
  });

  it.each([null, {}, [], [1, 1], [1, 1, 1, 1], [-0.125, 1, 1], [1, NaN, 1], [1, 1, Infinity],
    [50_001, 1, 1], [1, 30_001, 1], [1, 1, 10_001], [1, "1", 1], new Array(3),
  ].map(value => [value] as const))("rejects malformed stock %j without repair", value => {
    expect(isNpcResourceTuple(value)).toBe(false);
    expect(() => allocateNpcLoot(value as NpcResourceTuple, 5)).toThrow(TypeError);
  });

  it("rejects array accessors, symbols, hidden fields and altered prototypes without evaluating getters", () => {
    let reads = 0;
    const accessor = Object.defineProperty([1, 1, 1], "1", { get() { reads += 1; return 1; } });
    const symbol = Object.assign([1, 1, 1], { [Symbol("extra")]: 0 });
    const hidden = Object.defineProperty([1, 1, 1], "extra", { value: 0 });
    const custom = Object.setPrototypeOf([1, 1, 1], Object.create(Array.prototype));
    for (const value of [accessor, symbol, hidden, custom]) expect(isNpcResourceTuple(value)).toBe(false);
    expect(reads).toBe(0);
  });
});

describe("surviving effective hold only; fuel has no second reservation", () => {
  it("uses the 19LF+2SC survival golden and locked factor", () => {
    const survivors = { light_fighter: 19, small_cargo: 2 };
    const capacity = npcSurvivingWholeCapacity(survivors, 1, NPC_WALLET_CAPS);
    expect(capacity).toBe(10_950);
    expect(allocateNpcLoot(NPC_WALLET_CAPS, capacity)).toEqual([6_084, 3_650, 1_216]);
    expect(npcSurvivingWholeCapacity(survivors, 1.05, NPC_WALLET_CAPS)).toBe(11_497);
  });

  it("caps huge Decimal hold before Number conversion, including very large locked factors", () => {
    expect(npcSurvivingWholeCapacity({ deathstar: 1e12 }, Number.MAX_VALUE, NPC_WALLET_CAPS)).toBe(45_000);
    expect(npcSurvivingWholeCapacity({ deathstar: 1e12 }, 1, [2, 2, 2])).toBe(3);
    expect(npcSurvivingWholeCapacity({}, Number.MAX_VALUE, NPC_WALLET_CAPS)).toBe(0);
  });

  it("supports all 13 flyable catalogue ships, empty survivor maps and canonical summation order", () => {
    for (const id of SHIP_IDS.filter(id => id !== "solar_satellite")) {
      expect(npcSurvivingWholeCapacity({ [id]: 1 }, 1, NPC_WALLET_CAPS)).toBeGreaterThan(0);
    }
    expect(npcSurvivingWholeCapacity({}, 1, NPC_WALLET_CAPS)).toBe(0);
    expect(npcSurvivingWholeCapacity({ heavy_fighter: 1, light_fighter: 1 }, 1, NPC_WALLET_CAPS))
      .toBe(npcSurvivingWholeCapacity({ light_fighter: 1, heavy_fighter: 1 }, 1, NPC_WALLET_CAPS));
  });

  it.each([{ solar_satellite: 0 }, { rocket_launcher: 1 }, { imaginary: 1 }, { light_fighter: -1 },
    { light_fighter: 0.5 }, { light_fighter: 1e12 + 1 }, { light_fighter: Infinity }, { light_fighter: "1" },
    { light_fighter: 1, [Symbol("extra")]: 1 }, Object.create({ light_fighter: 1 }), null, [],
  ].map(value => [value] as const))("rejects malformed survivor map %j", ships => {
    expect(() => npcSurvivingWholeCapacity(ships as NpcSurvivingShips, 1, NPC_WALLET_CAPS)).toThrow(TypeError);
  });

  it.each([0, 0.5, -1, NaN, Infinity, "1", undefined])("rejects invalid locked factor %s", factor => {
    expect(() => npcSurvivingWholeCapacity({}, factor as number, NPC_WALLET_CAPS)).toThrow(TypeError);
  });

  it("rejects a survivor accessor without calling it", () => {
    let reads = 0;
    const ships = Object.defineProperty({}, "light_fighter", { enumerable: true, get() { reads += 1; return 1; } });
    expect(() => npcSurvivingWholeCapacity(ships, 1, NPC_WALLET_CAPS)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
