import { describe, expect, it } from "vitest";
import { SHIP_IDS, unitById } from "../src/data/units";
import { big } from "../src/game/decimal";
import type { DebrisField, ShipCounts } from "../src/game/deep-state";
import { recycleDebris } from "../src/game/deep-space";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, resolveFleetArrivals, sendFleet, type Fleet, type FleetRequest } from "../src/game/fleet";
import { coordinateKey } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { calculateRecycleAmounts, type RecycleAmountsInput } from "../src/game/recycle-amounts";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";

// Historical behavior oracle, copied before the extraction from
// 6b985b88ec6b263a3eeb8f34252525383a9f110f:src/game/deep-space.ts
// (Git blob b5bca084100ad780aa99bf87ee1590074dd99bc1).
// Only the exported function name is changed. Keep this independent of the new
// helper: equivalence alone cannot establish that the old economics were right.
function cargoTotal(c:ResourceAmounts):ReturnType<typeof big>{return RESOURCE_IDS.reduce((sum,id)=>sum.add(c[id]),big(0));}
function oldRecycleDebris(state:GameState,fleet:Fleet):{state:GameState;fleet:Fleet;summary:string} {
  const key=coordinateKey(fleet.target),field=state.deepSpace.debris.find(d=>coordinateKey(d.target)===key);
  if(!field)return {state,fleet,summary:"目标已无残骸，空载返航"};
  const factor=1+.05*state.research.levels.hyperspace_tech;
  const capacity=SHIP_IDS.reduce((s,id)=>s.add(big(unitById(id).cargo).mul(fleet.ships[id]??0).mul(factor)),big(0));
  const collector=big(unitById("recycler").cargo).mul(fleet.ships.recycler??0).mul(factor);
  const room=capacity.sub(cargoTotal(fleet.cargo)).max(0).min(collector),m=big(field.metal),c=big(field.crystal),total=m.add(c);
  const take=room.min(total),metal=total.gt(0)?take.mul(m).div(total).floor():big(0),crystal=take.sub(metal).min(c).floor();
  const leftM=m.sub(metal),leftC=c.sub(crystal);
  const debris=state.deepSpace.debris.filter(d=>coordinateKey(d.target)!==key);
  if(leftM.gt(0)||leftC.gt(0))debris.push({...field,metal:leftM.toString(),crystal:leftC.toString()});
  return {state:{...state,deepSpace:{...state.deepSpace,debris}},fleet:{...fleet,cargo:{...fleet.cargo,metal:fleet.cargo.metal.add(metal),crystal:fleet.cargo.crystal.add(crystal)}},summary:`已回收金属 ${metal.toString()}、晶体 ${crystal.toString()}，返航后入库`};
}

const TARGET = { galaxy: 1, system: 50, position: 16 };
type CargoStrings = readonly [metal: string, crystal: string, deuterium: string];
type DebrisStrings = readonly [metal: string, crystal: string];
type FieldPosition = "first" | "middle" | "last";

