import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { createPlanet } from "../src/game/planet";
import { exportSave } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState, type ResourceId } from "../src/game/types";
import { fillTransportCargo, transportLoadPreview } from "../src/ui/transport-load-model";

/** Small synthetic fixture: fixed known route/ships, not a simulated progression. */
function ready(): { state: GameState; request: FleetRequest } {
  const state = createInitialState(42);
  const origin = activePlanet(state);
  origin.coordinates = { galaxy: 1, system: 56, position: 11 };
  origin.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  origin.units.small_cargo = 2;
  Object.assign(state.research.levels, { combustion_drive: 2, impulse_drive: 3, computer_tech: 1 });
  const colony = createPlanet("colony-1", { galaxy: 1, system: 56, position: 10 });
  state.planets.push(colony);
  return { state, request: { mission: "transport", target: { ...colony.coordinates }, ships: { small_cargo: 2 },
    cargo: emptyCargo(), speedPercent: 100 } };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function expectRejected(state: GameState, request: FleetRequest, resource: ResourceId = "metal"): void {
  const before = JSON.stringify({ state, request });
  const result = fillTransportCargo(state, request, resource);
  expect(result.ok).toBe(false);
  expect(result.amount).toBeNull();
  expect(result.reason.length).toBeGreaterThan(0);
  expect(result.request).toBe(request);
  expect(JSON.stringify({ state, request })).toBe(before);
}

describe("manual transport load: independent fixed amounts", () => {
  it("reports 10000 capacity, 8 round-trip fuel and 9992 free cargo without dispatch", () => {
    const { state, request } = ready();
    const preview = transportLoadPreview(state, request);
    expect(preview.available).toBe(true);
    expect(preview.capacity?.toString()).toBe("10000");
    expect(preview.fuel?.toString()).toBe("8");
    expect(preview.load?.toString()).toBe("0");
    expect(preview.remaining?.toString()).toBe("9992");
    expect(preview.excess?.toString()).toBe("0");
    expect(preview.quote.ok).toBe(true);
    for (const id of RESOURCE_IDS) expect(preview.maxima[id].amount?.toString()).toBe("9992");
    expect(state.fleets).toHaveLength(0);
  });

  it("reports current cargo separately from fuel and shows a real overload", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(6000), crystal: big(500), deuterium: big(100) };
    const normal = transportLoadPreview(state, request);
    expect(normal.load?.toString()).toBe("6600");
    expect(normal.remaining?.toString()).toBe("3392");
    expect(normal.excess?.toString()).toBe("0");
    request.cargo = { ...emptyCargo(), metal: big(10000) };
    const over = transportLoadPreview(state, request);
    expect(over.available).toBe(true);
    expect(over.load?.toString()).toBe("10000");
    expect(over.remaining?.toString()).toBe("0");
    expect(over.excess?.toString()).toBe("8");
    expect(over.quote.ok).toBe(false);
    expect(over.maxima.metal.amount?.toString()).toBe("9992");
    expect(over.maxima.crystal.ok).toBe(false);
  });

  it.each(RESOURCE_IDS)("replaces only %s and passes authoritative dispatch", resource => {
    const { state, request } = ready();
    request.cargo[resource] = big(100000);
    const result = fillTransportCargo(state, request, resource);
    expect(result.ok).toBe(true);
    expect(result.amount?.toString()).toBe("9992");
    expect(result.request).not.toBe(request);
    expect(result.request.target).toBe(request.target);
    expect(result.request.ships).toBe(request.ships);
    expect(request.cargo[resource].toString()).toBe("100000");
    for (const other of RESOURCE_IDS.filter(id => id !== resource)) expect(result.request.cargo[other]).toBe(request.cargo[other]);
    expect(quoteFlight(state, result.request).ok).toBe(true);
    const sent = sendFleet(state, result.request);
    expect(sent.ok).toBe(true);
    expect(sent.state.fleets).toHaveLength(1);
    expect(sent.state.fleets[0]!.cargo[resource].toString()).toBe("9992");
    expect(activePlanet(sent.state).units.small_cargo).toBe(0);
    // Existing wallet arithmetic represents 1e6 - 9992 as 990008.0000000001.
    // Cargo/fuel/max above are exact golden amounts; do not change the economy
    // or move the fixture simply to erase its established representation tail.
    const wallet = activePlanet(sent.state).resources[resource];
    expect(wallet.toString()).toBe(resource === "deuterium" ? "990000" : "990008.0000000001");
    expect(Math.abs(wallet.toNumber() - (resource === "deuterium" ? 990000 : 990008))).toBeLessThanOrEqual(1e-9);
    if (resource !== "deuterium") expect(activePlanet(sent.state).resources.deuterium.toString()).toBe("999992");
    expect(state.fleets).toHaveLength(0);
  });

  it("preserves the other resources, route, speed and unrelated draft options", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(90000), crystal: big(500), deuterium: big(0) };
    request.holdSlots = 3;
    request.chargeWithBets = false;
    const result = fillTransportCargo(state, request, "metal");
    expect(result.ok).toBe(true);
    expect(result.amount?.toString()).toBe("9492");
    expect(result.request).toEqual({ ...request, cargo: { ...request.cargo, metal: big(9492) } });
    expect(result.request.cargo.crystal).toBe(request.cargo.crystal);
    expect(result.request.cargo.deuterium).toBe(request.cargo.deuterium);
  });

  it.each([
    ["metal", "123.75", "123.75"], ["crystal", "54.125", "54.125"], ["deuterium", "25.5", "17.5"],
  ] as const)("limits %s to stock while retaining fractional precision", (resource, stock, expected) => {
    const { state, request } = ready();
    activePlanet(state).resources[resource] = big(stock);
    const result = fillTransportCargo(state, request, resource);
    expect(result.ok).toBe(true);
    expect(result.amount?.toString()).toBe(expected);
    expect(quoteFlight(state, result.request).ok).toBe(true);
  });

  it("matches independently recorded natural-08 stock amounts without flooring", () => {
    const { state, request } = ready();
    // Values recorded from 08-colony-established-by-fleet-arrival in the verified
    // natural-growth report. Only these fixture values are copied, not its state.
    activePlanet(state).resources = { metal: big("32830.047738314"), crystal: big("554.808618111057"), deuterium: big("7950.03903587735") };
    const preview = transportLoadPreview(state, request);
    expect(preview.maxima.metal.amount?.toString()).toBe("9992");
    expect(preview.maxima.crystal.amount?.toString()).toBe("554.808618111057");
    expect(preview.maxima.deuterium.amount?.toString()).toBe("7942.03903587735");
    for (const id of RESOURCE_IDS) expect(fillTransportCargo(state, request, id).ok).toBe(true);
  });

  it("reserves fuel in both the shared hold and the deuterium wallet", () => {
    const { state, request } = ready();
    activePlanet(state).resources.deuterium = big(20);
    request.cargo.metal = big(500);
    request.cargo.crystal = big(250);
    const result = fillTransportCargo(state, request, "deuterium");
    expect(result.ok).toBe(true);
    expect(result.amount?.toString()).toBe("12");
    expect(transportLoadPreview(state, result.request).remaining?.toString()).toBe("9230");
    expect(activePlanet(sendFleet(state, result.request).state).resources.deuterium.toString()).toBe("0");
  });

  it("uses zero as a feasible maximum only when an empty replacement can fly", () => {
    const { state, request } = ready();
    activePlanet(state).resources.deuterium = big(8);
    request.cargo.deuterium = big(-1);
    const result = fillTransportCargo(state, request, "deuterium");
    expect(result.ok).toBe(true);
    expect(result.amount?.toString()).toBe("0");
    expect(quoteFlight(state, result.request).ok).toBe(true);
    activePlanet(state).resources.deuterium = big(7);
    expectRejected(state, request, "deuterium");
    const preview = transportLoadPreview(state, request);
    expect(preview.available).toBe(false);
    expect(preview.capacity).toBeNull();
    expect(preview.fuel).toBeNull();
  });

  it("uses current speed and research through the flight quote", () => {
    const { state, request } = ready();
    request.speedPercent = 10;
    expect(transportLoadPreview(state, request).fuel?.toString()).toBe("4");
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("9996");
    request.speedPercent = 100;
    state.research.levels.impulse_drive = 5;
    expect(transportLoadPreview(state, request).fuel?.toString()).toBe("12");
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("9988");
    state.research.levels.impulse_drive = 3;
    state.research.levels.hyperspace_tech = 10;
    expect(transportLoadPreview(state, request).capacity?.toString()).toBe("15000");
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("14992");
  });
});

