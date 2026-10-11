import { describe, expect, it, vi } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import { big } from "../src/game/decimal";
import type { ShipCounts } from "../src/game/deep-state";
import { fightEncounter, type BattleResult, type CombatTech } from "../src/game/encounter-combat";
import { npcArrivalCombatTech, npcBattleSeed, resolveNpcBattleCandidate, type NpcBattleInput } from "../src/game/npc-battle";
import { NPC_WALLET_CAPS, type NpcSurvivingShips } from "../src/game/npc-loot";
import { createResearch, type ResearchOrder } from "../src/game/research";
import { createInitialState } from "../src/game/state";

type Golden = { winner: BattleResult["winner"]; attackerAfter: ShipCounts; defenderAfter: ShipCounts; rounds: number[][] };
type KernelCase = { id: string; a: ShipCounts; b: ShipCounts; ta: CombatTech; tb: CombatTech; seed: number; golden: Golden };
// Independent Python Fraction specification, four transcribed stat cards; no production imports.
// Frozen 18 named cases include three seed-independent inequality proofs: renewing-shield draw,
// battleship two-round win, and simultaneous mutual destruction. Damage permits JS rounding only.
const KERNEL_GOLDENS: KernelCase[] = [
  {"id":"oracle-small-cargo-shield-draw","a":{"small_cargo":1},"b":{"small_cargo":1},"ta":{"weapons":0,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{"small_cargo":1},"defenderAfter":{"small_cargo":1},"rounds":[[1,1,1,5.101103751920164,4.948290558997542],[2,1,1,5.35246579349041,5.169734041439369],[3,1,1,4.674813898745924,5.026592542184517],[4,1,1,4.773227994330227,5.124744653934613],[5,1,1,5.365474648308009,4.972317055100575],[6,1,1,4.749923734227195,5.38205883349292]]}},
  {"id":"oracle-battleship-two-round","a":{"battleship":1},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"battleship":1},"defenderAfter":{},"rounds":[[1,1,2,1122.242825422436,197.93162235990167],[2,1,0,1177.5424745678902,103.39468082878739]]}},
  {"id":"oracle-mutual-destruction","a":{"light_fighter":1},"b":{"light_fighter":1},"ta":{"weapons":100,"shields":0,"armour":0},"tb":{"weapons":100,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{},"defenderAfter":{},"rounds":[[1,0,0,561.121412711218,544.3119614897296]]}},
  {"id":"oracle-light-fighter-loss","a":{"light_fighter":1},"b":{"light_fighter":4},"ta":{"weapons":0,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"defender","attackerAfter":{},"defenderAfter":{"light_fighter":4},"rounds":[[1,1,4,51.011037519201636,197.93162235990167],[2,1,4,53.5246579349041,206.78936165757477],[3,0,4,46.74813898745924,201.06370168738067]]}},
  {"id":"pure-light-10-v4","a":{"light_fighter":10},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":10},"defenderAfter":{},"rounds":[[1,10,3,561.121412711218,197.93162235990167],[2,10,2,588.7712372839451,155.09202124318108],[3,10,1,514.2295288620517,100.53185084369034],[4,10,0,525.055079376325,51.24744653934613]]}},
  {"id":"light-6-cargo2-v4","a":{"light_fighter":6,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":6,"small_cargo":2},"defenderAfter":{},"rounds":[[1,8,4,347.8952758809552,197.93162235990167],[2,8,3,365.03816711604594,206.78936165757477],[3,8,2,318.82230789447203,150.7977762655355],[4,8,1,325.5341492133215,102.49489307869226],[5,8,1,365.9253710146062,49.72317055100575],[6,8,0,323.9447986742947,53.8205883349292]]}},
  {"id":"light-6-cargo2-v8-heavy1","a":{"light_fighter":6,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{"light_fighter":1},"defenderAfter":{"light_fighter":6,"heavy_fighter":1},"rounds":[[1,8,9,347.8952758809552,574.0017048437148],[2,7,8,365.03816711604594,599.6891488069668],[3,6,8,267.39935500826687,538.1410839279895],[4,4,8,220.5231333380565,556.4008481414722],[5,3,7,182.9626855073031,527.065607840661],[6,1,7,109.72323826064822,530.5172278728735]]}},
  {"id":"light-8-cargo2-v4","a":{"light_fighter":8,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":8,"small_cargo":2},"defenderAfter":{},"rounds":[[1,10,3,460.1195584231988,197.93162235990167],[2,10,2,482.79241457283496,155.09202124318108],[3,10,1,421.66821366688237,100.53185084369034],[4,10,0,430.5451650885865,51.24744653934613]]}},
  {"id":"light-8-cargo2-v8-heavy1","a":{"light_fighter":8,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{"light_fighter":3,"small_cargo":1},"defenderAfter":{"light_fighter":5,"heavy_fighter":1},"rounds":[[1,10,9,460.1195584231988,567.1502256081798],[2,9,8,482.79241457283496,592.53105551882],[3,8,7,370.2452607806772,528.8849544385448],[4,7,7,325.5341492133215,491.97548677772284],[5,5,6,306.9051498832181,482.6072435832911],[6,4,6,214.2215604136465,455.4049782186317]]}},
  {"id":"light-10-cargo2-v4","a":{"light_fighter":10,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":10,"small_cargo":2},"defenderAfter":{},"rounds":[[1,12,3,572.3438409654424,197.93162235990167],[2,12,2,600.546662029624,155.09202124318108],[3,12,0,524.5141194392927,100.53185084369034]]}},
  {"id":"light-10-cargo2-v8-heavy1","a":{"light_fighter":10,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{"light_fighter":6,"small_cargo":1},"defenderAfter":{"light_fighter":3,"heavy_fighter":1},"rounds":[[1,12,8,572.3438409654424,562.8680510859704],[2,11,7,600.546662029624,536.3599067993346],[3,10,6,473.09116655308753,473.1930220746114],[4,9,6,430.5451650885865,433.6322399483134],[5,9,5,424.9455921459943,423.72788817378813],[6,7,4,376.19395975079385,404.82442530185875]]}},
  {"id":"light-12-cargo2-v4","a":{"light_fighter":12,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":12,"small_cargo":2},"defenderAfter":{},"rounds":[[1,14,3,684.568123507686,197.93162235990167],[2,14,1,718.300909486413,155.09202124318108],[3,14,0,627.360025211703,50.26592542184517]]}},
  {"id":"light-12-cargo2-v8-heavy1","a":{"light_fighter":12,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"draw","attackerAfter":{"light_fighter":8,"small_cargo":2},"defenderAfter":{"light_fighter":2,"heavy_fighter":1},"rounds":[[1,14,8,684.568123507686,559.9381422023534],[2,13,7,718.300909486413,533.2988800642718],[3,12,6,575.9370723254979,469.62736036981056],[4,11,5,535.5561809638515,429.1973647670238],[5,11,4,542.9860344087705,368.63729891262886],[6,10,3,480.69228190379215,345.1941182860976]]}},
  {"id":"light-16-cargo2-v4","a":{"light_fighter":16,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":16,"small_cargo":2},"defenderAfter":{},"rounds":[[1,18,2,909.0166885921732,197.93162235990167],[2,18,0,953.8094043999911,103.39468082878739]]}},
  {"id":"light-16-cargo2-v8-heavy1","a":{"light_fighter":16,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":14,"small_cargo":2},"defenderAfter":{},"rounds":[[1,18,8,909.0166885921732,556.1878588313236],[2,17,6,953.8094043999911,529.3807658433914],[3,16,4,781.6288838703185,414.96125667395586],[4,16,3,745.5782127143815,321.46125556498936],[5,16,2,838.087140065711,262.1767174507576],[6,16,0,741.9380872862879,229.9606956128793]]}},
  {"id":"light-20-cargo2-v4","a":{"light_fighter":20,"small_cargo":2},"b":{"light_fighter":4},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":20,"small_cargo":2},"defenderAfter":{},"rounds":[[1,22,2,1133.4652536766603,197.93162235990167],[2,22,0,1189.3178993135691,103.39468082878739]]}},
  {"id":"light-20-cargo2-v8-heavy1","a":{"light_fighter":20,"small_cargo":2},"b":{"light_fighter":8,"heavy_fighter":1},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":19,"small_cargo":2},"defenderAfter":{},"rounds":[[1,22,7,1133.4652536766603,553.8892980555313],[2,21,5,1189.3178993135691,475.282000583942],[3,21,3,987.3206954151392,362.08505600481686],[4,21,1,1008.105752402544,266.66044216236037],[5,21,0,1133.1882457226516,159.2826988837303]]}},
  {"id":"empty-garrison-repeat","a":{"light_fighter":8,"small_cargo":2},"b":{},"ta":{"weapons":1,"shields":0,"armour":0},"tb":{"weapons":0,"shields":0,"armour":0},"seed":42,"golden":{"winner":"attacker","attackerAfter":{"light_fighter":8,"small_cargo":2},"defenderAfter":{},"rounds":[]}},
];

// Independent Fraction calculation at FNV("npc-battle-v1|1|1|1:2:3") = 1927391053.
const CANDIDATE_GOLDENS: Array<{ ships: NpcSurvivingShips; golden: Golden }> = [
  {"ships":{},"golden":{"winner":"defender","attackerAfter":{},"defenderAfter":{"light_fighter":8,"heavy_fighter":1},"rounds":[]}},
  {"ships":{"light_fighter":1},"golden":{"winner":"defender","attackerAfter":{},"defenderAfter":{"light_fighter":8,"heavy_fighter":1},"rounds":[[1,0,9,59.27556569920853,597.7791306027211]]}},
  {"ships":{"small_cargo":2,"light_fighter":6},"golden":{"winner":"draw","attackerAfter":{"small_cargo":1,"light_fighter":1},"defenderAfter":{"light_fighter":6,"heavy_fighter":1},"rounds":[[1,7,9,367.5085073350929,630.3852649992332],[2,7,8,311.51726597612725,573.1881234334672],[3,5,8,280.00818472355604,516.5695804382182],[4,4,8,218.61698793596588,568.6388454471643],[5,3,7,181.23381399805658,547.2891295109876],[6,2,7,111.64629642956425,460.218041346608]]}},
  {"ships":{"small_cargo":2,"light_fighter":8},"golden":{"winner":"draw","attackerAfter":{"small_cargo":1,"light_fighter":3},"defenderAfter":{"light_fighter":5,"heavy_fighter":1},"rounds":[[1,9,9,486.0596387335099,622.860772446192],[2,9,8,431.3315990438685,564.1713996215359],[3,8,7,387.7036403864622,507.6844849313974],[4,6,7,330.5915427324362,521.8097640573978],[5,5,6,298.15885528712533,484.0410933175008],[6,4,6,217.97610255295876,395.05896525851523]]}},
  {"ships":{"small_cargo":2,"light_fighter":16},"golden":{"winner":"attacker","attackerAfter":{"small_cargo":2,"light_fighter":14},"defenderAfter":{},"rounds":[[1,18,8,960.2641643271782,610.8215843613259],[2,17,6,970.496097848704,501.4099925994873],[3,16,4,818.4854630380869,398.32744360188065],[4,16,3,757.1612752904184,340.95524356023157],[5,16,1,830.1677931523882,272.2364452112974],[6,16,0,754.9416234761011,152.7996659016406]]}},
  {"ships":{"small_cargo":2,"light_fighter":20},"golden":{"winner":"attacker","attackerAfter":{"small_cargo":2,"light_fighter":19},"defenderAfter":{},"rounds":[[1,22,7,1197.3664271240123,608.2972384725638],[2,21,5,1210.1247639841865,450.1696317126193],[3,21,3,1033.8763743638992,347.5707970447128],[4,21,1,1023.7673581391573,282.83121039128025],[5,21,0,1122.48039637506,165.3943803606918]]}},
];

function expectGolden(actual: { winner: string; attackerAfter: Readonly<ShipCounts>; defenderAfter: Readonly<ShipCounts>; rounds: readonly { round: number; attacker: number; defender: number; attackDamage: number; defendDamage: number }[] }, golden: Golden): void {
  expect(actual.winner).toBe(golden.winner);
  expect(actual.attackerAfter).toEqual(golden.attackerAfter);
  expect(actual.defenderAfter).toEqual(golden.defenderAfter);
  expect(actual.rounds).toHaveLength(golden.rounds.length);
  actual.rounds.forEach((round, i) => {
    const expected = golden.rounds[i];
    expect([round.round, round.attacker, round.defender]).toEqual(expected.slice(0, 3));
    for (const [actualDamage, expectedDamage] of [[round.attackDamage, expected[3]], [round.defendDamage, expected[4]]]) {
      expect(Math.abs(actualDamage - expectedDamage)).toBeLessThanOrEqual(Math.max(1e-10, Math.abs(expectedDamage) * 1e-12));
    }
  });
}
function canonical(ships: ShipCounts): ShipCounts {
  return Object.fromEntries(SHIP_IDS.filter(id => (ships[id] ?? 0) > 0).map(id => [id, ships[id]]));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function input(patch: Partial<NpcBattleInput> = {}): NpcBattleInput {
  return { universeSeed: 1, fleetId: 1, target: { galaxy: 1, system: 2, position: 3 },
    ships: { small_cargo: 2, light_fighter: 20 }, garrison: { light_fighter: 8, heavy_fighter: 1 },
    attackerTech: { weapons: 1, shields: 0, armour: 0 }, stock: [...NPC_WALLET_CAPS], cargoFactor: 1, ...patch };
}
function order(patch: Partial<ResearchOrder> = {}): ResearchOrder {
  return { planetId: "home", jobId: 1, taskId: null, source: "manual", tech: "weapons_tech", targetLevel: 2,
    totalSeconds: 10, remainingSeconds: 0, paid: { metal: big(1600), crystal: big(400), deuterium: big(0) }, ...patch };
}

describe("unchanged six-round kernel against independent specification goldens", () => {
  it.each(KERNEL_GOLDENS)("matches $id including every round", ({ a, b, ta, tb, seed, golden }) => {
    // Canonical key order is the new caller's contract, not a change to the kernel.
    expectGolden(fightEncounter(canonical(a), canonical(b), ta, tb, seed), golden);
  });
});

describe("independent full-ID NPC battle seed", () => {
  it.each([
    [0, 1, { galaxy: 1, system: 1, position: 1 }, 2103207681],
    [1, 1, { galaxy: 1, system: 2, position: 3 }, 1927391053],
    [1, 4294967297, { galaxy: 1, system: 2, position: 3 }, 2908473783],
    [0xffffffff, Number.MAX_SAFE_INTEGER, { galaxy: 5, system: 100, position: 15 }, 68755856],
    [1, Number.MAX_SAFE_INTEGER - 1, { galaxy: 1, system: 2, position: 3 }, 747610459],
  ] as const)("matches independent ASCII FNV golden %s/%s/%j", (seed, id, target, expected) => {
    expect(npcBattleSeed(seed, id, target)).toBe(expected);
  });
  it("does not truncate IDs to uint32 or conflate nearby safe IDs", () => {
    const target = input().target;
    expect(npcBattleSeed(1, 1, target)).not.toBe(npcBattleSeed(1, 4294967297, target));
    expect(npcBattleSeed(1, Number.MAX_SAFE_INTEGER - 1, target)).not.toBe(npcBattleSeed(1, Number.MAX_SAFE_INTEGER, target));
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined])("rejects invalid task ID %s", id => {
    expect(() => npcBattleSeed(1, id as number, input().target)).toThrow(TypeError);
  });
  it.each([-1, NaN, Infinity, 0x100000000, "1"])("rejects invalid universe seed %s", seed => {
    expect(() => npcBattleSeed(seed as number, 1, input().target)).toThrow(TypeError);
  });
  it("rejects deep-space or malformed coordinates", () => {
    expect(() => npcBattleSeed(1, 1, { ...input().target, position: 16 })).toThrow(TypeError);
    expect(() => npcBattleSeed(1, 1, { ...input().target, system: 0 })).toThrow(TypeError);
  });
});

describe("standalone detached NPC battle candidate", () => {
  it.each(CANDIDATE_GOLDENS)("matches independent hashed-seed oracle for $ships", ({ ships, golden }) => {
    const source = freeze(input({ ships })), before = JSON.stringify(source);
    const result = resolveNpcBattleCandidate(source);
    expect(result.seed).toBe(1927391053);
    expectGolden(result.battle, golden);
    expect(result.survivors).toEqual(golden.attackerAfter);
    expect(result.garrison).toEqual({ light_fighter: golden.defenderAfter.light_fighter ?? 0, heavy_fighter: golden.defenderAfter.heavy_fighter ?? 0 });
    expect(result.destroyed).toBe(Object.keys(golden.attackerAfter).length === 0);
    if (golden.winner !== "attacker") expect(result.loot).toEqual([0, 0, 0]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("uses only survivors for cargo, actual losses, fixed M/C/D allocation and the locked factor", () => {
    const result = resolveNpcBattleCandidate(input());
    expect(result.survivors).toEqual({ small_cargo: 2, light_fighter: 19 });
    expect(result.garrison).toEqual({ light_fighter: 0, heavy_fighter: 0 });
    expect(result.survivingCapacity).toBe(10950);
    expect(result.loot).toEqual([6084, 3650, 1216]);
    expect(result.stockBefore).toEqual(NPC_WALLET_CAPS);
    expect(result.cargoFactor).toBe(1);
    expect(resolveNpcBattleCandidate(input({ cargoFactor: 1.05 })).survivingCapacity).toBe(11497);
  });
  it("reads actual remaining garrison rather than recreating initial defenders", () => {
    const result = resolveNpcBattleCandidate(input({ garrison: { light_fighter: 1, heavy_fighter: 0 } }));
    expect(result.battle.defenderBefore).toEqual({ light_fighter: 1 });
    expect(result.battle.rounds).toHaveLength(1);
    expect(result.survivors).toEqual({ small_cargo: 2, light_fighter: 20 });
  });
  it("records undefended collection as genuinely zero rounds and preserves fractional stock", () => {
    const result = resolveNpcBattleCandidate(input({ ships: { espionage_probe: 1 },
      garrison: { light_fighter: 0, heavy_fighter: 0 }, stock: [3.75, 11.5, 7.25] }));
    expect(result.undefended).toBe(true);
    expect(result.destroyed).toBe(false);
    expect(result.battle.winner).toBe("attacker");
    expect(result.battle.rounds).toEqual([]);
    expect(result.battle.defenderBefore).toEqual({});
    expect(result.survivingCapacity).toBe(5);
    expect(result.loot).toEqual([1, 3, 1]);
    expect(result.stockBefore).toEqual([3.75, 11.5, 7.25]);
  });
  it("does not award loot to an empty attacker even when both fleets are empty", () => {
    const result = resolveNpcBattleCandidate(input({ ships: {}, garrison: { light_fighter: 0, heavy_fighter: 0 } }));
    expect(result.battle.winner).toBe("draw");
    expect(result.battle.rounds).toEqual([]);
    expect(result.destroyed).toBe(true);
    expect(result.survivingCapacity).toBe(0);
    expect(result.loot).toEqual([0, 0, 0]);
  });
  it("preserves subnormal stock when integer eligibility is zero", () => {
    const result = resolveNpcBattleCandidate(input({ garrison: { light_fighter: 0, heavy_fighter: 0 }, stock: [0, 0, Number.MIN_VALUE] }));
    expect(result.stockBefore[2]).toBe(Number.MIN_VALUE);
    expect(result.survivingCapacity).toBe(0);
    expect(result.loot).toEqual([0, 0, 0]);
  });
  it("normalizes key insertion order and drops explicit zero ships", () => {
    const first = resolveNpcBattleCandidate(input({ ships: { small_cargo: 2, light_fighter: 16, cruiser: 0 } }));
    const reversed = resolveNpcBattleCandidate(input({ ships: { cruiser: 0, light_fighter: 16, small_cargo: 2 },
      garrison: { heavy_fighter: 1, light_fighter: 8 }, attackerTech: { armour: 0, shields: 0, weapons: 1 } }));
    expect(reversed).toEqual(first);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(first));
    expect(Object.keys(first.battle.attackerBefore)).toEqual(["small_cargo", "light_fighter"]);
  });
  it("handles every flying catalogue type and the maximum per-type count in bounded work", () => {
    const ships = Object.fromEntries(SHIP_IDS.filter(id => id !== "solar_satellite").map(id => [id, 1e12]));
    const result = resolveNpcBattleCandidate(input({ ships }));
    expect(result.battle.winner).toBe("attacker");
    expect(result.battle.rounds.length).toBeLessThanOrEqual(6);
    expect(result.survivingCapacity).toBe(45000);
    expect(result.loot).toEqual([25000, 15000, 5000]);
    for (const round of result.battle.rounds) {
      expect(Number.isFinite(round.attackDamage)).toBe(true);
      expect(Number.isFinite(round.defendDamage)).toBe(true);
    }
  });
  it("accepts null-prototype data maps and the existing kernel technology ceiling", () => {
    const ships = Object.assign(Object.create(null), { small_cargo: 2, light_fighter: 20 });
    const result = resolveNpcBattleCandidate(input({ ships, attackerTech: { weapons: 1002, shields: 1002, armour: 1002 } }));
    expect(result.battle.winner).toBe("attacker");
    expect(result.attackerTech).toEqual({ weapons: 1002, shields: 1002, armour: 1002 });
    expect(result.survivors).toEqual({ small_cargo: 2, light_fighter: 20 });
  });
  it("returns recursively frozen, detached inputs and output snapshots", () => {
    const source = input(), result = resolveNpcBattleCandidate(source), snapshot = JSON.stringify(result);
    (source.ships as ShipCounts).light_fighter = 1;
    (source.garrison as { light_fighter: number }).light_fighter = 0;
    (source.stock as unknown as number[])[0] = 0;
    source.attackerTech.weapons = 20;
    source.target.position = 5;
    expect(JSON.stringify(result)).toBe(snapshot);
    const assertFrozen = (value: unknown): void => {
      if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(assertFrozen); }
    };
    assertFrozen(result);
    expect(result.battle.attackerAfter).not.toBe(result.survivors);
    expect(result.stockBefore).not.toBe(source.stock);
  });
  it("leaves the entire source world, ring/deep seeds, tickets and protection untouched", () => {
    const world = createInitialState(1, 777);
    world.research.levels.weapons_tech = 1;
    const before = JSON.stringify(world);
    freeze(world);
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("external random"); });
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("external clock"); });
    try {
      const candidate = input({ universeSeed: world.universe.seed, attackerTech: npcArrivalCombatTech(world.research) });
      expect(resolveNpcBattleCandidate(candidate)).toEqual(resolveNpcBattleCandidate(candidate));
      expect(JSON.stringify(world)).toBe(before);
      expect(random).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled();
    } finally { random.mockRestore(); clock.mockRestore(); }
  });
  it.each([null, [], { solar_satellite: 0 }, { rocket_launcher: 1 }, { unknown: 1 },
    { light_fighter: -1 }, { light_fighter: 0.5 }, { light_fighter: NaN }, { light_fighter: Infinity },
    { light_fighter: 1e12 + 1 }, { light_fighter: "1" }, { light_fighter: undefined }, Object.create({ light_fighter: 1 }),
  ].map(value => [value] as const))("rejects malformed ship maps %j without repair", ships => {
    expect(() => resolveNpcBattleCandidate(input({ ships: ships as NpcSurvivingShips }))).toThrow(TypeError);
  });
  it.each([null, [], { weapons: 1, shields: 0 }, { weapons: -1, shields: 0, armour: 0 },
    { weapons: 0.5, shields: 0, armour: 0 }, { weapons: NaN, shields: 0, armour: 0 },
    { weapons: Infinity, shields: 0, armour: 0 }, { weapons: 1003, shields: 0, armour: 0 },
    { weapons: "1", shields: 0, armour: 0 }, { weapons: 1, shields: 0, armour: 0, extra: 1 },
  ].map(value => [value] as const))("rejects malformed combat technology %j", attackerTech => {
    expect(() => resolveNpcBattleCandidate(input({ attackerTech: attackerTech as CombatTech }))).toThrow(TypeError);
  });
  it.each([0, -1, NaN, Infinity, "1"])("rejects invalid locked cargo factor %s", cargoFactor => {
    expect(() => resolveNpcBattleCandidate(input({ cargoFactor: cargoFactor as number }))).toThrow(TypeError);
  });
  it("rejects malformed stock and over-initial garrisons before exposing any candidate", () => {
    expect(() => resolveNpcBattleCandidate(input({ stock: [-1, 0, 0] }))).toThrow(TypeError);
    expect(() => resolveNpcBattleCandidate(input({ garrison: { light_fighter: 9, heavy_fighter: 1 } }))).toThrow(TypeError);
    expect(() => resolveNpcBattleCandidate(input({ garrison: { light_fighter: 8, heavy_fighter: 2 } }))).toThrow(TypeError);
  });
  it("rejects getters, hidden fields, symbols and inherited data without running them", () => {
    let reads = 0;
    const getter = { enumerable: true, get() { reads += 1; throw Error("getter ran"); } };
    const badShips = Object.defineProperty({}, "light_fighter", getter);
    const hiddenShips = Object.defineProperty({}, "light_fighter", { value: 1 });
    const symbolShips = { light_fighter: 1, [Symbol("extra")]: 0 };
    for (const ships of [badShips, hiddenShips, symbolShips]) expect(() => resolveNpcBattleCandidate(input({ ships }))).toThrow(TypeError);
    const badInput = Object.defineProperty(input(), "ships", getter);
    const badTech = Object.defineProperty({ weapons: 1, shields: 0 }, "armour", getter) as CombatTech;
    expect(() => resolveNpcBattleCandidate(badInput)).toThrow(TypeError);
    expect(() => resolveNpcBattleCandidate(input({ attackerTech: badTech }))).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});

describe("exact-zero read-only arrival research view", () => {
  it("takes max(completed, original active head) without completing or crediting research", () => {
    const research = createResearch();
    Object.assign(research.levels, { weapons_tech: 1, shielding_tech: 3, armour_tech: 4 });
    research.queue = [order(), order({ jobId: 2, tech: "shielding_tech", targetLevel: 5 })];
    const before = JSON.stringify(research);
    freeze(research);
    expect(npcArrivalCombatTech(research)).toEqual({ weapons: 2, shields: 3, armour: 4 });
    expect(JSON.stringify(research)).toBe(before);
    expect(research.queue).toHaveLength(2);
  });
  it.each(["weapons_tech", "shielding_tech", "armour_tech"] as const)("applies exactly due %s", tech => {
    const research = createResearch(); research.queue = [order({ tech, targetLevel: 7 })];
    const expected = { weapons: 0, shields: 0, armour: 0 };
    expected[tech === "weapons_tech" ? "weapons" : tech === "shielding_tech" ? "shields" : "armour"] = 7;
    expect(npcArrivalCombatTech(research)).toEqual(expected);
  });
  it("never lowers already-completed tech or lets noncombat research grant combat tech", () => {
    const research = createResearch(); research.levels.weapons_tech = 5; research.queue = [order()];
    expect(npcArrivalCombatTech(research).weapons).toBe(5);
    research.queue = [order({ tech: "hyperspace_tech", targetLevel: 20 })];
    expect(npcArrivalCombatTech(research)).toEqual({ weapons: 5, shields: 0, armour: 0 });
  });
  it.each([Number.MIN_VALUE, 1e-12, 5e-10, 1e-9, 1, -1, NaN, Infinity])("does not grant head at remaining %s", remainingSeconds => {
    const research = createResearch(); research.levels.weapons_tech = 1;
    research.queue = [order({ remainingSeconds })];
    expect(npcArrivalCombatTech(research).weapons).toBe(1);
  });
  it.each([0, -1, NaN, Infinity])("does not grant non-active or invalid total %s", totalSeconds => {
    const research = createResearch(); research.queue = [order({ totalSeconds }), order({ jobId: 2, targetLevel: 8 })];
    expect(npcArrivalCombatTech(research).weapons).toBe(0);
  });
  it.each([
    { jobId: 0 }, { jobId: Number.MAX_SAFE_INTEGER }, { jobId: 1.5 }, { planetId: "" }, { planetId: "bad planet" },
    { source: "unknown" }, { taskId: 1 }, { source: "plan", taskId: null }, { source: "plan", taskId: 0 },
    { tech: "unknown" }, { targetLevel: 0 }, { targetLevel: 1.5 }, { targetLevel: NaN }, { targetLevel: 1001 },
  ])("does not grant from a malformed active head %j", patch => {
    const research = createResearch(); research.queue = [order(patch as Partial<ResearchOrder>)];
    expect(npcArrivalCombatTech(research).weapons).toBe(0);
  });
  it("accepts a valid already-paid plan identity without rechecking current lab prerequisites", () => {
    const research = createResearch(); research.queue = [order({ source: "plan", taskId: 7 })];
    expect(npcArrivalCombatTech(research).weapons).toBe(2);
  });
  it("ignores an accessor head without evaluating it or looking at later queue entries", () => {
    let reads = 0;
    const research = createResearch(); research.queue = [order(), order({ jobId: 2, targetLevel: 7 })];
    Object.defineProperty(research.queue[0], "jobId", { enumerable: true, get() { reads += 1; return 1; } });
    Object.defineProperty(research.queue, "1", { enumerable: true, get() { reads += 1; return order(); } });
    expect(npcArrivalCombatTech(research).weapons).toBe(0);
    expect(reads).toBe(0);
  });
  it.each([-1, NaN, Infinity, 0.5, 1001, "1"])("rejects invalid completed technology %s", value => {
    const research = createResearch(); research.levels.weapons_tech = value as number;
    expect(() => npcArrivalCombatTech(research)).toThrow(TypeError);
  });
  it("rejects completed-tech getters without executing them and detaches the result", () => {
    const research = createResearch();
    const result = npcArrivalCombatTech(research); research.levels.weapons_tech = 5;
    expect(result.weapons).toBe(0); expect(Object.isFrozen(result)).toBe(true);
    let reads = 0;
    Object.defineProperty(research.levels, "weapons_tech", { enumerable: true, get() { reads += 1; return 1; } });
    expect(() => npcArrivalCombatTech(research)).toThrow(TypeError);
    expect(reads).toBe(0);
  });
});