function cargo([metal, crystal, deuterium]: CargoStrings): ResourceAmounts {
  return { metal: big(metal), crystal: big(crystal), deuterium: big(deuterium) };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function fixture(ships: ShipCounts, carried: CargoStrings, hyperspace: number,
  wreck: DebrisStrings | null, position: FieldPosition = "middle") {
  // Both seeds are explicit, so fixture construction never requests entropy.
  const state = createInitialState(20261012, 813579);
  state.research.levels.hyperspace_tech = hyperspace;
  Object.assign(state.deepSpace, { completed: 31, lastBlackhole: 21, emptyStreak: 3, jackpotStreak: 8, nextOfferId: 6 });
  state.deepSpace.offers = [{ id: "untouched-offer", planetId: state.activePlanetId,
    startsAt: 5, expiresAt: 605, ratios: { metal: 3, crystal: 2, deuterium: 1 }, remainingMe: "789.125" }];
  state.messages = [{ id: "untouched-message", at: 7, text: "Keep the entire historical state", npcScoutSnapshot: null }];
  const before: DebrisField = { target: { ...TARGET, position: 2 }, metal: "123.25", crystal: "456.75" };
  const after: DebrisField = { target: { ...TARGET, system: 51 }, metal: "789", crystal: "0.125" };
  const field: DebrisField | null = wreck && { target: { ...TARGET }, metal: wreck[0], crystal: wreck[1] };
  state.deepSpace.debris = !field ? [before, after]
    : position === "first" ? [field, before, after]
      : position === "last" ? [before, after, field] : [before, field, after];
  const fleet: Fleet = { id: 17, originId: state.activePlanetId, target: { ...TARGET }, mission: "recycle",
    ships: { ...ships }, cargo: cargo(carried), duration: 23, remaining: 0, elapsed: 23, returning: false, orderTransport: null };
  const other: Fleet = { ...fleet, id: 18, target: { ...TARGET, system: 52 },
    ships: { small_cargo: 2 }, cargo: cargo(["3.125", "4.25", "5.5"]), remaining: 12, elapsed: 11 };
  state.fleets = [fleet, other];
  state.nextFleetId = 19;
  return { state, fleet };
}

function expectHistoricalEquivalence(ships: ShipCounts, carried: CargoStrings, hyperspace: number,
  wreck: DebrisStrings | null, position: FieldPosition = "middle") {
  const { state, fleet } = fixture(ships, carried, hyperspace, wreck, position);
  const inputBefore = JSON.stringify({ state, fleet });
  freeze(state);
  freeze(fleet);
  const expected = oldRecycleDebris(state, fleet);
  const actual = recycleDebris(state, fleet);
  const label = JSON.stringify({ ships, carried, hyperspace, wreck, position });
  // Compare every state/fleet field and the complete summary, without a projection
  // that might hide changes to RNG, offers, history, resources or unrelated fleets.
  expect(actual, label).toEqual(expected);
  expect(JSON.stringify(actual), label).toBe(JSON.stringify(expected));
  expect(JSON.stringify({ state, fleet }), label).toBe(inputBefore);
  expect(actual.fleet.cargo.deuterium, label).toBe(fleet.cargo.deuterium);
  if (wreck === null) {
    expect(actual.state, label).toBe(state);
    expect(actual.fleet, label).toBe(fleet);
  } else {
    // Even a zero pickup has the same historical allocation/aliasing boundary.
    expect(actual.state, label).not.toBe(state);
    expect(actual.state.deepSpace, label).not.toBe(state.deepSpace);
    expect(actual.state.deepSpace.debris, label).not.toBe(state.deepSpace.debris);
    expect(actual.fleet, label).not.toBe(fleet);
    expect(actual.fleet.cargo, label).not.toBe(fleet.cargo);
    expect(actual.state.fleets, label).toBe(state.fleets);
    expect(actual.fleet.ships, label).toBe(fleet.ships);
    expect(actual.fleet.target, label).toBe(fleet.target);
    for (const key of Object.keys(state) as Array<keyof GameState>) {
      if (key !== "deepSpace") expect(actual.state[key], `${label}: ${key}`).toBe(state[key]);
    }
    for (const resource of RESOURCE_IDS) {
      expect(actual.fleet.cargo[resource] === fleet.cargo[resource], `${label}: ${resource} identity`)
        .toBe(expected.fleet.cargo[resource] === fleet.cargo[resource]);
    }
    for (const field of actual.state.deepSpace.debris) {
      const source = state.deepSpace.debris.find(candidate => coordinateKey(candidate.target) === coordinateKey(field.target))!;
      expect(field.target, label).toBe(source.target);
      if (coordinateKey(field.target) !== coordinateKey(TARGET)) expect(field, label).toBe(source);
      else expect(field, label).not.toBe(source);
    }
    const input: RecycleAmountsInput = freeze({ ships: fleet.ships, cargo: fleet.cargo,
      hyperspace, debris: { metal: wreck[0], crystal: wreck[1] } });
    const inputBefore = JSON.stringify(input);
    const amounts = calculateRecycleAmounts(input);
    expect(fleet.cargo.metal.add(amounts.metal), label).toEqual(expected.fleet.cargo.metal);
    expect(fleet.cargo.crystal.add(amounts.crystal), label).toEqual(expected.fleet.cargo.crystal);
    expect(JSON.stringify(input), label).toBe(inputBefore);
    expect(calculateRecycleAmounts(input), label).toEqual(amounts);
  }
}

function amountStrings(input: RecycleAmountsInput) {
  const before = JSON.stringify(input);
  const result = calculateRecycleAmounts(freeze(input));
  expect(JSON.stringify(input)).toBe(before);
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.toString()]));
}

