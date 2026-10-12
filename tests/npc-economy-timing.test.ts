import { describe, expect, it, vi } from "vitest";
import { AccountedClock } from "../src/core/accounted-clock";
import { catchUp, emptyCatchup } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { homeCoordinates, npcAt } from "../src/game/galaxy";
import { evaluatePrestige, expansionScore, prestige, tick } from "../src/game/logic";
import { createNpcWalletContext, projectNpc, type NpcWalletState } from "../src/game/npc-wallet";
import { expectedFreshNpcWallet as at, expectedFullNpcWallet } from "./npc-wallet-expectations";
import { createPlanet } from "../src/game/planet";
import { deserializeState, serializeState } from "../src/game/save";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

const resources = ["metal", "crystal", "deuterium"] as const;
// Frozen before execution. These bounds cover native-number accumulation, not displayed rounding.
const AGE_TOLERANCE_SECONDS = 1e-9;
const STOCK_TOLERANCE_UNITS = 1e-8;
function initial(): GameState { return createInitialState(20_261_010, 123_456); }
// Query the actual production projection at one independently verified NPC coordinate.
const snapshotContext = createNpcWalletContext(20_261_010, 512, [homeCoordinates(20_261_010)]);
function walletSnapshot(wallet: NpcWalletState) {
  const { stock } = projectNpc(wallet, { galaxy: 1, system: 56, position: 6 }, snapshotContext);
  return { resources: { metal: stock[0], crystal: stock[1], deuterium: stock[2] },
    full: { metal: stock[0] === 50000, crystal: stock[1] === 30000, deuterium: stock[2] === 10000 } };
}
function oldFields(state: GameState): unknown {
  const { npcEconomy: _npcEconomy, ...old } = serializeState(state);
  return old;
}
function reload(state: GameState): GameState {
  const loaded = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  expect(loaded).not.toBeNull();
  return loaded!;
}
function expectAgeAndStock(state: GameState, age: number, stock: [number, number, number]): void {
  expect(Math.abs(state.npcEconomy.now - age)).toBeLessThanOrEqual(AGE_TOLERANCE_SECONDS);
  const snapshot = walletSnapshot(state.npcEconomy);
  resources.forEach((id, index) => expect(Math.abs(snapshot.resources[id] - stock[index]!)).toBeLessThanOrEqual(STOCK_TOLERANCE_UNITS));
}

