import { describe, expect, it } from "vitest";
import { UNIT_IDS, type UnitId } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { createPlanet } from "../src/game/planet";
import type { ShipyardOrder } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import {
  MAX_MANUAL_QUANTITY_INPUT_LENGTH,
  formatManualUnitCost,
  parseManualQuantity,
  quoteManualUnits,
  type ManualUnitMode,
} from "../src/ui/manual-unit-quote";

/**
 * All states in this file are anonymous synthetic unit-test fixtures, not
 * historical exports or evidence of a real player action. Expected costs below
 * are fixed golden values, independent of canBuildUnits/unitCost/catalog reads.
 */
function ready(): GameState {
  const state = createInitialState(42_424, 20_261_012);
  activePlanet(state).buildings.shipyard = 12;
  activePlanet(state).buildings.missile_silo = 4;
  activePlanet(state).resources = { metal: big("1000000000000000"), crystal: big("1000000000000000"), deuterium: big("1000000000000000") };
  for (const id of Object.keys(state.research.levels) as (keyof GameState["research"]["levels"])[]) state.research.levels[id] = 12;
  return state;
}

/** A remaining paid-queue fixture; its original count and progress can differ. */
function paid(unit: UnitId, count: number, jobId = 1, orderedCount = count): ShipyardOrder {
  return {
    jobId, taskId: null, unit, count, orderedCount, progress: 0.75, source: "manual",
    paidPerUnit: { metal: big(0), crystal: big(0), deuterium: big(0) },
  };
}

function putFleet(state: GameState, count: number, originId = state.activePlanetId): void {
  state.fleets.push({
    id: 1, orderTransport: null, originId, target: { galaxy: 1, system: 2, position: 3 },
    mission: "transport", ships: { small_cargo: count },
    cargo: { metal: big(0), crystal: big(0), deuterium: big(0) },
    duration: 120, remaining: 75, returning: true, elapsed: 45,
  });
}

const zero = { metal: "0", crystal: "0", deuterium: "0" };
const cost = (metal: string, crystal: string, deuterium: string) => ({ metal, crystal, deuterium });

type Golden = {
  unit: UnitId;
  count: number;
  price: [string, string, string];
  max: number;
  maxPrice: [string, string, string];
};

