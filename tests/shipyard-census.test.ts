import { describe, expect, it } from "vitest";
import { RESEARCH_IDS } from "../src/data/research";
import { DEFENSE_IDS, SHIP_IDS, unitById, type ShipId, type UnitId } from "../src/data/units";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet, withPlanet } from "../src/game/empire";
import { emptyCargo, sendFleet, type Fleet } from "../src/game/fleet";
import { createPlanet } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import { serializeState } from "../src/game/save";
import {
  advanceShipyard,
  createShipyardFleetCensus,
  MAX_PLANET_UNITS,
  nextShipyardEvent,
  orderUnits,
  shipOutputCapacity,
  shipyardPausedReason,
  unitSeconds,
  type ShipyardFleetCensus,
} from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const MAX_EMPIRE = Number.MAX_SAFE_INTEGER;

function worlds(count = 3): GameState {
  const state = createInitialState(42, 43);
  state.planets = Array.from({ length: count }, (_, index) => {
    const planet = createPlanet(index === 0 ? "homeworld" : `census-${index}`, { galaxy: 1, system: index + 1, position: 8 });
    planet.buildings.shipyard = 12;
    planet.buildings.robotics_factory = 10;
    planet.buildings.missile_silo = 10;
    planet.resources = { metal: big(1e12), crystal: big(1e12), deuterium: big(1e12) };
    return planet;
  });
  for (const id of RESEARCH_IDS) state.research.levels[id] = 20;
  return state;
}

