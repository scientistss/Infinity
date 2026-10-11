import { describe, expect, it } from "vitest";
import goldens from "./fixtures/demolition-spec-goldens.json";
import { buildingById, type BuildingDef } from "../src/data/buildings";
import { demolitionExactCosts, demolitionPrice, exactIntegerString } from "../src/game/demolition-pricing";
import { MAX_DEMOLITION_SECONDS, validDemolitionSeconds } from "../src/game/demolition-state";
import { buildingCost } from "../src/game/formulas";
import { big } from "../src/game/decimal";
import { RESOURCE_IDS } from "../src/game/types";

// The checked-in Fraction oracle predates implementation and never imports production formulas.
describe("demolition independent strict rational P/T goldens", () => {
  for (const fixture of goldens.cases) it(fixture.name, () => {
    const input = fixture.input;
    const def: BuildingDef = { ...buildingById("metal_mine"), factor: Number(input.factor), earlyLevelSpeedup: input.early_speedup,
      baseCost: { metal: input.base[0]!, crystal: input.base[1]!, deuterium: input.base[2]!, energy: 0 } };
    const result = demolitionPrice(def, input.from_level, input.ion_level, Number(input.growth_cut), input.robotics_before, input.nanite_before);
    const exact = demolitionExactCosts(def, input.from_level, input.ion_level, Number(input.growth_cut));
    expect(exact.ok, exact.reason).toBe(true);
    if (!exact.ok) return;
    expect(RESOURCE_IDS.map(id => exact.exact.paidExact[id])).toEqual(fixture.paid_m_c_d);
    expect(RESOURCE_IDS.map(id => exact.exact.timeExact[id])).toEqual(fixture.timing_basis_m_c_d);
    if (fixture.name === "metal storage 32 to 31, strict integer floor") {
      // The independent integer is right; normalized Decimal cannot carry it exactly.
      expect(result.ok).toBe(false); expect(result.reason).toContain("无法精确保存");
      expect(big(exact.exact.paidExact.metal).toString()).toBe("1073741824000.0001");
      return;
    }
    expect(result.ok, result.reason).toBe(true);
    if (!result.ok) return;
    expect(RESOURCE_IDS.map(id => result.price.paid[id].toString())).toEqual(fixture.paid_m_c_d);
    expect(RESOURCE_IDS.map(id => result.price.timeCost[id].toString())).toEqual(fixture.timing_basis_m_c_d);
    const [n, d = "1"] = fixture.seconds_fraction.split("/");
    const seconds = Number(n) / Number(d);
    expect(Math.abs(result.price.totalSeconds - seconds)).toBeLessThanOrEqual(Number.EPSILON * Math.max(1, seconds) * 2);
    expect(validDemolitionSeconds(result.price.totalSeconds, result.price.totalSeconds)).toBe(true);
  });
  it("all four factors, each cut, ion0/1/24/25/26, all three resources floor once", () => {
    for (const factor of [1.5, 1.6, 1.8, 2]) for (const cut of [0, 0.01]) for (const ion of [0, 1, 24, 25, 26]) {
      // Independent fixed rational expression at L=6: base * (factor-cut)^4.
      const n = BigInt(Math.round(factor * 100) - (cut ? 1 : 0)), d = 100n ** 4n;
      const def = { ...buildingById("metal_mine"), factor, baseCost: { metal: 79, crystal: 31, deuterium: 11, energy: 0 } };
      const priced = demolitionPrice(def, 6, ion, cut, 0, 0);
      expect(priced.ok, priced.reason).toBe(true);
      if (!priced.ok) continue;
      for (const id of RESOURCE_IDS) {
        const numerator = BigInt(def.baseCost[id]) * n ** 4n;
        expect(priced.price.paid[id].toString()).toBe((numerator * BigInt(Math.max(0, 25 - ion)) / (25n * d)).toString());
        expect(priced.price.timeCost[id].toString()).toBe((numerator / d).toString());
      }
    }
  });
  it("clamps effective factor as an exact rational and keeps L1 raw-factor inverse", () => {
    const def = buildingById("metal_mine");
    const p = demolitionPrice(def, 10, 0, 1, 0, 0);
    expect(p.ok && p.price.paidExact).toEqual({ metal: "64", crystal: "16", deuterium: "0" });
    for (const cut of [0, 0.01, 1]) expect(demolitionPrice(def, 1, 0, cut, 0, 0)).toMatchObject({ ok: true, price: { paidExact: { metal: "40", crystal: "10", deuterium: "0" } } });
  });
  it("rejects unsupported or inexact values before a quote, even when ion makes payment zero", () => {
    for (const level of [0, -1, 1.5, 1001, Infinity, NaN]) expect(demolitionPrice(buildingById("metal_mine"), level, 0, 0, 0, 0).ok).toBe(false);
    expect(demolitionPrice(buildingById("metal_storage"), 34, 25, 0, 0, 0).ok).toBe(false); // T exceeds 2^33.
    expect(demolitionPrice(buildingById("metal_mine"), 200, 25, 0, 1000, 1000).ok).toBe(false); // B cannot represent the exact floor.
    for (const bad of [NaN, Infinity, -1, 0.5]) expect(demolitionPrice({ ...buildingById("metal_mine"), baseCost: { metal: bad, crystal: 1, deuterium: 0, energy: 0 } }, 2, 0, 0, 0, 0).ok).toBe(false);
    const hugeTime = demolitionPrice({ ...buildingById("metal_storage"), factor: 10 }, 14, 25, 0, 0, 0);
    expect(hugeTime.ok).toBe(false); expect(hugeTime.reason).toContain("耗时超出安全范围");
    expect(validDemolitionSeconds(MAX_DEMOLITION_SECONDS, 1)).toBe(false);
    expect(validDemolitionSeconds(MAX_DEMOLITION_SECONDS - 1, MAX_DEMOLITION_SECONDS - 1)).toBe(true);
  });
  it("does not silently replace old upgrade rounding", () => {
    expect(buildingCost(buildingById("metal_storage"), 31).metal.toString()).toBe("1073741824000.9999");
    const quote = demolitionPrice(buildingById("metal_storage"), 32, 0, 0, 0, 0);
    expect(quote.ok).toBe(false);
    const exact = demolitionExactCosts(buildingById("metal_storage"), 32, 0, 0);
    expect(exact.ok && exact.exact.paidExact.metal).toBe("1073741824000");
  });
  it("does not impose the order payment ceiling on undiscounted B", () => {
    // Exact powers of ten provide a representable synthetic B above 1e190.
    const def = { ...buildingById("metal_mine"), factor: 10, baseCost: { metal: 1000, crystal: 0, deuterium: 0, energy: 0 } };
    const price = demolitionPrice(def, 195, 25, 0, 1000, 1000);
    expect(price.ok, price.reason).toBe(true);
    if (price.ok) { expect(price.price.paid.metal.eq(0)).toBe(true); expect(price.price.timeCost.metal.toString()).toBe("1e+196"); expect(price.price.totalSeconds).toBe(1); }
  });
  it("preserves explicit neighboring Decimal evidence for warehouse refusal", () => {
    const nearest = big("1073741824000"), lower = big(0).fromMantissaExponent(1.0737418239999998, 12);
    expect(nearest.toString()).toBe("1073741824000.0001"); expect(lower.toString()).toBe("1073741823999.9999");
    expect(exactIntegerString(nearest.toString())).toBeNull(); expect(exactIntegerString(lower.toString())).toBeNull();
  });
  it("independently parses integer scientific outputs, rejecting fractional values", () => {
    expect(exactIntegerString("1.000000000000000001e18")).toBe("1000000000000000001");
    expect(exactIntegerString("1.234e2")).toBeNull();
    expect(exactIntegerString("1e10000")).toBeNull();
  });
});
