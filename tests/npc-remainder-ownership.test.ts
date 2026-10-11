import { describe, expect, it } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, nextFleetEvent, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { NpcSettlementError, npcWalletContext, retryNpcAttackDock, isNpcAttackDockBlocked } from "../src/game/npc-attack";
import { advanceNpcWallet } from "../src/game/npc-wallet";
import { clonePlanet, createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const order = (): FleetRequest => ({ mission: "attack", target: { galaxy: 1, system: 56, position: 6 },
  ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
function ready(): GameState {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 2;
  Object.assign(planet.units, { light_fighter: 20, small_cargo: 2 });
  Object.assign(state.research.levels, { combustion_drive: 2, computer_tech: 10, weapons_tech: 1 });
  state.protocols.slots.forEach(slot => { slot.card = null; });
  return deserializeState(serializeState(state));
}
function returning(): GameState {
  let state = ready();
  state = { ...state, npcEconomy: advanceNpcWallet(state.npcEconomy, 60, npcWalletContext(state)) };
  const sent = sendFleet(state, order()); expect(sent.ok, sent.reason).toBe(true);
  const result = advanceFleets(sent.state, nextFleetEvent(sent.state));
  expect(result.npcBattles.reports[0].loot).toEqual([400, 200, 30]);
  expect(result.fleets[0].returning).toBe(true);
  return result;
}

describe("NPC settlement has exactly one captured planet owner", () => {
  it("refuses duplicate launch owners before funds, IDs or target reservations", () => {
    const state = ready(); state.planets.push(clonePlanet(activePlanet(state)));
    const before = JSON.stringify(state), draft = JSON.stringify(order());
    expect(quoteFlight(state, order()).ok).toBe(false);
    const result = sendFleet(state, order());
    expect(result.ok).toBe(false); expect(result.reason).toContain("身份不唯一");
    expect(result.state).toBe(state); expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(order())).toBe(draft);
  });

  it.each(["duplicate", "missing"])("rejects %s dock owner with original fleet, cargo and receipts intact", kind => {
    const state = returning();
    state.planets = kind === "duplicate" ? [state.planets[0], clonePlanet(state.planets[0])]
      : [createPlanet("other", { galaxy: 1, system: 55, position: 1 })];
    const before = JSON.stringify(state), fleets = state.fleets, history = state.npcBattles;
    expect(() => advanceFleets(state, nextFleetEvent(state))).toThrow(NpcSettlementError);
    expect(JSON.stringify(state)).toBe(before); expect(state.fleets).toBe(fleets); expect(state.npcBattles).toBe(history);
  });

  it("credits the launch planet even after active selection changes, preserving the other planet's rights", () => {
    const state = returning(), colony = createPlanet("colony-1", { galaxy: 1, system: 55, position: 1 });
    colony.resources.metal = big(123); colony.npcResourceRemainder.metal = "0.25";
    state.planets.push(colony); state.activePlanetId = colony.id;
    const before = JSON.stringify(colony), arrived = advanceFleets(state, nextFleetEvent(state));
    expect(arrived.fleets).toHaveLength(0);
    expect(arrived.npcBattles.reports[0].delivery).toBe("delivered");
    expect(arrived.activePlanetId).toBe(colony.id);
    expect(arrived.planets[1]).toBe(colony); expect(JSON.stringify(arrived.planets[1])).toBe(before);
    expect(arrived.planets[0].units.light_fighter).toBeGreaterThan(0);
    expect(arrived.planets[0].npcResourceRemainder.metal).not.toBe("0.25");
    expect(serializeState(deserializeState(serializeState(arrived)))).toEqual(serializeState(arrived));
  });

  it.each(["planet-getter", "resource-getter", "hidden"])("rejects %s new authority without invoking accessors during quote or send", kind => {
    const state = ready(), planet = activePlanet(state), prior = planet.npcResourceRemainder;
    let reads = 0;
    if (kind === "planet-getter") Object.defineProperty(planet, "npcResourceRemainder", { enumerable: true, configurable: true,
      get() { reads++; throw Error("Authority getter executed"); } });
    else if (kind === "resource-getter") Object.defineProperty(prior, "deuterium", { enumerable: true, configurable: true,
      get() { reads++; throw Error("Resource getter executed"); } });
    else Object.defineProperty(planet, "npcResourceRemainder", { enumerable: false, configurable: true, value: prior });
    const wallet = { ...planet.resources }, units = { ...planet.units }, id = state.nextFleetId, sites = state.npcEconomy;
    expect(quoteFlight(state, order()).ok).toBe(false);
    const result = sendFleet(state, order());
    expect(result.ok).toBe(false); expect(result.state).toBe(state);
    expect(reads).toBe(0); expect(planet.resources).toEqual(wallet); expect(planet.units).toEqual(units);
    expect(state.nextFleetId).toBe(id); expect(state.npcEconomy).toBe(sites);
  });

  it("freezes an invalid dock authority without evaluating it or adopting any transfer", () => {
    const state = returning(), planet = activePlanet(state), fleets = state.fleets, reports = state.npcBattles;
    const resources = JSON.stringify(planet.resources), units = { ...planet.units };
    let reads = 0;
    Object.defineProperty(planet, "npcResourceRemainder", { enumerable: true, configurable: true,
      get() { reads++; throw Error("Dock authority getter executed"); } });
    expect(() => advanceFleets(state, nextFleetEvent(state))).toThrow(NpcSettlementError);
    expect(reads).toBe(0); expect(state.fleets).toBe(fleets); expect(state.npcBattles).toBe(reports);
    expect(JSON.stringify(planet.resources)).toBe(resources); expect(planet.units).toEqual(units);
  });
});


describe("NPC launch preserves canonical affordability and bounded landed stock", () => {
  it("cannot spend a pending right to cover a 70-unit fuel bill", () => {
    const state = ready(), planet = activePlanet(state);
    expect(quoteFlight(state, order()).fuel.toString()).toBe("70");
    planet.resources.deuterium = big("69.75"); planet.npcResourceRemainder.deuterium = "0.25";
    const before = serializeState(state), id = state.nextFleetId;
    expect(quoteFlight(state, order()).reason).toContain("不足");
    const sent = sendFleet(state, order());
    expect(sent.ok).toBe(false); expect(sent.state).toBe(state);
    expect(serializeState(state)).toEqual(before); expect(state.nextFleetId).toBe(id);
  });
  it("accepts a canonically exact 70 despite a lower internal mantissa", () => {
    const state = ready(), planet = activePlanet(state), wallet = big(0);
    wallet.mantissa = 6.999999999999999; wallet.exponent = 1;
    expect(wallet.toString()).toBe("70"); expect(wallet.lt(70)).toBe(true);
    expect(big(wallet.toString()).toString()).toBe("70");
    planet.resources.deuterium = wallet;
    const before = serializeState(state), sent = sendFleet(state, order());
    expect(sent.ok, sent.reason).toBe(true); expect(serializeState(state)).toEqual(before);
    expect(activePlanet(sent.state).resources.deuterium.toString()).toBe("0");
    expect(activePlanet(sent.state).npcResourceRemainder.deuterium).toBe("0");
    expect(sent.state.nextFleetId).toBe(state.nextFleetId + 1);
    expect(serializeState(deserializeState(serializeState(sent.state)))).toEqual(serializeState(sent.state));
  });
  it("can release a full reader-valid port by a small paid attack; old missions retain their guard", () => {
    const state = ready(); activePlanet(state).units.light_fighter = 1e15; activePlanet(state).units.espionage_probe = 1;
    const loaded = deserializeState(serializeState(state));
    const request = { ...order(), ships: { light_fighter: 6 } };
    expect(quoteFlight(loaded, { ...request, mission: "scout" as const, ships: { espionage_probe: 1 } }).reason).toBe("舰船数量超过运行安全上限");
    const before = serializeState(loaded), sent = sendFleet(loaded, request);
    expect(sent.ok, sent.reason).toBe(true); expect(serializeState(loaded)).toEqual(before);
    expect(activePlanet(sent.state).units.light_fighter).toBe(1e15 - 6);
    expect(sent.state.fleets[0].ships.light_fighter).toBe(6);
    expect(serializeState(deserializeState(serializeState(sent.state)))).toEqual(serializeState(sent.state));
    const tooMany = sendFleet(loaded, { ...request, ships: { light_fighter: 1e12 + 1 } });
    expect(tooMany.ok).toBe(false); expect(tooMany.state).toBe(loaded);
    expect(serializeState(loaded)).toEqual(before);
  });
  it("frees a blocked port by a real paid dispatch and deposits the old fleet exactly once", () => {
    const source = returning(); activePlanet(source).units.light_fighter = 1e15;
    const blocked = advanceFleets(source, nextFleetEvent(source));
    expect(isNpcAttackDockBlocked(blocked.fleets[0])).toBe(true);
    const frozen = serializeState(blocked);
    expect(retryNpcAttackDock(blocked, 1).state).toBe(blocked);
    expect(serializeState(blocked)).toEqual(frozen);
    const survivors = blocked.fleets[0].ships.light_fighter!;
    expect(survivors).toBe(20);
    const release = { ...order(), ships: { light_fighter: survivors } };
    const quote = quoteFlight(blocked, release); expect(quote.ok, quote.reason).toBe(true);
    const sent = sendFleet(blocked, release); expect(sent.ok, sent.reason).toBe(true);
    expect(serializeState(blocked)).toEqual(frozen);
    const second = sent.state.fleets.find(fleet => fleet.id === 2)!;
    expect(second.ships.light_fighter).toBe(survivors);
    const paid = activePlanet(sent.state), before = serializeState(sent.state);
    const retried = retryNpcAttackDock(sent.state, 1); expect(retried.ok, retried.reason).toBe(true);
    const home = activePlanet(retried.state);
    expect(serializeState(sent.state)).toEqual(before);
    expect(home.units.light_fighter).toBe(1e15);
    expect(retried.state.fleets).toEqual([second]);
    expect(retried.state.npcBattles.reports[0].delivery).toBe("delivered");
    const fixed = (text: string) => {
      expect(text).toMatch(/^\d+(?:\.\d{1,24})?$/);
      const [whole, fraction = ""] = text.split(".");
      return BigInt(whole + fraction.padEnd(24, "0"));
    };
    for (const [index, id] of (["metal", "crystal", "deuterium"] as const).entries()) {
      expect(fixed(home.resources[id].toString()) + fixed(home.npcResourceRemainder[id]))
        .toBe(fixed(paid.resources[id].toString()) + fixed(paid.npcResourceRemainder[id])
          + BigInt([400, 200, 30][index]) * 10n ** 24n);
    }
    const loaded = deserializeState(serializeState(retried.state)), saved = serializeState(loaded);
    expect(retryNpcAttackDock(loaded, 1).state).toBe(loaded);
    expect(serializeState(loaded)).toEqual(saved);
  });

  it("rejects landed overflow, unsafe empire totals and invalid in-flight amounts atomically", () => {
    for (const kind of ["landed", "empire", "fleet"] as const) {
      const state = ready();
      if (kind === "landed") activePlanet(state).units.light_fighter = 1e15 + 1;
      if (kind === "empire") for (let i = 0; i < 10; i++) {
        const planet = createPlanet(`extra-${i}`, { galaxy: 1, system: 1 + i, position: 1 });
        planet.units.light_fighter = 1e15; state.planets.push(planet);
      }
      if (kind === "fleet") {
        const sent = sendFleet(state, order()); expect(sent.ok).toBe(true);
        state.fleets = sent.state.fleets; state.fleets[0].ships.light_fighter = 1e12 + 1;
      }
      const before = JSON.stringify(state), result = sendFleet(state, order());
      expect(result.ok).toBe(false); expect(result.state).toBe(state); expect(JSON.stringify(state)).toBe(before);
    }
  });
});
