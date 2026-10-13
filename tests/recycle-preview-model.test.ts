import { afterEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import * as fleet from "../src/game/fleet";
import { emptyCargo, quoteFlight, resolveFleetArrivals, sendFleet, type FleetRequest } from "../src/game/fleet";
import type { Coordinates } from "../src/game/galaxy";
import * as recycleAmounts from "../src/game/recycle-amounts";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";
import { recyclePreview } from "../src/ui/recycle-preview-model";

function ready(): { state: GameState; request: FleetRequest } {
  const state = createInitialState(20261012, 813579);
  const origin = activePlanet(state);
  origin.coordinates = { galaxy: 1, system: 50, position: 8 };
  origin.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  origin.units.recycler = 3;
  origin.units.small_cargo = 10;
  origin.units.large_cargo = 2;
  Object.assign(state.research.levels, { combustion_drive: 6, computer_tech: 3, hyperspace_tech: 2 });
  const target = { galaxy: 1, system: 50, position: 16 };
  state.deepSpace.debris = [
    { target: { ...target, system: 49 }, metal: "123", crystal: "456" },
    { target: { ...target }, metal: "40000", crystal: "20000" },
    { target: { ...target, galaxy: 2 }, metal: "789", crystal: "987" },
  ];
  return { state, request: { mission: "recycle", target, ships: { recycler: 1 },
    cargo: emptyCargo(), speedPercent: 100 } };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function expectUnavailable(state: GameState, request: FleetRequest) {
  const before = JSON.stringify({ state, request });
  const result = recyclePreview(state, request);
  expect(result?.available).toBe(false);
  expect(result?.amounts).toBeNull();
  expect(result?.visibleDebris).toBeNull();
  expect(result?.reason.length).toBeGreaterThan(0);
  expect(JSON.stringify({ state, request })).toBe(before);
  return result!;
}

afterEach(() => vi.restoreAllMocks());

describe("recycling preview: independent economic goldens", () => {
  it("shows the exact 14666/7334 split and 25334/12666 residual at current technology", () => {
    const { state, request } = ready();
    expect(quoteFlight(state, request).ok).toBe(true);
    const result = recyclePreview(state, request)!;
    expect(result.available).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.target).toBe("1:50:16");
    expect(result.visibleDebris).toEqual({ metal: "40000", crystal: "20000" });
    expect(result.amounts).toEqual({ capacity: "22000", collector: "22000", used: "0", room: "22000",
      metal: "14666", crystal: "7334", leftMetal: "25334", leftCrystal: "12666" });
    expect(result.summary).toBe("预计回收（当前条件）：金属 14666 · 晶体 7334");
    expect(result.notice).toContain("当前可见残骸");
    expect(result.notice).toContain("当前超空间科技");
    expect(result.notice).toContain("抵达时结算");
    expect(result.notice).toContain("返航后才入库");
    expect(result.notice).toContain("不会派遣、占用或预留残骸");
  });

  it("counts metal, crystal and deuterium cargo and never subtracts fuel twice", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(1000), crystal: big(1000), deuterium: big(500) };
    const quote = quoteFlight(state, request);
    expect(quote.ok).toBe(true);
    expect(quote.fuel.gt(0)).toBe(true);
    expect(recyclePreview(state, request, quote)?.amounts).toEqual({
      capacity: "22000", collector: "22000", used: "2500", room: "19500",
      metal: "13000", crystal: "6500", leftMetal: "27000", leftCrystal: "13500",
    });
  });

  it("counts mixed-ship cargo holds but limits collection to the recycler hold", () => {
    const { state, request } = ready();
    request.ships = { recycler: 1, small_cargo: 10 };
    request.cargo = { metal: big(25000), crystal: big(0), deuterium: big(0) };
    expect(recyclePreview(state, request)?.amounts).toEqual({
      capacity: "77000", collector: "22000", used: "25000", room: "22000",
      metal: "14666", crystal: "7334", leftMetal: "25334", leftCrystal: "12666",
    });
  });

  it("preserves the fractional zero/zero pickup without pretending the field is missing", () => {
    const { state, request } = ready();
    Object.assign(state.deepSpace.debris[1]!, { metal: "0.5", crystal: "0.5" });
    const result = recyclePreview(state, request)!;
    expect(result.available).toBe(true);
    expect(result.amounts).toEqual({ capacity: "22000", collector: "22000", used: "0", room: "22000",
      metal: "0", crystal: "0", leftMetal: "0.5", leftCrystal: "0.5" });
  });

  it.each([
    ["0", "0", "0", "0"], ["123", "0", "123", "0"], ["0", "456", "0", "456"],
  ])("handles current field %s/%s without a made-up proportional remainder", (metal, crystal, takeMetal, takeCrystal) => {
    const { state, request } = ready();
    Object.assign(state.deepSpace.debris[1]!, { metal, crystal });
    const result = recyclePreview(state, request)!;
    expect(result.status).toBe("ready");
    expect(result.amounts).toMatchObject({ metal: takeMetal, crystal: takeCrystal, leftMetal: "0", leftCrystal: "0" });
  });

  it("matches actual arrival collection from the unchanged draft, with fuel paid only on dispatch", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(1000), crystal: big(1000), deuterium: big(500) };
    const quote = quoteFlight(state, request);
    const model = recyclePreview(state, request, quote)!;
    const sent = sendFleet(state, request);
    expect(sent.ok).toBe(true);
    expect(activePlanet(sent.state).resources.deuterium.eq(activePlanet(state).resources.deuterium.sub(500).sub(quote.fuel))).toBe(true);
    const arrived = resolveFleetArrivals({ ...sent.state,
      fleets: sent.state.fleets.map(value => ({ ...value, remaining: 0, elapsed: value.duration })) });
    const returning = arrived.fleets[0]!;
    expect(returning.returning).toBe(true);
    expect(returning.cargo.metal.toString()).toBe("14000");
    expect(returning.cargo.crystal.toString()).toBe("7500");
    expect(returning.cargo.deuterium.toString()).toBe("500");
    expect(returning.cargo.metal.sub(request.cargo.metal).toString()).toBe(model.amounts!.metal);
    expect(returning.cargo.crystal.sub(request.cargo.crystal).toString()).toBe(model.amounts!.crystal);
    expect(arrived.deepSpace.debris.find(value => value.target.position === 16 && value.target.system === 50 && value.target.galaxy === 1))
      .toMatchObject({ metal: model.amounts!.leftMetal, crystal: model.amounts!.leftCrystal });
  });
});