function paid(state: GameState, id: UnitId, count: number): GameState {
  const result = orderUnits(state, id, count, "manual");
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

/** Capacity-only input, not a claim that this manifest/route is dispatchable or save-valid. */
function syntheticFleet(state: GameState, id: number, ships: Fleet["ships"], patch: Partial<Fleet> = {}): Fleet {
  return {
    id, orderTransport: null, originId: state.planets[0]!.id,
    target: { ...state.planets[state.planets.length - 1]!.coordinates },
    mission: "transport", ships, cargo: emptyCargo(), duration: 100, remaining: 100,
    returning: false, elapsed: 0, ...patch,
  };
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  Object.freeze(value);
}

function expectScanParity(state: GameState, id: UnitId, census: ShipyardFleetCensus): void {
  for (const planet of state.planets) {
    const local = selectPlanet(state, planet.id);
    for (const includeQueued of [false, true]) {
      expect(shipOutputCapacity(local, id, includeQueued, census), `${planet.id}/${id}/queued=${includeQueued}`)
        .toBe(shipOutputCapacity(local, id, includeQueued));
    }
  }
}

function snapshot(state: GameState): string {
  return JSON.stringify(serializeState(state));
}

/** Fill only the designated worlds, keeping every individual inventory at or below the local cap. */
function distributeStock(state: GameState, id: ShipId, total: number, start: number): void {
  for (const planet of state.planets.slice(start)) {
    const count = Math.min(total, MAX_PLANET_UNITS);
    planet.units[id] = count;
    total -= count;
  }
  expect(total).toBe(0);
}

describe("shipyard fleet census capacity parity", () => {
  it.each(SHIP_IDS)("matches the scan for %s on every world, including partial paid batches", id => {
    let state = worlds();
    for (let index = 0; index < state.planets.length; index++) {
      state = selectPlanet(state, state.planets[index]!.id);
      state = paid(state, id, 5 + index);
      state = advanceShipyard(state, 2.25 * unitSeconds(state, id)).state;
      const head = activePlanet(state).shipyardQueue[0]!;
      expect(head.count).toBe(3 + index);
      expect(head.orderedCount).toBe(5 + index);
    }
    state.fleets = [
      syntheticFleet(state, 1, { [id]: 3 }),
      syntheticFleet(state, 2, { [id]: 7 }, { mission: "deploy", target: { ...state.planets[1]!.coordinates } }),
      syntheticFleet(state, 3, { [id]: 11 }, { originId: state.planets[1]!.id, mission: "deploy", returning: true }),
      syntheticFleet(state, 4, {}, { originId: state.planets[2]!.id }),
    ];
    deepFreeze(state);
    const census = createShipyardFleetCensus(state.fleets);
    expectScanParity(state, id, census);
    const home = selectPlanet(state, state.planets[0]!.id);
    expect(shipOutputCapacity(home, id, false, census)).toBe(MAX_PLANET_UNITS - 12);
    // Remaining count (3), not original paid quantity (5), reserves capacity.
    expect(shipOutputCapacity(home, id, true, census)).toBe(MAX_PLANET_UNITS - 15);
  });

  it.each(DEFENSE_IDS)("keeps %s local and does not inspect unrelated fleets or worlds", id => {
    let state = worlds(2);
    const count = unitById(id).maxCount ?? 4;
    state = paid(state, id, count);
    // Deliberately synthetic inventories exercise the capacity primitive, not dome/silo order limits.
    activePlanet(state).units[id] = 7;
    state.planets[1]!.units[id] = Number.NaN;
    const fleet = syntheticFleet(state, 1, {});
    Object.defineProperty(fleet, "ships", { get: () => { throw new Error("defense queried fleet ships"); } });
    state.fleets = [fleet];
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, id, false, census)).toBe(MAX_PLANET_UNITS - 7);
    expect(shipOutputCapacity(state, id, true, census)).toBe(MAX_PLANET_UNITS - 7 - count);
    expect(shipOutputCapacity(state, id, true)).toBe(MAX_PLANET_UNITS - 7 - count);
    expectScanParity(state, id, census);
    expect(shipyardPausedReason(state, census)).toBe("");
    expect(nextShipyardEvent(state, census)).toBe(nextShipyardEvent(state));
  });

  it("does no fleet work for an idle yard", () => {
    const state = worlds(1);
    const fleet = syntheticFleet(state, 1, {});
    Object.defineProperty(fleet, "ships", { get: () => { throw new Error("idle yard queried fleet ships"); } });
    state.fleets = [fleet];
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipyardPausedReason(state, census)).toBe("");
    expect(nextShipyardEvent(state, census)).toBe(Infinity);
    expect(advanceShipyard(state, 100, true, census)).toEqual({ state, completed: [] });
  });

  it.each([
    [0, MAX_PLANET_UNITS], [MAX_PLANET_UNITS - 1, 1], [MAX_PLANET_UNITS, 0],
    [MAX_PLANET_UNITS + 1, 0], [-1, 0], [0.5, 0], [NaN, 0], [Infinity, 0], [MAX_EMPIRE + 1, 0],
  ])("handles synthetic local inventory %s at the 1e15 boundary", (count, expected) => {
    const state = worlds(1);
    activePlanet(state).units.light_fighter = count;
    const census = createShipyardFleetCensus(state.fleets);
    expectScanParity(state, "light_fighter", census);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(expected);
  });

  it("reserves only remaining queue counts at the local boundary", () => {
    let state = paid(worlds(1), "light_fighter", 5);
    state = advanceShipyard(state, 2 * unitSeconds(state, "light_fighter")).state;
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 4;
    const census = createShipyardFleetCensus(state.fleets);
    expect(activePlanet(state).shipyardQueue[0]).toMatchObject({ count: 3, orderedCount: 5 });
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(4);
    expect(shipOutputCapacity(state, "light_fighter", true, census)).toBe(1);
    expectScanParity(state, "light_fighter", census);
  });

  it.each([1, 2, 3])("checks combined home-port reservations at the local cap (last fleet=%s)", lastCount => {
    const state = worlds(2);
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 4;
    state.fleets = [
      syntheticFleet(state, 1, { light_fighter: 2 }),
      syntheticFleet(state, 2, { light_fighter: lastCount }),
    ];
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(Math.max(0, 2 - lastCount));
    expectScanParity(state, "light_fighter", census);
  });

  it.each([-1, 0.5, NaN, Infinity, MAX_PLANET_UNITS + 1])("rejects synthetic bad queued count %s only when queues are included", count => {
    let state = paid(worlds(2), "light_fighter", 3);
    activePlanet(state).shipyardQueue[0]!.count = count;
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "light_fighter", true, census)).toBe(0);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(MAX_PLANET_UNITS);
    expectScanParity(state, "light_fighter", census);
  });

  it.each([0, 1, 5])("respects the MAX_SAFE_INTEGER empire boundary with %s free slots", gap => {
    const state = worlds(11);
    distributeStock(state, "light_fighter", MAX_EMPIRE - gap, 1);
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(gap);
    expectScanParity(state, "light_fighter", census);
  });

  it.each([false, true])("combines multiple fleet counts without rounding or overflow (reverse=%s)", reverse => {
    for (const excess of [-1, 0, 1]) {
      const state = worlds(10);
      distributeStock(state, "light_fighter", 9 * MAX_PLANET_UNITS, 1);
      const remainder = MAX_EMPIRE - 9 * MAX_PLANET_UNITS;
      state.fleets = [
        syntheticFleet(state, 1, { light_fighter: remainder - 2 }, { originId: "external-port" }),
        syntheticFleet(state, 2, { light_fighter: 2 + excess }, { originId: "external-port" }),
      ];
      if (reverse) state.fleets.reverse();
      const census = createShipyardFleetCensus(state.fleets);
      expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(excess === -1 ? 1 : 0);
      expectScanParity(state, "light_fighter", census);
    }
  });

  it.each(SHIP_IDS)("isolates invalid or overflowing fleet totals for %s from every other ship", poisoned => {
    for (const counts of [[-1], [0.5], [NaN], [Infinity], [MAX_EMPIRE + 1], [MAX_EMPIRE, 1]]) {
      const state = worlds(2);
      state.fleets = counts.map((count, index) => {
        const ships: Fleet["ships"] = {};
        for (const id of SHIP_IDS) ships[id] = id === poisoned ? count : 2;
        return syntheticFleet(state, index + 1, ships);
      });
      deepFreeze(state);
      const census = createShipyardFleetCensus(state.fleets);
      // Query the bad type first, so its cached rejection cannot contaminate later good types.
      expect(shipOutputCapacity(state, poisoned, false, census)).toBe(0);
      for (const id of SHIP_IDS) {
        expectScanParity(state, id, census);
        if (id !== poisoned) expect(shipOutputCapacity(state, id, false, census)).toBe(MAX_PLANET_UNITS - 2 * counts.length);
      }
    }
  });

  it("reserves both deployment ports, de-duplicates same-port OR, and matches duplicate coordinates", () => {
    const state = worlds(14);
    const [home, destination, duplicate, uninvolved] = state.planets;
    duplicate!.coordinates = { ...destination!.coordinates };
    state.fleets = [
      syntheticFleet(state, 1, { light_fighter: 11 }, { mission: "deploy", target: { ...destination!.coordinates } }),
      syntheticFleet(state, 2, { light_fighter: 7 }, { mission: "deploy", target: { ...home!.coordinates } }),
      syntheticFleet(state, 3, { light_fighter: 13 }, { mission: "deploy", target: { ...destination!.coordinates }, returning: true }),
      syntheticFleet(state, 4, { light_fighter: 17 }, { target: { ...destination!.coordinates } }),
      syntheticFleet(state, 5, { light_fighter: 19 }, { originId: destination!.id, target: { ...home!.coordinates }, returning: true }),
      syntheticFleet(state, 6, { light_fighter: 23 }, { originId: "external-port", mission: "deploy", target: { ...destination!.coordinates } }),
      syntheticFleet(state, 7, { light_fighter: 1 }, { originId: "external-port" }),
    ];
    const census = createShipyardFleetCensus(state.fleets);
    for (const [planet, reserved] of [[home!, 48], [destination!, 53], [duplicate!, 34], [uninvolved!, 0]] as const) {
      expect(shipOutputCapacity(selectPlanet(state, planet.id), "light_fighter", false, census)).toBe(MAX_PLANET_UNITS - reserved);
    }
    expectScanParity(state, "light_fighter", census);
    // All 91 in-flight ships count once empire-wide, even with two landing reservations.
    distributeStock(state, "light_fighter", MAX_EMPIRE - 91 - 5, 4);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(5);
    expectScanParity(state, "light_fighter", census);
  });

  it("reads changed local inventories and actual paid queues with the same fleet array", () => {
    let state = paid(worlds(2), "light_fighter", 5);
    state.fleets = [syntheticFleet(state, 1, { light_fighter: 4 })];
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "light_fighter", true, census)).toBe(MAX_PLANET_UNITS - 9);
    const fleets = state.fleets;
    state = withPlanet(state, { planet: { ...activePlanet(state), units: { ...activePlanet(state).units, light_fighter: 7 } } });
    state = paid(state, "light_fighter", 3);
    expect(state.fleets).toBe(fleets);
    expect(shipOutputCapacity(state, "light_fighter", true, census)).toBe(MAX_PLANET_UNITS - 19);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(MAX_PLANET_UNITS - 11);
    expectScanParity(state, "light_fighter", census);
  });

  it("reads other worlds and queued reservations live near the empire cap", () => {
    let state = worlds(11);
    distributeStock(state, "light_fighter", MAX_EMPIRE - 10, 1);
    const census = createShipyardFleetCensus(state.fleets);
    const fleets = state.fleets;
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(10);
    const last = state.planets[state.planets.length - 1]!;
    state = selectPlanet(state, last.id);
    state = withPlanet(state, { planet: { ...last, units: { ...last.units, light_fighter: last.units.light_fighter + 4 } } });
    state = paid(state, "light_fighter", 2);
    state = selectPlanet(state, state.planets[0]!.id);
    state = paid(state, "light_fighter", 2);
    expect(state.fleets).toBe(fleets);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(6);
    expect(shipOutputCapacity(state, "light_fighter", true, census)).toBe(2);
    expectScanParity(state, "light_fighter", census);
  });

  it("falls back to live scanning when a census belongs to a replaced fleet array", () => {
    const state = worlds(2);
    state.fleets = [syntheticFleet(state, 1, { light_fighter: 4 })];
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "light_fighter", false, census)).toBe(MAX_PLANET_UNITS - 4);
    const changed = { ...state, fleets: [syntheticFleet(state, 2, { light_fighter: 9 })] };
    expect(shipOutputCapacity(changed, "light_fighter", false, census)).toBe(MAX_PLANET_UNITS - 9);
    expectScanParity(changed, "light_fighter", census);
    const empty = { ...changed, fleets: [] };
    expect(shipOutputCapacity(empty, "light_fighter", false, census)).toBe(MAX_PLANET_UNITS);
    expectScanParity(empty, "light_fighter", census);
  });
});

