import { describe, expect, it, vi } from "vitest";
import { coordinateKey, homeCoordinates, type Coordinates } from "../src/game/galaxy";
import { npcEconomySnapshot } from "../src/game/npc-economy";
import { initialNpcGarrison, type NpcGarrison } from "../src/game/npc-garrison";
import { allocateNpcLoot, NPC_WALLET_CAPS, type NpcResourceTuple } from "../src/game/npc-loot";
import { advanceNpcWallet, createNpcWallet, createNpcWalletContext, debitNpcAtArrival, isNpcWalletState,
  materializeNpcAtPaidLaunch, npcWalletFromSnapshot, NPC_WALLET_HORIZON, NPC_WALLET_MODEL,
  NPC_WALLET_WORLD_SITE_CEILING, projectNpc, readNpcWalletState, type NpcWalletContext, type NpcWalletState } from "../src/game/npc-wallet";

const a = { galaxy: 1, system: 1, position: 6 }, b = { galaxy: 1, system: 1, position: 11 };
const large = { galaxy: 1, system: 2, position: 3 };
const context = createNpcWalletContext(1, 10, []);
const key = coordinateKey(a);
const dead = Object.freeze({ light_fighter: 0, heavy_fighter: 0 });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const loaded = (stock: NpcResourceTuple = [500, 250, 0]): NpcWalletState => materializeNpcAtPaidLaunch(
  npcWalletFromSnapshot({ metal: stock[0], crystal: stock[1], deuterium: stock[2] }), a, context,
);

