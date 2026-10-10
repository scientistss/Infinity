import { afterEach, describe, expect, it, vi } from "vitest";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { emptyCargo, sendFleet, type FleetRequest } from "../src/game/fleet";
import * as fleetRules from "../src/game/fleet";
import * as galaxyRules from "../src/game/galaxy";
import { createInitialState, createPlanet } from "../src/game/state";
import { serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import * as deepModels from "../src/ui/deep-present";
import { spaceFleetView, spaceGalaxyView, spaceMessagesView, spaceOrigin, spaceView } from "../src/ui/space-present";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function fixture(): GameState {
  let state = createInitialState(42);
  const home = activePlanet(state);
  home.resources = {metal:big(1e8), crystal:big(1e8), deuterium:big(1e8)};
  Object.assign(home.units, {small_cargo:20, large_cargo:5, colony_ship:3, espionage_probe:10});
  Object.assign(state.research.levels, {combustion_drive:6, impulse_drive:3, computer_tech:6, astrophysics:3});
  const colony = createPlanet("visible-colony", {...home.coordinates, system:galaxyRules.wrap(home.coordinates.system + 1, 100)});
  colony.name = "<殖民地 & 同名>";
  colony.resources = {metal:big(12345), crystal:big(6789), deuterium:big(100)};
  state.planets.push(colony);
  const result = sendFleet(state, {mission:"transport", target:colony.coordinates, ships:{small_cargo:2}, cargo:emptyCargo(), speedPercent:100});
  expect(result.ok).toBe(true);
  state = result.state;
  state.messages.push({id:"visible-note", at:61, text:"<真实报告 & 返航>"});
  return state;
}
function request(state: GameState, charge = false): FleetRequest {
  return {mission:charge ? "charge" : "transport", target:charge ? {...activePlanet(state).coordinates, position:16} : state.planets[1]!.coordinates,
    ships:{small_cargo:1}, cargo:emptyCargo(), speedPercent:100, holdSlots:2, chargeWithBets:false};
}

afterEach(() => vi.restoreAllMocks());

describe("visible extension projections", () => {
  it.each([false, true])("matches the complete reference with charge=%s and leaves every saved field unchanged", charge => {
    const state = freeze(fixture());
    const draft = freeze(request(state, charge));
    const cursor = freeze({...activePlanet(state).coordinates});
    const before = JSON.stringify(serializeState(state));
    const beforeDraft = JSON.stringify(draft);
    const full = spaceView(state, cursor, draft);
    expect(spaceGalaxyView(state, cursor)).toEqual({rows:full.rows, seed:full.seed, phase:full.phase});
    expect(spaceFleetView(state, draft)).toEqual({isCharge:full.isCharge, chargePreview:full.chargePreview, slots:full.slots,
      quote:full.quote, ships:full.ships, fleets:full.fleets, planets:full.planets});
    expect(spaceMessagesView(state)).toEqual({messages:full.messages});
    expect(spaceOrigin(state)).toBe(full.origin);
    expect(full.rows).toHaveLength(16);
    expect(full.fleets).toHaveLength(1);
    expect(full.planets).toHaveLength(2);
    expect(full.messages[0]!.text).toBe("<真实报告 & 返航>");
    expect(JSON.stringify(serializeState(state))).toBe(before);
    expect(JSON.stringify(draft)).toBe(beforeDraft);
  });

  it("keeps origin and visible fleet stock fresh when the active planet changes", () => {
    const first = freeze(fixture());
    const second = freeze(selectPlanet(first, "visible-colony"));
    expect(spaceOrigin(second)).not.toBe(spaceOrigin(first));
    expect(spaceFleetView(first, request(first)).planets.map(planet => planet.selected)).toEqual([true, false]);
    expect(spaceFleetView(second, request(second)).planets.map(planet => planet.selected)).toEqual([false, true]);
    expect(spaceFleetView(second, request(second)).ships.find(ship => ship.id === "small_cargo")?.count).toBe(0);
  });

  it("builds galaxy rows without quoting a draft or formatting hidden fleet details", () => {
    const state = freeze(fixture());
    const quote = vi.spyOn(fleetRules, "quoteFlight");
    const charge = vi.spyOn(deepModels, "chargePreview");
    const details = vi.spyOn(deepModels, "deepFlightDetails");
    const npc = vi.spyOn(galaxyRules, "npcAt");
    const result = spaceGalaxyView(state, activePlanet(state).coordinates);
    expect(result.rows).toHaveLength(16);
    expect(npc).toHaveBeenCalledTimes(16);
    expect(quote).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });

  it("builds fleet cards without generating hidden galaxy rows", () => {
    const state = freeze(fixture());
    const quote = vi.spyOn(fleetRules, "quoteFlight");
    const charge = vi.spyOn(deepModels, "chargePreview");
    const details = vi.spyOn(deepModels, "deepFlightDetails");
    const npc = vi.spyOn(galaxyRules, "npcAt");
    expect(spaceFleetView(state, request(state)).fleets).toHaveLength(1);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(details).toHaveBeenCalledTimes(1);
    expect(npc).not.toHaveBeenCalled();
  });

  it("reads only messages for the messages tab and no fleet or message body for shared chrome", () => {
    const state = fixture();
    Object.defineProperty(state, "fleets", {get() { throw Error("hidden fleet body read"); }});
    const origin = spaceOrigin(state);
    expect(origin).toContain(activePlanet(state).name);
    Object.defineProperty(state, "planets", {get() { throw Error("hidden planet body read"); }});
    const messages = spaceMessagesView(state).messages;
    expect(messages[0]!.time).toBe("游戏 1 分 1 秒");
    expect(messages[0]!.text).toBe("<真实报告 & 返航>");
  });
});
