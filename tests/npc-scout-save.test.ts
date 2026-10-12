import { describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { emptyCargo, type Fleet } from "../src/game/fleet";
import { coordinateKey, coordinateRandom, homeCoordinates, SPACE, type Coordinates } from "../src/game/galaxy";
import { initialNpcGarrison } from "../src/game/npc-garrison";
import { readNpcScoutMessages, rejectNpcScoutFields, validateNpcScoutReferences } from "../src/game/npc-scout-save";
import { NPC_SCOUT_SNAPSHOT_MODEL, readNpcScoutSnapshot } from "../src/game/npc-scout-state";
import * as wallet from "../src/game/npc-wallet";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

function coordinate(seed: number, strong?: boolean): Coordinates {
  for (let system = 1; system <= 100; system++) for (let position = 1; position <= 15; position++) {
    const target = { galaxy: 1, system, position };
    if (coordinateKey(target) !== coordinateKey(homeCoordinates(seed)) && coordinateRandom(seed, target) < SPACE.npcDensity
      && (strong === undefined || (initialNpcGarrison(seed, target).heavy_fighter === 1) === strong)) return target;
  }
  throw Error("Missing static NPC fixture");
}
/** Synthetic historical snapshot fixture; paid-arrival provenance is tested separately. */
function historical(): GameState {
  const state = createInitialState(42, 731), target = coordinate(42);
  state.totalTime = big("100.125"); state.nextFleetId = 2;
  state.messages = [{ id: "scout-1", at: 100.125, text: "Existing historical scout text", npcScoutSnapshot: readNpcScoutSnapshot({
    model: NPC_SCOUT_SNAPSHOT_MODEL, fleetId: 1, originId: "abandoned-origin", target, observedAt: "100.125",
    stock: [515, 257.5, Number.MIN_VALUE], garrison: initialNpcGarrison(42, target), defenderTech: { weapons: 0, shields: 0, armour: 0 },
  }) }];
  return state;
}
function returning(state: GameState): Fleet {
  const snapshot = state.messages[0].npcScoutSnapshot!;
  return { id: 1, originId: state.planets[0].id, target: { ...snapshot.target }, mission: "scout", returning: true,
    ships: { espionage_probe: 1 }, cargo: emptyCargo(), duration: 20, remaining: 20, elapsed: 0, orderTransport: null };
}

describe("r14 scout history persistence", () => {
  it("round-trips exact detached history without a live scout, origin, site or wallet projection", () => {
    const state = historical(), before = serializeState(state), sourceStock = state.npcEconomy.baseline.stock;
    const project = vi.spyOn(wallet, "projectNpc");
    try {
      const saved = exportSave(state, 1000), file = importSave(saved), restored = deserializeState(file.state);
      expect(file.revision).toBe(14); expect(serializeState(restored)).toEqual(before);
      expect(restored.messages[0].npcScoutSnapshot).toEqual(state.messages[0].npcScoutSnapshot);
      expect(restored.messages[0].npcScoutSnapshot).not.toBe(state.messages[0].npcScoutSnapshot);
      expect(Object.keys(restored.npcEconomy.sites)).toEqual([]); expect(project).not.toHaveBeenCalled();
      expect(state.npcEconomy.baseline.stock).toBe(sourceStock);
      expect(serializeState(state)).toEqual(before);
    } finally { project.mockRestore(); }
  });
  it("preserves stronger historical garrison and stock after the actual wallet has changed", () => {
    const state = historical(), snapshot = state.messages[0].npcScoutSnapshot!;
    const context = wallet.createNpcWalletContext(state.universe.seed, 512, state.planets.map(planet => planet.coordinates));
    state.npcEconomy = wallet.materializeNpcAtPaidLaunch(state.npcEconomy, snapshot.target, context);
    const key = coordinateKey(snapshot.target), site = state.npcEconomy.sites[key];
    state.npcEconomy = { ...state.npcEconomy, sites: { [key]: { ...site, stock: [0, 0, 0],
      garrison: { light_fighter: 0, heavy_fighter: 0 } } } };
    const restored = deserializeState(importSave(exportSave(state)).state);
    expect(restored.messages[0].npcScoutSnapshot).toEqual(snapshot);
    expect(restored.npcEconomy.sites[key].garrison).toEqual({ light_fighter: 0, heavy_fighter: 0 });
    expect(restored.npcEconomy.sites[key].stock).toEqual([0, 0, 0]);
  });
  it("requires explicit null on every current ordinary message, while preserving its old fields", () => {
    const state = createInitialState(42, 731); state.messages = [{ id: "old", at: 12.25, text: "old report", npcScoutSnapshot: null }];
    expect(importSave(exportSave(state)).state.messages).toEqual(state.messages);
    const raw: any = structuredClone(serializeState(state)); delete raw.messages[0].npcScoutSnapshot;
    expect(() => deserializeState(raw)).toThrow(/NPC/);
    (state.messages[0] as any).npcScoutSnapshot = undefined; expect(() => exportSave(state)).toThrow(/NPC/);
  });
  it("retains 150 ordinary messages without creating extra retention or materialized sites", () => {
    const state = historical();
    state.messages.push(...Array.from({ length: 149 }, (_, i) => ({ id: `ordinary-${i}`, at: 0, text: "", npcScoutSnapshot: null })));
    expect(importSave(exportSave(state)).state.messages).toHaveLength(150);
    state.messages.push({ id: "overflow", at: 0, text: "", npcScoutSnapshot: null });
    expect(() => exportSave(state)).toThrow();
  });
  it.each(["id", "duplicate", "next-id", "future", "wrong-world", "initial-garrison", "current-owned"])
  ("rejects historical %s crosslink corruption", kind => {
    const raw: any = structuredClone(serializeState(historical())), snapshot = raw.messages[0].npcScoutSnapshot;
    if (kind === "id") raw.messages[0].id = "scout-01";
    if (kind === "duplicate") raw.messages.push(structuredClone(raw.messages[0]));
    if (kind === "next-id") raw.nextFleetId = 1;
    if (kind === "future") snapshot.observedAt = "100.126";
    if (kind === "wrong-world") snapshot.target = homeCoordinates(42);
    if (kind === "initial-garrison") { snapshot.target = coordinate(42, false); snapshot.garrison = { light_fighter: 8, heavy_fighter: 1 }; }
    if (kind === "current-owned") { raw.planets[0].coordinates = snapshot.target; }
    expect(() => deserializeState(raw)).toThrow();
  });
  it("accepts exact canonical huge time without substituting its clamped list label", () => {
    const state = historical(), raw: any = structuredClone(serializeState(state));
    raw.totalTime = "1e+400"; raw.messages[0].npcScoutSnapshot.observedAt = "1e+400"; raw.messages[0].at = 1e12;
    expect(deserializeState(raw).messages[0].npcScoutSnapshot!.observedAt).toBe("1e+400");
    raw.messages[0].npcScoutSnapshot.observedAt = "1.000000000000001e+400";
    expect(() => deserializeState(raw)).toThrow();
  });
  it.each(["100.125", "1000000000000", "1000000000001.0001", "1e+400"])("rejects typed list-time mismatch at %s with full source preservation", observedAt => {
    const state = historical(), raw: any = structuredClone(serializeState(state));
    raw.totalTime = observedAt; raw.messages[0].npcScoutSnapshot.observedAt = observedAt;
    raw.messages[0].at = big(observedAt).min(1e12).toNumber();
    expect(() => deserializeState(raw)).not.toThrow();
    raw.messages[0].at -= 1;
    const before = JSON.stringify(raw);
    for (let attempt = 0; attempt < 2; attempt++) { expect(() => deserializeState(raw)).toThrow(/NPC/); expect(JSON.stringify(raw)).toBe(before); }
    const file = JSON.parse(exportSave(state)); file.state = raw;
    const bytes = JSON.stringify(file); expect(() => importSave(bytes)).toThrow(/NPC/); expect(JSON.stringify(file)).toBe(bytes);
  });
  it.each(["outbound", "mission", "origin", "target", "attack-receipt"])("rejects same-ID %s collision", kind => {
    const state = historical();
    state.messages[0].npcScoutSnapshot = readNpcScoutSnapshot({ ...state.messages[0].npcScoutSnapshot!, originId: state.planets[0].id });
    state.fleets = [returning(state)];
    expect(() => validateNpcScoutReferences(state)).not.toThrow();
    if (kind === "outbound") state.fleets[0].returning = false;
    if (kind === "mission") state.fleets[0].mission = "transport";
    if (kind === "origin") state.fleets[0].originId = "different";
    if (kind === "target") state.fleets[0].target = { galaxy: 5, system: 1, position: 1 };
    if (kind === "attack-receipt") state.npcBattles = { model: "npc-battle-receipts-v1", reports: [{ fleetId: 1 } as any] };
    expect(() => validateNpcScoutReferences(state)).toThrow();
  });
  it("does not require a retained snapshot for a returning scout", () => {
    const state = historical(); state.fleets = [returning(state)]; state.messages = [];
    expect(() => deserializeState(serializeState(state))).not.toThrow();
  });
});

const badArrayKinds = ["00", "01", "4294967295", "symbol", "hidden-alias", "hidden-index", "prototype", "null-prototype", "hole"] as const;
function damageArray(messages: any[], kind: typeof badArrayKinds[number]) {
  if (kind === "prototype") Object.setPrototypeOf(messages, Object.create(Array.prototype));
  else if (kind === "null-prototype") Object.setPrototypeOf(messages, null);
  else if (kind === "hole") delete messages[0];
  else if (kind === "hidden-index") Object.defineProperty(messages, "0", { value: messages[0], enumerable: false });
  else Object.defineProperty(messages, kind === "symbol" ? Symbol("alias") : kind === "hidden-alias" ? "00" : kind,
    { value: messages[0], enumerable: kind !== "hidden-alias", configurable: true });
}

describe("untouched-source scout marker protection", () => {
  it.each(badArrayKinds)("rejects current message array %s before normalization or JSON", kind => {
    const state = historical(), raw = serializeState(state); damageArray(raw.messages, kind);
    expect(() => deserializeState(raw)).toThrow(/NPC/);
    damageArray(state.messages, kind); expect(() => exportSave(state)).toThrow(/NPC/);
  });
  it("rejects unknown message fields, prototype/symbol/accessor authority with no getter calls", () => {
    let calls = 0;
    for (const kind of ["extra", "symbol", "prototype", "accessor", "hidden"] as const) {
      const state = historical(), message: any = state.messages[0];
      if (kind === "extra") message.extra = undefined;
      if (kind === "symbol") message[Symbol("extra")] = 0;
      if (kind === "prototype") Object.setPrototypeOf(message, { inherited: true });
      if (kind === "accessor") Object.defineProperty(message, "npcScoutSnapshot", { enumerable: true, get() { calls++; return null; } });
      if (kind === "hidden") Object.defineProperty(message, "npcScoutSnapshot", { value: message.npcScoutSnapshot, enumerable: false });
      expect(() => exportSave(state)).toThrow();
    }
    expect(calls).toBe(0);
  });
  it.each(["snapshot", "message", "messages", "ancestor", "nested-part", "inherited", "cycle"])
  ("rejects aliases and misplaced %s history before source fields are discarded", kind => {
    const raw: any = structuredClone(serializeState(historical()));
    if (kind === "snapshot") raw.unknown = raw.messages[0].npcScoutSnapshot;
    if (kind === "message") raw.unknown = raw.messages[0];
    if (kind === "messages") raw.unknown = raw.messages;
    if (kind === "ancestor") { const envelope = { state: raw, alias: raw }; expect(() => rejectNpcScoutFields(envelope, false, true)).toThrow(); return; }
    if (kind === "nested-part") raw.unknown = raw.messages[0].npcScoutSnapshot.stock;
    if (kind === "inherited") raw.unknown = Object.create({ npcScoutSnapshot: null });
    if (kind === "cycle") raw.unknown = raw;
    expect(() => deserializeState(raw)).toThrow(/NPC/);
  });
  it("requires actual state.messages arrays and canonical own numeric entries", () => {
    const message = historical().messages[0];
    expect(() => rejectNpcScoutFields({ messages: { 0: message } }, false)).toThrow();
    expect(() => rejectNpcScoutFields({ state: { messages: { 0: message } } }, false, true)).toThrow();
    expect(() => rejectNpcScoutFields({ extra: { npcScoutSnapshot: null } }, false)).toThrow();
    expect(() => rejectNpcScoutFields({ extra: { unrelated: NPC_SCOUT_SNAPSHOT_MODEL } }, false)).toThrow();
  });
  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])("rejects retagging and any-depth reserved markers in r%s", revision => {
    const current = JSON.parse(exportSave(historical())); current.revision = revision;
    expect(() => importSave(JSON.stringify(current))).toThrow(/NPC/);
    for (const marker of [{ npcScoutSnapshot: null }, { arbitrary: NPC_SCOUT_SNAPSHOT_MODEL }]) {
      const nested = { metadata: { list: [{ far: marker }] }, state: { messages: [] } };
      expect(() => rejectNpcScoutFields(nested, true, true)).toThrow(/NPC/);
    }
  });
  it("does not ban unrelated names or historical ordinary-fleet extras", () => {
    expect(() => rejectNpcScoutFields({ fleets: Object.assign([], { ordinary: { stock: 1, model: "other", observedAt: 0 } }) }, false)).not.toThrow();
    expect(readNpcScoutMessages([{ id: "", at: -0, text: "", npcScoutSnapshot: null }])[0].id).toBe("");
  });
});
