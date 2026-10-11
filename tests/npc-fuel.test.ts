import { describe, expect, it } from "vitest";
import { big, type BigNumber } from "../src/game/decimal";
import { emptyCargo, quoteFlight, shipEngine } from "../src/game/fleet";
import { distance, npcAt, type Coordinates } from "../src/game/galaxy";
import { checkedNpcFuelIntent } from "../src/game/npc-fuel";
import { checkedNpcFuelDebit, npcExactDecimalSumEquals } from "../src/game/npc-transfer";
import { createPlanet } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import type { ShipId } from "../src/data/units";

const intent = (raw: BigNumber) => {
  const result = checkedNpcFuelIntent(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error(result.reason);
  return result.value;
};

describe("NPC pre-ceiling canonical decimal fuel intent", () => {
  it.each([
    ["0", "2"], ["0.1", "4"], ["0.999999999999999", "4"], ["1", "4"],
    ["1.0000000001", "6"], ["1.9999999999", "6"], ["2", "6"],
    ["104", "210"], ["1118", "2238"], ["536870911999", "1073741824000"],
    ["1e20", "200000000000000000002"],
  ])("computes exact ceil/+1/*2 for raw %s", (text, expected) => {
    const raw = big(text), before = [raw.mantissa, raw.exponent, raw.toString()];
    expect(intent(raw)).toEqual({ rawFuelText: text === "1e20" ? "100000000000000000000" : text, expectedFuelInteger: expected });
    expect([raw.mantissa, raw.exponent, raw.toString()]).toEqual(before);
  });

  it("handles tiny amounts and huge negative exponents without exponent-sized allocation", () => {
    for (const text of ["5e-324", "1e-400", "1e-8999999999999999"]) {
      expect(intent(big(text))).toEqual({ rawFuelText: text, expectedFuelInteger: "4" });
    }
  });

  it("bounds positive integer output without shrinking existing wallets or changing the quote", () => {
    expect(intent(big("1e255")).expectedFuelInteger).toBe(`2${"0".repeat(254)}2`);
    for (const text of ["1e256", "1e400", "1e8999999999999999", "1e9000000000000000"]) {
      const raw = big(text), before = [raw.mantissa, raw.exponent, raw.toString()];
      expect(checkedNpcFuelIntent(raw)).toEqual({ ok: false, reason: "precision" });
      expect([raw.mantissa, raw.exponent, raw.toString()]).toEqual(before);
    }
  });

  it("rejects invalid raw amounts before applying the integer formula", () => {
    expect(checkedNpcFuelIntent(big(-1))).toEqual({ ok: false, reason: "invalid-amount" });
    expect(checkedNpcFuelIntent(big(NaN))).toEqual({ ok: false, reason: "invalid-amount" });
  });

  it("captures raw text once and does not demand restoration of an unsaved intermediate mantissa", () => {
    const raw = big(0); raw.mantissa = 3.29055499358593; raw.exponent = 1;
    const originalString = raw.toString.bind(raw); let reads = 0;
    raw.toString = () => { reads++; return originalString(); };
    expect(intent(raw)).toEqual({ rawFuelText: "32.9055499358593", expectedFuelInteger: "68" });
    expect(reads).toBe(1);
    expect(big("32.9055499358593").mantissa).not.toBe(raw.mantissa);
    expect(raw.mantissa).toBe(3.29055499358593);
    expect(raw.exponent).toBe(1);
  });

  it("does not pretend the captured text retains a hidden sub-ULP or ideal-formula remainder", () => {
    const raw = big("1.00000000000001");
    expect(raw.mantissa).toBeGreaterThan(1);
    expect(intent(raw)).toEqual({ rawFuelText: "1", expectedFuelInteger: "4" });
    const shiftedZero = big(0); shiftedZero.exponent = 7;
    expect(intent(shiftedZero)).toEqual({ rawFuelText: "0", expectedFuelInteger: "2" });
    expect(shiftedZero.exponent).toBe(7);
  });

  const ordinaryRanges = Array.from({ length: 5 }, (_, index) => [index * 2500, Math.min(index * 2500 + 2499, 10_000)] as const);
  it("covers all 10,001 ordinary fractional inputs in contiguous bounded test chunks", () => {
    expect(ordinaryRanges).toEqual([[0, 2499], [2500, 4999], [5000, 7499], [7500, 9999], [10_000, 10_000]]);
    expect(ordinaryRanges.reduce((total, [start, end]) => total + end - start + 1, 0)).toBe(10_001);
  });
  it.each(ordinaryRanges)("matches independent integer goldens for thousandths %i through %i", (start, end) => {
    for (let thousandths = start; thousandths <= end; thousandths++) {
      const raw = big(String(thousandths / 1000));
      const ceiling = (BigInt(thousandths) + 999n) / 1000n;
      expect(intent(raw).expectedFuelInteger).toBe((2n * (ceiling + 1n)).toString());
    }
  });

  it("rejects the final storage32-sized representation mismatch instead of billing .0001 extra", () => {
    const raw = big("536870911999"), quote = raw.ceil().add(1).mul(2), expected = intent(raw);
    expect(expected.expectedFuelInteger).toBe("1073741824000");
    expect(quote.toString()).toBe("1073741824000.0001");
    expect(npcExactDecimalSumEquals(expected.expectedFuelInteger, "0", quote.toString())).toBe(false);
    expect(checkedNpcFuelDebit(big("2147483648000"), quote, expected.expectedFuelInteger)).toEqual({ ok: false, reason: "precision" });
  });

  it("retains the mathematical +1 when the existing large Decimal quote loses it", () => {
    const raw = big("1e20"), expected = intent(raw), quote = raw.ceil().add(1).mul(2);
    expect(expected.expectedFuelInteger).toBe("200000000000000000002");
    expect(quote.toString()).toBe("200000000000000000000");
    expect(checkedNpcFuelDebit(big("4e20"), quote, expected.expectedFuelInteger)).toEqual({ ok: false, reason: "precision" });
  });
});

describe("existing flight quote fuel compatibility; no attack integration", () => {
  const cases: Array<{
    name: string; target: Coordinates; ships: Partial<Record<ShipId, number>>; combustion: number; impulse?: number;
    percent: number; raw: string; fuel: string; originalNpc: boolean;
  }> = [
    { name: "2SC 100%", target: { galaxy: 1, system: 42, position: 11 }, ships: { small_cargo: 2 }, combustion: 2, impulse: 3, percent: 100, raw: "2.297142857142857", fuel: "8", originalNpc: false },
    { name: "2SC 10%", target: { galaxy: 1, system: 42, position: 11 }, ships: { small_cargo: 2 }, combustion: 2, impulse: 3, percent: 10, raw: "0.6948857142857144", fuel: "4", originalNpc: false },
    { name: "2SC impulse5", target: { galaxy: 1, system: 42, position: 11 }, ships: { small_cargo: 2 }, combustion: 2, impulse: 5, percent: 100, raw: "4.594285714285713", fuel: "12", originalNpc: false },
    { name: "20LF2SC distance1005", target: { galaxy: 1, system: 42, position: 11 }, ships: { small_cargo: 2, light_fighter: 20 }, combustion: 3, percent: 100, raw: "32.9055499358593", fuel: "68", originalNpc: false },
    { name: "20LF2SC NPC route1025", target: { galaxy: 1, system: 42, position: 5 }, ships: { small_cargo: 2, light_fighter: 20 }, combustion: 3, percent: 100, raw: "33.5603867505033", fuel: "70", originalNpc: true },
    { name: "7LF NPC route6500", target: { galaxy: 1, system: 82, position: 3 }, ships: { light_fighter: 7 }, combustion: 1, percent: 100, raw: "104", fuel: "210", originalNpc: true },
    { name: "175LF NPC route2795", target: { galaxy: 1, system: 43, position: 2 }, ships: { light_fighter: 175 }, combustion: 1, percent: 100, raw: "1118", fuel: "2238", originalNpc: true },
  ];

  it.each(cases)("keeps $name payable under the captured canonical authority", row => {
    const state = createInitialState(42, 42), origin = state.planets[0]!;
    Object.assign(state.research.levels, { energy_tech: 1, espionage_tech: 4, weapons_tech: 1, computer_tech: 1, astrophysics: 1, combustion_drive: row.combustion, impulse_drive: row.impulse ?? 3 });
    Object.assign(origin.buildings, { robotics_factory: 2, shipyard: 3, research_lab: 4 });
    Object.assign(origin.units, row.ships);
    origin.resources = { metal: big(10_000), crystal: big(10_000), deuterium: big(10_000) };
    expect(origin.coordinates).toEqual({ galaxy: 1, system: 42, position: 10 });
    expect(npcAt(state, row.target) !== null).toBe(row.originalNpc);
    // Existing MISSIONS has no attack yet. Use a valid owned-transport fixture
    // at the same coordinates to exercise the unchanged flight quote formula.
    // This is deliberately not a real attack-dispatch or natural-progression test.
    state.planets.push(createPlanet("fuel-test-colony", row.target));
    const quote = quoteFlight(state, { mission: "transport", target: row.target, ships: row.ships, cargo: emptyCargo(), speedPercent: row.percent });
    expect(quote.ok).toBe(true);
    expect(quote.fuel.toString()).toBe(row.fuel);
    const selected = Object.entries(row.ships).map(([id, count]) => ({ count: count!, ...shipEngine(state, id as ShipId) }));
    const slowest = Math.min(...selected.map(ship => ship.speed));
    const d = distance(origin.coordinates, row.target);
    let raw = big(0);
    for (const ship of selected) {
      const throttle = row.percent / 100 * Math.sqrt(slowest / ship.speed);
      raw = raw.add(big(ship.fuel).mul(ship.count).mul(d / 35000).mul((throttle + 1) ** 2));
    }
    const expected = intent(raw);
    expect(expected).toEqual({ rawFuelText: row.raw, expectedFuelInteger: row.fuel });
    const debit = checkedNpcFuelDebit(origin.resources.deuterium, quote.fuel, expected.expectedFuelInteger);
    expect(debit.ok).toBe(true);
    if (debit.ok) expect(npcExactDecimalSumEquals(debit.value.toString(), row.fuel, "10000")).toBe(true);
    expect(origin.resources.deuterium.toString()).toBe("10000");
    expect(state.fleets).toHaveLength(0);
  });
});
