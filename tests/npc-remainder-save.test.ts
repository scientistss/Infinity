import { describe, expect, it } from "vitest";
import historical from "./fixtures/npc-economy-r11.json";
import { grantRun, revealRun, setBet } from "../src/game/arcade";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { abandonColony, advanceFleets, emptyCargo, resolveFleetArrivals, sendFleet } from "../src/game/fleet";
import { npcAt, sameCoordinates, type Coordinates } from "../src/game/galaxy";
import { evaluatePrestige, scrape, tick } from "../src/game/logic";
import { createOffer, trade } from "../src/game/merchant";
import { rejectNpcAttackFields } from "../src/game/npc-attack-state";
import { advanceOrderPlans, cancelOrderTask, createOrderTask } from "../src/game/orders";
import { clonePlanet, createPlanet } from "../src/game/planet";
import { cancel, canEnqueue, enqueue } from "../src/game/queue";
import { cancelResearch, enqueueResearch } from "../src/game/research";
import { BACKUP_KEY, deserializeState, exportSave, importSave, serializeState, type KeyValueStore } from "../src/game/save";
import { SaveSession } from "../src/game/save-session";
import { cancelUnits, orderUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState } from "../src/game/types";

const ZERO = { metal: "0", crystal: "0", deuterium: "0" };
const TAIL = { metal: "0.0000000003", crystal: "0.25", deuterium: "0.00000000000000001" };
const MAX_TAIL = `0.${"9".repeat(256)}`;
const MIN_TAIL = `0.${"0".repeat(255)}1`;
const NOW = 1000;
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function seeded(): GameState {
  const state = createInitialState(42, 731);
  activePlanet(state).npcResourceRemainder = { ...TAIL };
  return state;
}
function sameTails(state: GameState, expected = TAIL): void {
  expect(activePlanet(state).npcResourceRemainder).toEqual(expected);
  expect(deserializeState(importSave(exportSave(state, NOW)).state).planets[0].npcResourceRemainder).toEqual(expected);
}

/** Explicit downlevel derivatives of a fixed old-reader fixture, never current-reader output. */
function legacy(revision: number): any {
  const source: any = clone(historical.rows[0].oldReaderOutput), state = source.state;
  source.revision = revision;
  if (revision === 12) state.npcEconomy = { model: "fixed-production-v1", elapsedSeconds: 60.25 };
  if (revision <= 10) for (const planet of state.planets) delete planet.demolition;
  if (revision <= 9) {
    delete state.terraformerGrantJobFloor;
    for (const planet of state.planets) delete planet.terraformerFields;
  }
  if (revision <= 8) delete state.buildingTemplates;
  if (revision <= 7) delete state.formations;
  if (revision <= 6) delete state.researchTemplates;
  if (revision <= 5) delete state.orders.nextWorkId;
  if (revision <= 4) delete state.orders;
  if (revision <= 3) { delete state.arcade.nextRunId; delete state.arcade.autoBatch; }
  if (revision === 2) delete state.deepSpace;
  return source;
}

