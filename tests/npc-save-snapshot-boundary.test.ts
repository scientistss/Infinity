import { describe, expect, it, vi } from "vitest";
import historical from "./fixtures/npc-economy-r11.json";
import { big } from "../src/game/decimal";
import { advanceFleets, emptyCargo, nextFleetEvent, sendFleet } from "../src/game/fleet";
import { coordinateKey } from "../src/game/galaxy";
import { validateNpcAttackReferences } from "../src/game/npc-attack-state";
import * as wallet from "../src/game/npc-wallet";
import { exportSave, deserializeState, importSave, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const TARGET = { galaxy: 1, system: 56, position: 6 };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Synthetic prerequisites, then actual paid launch and optional battle arrival. */
function launched(returning = false): GameState {
  const state = createInitialState(20261010, 97531), planet = state.planets[0];
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 3;
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000 });
  Object.assign(state.research.levels, { combustion_drive: 3, computer_tech: 10, weapons_tech: 1 });
  const result = sendFleet(deserializeState(serializeState(state)), {
    mission: "attack", target: { ...TARGET }, ships: { light_fighter: 20, small_cargo: 2 },
    cargo: emptyCargo(), speedPercent: 100,
  });
  if (!result.ok) throw Error(result.reason);
  return returning ? advanceFleets(result.state, nextFleetEvent(result.state)) : result.state;
}

function objects(value: unknown, result = new Set<object>()): Set<object> {
  if (!value || typeof value !== "object" || result.has(value)) return result;
  result.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    if ("value" in field) objects(field.value, result);
  }
  return result;
}

function duringCargoEquality(state: GameState, mutate: () => void): () => number {
  const amount = state.fleets[0].cargo.metal, eq = amount.eq;
  let calls = 0;
  Object.defineProperty(amount, "eq", { configurable: true, value(other: number) {
    calls++;
    mutate();
    return eq.call(this, other);
  } });
  return () => calls;
}

describe("NPC serialization snapshot ownership", () => {
  it("returns fully detached frozen snapshots only after the last reference passes", () => {
    const state = launched(true), source = objects([state.npcEconomy, state.npcBattles]);
    const snapshot = validateNpcAttackReferences(state);
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const root of [snapshot.npcEconomy, snapshot.npcBattles]) for (const object of objects(root)) {
      expect(source.has(object)).toBe(false);
      expect(Object.isFrozen(object)).toBe(true);
    }
    const bytes = JSON.stringify(snapshot);
    state.totalTime = big(-1); // Only the final historical-report loop checks this relationship.
    expect(() => validateNpcAttackReferences(state)).toThrow("NPC 攻击状态或战报无效");
    expect(JSON.stringify(snapshot)).toBe(bytes);
  });

  it("detaches and freezes every wallet and battle descendant without changing the source", () => {
    const state = launched(true);
    state.npcEconomy = clone(state.npcEconomy);
    state.npcBattles = clone(state.npcBattles);
    const before = JSON.stringify(state), source = objects([state.npcEconomy, state.npcBattles]);
    const saved = serializeState(state);
    for (const root of [saved.npcEconomy, saved.npcBattles]) for (const object of objects(root)) {
      expect(source.has(object)).toBe(false);
      expect(Object.isFrozen(object)).toBe(true);
    }
    expect(JSON.stringify(state)).toBe(before);
    const bytes = JSON.stringify(saved);
    (state.npcEconomy.baseline.stock as unknown as [number, number, number])[0]++;
    (state.npcBattles.reports[0].loot as unknown as [number, number, number])[0]++;
    expect(JSON.stringify(saved)).toBe(bytes);
    expect(() => serializeState(state)).toThrow("NPC 攻击状态或战报无效");
  });

  it("does not reuse prior-call approval or retain a mutable stock alias", () => {
    const state = launched();
    state.npcEconomy = clone(state.npcEconomy);
    const stock = state.npcEconomy.baseline.stock as unknown as [number, number, number], key = coordinateKey(TARGET);
    state.npcEconomy = { ...state.npcEconomy, sites: {
      ...state.npcEconomy.sites, [key]: { ...state.npcEconomy.sites[key], stock },
    } };
    const first = serializeState(state), before = JSON.stringify(first);
    stock[0]++;
    const second = serializeState(state);
    expect(second.npcEconomy.baseline.stock[0]).toBe(stock[0]);
    expect(second.npcEconomy.sites[key].stock[0]).toBe(stock[0]);
    expect(JSON.stringify(first)).toBe(before);
    stock[0] = -1;
    expect(() => serializeState(state)).toThrow("Invalid NPC wallet state");
    expect(stock[0]).toBe(-1);
  });

  it("keeps complete valid JSON bytes stable after canonical import", () => {
    for (const source of [createInitialState(42, 731), launched(), launched(true)]) {
      const state = deserializeState(importSave(exportSave(source, 1000, 1000)).state);
      const before = JSON.stringify(state), first = exportSave(state, 1000, 1000);
      expect(exportSave(state, 1000, 1000)).toBe(first);
      expect(exportSave(deserializeState(importSave(first).state), 1000, 1000)).toBe(first);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});

describe("raw NPC checks precede any snapshot reuse", () => {
  it.each(["accessor", "symbol", "hidden-extra", "sparse", "cycle"] as const)
  ("rejects %s without repairing or changing the source", kind => {
    const state = launched(true);
    state.npcBattles = clone(state.npcBattles);
    const report = state.npcBattles.reports[0];
    let calls = 0;
    if (kind === "accessor") Object.defineProperty(report, "loot", { enumerable: true, get() { calls++; return [0, 0, 0]; } });
    if (kind === "symbol") Object.defineProperty(report, Symbol("unknown"), { value: 0, enumerable: true });
    if (kind === "hidden-extra") Object.defineProperty(report, "unknown", { value: undefined });
    if (kind === "sparse") delete (state.npcBattles.reports as unknown[])[0];
    if (kind === "cycle") Object.defineProperty(report, "cycle", { value: report, enumerable: true });
    const descriptors = Object.getOwnPropertyDescriptors(report), reports = Object.getOwnPropertyDescriptors(state.npcBattles.reports);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => serializeState(state)).toThrow(/NPC/);
      expect(Object.getOwnPropertyDescriptors(report)).toEqual(descriptors);
      expect(Object.getOwnPropertyDescriptors(state.npcBattles.reports)).toEqual(reports);
    }
    expect(calls).toBe(0);
  });
});

