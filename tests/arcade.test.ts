import { storedRunLimit } from "../src/game/deep-state";
import { activePlanet, withPlanet } from "../src/game/empire";
import { describe, expect, it } from "vitest";
import { ARCADE, ARCADE_SYMBOL_DEFS, BOARD, EMPTY_SYMBOLS, GOOD_SYMBOLS, LUCKY_EXCLUDED } from "../src/data/arcade";
import {
  SYMBOL_CHANCE,
  TILE_WEIGHTS,
  betOdds,
  betUnitDeut,
  createArcade,
  grantRun,
  prizeCap,
  productionMe,
  revealAll,
  revealRun,
  rollOutcome,
  setBet,
  topUp,
  topUpPrice,
  drifterPool,
  drifterShips,
  shipValueMe,
  type PendingRun,
} from "../src/game/arcade";
import { equipCard, patchSlot, protocolSentence } from "../src/automation/engine";
import { catchUp } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { tick } from "../src/game/logic";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { stateWith, withResearch } from "./helpers";

/** Astrophysics 1 with its achievement already counted (no bonus run), fixed seed. */
function opened(seed = 12345, extra: Partial<Record<string, number>> = {}): GameState {
  const base = withResearch(
    stateWith({ metal_mine: 15, crystal_mine: 12, deuterium_synth: 10, solar_plant: 18, metal_storage: 8, crystal_storage: 8, deuterium_tank: 8, ...extra }, { metal: 1000, crystal: 1000, deuterium: 200000 }),
    { astrophysics: 1 },
  );
  return { ...base, unlocked: [...base.unlocked, "astrophysics_1"], arcade: createArcade(seed) };
}

function withRun(state: GameState, tile: number, big = false, u = 0.5, v = 0.5): GameState {
  const run: PendingRun = { id: state.arcade.nextRunId, source: "beacon", outcome: { main: { tile, big, u, v }, lucky: null, forced: null } };
  return { ...state, arcade: { ...state.arcade, nextRunId: state.arcade.nextRunId + 1, runs: [...state.arcade.runs, run] } };
}

const tileOf = (symbol: string) => BOARD.indexOf(symbol as (typeof BOARD)[number]);

