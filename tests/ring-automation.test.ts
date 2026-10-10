import { describe, expect, it } from "vitest";
import { BOARD, type ArcadeSymbol } from "../src/data/arcade";
import { INVENTORY_IDS } from "../src/data/dark-matter";
import {
  armAutoRunner, clearSlot, equipCard, evaluateEvents, evaluateLoadout, patchSlot,
  refreshUnlocks, slotFields, stopAutoRunner, toggleSlot,
} from "../src/automation/engine";
import {
  armRingBatch, betUnitDeut, canIssueRunId, compareRingAmounts, createArcade, grantRun, isRingAmount, revealAll, revealRun,
  setBet, topUp, type RingAutoBatch,
} from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { storedRunLimit } from "../src/game/deep-state";
import { finishCharge } from "../src/game/deep-space";
import { activePlanet, selectPlanet, withPlanet } from "../src/game/empire";
import { abandonColony, quoteFlight, sendFleet, type Fleet, type FleetRequest } from "../src/game/fleet";
import { prestige, tick } from "../src/game/logic";
import { createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { stateWith, withResearch } from "./helpers";

function ready(count = 3, symbol: ArcadeSymbol = "empty"): GameState {
  let state = withResearch(stateWith(
    { robotics_factory: 4, metal_mine: 10, crystal_mine: 8, deuterium_synth: 8, solar_plant: 20, metal_storage: 12, crystal_storage: 12, deuterium_tank: 12 },
    { metal: 100000, crystal: 100000, deuterium: 1000000 },
  ), { astrophysics: 1, combustion_drive: 2, computer_tech: 4 });
  state.arcade = createArcade(773);
  state.arcade.stats.manualRuns = 10;
  state.arcade.stats.runs = 10;
  state.arcade.stats.hits.empty = 10;
  state.unlocked = [...state.unlocked, "astrophysics_1"];
  state = equipCard(refreshUnlocks(state), 0, "auto_runner").state;
  for (let index = 0; index < count; index += 1) state = ticket(state, symbol);
  return state;
}

function ticket(state: GameState, symbol: ArcadeSymbol = "empty"): GameState {
  const granted = grantRun(state, "bonus");
  if (!granted.granted) throw Error("Fixture could not issue ticket");
  const runs = granted.state.arcade.runs.map((run, index, all) => index === all.length - 1
    ? { ...run, outcome: { main: { tile: BOARD.indexOf(symbol), big: false, u: 0.5, v: 0 }, lucky: null, forced: null } }
    : run);
  return { ...granted.state, arcade: { ...granted.state.arcade, runs } };
}

function armed(state: GameState, count = state.arcade.runs.length, maxDeuterium = "0"): GameState {
  const result = armAutoRunner(state, 0, { planetId: state.activePlanetId, count, maxDeuterium });
  expect(result.ok).toBe(true);
  return result.state;
}

function withColony(state: GameState): GameState {
  // These fixtures start with one homeworld, whose random system can itself be 51.
  const system = activePlanet(state).coordinates.system === 51 ? 52 : 51;
  const colony = createPlanet("colony-test", { galaxy: 1, system, position: 8 });
  colony.buildings = { ...activePlanet(state).buildings };
  colony.resources = { metal: big(10), crystal: big(20), deuterium: big(300000) };
  return { ...state, planets: [...state.planets, colony] };
}

const pass = (state: GameState) => evaluateLoadout(state, 1);
const event = (state: GameState) => evaluateEvents(state, { queueIdle: false, researchIdle: false, storageFull: [], runsReady: true });

describe("explicit ring authority", () => {
  it("starts off with a one-ticket action; equip, toggle and parameter edits grant no authority", () => {
    const state = ready();
    expect(state.arcade.autoBatch).toBeNull();
    expect(state.protocols.slots[0]!.card!.enabled).toBe(false);
    expect(state.protocols.slots[0]!.card!.action).toEqual({ kind: "runLights", count: 1 });
    for (const candidate of [state, toggleSlot(state, 0, true), patchSlot(state, 0, "action.count", "all")]) {
      const next = event(pass(candidate));
      expect(next.arcade.runs).toEqual(state.arcade.runs);
      expect(next.arcade.stats.autoRuns).toBe(0);
    }
    expect(revealRun(state, "auto").ok).toBe(false);
    expect(revealAll(state, "auto").results).toHaveLength(0);
  });

  it("requires Astrophysics 1, ten manual reveals, an open slot and the actual runner card", () => {
    const state = ready();
    const request = { planetId: state.activePlanetId, count: 1, maxDeuterium: "0" };
    const locked = withResearch(state, { astrophysics: 0 });
    expect(armAutoRunner(locked, 0, request).ok).toBe(false);
    expect(armAutoRunner({ ...state, arcade: { ...state.arcade, stats: { ...state.arcade.stats, manualRuns: 9 } } }, 0, request).ok).toBe(false);
    expect(armAutoRunner(state, 11, request).ok).toBe(false);
    expect(armAutoRunner(clearSlot(state, 0), 0, request).ok).toBe(false);
    expect(armAutoRunner({ ...state, unlockedCards: [] }, 0, request).ok).toBe(false);
  });

  it("validates a present source, finite nonnegative cap and a count of existing tickets", () => {
    const state = ready();
    for (const count of [0, -1, 1.5, 4, storedRunLimit(state) + 1, NaN]) {
      expect(armRingBatch(state, { planetId: state.activePlanetId, count, maxDeuterium: "0" }).ok).toBe(false);
    }
    for (const maxDeuterium of ["", "NaN", "Infinity", "-1", " 1 ", "1x", "1e" + "9".repeat(400)]) {
      expect(armRingBatch(state, { planetId: state.activePlanetId, count: 1, maxDeuterium }).ok).toBe(false);
    }
    expect(armRingBatch(state, { planetId: "missing", count: 1, maxDeuterium: "0" }).ok).toBe(false);
    expect(armRingBatch(state, { planetId: state.activePlanetId, count: 1, maxDeuterium: "1e1000" }).ok).toBe(true);
  });

  it("rejects double-arm retries without replenishing or replacing the cursor", () => {
    const original = setBet(ready(), "metal", 1).state;
    const state = pass(armed(original, 3, String(betUnitDeut(original) * 3)));
    expect(state.arcade.autoBatch!.armed).toBe(true);
    const result = armAutoRunner(state, 0, { planetId: state.activePlanetId, count: 1, maxDeuterium: "1e50" });
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.state.arcade.autoBatch!.completed).toBe(1);
    expect(result.state.arcade.autoBatch!.spentDeuterium).not.toBe("0");
  });

  it("removes setBet from offered actions and fails closed on legacy runtime cards", () => {
    let state = ready();
    const fields = slotFields(state, state.protocols.slots[0]!.card!);
    expect(fields.flatMap((field) => field.options.map((option) => option.value))).not.toContain("setBet");
    expect(patchSlot(state, 0, "action.kind", "setBet").protocols.slots[0]!.card!.action.kind).toBe("runLights");
    state.protocols.slots[0]!.card = { ...state.protocols.slots[0]!.card!, enabled: true, action: { kind: "setBet", symbol: "metal", units: 12 } };
    state = pass(state);
    expect(state.arcade.bets.metal).toBe(0);
    expect(state.arcade.runs).toHaveLength(3);
    expect(state.protocols.slots[0]!.reason).toContain("已停用");
  });
});

