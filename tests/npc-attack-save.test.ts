import { describe, expect, it, vi } from "vitest";
import historical from "./fixtures/npc-economy-r11.json";
import { big } from "../src/game/decimal";
import * as combat from "../src/game/encounter-combat";
import { emptyCargo, type Fleet } from "../src/game/fleet";
import { coordinateKey, npcAt, type Coordinates } from "../src/game/galaxy";
import { npcBattleSeed } from "../src/game/npc-battle";
import { createNpcBattleState, NPC_SITE_LIMIT, readNpcAttackContract, readNpcBattleState, rejectNpcAttackFields, trimNpcBattleReports, validateNpcAttackReferences, type NpcBattleReceipt } from "../src/game/npc-attack-state";
import { npcEconomySnapshot } from "../src/game/npc-economy";
import { createNpcWalletContext, materializeNpcAtPaidLaunch, readNpcWalletState } from "../src/game/npc-wallet";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

function target(state: GameState): Coordinates {
  for (let system = 1; system <= 100; system++) for (let position = 1; position <= 15; position++) {
    const coordinate = { galaxy: 1, system, position };
    if (npcAt(state, coordinate)) return coordinate;
  }
  throw Error("No NPC fixture target");
}
function context(state: GameState) {
  return createNpcWalletContext(state.universe.seed, NPC_SITE_LIMIT, state.planets.map(planet => planet.coordinates));
}
function prepared() {
  const state = createInitialState(42, 731), coordinate = target(state);
  state.npcEconomy = materializeNpcAtPaidLaunch(state.npcEconomy, coordinate, context(state));
  const key = coordinateKey(coordinate), site = state.npcEconomy.sites[key];
  state.npcEconomy = { ...state.npcEconomy, sites: { [key]: { ...site, garrison: { light_fighter: 0, heavy_fighter: 0 } } } };
  state.research.levels.weapons_tech = 1;
  state.totalTime = big(1000); state.nextFleetId = 2;
  return { state, coordinate };
}
/** Explicit shape fixture: zero-garrison collection has an independently obvious zero-round result. */
function receipt(state: GameState, coordinate: Coordinates, fleetId = 1): NpcBattleReceipt {
  return { fleetId, originId: state.planets[0].id, target: coordinate, at: "100", seed: npcBattleSeed(state.universe.seed, fleetId, coordinate),
    cargoFactor: 1, attackerTech: { weapons: 1, shields: 0, armour: 0 },
    battle: { mode: "squadron-v1", winner: "attacker", rounds: [], attackerBefore: { small_cargo: 1 },
      defenderBefore: {}, attackerAfter: { small_cargo: 1 }, defenderAfter: {} },
    stockBefore: [50000, 30000, 10000], loot: [2778, 1667, 555], delivery: "delivered" };
}
function liveReturn(state: GameState, report: NpcBattleReceipt): Fleet {
  return { id: report.fleetId, orderTransport: null, originId: state.planets[0].id, target: { ...report.target }, mission: "attack",
    ships: { small_cargo: 1 }, cargo: { metal: big(report.loot[0]), crystal: big(report.loot[1]), deuterium: big(report.loot[2]) },
    duration: 100, remaining: 50, elapsed: 50, returning: true,
    npcAttack: { seed: npcBattleSeed(state.universe.seed, report.fleetId, report.target), cargoFactor: 1,
      phase: { kind: "returning", reason: "battle", dockBlocked: false } } };
}
function returningState() {
  const { state, coordinate } = prepared();
  const report: NpcBattleReceipt = { ...receipt(state, coordinate), delivery: "returning" };
  state.npcBattles = { model: "npc-battle-receipts-v1", reports: [report] };
  state.fleets = [liveReturn(state, report)];
  return state;
}
function roundTrip(state: GameState) { return deserializeState(importSave(exportSave(state)).state); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

// Synthetic r12 derivatives of genuine unmodified r11 reader outputs. Their source provenance
// stays explicit; this does not claim an r12 natural-play capture or reuse the new reader as oracle.
function r12(age: number) {
  const source = clone(historical.rows[0].oldReaderOutput);
  return { ...source, revision: 12, state: { ...source.state, npcEconomy: { model: "fixed-production-v1", elapsedSeconds: age } } };
}

describe("r13 exact source migration", () => {
  it.each([0, 60, .1, Number.MIN_VALUE, 11900])("copies actual accepted r12 age %s snapshot at new local origin", age => {
    const source = r12(age), before = JSON.stringify(source), migrated = importSave(before);
    const resources = npcEconomySnapshot({ model: "fixed-production-v1", elapsedSeconds: age }).resources;
    expect(migrated.revision).toBe(13);
    expect(migrated.state.npcEconomy).toEqual({ model: "npc-wallet-garrison-v1", now: 0,
      baseline: { stock: [resources.metal, resources.crystal, resources.deuterium], mark: 0 }, sites: {} });
    expect(migrated.state.npcBattles).toEqual(createNpcBattleState());
    const { npcEconomy: _old, ...oldWorld } = source.state;
    const { npcEconomy: _new, npcBattles: _reports, ...newWorld } = migrated.state;
    expect(newWorld).toEqual(oldWorld); expect(JSON.stringify(source)).toBe(before);
    expect(importSave(JSON.stringify(migrated))).toEqual(migrated);
  });
  it("preserves MIN_VALUE and huge player/time Decimal representation without time backfill", () => {
    const source = r12(Number.MIN_VALUE);
    source.state.totalTime = "1e400"; source.state.planets[0].resources.metal = "1.23456789012345e400";
    const read = importSave(JSON.stringify(source));
    expect(read.state.npcEconomy.baseline.stock).toEqual([500, 250, Number.MIN_VALUE]);
    expect(read.state.totalTime).toBe("1e+400");
    expect(read.state.planets[0].resources.metal).toBe("1.23456789012345e+400");
  });
  it.each([-1, 11900 + 2e-12, Number.MAX_VALUE, NaN, Infinity])("rejects r12 invalid age %s instead of clamping", age => {
    expect(() => importSave(JSON.stringify(r12(age)))).toThrow();
  });
  it.each(["npcAttack", "npcBattles", "wallet-model", "attack-mission"])("rejects old exclusive %s before normalization", kind => {
    for (const revision of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const source: any = r12(60); source.revision = revision;
      source.unknown = kind === "wallet-model" ? { model: "npc-wallet-garrison-v1" }
        : kind === "attack-mission" ? { mission: "attack" } : { [kind]: null };
      expect(() => importSave(JSON.stringify(source))).toThrow(/NPC/);
    }
  });
  it("requires all new r13 fields, exact old two-field r12 shape, and complete old source validity", () => {
    for (const field of ["npcEconomy", "npcBattles"]) {
      const current = JSON.parse(exportSave(createInitialState())); delete current.state[field];
      expect(() => importSave(JSON.stringify(current))).toThrow(/NPC/);
    }
    const extra: any = r12(60); extra.state.npcEconomy.stock = [800, 400, 60];
    expect(() => importSave(JSON.stringify(extra))).toThrow(/NPC/);
    const damaged: any = r12(60); delete damaged.state.planets[0].demolition;
    expect(() => importSave(JSON.stringify(damaged))).toThrow();
  });
  it("preserves genuine r11 outputs except the two explicitly added domain fields", () => {
    for (const row of historical.rows) {
      const adopted = importSave(row.raw);
      const { npcEconomy: _economy, npcBattles: _battle, ...world } = adopted.state;
      expect(world).toEqual(row.oldReaderOutput.state);
      expect(adopted.state.npcEconomy.baseline.stock).toEqual([500, 250, 0]);
    }
  });
});

describe("strict bounded r13 orbital history", () => {
  it("round-trips pinned returns without fighting, unloading or reanchoring", () => {
    const state = returningState(), raw = exportSave(state, 1000), spy = vi.spyOn(combat, "fightEncounter");
    try {
      expect(exportSave(roundTrip(state), 1000)).toBe(raw);
      expect(spy).not.toHaveBeenCalled();
      expect(state.npcEconomy.now).toBe(0);
      expect(state.fleets[0].cargo.metal.eq(2778)).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it("allows terminal origin IDs to outlive abandoned colonies", () => {
    const { state, coordinate } = prepared();
    state.npcBattles = { model: "npc-battle-receipts-v1", reports: [{ ...receipt(state, coordinate), originId: "old-colony" }] };
    expect(roundTrip(state).npcBattles.reports[0].originId).toBe("old-colony");
  });
  it.each(["missing-report", "missing-fleet", "nonattack-fleet", "cargo", "ships", "seed", "factor", "origin", "phase", "next-id", "target-site", "resurrection", "future-time"])
  ("rejects broken %s authority without adopting a partial state", kind => {
    const state: any = clone(serializeState(returningState()));
    const fleet = state.fleets[0], report = state.npcBattles.reports[0];
    if (kind === "missing-report") state.npcBattles.reports = [];
    if (kind === "missing-fleet") state.fleets = [];
    if (kind === "nonattack-fleet") { fleet.mission = "transport"; delete fleet.npcAttack; }
    if (kind === "cargo") fleet.cargo.crystal = "1666";
    if (kind === "ships") fleet.ships.small_cargo = 2;
    if (kind === "seed") report.seed++;
    if (kind === "factor") report.cargoFactor = 1.05;
    if (kind === "origin") report.originId = "other";
    if (kind === "phase") fleet.npcAttack.phase.reason = "recall";
    if (kind === "next-id") state.nextFleetId = 1;
    if (kind === "target-site") state.npcEconomy.sites = {};
    if (kind === "resurrection") state.npcEconomy.sites[coordinateKey(report.target)].garrison.light_fighter = 1;
    if (kind === "future-time") report.at = "1001";
    expect(() => deserializeState(state)).toThrow();
  });
  it.each(["loot-rounding", "loot-over", "fraction", "winner", "fake-round", "zero-before", "garrison", "damage", "extra", "duplicate", "bad-factor", "zero-ships"])
  ("rejects report %s corruption using bounded arithmetic rather than combat replay", kind => {
    const { state, coordinate } = prepared();
    const report: any = clone(receipt(state, coordinate));
    if (kind === "loot-rounding") report.loot = [2777, 1667, 556];
    if (kind === "loot-over") report.loot = [25001, 0, 0];
    if (kind === "fraction") report.loot[0] += .5;
    if (kind === "winner") report.battle.winner = "draw";
    if (kind === "fake-round") report.battle.rounds = [{ round: 1, attacker: 1, defender: 0, attackDamage: 0, defendDamage: 0 }];
    if (kind === "zero-before") report.battle.attackerBefore = {};
    if (kind === "garrison") report.battle.defenderBefore = { battleship: 1 };
    if (kind === "damage") report.battle.rounds = [{ round: 1, attacker: 1, defender: 0, attackDamage: Infinity, defendDamage: 0 }];
    if (kind === "extra") report.reward = 100;
    if (kind === "bad-factor") report.cargoFactor = 1.001;
    if (kind === "zero-ships") report.battle.attackerAfter.cruiser = 0;
    const reports = kind === "duplicate" ? [report, report] : [report];
    expect(() => readNpcBattleState({ model: "npc-battle-receipts-v1", reports }, context(state))).toThrow(/NPC/);
  });
  it("keeps all 64 live pins plus the latest 60 terminals and rejects untrimmed overflow", () => {
    const { state, coordinate } = prepared();
    const terminal = Array.from({ length: 61 }, (_, i) => receipt(state, coordinate, i + 1));
    const live = Array.from({ length: 64 }, (_, i): NpcBattleReceipt => ({ ...receipt(state, coordinate, i + 62), delivery: "returning" }));
    const trimmed = trimNpcBattleReports([...terminal, ...live]);
    expect(trimmed.reports).toHaveLength(124); expect(trimmed.reports[0].fleetId).toBe(2);
    expect(trimmed.reports.filter(report => report.delivery === "returning")).toHaveLength(64);
    expect(() => readNpcBattleState(trimmed, context(state))).not.toThrow();
    expect(() => readNpcBattleState({ ...trimmed, reports: [...terminal, ...live] }, context(state))).toThrow();
    state.nextFleetId = 126; state.npcBattles = trimmed; state.fleets = live.map(report => liveReturn(state, report));
    expect(() => validateNpcAttackReferences(state)).not.toThrow();
    const extra = { ...receipt(state, coordinate, 126), delivery: "returning" as const };
    state.nextFleetId = 127; state.fleets.push(liveReturn(state, extra));
    expect(() => validateNpcAttackReferences(state)).toThrow();
  });
  it("rejects accessors, symbols, sparse arrays, NaN and extra runtime fields before JSON", () => {
    const { state, coordinate } = prepared(); let calls = 0;
    const report = receipt(state, coordinate), accessor = { ...report };
    Object.defineProperty(accessor, "loot", { enumerable: true, get() { calls++; return [0, 0, 0]; } });
    for (const bad of [accessor, { ...report, [Symbol("extra")]: 0 }, { ...report, stockBefore: [NaN, 1, 2] }]) {
      state.npcBattles = { model: "npc-battle-receipts-v1", reports: [bad] as any };
      expect(() => exportSave(state)).toThrow();
    }
    state.npcBattles = { model: "npc-battle-receipts-v1", reports: new Array(1) };
    expect(() => exportSave(state)).toThrow(); expect(calls).toBe(0);
    const attack = returningState(); (attack.fleets[0] as any).unknown = undefined;
    expect(() => exportSave(attack)).toThrow();
  });
  it.each(["symbol", "hidden-unknown", "hidden-known", "nonplain-prototype"])
  ("rejects raw attack ship %s before the fleet reader can discard it", kind => {
    const raw = clone(serializeState(returningState())), ships = raw.fleets[0].ships;
    if (kind === "symbol") Object.defineProperty(ships, Symbol("discarded"), { value: 1, enumerable: true });
    if (kind === "hidden-unknown") Object.defineProperty(ships, "discarded", { value: 1 });
    if (kind === "hidden-known") Object.defineProperty(ships, "cruiser", { value: 0 });
    if (kind === "nonplain-prototype") Object.setPrototypeOf(ships, { inherited: 1 });
    expect(() => deserializeState(raw)).toThrow(/NPC/);
  });
  it("accepts detached null-prototype attack ships and explicit zero counts", () => {
    const raw = clone(serializeState(returningState()));
    raw.fleets[0].ships = Object.assign(Object.create(null), raw.fleets[0].ships, { cruiser: 0 });
    const restored = deserializeState(raw);
    expect(restored.fleets[0].ships).toEqual({ small_cargo: 1, cruiser: 0 });
    expect(Object.getPrototypeOf(restored.fleets[0].ships)).toBe(Object.prototype);
  });
  it("keeps the historical ordinary-mission ship normalization unchanged", () => {
    const raw = clone(serializeState(returningState()));
    raw.fleets[0].mission = "transport"; delete raw.fleets[0].npcAttack;
    raw.npcBattles = createNpcBattleState();
    const ships = raw.fleets[0].ships;
    Object.defineProperty(ships, Symbol("discarded"), { value: 1, enumerable: true });
    Object.defineProperty(ships, "discarded", { value: 1 });
    Object.setPrototypeOf(ships, { inherited: 1 });
    expect(deserializeState(raw).fleets[0].ships).toEqual({ small_cargo: 1 });
  });
  it("requires strict return contracts, zero cargo on recall, and exact dock-blocked zero", () => {
    const state = returningState(), fleet = state.fleets[0];
    state.npcBattles = createNpcBattleState();
    fleet.npcAttack = { ...fleet.npcAttack!, phase: { kind: "returning", reason: "recall", dockBlocked: false } };
    expect(() => validateNpcAttackReferences(state)).toThrow();
    fleet.cargo = emptyCargo(); expect(() => validateNpcAttackReferences(state)).not.toThrow();
    fleet.npcAttack = { ...fleet.npcAttack, phase: { kind: "returning", reason: "recall", dockBlocked: true } };
    expect(() => validateNpcAttackReferences(state)).toThrow();
    fleet.remaining = 0; expect(() => validateNpcAttackReferences(state)).not.toThrow();
    expect(() => readNpcAttackContract({ ...fleet.npcAttack, seed: 0 }, state.universe.seed, fleet.id, fleet.target)).toThrow();
  });
  it("rejects misplaced new markers without banning generic unrelated fields", () => {
    expect(() => rejectNpcAttackFields({ state: { unrelated: { stock: 1, seed: 2, phase: "x", model: "other" } } }, true, true)).not.toThrow();
    for (const marker of ["npcAttack", "npcBattles"]) expect(() => rejectNpcAttackFields({ unrelated: [{ [marker]: null }] }, false)).toThrow();
  });
  it("never reanchors direct wallet reads and rejects invalid permanent target keys", () => {
    const { state } = prepared(), before = JSON.stringify(state.npcEconomy);
    expect(readNpcWalletState(state.npcEconomy, context(state))).toEqual(state.npcEconomy);
    expect(JSON.stringify(state.npcEconomy)).toBe(before);
    const site = Object.values(state.npcEconomy.sites)[0];
    for (const key of ["01:2:3", "1:2:16", "__proto__", "1:2:3:4"]) {
      expect(() => readNpcWalletState({ ...state.npcEconomy, sites: { [key]: site } }, context(state))).toThrow();
    }
  });
});