const GOLDEN: readonly Golden[] = [
  { unit: "small_cargo", count: 7, price: ["14000", "14000", "0"], max: 1000000, maxPrice: ["2000000000", "2000000000", "0"] },
  { unit: "large_cargo", count: 7, price: ["42000", "42000", "0"], max: 1000000, maxPrice: ["6000000000", "6000000000", "0"] },
  { unit: "light_fighter", count: 7, price: ["21000", "7000", "0"], max: 1000000, maxPrice: ["3000000000", "1000000000", "0"] },
  { unit: "heavy_fighter", count: 7, price: ["42000", "28000", "0"], max: 1000000, maxPrice: ["6000000000", "4000000000", "0"] },
  { unit: "cruiser", count: 7, price: ["140000", "49000", "14000"], max: 1000000, maxPrice: ["20000000000", "7000000000", "2000000000"] },
  { unit: "battleship", count: 7, price: ["315000", "105000", "0"], max: 1000000, maxPrice: ["45000000000", "15000000000", "0"] },
  { unit: "battlecruiser", count: 7, price: ["210000", "280000", "105000"], max: 1000000, maxPrice: ["30000000000", "40000000000", "15000000000"] },
  { unit: "bomber", count: 7, price: ["350000", "175000", "105000"], max: 1000000, maxPrice: ["50000000000", "25000000000", "15000000000"] },
  { unit: "destroyer", count: 7, price: ["420000", "350000", "105000"], max: 1000000, maxPrice: ["60000000000", "50000000000", "15000000000"] },
  { unit: "deathstar", count: 7, price: ["35000000", "28000000", "7000000"], max: 1000000, maxPrice: ["5000000000000", "4000000000000", "1000000000000"] },
  { unit: "recycler", count: 7, price: ["70000", "42000", "14000"], max: 1000000, maxPrice: ["10000000000", "6000000000", "2000000000"] },
  { unit: "espionage_probe", count: 7, price: ["0", "7000", "0"], max: 1000000, maxPrice: ["0", "1000000000", "0"] },
  { unit: "solar_satellite", count: 7, price: ["0", "14000", "3500"], max: 1000000, maxPrice: ["0", "2000000000", "500000000"] },
  { unit: "colony_ship", count: 7, price: ["70000", "140000", "70000"], max: 1000000, maxPrice: ["10000000000", "20000000000", "10000000000"] },
  { unit: "rocket_launcher", count: 7, price: ["14000", "0", "0"], max: 1000000, maxPrice: ["2000000000", "0", "0"] },
  { unit: "light_laser", count: 7, price: ["10500", "3500", "0"], max: 1000000, maxPrice: ["1500000000", "500000000", "0"] },
  { unit: "heavy_laser", count: 7, price: ["42000", "14000", "0"], max: 1000000, maxPrice: ["6000000000", "2000000000", "0"] },
  { unit: "gauss_cannon", count: 7, price: ["140000", "105000", "14000"], max: 1000000, maxPrice: ["20000000000", "15000000000", "2000000000"] },
  { unit: "ion_cannon", count: 7, price: ["14000", "42000", "0"], max: 1000000, maxPrice: ["2000000000", "6000000000", "0"] },
  { unit: "plasma_turret", count: 7, price: ["350000", "350000", "210000"], max: 1000000, maxPrice: ["50000000000", "50000000000", "30000000000"] },
  { unit: "small_shield_dome", count: 1, price: ["10000", "10000", "0"], max: 1, maxPrice: ["10000", "10000", "0"] },
  { unit: "large_shield_dome", count: 1, price: ["50000", "50000", "0"], max: 1, maxPrice: ["50000", "50000", "0"] },
  { unit: "anti_ballistic_missile", count: 7, price: ["56000", "0", "14000"], max: 40, maxPrice: ["320000", "0", "80000"] },
  { unit: "interplanetary_missile", count: 7, price: ["87500", "17500", "70000"], max: 20, maxPrice: ["250000", "50000", "200000"] },
];

const INVALID = [
  "", " ", "\t\n", "0", "000", "-1", "-0", "+1", "1.5", "1.0", ".5", "1.",
  "1e3", "1E3", "0x10", "0b10", "0o10", "NaN", "Infinity", "-Infinity",
  "1,000", "1_000", "1 0", "1\n0", "12px", "１", "١", "−1", "1\u0000", "1\u200b",
  "9007199254740992", "9007199254740993", "9999999999999999", "<script>1</script>",
];

describe("strict manual quantity parser", () => {
  it.each(INVALID)("rejects %j instead of repairing or flooring it", raw => {
    const parsed = parseManualQuantity(raw);
    expect(parsed.ok).toBe(false);
    expect(parsed.raw).toBe(raw);
    if (!parsed.ok) expect(parsed.reason.length).toBeGreaterThan(0);
  });

  it.each([
    ["1", 1], ["000007", 7], ["  \t00042\n", 42], ["\u00a010\u00a0", 10],
    ["1000000", 1000000], ["1000001", 1000001], ["9007199254740991", 9007199254740991],
  ] as const)("accepts %j without losing its original text", (raw, value) => {
    expect(parseManualQuantity(raw)).toEqual({ ok: true, raw, value });
  });

  it("bounds original length before trim/conversion while allowing bounded leading zeroes", () => {
    expect(MAX_MANUAL_QUANTITY_INPUT_LENGTH).toBe(128);
    const raw = "0".repeat(127) + "1";
    expect(parseManualQuantity(raw)).toEqual({ ok: true, raw, value: 1 });
    for (const tooLong of ["0" + raw, " ".repeat(129), "9".repeat(100_000), " ".repeat(128) + "1"]) {
      expect(parseManualQuantity(tooLong)).toEqual({ ok: false, raw: tooLong, reason: "数量输入过长（最多 128 个字符）" });
    }
  });
});

