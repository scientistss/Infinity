import { activePlanet } from "../src/game/empire";
import { describe, expect, it } from "vitest";
import { DM_ACHIEVEMENT_REWARD } from "../src/data/dark-matter";
import {
  addInventory,
  applyBooster,
  buyPackage,
  buyShopItem,
  dailyProduction,
  packageQuote,
  speedUp,
  speedupQuote,
  useInventory,
} from "../src/game/dark-matter";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { applyAchievementUnlocks, prestige, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import { rich, stateWith } from "./helpers";

const withDm = (state: GameState, dm: number): GameState => ({ ...state, darkMatter: big(dm) });
/** One OGame hour on the dark-matter clock (one game minute). */
const OG_HOUR = 60;

describe("halve / finish prices (OGame 750 DM per half hour, 1 OGame hour = 1 game minute)", () => {
  it("prices by OGame hours taken off, min 750", () => {
    expect(speedupQuote(OG_HOUR, "build", "finish").dm).toBe(1500);
    expect(speedupQuote(OG_HOUR, "build", "halve").dm).toBe(750);
    expect(speedupQuote(1, "build", "finish").dm).toBe(750);
    expect(speedupQuote(OG_HOUR * 3, "research", "finish").dm).toBe(4500);
    // 750 per started 30 game seconds: a 31 s build costs 1,500, a 3-minute build 4,500.
    expect(speedupQuote(31, "build", "finish").dm).toBe(1500);
    expect(speedupQuote(30, "build", "finish").dm).toBe(750);
  });

  it("caps a click at 72,000 (buildings) / 108,000 (research); finish needs to fit under the cap", () => {
    const long = OG_HOUR * 100;
    expect(speedupQuote(long, "build", "finish").allowed).toBe(false);
    expect(speedupQuote(long, "build", "halve")).toEqual({ dm: 72000, allowed: true, reason: "" });
    expect(speedupQuote(OG_HOUR * 60, "research", "finish")).toEqual({ dm: 90000, allowed: true, reason: "" });
    expect(speedupQuote(OG_HOUR * 80, "research", "finish").allowed).toBe(false);
  });

  it("finishes or halves the running build and charges dark matter", () => {
    let state = withDm(rich(stateWith({ metal_mine: 8 })), 1e6);
    state = enqueue(state, "metal_mine", "manual").state;
    const remaining = activePlanet(state).buildQueue[0]!.remainingSeconds;
    const halved = speedUp(state, "build", "halve");
    expect(halved.ok).toBe(true);
    expect(activePlanet(halved.state).buildQueue[0]!.remainingSeconds).toBeCloseTo(remaining / 2, 9);
    const done = speedUp(state, "build", "finish");
    expect(done.ok).toBe(true);
    expect(activePlanet(done.state).buildings.metal_mine).toBe(9);
    expect(done.state.darkMatter.toNumber()).toBe(1e6 - speedupQuote(remaining, "build", "finish").dm);
  });

  it("refuses without enough dark matter or without a running order", () => {
    expect(speedUp(withDm(stateWith(), 1e6), "research", "finish").reason).toBe("没有正在进行的研究");
    let state = rich(stateWith({ research_lab: 1 }));
    state = enqueueResearch(state, "energy_tech", "manual").state;
    expect(speedUp(state, "research", "finish").reason).toContain("暗物质不足");
  });
});

describe("item shop", () => {
  it("KRAKEN takes OGame hours off the build and carries the surplus to the next order", () => {
    let state = withDm(rich(stateWith({ metal_mine: 5 })), 1e5);
    state = enqueue(state, "metal_mine", "manual").state;
    state = enqueue(state, "metal_mine", "manual").state;
    const first = activePlanet(state).buildQueue[0]!.remainingSeconds;
    const result = buyShopItem(state, "kraken_gold");
    expect(result.ok).toBe(true);
    // 6 OGame hours = 6 game minutes, more than both small orders; same rate as the button (9,000 DM).
    expect(first).toBeLessThan(360);
    expect(activePlanet(result.state).buildings.metal_mine).toBe(7);
    expect(result.state.darkMatter.toNumber()).toBe(1e5 - 9000);
    expect(result.reason).toContain("6 分");
  });

  it("NEWTRON needs running research", () => {
    expect(buyShopItem(withDm(stateWith(), 1e5), "newtron_bronze").reason).toBe("没有正在进行的研究");
  });

  it("boosters raise mine output and end exactly on time", () => {
    const base = withDm(stateWith({ metal_mine: 15, solar_plant: 20 }), 1e5);
    const bought = buyShopItem(base, "booster_bronze", "metal");
    expect(bought.ok).toBe(true);
    const mineOnly = (s: GameState) => economy(s).gross.metal - (30 * 600) / 3600 * economy(s).global;
    expect(mineOnly(bought.state) / mineOnly(base)).toBeCloseTo(1.1, 9);
    // 7 OGame days = 168 game minutes (10,080 s); a long tick and many short ticks agree across the expiry.
    expect(tick(bought.state, 10000).boosters).toHaveLength(1);
    const long = tick(bought.state, 11000);
    let short = bought.state;
    for (let i = 0; i < 110; i += 1) short = tick(short, 100);
    expect(long.boosters).toHaveLength(0);
    expect(activePlanet(long).resources.metal.sub(activePlanet(short).resources.metal).abs().div(activePlanet(long).resources.metal).toNumber()).toBeLessThan(1e-9);
    // A weaker booster is refused while a stronger one runs.
    const gold = buyShopItem(base, "booster_gold", "crystal").state;
    expect(buyShopItem(gold, "booster_bronze", "crystal").reason).toContain("+30%");
  });
});

describe("resource packages (OGame merchant)", () => {
  it("one OGame day (24 game minutes) of production for 36,000 DM, proportional, at least 500, limited by storage", () => {
    const state = withDm(stateWith({ metal_mine: 20, solar_plant: 25, metal_storage: 10 }, { metal: 0 }), 1e6);
    const daily = dailyProduction(state, "metal");
    expect(daily).toBeCloseTo(economy(state).gross.metal * 1440, 6);
    const full = packageQuote(state, "metal", 1);
    expect(full.dm).toBe(36000);
    expect(Math.round(full.amounts.metal.toNumber())).toBe(Math.floor(daily));
    expect(packageQuote(state, "metal", 0.1).dm).toBe(3600);
    const roomy = stateWith({ metal_mine: 20, solar_plant: 25, metal_storage: 10, crystal_storage: 10, deuterium_tank: 10 }, { metal: 0, crystal: 0, deuterium: 0 });
    expect(packageQuote(roomy, "bundle", 1).dm).toBe(108000);
    const bought = buyPackage(state, "metal", 0.5);
    expect(bought.ok).toBe(true);
    expect(bought.state.darkMatter.toNumber()).toBe(1e6 - 18000);
    // Storage limits the amount and the price follows.
    const tight = withDm(stateWith({ metal_mine: 20, solar_plant: 25 }, { metal: 9000 }), 1e6);
    const quote = packageQuote(tight, "metal", 1);
    expect(quote.amounts.metal.toNumber()).toBe(1000);
    expect(quote.dm).toBe(Math.max(500, Math.ceil((36000 * 1000) / dailyProduction(tight, "metal"))));
    const full2 = withDm(stateWith({}, { metal: 10000, crystal: 10000, deuterium: 10000 }), 1e6);
    expect(packageQuote(full2, "bundle", 1).reason).toBe("仓库已满，放不下");
  });
});

describe("inventory and sources", () => {
  it("supply-box items work and are consumed", () => {
    let state = rich(stateWith({ metal_mine: 20 }));
    state = enqueue(state, "metal_mine", "manual").state;
    const before = activePlanet(state).buildQueue[0]!.remainingSeconds;
    state = addInventory(state, "kraken_box", 2);
    const used = useInventory(state, "kraken_box");
    expect(used.ok).toBe(true);
    expect(used.state.items.kraken_box).toBe(1);
    expect(activePlanet(used.state).buildQueue[0]!.remainingSeconds).toBeCloseTo(before * 0.7, 9);
    expect(useInventory(stateWith(), "newtron_box").ok).toBe(false);
    const boosted = useInventory(addInventory(stateWith({ metal_mine: 5 }), "booster_box"), "booster_box");
    expect(boosted.state.boosters).toHaveLength(3);
    const empty = stateWith({ metal_mine: 20, solar_plant: 25, metal_storage: 10, crystal_storage: 10, deuterium_tank: 10 }, { metal: 0, crystal: 0, deuterium: 0 });
    const pack = useInventory(addInventory(empty, "supply_pack"), "supply_pack");
    expect(pack.ok).toBe(true);
    // The merchant's 10% package: 2.4 game minutes of gross production.
    expect(activePlanet(pack.state).resources.metal.toNumber()).toBe(Math.floor(dailyProduction(empty, "metal") / 10));
    expect(activePlanet(pack.state).resources.deuterium.toNumber()).toBe(10000);
  });

  it("every new achievement grants dark matter once", () => {
    const state = applyAchievementUnlocks(stateWith({ metal_mine: 1 }));
    expect(state.unlocked).toContain("first_metal_mine");
    expect(state.darkMatter.toNumber()).toBe(state.unlocked.length * DM_ACHIEVEMENT_REWARD);
    expect(applyAchievementUnlocks(state).darkMatter.eq(state.darkMatter)).toBe(true);
    expect(state.stats.darkMatterEarned).toBe(state.darkMatter.toNumber());
  });

  it("launch keeps dark matter, items and running boosters; save round-trips them", () => {
    let state = withDm(stateWith({ metal_mine: 10 }), 5000);
    state = addInventory(state, "supply_pack", 3);
    state = applyBooster(state, "deuterium", 20, 500).state;
    state = { ...state, lifetime: { metal: big(1e12), crystal: big(0), deuterium: big(0) } };
    const launched = prestige(state);
    expect(launched.items.supply_pack).toBe(3);
    expect(launched.boosters).toHaveLength(1);
    expect(launched.darkMatter.gte(5000)).toBe(true);
    const restored = deserializeState(importSave(exportSave(state, 1)).state);
    expect(restored.items).toEqual(state.items);
    expect(serializeState(restored).boosters).toEqual(serializeState(state).boosters);
    expect(restored.darkMatter.eq(state.darkMatter)).toBe(true);
    const file = JSON.parse(exportSave(state, 1));
    delete file.state.items;
    delete file.state.boosters;
    const lenient = deserializeState(importSave(JSON.stringify(file)).state);
    expect(lenient.items.supply_pack).toBe(0);
    expect(lenient.boosters).toHaveLength(0);
  });
});