class Store implements KeyValueStore {
  values = new Map<string, string>();
  writes: string[] = [];
  maxCharacters = Infinity;
  fault: "none" | "drop" | "readback" | "backup" = "none";
  constructor(raw: string) { this.values.set(STORAGE_KEY, raw); }
  getItem(key: string): string | null {
    if (this.fault === "readback" && key === STORAGE_KEY && this.writes.includes(STORAGE_KEY)) return "unverified";
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.fault === "backup" && key.startsWith(BACKUP_KEY)) throw Error("synthetic backup quota");
    const size = [...this.values].reduce((sum, [name, raw]) => sum + (name === key ? 0 : raw.length), value.length);
    if (size > this.maxCharacters) throw Error("synthetic quota exceeded");
    if (!(this.fault === "drop" && key === STORAGE_KEY)) this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("bounded per-planet NPC remainder persistence", () => {
  it("starts every factory planet at zero and clones without sharing the remainder object", () => {
    const initial = createInitialState(42, 731), colony = createPlanet("fresh-colony", { galaxy: 2, system: 1, position: 1 });
    expect(initial.planets[0].npcResourceRemainder).toEqual(ZERO);
    expect(colony.npcResourceRemainder).toEqual(ZERO);
    expect(colony.npcResourceRemainder).not.toBe(initial.planets[0].npcResourceRemainder);
    const source = seeded().planets[0], copy = clonePlanet(source);
    expect(copy.npcResourceRemainder).toEqual(TAIL);
    expect(copy.npcResourceRemainder).not.toBe(source.npcResourceRemainder);
    copy.npcResourceRemainder.metal = "0";
    expect(source.npcResourceRemainder).toEqual(TAIL);
  });

  it("preserves full 258-character subunits across repeated current save/read without Decimal conversion", () => {
    let state = seeded();
    state.planets[0].npcResourceRemainder = { metal: MAX_TAIL, crystal: MIN_TAIL, deuterium: "0" };
    expect(MAX_TAIL).toHaveLength(258); expect(MIN_TAIL).toHaveLength(258);
    const raw = exportSave(state, NOW), expected = state.planets[0].npcResourceRemainder;
    for (let round = 0; round < 4; round++) {
      state = deserializeState(importSave(exportSave(state, NOW)).state);
      expect(state.planets[0].npcResourceRemainder).toEqual(expected);
      expect(exportSave(state, NOW)).toBe(raw);
    }
  });

  it.each([undefined, null, 0, "0", {}, { metal: "0", crystal: "0" }, { ...ZERO, energy: "0" },
    ...["-0", "+0", "0.0", "0.10", ".1", "00.1", "1", "1.0", "-0.1", "1e-2", " 0.1", "0.1 ", "NaN", "Infinity", `0.${"1".repeat(257)}`, 0.1].map(metal => ({ ...ZERO, metal }))])
  ("rejects missing, aliased or malformed current remainder %# before adoption", malformed => {
    const source: any = JSON.parse(exportSave(createInitialState(42, 731), NOW));
    source.state.planets[0].npcResourceRemainder = malformed;
    expect(() => importSave(JSON.stringify(source))).toThrow(/NPC/);
    const runtime: any = seeded(); runtime.planets[0].npcResourceRemainder = malformed;
    expect(() => exportSave(runtime, NOW)).toThrow(/NPC/);
  });

  it.each(["accessor", "hidden", "symbol", "inherited", "prototype", "toJSON"])("rejects runtime remainder %s before JSON can erase or repair it", kind => {
    const state: any = seeded(), raw: any = serializeState(state);
    let calls = 0;
    for (const planet of [state.planets[0], raw.planets[0]]) {
      const value: any = { ...TAIL };
      if (kind === "accessor") Object.defineProperty(value, "metal", { enumerable: true, get() { calls++; return TAIL.metal; } });
      if (kind === "hidden") Object.defineProperty(value, "metal", { value: TAIL.metal, enumerable: false });
      if (kind === "symbol") value[Symbol("discarded")] = "0";
      if (kind === "inherited") { delete value.metal; Object.setPrototypeOf(value, { metal: TAIL.metal }); }
      if (kind === "prototype") Object.setPrototypeOf(value, { unrelated: true });
      if (kind === "toJSON") value.toJSON = () => { calls++; return TAIL; };
      planet.npcResourceRemainder = value;
    }
    expect(() => exportSave(state, NOW)).toThrow(/NPC/);
    expect(() => deserializeState(raw)).toThrow(/NPC/);
    expect(calls).toBe(0);
  });

  it.each(["accessor", "hidden", "inherited"])("requires an own enumerable direct planet field: %s", kind => {
    const state: any = seeded(), raw: any = serializeState(state); let calls = 0;
    for (const planet of [state.planets[0], raw.planets[0]]) {
      if (kind === "accessor") Object.defineProperty(planet, "npcResourceRemainder", { enumerable: true, get() { calls++; return TAIL; } });
      if (kind === "hidden") Object.defineProperty(planet, "npcResourceRemainder", { value: TAIL, enumerable: false });
      if (kind === "inherited") { delete planet.npcResourceRemainder; Object.setPrototypeOf(planet, { npcResourceRemainder: TAIL }); }
    }
    expect(() => exportSave(state, NOW)).toThrow(/NPC/);
    expect(() => deserializeState(raw)).toThrow(/NPC/);
    expect(calls).toBe(0);
  });

  it("reads a null-prototype exact remainder object into a detached ordinary object", () => {
    const raw = serializeState(seeded());
    raw.planets[0].npcResourceRemainder = Object.assign(Object.create(null), TAIL);
    const restored = deserializeState(raw);
    expect(restored.planets[0].npcResourceRemainder).toEqual(TAIL);
    expect(restored.planets[0].npcResourceRemainder).not.toBe(raw.planets[0].npcResourceRemainder);
    expect(Object.getPrototypeOf(restored.planets[0].npcResourceRemainder)).toBe(Object.prototype);
  });

  it("leaves the existing ordinary-wallet reader normalization unchanged", () => {
    const raw: any = serializeState(seeded());
    raw.planets[0].resources = { metal: "001.50", crystal: 7, deuterium: "1.2300e+3" };
    const restored = deserializeState(raw);
    expect(serializeState(restored).planets[0].resources).toEqual({ metal: "1.5", crystal: "7", deuterium: "1230" });
    expect(restored.planets[0].npcResourceRemainder).toEqual(TAIL);
  });
});

describe("raw namespace and historical source boundaries", () => {
  it.each(Array.from({ length: 11 }, (_, index) => index + 2))("initializes r%d only after its historical reader and leaves source bytes untouched", revision => {
    const original = legacy(revision), before = JSON.stringify(original), result = importSave(before);
    expect(result.revision).toBe(13);
    expect(result.state.planets.map(planet => planet.npcResourceRemainder)).toEqual([ZERO]);
    expect(result.state.planets[0].resources).toEqual(historical.rows[0].oldReaderOutput.state.planets[0].resources);
    expect(JSON.stringify(original)).toBe(before);
    expect(importSave(JSON.stringify(result))).toEqual(result);
    const invalid = legacy(revision); invalid.state.planets[0].name = "";
    expect(() => importSave(JSON.stringify(invalid))).toThrow(/星球名称/);
  });

  it("retains every fixed genuine r11 historical field other than independently specified additions", () => {
    for (const row of historical.rows) {
      const migrated = importSave(row.raw), source = clone(row.oldReaderOutput.state);
      const { npcEconomy: _economy, npcBattles: _battles, ...rest } = migrated.state;
      const oldProjection = { ...rest, planets: rest.planets.map(({ npcResourceRemainder, ...planet }) => {
        expect(npcResourceRemainder).toEqual(ZERO); return planet;
      }) };
      expect(oldProjection).toEqual(source);
    }
  });

  it.each(Array.from({ length: 11 }, (_, index) => index + 2))("rejects all r%d tail smuggling before normalization can discard it", revision => {
    for (const location of ["envelope", "state", "planet", "discarded-buildings", "unknown-array"]) {
      const source = legacy(revision);
      const target = location === "envelope" ? source : location === "state" ? source.state : location === "planet" ? source.state.planets[0]
        : location === "discarded-buildings" ? source.state.planets[0].buildings : (source.state.unknown = [{}])[0];
      target.npcResourceRemainder = ZERO;
      expect(() => importSave(JSON.stringify(source))).toThrow(/NPC/);
    }
  });

  it.each(["root", "state", "resources", "nested-planet", "named-array"])("rejects current misplaced %s claims", location => {
    const source: any = JSON.parse(exportSave(seeded(), NOW));
    const target = location === "root" ? source : location === "state" ? source.state : location === "resources" ? source.state.planets[0].resources
      : location === "nested-planet" ? (source.state.planets[0].unknown = {}) : source.state.planets;
    target.npcResourceRemainder = ZERO;
    expect(() => rejectNpcAttackFields(source, false, true)).toThrow(/NPC/);
  });

  it.each(["00", "01", "4294967295", "symbol", "hidden-alias", "hidden-index", "prototype", "null-prototype"])
  ("requires a genuine own planet-array entry rather than %s", kind => {
    const state = seeded(), raw = serializeState(state);
    for (const planets of [state.planets, raw.planets]) {
      if (kind === "prototype") Object.setPrototypeOf(planets, Object.create(Array.prototype));
      else if (kind === "null-prototype") Object.setPrototypeOf(planets, null);
      else if (kind === "hidden-index") Object.defineProperty(planets, "0", { value: planets[0], enumerable: false });
      else Object.defineProperty(planets, kind === "symbol" ? Symbol("tail-alias") : kind === "hidden-alias" ? "00" : kind,
        { value: planets[0], enumerable: kind !== "hidden-alias" });
    }
    expect(() => exportSave(state, NOW)).toThrow(/NPC/);
    expect(() => deserializeState(raw)).toThrow(/NPC/);
  });
});

describe("planet entitlement lifecycle remains outside ordinary wallets", () => {
  it("preserves tails through production, manual collection, ordinary payment and cancellation", () => {
    let state = seeded();
    const before = exportSave(state, NOW);
    state = tick(state, 1); sameTails(state);
    state = scrape(state); sameTails(state);
    const paid = enqueue(state, "metal_mine", "manual"); expect(paid.ok, paid.reason).toBe(true); sameTails(paid.state);
    const refunded = cancel(paid.state, 0); expect(refunded.ok, refunded.reason).toBe(true); sameTails(refunded.state);
    expect(exportSave(seeded(), NOW)).toBe(before);
  });

  it("preserves tails through protocol-origin purchases and ordinary merchant exchange", () => {
    const state = seeded();
    const paid = enqueue(state, "metal_mine", "protocol"); expect(paid.ok, paid.reason).toBe(true); sameTails(paid.state);
    const offer = createOffer(state, state.activePlanetId, 731, true);
    const exchanged = trade(offer.state, offer.id, "metal", "crystal", "10");
    expect(exchanged.ok, exchanged.reason).toBe(true); sameTails(exchanged.state);
  });

  it("preserves tails through finite-plan payment and exact owned-job refund", () => {
    const state = seeded();
    const created = createOrderTask(state, { kind: "building", building: "metal_mine", targetLevel: 1,
      planetId: state.activePlanetId, expectedNextTaskId: 1, budget: { metal: "100", crystal: "100", deuterium: "0" } });
    expect(created.ok, created.reason).toBe(true); sameTails(created.state);
    const paid = advanceOrderPlans(created.state, 10);
    expect(paid.planets[0].buildQueue).toHaveLength(1); sameTails(paid);
    const refunded = cancelOrderTask(paid, 1);
    expect(refunded.ok, refunded.reason).toBe(true); sameTails(refunded.state);
    expect(refunded.state.orders.tasks[0].refunded).toEqual({ metal: "60", crystal: "15", deuterium: "0" });
  });

  it("preserves tails through research and shipyard payment/refund", () => {
    const state = seeded(), planet = activePlanet(state);
    planet.resources = { metal: big(10000), crystal: big(10000), deuterium: big(10000) };
    planet.buildings.research_lab = 1; planet.buildings.shipyard = 1;
    const research = enqueueResearch(state, "energy_tech", "manual");
    expect(research.ok, research.reason).toBe(true); sameTails(research.state);
    const researchRefund = cancelResearch(research.state, 0);
    expect(researchRefund.ok, researchRefund.reason).toBe(true); sameTails(researchRefund.state);
    const ships = orderUnits(researchRefund.state, "rocket_launcher", 1, "manual");
    expect(ships.ok, ships.reason).toBe(true); sameTails(ships.state);
    const shipsRefund = cancelUnits(ships.state, 0);
    expect(shipsRefund.ok, shipsRefund.reason).toBe(true); sameTails(shipsRefund.state);
  });

  it("preserves tails through ordinary transport dispatch, delivery and ship return", () => {
    const state = seeded(), origin = activePlanet(state), colony = createPlanet("transport-tail", { galaxy: 2, system: 1, position: 1 });
    colony.npcResourceRemainder = { metal: "0.1", crystal: "0.2", deuterium: "0.3" };
    state.planets.push(colony); origin.resources.deuterium = big(1e6); origin.units.small_cargo = 1;
    state.research.levels.combustion_drive = 6;
    const sent = sendFleet(state, { mission: "transport", target: colony.coordinates, ships: { small_cargo: 1 },
      cargo: { metal: big(10), crystal: big(5), deuterium: big(0) }, speedPercent: 100 });
    expect(sent.ok, sent.reason).toBe(true); sameTails(sent.state);
    const delivered = advanceFleets(sent.state, sent.state.fleets[0].remaining);
    expect(delivered.planets[1].resources.metal.eq(10)).toBe(true);
    expect(delivered.planets[1].npcResourceRemainder).toEqual(colony.npcResourceRemainder); sameTails(delivered);
    const returned = advanceFleets(delivered, delivered.fleets[0].remaining);
    expect(returned.fleets).toHaveLength(0); sameTails(returned);
    expect(returned.planets[1].npcResourceRemainder).toEqual(colony.npcResourceRemainder);
  });

  it("preserves tails through ordinary stake payment/reward and cap/fusion integration", () => {
    const state = seeded(), planet = activePlanet(state);
    planet.resources = { metal: big(10000), crystal: big(10000), deuterium: big(10000) };
    state.research.levels.astrophysics = 1;
    const bet = setBet(state, "metal", 1); expect(bet.ok, bet.reason).toBe(true);
    const grant = grantRun(bet.state, "beacon"); expect(grant.granted).toBe(true);
    const revealed = revealRun(grant.state, "manual"); expect(revealed.ok, revealed.reason).toBe(true); sameTails(revealed.state);
    const capped = seeded();
    activePlanet(capped).buildings.fusion_reactor = 1;
    activePlanet(capped).resources = { metal: big(10000), crystal: big(10000), deuterium: big(100) };
    sameTails(tick(capped, 1));
  });

  it("keeps a hidden tail from funding an ordinary shortfall", () => {
    const state = seeded(), planet = activePlanet(state);
    const cost = canEnqueue(state, "metal_mine").cost;
    planet.resources.metal = cost.metal.sub(0.25);
    planet.npcResourceRemainder.metal = "0.25";
    const before = exportSave(state, NOW), result = enqueue(state, "metal_mine", "manual");
    expect(result.ok).toBe(false); expect(exportSave(result.state, NOW)).toBe(before);
  });

  it("keeps tails on their owner through selection and explicitly abandoned colonies forfeit only theirs", () => {
    const state = seeded(), colony = createPlanet("colony-tail", { galaxy: 2, system: 1, position: 1 });
    colony.npcResourceRemainder = { metal: "0.1", crystal: "0.2", deuterium: "0.3" };
    state.planets.push(colony);
    const selected = selectPlanet(state, colony.id);
    expect(selected.planets[0].npcResourceRemainder).toEqual(TAIL);
    expect(activePlanet(selected).npcResourceRemainder).toEqual(colony.npcResourceRemainder);
    const abandoned = abandonColony(selected, colony.id);
    expect(abandoned.ok, abandoned.reason).toBe(true);
    expect(abandoned.state.planets).toHaveLength(1); sameTails(abandoned.state);
    expect(state.planets[1].npcResourceRemainder).toEqual({ metal: "0.1", crystal: "0.2", deuterium: "0.3" });
  });

  it("creates a zero-tail colony via real fleet arrival without moving the origin right", () => {
    const state = seeded(), planet = activePlanet(state);
    planet.units.colony_ship = 1; planet.resources.deuterium = big(1e6);
    planet.buildings.shipyard = 4; state.research.levels.impulse_drive = 3; state.research.levels.astrophysics = 1;
    let target: Coordinates | undefined;
    for (let system = 1; system <= 100 && !target; system++) for (let position = 1; position <= 15; position++) {
      const next = { galaxy: 1, system, position };
      if (!sameCoordinates(next, planet.coordinates) && !npcAt(state, next)) { target = next; break; }
    }
    expect(target).toBeDefined();
    const sent = sendFleet(state, { mission: "colonize", target: target!, ships: { colony_ship: 1 }, cargo: emptyCargo(), speedPercent: 100 });
    expect(sent.ok, sent.reason).toBe(true);
    const arrived = resolveFleetArrivals({ ...sent.state, fleets: sent.state.fleets.map(fleet => ({ ...fleet, remaining: 0, elapsed: fleet.duration })) });
    expect(arrived.planets).toHaveLength(2);
    expect(arrived.planets[0].npcResourceRemainder).toEqual(TAIL);
    expect(arrived.planets[1].npcResourceRemainder).toEqual(ZERO);
    expect(state.planets).toHaveLength(1); sameTails(state);
  });

  it("prestige previews reset candidate tails and never change the original run", () => {
    const state = seeded(); state.lifetime.metal = big(1e12);
    const before = exportSave(state, NOW), result = evaluatePrestige(state);
    expect(result.gain.gte(1)).toBe(true);
    expect(result.next.planets).toHaveLength(1);
    expect(result.next.planets[0].npcResourceRemainder).toEqual(ZERO);
    expect(exportSave(state, NOW)).toBe(before);
  });
});

describe("bounded save growth and unchanged SaveSession protection", () => {
  function maximumPopulation(withMaximum: boolean): GameState {
    const state = createInitialState(42, 731);
    for (let index = 1; index < 100; index++) state.planets.push(createPlanet(`limit-${index}`, { galaxy: 2, system: index, position: 1 }));
    for (const planet of state.planets) planet.npcResourceRemainder = Object.fromEntries(RESOURCE_IDS.map(id => [id, withMaximum ? MAX_TAIL : "0"])) as typeof ZERO;
    return state;
  }

  it("bounds all 300 maximum-length strings to exactly 89,300 added envelope bytes", () => {
    const state = maximumPopulation(true), raw = exportSave(state, NOW), baseline: any = JSON.parse(raw);
    for (const planet of baseline.state.planets) delete planet.npcResourceRemainder;
    const without = JSON.stringify(baseline, null, 2), zeros = exportSave(maximumPopulation(false), NOW);
    expect(300 * MAX_TAIL.length).toBe(77_400);
    expect(raw.length - without.length).toBe(89_300);
    expect(new TextEncoder().encode(raw).length - new TextEncoder().encode(without).length).toBe(89_300);
    expect(raw.length - zeros.length).toBe(77_100);
    expect(2 * (raw.length - without.length)).toBe(178_600); // UTF-16 code-unit storage accounting.
    const read = importSave(raw);
    expect(read.state.planets).toHaveLength(100);
    for (const planet of read.state.planets) expect(planet.npcResourceRemainder).toEqual({ metal: MAX_TAIL, crystal: MAX_TAIL, deuterium: MAX_TAIL });
    const tooMany = maximumPopulation(false); tooMany.planets.push(createPlanet("overflow", { galaxy: 3, system: 1, position: 1 }));
    expect(() => importSave(exportSave(tooMany, NOW))).toThrow(/1–100/);
  });

  it("does not overwrite current bytes or originals when maximum tails exceed a synthetic storage quota", () => {
    const original = exportSave(maximumPopulation(false), NOW), next = exportSave(maximumPopulation(true), NOW);
    const store = new Store(original), untouchedBackup = historical.rows[0].raw;
    store.values.set(BACKUP_KEY, untouchedBackup);
    const session = new SaveSession(store, NOW);
    // Permit exact original backup but reject only the larger primary candidate.
    store.maxCharacters = untouchedBackup.length + original.length + next.length - 1;
    const result = session.importText(next, NOW);
    expect(result.ok).toBe(false); expect(session.mode).toBe("protected");
    expect(store.values.get(STORAGE_KEY)).toBe(original);
    expect(store.values.get(BACKUP_KEY)).toBe(untouchedBackup);
    expect(store.values.get(`${BACKUP_KEY}.1`)).toBe(original);
    expect(session.export(session.loaded.state)).toEqual({ raw: original, protected: true });
    expect(session.loaded.state.planets[0].npcResourceRemainder).toEqual(ZERO);
  });

  it("prepares an import read-only, then replaces all tails without merging on confirmed import", async () => {
    const original = exportSave(seeded(), NOW), incoming = createInitialState(99, 22);
    incoming.planets[0].npcResourceRemainder = { metal: "0.5", crystal: "0", deuterium: "0" };
    const next = exportSave(incoming, NOW), store = new Store(original), session = new SaveSession(store, NOW);
    const prepared = await session.prepareFile({ text: async () => next });
    expect(prepared.ok).toBe(true); expect(store.writes).toEqual([]); sameTails(session.loaded.state);
    const imported = session.importText(next, NOW);
    expect(imported.ok).toBe(true); if (!imported.ok) throw Error(imported.message);
    expect(imported.state.planets[0].npcResourceRemainder).toEqual(incoming.planets[0].npcResourceRemainder);
    expect(store.values.get(BACKUP_KEY)).toBe(original);
    const reset = session.reset(NOW);
    expect(reset.ok).toBe(true); if (!reset.ok) throw Error(reset.message);
    expect(reset.state.planets[0].npcResourceRemainder).toEqual(ZERO);
  });

  it.each(["drop", "readback", "backup"] as const)("refuses adoption after %s without losing exact original export", fault => {
    const original = exportSave(seeded(), NOW), store = new Store(original), session = new SaveSession(store, NOW);
    store.fault = fault;
    const result = session.importText(exportSave(createInitialState(99, 22), NOW), NOW);
    expect(result.ok).toBe(false); expect(session.mode).toBe("protected");
    expect(session.export(session.loaded.state)).toEqual({ raw: original, protected: true });
    sameTails(session.loaded.state);
    if (fault !== "readback") expect(store.values.get(STORAGE_KEY)).toBe(original);
  });

  it("protects malformed current bytes without new saves, backups or clearing tails", () => {
    const source: any = JSON.parse(exportSave(seeded(), NOW)); delete source.state.planets[0].npcResourceRemainder;
    const original = JSON.stringify(source), store = new Store(original), session = new SaveSession(store, NOW);
    expect(session.mode).toBe("protected"); expect(store.writes).toEqual([]);
    expect(session.export(session.loaded.state)).toEqual({ raw: original, protected: true });
  });

  it("preserves exact r12 source and zero migrated rights when backup quota prevents upgrade", () => {
    const source = legacy(12), original = JSON.stringify(source, null, 2), store = new Store(original);
    store.fault = "backup";
    const session = new SaveSession(store, source.lastTickAt + 100_000);
    expect(session.mode).toBe("protected"); expect(session.loaded.appliedSeconds).toBe(0);
    expect(session.loaded.state.planets[0].npcResourceRemainder).toEqual(ZERO);
    expect(store.values.get(STORAGE_KEY)).toBe(original);
    expect(session.export(session.loaded.state)).toEqual({ raw: original, protected: true });
    expect(store.writes).not.toContain(STORAGE_KEY);
  });

  it("keeps original tails protected after a concurrent replacement and never overwrites the other slot", () => {
    const original = exportSave(seeded(), NOW), store = new Store(original), session = new SaveSession(store, NOW);
    const changed = exportSave(createInitialState(91, 22), NOW);
    store.values.set(STORAGE_KEY, changed);
    expect(session.handleStorageEvent(STORAGE_KEY)).toBe(true); expect(session.mode).toBe("conflict");
    expect(session.save(session.loaded.state, NOW).ok).toBe(false);
    expect(store.values.get(STORAGE_KEY)).toBe(changed); expect(store.writes).toEqual([]);
    expect(session.export(session.loaded.state)).toEqual({ raw: original, protected: true }); sameTails(session.loaded.state);
  });
});