describe("all 24 manual unit entries have independent fixed goldens", () => {
  it("the golden list covers the complete unit entry surface exactly once", () => {
    expect(GOLDEN).toHaveLength(24);
    expect(new Set(GOLDEN.map(row => row.unit)).size).toBe(24);
    expect(GOLDEN.map(row => row.unit).sort()).toEqual([...UNIT_IDS].sort());
  });

  for (const mode of ["count", "fill"] as const) {
    it.each(GOLDEN)(`${mode}: $unit preserves full prices and exact additional count`, row => {
      const state = ready();
      const raw = `  00${row.count}  `;
      expect(quoteManualUnits(state, { unit: row.unit, mode, raw })).toEqual({
        ok: true, reason: "", planetId: "homeworld", unit: row.unit, mode, raw,
        count: row.count, owned: 0, queued: 0, total: 0, target: row.count, cost: cost(...row.price),
      });
    });
  }

  it.each(GOLDEN)("max: $unit obeys original domain caps and ignores malformed N", row => {
    const raw = "-1.5eInfinity";
    expect(quoteManualUnits(ready(), { unit: row.unit, mode: "max", raw })).toEqual({
      ok: true, reason: "", planetId: "homeworld", unit: row.unit, mode: "max", raw,
      count: row.max, owned: 0, queued: 0, total: 0, target: null, cost: cost(...row.maxPrice),
    });
  });
});

describe("manual quantity failures are never hidden one-unit quotes", () => {
  for (const mode of ["count", "fill"] as const) {
    it.each(INVALID)(`${mode}: %j is unpayable with a zero quote`, raw => {
      const quote = quoteManualUnits(ready(), { unit: "small_cargo", mode, raw });
      expect(quote).toMatchObject({ ok: false, raw, count: 0, target: null, cost: zero });
      expect(quote.reason).not.toBe("");
    });
  }

  it("rejects the historical blank/zero/negative/fraction coercion at every entry", () => {
    const state = ready();
    const before = JSON.stringify(state);
    for (const unit of UNIT_IDS) for (const raw of ["", "0", "-1", "1.5"]) {
      expect(quoteManualUnits(state, { unit, mode: "count", raw })).toMatchObject({ ok: false, count: 0, cost: zero });
    }
    expect(JSON.stringify(state)).toBe(before);
    expect(state.orders.nextJobId).toBe(1);
    expect(activePlanet(state).shipyardQueue).toEqual([]);
  });

  it("max never parses retained raw, even if blank, zero, unsafe or overlong", () => {
    const state = ready();
    activePlanet(state).resources = { metal: big(9999), crystal: big(6500), deuterium: big(0) };
    for (const raw of [...INVALID, "9".repeat(129)]) {
      expect(quoteManualUnits(state, { unit: "small_cargo", mode: "max", raw })).toMatchObject({
        ok: true, raw, target: null, count: 3, cost: cost("6000", "6000", "0"),
      });
    }
  });

  it("zero resource max explains the blocker but does not quote the failed one-unit cost", () => {
    const state = ready();
    activePlanet(state).resources = { metal: big(0), crystal: big(0), deuterium: big(0) };
    const quote = quoteManualUnits(state, { unit: "small_cargo", mode: "max", raw: "100" });
    expect(quote).toMatchObject({ ok: false, count: 0, cost: zero, target: null });
    expect(quote.reason).toContain("本次可新增 0");
    expect(quote.reason).toContain("不扣资源");
    expect(quote.reason).toContain("缺");
  });
});