describe("bounded global ticket cursor", () => {
  it("consumes exactly N across repeated regular and event passes", () => {
    let state = armed(ready(3), 2);
    const ids = state.arcade.autoBatch!.ticketIds.slice();
    state = event(pass(state));
    for (let index = 0; index < 10; index += 1) state = event(pass(state));
    expect(state.arcade.stats.autoRuns).toBe(2);
    expect(state.arcade.runs.map((run) => run.id)).toEqual([3]);
    expect(state.arcade.autoBatch).toMatchObject({ ticketIds: ids, completed: 2, armed: false, spentDeuterium: "0" });
  });

  it("multiple enabled slots share the same batch and all means only the remaining snapshot", () => {
    let state = equipCard(ready(4), 1, "auto_runner").state;
    state = patchSlot(state, 1, "action.count", "all");
    state = toggleSlot(armed(state, 2), 1, true);
    state = pass(state);
    expect(state.arcade.stats.autoRuns).toBe(2);
    expect(state.arcade.runs.map((run) => run.id)).toEqual([3, 4]);
    expect(state.protocols.slots.slice(0, 2).every((slot) => slot.card?.enabled === false)).toBe(true);
  });

  it("does not consume a ticket minted by a tailwind reveal or any later topup or beacon", () => {
    let state = ready(1, "tailwind");
    state.arcade.beaconProgress = 1000;
    state = revealAll(armed(state), "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.runs.map((run) => run.id)).toEqual([2]);
    state = topUp(state).state;
    state = tick(state, 1800, "offline");
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.runs.length).toBeGreaterThanOrEqual(2);
  });

  it("newly issued tickets appended during a partial batch remain outside its authority", () => {
    let state = armed(ready(2), 2);
    state = pass(state);
    state = ticket(state);
    state = revealAll(state, "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(2);
    expect(state.arcade.runs.map((run) => run.id)).toEqual([3]);
  });

  it.each(["missing", "duplicate", "reordered", "unsafe", "stale cursor"])("stops before consuming %s identities", (kind) => {
    let state = armed(ready());
    if (kind === "missing") delete (state.arcade.runs[0] as unknown as { id?: number }).id;
    if (kind === "duplicate") state.arcade.runs[1]!.id = state.arcade.runs[0]!.id;
    if (kind === "reordered") state.arcade.runs.reverse();
    if (kind === "unsafe") state.arcade.runs[0]!.id = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "stale cursor") state.arcade.autoBatch!.completed = 1;
    const before = state.arcade.runs.slice();
    state = revealAll(state, "auto").state;
    expect(state.arcade.runs).toEqual(before);
    expect(state.arcade.stats.autoRuns).toBe(0);
    expect(state.arcade.autoBatch!.armed).toBe(false);
    expect(state.arcade.autoBatch!.stopReason.length).toBeGreaterThan(0);
  });
});