describe("standalone mutable NPC wallet: pure candidates only", () => {
  it("freezes the minimal model and initial stock without touching GameState", () => {
    const state = createNpcWallet();
    expect(NPC_WALLET_MODEL).toBe("npc-wallet-garrison-v1");
    expect(NPC_WALLET_HORIZON).toBe(12_000); expect(NPC_WALLET_WORLD_SITE_CEILING).toBe(7_500);
    expect(state).toEqual({ model: NPC_WALLET_MODEL, now: 0, baseline: { stock: [500, 250, 0], mark: 0 }, sites: {} });
    expect(isNpcWalletState(state, context)).toBe(true);
    for (const value of [state, state.baseline, state.baseline.stock, state.sites]) expect(Object.isFrozen(value)).toBe(true);
  });

  it("projects shared untouched baseline without materializing or re-anchoring either target", () => {
    const state = advanceNpcWallet(createNpcWallet(), 60, context), before = JSON.stringify(state);
    expect(projectNpc(state, a, context)).toEqual({ key, stock: [800, 400, 60], garrison: { light_fighter: 4, heavy_fighter: 0 } });
    expect(projectNpc(state, b, context).stock).toEqual([800, 400, 60]);
    const read = projectNpc(state, a, context);
    expect(read).not.toBe(projectNpc(state, a, context));
    for (let i = 0; i < 100; i += 1) projectNpc(state, a, context);
    expect(JSON.stringify(state)).toBe(before); expect(state.sites).toEqual({});
    expect(Object.isFrozen(read.stock)).toBe(true); expect(Object.isFrozen(read.garrison)).toBe(true);
  });

  it("materializes only a returned candidate, once, and shares the same coordinate account", () => {
    const state = advanceNpcWallet(createNpcWallet(), 60, context);
    const candidate = materializeNpcAtPaidLaunch(state, a, context);
    expect(state.sites).toEqual({});
    expect(candidate.sites[key]).toEqual({ stock: [800, 400, 60], mark: 60, garrison: { light_fighter: 4, heavy_fighter: 0 } });
    expect(materializeNpcAtPaidLaunch(candidate, { ...a }, context)).toBe(candidate);
    const looted = debitNpcAtArrival(candidate, a, [400, 200, 30], dead, context);
    expect(projectNpc(looted, a, context).stock).toEqual([400, 200, 30]);
    expect(projectNpc(looted, b, context).stock).toEqual([800, 400, 60]);
    const second = materializeNpcAtPaidLaunch(looted, b, context);
    expect(second.sites[coordinateKey(b)].stock).toEqual([800, 400, 60]);
    expect(second.sites[key].garrison).toEqual(dead);
  });

  it("caps each resource, suppresses overflow, then resumes production from actual remainder", () => {
    const full = advanceNpcWallet(loaded(), 12_000, context);
    const waited = advanceNpcWallet(full, 1_000, context);
    const debited = debitNpcAtArrival(waited, a, [10_000, 0, 0], dead, context);
    expect(projectNpc(debited, a, context).stock).toEqual([40_000, 30_000, 10_000]);
    expect(projectNpc(advanceNpcWallet(debited, 1, context), a, context).stock).toEqual([40_005, 30_000, 10_000]);
    expect(projectNpc(debited, b, context).stock).toEqual(NPC_WALLET_CAPS);
  });

  it("debits same-time raids sequentially, retains dead garrisons and never evicts records", () => {
    const full = loaded(NPC_WALLET_CAPS);
    const first = debitNpcAtArrival(full, a, allocateNpcLoot(projectNpc(full, a, context).stock, 45_000), dead, context);
    const restored = readNpcWalletState(clone(first), context);
    const second = debitNpcAtArrival(restored, a, allocateNpcLoot(projectNpc(restored, a, context).stock, 45_000), dead, context);
    expect(projectNpc(second, a, context).stock).toEqual([12_500, 7_500, 2_500]);
    expect(second.now).toBe(0); expect(second.sites[key].garrison).toEqual(dead);
    expect(materializeNpcAtPaidLaunch(second, a, context)).toBe(second);
    const later = advanceNpcWallet(second, 50_000, context);
    expect(projectNpc(later, a, context).stock).toEqual(NPC_WALLET_CAPS);
    expect(projectNpc(later, a, context).garrison).toEqual(dead);
    expect(Object.keys(later.sites)).toEqual([key]);
  });

  it("preserves fractional dust and only removes actually loaded integers", () => {
    const state = loaded([3.75, 11.5, 7.25]), before = JSON.stringify(state);
    const loot = allocateNpcLoot(projectNpc(state, a, context).stock, 5);
    const next = debitNpcAtArrival(state, a, loot, dead, context);
    expect(loot).toEqual([1, 3, 1]); expect(projectNpc(next, a, context).stock).toEqual([2.75, 8.5, 6.25]);
    expect(JSON.stringify(state)).toBe(before);
    for (let i = 0; i < 3; i += 1) expect(next.sites[key].stock[i] + loot[i]).toBe(state.sites[key].stock[i]);
  });

  it("zero loot explicitly preserves stock and mark, even when the garrison changes", () => {
    const initial = loaded([3.75, 11.5, Number.MIN_VALUE]);
    const state = advanceNpcWallet(initial, 0.1, context), site = state.sites[key];
    const changed = debitNpcAtArrival(state, a, [0, 0, 0], dead, context);
    expect(changed.sites[key].stock).toBe(site.stock);
    expect(changed.sites[key].mark).toBe(0);
    expect(changed.sites[key].stock[2]).toBe(Number.MIN_VALUE);
    expect(changed.sites[key].garrison).toEqual(dead);
    expect(projectNpc(changed, a, context).stock).toEqual(projectNpc(state, a, context).stock);
    expect(debitNpcAtArrival(state, a, [0, 0, 0], site.garrison, context)).toBe(state);
    expect(debitNpcAtArrival(changed, a, [0, 0, 0], dead, context)).toBe(changed);
    // Prototype debit(0) instead projected and updated mark. That behavior is deliberately not used.
    expect(changed.sites[key].mark).not.toBe(state.now);
  });

  it("zero-time subnormal stock survives observations, zero loot and 100 JSON imports unchanged", () => {
    let state = loaded([0, 0, Number.MIN_VALUE]);
    state = debitNpcAtArrival(state, a, [0, 0, 0], dead, context);
    for (let i = 0; i < 100; i += 1) {
      state = readNpcWalletState(clone(state), context);
      expect(projectNpc(state, a, context).stock[2]).toBe(Number.MIN_VALUE);
    }
    expect(state.sites[key].stock[2]).toBe(Number.MIN_VALUE);
  });

  it("refuses creation over the explicit cap but allows the existing account at that cap", () => {
    const smallContext = createNpcWalletContext(1, 1, []);
    const state = materializeNpcAtPaidLaunch(createNpcWallet(), a, smallContext), before = JSON.stringify(state);
    expect(() => materializeNpcAtPaidLaunch(state, b, smallContext)).toThrow(RangeError);
    expect(JSON.stringify(state)).toBe(before);
    const cleared = debitNpcAtArrival(state, a, [0, 0, 0], dead, smallContext);
    expect(materializeNpcAtPaidLaunch(cleared, a, smallContext)).toBe(cleared);
    expect(() => materializeNpcAtPaidLaunch(cleared, b, smallContext)).toThrow(RangeError);
    expect(cleared.sites[key].garrison).toEqual(dead);
  });

  it("does not consume wall time or global random numbers", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("random"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("time"); });
    try {
      const state = advanceNpcWallet(loaded(), 60, context);
      projectNpc(state, a, context); debitNpcAtArrival(state, a, [1, 1, 1], dead, context);
      expect(random).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
    } finally { random.mockRestore(); clock.mockRestore(); }
  });
});