describe("count and fill preserve the original batch and ownership semantics", () => {
  it.each([
    ["999999", true, "1999998000"],
    ["1000000", true, "2000000000"],
    ["1000001", false, "2000002000"],
  ] as const)("batch boundary %s uses the requested count, never a clamp", (raw, ok, metal) => {
    const quote = quoteManualUnits(ready(), { unit: "small_cargo", mode: "count", raw });
    expect(quote).toMatchObject({ ok, count: Number(raw), cost: cost(metal, metal, "0") });
    expect(quote.reason).toBe(ok ? "" : "单批最多 1,000,000");
  });

  it("accepts a safe fill target above one million when the actual new batch fits", () => {
    const state = ready();
    activePlanet(state).units.small_cargo = 1_000_000;
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "1000001" })).toMatchObject({
      ok: true, target: 1000001, count: 1, owned: 1000000, total: 1000000, cost: cost("2000", "2000", "0"),
    });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "2000000" })).toMatchObject({ ok: true, count: 1000000 });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "2000001" })).toMatchObject({ ok: false, count: 1000001, reason: "单批最多 1,000,000" });
  });

  it("counts remaining paid quantities, ignores original counts and excludes fleets", () => {
    const state = ready();
    const planet = activePlanet(state);
    planet.units.small_cargo = 5;
    planet.shipyardQueue = [paid("small_cargo", 3, 1, 10), paid("small_cargo", 2, 2), paid("large_cargo", 99, 3)];
    state.orders.nextJobId = 4;
    putFleet(state, 50);
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "12" })).toMatchObject({
      ok: true, count: 2, owned: 5, queued: 5, total: 10, target: 12, cost: cost("4000", "4000", "0"),
    });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "12" })).toMatchObject({
      ok: true, count: 12, owned: 5, queued: 5, total: 10, cost: cost("24000", "24000", "0"),
    });
  });

  it.each(["7", "10"])("fill target %s already satisfied means zero additional units and zero cost", raw => {
    const state = ready();
    activePlanet(state).units.small_cargo = 5;
    activePlanet(state).shipyardQueue = [paid("small_cargo", 5)];
    const quote = quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw });
    expect(quote).toMatchObject({ ok: false, count: 0, owned: 5, queued: 5, total: 10, cost: zero });
    expect(quote.reason).toContain("已有 10（含已付费排队）");
    expect(quote.reason).toContain("本次无需新增，不扣资源");
  });

  it("cannot smuggle an unsafe or scientific target through fill", () => {
    const state = ready();
    activePlanet(state).units.small_cargo = 1_000_000_000_000_000;
    for (const raw of ["9007199254740993", "1e15", "1000000000000000.5", "9".repeat(129)]) {
      expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw })).toMatchObject({ ok: false, count: 0, target: null, cost: zero });
    }
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "9007199254740991" })).toMatchObject({
      ok: false, target: 9007199254740991, count: 9007199254740991, reason: "单批最多 1,000,000",
      cost: cost("18014398509481982000", "18014398509481982000", "0"),
    });
  });
});