describe("gross spending and settlement snapshots", () => {
  it("permits exact-cap spending and refuses the next ticket before any deduction", () => {
    let state = setBet(ready(3), "metal", 1).state;
    const unit = betUnitDeut(state), initial = activePlanet(state).resources.deuterium;
    state = revealAll(armed(state, 3, String(unit * 2)), "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(2);
    expect(state.arcade.runs).toHaveLength(1);
    expect(state.arcade.autoBatch).toMatchObject({ armed: false, completed: 2, spentDeuterium: String(unit * 2) });
    expect(initial.sub(activePlanet(state).resources.deuterium).toNumber()).toBe(unit * 2);
  });

  it("a first over-cap attempt preserves its stopped state even with zero results", () => {
    let state = setBet(ready(2), "metal", 1).state;
    const before = activePlanet(state).resources.deuterium;
    const result = revealAll(armed(state, 2, String(betUnitDeut(state) - 1)), "auto");
    state = result.state;
    expect(result.results).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(state.arcade.runs).toHaveLength(2);
    expect(state.arcade.autoBatch!.armed).toBe(false);
    expect(state.arcade.autoBatch!.stopReason).toContain("上限");
    expect(activePlanet(state).resources.deuterium).toEqual(before);
  });

  it("deuterium winnings never replenish the gross-spending allowance", () => {
    let state = setBet(ready(2, "deuterium"), "deuterium", 1).state;
    const unit = betUnitDeut(state), wallet = activePlanet(state).resources.deuterium;
    state = revealAll(armed(state, 2, String(unit)), "auto").state;
    expect(activePlanet(state).resources.deuterium.gt(wallet)).toBe(true);
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.autoBatch!.spentDeuterium).toBe(String(unit));
    expect(state.arcade.runs).toHaveLength(1);
  });

  it("uses the real next stake after production changes", () => {
    let state = setBet(ready(2), "metal", 1).state;
    const unit = betUnitDeut(state);
    state = pass(armed(state, 2, String(unit * 2)));
    state = withPlanet(state, { planet: { ...activePlanet(state), buildings: { ...activePlanet(state).buildings, deuterium_synth: 100, solar_plant: 130 } } });
    expect(betUnitDeut(state)).toBeGreaterThan(unit);
    state = revealRun(state, "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.runs).toHaveLength(1);
    expect(state.arcade.autoBatch!.armed).toBe(false);
  });

  it("stops on insufficient source funds without unbet fallback", () => {
    let state = setBet(ready(1, "metal"), "metal", 1).state;
    state = armed(state, 1, "100000");
    state = withPlanet(state, { resources: { ...activePlanet(state).resources, deuterium: big(0) } });
    const before = activePlanet(state).resources;
    state = revealAll(state, "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(0);
    expect(state.arcade.runs).toHaveLength(1);
    expect(activePlanet(state).resources).toEqual(before);
    expect(state.arcade.autoBatch!.stopReason).toContain("不足");
  });

  it("freezes both settlement and jackpot bets, uses the source world, and restores selection and standing bets", () => {
    let state = setBet(withColony(ready(1, "jackpot")), "crystal", 2).state;
    const sourceId = state.activePlanetId, sourceBefore = activePlanet(state).resources;
    state = armed(state, 1, "10000000000");
    const frozen = { ...state.arcade.autoBatch!.bets };
    // Simulate an unrelated standing-bet mutation; the public editor instead stops the batch.
    state = { ...state, arcade: { ...state.arcade, bets: { metal: 12, crystal: 0, deuterium: 0, drifter: 0 } } };
    state = selectPlanet(state, "colony-test");
    const colonyBefore = activePlanet(state).resources;
    state = revealRun(state, "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.activePlanetId).toBe("colony-test");
    expect(activePlanet(state).resources).toEqual(colonyBefore);
    const source = state.planets.find((planet) => planet.id === sourceId)!;
    expect(source.resources.crystal.gt(sourceBefore.crystal)).toBe(true);
    expect(source.resources.metal).toEqual(sourceBefore.metal);
    expect(source.resources.deuterium.lt(sourceBefore.deuterium)).toBe(true);
    expect(state.arcade.bets.metal).toBe(12);
    expect(state.arcade.autoBatch!.bets).toEqual(frozen);
  });

  it("rejects duplicate coordinates without spending or consuming a ticket, while a distinct colony settles", () => {
    const seeded = createInitialState(87, 773);
    let state = ready(1, "jackpot");
    // Seed 87 deterministically puts the homeworld at the old colony fixture's location.
    state = {
      ...state,
      universe: seeded.universe,
      deepSpace: seeded.deepSpace,
      planets: [{ ...activePlanet(state), coordinates: { ...activePlanet(seeded).coordinates } }],
    };
    const sourceId = state.activePlanetId, sourceCoordinates = activePlanet(state).coordinates;
    expect(sourceCoordinates).toEqual({ galaxy: 1, system: 51, position: 8 });
    state = selectPlanet(armed(setBet(withColony(state), "crystal", 2).state, 1, "10000000000"), "colony-test");
    expect(() => deserializeState(serializeState(state))).not.toThrow();

    const invalid = {
      ...state,
      planets: state.planets.map((planet) => planet.id === "colony-test"
        ? { ...planet, coordinates: { ...sourceCoordinates } }
        : planet),
    };
    expect(() => deserializeState(serializeState(invalid))).toThrow("星球坐标重复");
    const rejected = revealRun(invalid, "auto");
    expect(rejected.ok).toBe(false);
    expect(rejected.result).toBeNull();
    expect(rejected.reason).toContain("存档安全");
    expect(rejected.state.planets).toEqual(invalid.planets);
    expect(rejected.state.darkMatter).toEqual(invalid.darkMatter);
    expect(rejected.state.arcade.runs).toEqual(invalid.arcade.runs);
    expect(rejected.state.arcade.seed).toBe(invalid.arcade.seed);
    expect(rejected.state.arcade.stats).toEqual(invalid.arcade.stats);
    expect(rejected.state.arcade.history).toEqual(invalid.arcade.history);
    expect(rejected.state.arcade.autoBatch).toMatchObject({ armed: false, completed: 0, spentDeuterium: "0" });

    const settled = revealRun(state, "auto");
    expect(settled.ok).toBe(true);
    expect(settled.state.arcade.stats.autoRuns).toBe(1);
    expect(settled.state.arcade.runs).toHaveLength(0);
    expect(settled.state.arcade.autoBatch!.spentDeuterium).toBe(String(2 * betUnitDeut(selectPlanet(state, sourceId))));
    expect(settled.state.planets.find((planet) => planet.id === sourceId)!.resources.crystal.gt(
      state.planets.find((planet) => planet.id === sourceId)!.resources.crystal,
    )).toBe(true);
    expect(settled.state.activePlanetId).toBe("colony-test");
    expect(activePlanet(settled.state).resources).toEqual(activePlanet(state).resources);
    expect(() => deserializeState(serializeState(settled.state))).not.toThrow();
  });

  it("replays an already-paid charge for zero spend and without duplicating rewards", () => {
    let state = setBet(ready(1), "metal", 12).state;
    const run = state.arcade.runs[0]!;
    run.source = "charge";
    run.receipt = { reportId: "charge-fixture", originId: state.activePlanetId, lines: ["已经结算"], lights: [] };
    const before = state.planets, dm = state.darkMatter;
    state = revealAll(armed(state, 1, "0"), "auto").state;
    expect(state.arcade.stats.autoRuns).toBe(1);
    expect(state.arcade.autoBatch!.spentDeuterium).toBe("0");
    expect(state.planets).toEqual(before);
    expect(state.darkMatter).toEqual(dm);
    expect(state.arcade.stats.betSpent).toBe(0);
  });

  it("rejects huge unsafe numeric payouts before consuming a ticket", () => {
    let state = setBet(ready(1), "metal", 1).state;
    state.warpCores = big("1e250");
    state = armed(state, 1, "1e1000");
    const before = state.arcade.runs.slice(), wallet = activePlanet(state).resources.deuterium;
    state = revealRun(state, "auto").state;
    expect(state.arcade.runs).toEqual(before);
    expect(activePlanet(state).resources.deuterium).toEqual(wallet);
    expect(state.arcade.autoBatch!.stopReason).toContain("安全数值");
  });

  it("keeps exact gross spend when tiny debits meet large caps", () => {
    let state = setBet(ready(1), "metal", 1).state;
    state = withPlanet(state, { planet: { ...activePlanet(state), buildings: { ...activePlanet(state).buildings, deuterium_synth: 0 } } });
    expect(betUnitDeut(state)).toBe(1000);
    state = armed(state, 1, "1e20");
    state.arcade.autoBatch!.spentDeuterium = "1e20";
    const denied = revealRun(state, "auto");
    expect(denied.ok).toBe(false);
    expect(denied.state.arcade.runs).toHaveLength(1);
    expect(denied.state.arcade.autoBatch!.stopReason).toContain("上限");
    state = { ...state, arcade: { ...state.arcade, autoBatch: { ...state.arcade.autoBatch!, maxDeuterium: "100000000000000001000" } } };
    const allowed = revealRun(state, "auto");
    expect(allowed.ok).toBe(true);
    expect(allowed.state.arcade.autoBatch!.spentDeuterium).toBe("100000000000000001000");
    expect(compareRingAmounts("100000000000000000001", "1e20")).toBe(1);
  });

  it("accepts supported exponent notation and rejects nonserializable or unsafe scales", () => {
    expect(isRingAmount("1E1000")).toBe(true);
    expect(armRingBatch(ready(1), { planetId: ready(1).activePlanetId, count: 1, maxDeuterium: "1E1000" }).state.arcade.autoBatch!.maxDeuterium).toBe("1e1000");
    for (const amount of ["1e9000000000000000", "1e-9007199254740992", "1e-9007199254740993"]) expect(isRingAmount(amount)).toBe(false);
    expect(compareRingAmounts("1e-9007199254740990", "1e-9007199254740991")).toBe(1);
  });

  it.each(["1e20", "1e1000"])("stops a small debit that cannot be represented in a %s wallet", (balance) => {
    let state = setBet(ready(1), "metal", 1).state;
    state = withPlanet(state, { planet: { ...activePlanet(state), buildings: { ...activePlanet(state).buildings, deuterium_synth: 0 } } });
    state = withPlanet(state, { resources: { ...activePlanet(state).resources, deuterium: big(balance) } });
    const result = revealRun(armed(state, 1, "1000"), "auto");
    expect(result.ok).toBe(false);
    expect(result.state.arcade.runs).toHaveLength(1);
    expect(result.state.arcade.autoBatch!.spentDeuterium).toBe("0");
    expect(result.state.arcade.autoBatch!.stopReason).toContain("扣款");
    expect(activePlanet(result.state).resources.deuterium.eq(balance)).toBe(true);
  });

  it.each(["supply", "drifter"] as const)("rolls back the entire prospective %s reward if it cannot be saved", (symbol) => {
    let state = ready(1, symbol);
    state.arcade.runs[0]!.outcome.main.u = 0;
    if (symbol === "supply") state.items[INVENTORY_IDS[0]!] = 1000000;
    else activePlanet(state).units.light_fighter = 1e15;
    state = setBet(state, "metal", 1).state;
    state = armed(state, 1, "1e10");
    const runs = state.arcade.runs, seed = state.arcade.seed, planets = state.planets, items = state.items;
    const result = revealRun(state, "auto");
    expect(result.ok).toBe(false);
    expect(result.state.arcade.runs).toEqual(runs);
    expect(result.state.arcade.seed).toBe(seed);
    expect(result.state.planets).toEqual(planets);
    expect(result.state.items).toEqual(items);
    expect(result.state.arcade.autoBatch!.spentDeuterium).toBe("0");
    expect(result.state.arcade.autoBatch!.stopReason).toContain("存档安全");
  });
});

describe("stop boundaries", () => {
  it.each(["off", "stop", "clear", "edit", "manual", "all manual", "parameters"])("%s stops the batch and a later toggle cannot revive it", (action) => {
    let state = armed(ready());
    if (action === "off") state = toggleSlot(state, 0, false);
    if (action === "stop") state = stopAutoRunner(state);
    if (action === "clear") state = clearSlot(state, 0);
    if (action === "edit") state = setBet(state, "metal", 1).state;
    if (action === "manual") state = revealRun(state, "manual").state;
    if (action === "all manual") state = revealAll(state, "manual").state;
    if (action === "parameters") state = patchSlot(state, 0, "action.count", "all");
    expect(state.arcade.autoBatch!.armed).toBe(false);
    expect(pass(toggleSlot(state, 0, true)).arcade.stats.autoRuns).toBe(0);
  });

  it("prestige preserves ticket/history audit data but stops the authorization", () => {
    let state = armed(ready());
    state.lifetime.metal = big("1e12");
    const batch = state.arcade.autoBatch!;
    state = prestige(state);
    expect(state.hasPrestiged).toBe(true);
    expect(state.arcade.autoBatch).toMatchObject({ armed: false, ticketIds: batch.ticketIds, spentDeuterium: "0" });
    expect(state.protocols.slots[0]!.card!.enabled).toBe(false);
  });

  it("abandoning the source stops; a missing source never falls back to the homeworld", () => {
    let state = selectPlanet(withColony(ready()), "colony-test");
    state = armed(state);
    const abandoned = abandonColony(state, "colony-test");
    expect(abandoned.ok).toBe(true);
    expect(abandoned.state.arcade.autoBatch!.armed).toBe(false);
    const malformed = { ...state, planets: state.planets.filter((planet) => planet.id !== "colony-test"), activePlanetId: state.planets[0]!.id };
    const stopped = revealAll(malformed, "auto").state;
    expect(stopped.arcade.stats.autoRuns).toBe(0);
    expect(stopped.arcade.runs).toHaveLength(3);
    expect(stopped.arcade.autoBatch!.stopReason).toContain("不存在");
  });

  it("stops invalid runtime batch spending and limits stop reasons", () => {
    const state = armed(ready());
    for (const patch of [{ spentDeuterium: "-1" }, { maxDeuterium: "NaN" }, { completed: -1 }, { bets: { metal: 13, crystal: 0, deuterium: 0, drifter: 0 } }]) {
      const invalid = { ...state, arcade: { ...state.arcade, autoBatch: { ...state.arcade.autoBatch!, ...patch } as RingAutoBatch } };
      const stopped = revealAll(invalid, "auto").state;
      expect(stopped.arcade.stats.autoRuns).toBe(0);
      expect(stopped.arcade.autoBatch!.armed).toBe(false);
      expect(stopped.arcade.autoBatch!.stopReason.length).toBeLessThanOrEqual(240);
    }
  });
});

function chargeRequest(state: GameState): FleetRequest {
  return { mission: "charge", target: { ...activePlanet(state).coordinates, position: 16 }, ships: { small_cargo: 1 }, cargo: { metal: big(0), crystal: big(0), deuterium: big(0) }, speedPercent: 100, holdSlots: 1, chargeWithBets: false };
}

describe("safe monotonic ticket issuance", () => {
  it("never wraps or reuses IDs and exhausted topups do not spend or reroll", () => {
    let state = ready(0);
    state.arcade.nextRunId = Number.MAX_SAFE_INTEGER - 1;
    state = grantRun(state, "beacon").state;
    expect(state.arcade.runs[0]!.id).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(state.arcade.nextRunId).toBe(Number.MAX_SAFE_INTEGER);
    const seed = state.arcade.seed, wallet = activePlanet(state).resources.deuterium;
    expect(grantRun(state, "bonus").granted).toBe(false);
    const result = topUp(state);
    expect(result.ok).toBe(false);
    expect(result.state.arcade.seed).toBe(seed);
    expect(activePlanet(result.state).resources.deuterium).toEqual(wallet);
  });

  it("reserves the last remaining ID for an in-flight charge", () => {
    let state = ready(0);
    activePlanet(state).units.small_cargo = 1;
    state.arcade.nextRunId = Number.MAX_SAFE_INTEGER - 1;
    const request = chargeRequest(state);
    expect(quoteFlight(state, request).ok).toBe(true);
    state = sendFleet(state, request).state;
    expect(canIssueRunId(state, 1)).toBe(false);
    expect(grantRun(state, "beacon").granted).toBe(false);
    expect(topUp(state).ok).toBe(false);
    const due: Fleet = { ...state.fleets[0]!, remaining: 0, charge: { ...state.fleets[0]!.charge!, phase: "holding" } };
    state = { ...state, fleets: [due] };
    state = finishCharge(state, due).state;
    expect(state.arcade.runs[0]!.id).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(state.arcade.nextRunId).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects exhausted charge dispatch without resource changes and gracefully returns malformed due charges", () => {
    let state = ready(0);
    activePlanet(state).units.small_cargo = 1;
    const request = chargeRequest(state);
    const dispatched = sendFleet(state, request).state;
    state.arcade.nextRunId = Number.MAX_SAFE_INTEGER;
    expect(sendFleet(state, request).state).toBe(state);
    expect(quoteFlight(state, request).ok).toBe(false);
    const due: Fleet = { ...dispatched.fleets[0]!, remaining: 0, charge: { ...dispatched.fleets[0]!.charge!, phase: "holding" } };
    const invalid = { ...dispatched, arcade: { ...dispatched.arcade, nextRunId: Number.MAX_SAFE_INTEGER }, fleets: [due] };
    const returned = finishCharge(invalid, due);
    expect(returned.fleet?.returning).toBe(true);
    expect(returned.state.deepSpace).toEqual(invalid.deepSpace);
    expect(returned.state.arcade.runs).toHaveLength(0);
  });
});