describe("recycle arithmetic: independent literal economic goldens", () => {
  it("collects 14,666 metal and the 7,334 crystal residual, leaving the exact wreck", () => {
    expect(amountStrings({ ships: { recycler: 1 }, cargo: emptyCargo(), hyperspace: 2,
      debris: { metal: "40000", crystal: "20000" } })).toEqual({
      capacity: "22000", collector: "22000", used: "0", room: "22000",
      metal: "14666", crystal: "7334", leftMetal: "25334", leftCrystal: "12666",
    });
    const { state, fleet } = fixture({ recycler: 1 }, ["0", "0", "0"], 2, ["40000", "20000"]);
    const result = recycleDebris(freeze(state), fleet);
    expect(result.fleet.cargo).toEqual(cargo(["14666", "7334", "0"]));
    expect(result.state.deepSpace.debris.at(-1)).toEqual({ target: TARGET, metal: "25334", crystal: "12666" });
    expect(result.summary).toBe("已回收金属 14666、晶体 7334，返航后入库");
  });

  it("counts a large cargo carrier and all three occupied resources", () => {
    expect(amountStrings({ ships: { recycler: 1, large_cargo: 1 },
      cargo: cargo(["10000", "10000", "10000"]), hyperspace: 2,
      debris: { metal: "40000", crystal: "20000" } })).toEqual({
      capacity: "49500", collector: "22000", used: "30000", room: "19500",
      metal: "13000", crystal: "6500", leftMetal: "27000", leftCrystal: "13500",
    });
  });

  it("caps collection at recycler capacity even when carriers have ample room", () => {
    expect(amountStrings({ ships: { recycler: 1, large_cargo: 2 }, cargo: emptyCargo(), hyperspace: 0,
      debris: { metal: "40000", crystal: "20000" } })).toEqual({
      capacity: "70000", collector: "20000", used: "0", room: "20000",
      metal: "13333", crystal: "6667", leftMetal: "26667", leftCrystal: "13333",
    });
  });

  it("does not turn two fractional half-units into one whole unit", () => {
    expect(amountStrings({ ships: { recycler: 1 }, cargo: emptyCargo(), hyperspace: 0,
      debris: { metal: "0.5", crystal: "0.5" } })).toEqual({
      capacity: "20000", collector: "20000", used: "0", room: "20000",
      metal: "0", crystal: "0", leftMetal: "0.5", leftCrystal: "0.5",
    });
  });

  it("floors the final fractional pickup and clamps negative available room to zero", () => {
    expect(amountStrings({ ships: { recycler: 1 }, cargo: cargo(["19999.5", "0", "0"]), hyperspace: 0,
      debris: { metal: "1", crystal: "1" } })).toEqual({
      capacity: "20000", collector: "20000", used: "19999.5", room: "0.5",
      metal: "0", crystal: "0", leftMetal: "1", leftCrystal: "1",
    });
    expect(amountStrings({ ships: { recycler: 1 }, cargo: cargo(["20000", "0", "1"]), hyperspace: 0,
      debris: { metal: "40000", crystal: "20000" } })).toEqual({
      capacity: "20000", collector: "20000", used: "20001", room: "0",
      metal: "0", crystal: "0", leftMetal: "40000", leftCrystal: "20000",
    });
  });

  it("returns an owned used amount when the Decimal zero-add fast path aliases cargo", () => {
    const input: RecycleAmountsInput = freeze({ ships: { recycler: 1 }, cargo: cargo(["0", "123.125", "0"]),
      hyperspace: 2, debris: { metal: "40000", crystal: "20000" } });
    const before = JSON.stringify(input), result = calculateRecycleAmounts(input);
    expect(result.used.toString()).toBe("123.125");
    for (const resource of RESOURCE_IDS) expect(result.used).not.toBe(input.cargo[resource]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("recycle extraction: complete historical behavior equivalence", () => {
  it("preserves the absent-target identity and unrelated fields", () => {
    for (const ships of [{ recycler: 1 }, { recycler: 3, large_cargo: 7 }]) {
      expectHistoricalEquivalence(ships, ["12.25", "8.75", "99.5"], 7, null);
    }
  });

  it("matches a bounded 560-case deterministic cross-product, with no random sampling", () => {
    const fleets: ShipCounts[] = [
      { recycler: 1 },
      { recycler: 3, large_cargo: 2, small_cargo: 7, light_fighter: 31 },
      { recycler: 1, espionage_probe: 2 },
      { recycler: 1000000000000, deathstar: 1000000000000 },
    ];
    const carries: CargoStrings[] = [
      ["0", "0", "0"], ["123.125", "789.875", "0.0625"],
      ["21999.75", "0", "0"], ["1e16", "2e16", "3e16"],
    ];
    const wrecks: DebrisStrings[] = [
      ["0", "0"], ["40000", "20000"], ["0.5", "0.5"], ["0", "123456.789"],
      ["98765.4321", "0"], ["1e190", "3e189"], ["1.00000000000001", "0.99999999999999"],
    ];
    const positions: FieldPosition[] = ["first", "middle", "last"];
    let cases = 0;
    for (const ships of fleets) for (const hyperspace of [0, 1, 2, 7, 19]) {
      for (const carried of carries) for (const wreck of wrecks) {
        expectHistoricalEquivalence(ships, carried, hyperspace, wreck, positions[cases % positions.length]!);
        cases++;
      }
    }
    expect(cases).toBe(560);
  });

  it.each(SHIP_IDS)("keeps the historical cargo contribution and sum order for %s", id => {
    // Solar satellites are explicitly zero-count here; they are not dispatchable.
    // Every other carrier is mixed with a recycler, including zero-cargo entries.
    const ships: ShipCounts = { recycler: 3, [id]: id === "solar_satellite" ? 0 : 7 };
    for (const hyperspace of [0, 1, 3, 7, 19]) {
      expectHistoricalEquivalence(ships, ["4000.125", "5000.25", "10000.375"], hyperspace, ["120003.5", "89001.25"]);
    }
  });

  it("preserves all-ship accumulation order with legal maximum counts and decimal cargo", () => {
    const ships = Object.fromEntries(SHIP_IDS.map(id => [id, id === "solar_satellite" ? 0 : 1000000000000])) as ShipCounts;
    for (const hyperspace of [1, 3, 7, 19]) {
      expectHistoricalEquivalence(ships, ["100000000000000.1", "300000000000000.3", "700000000000000.7"],
        hyperspace, ["9.87654321012345e180", "1.23456789098765e179"]);
    }
  });

  it("matches tight room, zero collectors, tiny wrecks and complete depletion", () => {
    for (const carried of ["19998.99999999", "19999", "19999.00000001", "19999.5", "20000", "20000.00000001", "20001"]) {
      for (const wreck of [["1", "1"], ["0.00000000000001", "2.99999999999999"]] as const) {
        expectHistoricalEquivalence({ recycler: 1 }, [carried, "0", "0"], 0, wreck);
      }
    }
    expectHistoricalEquivalence({ large_cargo: 4 }, ["0", "0", "0"], 2, ["40000", "20000"]);
    expectHistoricalEquivalence({ recycler: 1 }, ["0", "0", "0"], 2, ["2", "1"]);
  });

  it.each(["first", "middle", "last"] as const)("retains unrelated field order with a %s target", position => {
    const { state, fleet } = fixture({ recycler: 1 }, ["0", "0", "0"], 2, ["40000", "20000"], position);
    const unrelated = state.deepSpace.debris.filter(field => coordinateKey(field.target) !== coordinateKey(TARGET));
    const result = recycleDebris(freeze(state), fleet);
    expect(result.state.deepSpace.debris.slice(0, 2)).toEqual(unrelated);
    expect(result.state.deepSpace.debris[0]).toBe(unrelated[0]);
    expect(result.state.deepSpace.debris[1]).toBe(unrelated[1]);
    expect(result.state.deepSpace.debris[2]).toEqual({ target: TARGET, metal: "25334", crystal: "12666" });
  });
});

describe("recycle economics through the real dispatch and arrival chain", () => {
  it("pays round-trip fuel only at dispatch and never subtracts it again from pickup room", () => {
    const state = createInitialState(20261012, 813579), planet = activePlanet(state);
    planet.resources = cargo(["1000000", "1000000", "1000000"]);
    Object.assign(planet.buildings, { shipyard: 6, metal_storage: 10, crystal_storage: 10, deuterium_tank: 10 });
    Object.assign(planet.units, { recycler: 1, large_cargo: 1 });
    Object.assign(state.research.levels, { combustion_drive: 6, impulse_drive: 4, hyperspace_tech: 2, computer_tech: 2 });
    const target = { ...planet.coordinates, position: 16 };
    state.deepSpace.debris = [{ target, metal: "40000", crystal: "20000" }];
    const request: FleetRequest = { mission: "recycle", target, ships: { recycler: 1, large_cargo: 1 },
      cargo: cargo(["10000", "10000", "10000"]), speedPercent: 100 };
    const before = JSON.stringify(state), quote = quoteFlight(freeze(state), freeze(request));
    expect(quote.ok, quote.reason).toBe(true);
    expect(quote.fuel.gt(0)).toBe(true);
    const launch = sendFleet(state, request);
    expect(launch.ok, launch.reason).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(launch.state.fleets[0]!.cargo).toEqual(cargo(["10000", "10000", "10000"]));
    const paidDeuterium = big(1000000).sub(10000).sub(quote.fuel);
    expect(activePlanet(launch.state).resources.deuterium).toEqual(paidDeuterium);

    const returning = tick(freeze(launch.state), launch.state.fleets[0]!.remaining);
    expect(returning.fleets[0]!.returning).toBe(true);
    expect(returning.fleets[0]!.cargo).toEqual(cargo(["23000", "16500", "10000"]));
    expect(returning.deepSpace.debris).toEqual([{ target, metal: "27000", crystal: "13500" }]);
    expect(activePlanet(returning).resources.deuterium).toEqual(paidDeuterium);
    expect(resolveFleetArrivals(freeze(returning))).toBe(returning);

    const landed = tick(returning, returning.fleets[0]!.remaining);
    expect(landed.fleets).toHaveLength(0);
    expect(activePlanet(landed).units.recycler).toBe(1);
    expect(activePlanet(landed).units.large_cargo).toBe(1);
    expect(activePlanet(landed).resources.deuterium).toEqual(big(1000000).sub(quote.fuel));
    expect(landed.deepSpace.debris).toEqual(returning.deepSpace.debris);
    expect(landed.deepSpace.seed).toBe(state.deepSpace.seed);
    expect(landed.arcade.seed).toBe(state.arcade.seed);
    expect(resolveFleetArrivals(freeze(landed))).toBe(landed);
  });
});