describe("manual quotes retain domain prerequisites, queues and specialized caps", () => {
  it("does not replace prerequisite failure or its actual positive-count quote", () => {
    const state = ready();
    activePlanet(state).buildings.shipyard = 0;
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "3" })).toMatchObject({
      ok: false, reason: "需要造船厂 等级 1", count: 3, cost: cost("6000", "6000", "0"),
    });
    activePlanet(state).buildings.shipyard = 2;
    state.research.levels.combustion_drive = 0;
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "3" })).toMatchObject({
      ok: false, reason: "需要 燃烧引擎 等级 2", count: 3, cost: cost("6000", "6000", "0"),
    });
  });

  it("retains insufficient resources rather than shrinking a count request", () => {
    const state = ready();
    activePlanet(state).resources = { metal: big(2000), crystal: big(2000), deuterium: big(0) };
    const quote = quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "2" });
    expect(quote).toMatchObject({ ok: false, count: 2, cost: cost("4000", "4000", "0") });
    expect(quote.reason).toContain("缺");
  });

  it("retains the ten-batch queue limit", () => {
    const state = ready();
    activePlanet(state).shipyardQueue = Array.from({ length: 10 }, (_, index) => paid("rocket_launcher", 1, index + 1));
    state.orders.nextJobId = 11;
    for (const mode of ["count", "max", "fill"] as const) {
      expect(quoteManualUnits(state, { unit: "small_cargo", mode, raw: "3" })).toMatchObject({ ok: false, reason: "造船队列已满（10/10）" });
    }
    activePlanet(state).units.small_cargo = 3;
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "3" })).toMatchObject({ ok: false, count: 0, cost: zero });
  });

  it.each(["shipyard", "nanite_factory"] as const)("retains the %s demolition payment block", building => {
    const state = ready();
    activePlanet(state).demolition = {
      kind: "demolition", source: "manual", taskId: null, jobId: 1, demolitionRuleVersion: 1,
      building, fromLevel: 2, toLevel: 1, totalSeconds: 100, remainingSeconds: 50,
      paid: { metal: big(0), crystal: big(0), deuterium: big(0) },
    };
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "1" })).toMatchObject({
      ok: false, reason: "本星造船厂或纳米工厂正在拆除，暂不能支付新的舰船或防御", cost: cost("2000", "2000", "0"),
    });
  });

  it("a shipyard upgrade pauses output but does not invent a payment prohibition", () => {
    const state = ready();
    activePlanet(state).buildQueue.push({
      building: "shipyard", targetLevel: 13, paid: { metal: big(0), crystal: big(0), deuterium: big(0) },
      totalSeconds: 100, remainingSeconds: 50, jobId: 1, taskId: null, source: "manual",
    });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "1" })).toMatchObject({ ok: true, count: 1 });
  });

  it.each([
    ["small_shield_dome", "小型护盾罩", "10000"],
    ["large_shield_dome", "大型护盾罩", "50000"],
  ] as const)("%s counts existing and queued domes and never charges for a zero max", (unit, name, price) => {
    const state = ready();
    expect(quoteManualUnits(state, { unit, mode: "count", raw: "2" })).toMatchObject({ ok: false, reason: `${name}每颗星球最多 1 个` });
    activePlanet(state).shipyardQueue = [paid(unit, 1)];
    expect(quoteManualUnits(state, { unit, mode: "count", raw: "1" })).toMatchObject({ ok: false, cost: cost(price, price, "0") });
    expect(quoteManualUnits(state, { unit, mode: "max", raw: "1" })).toMatchObject({ ok: false, count: 0, cost: zero });
    expect(quoteManualUnits(state, { unit, mode: "fill", raw: "1" })).toMatchObject({ ok: false, count: 0, total: 1, cost: zero });
    activePlanet(state).shipyardQueue = [];
    activePlanet(state).units[unit] = 1;
    expect(quoteManualUnits(state, { unit, mode: "count", raw: "1" })).toMatchObject({ ok: false, reason: `${name}每颗星球最多 1 个` });
  });

  it("the two different shield domes retain separate per-planet caps", () => {
    const state = ready();
    activePlanet(state).units.small_shield_dome = 1;
    expect(quoteManualUnits(state, { unit: "large_shield_dome", mode: "max", raw: "0" })).toMatchObject({
      ok: true, count: 1, cost: cost("50000", "50000", "0"),
    });
  });

  it("mixed owned and queued missiles use one or two silo slots exactly", () => {
    const state = ready();
    const planet = activePlanet(state);
    planet.units.anti_ballistic_missile = 5;
    planet.units.interplanetary_missile = 7;
    planet.shipyardQueue = [paid("anti_ballistic_missile", 3, 1), paid("interplanetary_missile", 4, 2)];
    expect(quoteManualUnits(state, { unit: "anti_ballistic_missile", mode: "max", raw: "" })).toMatchObject({ ok: true, count: 10, cost: cost("80000", "0", "20000") });
    expect(quoteManualUnits(state, { unit: "interplanetary_missile", mode: "max", raw: "" })).toMatchObject({ ok: true, count: 5, cost: cost("62500", "12500", "50000") });
    expect(quoteManualUnits(state, { unit: "anti_ballistic_missile", mode: "count", raw: "11" })).toMatchObject({ ok: false, reason: "导弹井空位不足（剩 10 格，每枚占 1 格）", cost: cost("88000", "0", "22000") });
    expect(quoteManualUnits(state, { unit: "interplanetary_missile", mode: "count", raw: "6" })).toMatchObject({ ok: false, reason: "导弹井空位不足（剩 10 格，每枚占 2 格）", cost: cost("75000", "15000", "60000") });
  });

  it("retains missile silo prerequisites and the reduced capacity during silo demolition", () => {
    const state = ready();
    const planet = activePlanet(state);
    planet.buildings.missile_silo = 1;
    expect(quoteManualUnits(state, { unit: "anti_ballistic_missile", mode: "count", raw: "1" })).toMatchObject({ ok: false, reason: "需要 导弹井 等级 2" });
    planet.buildings.missile_silo = 3;
    expect(quoteManualUnits(state, { unit: "interplanetary_missile", mode: "count", raw: "1" })).toMatchObject({ ok: false, reason: "需要 导弹井 等级 4" });
    planet.buildings.missile_silo = 4;
    planet.units.interplanetary_missile = 15;
    planet.demolition = {
      kind: "demolition", source: "manual", taskId: null, jobId: 1, demolitionRuleVersion: 1,
      building: "missile_silo", fromLevel: 4, toLevel: 3, totalSeconds: 100, remainingSeconds: 50,
      paid: { metal: big(0), crystal: big(0), deuterium: big(0) },
    };
    expect(quoteManualUnits(state, { unit: "anti_ballistic_missile", mode: "max", raw: "1" })).toMatchObject({ ok: false, count: 0, cost: zero });
    expect(quoteManualUnits(state, { unit: "anti_ballistic_missile", mode: "count", raw: "1" })).toMatchObject({ ok: false, reason: "导弹井空位不足（剩 0 格，每枚占 1 格）", cost: cost("8000", "0", "2000") });
  });

  it("satellites retain zero metal, crystal/deuterium pricing and their own prerequisites", () => {
    const state = ready();
    activePlanet(state).resources = { metal: big(0), crystal: big(8000), deuterium: big(1500) };
    activePlanet(state).buildings.shipyard = 1;
    for (const id of Object.keys(state.research.levels) as (keyof GameState["research"]["levels"])[]) state.research.levels[id] = 0;
    expect(quoteManualUnits(state, { unit: "solar_satellite", mode: "max", raw: "1.5" })).toMatchObject({ ok: true, count: 3, cost: cost("0", "6000", "1500") });
  });

  it("local capacity still includes paid queue and in-flight output reservations", () => {
    const state = ready();
    activePlanet(state).units.small_cargo = 999_999_999_999_990;
    activePlanet(state).shipyardQueue = [paid("small_cargo", 5)];
    putFleet(state, 4);
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "max", raw: "" })).toMatchObject({ ok: true, count: 1 });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "999999999999997" })).toMatchObject({
      ok: false, owned: 999999999999990, queued: 5, total: 999999999999995, count: 2,
      reason: "舰船数量超过星球或帝国安全上限（含已付费排队与在途舰船）", cost: cost("4000", "4000", "0"),
    });
  });

  it("empire-wide safe integer capacity remains enforced", () => {
    const state = ready();
    putFleet(state, 9_007_199_254_740_990, "other-origin");
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "max", raw: "" })).toMatchObject({ ok: true, count: 1 });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "2" })).toMatchObject({
      ok: false, count: 2, reason: "舰船数量超过星球或帝国安全上限（含已付费排队与在途舰船）",
    });
  });
});

