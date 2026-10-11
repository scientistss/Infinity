import { describe, expect, it } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, nextFleetEvent, quoteFlight, recallFleet, sendFleet, type FleetRequest } from "../src/game/fleet";
import { coordinateKey, npcAt, SPACE, type Coordinates } from "../src/game/galaxy";
import { prestige } from "../src/game/logic";
import { isNpcAttackDockBlocked, npcWalletContext, retryNpcAttackDock } from "../src/game/npc-attack";
import { NPC_SITE_LIMIT, NPC_TERMINAL_REPORT_LIMIT, trimNpcBattleReports } from "../src/game/npc-attack-state";
import { npcScoutReportText } from "../src/game/npc-scout";
import { advanceNpcWallet, materializeNpcAtPaidLaunch, projectNpc } from "../src/game/npc-wallet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";

const TARGET = { galaxy: 1, system: 56, position: 6 };
function ready(): GameState {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 2;
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000, espionage_probe: 10 });
  Object.assign(state.research.levels, { combustion_drive: 2, computer_tech: 100, weapons_tech: 1 });
  state.protocols.slots.forEach(slot => { slot.card = null; });
  // Normalize the explicitly synthetic prerequisites once before real payment.
  // The established save reader refreshes unlocks; tick(0) does not.
  return deserializeState(serializeState(state));
}
const request = (target: Coordinates = TARGET): FleetRequest => ({ mission: "attack", target, ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
function launch(state = ready(), order = request()): GameState {
  const result = sendFleet(state, order);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
const arrive = (state: GameState) => advanceFleets(state, nextFleetEvent(state));
const save = (state: GameState) => serializeState(state);
// Independent bounded integer-grid oracle for this million-unit synthetic world.
const SCALE = 10n ** 24n;
function exactUnits(text: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw Error("Invalid test decimal");
  const fraction = match[2] ?? "", power = 24 + Number(match[3] ?? 0) - fraction.length;
  if (power < 0 || power > 100) throw Error("Test amount exceeds independent grid");
  return BigInt(match[1] + fraction) * 10n ** BigInt(power);
}
function entitlement(state: GameState, id: typeof RESOURCE_IDS[number]): bigint {
  const planet = activePlanet(state);
  return exactUnits(planet.resources[id].toString()) + exactUnits(planet.npcResourceRemainder[id]);
}

// Test fixtures are explicit; the separate natural route proves paid acquisition of levels/ships.
describe("actual paid NPC dispatch", () => {
  it("quotes read-only; adopts site, one exact fuel payment, ships and full ID atomically", () => {
    const state = ready(), before = save(state), order = request(), quote = quoteFlight(state, order);
    expect(quote.ok, quote.reason).toBe(true);
    expect(quote.npcFuelIntent?.expectedFuelInteger).toBe(quote.fuel.toString());
    expect(save(state)).toEqual(before);
    const next = launch(state, order);
    expect(Object.keys(next.npcEconomy.sites)).toEqual([coordinateKey(TARGET)]);
    expect(next.nextFleetId).toBe(state.nextFleetId + 1);
    expect(next.fleets[0].npcAttack?.phase).toEqual({ kind: "outbound" });
    expect(quote.fuel.toString()).toBe("70");
    expect(entitlement(next, "deuterium")).toBe(999930n * SCALE);
    expect(activePlanet(next).units.light_fighter).toBe(980);
    expect(next.arcade).toBe(state.arcade);
    expect(next.deepSpace).toBe(state.deepSpace);
    expect(save(state)).toEqual(before);
  });
  it.each(["locked-attack", "locked-ship", "cargo", "not-npc", "precision", "id", "no-stock", "satellite"])("rejects %s without using funds, ships, target capacity or IDs", kind => {
    const state = ready(), order = request();
    if (kind === "locked-attack") state.research.levels.weapons_tech = 0;
    if (kind === "locked-ship") { state.research.levels.combustion_drive = 1; }
    if (kind === "cargo") order.cargo.metal = big(1);
    if (kind === "not-npc") order.target = activePlanet(state).coordinates;
    if (kind === "precision") activePlanet(state).resources.deuterium = big("1e400");
    if (kind === "id") state.nextFleetId = Number.MAX_SAFE_INTEGER;
    if (kind === "no-stock") order.ships.light_fighter = 1001;
    if (kind === "satellite") order.ships.solar_satellite = 1;
    const before = JSON.stringify(state), result = sendFleet(state, order);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(order.cargo).toBe(order.cargo);
  });
  it("does not tighten the old mission ship-unlock rule", () => {
    const state = ready();
    state.research.levels.combustion_drive = 3;
    activePlanet(state).buildings.shipyard = 0;
    expect(quoteFlight(state, { ...request(), mission: "scout", ships: { espionage_probe: 1 }, cargo: emptyCargo() }).ok).toBe(true);
  });
  it("allows 64 unfinished attacks but refuses the 65th before payment", () => {
    let state = ready();
    const order = { ...request(), ships: { light_fighter: 1 } };
    for (let i = 0; i < 64; i++) {
      // Explicit fixture refueling isolates the fleet cap from independent strict
      // Decimal debit representation failures after many repeated payments.
      state = { ...state, planets: state.planets.map(planet => ({ ...planet, resources: { ...planet.resources, deuterium: big(1e6) } })) };
      const quote = quoteFlight(state, order);
      expect(quote.ok, quote.reason).toBe(true);
      const fuel = Number(quote.npcFuelIntent!.expectedFuelInteger);
      state = launch(state, order);
      expect(activePlanet(state).resources.deuterium.toString()).toBe(String(1_000_000 - fuel));
      expect(state.nextFleetId).toBe(i + 2);
    }
    expect(state.fleets).toHaveLength(64);
    const blocked = sendFleet(state, order);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("64");
    expect(blocked.state).toBe(state);
  });
  it("preserves all 512 permanent target records; existing targets remain dispatchable", () => {
    let state = ready();
    const context = npcWalletContext(state), targets: Coordinates[] = [];
    for (let galaxy = 1; galaxy <= SPACE.galaxies && targets.length < NPC_SITE_LIMIT + 1; galaxy++)
      for (let system = 1; system <= SPACE.systems && targets.length < NPC_SITE_LIMIT + 1; system++)
        for (let position = 1; position <= 15 && targets.length < NPC_SITE_LIMIT + 1; position++) {
          const target = { galaxy, system, position };
          if (npcAt(state, target)) targets.push(target);
        }
    for (const target of targets.slice(0, NPC_SITE_LIMIT)) state = { ...state, npcEconomy: materializeNpcAtPaidLaunch(state.npcEconomy, target, context) };
    const blocked = sendFleet(state, request(targets[NPC_SITE_LIMIT]));
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("512");
    expect(blocked.state).toBe(state);
    expect(quoteFlight(state, { ...request(targets[0]), speedPercent: 10 }).ok).toBe(true);
    expect(Object.keys(state.npcEconomy.sites)).toHaveLength(512);
  });
});

describe("atomic real encounter, historical reports and one return", () => {
  it("wins, permanently clears the same garrison, loads half stock, then transfers once", () => {
    let state = ready();
    state = { ...state, npcEconomy: advanceNpcWallet(state.npcEconomy, 60, npcWalletContext(state)) };
    const sent = launch(state), paidFuel = activePlanet(sent).resources.deuterium, beforeScout = npcScoutReportText(sent, TARGET);
    const next = arrive(sent), report = next.npcBattles.reports[0];
    expect(report.battle.winner).toBe("attacker");
    expect(report.stockBefore).toEqual([800, 400, 60]);
    expect(report.loot).toEqual([400, 200, 30]);
    expect(report.delivery).toBe("returning");
    expect(projectNpc(next.npcEconomy, TARGET, npcWalletContext(next))).toMatchObject({ stock: [400, 200, 30], garrison: { light_fighter: 0, heavy_fighter: 0 } });
    expect(activePlanet(next).resources.deuterium).toBe(paidFuel);
    expect(next.lifetime).toBe(state.lifetime);
    expect(next.arcade).toBe(state.arcade);
    expect(next.deepSpace).toBe(state.deepSpace);
    expect(beforeScout).toContain("轻型战斗机 4");
    expect(npcScoutReportText(next, TARGET)).toContain("已清空");
    const imported = deserializeState(save(next));
    expect(save(imported)).toEqual(save(next));
    const docked = arrive(imported);
    expect(docked.fleets).toHaveLength(0);
    expect(docked.npcBattles.reports[0].delivery).toBe("delivered");
    expect(entitlement(docked, "deuterium")).toBe(999960n * SCALE);
    expect(entitlement(docked, "metal")).toBe(1000400n * SCALE);
    expect(entitlement(docked, "crystal")).toBe(1000200n * SCALE);
    expect(retryNpcAttackDock(docked, 1).state).toBe(docked);
    const repeated = arrive(launch(docked));
    expect(repeated.npcBattles.reports[1].battle.rounds).toEqual([]);
    expect(repeated.npcBattles.reports[1].battle.defenderBefore).toEqual({});
    expect(repeated.npcBattles.reports[1].loot).toEqual([200, 100, 15]);
    expect(repeated.messages.at(-1)?.text).toContain("无驻军收集（0 轮）");
  });
  it("loses real ships permanently and emits destroyed history without an empty return", () => {
    const sent = launch(ready(), { ...request(), ships: { light_fighter: 1 } });
    const next = arrive(sent), report = next.npcBattles.reports[0];
    expect(report.battle.winner).toBe("defender");
    expect(report.delivery).toBe("destroyed");
    expect(report.loot).toEqual([0, 0, 0]);
    expect(next.fleets).toHaveLength(0);
    expect(activePlanet(next).units.light_fighter).toBe(999);
    expect(next.npcEconomy.sites[coordinateKey(TARGET)].mark).toBe(sent.npcEconomy.sites[coordinateKey(TARGET)].mark);
    expect(next.npcEconomy.sites[coordinateKey(TARGET)].stock).toBe(sent.npcEconomy.sites[coordinateKey(TARGET)].stock);
  });
  it.each(["metal", "crystal", "deuterium", "ships"])("blocks an inexact %s docking atomically, retries failure as no-op, then succeeds once", kind => {
    let state = ready();
    state = { ...state, npcEconomy: advanceNpcWallet(state.npcEconomy, 60, npcWalletContext(state)) };
    state = arrive(launch(state));
    const planet = activePlanet(state);
    if (kind === "ships") planet.units.light_fighter = 1e15;
    else planet.resources[kind as typeof RESOURCE_IDS[number]] = big("1e400");
    const before = { resources: { ...planet.resources }, units: { ...planet.units }, cargo: state.fleets[0].cargo, report: state.npcBattles.reports[0] };
    const blocked = arrive(state);
    expect(isNpcAttackDockBlocked(blocked.fleets[0])).toBe(true);
    expect(nextFleetEvent(blocked)).toBe(Infinity);
    expect(activePlanet(blocked).resources).toEqual(before.resources);
    expect(activePlanet(blocked).units).toEqual(before.units);
    expect(blocked.fleets[0].cargo).toBe(before.cargo);
    expect(blocked.npcBattles.reports[0]).toBe(before.report);
    expect(retryNpcAttackDock(blocked, 1).state).toBe(blocked);
    const repaired = { ...blocked, planets: blocked.planets.map(value => ({ ...value,
      units: { ...value.units, light_fighter: 980 }, resources: { metal: big(1000), crystal: big(1000), deuterium: big(1000) } })) };
    const retried = retryNpcAttackDock(repaired, 1);
    expect(retried.ok).toBe(true);
    expect(retried.state.fleets).toHaveLength(0);
    expect(retried.state.npcBattles.reports[0].delivery).toBe("delivered");
    expect(activePlanet(retried.state).resources).toEqual({ metal: big(1400), crystal: big(1200), deuterium: big(1030) });
    expect(retryNpcAttackDock(retried.state, 1).state).toBe(retried.state);
  });
  it("pins every live report and retains exactly 60 terminal reports", () => {
    const report = arrive(launch()).npcBattles.reports[0];
    const terminal = Array.from({ length: 65 }, (_, i) => ({ ...report, fleetId: i + 10, delivery: "delivered" as const }));
    const result = trimNpcBattleReports([report, ...terminal]);
    expect(result.reports).toHaveLength(NPC_TERMINAL_REPORT_LIMIT + 1);
    expect(result.reports[0]).toBe(report);
    expect(result.reports[1].fleetId).toBe(15);
  });
});

describe("recall and curvature preserve the NPC world", () => {
  it("recalls outbound only, keeps paid target and fuel, and returns the exact flown time", () => {
    const sent = launch(), flight = advanceFleets(sent, 1), recalled = recallFleet(flight, 1);
    expect(recalled.ok).toBe(true);
    expect(recalled.state.fleets[0].remaining).toBe(1);
    expect(recalled.state.fleets[0].npcAttack?.phase).toMatchObject({ kind: "returning", reason: "recall" });
    expect(recalled.state.npcEconomy).toBe(flight.npcEconomy);
    expect(recalled.state.npcBattles.reports).toHaveLength(0);
    const home = arrive(recalled.state);
    expect(activePlanet(home).resources).toEqual(activePlanet(sent).resources);
    expect(activePlanet(home).units.light_fighter).toBe(1000);
    expect(recallFleet(home, 1).ok).toBe(false);
    const due = { ...sent, fleets: sent.fleets.map(fleet => ({ ...fleet, remaining: 0 })) };
    expect(recallFleet(due, 1).ok).toBe(false);
  });
  it("immediate recall docks once without touching the garrison or refunding fuel", () => {
    const sent = launch(), recalled = recallFleet(sent, 1).state;
    expect(recalled.fleets).toHaveLength(0);
    expect(activePlanet(recalled).resources).toEqual(activePlanet(sent).resources);
    expect(recalled.npcEconomy).toBe(sent.npcEconomy);
    expect(recalled.npcBattles.reports).toHaveLength(0);
    expect(SHIP_IDS.every(id => activePlanet(recalled).units[id] === activePlanet(ready()).units[id])).toBe(true);
  });
  it("forfeits live player ships and loot while preserving the wallet and permanent deaths", () => {
    const state = arrive(launch());
    state.lifetime.metal = big(1e8);
    const next = prestige(state);
    expect(next.fleets).toHaveLength(0);
    expect(next.npcEconomy).toBe(state.npcEconomy);
    expect(next.npcBattles.reports[0].delivery).toBe("forfeited");
    expect(next.nextFleetId).toBe(state.nextFleetId);
    expect(createInitialState(state.universe.seed).npcEconomy.sites).toEqual({});
    expect(createInitialState(state.universe.seed).npcBattles.reports).toEqual([]);
  });
});