describe("NPC local wallet time on adopted global simulation segments", () => {
  it("starts a complete new game at zero and never derives age from historical player time", () => {
    const state = initial();
    expect(state.npcEconomy).toEqual(at(0));
    state.totalTime = big("1e190");
    const next = tick(state, 0.25);
    expect(next.totalTime.toString()).toBe("1e+190");
    expect(next.npcEconomy).toEqual(at(0.25));
    expect(walletSnapshot(next.npcEconomy).resources).toEqual({ metal: 501.25, crystal: 250.625, deuterium: 0.25 });
    expect(createInitialState(state.universe.seed, state.arcade.seed).npcEconomy).toEqual(at(0));
    expect(state.npcEconomy).toEqual(at(0));
  });

  it("advances exactly once per global segment rather than once per player planet", () => {
    const one = initial();
    const colony = createPlanet("colony", { galaxy: 2, system: 20, position: 5 });
    const two = { ...one, planets: [...one.planets, colony], activePlanetId: colony.id };
    const single = tick(one, 60), multiple = tick(two, 60);
    expect(single.npcEconomy).toEqual(at(60));
    expect(multiple.npcEconomy).toEqual(at(60));
    expect(walletSnapshot(multiple.npcEconomy).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
    expect(multiple.activePlanetId).toBe(colony.id);
    expect(tick(selectPlanet(two, one.activePlanetId), 60).npcEconomy).toEqual(at(60));
  });

  it("keeps quarter-second partitions and a real serialization interruption exactly equal", () => {
    const state = initial();
    let partitioned = state;
    for (let index = 0; index < 240; index++) {
      partitioned = tick(partitioned, 0.25);
      if (index === 119) partitioned = reload(partitioned);
    }
    const whole = tick(state, 60);
    expect(partitioned.npcEconomy).toEqual(at(60));
    expect(partitioned.npcEconomy).toEqual(whole.npcEconomy);
    expect(walletSnapshot(partitioned.npcEconomy).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
    expect(reload(partitioned).npcEconomy).toEqual(partitioned.npcEconomy);
  });

  for (const hz of [30, 60, 120, 240]) it(`keeps modeled ${hz} Hz RAF clock gaps within fixed age/resource tolerances`, () => {
    // This is deterministic clock simulation, not native-browser RAF evidence.
    const clock = new AccountedClock({ wallAt: 1_800_000_000_000, frameAt: 12.5 });
    let state = initial();
    for (let frame = 1; frame <= 20 * hz; frame++) {
      const frameAt = 12.5 + frame * 1000 / hz;
      state = tick(state, clock.gapSeconds(frameAt));
      clock.account(frameAt);
    }
    expectAgeAndStock(state, 20, [600, 300, 20]);
    const whole = tick(initial(), 20);
    expect(Math.abs(state.npcEconomy.now - whole.npcEconomy.now)).toBeLessThanOrEqual(AGE_TOLERANCE_SECONDS);
    // Persistence preserves the actual accumulated float rather than rounding it to the target.
    expect(reload(state).npcEconomy.now).toBe(state.npcEconomy.now);
    expect(clock.lastTickAt).toBe(1_800_000_020_000);
  });

  it("bounds ordinary decimal tick partitions without asserting exact whole-save equality", () => {
    let state = initial();
    for (let index = 0; index < 1_000; index++) state = tick(state, 0.1);
    expectAgeAndStock(state, 100, [1_000, 500, 100]);
    expect(reload(state).npcEconomy).toEqual(state.npcEconomy);
  });

  it("uses only positive adopted steps, preserving fractional age through zero-time engine boundaries", () => {
    const state = initial();
    state.npcEconomy = at(60.25);
    state.protocols.accumulator = 1; // A due protocol pass makes the first engine segment zero.
    const next = tick(state, 0.25);
    expect(next.npcEconomy).toEqual(at(60.5));
    expect(next.totalTime.toNumber()).toBe(0.25);
    expect(state.npcEconomy).toEqual(at(60.25));
    for (const seconds of [0, -0, -1, NaN, Infinity, -Infinity]) {
      expect(tick(state, seconds).npcEconomy).toBe(state.npcEconomy);
    }
    // The existing engine does not adopt sub-EPS requests; no separate NPC clock may do so.
    expect(tick(state, 5e-10).npcEconomy).toBe(state.npcEconomy);
    expect(tick(state, 2 ** -20).npcEconomy.now).toBe(60.25 + 2 ** -20);
  });

  it("keeps cap boundaries exact without inventing an epsilon-aged snapshot", () => {
    const state = initial();
    state.npcEconomy = at(9_899.75);
    const near = tick(state, 0.25 - 5e-10);
    expect(near.npcEconomy.now).toBe(9_899.75 + (0.25 - 5e-10));
    expect(near.npcEconomy.now).toBeLessThan(9_900);
    expect(walletSnapshot(near.npcEconomy).full.metal).toBe(false);
    for (const [start, expected, full] of [
      [9_899.75, 9_900, { metal: true, crystal: false, deuterium: false }],
      [9_999.75, 10_000, { metal: true, crystal: false, deuterium: true }],
      [11_899.75, 11_900, { metal: true, crystal: true, deuterium: true }],
    ] as const) {
      const next = tick({ ...state, npcEconomy: at(start) }, 0.25);
      expect(next.npcEconomy.now).toBe(expected);
      expect(walletSnapshot(next.npcEconomy).full).toEqual(full);
    }
  });
});

describe("NPC adopted offline time and same-universe reset", () => {
  it("uses only the basic adopted 7200-second cap, independent of a 100000-second raw absence", () => {
    const result = catchUp(initial(), 100_000);
    expect(result.appliedSeconds).toBe(7_200);
    expect(result.capped).toBe(true);
    expect(result.state.totalTime.toNumber()).toBe(7_200);
    expect(result.state.npcEconomy).toEqual(at(7_200));
    expect(walletSnapshot(result.state.npcEconomy).resources).toEqual({ metal: 36_500, crystal: 18_250, deuterium: 7_200 });
  });

  it("relocates the bounded NPC clock twice while a legal eight-hour offline interval keeps full inventory", () => {
    const state = initial();
    state.offlineBonusHours = 6;
    const result = catchUp(state, 100_000);
    expect(result.appliedSeconds).toBe(28_800);
    expect(result.state.totalTime.toNumber()).toBe(28_800);
    expect(result.state.npcEconomy).toEqual(expectedFullNpcWallet(4_800));
    expect(walletSnapshot(result.state.npcEconomy).resources).toEqual({ metal: 50_000, crystal: 30_000, deuterium: 10_000 });
    const later = tick(result.state, 60);
    expect(later.npcEconomy).toEqual(expectedFullNpcWallet(4_860));
    expect(walletSnapshot(later.npcEconomy)).toEqual(walletSnapshot(result.state.npcEconomy));
    expect(later.totalTime.toNumber()).toBe(28_860);
  });

  it("consumes the full raw clock interval once and leaves unadopted candidates and reads inert", () => {
    // Controlled clock adoption test; SaveSession/native storage evidence is separate.
    const start = initial(), clock = new AccountedClock({ wallAt: 1_000_000, frameAt: 250 });
    const frameAt = 250 + 100_000 * 1000;
    expect(clock.gapSeconds(frameAt)).toBe(100_000);
    const candidate = catchUp(start, clock.gapSeconds(frameAt));
    expect(start.npcEconomy).toEqual(at(0));
    expect(clock.gapSeconds(frameAt)).toBe(100_000); // Failed/unadopted work consumes no clock.
    const adopted = candidate.state;
    clock.account(frameAt);
    expect(clock.gapSeconds(frameAt)).toBe(0);
    expect(catchUp(adopted, clock.gapSeconds(frameAt)).state.npcEconomy).toBe(adopted.npcEconomy);
    expect(emptyCatchup(adopted).state.npcEconomy).toBe(adopted.npcEconomy);
    expect(tick(adopted, clock.gapSeconds(frameAt + 250)).npcEconomy).toEqual(at(7_200.25));
    for (const seconds of [-1, NaN, Infinity, -Infinity]) {
      expect(catchUp(adopted, seconds).state.npcEconomy).toBe(adopted.npcEconomy);
    }
  });

  it("preserves NPC state through real eligible curvature and leaves preview and ineligible launch pure", () => {
    const state = initial();
    state.npcEconomy = at(60.25);
    expect(evaluatePrestige(state).next).toBe(state);
    state.lifetime.metal = big(1e8);
    state.totalTime = big(123.5);
    state.messages = [{ id: "historical-scout", at: 60.25, text: "Existing fixed historical snapshot", npcScoutSnapshot: null }];
    const before = serializeState(state), preview = evaluatePrestige(state);
    expect(preview.gain.gt(0)).toBe(true);
    expect(serializeState(state)).toEqual(before);
    const launched = prestige(state);
    expect(launched.stats.launches).toBe(state.stats.launches + 1);
    expect(launched.npcEconomy).toBe(state.npcEconomy);
    expect(launched.universe).toEqual(state.universe);
    expect(launched.messages).toEqual(state.messages);
    expect(launched.totalTime.eq(state.totalTime)).toBe(true);
    expect(walletSnapshot(launched.npcEconomy).resources).toEqual({ metal: 801.25, crystal: 400.625, deuterium: 60.25 });
    expect(reload(launched).npcEconomy).toEqual(state.npcEconomy);
    expect(tick(launched, 0.25).npcEconomy).toEqual(at(60.5));
    expect(initial().npcEconomy).toEqual(at(0));
    expect(initial().messages).toEqual([]);
  });
});

describe("NPC isolation from player economy and random state", () => {
  it("gives identical old-field outcomes for young and full NPC stores and never credits their production", () => {
    const state = initial();
    const young = tick(state, 60), full = tick({ ...state, npcEconomy: at(11_900) }, 60);
    expect(oldFields(young)).toEqual(oldFields(full));
    expect(activePlanet(young).resources.metal.toNumber()).toBe(800);
    expect(activePlanet(young).resources.crystal.toNumber()).toBe(650);
    expect(activePlanet(young).resources.deuterium.toNumber()).toBe(0);
    expect(resources.map(id => young.lifetime[id].toNumber())).toEqual([300, 150, 0]);
    expect(walletSnapshot(young.npcEconomy).resources.deuterium).toBe(60);
    expect(expansionScore(young).toString()).toBe(expansionScore(full).toString());
    expect(young.arcade).toEqual(full.arcade);
    expect(young.deepSpace).toEqual(full.deepSpace);
    expect(state.npcEconomy).toEqual(at(0));
  });

  it("keeps stock independent of player mines, research, curvature, boosters, selection and production sliders", () => {
    const base = initial();
    base.npcEconomy = at(60);
    const enhanced = initial();
    enhanced.npcEconomy = at(60);
    const home = activePlanet(enhanced);
    home.buildings.metal_mine = 20;
    home.buildings.deuterium_synth = 20;
    home.buildings.solar_plant = 20;
    home.productionPct.metal_mine = 0;
    enhanced.research.levels.plasma_tech = 5;
    enhanced.curvature.output_double = 1;
    enhanced.warpCores = big(100);
    enhanced.boosters = [{ res: "crystal", pct: 30, until: 10_000 }];
    const colony = createPlanet("colony", { galaxy: 2, system: 20, position: 1 });
    enhanced.planets.push(colony);
    enhanced.activePlanetId = colony.id;
    expect(walletSnapshot(tick(enhanced, 60).npcEconomy)).toEqual(walletSnapshot(tick(base, 60).npcEconomy));
    expect(walletSnapshot(enhanced.npcEconomy).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
  });

  it("repeated observations preserve the full save, use no wall clock/RNG, and keep original occupancy identities", () => {
    const state = initial();
    state.npcEconomy = at(60);
    const before = JSON.stringify(serializeState(state));
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("unexpected wall clock read"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("unexpected random read"); });
    try {
      expect(homeCoordinates(state.universe.seed)).toEqual({ galaxy: 1, system: 56, position: 11 });
      for (let index = 0; index < 1_000; index++) {
        const position = index % 2 === 0 ? 6 : 15;
        expect(npcAt(state, { galaxy: 1, system: 56, position })?.id).toBe(`npc-1:56:${position}`);
        expect(walletSnapshot(state.npcEconomy).resources).toEqual({ metal: 800, crystal: 400, deuterium: 60 });
      }
      let count = 0;
      for (let galaxy = 1; galaxy <= 5; galaxy++) for (let system = 1; system <= 100; system++) for (let position = 1; position <= 15; position++) {
        if (npcAt(state, { galaxy, system, position })) count++;
      }
      // Independent existing-coordinate-hash golden from the reviewed design; never a density quota.
      expect(count).toBe(1_891);
      expect(JSON.stringify(serializeState(state))).toBe(before);
      expect(clock).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); random.mockRestore(); }
  });
});