function paidMixedYard(): GameState {
  let state = worlds(2);
  activePlanet(state).units.small_cargo = 4;
  const sent = sendFleet(state, { mission: "deploy", target: state.planets[1]!.coordinates, ships: { small_cargo: 4 }, cargo: emptyCargo(), speedPercent: 100 });
  expect(sent.ok, sent.reason).toBe(true);
  state = sent.state;
  for (const [id, count] of [["light_fighter", 4], ["rocket_launcher", 3], ["solar_satellite", 3], ["light_fighter", 2]] as const) state = paid(state, id, count);
  return advanceShipyard(state, 2.5 * unitSeconds(state, "light_fighter")).state;
}

describe("shipyard fleet census advancement", () => {
  it.each([false, true])("matches full serialized state and completion records across batches (carry=%s)", carry => {
    const state = paidMixedYard();
    const before = snapshot(state);
    deepFreeze(state);
    const census = createShipyardFleetCensus(state.fleets);
    const per = unitSeconds(state, "light_fighter");
    expectScanParity(state, "light_fighter", census);
    expect(shipyardPausedReason(state, census)).toBe(shipyardPausedReason(state));
    expect(nextShipyardEvent(state, census)).toBe(nextShipyardEvent(state));
    for (const seconds of [0, -1, NaN, per / 4, 1.5 * per, 2 * per, 100]) {
      const scan = advanceShipyard(state, seconds, carry);
      const cached = advanceShipyard(state, seconds, carry, census);
      expect(cached.completed).toEqual(scan.completed);
      expect(snapshot(cached.state)).toBe(snapshot(scan.state));
      expect(snapshot(state)).toBe(before);
    }
    const done = advanceShipyard(state, 100, carry, census);
    expect(done.completed).toEqual(carry
      ? [{ unit: "light_fighter", count: 4 }, { unit: "rocket_launcher", count: 3 }, { unit: "solar_satellite", count: 3 }]
      : [{ unit: "light_fighter", count: 2 }]);
    expect(activePlanet(done.state).shipyardQueue).toHaveLength(carry ? 0 : 3);
  });

  it("preserves satellite event spacing, fractional progress, and energy output", () => {
    let state = paid(worlds(1), "solar_satellite", 5);
    const per = unitSeconds(state, "solar_satellite");
    state = advanceShipyard(state, per / 2).state;
    const census = createShipyardFleetCensus(state.fleets);
    const before = snapshot(state);
    expect(nextShipyardEvent(state, census)).toBe(Math.min(4.5 * per, Math.max(0.5 * per, 1)));
    const scan = advanceShipyard(state, 2 * per);
    const cached = advanceShipyard(state, 2 * per, true, census);
    expect(cached.completed).toEqual([{ unit: "solar_satellite", count: 2 }]);
    expect(activePlanet(cached.state).shipyardQueue[0]!.progress).toBeCloseTo(0.5, 12);
    expect(snapshot(cached.state)).toBe(snapshot(scan.state));
    expect(economy(cached.state).supply).toBe(economy(scan.state).supply);
    expect(economy(cached.state).supply).toBeGreaterThan(economy(state).supply);
    expect(nextShipyardEvent(cached.state, census)).toBe(nextShipyardEvent(cached.state));
    expect(snapshot(state)).toBe(before);
  });

  it("suspends paid remainder at the local cap and resumes from freshly available inventory", () => {
    let state = paid(worlds(1), "light_fighter", 5);
    state = paid(state, "rocket_launcher", 2);
    activePlanet(state).units.light_fighter = MAX_PLANET_UNITS - 2;
    const census = createShipyardFleetCensus(state.fleets);
    const before = snapshot(state);
    expect(nextShipyardEvent(state, census)).toBe(2 * unitSeconds(state, "light_fighter"));
    const scan = advanceShipyard(state, 100);
    const cached = advanceShipyard(state, 100, true, census);
    expect(cached.completed).toEqual([{ unit: "light_fighter", count: 2 }]);
    expect(snapshot(cached.state)).toBe(snapshot(scan.state));
    expect(activePlanet(cached.state).units.light_fighter).toBe(MAX_PLANET_UNITS);
    expect(activePlanet(cached.state).shipyardQueue[0]).toMatchObject({ count: 3, orderedCount: 5, progress: 0 });
    expect(activePlanet(cached.state).units.rocket_launcher).toBe(0);
    expect(shipyardPausedReason(cached.state, census)).toBe(shipyardPausedReason(cached.state));
    expect(shipyardPausedReason(cached.state, census)).toContain("安全上限");
    expect(nextShipyardEvent(cached.state, census)).toBe(Infinity);
    expect(advanceShipyard(cached.state, 100, true, census)).toEqual({ state: cached.state, completed: [] });
    const planet = activePlanet(cached.state);
    const released = withPlanet(cached.state, { planet: { ...planet, units: { ...planet.units, light_fighter: MAX_PLANET_UNITS - 1 } } });
    const resumed = advanceShipyard(released, 100, true, census);
    expect(resumed.completed).toEqual([{ unit: "light_fighter", count: 1 }]);
    expect(snapshot(resumed.state)).toBe(snapshot(advanceShipyard(released, 100).state));
    expect(snapshot(state)).toBe(before);
  });

  it("uses live fleets in event, pause, and advancement calls with a stale census", () => {
    let state = worlds(2);
    const homeId = state.planets[0]!.id;
    const targetId = state.planets[1]!.id;
    state = paid(selectPlanet(state, targetId), "small_cargo", 5);
    const stale = createShipyardFleetCensus(state.fleets);
    expect(shipOutputCapacity(state, "small_cargo", true, stale)).toBe(MAX_PLANET_UNITS - 5);
    state = selectPlanet(state, homeId);
    activePlanet(state).units.small_cargo = 4;
    const sent = sendFleet(state, { mission: "deploy", target: state.planets[1]!.coordinates, ships: { small_cargo: 4 }, cargo: emptyCargo(), speedPercent: 100 });
    expect(sent.ok, sent.reason).toBe(true);
    state = selectPlanet(sent.state, targetId);
    activePlanet(state).units.small_cargo = MAX_PLANET_UNITS - 6;
    const before = snapshot(state);
    expect(shipOutputCapacity(state, "small_cargo", false, stale)).toBe(2);
    expect(nextShipyardEvent(state, stale)).toBe(2 * unitSeconds(state, "small_cargo"));
    const cached = advanceShipyard(state, 100, true, stale);
    const scan = advanceShipyard(state, 100);
    expect(cached.completed).toEqual([{ unit: "small_cargo", count: 2 }]);
    expect(snapshot(cached.state)).toBe(snapshot(scan.state));
    expect(shipyardPausedReason(cached.state, stale)).toContain("安全上限");
    expect(nextShipyardEvent(cached.state, stale)).toBe(Infinity);
    expect(snapshot(state)).toBe(before);
  });

  it("lets an earlier yard consume empire capacity before a later yard uses the same census", () => {
    let state = worlds(12);
    state = paid(state, "light_fighter", 2);
    state = selectPlanet(state, state.planets[1]!.id);
    state = paid(state, "light_fighter", 2);
    state = selectPlanet(state, state.planets[0]!.id);
    distributeStock(state, "light_fighter", MAX_EMPIRE - 3, 2);
    const before = snapshot(state);
    const census = createShipyardFleetCensus(state.fleets);
    let scan = state;
    let cached = state;
    for (const [index, expected] of [[0, 2], [1, 1]] as const) {
      scan = selectPlanet(scan, state.planets[index]!.id);
      cached = selectPlanet(cached, state.planets[index]!.id);
      const scanStep = advanceShipyard(scan, 100);
      const cachedStep = advanceShipyard(cached, 100, true, census);
      expect(cachedStep.completed).toEqual([{ unit: "light_fighter", count: expected }]);
      expect(cachedStep.completed).toEqual(scanStep.completed);
      expect(snapshot(cachedStep.state)).toBe(snapshot(scanStep.state));
      scan = scanStep.state;
      cached = cachedStep.state;
    }
    expect(cached.fleets).toBe(state.fleets);
    expect(activePlanet(cached).shipyardQueue[0]).toMatchObject({ count: 1, orderedCount: 2, progress: 0 });
    expect(nextShipyardEvent(cached, census)).toBe(Infinity);
    expect(snapshot(state)).toBe(before);
  });

  it.each(["shipyard", "nanite_factory"] as const)("preserves the %s upgrade pause with a paid head", building => {
    const ordered = paid(worlds(1), "light_fighter", 2);
    const upgrade = enqueue(ordered, building, "manual");
    expect(upgrade.ok, upgrade.reason).toBe(true);
    const state = upgrade.state;
    const census = createShipyardFleetCensus(state.fleets);
    expect(shipyardPausedReason(state, census)).toBe(shipyardPausedReason(state));
    expect(shipyardPausedReason(state, census)).not.toBe("");
    expect(nextShipyardEvent(state, census)).toBe(Infinity);
    expect(advanceShipyard(state, 100, true, census)).toEqual({ state, completed: [] });
  });
});