describe("manual transport load: fail closed and preserve the draft", () => {
  it.each(["negative", "NaN", "Infinity", "missing", "plain-number"])("can repair one %s cargo field without accepting another invalid field", kind => {
    const { state, request } = ready();
    request.cargo.metal = kind === "negative" ? big(-1) : kind === "NaN" ? big(NaN)
      : kind === "Infinity" ? big(Infinity) : kind === "missing" ? undefined as never : 1 as never;
    const preview = transportLoadPreview(state, request);
    expect(preview.available).toBe(true);
    expect(preview.load).toBeNull();
    expect(preview.remaining).toBeNull();
    expect(preview.quote.ok).toBe(false);
    expect(preview.maxima.metal.ok).toBe(true);
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("9992");
    expectRejected(state, request, "crystal");
    expectRejected(state, request, "deuterium");
  });

  it("refuses other valid cargo above inventory or hold capacity", () => {
    const { state, request } = ready();
    activePlanet(state).resources.crystal = big(100);
    request.cargo.crystal = big(101);
    expectRejected(state, request);
    activePlanet(state).resources.crystal = big(1e6);
    request.cargo.crystal = big(10000);
    expectRejected(state, request);
    expect(fillTransportCargo(state, request, "crystal").amount?.toString()).toBe("9992");
  });

  it.each([0, 9, 11, 101, 50.5, NaN, Infinity])("refuses invalid speed %s", speed => {
    const { state, request } = ready();
    request.speedPercent = speed;
    expectRejected(state, request);
    expect(transportLoadPreview(state, request).available).toBe(false);
  });

  it.each(["same-origin", "unowned", "deep", "bad-coordinate", "missing-active"])("refuses %s route", kind => {
    const { state, request } = ready();
    if (kind === "same-origin") request.target = activePlanet(state).coordinates;
    if (kind === "unowned") request.target = { galaxy: 1, system: 55, position: 10 };
    if (kind === "deep") request.target.position = 16;
    if (kind === "bad-coordinate") request.target.system = NaN;
    if (kind === "missing-active") state.activePlanetId = "missing";
    expectRejected(state, request);
    expect(transportLoadPreview(state, request).available).toBe(false);
  });

  it.each(["empty", "negative", "fractional", "absent", "unsafe", "satellite", "unknown", "no-engine"])("refuses %s ships", kind => {
    const { state, request } = ready();
    if (kind === "empty") request.ships = {};
    if (kind === "negative") request.ships.small_cargo = -1;
    if (kind === "fractional") request.ships.small_cargo = .5;
    if (kind === "absent") request.ships.small_cargo = 3;
    if (kind === "unsafe") request.ships.small_cargo = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "satellite") request.ships.solar_satellite = 1;
    if (kind === "unknown") request.ships = { invalid_ship: 1 } as never;
    if (kind === "no-engine") Object.assign(state.research.levels, { combustion_drive: -1, impulse_drive: -1 });
    expectRejected(state, request);
  });

  it("refuses full fleet slots, exhausted IDs and fuel larger than the hold", () => {
    const first = ready();
    activePlanet(first.state).units.small_cargo = 6;
    const once = sendFleet(first.state, first.request).state;
    const twice = sendFleet(once, first.request).state;
    expect(twice.fleets).toHaveLength(2);
    expectRejected(twice, first.request);
    const second = ready();
    second.state.nextFleetId = Number.MAX_SAFE_INTEGER;
    expectRejected(second.state, second.request);
    const third = ready();
    activePlanet(third.state).units.bomber = 1;
    third.request.ships = { bomber: 1 };
    third.state.planets[1]!.coordinates.galaxy = 2;
    third.request.target.galaxy = 2;
    expectRejected(third.state, third.request);
    expect(transportLoadPreview(third.state, third.request).fuel).toBeNull();
  });

  it.each(["deploy", "colonize", "scout", "charge", "recycle"] as const)("does not offer max for %s", mission => {
    const { state, request } = ready();
    request.mission = mission;
    const preview = transportLoadPreview(state, request);
    expect(preview.available).toBe(false);
    expect(preview.reason).toContain("普通手动运输");
    for (const id of RESOURCE_IDS) expectRejected(state, request, id);
  });

  it("rejects an unknown resource and does not create a fourth cargo field", () => {
    const { state, request } = ready();
    expectRejected(state, request, "credits" as ResourceId);
    expect(Object.keys(request.cargo)).toEqual([...RESOURCE_IDS]);
  });

  it("recomputes from changed stock and ships, without using an old preview", () => {
    const { state, request } = ready();
    expect(transportLoadPreview(state, request).maxima.metal.amount?.toString()).toBe("9992");
    activePlanet(state).resources.metal = big(250);
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("250");
    activePlanet(state).units.small_cargo = 1;
    expectRejected(state, request);
  });
});