describe("the second NPC read preserves rejection after validation callbacks", () => {
  it.each(["negative-stock", "hidden-field", "accessor"] as const)
  ("rejects a Decimal equality callback's mutable wallet %s", kind => {
    const state = launched();
    state.npcEconomy = clone(state.npcEconomy);
    let getterCalls = 0;
    const calls = duringCargoEquality(state, () => {
      if (kind === "negative-stock") (state.npcEconomy.baseline.stock as unknown as [number, number, number])[0] = -1;
      if (kind === "hidden-field") Object.defineProperty(state.npcEconomy, "unknown", { value: undefined });
      if (kind === "accessor") Object.defineProperty(state.npcEconomy, "now", { enumerable: true, get() { getterCalls++; return 0; } });
    });
    expect(() => serializeState(state)).toThrow("Invalid NPC wallet state");
    expect(calls()).toBe(1);
    expect(getterCalls).toBe(0);
  });

  it("rejects a callback's invalid report after the initial report snapshot was valid", () => {
    const state = launched(true);
    state.npcBattles = clone(state.npcBattles);
    const calls = duringCargoEquality(state, () => { (state.npcBattles.reports[0].loot as unknown as [number, number, number])[0]++; });
    expect(() => serializeState(state)).toThrow("NPC 攻击状态或战报无效");
    expect(calls()).toBe(1);
  });

  it.each(["wallet", "battles"] as const)("rejects replacement of the originally deeply frozen %s root", kind => {
    const state = launched();
    for (const root of [state.npcEconomy, state.npcBattles]) for (const object of objects(root)) expect(Object.isFrozen(object)).toBe(true);
    const calls = duringCargoEquality(state, () => {
      if (kind === "wallet") state.npcEconomy = Object.freeze({ ...state.npcEconomy, now: -1 });
      else state.npcBattles = Object.freeze({ ...state.npcBattles, reports: Object.freeze([{}]) }) as GameState["npcBattles"];
    });
    expect(() => serializeState(state)).toThrow(kind === "wallet" ? "Invalid NPC wallet state" : "NPC 攻击状态或战报无效");
    expect(calls()).toBe(1);
  });

  it.each(["seed", "coordinate"] as const)("revalidates the %s context after cargo callbacks", kind => {
    const state = launched();
    const calls = duringCargoEquality(state, () => {
      if (kind === "seed") state.universe.seed = -1;
      else state.planets[0].coordinates = { ...state.planets[0].coordinates, system: 0 };
    });
    expect(() => serializeState(state)).toThrow(kind === "seed" ? "Invalid NPC wallet context" : "Invalid NPC player coordinate");
    expect(calls()).toBe(1);
  });

  it("does not mistake inherited Decimal method getters for inert data", () => {
    const state = launched(), amount = state.fleets[0].cargo.metal, eq = amount.eq;
    const prototype = Object.create(Object.getPrototypeOf(amount));
    let calls = 0;
    Object.defineProperty(prototype, "eq", { get() {
      calls++;
      state.npcEconomy = { ...state.npcEconomy, now: -1 };
      return eq;
    } });
    Object.setPrototypeOf(amount, prototype);
    expect(() => serializeState(state)).toThrow("Invalid NPC wallet state");
    expect(calls).toBe(1);
  });

  it("does not treat a frozen Proxy target as proof that a removed read is inert", () => {
    const state = launched(), source = state.npcEconomy;
    let armed = false;
    state.npcEconomy = new Proxy(source, { get(target, key, receiver) {
      if (armed && key === "now") throw new TypeError("NPC proxy revoked its read");
      return Reflect.get(target, key, receiver);
    } });
    for (const object of objects(state.npcEconomy)) expect(Object.isFrozen(object)).toBe(true);
    const calls = duringCargoEquality(state, () => { armed = true; });
    expect(() => serializeState(state)).toThrow("NPC proxy revoked its read");
    expect(calls()).toBe(1);
  });
});