describe("deterministic fleet-read work bound", () => {
  it.each(["transport", "deploy"] as const)("avoids repeated whole-fleet reads for 100 worlds / 1,000 %s fleets", mission => {
    const state = worlds(100);
    let reads = 0;
    state.fleets = Array.from({ length: 1_000 }, (_, index) => {
      const ships: Fleet["ships"] = {};
      Object.defineProperty(ships, "light_fighter", { enumerable: true, get: () => { reads++; return 1; } });
      return syntheticFleet(state, index + 1, ships, {
        mission, originId: state.planets[index % 100]!.id,
        target: { ...state.planets[(index + 1) % 100]!.coordinates },
      });
    });
    const queries = state.planets.flatMap(planet => [false, true, false, true].map(includeQueued => ({ planet, includeQueued })));
    const scan = queries.map(({ planet, includeQueued }) => shipOutputCapacity(selectPlanet(state, planet.id), "light_fighter", includeQueued));
    const scanReads = reads;
    expect(scanReads).toBe(400_000);
    expect(new Set(scan)).toEqual(new Set([MAX_PLANET_UNITS - (mission === "deploy" ? 20 : 10)]));
    reads = 0;
    const census = createShipyardFleetCensus(state.fleets);
    const cached = queries.map(({ planet, includeQueued }) => shipOutputCapacity(selectPlanet(state, planet.id), "light_fighter", includeQueued, census));
    expect(cached).toEqual(scan);
    // Includes census construction and all queries. This measures property reads, not elapsed time.
    // Per-type empire scan plus relevant origin/target reads is 5,000 / 9,000 for these fixtures.
    expect(reads).toBeGreaterThanOrEqual(1_000);
    expect(reads).toBeLessThanOrEqual(scanReads / 10);
  });
});