describe("manual transport load: numerical safety and complete immutability", () => {
  it("accepts large representable wallets and rejects swallowed cargo debits", () => {
    const { state, request } = ready();
    activePlanet(state).resources.metal = big("1e12");
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("9992");
    activePlanet(state).resources.metal = big("1e300");
    expectRejected(state, request);
    expect(fillTransportCargo(state, request, "metal").reason).toContain("精度");
  });

  it("treats finite scientific amounts beyond native Number range as cargo, not invalid syntax", () => {
    const { state, request } = ready();
    request.cargo.metal = big("1e999");
    const preview = transportLoadPreview(state, request);
    expect(preview.load?.toString()).toBe("1e+999");
    expect(preview.quote.ok).toBe(false);
    expect(fillTransportCargo(state, request, "metal").amount?.toString()).toBe("9992");
    expectRejected(state, request, "crystal");
  });

  it("refuses capacity/fuel precision loss and non-finite source stock", () => {
    const first = ready();
    first.state.research.levels.hyperspace_tech = 1e30;
    expectRejected(first.state, first.request);
    expect(transportLoadPreview(first.state, first.request).available).toBe(false);
    const second = ready();
    activePlanet(second.state).resources.deuterium = big("1e300");
    expectRejected(second.state, second.request);
    const third = ready();
    activePlanet(third.state).resources.metal = big(Infinity);
    expectRejected(third.state, third.request);
  });

  it("does not erase a tiny other cargo field to make a maximum fit", () => {
    const { state, request } = ready();
    request.cargo.crystal = big("1e-30");
    expectRejected(state, request, "metal");
    expect(request.cargo.crystal.toString()).toBe("1e-30");
  });

  it("rejects a positive underflow sentinel that serializes to zero", () => {
    const { state, request } = ready();
    const positive = big("1e-9000000000000000");
    expect(positive.gt(0)).toBe(true);
    expect(positive.toString()).toBe("0");
    request.cargo.crystal = positive;
    expect(transportLoadPreview(state, request).load).toBeNull();
    expectRejected(state, request, "metal");
    expect(request.cargo.crystal).toBe(positive);
    request.cargo.crystal = big(0);
    activePlanet(state).resources.crystal = positive;
    expectRejected(state, request, "crystal");
    expect(activePlanet(state).resources.crystal).toBe(positive);
  });

  it("normalizes the 0.3 boundary downward to its exact stable writable decimal", () => {
    const { state, request } = ready();
    request.cargo.crystal = big("0.3");
    const originalCrystal = request.cargo.crystal;
    const result = fillTransportCargo(state, request, "metal");
    expect(result.ok).toBe(true);
    // Ideal decimal room is 9991.7. The library's raw subtraction serializes to
    // this lower string, which reparses one mantissa step down. Requiring the raw
    // value itself to round-trip had incorrectly refused this ordinary draft.
    expect(result.amount?.toString()).toBe("9991.699999999999");
    expect(big(result.amount!.toString()).eq(result.amount!)).toBe(true);
    expect(result.amount!.lte(big("9991.7"))).toBe(true);
    expect(result.amount!.lte(activePlanet(state).resources.metal)).toBe(true);
    expect(result.request.cargo.crystal).toBe(originalCrystal);
    const load = result.request.cargo.metal.add(originalCrystal).add(result.request.cargo.deuterium).add(8);
    expect(load.lte(10000)).toBe(true);
    expect(quoteFlight(state, result.request).ok).toBe(true);
    const sent = sendFleet(state, result.request);
    expect(sent.ok).toBe(true);
    expect(activePlanet(sent.state).resources.metal.toString()).toBe("990008.3");
    expect(request.cargo.metal.toString()).toBe("0");
  });

  it("preserves the entire frozen state and request for every preview and fill", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(123.5), crystal: big(500), deuterium: big(42.25) };
    freeze(state);
    freeze(request);
    const beforeState = exportSave(state, 123);
    const beforeRequest = JSON.stringify(request);
    for (let i = 0; i < 3; i += 1) {
      transportLoadPreview(state, request);
      for (const id of RESOURCE_IDS) expect(fillTransportCargo(state, request, id).ok).toBe(true);
    }
    expect(exportSave(state, 123)).toBe(beforeState);
    expect(JSON.stringify(request)).toBe(beforeRequest);
    expect(state.fleets).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
    expect(state.nextFleetId).toBe(1);
  });
});
