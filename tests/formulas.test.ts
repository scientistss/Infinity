import { describe, expect, it } from "vitest";
import { BUILDINGS, buildingById } from "../src/data/buildings";
import {
  buildHours,
  buildSeconds,
  buildingCost,
  cumulativeCost,
  energyUsePerHour,
  fusionDeutPerHour,
  fusionOutputPerHour,
  mineOutputPerHour,
  perSecond,
  solarOutputPerHour,
  storageCapacity,
} from "../src/game/formulas";

const costOf = (id: Parameters<typeof buildingById>[0], level: number, cut = 0) => {
  const c = buildingCost(buildingById(id), level, cut);
  return [c.metal.toNumber(), c.crystal.toNumber(), c.deuterium.toNumber()];
};

describe("building table", () => {
  it("lists all 19 OGame buildings with unique ids", () => {
    expect(BUILDINGS).toHaveLength(19);
    expect(new Set(BUILDINGS.map((b) => b.id)).size).toBe(19);
  });
  it("only nanite and moon buildings skip the low-level speed-up", () => {
    const skip = BUILDINGS.filter((b) => !b.earlyLevelSpeedup).map((b) => b.id).sort();
    expect(skip).toEqual(["jump_gate", "lunar_base", "nanite_factory", "sensor_phalanx"]);
  });
});

describe("costs (speed 1)", () => {
  it("metal mine L1 = 60/15, L10 = 2306/576", () => {
    expect(costOf("metal_mine", 1)).toEqual([60, 15, 0]);
    expect(costOf("metal_mine", 10)).toEqual([2306, 576, 0]);
  });
  it("crystal mine L5 = 314/157", () => {
    expect(costOf("crystal_mine", 5)).toEqual([314, 157, 0]);
  });
  it("factor-2 buildings double exactly", () => {
    expect(costOf("robotics_factory", 5)).toEqual([6400, 1920, 3200]);
    expect(costOf("metal_storage", 11)).toEqual([1_024_000, 0, 0]);
  });
  it("growth cut lowers the factor by 0.01 with a 1.01 floor", () => {
    expect(costOf("metal_mine", 3, 0.01)).toEqual([Math.floor(60 * 1.49 ** 2), Math.floor(15 * 1.49 ** 2), 0]);
    const tiny = { ...buildingById("metal_mine"), factor: 1.015 };
    expect(buildingCost(tiny, 3, 0.01).metal.toNumber()).toBe(Math.floor(60 * 1.01 ** 2));
  });
  it("cumulative cost sums every level", () => {
    const total = cumulativeCost(buildingById("metal_storage"), 3);
    expect(total.metal.toNumber()).toBe(1000 + 2000 + 4000);
  });
  it("large levels stay finite as Decimal", () => {
    const c = buildingCost(buildingById("metal_mine"), 80);
    expect(c.metal.gt(1e15)).toBe(true);
    expect(Number.isFinite(c.metal.log10())).toBe(true);
  });
});

describe("storage", () => {
  it("cap L0–L7 = 10k/20k/40k/75k/140k/255k/470k/865k, L10 = 5.355M", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(storageCapacity)).toEqual([
      10_000, 20_000, 40_000, 75_000, 140_000, 255_000, 470_000, 865_000,
    ]);
    expect(storageCapacity(10)).toBe(5_355_000);
  });
});

describe("production and energy (per hour, speed 1)", () => {
  it("metal mine L10 = 778/h, L20 = 4036/h", () => {
    expect(Math.round(mineOutputPerHour("metal_mine", 10, 40))).toBe(778);
    expect(Math.round(mineOutputPerHour("metal_mine", 20, 40))).toBe(4036);
  });
  it("crystal L10 = 519/h, deuterium L10 at 40°C = 332/h", () => {
    expect(Math.round(mineOutputPerHour("crystal_mine", 10, 40))).toBe(519);
    expect(Math.round(mineOutputPerHour("deuterium_synth", 10, 40))).toBe(332);
  });
  it("colder planets make more deuterium", () => {
    expect(mineOutputPerHour("deuterium_synth", 10, -60)).toBeGreaterThan(mineOutputPerHour("deuterium_synth", 10, 40));
  });
  it("energy use and supply", () => {
    expect(Math.ceil(energyUsePerHour("metal_mine", 10))).toBe(260);
    expect(Math.round(energyUsePerHour("deuterium_synth", 10))).toBe(519);
    expect(Math.round(solarOutputPerHour(10))).toBe(519);
    expect(Math.round(fusionOutputPerHour(10))).toBe(489);
    expect(Math.round(fusionDeutPerHour(10))).toBe(259);
    expect(solarOutputPerHour(0)).toBe(0);
  });
  it("per second applies the economy speed", () => {
    expect(perSecond(3600, 1)).toBe(1);
    expect(perSecond(30, 600)).toBe(5);
  });
});

describe("build time", () => {
  it("robotics L5 with R=4, N=0 takes 0.4437 h at speed 1", () => {
    const def = buildingById("robotics_factory");
    expect(buildHours(buildingCost(def, 5), 5, def, 4, 0)).toBeCloseTo(0.4437, 4);
  });
  it("nanite factory gets no low-level speed-up", () => {
    const def = buildingById("nanite_factory");
    const hours = buildHours(buildingCost(def, 1), 1, def, 10, 0);
    expect(hours).toBeCloseTo(1_500_000 / (2500 * 11), 9);
    expect(buildSeconds(buildingCost(def, 1), 1, def, 10, 0, 600)).toBeCloseTo(327.27, 1);
  });
  it("metal mine L20 with R=6 takes ~57 s at S=600", () => {
    const def = buildingById("metal_mine");
    expect(buildSeconds(buildingCost(def, 20), 20, def, 6, 0, 600)).toBeCloseTo(57, 0);
  });
  it("nanite halves build time per level", () => {
    const def = buildingById("metal_mine");
    const c = buildingCost(def, 25);
    expect(buildHours(c, 25, def, 10, 2)).toBeCloseTo(buildHours(c, 25, def, 10, 0) / 4, 12);
  });
  it("never below the 1 s minimum", () => {
    const def = buildingById("metal_mine");
    expect(buildSeconds(buildingCost(def, 1), 1, def, 0, 0, 600)).toBe(1);
  });
});