describe("adopted segment endpoint relocation and precise stated limits", () => {
  it("ordinary trusted operations do not enumerate the site map", () => {
    const original = loaded();
    let enumerations = 0;
    const sites = new Proxy(original.sites, { ownKeys(target) { enumerations += 1; return Reflect.ownKeys(target); } });
    const state = { ...original, sites };
    const next = advanceNpcWallet(state, 0.25, context);
    expect(projectNpc(next, a, context).stock).toEqual([501.25, 250.625, 0.25]);
    expect(enumerations).toBe(0);
    expect(isNpcWalletState(next, context)).toBe(true);
    expect(enumerations).toBe(1);
  });

  it("relocates every account at the real segment end, not at an invented H event", () => {
    let state = materializeNpcAtPaidLaunch(loaded(), large, context);
    state = advanceNpcWallet(state, 11_990, context);
    state = debitNpcAtArrival(state, a, [25_000, 15_000, 5_000], dead, context);
    const otherGarrison = state.sites[coordinateKey(large)].garrison;
    const next = advanceNpcWallet(state, 20, context);
    expect(next.now).toBe(0); expect(next.baseline).toEqual({ stock: NPC_WALLET_CAPS, mark: 0 });
    expect(next.sites[key]).toEqual({ stock: [25_100, 15_050, 5_020], mark: 0, garrison: dead });
    expect(next.sites[coordinateKey(large)]).toEqual({ stock: NPC_WALLET_CAPS, mark: 0, garrison: otherGarrison });
    expect(state.now).toBe(11_990); expect(state.sites[key].mark).toBe(11_990);
    expect(isNpcWalletState(next, context)).toBe(true);
  });

  it.each([12_000, 12_000.1, 28_800, 1e100, Number.MAX_VALUE])("a single adopted segment %s saturates every wallet and preserves losses", seconds => {
    const state = debitNpcAtArrival(loaded([0, 0, 0]), a, [0, 0, 0], dead, context);
    const next = advanceNpcWallet(state, seconds, context);
    expect(next.now).toBe(0); expect(next.baseline.stock).toEqual(NPC_WALLET_CAPS);
    expect(next.sites[key]).toEqual({ stock: NPC_WALLET_CAPS, mark: 0, garrison: dead });
  });

  it("retains the known future eligibility difference caused by fixed relocation", () => {
    const stock: NpcResourceTuple = [0, 0, 1.799999999999636];
    const raw: NpcWalletState = { model: NPC_WALLET_MODEL, now: 11_999.9, baseline: { stock, mark: 11_999.9 }, sites: {} };
    const state = readNpcWalletState(raw, context);
    const first = advanceNpcWallet(state, 0.1, context);
    expect(first.now).toBe(0); expect(projectNpc(first, a, context).stock[2]).toBe(1.8999999999999997);
    const second = advanceNpcWallet(first, 0.1, context), actual = projectNpc(second, a, context).stock;
    expect(actual[2]).toBe(1.9999999999999998); expect(allocateNpcLoot(actual, 100)[2]).toBe(0);
    // Deliberately invalid persisted-clock comparison, retained only as an arithmetic control.
    const counterfactual = stock[2] + ((11_999.9 + 0.1 + 0.1) - 11_999.9);
    expect(counterfactual).toBe(2.0000000000003633); expect(Math.floor(counterfactual / 2)).toBe(1);
  });

  it("preserves identical adopted-segment replay despite extra reads and JSON reloads", () => {
    let untouched = loaded([0, 0, 0]), observed = loaded([0, 0, 0]);
    const steps = [0.1, 1 / 30, 1 / 60, 11_999, 0.9, 0.1, Number.MIN_VALUE, 12_000, 0.1];
    for (let repeat = 0; repeat < 30; repeat += 1) for (const step of steps) {
      untouched = advanceNpcWallet(untouched, step, context);
      observed = readNpcWalletState(clone(advanceNpcWallet(observed, step, context)), context);
      projectNpc(observed, a, context); projectNpc(observed, b, context);
      expect(observed).toEqual(untouched);
    }
    // No claim of equality if these same numbers are regrouped into a different step sequence.
  });

  it("preserves zero and sub-representable-step identity without rounding positive subnormals", () => {
    const state = advanceNpcWallet(createNpcWallet(), 8_192, context);
    expect(advanceNpcWallet(state, 0, context)).toBe(state);
    expect(advanceNpcWallet(state, -0, context)).toBe(state);
    expect(advanceNpcWallet(state, 2 ** -42, context)).toBe(state);
    const tiny = advanceNpcWallet(createNpcWallet(), Number.MIN_VALUE, context);
    expect(tiny.now).toBe(Number.MIN_VALUE); expect(projectNpc(tiny, a, context).stock[2]).toBe(Number.MIN_VALUE);
  });

  it.each([-1, -0.25, NaN, Infinity, -Infinity, "1", undefined, null])("rejects invalid adopted segment %s without normalization", seconds => {
    const state = loaded(), before = JSON.stringify(state);
    expect(() => advanceNpcWallet(state, seconds as number, context)).toThrow(TypeError);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("strict standalone boundary validation, separate from the trusted O(1) engine path", () => {
  it("imports detached frozen data and preserves every Number/mark, including null prototypes", () => {
    const raw = clone(advanceNpcWallet(loaded([3.75, 0.25, Number.MIN_VALUE]), 0.1, context));
    const imported = readNpcWalletState(raw, context);
    expect(imported).toEqual(raw); expect(imported).not.toBe(raw);
    expect(imported.sites[key].stock).not.toBe(raw.sites[key].stock);
    expect(imported.sites[key].garrison).not.toBe(raw.sites[key].garrison);
    expect(imported.sites[key].mark).toBe(0); expect(imported.now).toBe(0.1);
    expect(isNpcWalletState(Object.assign(Object.create(null), raw), context)).toBe(true);
    expect(isNpcWalletState({ ...raw, sites: Object.assign(Object.create(null), raw.sites) }, context)).toBe(true);
    for (const value of [imported, imported.baseline, imported.baseline.stock, imported.sites, imported.sites[key], imported.sites[key].stock, imported.sites[key].garrison]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it.each([0, 60, 0.1, Number.MIN_VALUE, 11_900])("pure fromSnapshot copies actual accepted r12 resource Numbers at %s", age => {
    const old = npcEconomySnapshot({ model: "fixed-production-v1", elapsedSeconds: age });
    const next = npcWalletFromSnapshot(old.resources);
    expect(next).toEqual({ model: NPC_WALLET_MODEL, now: 0,
      baseline: { stock: [old.resources.metal, old.resources.crystal, old.resources.deuterium], mark: 0 }, sites: {} });
    expect(next.baseline.stock[2]).toBe(old.resources.deuterium);
    // No reader, save envelope, wall-time catch-up, or totalTime migration is performed here.
  });

  it.each([undefined, null, [], {}, { metal: 1, crystal: 1 }, { metal: -1, crystal: 1, deuterium: 1 },
    { metal: 1, crystal: Infinity, deuterium: 1 }, { metal: "1", crystal: 1, deuterium: 1 },
    { metal: 1, crystal: 1, deuterium: 1, elapsedSeconds: 0 },
  ].map(value => [value] as const))("refuses malformed migration snapshot resources %j", resources => {
    expect(() => npcWalletFromSnapshot(resources as Parameters<typeof npcWalletFromSnapshot>[0])).toThrow(TypeError);
  });

  const invalidStates: Array<[string, () => unknown]> = [
    ["missing model", () => ({ now: 0, baseline: { stock: [500, 250, 0], mark: 0 }, sites: {} })],
    ["unknown model", () => ({ ...loaded(), model: "fixed-production-v1" })],
    ["extra top field", () => ({ ...loaded(), reports: [] })],
    ["symbol top field", () => ({ ...loaded(), [Symbol("extra")]: 0 })],
    ["inherited state", () => Object.create(loaded())],
    ["hidden expected field", () => Object.defineProperty(clone(loaded()), "now", { enumerable: false })],
    ["negative now", () => ({ ...loaded(), now: -0.1 })],
    ["horizon now", () => ({ ...loaded(), now: 12_000 })],
    ["NaN now", () => ({ ...loaded(), now: NaN })],
    ["infinite now", () => ({ ...loaded(), now: Infinity })],
    ["future baseline mark", () => ({ ...loaded(), baseline: { stock: [1, 1, 1], mark: Number.MIN_VALUE } })],
    ["negative baseline mark", () => ({ ...loaded(), baseline: { stock: [1, 1, 1], mark: -1 } })],
    ["non-number mark", () => ({ ...loaded(), baseline: { stock: [1, 1, 1], mark: "0" } })],
    ["extra baseline field", () => ({ ...loaded(), baseline: { stock: [1, 1, 1], mark: 0, elapsed: 0 } })],
    ["over-cap stock", () => ({ ...loaded(), baseline: { stock: [50_001, 1, 1], mark: 0 } })],
    ["sites array", () => ({ ...loaded(), sites: [] })],
    ["site mark beyond now", () => ({ ...loaded(), sites: { [key]: { ...loaded().sites[key], mark: 1 } } })],
    ["site extra field", () => ({ ...loaded(), sites: { [key]: { ...loaded().sites[key], cleared: false } } })],
    ["missing dead garrison keys", () => ({ ...loaded(), sites: { [key]: { stock: [0, 0, 0], mark: 0, garrison: {} } } })],
    ["over-initial garrison", () => ({ ...loaded(), sites: { [key]: { ...loaded().sites[key], garrison: { light_fighter: 5, heavy_fighter: 0 } } } })],
    ["site symbol", () => ({ ...loaded(), sites: { ...loaded().sites, [Symbol("extra")]: 1 } })],
    ["site custom prototype", () => ({ ...loaded(), sites: Object.assign(Object.create({ extra: 1 }), loaded().sites) })],
  ];
  it.each(invalidStates)("rejects %s at the full boundary, without repairing", (_label, make) => {
    const value = make();
    expect(isNpcWalletState(value, context)).toBe(false);
    expect(() => readNpcWalletState(value, context)).toThrow(TypeError);
  });

  it.each(["01:1:6", "1:01:6", "1:1:06", "1:1:6:0", "1:1:16", "0:1:6", "6:1:6", "1:101:6", "1:1:1", "__proto__", "constructor", "", " 1:1:6", "1:1:6\n"])("rejects noncanonical/non-NPC key %s", badKey => {
    const state = { ...loaded(), sites: { [badKey]: loaded().sites[key] } };
    expect(isNpcWalletState(state, context)).toBe(false);
  });

  it("rejects own player coordinates, the seeded home, and over-limit site sets", () => {
    const ownedContext = createNpcWalletContext(1, 10, [a]);
    expect(isNpcWalletState(loaded(), ownedContext)).toBe(false);
    expect(() => projectNpc(createNpcWallet(), a, ownedContext)).toThrow("not a current NPC");
    expect(() => materializeNpcAtPaidLaunch(createNpcWallet(), homeCoordinates(1), context)).toThrow("not a current NPC");
    const both = materializeNpcAtPaidLaunch(loaded(), b, context);
    expect(isNpcWalletState(both, createNpcWalletContext(1, 1, []))).toBe(false);
  });

  it("rejects accessors at every persisted level without invoking them", () => {
    let reads = 0;
    const getter = { enumerable: true, get() { reads += 1; throw Error("must not run"); } };
    const badTop = Object.defineProperty(clone(loaded()), "baseline", getter);
    const badBaseline = { ...loaded(), baseline: Object.defineProperty({ mark: 0 }, "stock", getter) };
    const badMap = { ...loaded(), sites: Object.defineProperty({}, key, getter) };
    const badSite = { ...loaded(), sites: { [key]: Object.defineProperty({ ...loaded().sites[key] }, "garrison", getter) } };
    const badGarrison = { ...loaded(), sites: { [key]: { ...loaded().sites[key], garrison: Object.defineProperty({ light_fighter: 4 }, "heavy_fighter", getter) } } };
    for (const bad of [badTop, badBaseline, badMap, badSite, badGarrison]) {
      expect(isNpcWalletState(bad, context)).toBe(false); expect(() => readNpcWalletState(bad, context)).toThrow(TypeError);
    }
    expect(reads).toBe(0);
  });

  it("requires full validation before trusting unrelated sites in the O(1) path", () => {
    const invalid = { ...loaded(), sites: { ...loaded().sites, bad: loaded().sites[key] } };
    expect(isNpcWalletState(invalid, context)).toBe(false);
    expect(() => readNpcWalletState(invalid, context)).toThrow(TypeError);
    // These trusted paths intentionally don't scan the unrelated malformed site.
    expect(advanceNpcWallet(invalid, 1, context).now).toBe(1);
    expect(projectNpc(invalid, a, context).stock).toEqual([500, 250, 0]);
    expect(() => advanceNpcWallet(invalid, 12_000, context)).toThrow(TypeError);
    expect(() => materializeNpcAtPaidLaunch(invalid, b, context)).toThrow(TypeError);
  });

  it.each([0, -1, 0.5, NaN, Infinity, 7_501, "10", undefined])("rejects invalid explicit capacity %s", limit => {
    expect(() => createNpcWalletContext(1, limit as number, [])).toThrow(TypeError);
  });

  it("accepts only explicit admitted contexts; input coordinates cannot mutate the resulting context", () => {
    const owned = [{ galaxy: 1, system: 5, position: 5 }];
    const created = createNpcWalletContext(1, 7_500, owned);
    owned[0].position = 6;
    expect(created.playerCoordinates[0].position).toBe(5);
    expect(Object.isFrozen(created)).toBe(true);
    expect(() => createNpcWalletContext(1, 10, [a, a])).toThrow(TypeError);
    expect(() => createNpcWalletContext(1, 10, [{ ...a, position: 16 }])).toThrow(TypeError);
    expect(() => createNpcWalletContext(1, 10, new Array(2))).toThrow(TypeError);
    expect(() => projectNpc(createNpcWallet(), a, { seed: 1, siteLimit: 10, playerCoordinates: [] } as NpcWalletContext)).toThrow(TypeError);
  });

  it("rejects invalid arrival candidates atomically: missing site, over-half/fractional loot and revival", () => {
    const empty = createNpcWallet();
    expect(() => debitNpcAtArrival(empty, a, [0, 0, 0], dead, context)).toThrow("materialized");
    const state = loaded([10, 10, 10]), before = JSON.stringify(state);
    for (const loot of [[6, 0, 0], [0, 0.5, 0], [-1, 0, 0], [NaN, 0, 0], [0, Infinity, 0]]) {
      expect(() => debitNpcAtArrival(state, a, loot as unknown as NpcResourceTuple, dead, context)).toThrow(TypeError);
    }
    expect(() => debitNpcAtArrival(state, a, [1, 1, 1], { light_fighter: 5, heavy_fighter: 0 }, context)).toThrow(TypeError);
    const reduced = debitNpcAtArrival(state, a, [0, 0, 0], dead, context);
    expect(() => debitNpcAtArrival(reduced, a, [1, 1, 1], initialNpcGarrison(1, a), context)).toThrow(TypeError);
    expect(JSON.stringify(state)).toBe(before);
    expect(() => debitNpcAtArrival(state, a, [1, 1, 1], {} as NpcGarrison, context)).toThrow(TypeError);
  });

  it("rejects strict coordinate and snapshot getters without evaluating them", () => {
    let reads = 0;
    const getter = { enumerable: true, get() { reads += 1; return 1; } };
    const coordinate = Object.defineProperty({ ...a }, "galaxy", getter);
    const resource = Object.defineProperty({ crystal: 1, deuterium: 1 }, "metal", getter);
    expect(() => projectNpc(loaded(), coordinate as Coordinates, context)).toThrow(TypeError);
    expect(() => npcWalletFromSnapshot(resource as Parameters<typeof npcWalletFromSnapshot>[0])).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