describe("private JSON import snapshot reuse", () => {
  it("removes one import wallet read while retaining both public runtime reads", () => {
    const state = launched(true), raw = exportSave(state, 1000, 1000);
    const read = vi.spyOn(wallet, "readNpcWalletState");
    try {
      serializeState(state);
      expect(read).toHaveBeenCalledTimes(2);
      read.mockClear();
      importSave(raw);
      // Raw reader, readState reference validator, final serializer reference validator.
      expect(read).toHaveBeenCalledTimes(3);
      read.mockClear();
      exportSave(state, 1000, 1000);
      expect(read).toHaveBeenCalledTimes(2);
    } finally { read.mockRestore(); }
  });

  it("matches complete current JSON bytes from the pre-optimization 3444a6c oracle", async () => {
    const raw = exportSave(createInitialState(42, 731), 1000, 1000);
    const bytes = JSON.stringify(importSave(raw));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes));
    expect(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""))
      .toBe("e5aedfe82a71e8b0b463c21716eddde8cf6092c29695cca87fcab265d948720b");
  });

  it("validates JSON method-shaped data and repeated invalid inputs without changing their source", () => {
    const source = JSON.parse(exportSave(launched(true), 1000, 1000));
    for (const mutate of [
      (file: typeof source) => { file.state.fleets[0].cargo.metal = { mantissa: 0, exponent: 0, eq: "return true" }; },
      (file: typeof source) => { file.state.npcEconomy.baseline.stock[0] = -1; },
      (file: typeof source) => { file.state.npcBattles.reports[0].loot[0]++; },
      (file: typeof source) => { file.state.fleets = []; },
      (file: typeof source) => { file.state.npcBattles.reports = []; },
    ]) {
      const file = clone(source); mutate(file);
      const before = JSON.stringify(file);
      expect(() => importSave(before)).toThrow();
      expect(() => importSave(before)).toThrow();
      expect(JSON.stringify(file)).toBe(before);
    }
  });

  it("keeps r11 and synthetic r12 migrations deterministic without changing source fixtures", () => {
    for (const row of historical.rows) {
      const before = JSON.stringify(row), once = importSave(row.raw);
      expect(importSave(row.raw)).toEqual(once);
      expect(importSave(JSON.stringify(once))).toEqual(once);
      expect(JSON.stringify(row)).toBe(before);
      const r12 = { ...row.oldReaderOutput, revision: 12, state: { ...row.oldReaderOutput.state,
        npcEconomy: { model: "fixed-production-v1", elapsedSeconds: 60 } } };
      const raw = JSON.stringify(r12), migrated = importSave(raw);
      expect(importSave(raw)).toEqual(migrated);
      expect(importSave(JSON.stringify(migrated))).toEqual(migrated);
      expect(JSON.stringify(r12)).toBe(raw);
    }
  });
});