describe("board and public odds (beacon run, P2)", () => {
  it("24 tiles, tile counts match the table, same symbols never touch", () => {
    expect(BOARD).toHaveLength(24);
    for (const def of ARCADE_SYMBOL_DEFS) expect(BOARD.filter((s) => s === def.id)).toHaveLength(def.tiles);
    BOARD.forEach((symbol, i) => expect(BOARD[(i + 1) % 24]).not.toBe(symbol));
  });

  it("closed tiles move their weight per the doc and the table sums to 100%", () => {
    const sum = Object.values(SYMBOL_CHANCE).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(SYMBOL_CHANCE.metal).toBeCloseTo(0.19, 12); // 16% + merchant 3% until P4 (P3 moved 10% to drifters)
    expect(SYMBOL_CHANCE.empty).toBeCloseTo(0.27, 12);
    expect(SYMBOL_CHANCE.drifter).toBeCloseTo(0.1, 12);
    expect(SYMBOL_CHANCE.blackhole).toBe(0);
    expect(TILE_WEIGHTS[tileOf("pirate")]).toBe(0);
    expect(TILE_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(betOdds("metal")).toBeCloseTo(0.9 / 0.19, 12);
    expect(betOdds("drifter").toFixed(1)).toBe("9.0");
    expect(betOdds("deuterium").toFixed(1)).toBe("15.0");
  });

  it("raw rolls follow the table (200k draws, pity reset each time)", () => {
    let arcade = createArcade(7);
    const counts = new Map<string, number>();
    const n = 200_000;
    for (let i = 0; i < n; i += 1) {
      const rolled = rollOutcome({ ...arcade, rollPity: { empty: 0, jackpot: 0 } });
      arcade = rolled.arcade;
      const symbol = BOARD[rolled.outcome.main.tile]!;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    for (const [symbol, chance] of Object.entries(SYMBOL_CHANCE)) {
      expect(Math.abs((counts.get(symbol) ?? 0) / n - chance)).toBeLessThan(0.005);
    }
  });
});

describe("pre-rolled runs and pity", () => {
  it("the same seed gives the same runs; a save/load cannot re-roll", () => {
    const a = grantRun(opened(99), "beacon").state;
    const b = grantRun(opened(99), "beacon").state;
    expect(a.arcade.runs).toEqual(b.arcade.runs);
    const restored = deserializeState(importSave(exportSave(a, 1)).state);
    expect(restored.arcade.runs).toEqual(a.arcade.runs);
    expect(restored.arcade.seed).toBe(a.arcade.seed);
    expect(revealRun(restored, "manual").result).toEqual(revealRun(a, "manual").result);
  });

  it("never more than 5 empty lights in a row and a JACKPOT at least every 50 runs", () => {
    let arcade = createArcade(2024);
    let empties = 0;
    let sinceJackpot = 0;
    for (let i = 0; i < 5000; i += 1) {
      const rolled = rollOutcome(arcade);
      arcade = rolled.arcade;
      const symbol = BOARD[rolled.outcome.main.tile]!;
      empties = EMPTY_SYMBOLS.includes(symbol) ? empties + 1 : 0;
      sinceJackpot = symbol === "jackpot" ? 0 : sinceJackpot + 1;
      expect(empties).toBeLessThanOrEqual(ARCADE.emptyPity);
      expect(sinceJackpot).toBeLessThan(ARCADE.jackpotPity);
      if (rolled.outcome.forced === "empty") expect(GOOD_SYMBOLS).toContain(symbol);
    }
  });

  it("LUCKY extra lights skip LUCKY / JACKPOT / closed tiles; trains run 3–6 consecutive tiles", () => {
    let arcade = createArcade(5);
    let seen = 0;
    for (let i = 0; i < 20000 && seen < 200; i += 1) {
      const rolled = rollOutcome({ ...arcade, rollPity: { empty: 0, jackpot: 0 } });
      arcade = rolled.arcade;
      const lucky = rolled.outcome.lucky;
      if (!lucky) continue;
      seen += 1;
      if (lucky.kind === "two" || lucky.kind === "three") {
        expect(lucky.lights).toHaveLength(lucky.kind === "two" ? 2 : 3);
        for (const light of lucky.lights) {
          expect(LUCKY_EXCLUDED).not.toContain(BOARD[light.tile]);
          expect(TILE_WEIGHTS[light.tile]).toBeGreaterThan(0);
        }
      }
      if (lucky.kind === "train") {
        expect(lucky.lights.length).toBeGreaterThanOrEqual(3);
        expect(lucky.lights.length).toBeLessThanOrEqual(6);
        lucky.lights.forEach((light, k) => expect(light.tile).toBe((rolled.outcome.main.tile + k + 1) % 24));
      }
      if (lucky.kind === "small_three" || lucky.kind === "big_three") {
        expect(lucky.lights.map((l) => BOARD[l.tile])).toEqual(["metal", "crystal", "deuterium"]);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});

describe("beacons", () => {
  it("stay locked before Astrophysics 1", () => {
    const state = tick(stateWith({ metal_mine: 5 }), 4000);
    expect(state.arcade.runs).toHaveLength(0);
  });

  it("Astrophysics 1 brings a bonus run (at least big), then one beacon per 30 min of game time, up to 3", () => {
    const fresh = withResearch(stateWith({ metal_mine: 5 }), { astrophysics: 1 });
    const first = tick(fresh, 1);
    expect(first.arcade.runs).toHaveLength(1);
    expect(first.arcade.runs[0]!.source).toBe("bonus");
    expect(first.arcade.runs[0]!.outcome.main.big).toBe(true);
    const later = tick(opened(), 1800);
    expect(later.arcade.runs.map((run) => run.source)).toEqual(["beacon"]);
    const full = tick(opened(), 1800 * 5);
    expect(full.arcade.runs).toHaveLength(ARCADE.beaconMax);
    expect(full.arcade.beaconProgress).toBe(0);
  });

  it("one long tick and many short ticks grant the same pre-rolled runs (offline equivalence)", () => {
    const long = tick(opened(77), 4000, "offline");
    let short = opened(77);
    for (let i = 0; i < 400; i += 1) short = tick(short, 10);
    expect(short.arcade.runs).toEqual(long.arcade.runs);
    expect(short.arcade.beaconProgress).toBeCloseTo(long.arcade.beaconProgress, 6);
  });

  it("turbulence lengthens the current beacon cooldown by 50%; tailwind returns half of it", () => {
    const turbulent = revealRun(withRun(opened(), tileOf("turbulence")), "manual").state;
    expect(turbulent.arcade.beaconRequired).toBe(2700);
    const base = { ...opened(), arcade: { ...opened().arcade, beaconProgress: 1000 } };
    const tail = revealRun(withRun(base, tileOf("tailwind")), "manual").state;
    expect(tail.arcade.runs).toHaveLength(1); // 1000 + 900 ≥ 1800 → one beacon at once
    expect(tail.arcade.runs[0]!.source).toBe("beacon");
  });
});

describe("prizes", () => {
  it("resources: cap × tier, at most 10 minutes of empire production (metal equivalent)", () => {
    const state = withRun(opened(), tileOf("crystal"), false, 0.5);
    const cap = prizeCap(state);
    const window = productionMe(state) * 600;
    const expected = Math.floor(Math.min(cap * 0.35, window) / 2);
    const after = revealRun(state, "manual").state;
    expect(activePlanet(after).resources.crystal.sub(activePlanet(state).resources.crystal).toNumber()).toBe(expected);
    expect(cap).toBe(40000 * 5);
  });

  it("dark matter tiles give 300–400 (big 500–700); JACKPOT adds 1,000–1,800", () => {
    const low = revealRun(withRun(opened(), tileOf("dark_matter"), false, 0), "manual").state;
    expect(low.darkMatter.toNumber()).toBe(300);
    const highBig = revealRun(withRun(opened(), tileOf("dark_matter"), true, 1), "manual").state;
    expect(highBig.darkMatter.toNumber()).toBe(700);
    const jackpot = revealRun(withRun(opened(), tileOf("jackpot"), false, 0.5, 0), "manual");
    expect(jackpot.state.darkMatter.toNumber()).toBe(1000);
    expect(activePlanet(jackpot.state).resources.metal.gt(activePlanet(opened()).resources.metal)).toBe(true);
    expect(jackpot.state.arcade.stats.darkMatter).toBe(1000);
  });

  it("supply box puts an item in the inventory; big gives two", () => {
    const after = revealRun(withRun(opened(), tileOf("supply"), true, 0), "manual").state;
    expect(after.items.kraken_box).toBe(2);
  });

  it("empty space and history: last 50 kept, stats count hits", () => {
    let state = opened();
    for (let i = 0; i < 55; i += 1) state = revealRun(withRun(state, tileOf("empty")), "manual").state;
    expect(state.arcade.history).toHaveLength(50);
    expect(state.arcade.stats.hits.empty).toBe(55);
    expect(state.arcade.pity.empty).toBe(55);
    expect(state.arcade.stats.manualRuns).toBe(55);
  });
});

describe("drifting ships (P3)", () => {
  it("only unlocked ladder ships plus one tier above, never the deathstar", () => {
    expect(drifterPool(opened())).toEqual(["light_fighter"]);
    const yard = withResearch(opened(12345, { shipyard: 2, robotics_factory: 2 }), { combustion_drive: 2 });
    expect(drifterPool(yard)).toEqual(["light_fighter", "small_cargo", "heavy_fighter"]);
    const all = withResearch(opened(12345, { shipyard: 12 }), {
      combustion_drive: 6, impulse_drive: 6, hyperspace_drive: 7, hyperspace_tech: 6, armour_tech: 2, ion_tech: 2,
      shielding_tech: 2, laser_tech: 12, plasma_tech: 5, graviton_tech: 1,
    });
    expect(drifterPool(all)).not.toContain("deathstar");
    expect(drifterPool(all)).toContain("destroyer");
  });

  it("splits the value into ships; the rest comes as metal", () => {
    const yard = withResearch(opened(12345, { shipyard: 2, robotics_factory: 2 }), { combustion_drive: 2 });
    const split = drifterShips(yard, 100_000, 0.99);
    const value = split.ships.reduce((sum, s) => sum + s.count * shipValueMe(s.id), 0);
    expect(value + split.leftoverMe).toBeCloseTo(100_000, 6);
    expect(split.leftoverMe).toBeLessThan(shipValueMe("light_fighter"));
    expect(split.ships[0]?.id).toBe("heavy_fighter");
  });

  it("a drifter tile pays half the resource prize in ships", () => {
    const state = withRun(opened(), tileOf("drifter"), false, 0.5, 0);
    const cap = prizeCap(state);
    const valueMe = Math.min(cap * 0.35, productionMe(state) * 600) / 2;
    const after = revealRun(state, "manual");
    const ships = activePlanet(after.state).units.light_fighter;
    expect(ships).toBe(Math.floor(valueMe / 5000));
    expect(after.result!.lines.join("")).toContain("轻型战斗机");
    expect(after.state.arcade.stats.hits.drifter).toBe(1);
  });

  it("a drifter bet pays ships of the same value", () => {
    const state = setBet(opened(), "drifter", 3).state;
    const unit = betUnitDeut(state);
    const hit = revealRun(withRun(state, tileOf("empty")), "manual").state;
    expect(activePlanet(hit).units.light_fighter).toBe(0);
    const win = revealRun(withRun(state, tileOf("drifter"), false, 0, 0), "manual").state;
    const prize = Math.min(prizeCap(state) * 0.2, productionMe(state) * 600) / 2;
    const expected = Math.floor(prize / 5000) + Math.floor((3 * unit * 3 * betOdds("drifter")) / 5000);
    expect(Math.abs(activePlanet(win).units.light_fighter - expected)).toBeLessThanOrEqual(1);
  });

  it("the supply box can hold DETROIT", () => {
    const after = revealRun(withRun(opened(), tileOf("supply"), false, 0.5), "manual").state;
    expect(after.items.detroit_box).toBe(1);
  });
});

describe("bets and top-up", () => {
  it("a winning bet pays units × unit × 3 × odds in that resource; a miss loses the deuterium", () => {
    let state = setBet(opened(), "metal", 2).state;
    const unit = betUnitDeut(state);
    const hit = revealRun(withRun(state, tileOf("metal"), false, 0), "manual").state;
    const cap = prizeCap(state);
    const prize = Math.floor(Math.min(cap * 0.2, productionMe(state) * 600));
    const win = Math.floor(2 * unit * 3 * betOdds("metal"));
    const metalGain = activePlanet(hit).resources.metal.sub(activePlanet(state).resources.metal).toNumber();
    expect(metalGain).toBeGreaterThanOrEqual(prize + win - 2);
    expect(metalGain).toBeLessThanOrEqual(prize + win + 2);
    expect(activePlanet(state).resources.deuterium.sub(activePlanet(hit).resources.deuterium).toNumber()).toBeGreaterThanOrEqual(2 * unit - 1);
    const miss = revealRun(withRun(state, tileOf("empty")), "manual").state;
    expect(activePlanet(miss).resources.metal.eq(activePlanet(state).resources.metal)).toBe(true);
    expect(activePlanet(state).resources.deuterium.sub(activePlanet(miss).resources.deuterium).toNumber()).toBe(2 * unit);
    state = { ...withPlanet(state, { resources: { ...activePlanet(state).resources, deuterium: big(0) } }) };
    const broke = revealRun(withRun(state, tileOf("metal")), "manual");
    expect(broke.result!.lines[0]).toContain("本次未押注");
  });

  it("total bet is capped at 1 hour of deuterium (12 units)", () => {
    let state = setBet(opened(), "metal", 10).state;
    state = setBet(state, "crystal", 5).state;
    expect(state.arcade.bets.crystal).toBe(2);
  });

  it("top-up price doubles within 24 h of game time and the store obeys 3 + expedition slots + 2", () => {
    let state = { ...withPlanet(opened(), { resources: { ...activePlanet(opened()).resources, deuterium: big(1e9) } }) };
    const p0 = topUpPrice(state);
    state = topUp(state).state;
    expect(topUpPrice(state)).toBe(p0 * 2);
    for (let i = 1; i < storedRunLimit(state); i += 1) state = topUp(state).state;
    expect(state.arcade.runs).toHaveLength(storedRunLimit(state));
    expect(topUp(state).ok).toBe(false);
    const all = revealAll(state, "manual");
    expect(all.results).toHaveLength(storedRunLimit(state));
    expect(all.state.arcade.runs).toHaveLength(0);
  });
});

describe("auto runner protocol", () => {
  it("unlocks after 10 manual runs but equipping alone never opens future runs, offline included", () => {
    let state = opened();
    for (let i = 0; i < 10; i += 1) state = revealRun(withRun(state, tileOf("empty")), "manual").state;
    state = tick(state, 0.01);
    expect(state.unlockedCards).toContain("auto_runner");
    state = equipCard(state, 0, "auto_runner").state;
    const away = catchUp(state, 3 * 3600);
    expect(state.protocols.slots[0]!.card!.enabled).toBe(false);
    expect(away.arcadeRuns).toHaveLength(0);
    expect(away.state.arcade.runs).toHaveLength(ARCADE.beaconMax);
    expect(away.state.arcade.stats.autoRuns).toBe(0);
  });

  it("conditions still switch between runs and pity, while automatic bet edits are unavailable", () => {
    let state = opened();
    for (let i = 0; i < 10; i += 1) state = revealRun(withRun(state, tileOf("metal")), "manual").state;
    state = equipCard(tick(state, 0.01), 0, "auto_runner").state;
    expect(protocolSentence(state.protocols.slots[0]!.card!)).toBe("当星环机有开奖次数，若开奖次数 ≥ 1，则按已授权快照开奖 1 次。");
    state = patchSlot(state, 0, "condition.0.kind", "pityGte");
    state = patchSlot(state, 0, "condition.0.pity", "jackpot");
    state = patchSlot(state, 0, "condition.0.value", "45");
    state = patchSlot(state, 0, "action.kind", "setBet");
    state = patchSlot(state, 0, "action.units", "3");
    expect(protocolSentence(state.protocols.slots[0]!.card!)).toBe("当星环机有开奖次数，若大奖保底计数 ≥ 45，则按已授权快照开奖 1 次。");
    state = { ...state, arcade: { ...state.arcade, pity: { empty: 0, jackpot: 46 } } };
    state = tick(withRun(state, tileOf("empty")), 1.5);
    expect(state.arcade.bets.metal).toBe(0);
  });
});

describe("save", () => {
  it("round-trips the machine; current r4 requires safety state and rejects bad tiles", () => {
    let state = grantRun(setBet(opened(), "crystal", 3).state, "topup").state;
    state = revealRun(withRun(state, tileOf("metal")), "manual").state;
    const restored = deserializeState(importSave(exportSave(state, 1)).state);
    expect(serializeState(restored).arcade).toEqual(serializeState(state).arcade);
    const file = JSON.parse(exportSave(state, 1));
    delete file.state.arcade;
    expect(() => importSave(JSON.stringify(file))).toThrow();
    const bad = JSON.parse(exportSave(state, 1));
    bad.state.arcade.runs[0].outcome.main.tile = 40;
    expect(() => importSave(JSON.stringify(bad))).toThrow();
  });
});