describe("recycling preview: current visibility and authoritative eligibility", () => {
  it.each(["transport", "deploy", "colonize", "scout", "charge", "attack", "unknown"])("returns null for %s before any quote or state access", mission => {
    const quote = vi.spyOn(fleet, "quoteFlight");
    const state = new Proxy({} as GameState, { get() { throw Error("unrelated state must not be read"); } });
    const request = { mission } as FleetRequest;
    expect(recyclePreview(state, request)).toBeNull();
    expect(quote).not.toHaveBeenCalled();
    expect(recyclePreview(state, null as never)).toBeNull();
  });

  it("quotes an ordinary draft once and uses the shared arithmetic once", () => {
    const { state, request } = ready();
    const quote = vi.spyOn(fleet, "quoteFlight");
    const calculate = vi.spyOn(recycleAmounts, "calculateRecycleAmounts");
    expect(recyclePreview(state, request)?.available).toBe(true);
    expect(quote).toHaveBeenCalledExactlyOnceWith(state, request);
    expect(calculate).toHaveBeenCalledExactlyOnceWith({ ships: request.ships, cargo: request.cargo,
      hyperspace: 2, debris: state.deepSpace.debris[1] });
  });

  it("accepts the already-computed current quote without quoting twice", () => {
    const { state, request } = ready();
    const quote = quoteFlight(state, request);
    const expected = recyclePreview(state, request, quote);
    const spy = vi.spyOn(fleet, "quoteFlight").mockImplementation(() => { throw Error("duplicate quote"); });
    expect(recyclePreview(state, request, quote)).toEqual(expected);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never calculates quantities after a failed current quote", () => {
    const { state, request } = ready();
    request.speedPercent = 11;
    const quote = quoteFlight(state, request);
    const calculate = vi.spyOn(recycleAmounts, "calculateRecycleAmounts");
    expect(recyclePreview(state, request, quote)).toMatchObject({ available: false, reason: quote.reason, amounts: null });
    expect(calculate).not.toHaveBeenCalled();
  });

  it.each([
    { galaxy: 1, system: 1, position: 1 }, { galaxy: 5, system: 100, position: 15 },
    { galaxy: 5, system: 100, position: 16 }, { galaxy: 1, system: 50, position: 8 },
  ])("supports an exact visible wreck at every legal coordinate boundary $galaxy:$system:$position", target => {
    const { state, request } = ready();
    request.target = target;
    state.deepSpace.debris[1]!.target = { ...target };
    expect(quoteFlight(state, request).ok).toBe(true);
    expect(recyclePreview(state, request)?.amounts?.metal).toBe("14666");
  });

  it.each([
    { galaxy: 0, system: 50, position: 16 }, { galaxy: 6, system: 50, position: 16 },
    { galaxy: 1, system: 0, position: 16 }, { galaxy: 1, system: 101, position: 16 },
    { galaxy: 1, system: 50, position: 0 }, { galaxy: 1, system: 50, position: 17 },
    { galaxy: 1, system: 50.5, position: 16 }, { galaxy: 1, system: NaN, position: 16 },
    { galaxy: 1, system: Infinity, position: 16 }, null,
  ])("rejects invalid coordinates %# without a numeric preview", target => {
    const { state, request } = ready();
    request.target = target as Coordinates;
    const quote = quoteFlight(state, request);
    expect(quote.ok).toBe(false);
    expect(expectUnavailable(state, request).reason).toBe(quote.reason);
  });

  it("distinguishes a missing current visible wreck from a real zero-valued wreck", () => {
    const { state, request } = ready();
    state.deepSpace.debris.splice(1, 1);
    const result = expectUnavailable(state, request);
    expect(result.status).toBe("no-visible-debris");
    expect(result.reason).toContain("当前没有可见残骸");
  });

  it.each(["galaxy", "system", "position"] as const)("does not substitute nearby debris with a different %s", coordinate => {
    const { state, request } = ready();
    state.deepSpace.debris = [{ target: { ...request.target, [coordinate]: request.target[coordinate] - 1 }, metal: "999999", crystal: "999999" }];
    expect(expectUnavailable(state, request).status).toBe("no-visible-debris");
  });

  it.each(["no-recycler", "too-many", "fractional", "unknown", "satellite", "speed", "slots", "fuel", "stock", "overload", "fleet-id"])("preserves the real quote rejection for %s", kind => {
    const { state, request } = ready();
    if (kind === "no-recycler") request.ships = { small_cargo: 1 };
    if (kind === "too-many") request.ships.recycler = 4;
    if (kind === "fractional") request.ships.recycler = 0.5;
    if (kind === "unknown") request.ships = { recycler: 1, unsupported: 1 } as never;
    if (kind === "satellite") request.ships.solar_satellite = 1;
    if (kind === "speed") request.speedPercent = 9;
    if (kind === "slots") state.research.levels.computer_tech = -1;
    if (kind === "fuel") activePlanet(state).resources.deuterium = big(0);
    if (kind === "stock") request.cargo.metal = big(2e6);
    if (kind === "overload") request.cargo.metal = big(22000);
    if (kind === "fleet-id") state.nextFleetId = Number.MAX_SAFE_INTEGER;
    const quote = quoteFlight(state, request);
    expect(quote.ok).toBe(false);
    expect(expectUnavailable(state, request).reason).toBe(quote.reason);
  });

  it("uses the newly selected visible field and current hyperspace without retaining a stale result", () => {
    const { state, request } = ready();
    expect(recyclePreview(state, request)?.amounts?.capacity).toBe("22000");
    state.research.levels.hyperspace_tech = 0;
    request.target = { ...state.deepSpace.debris[0]!.target };
    expect(recyclePreview(state, request)?.amounts).toMatchObject({ capacity: "20000", collector: "20000", metal: "123", crystal: "456" });
  });

  it("does not inspect hidden NPC data, future events or research queues", () => {
    const { state, request } = ready();
    const expected = recyclePreview(state, request);
    const forbidden = () => { throw Error("hidden data or future event projection is forbidden"); };
    for (const key of ["npcEconomy", "npcBattles", "totalTime", "arcade"] as const) Object.defineProperty(state, key, { get: forbidden });
    for (const key of ["reports", "offers", "seed"] as const) Object.defineProperty(state.deepSpace, key, { get: forbidden });
    Object.defineProperty(state.research, "queue", { get: forbidden });
    expect(recyclePreview(state, request)).toEqual(expected);
  });
});