describe("detached read-only, source-planet-bound manual quotes", () => {
  it("uses the active source planet's inventory, queue and resources only", () => {
    const state = ready();
    activePlanet(state).units.small_cargo = 100;
    activePlanet(state).shipyardQueue = [paid("small_cargo", 50)];
    const colony = createPlanet("colony-2");
    colony.buildings.shipyard = 2;
    colony.units.small_cargo = 2;
    colony.shipyardQueue = [paid("small_cargo", 3, 2)];
    colony.resources = { metal: big(10000), crystal: big(8000), deuterium: big(0) };
    state.planets.push(colony);
    state.activePlanetId = colony.id;
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "7" })).toMatchObject({
      ok: true, planetId: "colony-2", owned: 2, queued: 3, total: 5, count: 2, cost: cost("4000", "4000", "0"),
    });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "max", raw: "" })).toMatchObject({ ok: true, planetId: "colony-2", count: 4 });
    state.activePlanetId = "homeworld";
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "fill", raw: "7" })).toMatchObject({ ok: false, planetId: "homeworld", owned: 100, queued: 50, total: 150, count: 0, cost: zero });
  });

  it("missing source, invalid unit and invalid mode fail closed without another planet fallback", () => {
    const state = ready();
    state.activePlanetId = "missing";
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "count", raw: "1" })).toMatchObject({ ok: false, planetId: "missing", reason: "当前支付星球不存在", cost: zero });
    state.activePlanetId = "homeworld";
    expect(quoteManualUnits(state, { unit: "bad" as UnitId, mode: "count", raw: "1" })).toMatchObject({ ok: false, reason: "单位无效", cost: zero });
    expect(quoteManualUnits(state, { unit: "small_cargo", mode: "bad" as ManualUnitMode, raw: "1" })).toMatchObject({ ok: false, reason: "手动建造模式无效", cost: zero });
  });

  it("never mutates even a recursively frozen state, issues jobs, or shares cost objects", () => {
    const state = ready();
    activePlanet(state).shipyardQueue = [paid("small_cargo", 3, 1, 9)];
    state.orders.nextJobId = 2;
    putFleet(state, 50);
    const before = JSON.stringify(state);
    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
      Object.freeze(value);
      for (const entry of Object.values(value)) freeze(entry);
    };
    freeze(state);
    for (const unit of UNIT_IDS) for (const mode of ["count", "max", "fill"] as const) {
      const quote = quoteManualUnits(state, { unit, mode, raw: "7" });
      expect(Object.getPrototypeOf(quote)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(quote.cost)).toBe(Object.prototype);
      expect(Object.values(quote.cost).every(value => typeof value === "string")).toBe(true);
      expect(JSON.parse(JSON.stringify(quote))).toEqual(quote);
      const original = quote.cost.metal;
      quote.cost.metal = "tampered";
      expect(quoteManualUnits(state, { unit, mode, raw: "7" }).cost.metal).toBe(original);
    }
    expect(JSON.stringify(state)).toBe(before);
    expect(state.orders.nextJobId).toBe(2);
    expect(state.orders.nextTaskId).toBe(1);
    expect(state.orders.tasks).toEqual([]);
    expect(activePlanet(state).shipyardQueue).toHaveLength(1);
  });

  it("recomputes live resource and queue changes rather than caching a quote", () => {
    const state = ready();
    activePlanet(state).resources = { metal: big(10000), crystal: big(10000), deuterium: big(0) };
    const request = { unit: "small_cargo" as const, mode: "max" as const, raw: "invalid" };
    const first = quoteManualUnits(state, request);
    expect(first).toMatchObject({ count: 5, cost: cost("10000", "10000", "0") });
    activePlanet(state).resources.crystal = big(4000);
    expect(quoteManualUnits(state, request)).toMatchObject({ count: 2, cost: cost("4000", "4000", "0") });
    expect(first).toMatchObject({ count: 5, cost: cost("10000", "10000", "0") });
    activePlanet(state).shipyardQueue = Array.from({ length: 10 }, (_, index) => paid("rocket_launcher", 1, index + 1));
    expect(quoteManualUnits(state, request)).toMatchObject({ ok: false, count: 2, reason: "造船队列已满（10/10）" });
  });

  it("formats complete integers without compact or floating point approximation", () => {
    expect(formatManualUnitCost("0")).toBe("0");
    expect(formatManualUnitCost("999")).toBe("999");
    expect(formatManualUnitCost("1000000")).toBe("1,000,000");
    expect(formatManualUnitCost("9007199254740993123456789")).toBe("9,007,199,254,740,993,123,456,789");
    const quote = quoteManualUnits(ready(), { unit: "deathstar", mode: "count", raw: "999999" });
    expect(quote.cost).toEqual(cost("4999995000000", "3999996000000", "999999000000"));
    for (const value of Object.values(quote.cost)) expect(value).toMatch(/^(0|[1-9][0-9]*)$/);
  });
});