describe("recycling preview: numeric boundaries and readonly ownership", () => {
  it.each(["1e999", "1e-999"])("accepts valid Decimal debris beyond native Number range: %s", metal => {
    const { state, request } = ready();
    Object.assign(state.deepSpace.debris[1]!, { metal, crystal: "0" });
    const result = recyclePreview(state, request)!;
    expect(result.available).toBe(true);
    expect(result.visibleDebris?.metal).toBe(big(metal).toString());
    expect(result.amounts?.metal).toBe(metal === "1e999" ? "22000" : "0");
    expect(result.amounts?.leftMetal).toBe(big(metal).toString());
  });

  it("recognizes huge valid cargo as an ineligible load rather than invalid Decimal syntax", () => {
    const { state, request } = ready();
    activePlanet(state).resources.metal = big("1e999");
    request.cargo.metal = big("1e999");
    const result = expectUnavailable(state, request);
    expect(result.reason).toBe("货舱不足（货物与预留往返燃料共用货舱）");
  });

  it.each(["negative", "NaN", "Infinity", "missing", "plain-number", "underflow"])("refuses %s cargo without throwing or fabricating amounts", kind => {
    const { state, request } = ready();
    request.cargo.crystal = kind === "negative" ? big(-1) : kind === "NaN" ? big(NaN)
      : kind === "Infinity" ? big(Infinity) : kind === "missing" ? undefined as never
        : kind === "plain-number" ? 1 as never : big("1e-9000000000000000");
    expectUnavailable(state, request);
  });

  it.each(["-1", "NaN", "Infinity", "garbage", "", " 100 ", "1e9000000000000000", "1e-9000000000000000"])("refuses unsupported visible debris text %s", metal => {
    const { state, request } = ready();
    state.deepSpace.debris[1]!.metal = metal;
    expect(expectUnavailable(state, request).reason).toContain("残骸数量无效");
  });

  it.each(["ships", "cargo", "active-planet", "debris", "research"])("handles missing %s without breaking rendering", kind => {
    const { state, request } = ready();
    if (kind === "ships") request.ships = undefined as never;
    if (kind === "cargo") request.cargo = undefined as never;
    if (kind === "active-planet") state.activePlanetId = "missing";
    if (kind === "debris") state.deepSpace.debris = undefined as never;
    if (kind === "research") state.research = undefined as never;
    expectUnavailable(state, request);
  });

  it.each([-1, 0.5, NaN, Infinity, 1e30])("rejects invalid hyperspace %s rather than producing a misleading estimate", hyperspace => {
    const { state, request } = ready();
    state.research.levels.hyperspace_tech = hyperspace;
    expectUnavailable(state, request);
  });

  it("keeps the entire frozen input, Decimal identities and RNG unchanged across repeated previews", () => {
    const { state, request } = ready();
    request.cargo = { metal: big(1000), crystal: big(1000), deuterium: big(500) };
    request.holdSlots = 3;
    request.chargeWithBets = false;
    const input = { state, request };
    const serialized = JSON.stringify(input);
    const rootEntries = Object.entries(state);
    const cargoRefs = { ...request.cargo };
    const stockRefs = { ...activePlanet(state).resources };
    const debrisRefs = state.deepSpace.debris.slice();
    const random = vi.spyOn(Math, "random");
    const dispatch = vi.spyOn(fleet, "sendFleet");
    const arrivals = vi.spyOn(fleet, "resolveFleetArrivals");
    freeze(input);
    const first = recyclePreview(state, request);
    for (let n = 0; n < 5; n++) expect(recyclePreview(state, request)).toEqual(first);
    expect(first?.available).toBe(true);
    expect(JSON.stringify(input)).toBe(serialized);
    for (const [key, value] of rootEntries) expect(state[key as keyof GameState]).toBe(value);
    for (const id of RESOURCE_IDS) {
      expect(request.cargo[id]).toBe(cargoRefs[id]);
      expect(activePlanet(state).resources[id]).toBe(stockRefs[id]);
    }
    debrisRefs.forEach((field, index) => expect(state.deepSpace.debris[index]).toBe(field));
    expect(random).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(arrivals).not.toHaveBeenCalled();
    expect(state.fleets).toHaveLength(0);
    expect(state.nextFleetId).toBe(1);
  });
});
