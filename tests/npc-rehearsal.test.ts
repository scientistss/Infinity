import { describe, expect, it, vi } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import type { CombatTech } from "../src/game/encounter-combat";
import type { NpcResourceTuple, NpcSurvivingShips } from "../src/game/npc-loot";
import { NPC_REHEARSAL_SEED_GROUP, NPC_REHEARSAL_SEEDS, rehearseNpcScout, type NpcRehearsalBattle } from "../src/game/npc-rehearsal";
import type { NpcScoutSnapshotV1 } from "../src/game/npc-scout-state";
import { Rng } from "../src/game/rng";

type GoldenCase = {
  name: string;
  input: { ships: NpcSurvivingShips; garrison: NpcScoutSnapshotV1["garrison"]; attackerTech: CombatTech; stock: NpcResourceTuple; cargoFactor: number };
  expected: { seed: number; battle: NpcRehearsalBattle; survivingCapacity: number; loot: NpcResourceTuple }[];
};
// Frozen independent pre-implementation Python binary64 oracle, 2026-10-11.
// Literal stat cards + independently implemented mulberry32, squadron damage and
// proportional half-stock allocation. No production import/call generated these.
// Counts/outcomes/loot must match exactly; damage tolerance: abs 1e-12, rel 1e-14.
const GOLDENS: GoldenCase[] = [
  {"name":"six_round_lf_draw","input":{"ships":{"light_fighter":4},"garrison":{"light_fighter":4,"heavy_fighter":0},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[515,257.5,3],"cargoFactor":1.4},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"draw","rounds":[{"round":1,"attacker":4,"defender":4,"attackDamage":233.97442424669865,"defendDamage":192.26854423992336},{"round":2,"attacker":4,"defender":4,"attackDamage":235.10519907064736,"defendDamage":204.3791946116835},{"round":3,"attacker":3,"defender":3,"attackDamage":219.1468105660752,"defendDamage":184.28996528498828},{"round":4,"attacker":3,"defender":3,"attackDamage":154.6186523172073,"defendDamage":152.0409548166208},{"round":5,"attacker":3,"defender":2,"attackDamage":171.87962914514355,"defendDamage":137.3487736727111},{"round":6,"attacker":3,"defender":2,"attackDamage":154.62578285322525,"defendDamage":108.89045345596968}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":4},"attackerAfter":{"light_fighter":3},"defenderAfter":{"light_fighter":2}},"survivingCapacity":210,"loot":[0,0,0]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"draw","rounds":[{"round":1,"attacker":4,"defender":4,"attackDamage":199.72104230988774,"defendDamage":186.88023530878127},{"round":2,"attacker":4,"defender":4,"attackDamage":226.29246507864448,"defendDamage":213.6074564885348},{"round":3,"attacker":3,"defender":3,"attackDamage":221.13009843789047,"defendDamage":217.53555948846045},{"round":4,"attacker":3,"defender":3,"attackDamage":173.2680246066302,"defendDamage":138.4925419301726},{"round":5,"attacker":3,"defender":2,"attackDamage":172.81861589779143,"defendDamage":135.47033365583047},{"round":6,"attacker":3,"defender":2,"attackDamage":149.2997213434428,"defendDamage":105.35996390972286}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":4},"attackerAfter":{"light_fighter":3},"defenderAfter":{"light_fighter":2}},"survivingCapacity":210,"loot":[0,0,0]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"draw","rounds":[{"round":1,"attacker":4,"defender":4,"attackDamage":227.46998778451237,"defendDamage":188.9403485879302},{"round":2,"attacker":4,"defender":4,"attackDamage":235.5658481568098,"defendDamage":184.64365020394325},{"round":3,"attacker":3,"defender":3,"attackDamage":238.57273706980055,"defendDamage":196.31565920077264},{"round":4,"attacker":3,"defender":3,"attackDamage":177.87975570070557,"defendDamage":141.71326311305165},{"round":5,"attacker":3,"defender":2,"attackDamage":170.42167348740622,"defendDamage":147.78102999553084},{"round":6,"attacker":3,"defender":2,"attackDamage":154.16455101873726,"defendDamage":93.28932269476354}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":4},"attackerAfter":{"light_fighter":3},"defenderAfter":{"light_fighter":2}},"survivingCapacity":210,"loot":[0,0,0]}]},
  {"name":"mixed_outcomes_not_probability","input":{"ships":{"light_fighter":4},"garrison":{"light_fighter":3,"heavy_fighter":0},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[515,257.5,3],"cargoFactor":1.4},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"draw","rounds":[{"round":1,"attacker":4,"defender":3,"attackDamage":233.97442424669865,"defendDamage":144.20140817994252},{"round":2,"attacker":4,"defender":2,"attackDamage":235.10519907064736,"defendDamage":153.28439595876262},{"round":3,"attacker":4,"defender":2,"attackDamage":219.1468105660752,"defendDamage":92.14498264249414},{"round":4,"attacker":4,"defender":2,"attackDamage":206.15820308960977,"defendDamage":101.36063654441388},{"round":5,"attacker":4,"defender":1,"attackDamage":229.17283886019143,"defendDamage":91.56584911514074},{"round":6,"attacker":4,"defender":1,"attackDamage":206.16771047096702,"defendDamage":54.44522672798484}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":3},"attackerAfter":{"light_fighter":4},"defenderAfter":{"light_fighter":1}},"survivingCapacity":280,"loot":[0,0,0]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"draw","rounds":[{"round":1,"attacker":4,"defender":3,"attackDamage":199.72104230988774,"defendDamage":140.16017648158595},{"round":2,"attacker":4,"defender":3,"attackDamage":226.29246507864448,"defendDamage":160.2055923664011},{"round":3,"attacker":4,"defender":2,"attackDamage":221.13009843789047,"defendDamage":163.15166961634532},{"round":4,"attacker":4,"defender":2,"attackDamage":231.0240328088403,"defendDamage":92.32836128678173},{"round":5,"attacker":3,"defender":1,"attackDamage":230.42482119705528,"defendDamage":90.31355577055365},{"round":6,"attacker":3,"defender":1,"attackDamage":149.2997213434428,"defendDamage":52.67998195486143}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":3},"attackerAfter":{"light_fighter":3},"defenderAfter":{"light_fighter":1}},"survivingCapacity":210,"loot":[0,0,0]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":4,"defender":3,"attackDamage":227.46998778451237,"defendDamage":141.70526144094765},{"round":2,"attacker":4,"defender":2,"attackDamage":235.5658481568098,"defendDamage":138.48273765295744},{"round":3,"attacker":4,"defender":2,"attackDamage":238.57273706980055,"defendDamage":98.15782960038632},{"round":4,"attacker":4,"defender":1,"attackDamage":237.1730076009408,"defendDamage":94.47550874203444},{"round":5,"attacker":4,"defender":1,"attackDamage":227.22889798320833,"defendDamage":49.260343331843615},{"round":6,"attacker":4,"defender":0,"attackDamage":205.5527346916497,"defendDamage":46.64466134738177}],"attackerBefore":{"light_fighter":4},"defenderBefore":{"light_fighter":3},"attackerAfter":{"light_fighter":4},"defenderAfter":{}},"survivingCapacity":280,"loot":[187,93,0]}]},
  {"name":"lf_victory","input":{"ships":{"light_fighter":6},"garrison":{"light_fighter":2,"heavy_fighter":0},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[515,257.5,3],"cargoFactor":1.4},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":6,"defender":2,"attackDamage":350.9616363700479,"defendDamage":96.13427211996168},{"round":2,"attacker":6,"defender":1,"attackDamage":352.657798605971,"defendDamage":102.18959730584174},{"round":3,"attacker":6,"defender":0,"attackDamage":328.7202158491127,"defendDamage":46.07249132124707}],"attackerBefore":{"light_fighter":6},"defenderBefore":{"light_fighter":2},"attackerAfter":{"light_fighter":6},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":6,"defender":2,"attackDamage":299.58156346483156,"defendDamage":93.44011765439063},{"round":2,"attacker":6,"defender":1,"attackDamage":339.4386976179667,"defendDamage":106.8037282442674},{"round":3,"attacker":6,"defender":0,"attackDamage":331.6951476568357,"defendDamage":54.38388987211511}],"attackerBefore":{"light_fighter":6},"defenderBefore":{"light_fighter":2},"attackerAfter":{"light_fighter":6},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":6,"defender":2,"attackDamage":341.2049816767685,"defendDamage":94.4701742939651},{"round":2,"attacker":6,"defender":1,"attackDamage":353.34877223521465,"defendDamage":92.32182510197163},{"round":3,"attacker":6,"defender":0,"attackDamage":357.8591056047008,"defendDamage":49.07891480019316}],"attackerBefore":{"light_fighter":6},"defenderBefore":{"light_fighter":2},"attackerAfter":{"light_fighter":6},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]}]},
  {"name":"probe_defeat","input":{"ships":{"espionage_probe":1},"garrison":{"light_fighter":8,"heavy_fighter":1},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[515,257.5,3],"cargoFactor":1.4},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"defender","rounds":[{"round":1,"attacker":0,"defender":9,"attackDamage":0.011698721212334931,"defendDamage":2643.692483298946}],"attackerBefore":{"espionage_probe":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{},"defenderAfter":{"light_fighter":8,"heavy_fighter":1}},"survivingCapacity":0,"loot":[0,0,0]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"defender","rounds":[{"round":1,"attacker":0,"defender":9,"attackDamage":0.009986052115494387,"defendDamage":2569.6032354957424}],"attackerBefore":{"espionage_probe":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{},"defenderAfter":{"light_fighter":8,"heavy_fighter":1}},"survivingCapacity":0,"loot":[0,0,0]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"defender","rounds":[{"round":1,"attacker":0,"defender":9,"attackDamage":0.01137349938922562,"defendDamage":2597.9297930840403}],"attackerBefore":{"espionage_probe":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{},"defenderAfter":{"light_fighter":8,"heavy_fighter":1}},"survivingCapacity":0,"loot":[0,0,0]}]},
  {"name":"zero_round_undefended","input":{"ships":{"small_cargo":1},"garrison":{"light_fighter":0,"heavy_fighter":0},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[5,3,1],"cargoFactor":1},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[],"attackerBefore":{"small_cargo":1},"defenderBefore":{},"attackerAfter":{"small_cargo":1},"defenderAfter":{}},"survivingCapacity":3,"loot":[2,1,0]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[],"attackerBefore":{"small_cargo":1},"defenderBefore":{},"attackerAfter":{"small_cargo":1},"defenderAfter":{}},"survivingCapacity":3,"loot":[2,1,0]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[],"attackerBefore":{"small_cargo":1},"defenderBefore":{},"attackerAfter":{"small_cargo":1},"defenderAfter":{}},"survivingCapacity":3,"loot":[2,1,0]}]},
  {"name":"mixed_rapid_fire","input":{"ships":{"small_cargo":1,"cruiser":1},"garrison":{"light_fighter":8,"heavy_fighter":1},"attackerTech":{"weapons":1,"shields":0,"armour":0},"stock":[515,257.5,3],"cargoFactor":1.4},"expected":[{"seed":608135816,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":2,"defender":6,"attackDamage":1810.7949190807,"defendDamage":600.8392007497605},{"round":2,"attacker":1,"defender":3,"attackDamage":1544.7480238937305,"defendDamage":485.4005872027483},{"round":3,"attacker":1,"defender":1,"attackDamage":986.1606475473385,"defendDamage":230.36245660623536},{"round":4,"attacker":1,"defender":0,"attackDamage":412.31640617921954,"defendDamage":152.0409548166208}],"attackerBefore":{"small_cargo":1,"cruiser":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{"cruiser":1},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]},{"seed":2242054355,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":2,"defender":6,"attackDamage":1545.6982095911671,"defendDamage":584.0007353399415},{"round":2,"attacker":1,"defender":3,"attackDamage":1486.8443557780934,"defendDamage":507.31770916027017},{"round":3,"attacker":1,"defender":2,"attackDamage":995.0854429705072,"defendDamage":271.9194493605755},{"round":4,"attacker":1,"defender":0,"attackDamage":792.0823982017381,"defendDamage":184.65672257356346}],"attackerBefore":{"small_cargo":1,"cruiser":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{"cruiser":1},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]},{"seed":320440878,"battle":{"mode":"squadron-v1","winner":"attacker","rounds":[{"round":1,"attacker":2,"defender":6,"attackDamage":1760.4552268894229,"defendDamage":590.4385893372819},{"round":2,"attacker":1,"defender":3,"attackDamage":1547.774697775766,"defendDamage":438.5286692343653},{"round":3,"attacker":1,"defender":1,"attackDamage":1073.5773168141025,"defendDamage":245.3945740009658},{"round":4,"attacker":1,"defender":0,"attackDamage":474.3460152018816,"defendDamage":141.71326311305165}],"attackerBefore":{"small_cargo":1,"cruiser":1},"defenderBefore":{"light_fighter":8,"heavy_fighter":1},"attackerAfter":{"cruiser":1},"defenderAfter":{}},"survivingCapacity":386,"loot":[257,128,1]}]},
];

const TECH: CombatTech = { weapons: 1, shields: 0, armour: 0 };
const FLYING_IDS = SHIP_IDS.filter(id => id !== "solar_satellite");
function snapshot(patch: Partial<NpcScoutSnapshotV1> = {}): NpcScoutSnapshotV1 {
  return {
    model: "npc-scout-snapshot-v1", fleetId: 7, originId: "former_home", target: { galaxy: 1, system: 2, position: 3 },
    observedAt: "103.25", stock: [515, 257.5, 3], garrison: { light_fighter: 8, heavy_fighter: 1 },
    defenderTech: { weapons: 0, shields: 0, armour: 0 }, ...patch,
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const field of Object.values(Object.getOwnPropertyDescriptors(value))) if ("value" in field) freeze(field.value);
    Object.freeze(value);
  }
  return value;
}
// True neighboring positive binary64 values, not decimal or epsilon offsets.
function adjacentPositive(value: number, direction: -1 | 1): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  view.setBigUint64(0, view.getBigUint64(0, false) + BigInt(direction), false);
  return view.getFloat64(0, false);
}
const nextDown = (value: number): number => adjacentPositive(value, -1);
const nextUp = (value: number): number => adjacentPositive(value, 1);
function expectFrozen(value: unknown): void {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(expectFrozen);
  }
}
function expectGolden(actual: NpcRehearsalBattle, expected: NpcRehearsalBattle): void {
  expect(actual.mode).toBe(expected.mode);
  expect(actual.winner).toBe(expected.winner);
  for (const field of ["attackerBefore", "defenderBefore", "attackerAfter", "defenderAfter"] as const) {
    expect(actual[field]).toEqual(expected[field]);
  }
  expect(actual.rounds).toHaveLength(expected.rounds.length);
  actual.rounds.forEach((round, index) => {
    const golden = expected.rounds[index];
    expect([round.round, round.attacker, round.defender]).toEqual([golden.round, golden.attacker, golden.defender]);
    for (const field of ["attackDamage", "defendDamage"] as const) {
      expect(Math.abs(round[field] - golden[field])).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(golden[field]) * 1e-14));
    }
  });
}

const SAMPLE_GOLDENS = GOLDENS.flatMap(test => test.expected.map((expected, index) => ({
  name: test.name, seed: expected.seed, input: test.input, expected, index,
})));
describe("pure historical NPC rehearsal independent oracle", () => {
  it.each(SAMPLE_GOLDENS)("matches $name / $seed including every round and integer loot", ({ input, expected, index }) => {
    const historical = freeze(snapshot({ garrison: input.garrison, stock: input.stock }));
    const ships = freeze(input.ships), tech = freeze(input.attackerTech);
    const before = JSON.stringify([historical, ships, tech]);
    const result = rehearseNpcScout(historical, ships, tech, input.cargoFactor), sample = result.samples[index];
    expect(result.seedGroup).toBe("npc-rehearsal-public-v1");
    expect(result.samples.map(value => value.seed)).toEqual([608135816, 2242054355, 320440878]);
    expect(sample.seed).toBe(expected.seed);
    expectGolden(sample.battle, expected.battle);
    expect(sample.survivingCapacity).toBe(expected.survivingCapacity);
    expect(sample.loot).toEqual(expected.loot);
    expect(sample.destroyed).toBe(Object.keys(expected.battle.attackerAfter).length === 0);
    expect(sample.undefended).toBe(Object.keys(expected.battle.defenderBefore).length === 0);
    expect(result).toEqual(rehearseNpcScout(historical, ships, tech, input.cargoFactor));
    expect(JSON.stringify([historical, ships, tech])).toBe(before);
    expectFrozen(result);
  });

  it("labels the fixed three examples explicitly and exposes no inferred probabilities", () => {
    const test = GOLDENS.find(value => value.name === "mixed_outcomes_not_probability")!;
    const result = rehearseNpcScout(snapshot({ garrison: test.input.garrison }), test.input.ships, test.input.attackerTech, test.input.cargoFactor);
    expect(NPC_REHEARSAL_SEED_GROUP).toBe("npc-rehearsal-public-v1");
    expect(NPC_REHEARSAL_SEEDS).toEqual([608135816, 2242054355, 320440878]);
    expect(Object.isFrozen(NPC_REHEARSAL_SEEDS)).toBe(true);
    expect(result.sampleCount).toBe(3);
    expect(result.interpretation).toBe("illustrative-samples-not-probabilities");
    expect(result.samples.map(value => value.battle.winner)).toEqual(["draw", "draw", "attacker"]);
    expect(Object.keys(result)).toEqual(["seedGroup", "sampleCount", "interpretation", "snapshot", "selectedShips", "attackerTech", "cargoFactor", "samples"]);
  });
});

describe("bounded historical inputs and detached outputs", () => {
  it.each([1, 1000, 1e12])("handles all 13 flying types at %s each, tech 0/1000 and all defender models", count => {
    expect(FLYING_IDS).toHaveLength(13);
    const ships = freeze(Object.fromEntries(FLYING_IDS.map(id => [id, count])));
    for (const level of [0, 1000]) for (const garrison of [
      { light_fighter: 0, heavy_fighter: 0 }, { light_fighter: 4, heavy_fighter: 0 }, { light_fighter: 8, heavy_fighter: 1 },
    ]) {
      const historical = freeze(snapshot({ garrison, stock: [50000, 30000, 10000] }));
      const tech = freeze({ weapons: level, shields: level, armour: level });
      const before = JSON.stringify([historical, ships, tech]);
      const result = rehearseNpcScout(historical, ships, tech, 1 + .05 * level);
      expect(result).toEqual(rehearseNpcScout(historical, ships, tech, 1 + .05 * level));
      expect(result.selectedShips).toEqual(ships);
      for (const sample of result.samples) {
        expect(sample.battle.rounds.length).toBeLessThanOrEqual(6);
        for (const round of sample.battle.rounds) {
          expect(Number.isFinite(round.attackDamage)).toBe(true);
          expect(Number.isFinite(round.defendDamage)).toBe(true);
          expect(Number.isSafeInteger(round.attacker)).toBe(true);
          expect(Number.isSafeInteger(round.defender)).toBe(true);
          expect(round.attacker).toBeLessThanOrEqual(13 * count);
          expect(round.defender).toBeLessThanOrEqual(garrison.light_fighter + garrison.heavy_fighter);
        }
        for (const id of FLYING_IDS) {
          const survivors = sample.battle.attackerAfter[id] ?? 0;
          expect(Number.isSafeInteger(survivors)).toBe(true);
          expect(survivors).toBeGreaterThanOrEqual(0);
          expect(survivors).toBeLessThanOrEqual(count);
        }
        expect(sample.survivingCapacity).toBeGreaterThanOrEqual(0);
        expect(sample.survivingCapacity).toBeLessThanOrEqual(45000);
        expect(sample.loot.reduce((sum, amount) => sum + amount, 0)).toBeLessThanOrEqual(sample.survivingCapacity);
        expect(sample.loot.every(amount => Number.isSafeInteger(amount) && amount >= 0)).toBe(true);
      }
      expect(JSON.stringify([historical, ships, tech])).toBe(before);
      expectFrozen(result);
    }
  });

  it("canonicalizes ordering and zero counts only after validating all named types", () => {
    const historical = snapshot();
    const first = rehearseNpcScout(historical, { small_cargo: 1, cruiser: 1 }, TECH, 1.4);
    const reversed = rehearseNpcScout({ ...historical, garrison: { heavy_fighter: 1, light_fighter: 8 } },
      { cruiser: 1, light_fighter: 0, small_cargo: 1 }, { armour: 0, shields: 0, weapons: 1 }, 1.4);
    expect(reversed).toEqual(first);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(first));
    expect(Object.keys(first.selectedShips)).toEqual(["small_cargo", "cruiser"]);
  });

  it("accepts plain null-prototype detached maps", () => {
    const ships = Object.assign(Object.create(null), { small_cargo: 1, cruiser: 1 });
    const tech = Object.assign(Object.create(null), TECH);
    expect(rehearseNpcScout(snapshot(), ships, tech, 1)).toEqual(rehearseNpcScout(snapshot(), { small_cargo: 1, cruiser: 1 }, TECH, 1));
  });

  it("copies every nested input and preserves historical fractions/subnormal values with economic +0", () => {
    const historical = snapshot({ stock: [-0, 11.5, Number.MIN_VALUE], garrison: { light_fighter: 0, heavy_fighter: 0 } });
    const ships = { espionage_probe: 1 }, tech = { ...TECH };
    const result = rehearseNpcScout(historical, ships, tech, 1), saved = JSON.stringify(result);
    expect(Object.is(historical.stock[0], -0)).toBe(true);
    expect(Object.is(result.snapshot.stock[0], 0)).toBe(true);
    expect(result.snapshot.stock[1]).toBe(11.5);
    expect(result.snapshot.stock[2]).toBe(Number.MIN_VALUE);
    for (const sample of result.samples) {
      expect(sample.battle.winner).toBe("attacker");
      expect(sample.battle.rounds).toEqual([]);
      expect(sample.loot).toEqual([0, 5, 0]);
    }
    expect(result.snapshot).not.toBe(historical);
    for (const field of ["stock", "target", "garrison", "defenderTech"] as const) expect(result.snapshot[field]).not.toBe(historical[field]);
    expect(result.selectedShips).not.toBe(ships);
    expect(result.attackerTech).not.toBe(tech);
    (historical.stock as unknown as number[])[1] = 0;
    (historical.target as { position: number }).position = 15;
    (historical.garrison as { light_fighter: number }).light_fighter = 8;
    (historical.defenderTech as { weapons: number }).weapons = 50;
    ships.espionage_probe = 100;
    tech.weapons = 1000;
    expect(JSON.stringify(result)).toBe(saved);
    expectFrozen(result);
  });

  it("still fights observed defenders when historical stock is zero", () => {
    const result = rehearseNpcScout(snapshot({ stock: [0, 0, 0] }), { light_fighter: 1 }, TECH, 1);
    for (const sample of result.samples) {
      expect(sample.battle.rounds.length).toBeGreaterThan(0);
      expect(sample.battle.winner).toBe("defender");
      expect(sample.loot).toEqual([0, 0, 0]);
    }
  });

  it("uses only detached history and captured completed levels, independent of historical identity", () => {
    const original = rehearseNpcScout(snapshot(), { light_fighter: 4 }, TECH, 1.4);
    const differentIdentity = rehearseNpcScout(snapshot({ fleetId: Number.MAX_SAFE_INTEGER - 1, originId: "retired_origin",
      target: { galaxy: 5, system: 100, position: 15 }, observedAt: "0" }), { light_fighter: 4 }, TECH, 1.4);
    expect(differentIdentity.samples).toEqual(original.samples);
    expect(original.attackerTech).toEqual(TECH);
    expect(original.cargoFactor).toBe(1.4);
  });

  it("never reads external random or wall time and repeats byte-identically", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("external random"); });
    const time = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("external time"); });
    try {
      const historical = freeze(snapshot()), ships = freeze({ small_cargo: 1, cruiser: 1 });
      const first = rehearseNpcScout(historical, ships, freeze({ ...TECH }), 1.4);
      expect(JSON.stringify(rehearseNpcScout(historical, ships, TECH, 1.4))).toBe(JSON.stringify(first));
      expect(random).not.toHaveBeenCalled();
      expect(time).not.toHaveBeenCalled();
    } finally { random.mockRestore(); time.mockRestore(); }
  });

  it("accepts each exact completed hyperspace factor and no rounding approximation", () => {
    const historical = snapshot({ garrison: { light_fighter: 0, heavy_fighter: 0 } });
    for (let level = 0; level <= 1000; level += 1) {
      const factor = 1 + .05 * level;
      expect(rehearseNpcScout(historical, { small_cargo: 1 }, TECH, factor).cargoFactor).toBe(factor);
    }
  });
});

describe("exact local RNG and binary64 boundary witnesses", () => {
  it.each(GOLDENS)("draws at most 12 locally per sample and 36 total for $name", test => {
    const original = Rng.prototype.next;
    const draws = new Map<Rng, { seed: number; count: number }>();
    const spy = vi.spyOn(Rng.prototype, "next").mockImplementation(function (this: Rng): number {
      const entry = draws.get(this) ?? { seed: this.seed, count: 0 };
      entry.count += 1;
      draws.set(this, entry);
      return original.call(this);
    });
    try {
      const result = rehearseNpcScout(snapshot({ stock: test.input.stock, garrison: test.input.garrison }),
        test.input.ships, test.input.attackerTech, test.input.cargoFactor);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(36);
      if (test.input.garrison.light_fighter === 0 && test.input.garrison.heavy_fighter === 0) {
        expect(spy).not.toHaveBeenCalled();
        expect(draws.size).toBe(0);
        expect(result.samples.every(sample => sample.battle.rounds.length === 0)).toBe(true);
      } else {
        const observed = [...draws.values()];
        expect(observed.map(entry => entry.seed)).toEqual([608135816, 2242054355, 320440878]);
        observed.forEach((entry, index) => {
          expect(entry.count).toBe(result.samples[index].battle.rounds.length * 2);
          expect(entry.count).toBeLessThanOrEqual(12);
        });
        if (test.name === "six_round_lf_draw") expect(observed.map(entry => entry.count)).toEqual([12, 12, 12]);
      }
    } finally { spy.mockRestore(); }
  });

  it("uses the actual adjacent Numbers around half-stock integer eligibility", () => {
    // Independently evaluated binary64 stock / 2 floors; literal outcomes only.
    const cases: { stock: number; represented: number; eligible: number }[] = [
      { stock: nextDown(2), represented: 1.9999999999999998, eligible: 0 },
      { stock: 2, represented: 2, eligible: 1 },
      { stock: nextUp(2), represented: 2.0000000000000004, eligible: 1 },
      { stock: nextDown(3), represented: 2.9999999999999996, eligible: 1 },
      { stock: 3, represented: 3, eligible: 1 },
      { stock: nextUp(3), represented: 3.0000000000000004, eligible: 1 },
      { stock: nextDown(4), represented: 3.9999999999999996, eligible: 1 },
      { stock: 4, represented: 4, eligible: 2 },
      { stock: nextUp(4), represented: 4.000000000000001, eligible: 2 },
    ];
    for (const test of cases) {
      expect(test.stock).toBe(test.represented);
      expect(Math.floor(test.stock / 2)).toBe(test.eligible);
      const stock = freeze([test.stock, test.stock, test.stock] as const);
      const result = rehearseNpcScout(snapshot({ stock, garrison: { light_fighter: 0, heavy_fighter: 0 } }),
        { small_cargo: 1 }, TECH, 1);
      expect(result.snapshot.stock).toEqual(stock);
      for (const sample of result.samples) {
        expect(sample.survivingCapacity).toBe(test.eligible * 3);
        expect(sample.loot).toEqual([test.eligible, test.eligible, test.eligible]);
      }
    }
  });

  it("crosses a surviving five-unit hold's whole-capacity clamp without epsilon repair", () => {
    const cases: { stock: number; represented: number; capacity: number }[] = [
      { stock: nextDown(10), represented: 9.999999999999998, capacity: 4 },
      { stock: 10, represented: 10, capacity: 5 },
      { stock: nextUp(10), represented: 10.000000000000002, capacity: 5 },
      { stock: nextDown(12), represented: 11.999999999999998, capacity: 5 },
      { stock: 12, represented: 12, capacity: 5 },
      { stock: nextUp(12), represented: 12.000000000000002, capacity: 5 },
    ];
    for (const test of cases) {
      expect(test.stock).toBe(test.represented);
      const result = rehearseNpcScout(snapshot({ stock: [test.stock, 0, 0], garrison: { light_fighter: 0, heavy_fighter: 0 } }),
        { espionage_probe: 1 }, TECH, 1);
      for (const sample of result.samples) {
        expect(sample.survivingCapacity).toBe(test.capacity);
        expect(sample.loot).toEqual([test.capacity, 0, 0]);
      }
    }
  });

  it("keeps M/C/D integer priority at an adjacent stock value under a five-unit hold", () => {
    const cases = [
      { metal: nextDown(6), represented: 5.999999999999999, loot: [2, 3, 0] },
      { metal: 6, represented: 6, loot: [3, 2, 0] },
      { metal: nextUp(6), represented: 6.000000000000001, loot: [3, 2, 0] },
    ];
    for (const test of cases) {
      expect(test.metal).toBe(test.represented);
      const result = rehearseNpcScout(snapshot({ stock: [test.metal, 6, 2], garrison: { light_fighter: 0, heavy_fighter: 0 } }),
        { espionage_probe: 1 }, TECH, 1);
      for (const sample of result.samples) {
        expect(sample.survivingCapacity).toBe(5);
        expect(sample.loot).toEqual(test.loot);
      }
    }
  });

  it("combines exact historical half-stock thresholds with the three fixed combat outcomes", () => {
    // Python binary64 goldens: seeds 1/2 draw with four/three LF, seed 3 wins
    // with four LF. Capacity is 280/210/280; only the winner receives loot.
    const cases = [
      { metal: nextDown(2), loot: [0, 210, 70] },
      { metal: 2, loot: [1, 210, 69] },
      { metal: nextUp(2), loot: [1, 210, 69] },
    ];
    for (const test of cases) {
      const result = rehearseNpcScout(snapshot({ stock: [test.metal, 30000, 10000], garrison: { light_fighter: 3, heavy_fighter: 0 } }),
        { light_fighter: 4 }, TECH, 1.4);
      expect(result.samples.map(sample => sample.seed)).toEqual([608135816, 2242054355, 320440878]);
      expect(result.samples.map(sample => sample.battle.winner)).toEqual(["draw", "draw", "attacker"]);
      expect(result.samples.map(sample => sample.survivingCapacity)).toEqual([280, 210, 280]);
      expect(result.samples.map(sample => sample.loot)).toEqual([[0, 0, 0], [0, 0, 0], test.loot]);
    }
  });

  it("rejects the actual immediately neighboring off-grid cargo factors", () => {
    for (const level of [0, 1, 8, 1000]) {
      const factor = 1 + .05 * level;
      for (const invalid of [nextDown(factor), nextUp(factor)]) {
        expect(invalid).not.toBe(factor);
        expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, TECH, invalid)).toThrow();
      }
    }
  });
});

describe("fail-closed rehearsal boundary", () => {
  it.each([{}, { light_fighter: 0 }, { light_fighter: -0 }])("rejects empty attacking selection %j", ships => {
    expect(() => rehearseNpcScout(snapshot(), ships, TECH, 1)).toThrow();
  });
  it.each([undefined, null, [], "1", true, -1, .5, NaN, Infinity, 1e12 + 1, Number.MAX_SAFE_INTEGER, 1n])("rejects invalid ship count %s without coercion", count => {
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: count }, TECH, 1)).toThrow();
  });
  it.each(["solar_satellite", "rocket_launcher", "unknown", "__proto__", "constructor"])("rejects forbidden zero type %s", key => {
    const ships = Object.create(null) as Record<string, number>;
    ships.light_fighter = 1;
    ships[key] = 0;
    expect(() => rehearseNpcScout(snapshot(), freeze(ships), TECH, 1)).toThrow();
  });
  it.each([undefined, null, [], "1", true, NaN, Infinity, -1, .5, 1001, 1002])("rejects out-of-domain completed technology %s", level => {
    for (const key of ["weapons", "shields", "armour"] as const) {
      expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, { ...TECH, [key]: level }, 1)).toThrow();
    }
  });
  it.each([undefined, null, "1", true, NaN, Infinity, -1, 0, .95, 1.001, 1.0499999999999998, 51.05, 1000])("rejects non-achievable cargo factor %s", factor => {
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, TECH, factor)).toThrow();
  });
  it("rejects whole research/queued levels rather than predicting completion", () => {
    const research = { levels: { weapons_tech: 0, shielding_tech: 0, armour_tech: 0 },
      queue: [{ tech: "weapons_tech", targetLevel: 1, remainingSeconds: 0 }] };
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, research, 1)).toThrow();
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, { ...TECH, queue: research.queue }, 1)).toThrow();
  });

  const slots = ["snapshot", "ships", "tech", "target", "garrison", "defenderTech", "stock"] as const;
  type Slot = typeof slots[number];
  function runHostile(slot: Slot, tamper: (value: object) => unknown): void {
    let historical: unknown = snapshot(), ships: unknown = { light_fighter: 1 }, tech: unknown = { ...TECH };
    if (slot === "snapshot") historical = tamper(historical as object);
    else if (slot === "ships") ships = tamper(ships as object);
    else if (slot === "tech") tech = tamper(tech as object);
    else {
      const record = historical as unknown as Record<string, unknown>;
      record[slot] = tamper(record[slot] as object);
    }
    freeze(historical); freeze(ships); freeze(tech);
    expect(() => rehearseNpcScout(historical, ships, tech, 1)).toThrow();
  }
  it.each(slots)("rejects %s extras, symbols, inherited authority, accessors without executing them", slot => {
    let invoked = 0;
    const getter = () => { invoked += 1; throw Error("getter must not execute"); };
    runHostile(slot, value => Object.assign(value, { forbidden: 0 }));
    runHostile(slot, value => Object.defineProperty(value, Symbol("hidden"), { value: 0, enumerable: true }));
    runHostile(slot, value => Object.defineProperty(value, "hidden", { value: 0, enumerable: false }));
    runHostile(slot, value => Object.setPrototypeOf(value, { inherited: 0 }));
    runHostile(slot, value => {
      const key = Reflect.ownKeys(value).find(key => key !== "length")!;
      Object.defineProperty(value, key, { get: getter, enumerable: true, configurable: true });
      return value;
    });
    runHostile(slot, value => Object.defineProperty(value, "toJSON", { get: getter, enumerable: false }));
    expect(invoked).toBe(0);
  });

  it("rejects coercive data without calling conversion hooks", () => {
    let invoked = 0;
    const coercive = freeze({ valueOf: () => { invoked += 1; return 1; }, toString: () => { invoked += 1; return "1"; } });
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: coercive }, TECH, 1)).toThrow();
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, { ...TECH, weapons: coercive }, 1)).toThrow();
    expect(() => rehearseNpcScout(snapshot(), { light_fighter: 1 }, TECH, coercive)).toThrow();
    expect(() => rehearseNpcScout({ ...snapshot(), observedAt: coercive }, { light_fighter: 1 }, TECH, 1)).toThrow();
    expect(invoked).toBe(0);
  });

  it.each([
    { model: "npc-scout-snapshot-v2" }, { fleetId: 0 }, { fleetId: Number.MAX_SAFE_INTEGER }, { originId: "../home" },
    { target: { galaxy: 0, system: 2, position: 3 } }, { target: { galaxy: 1, system: 101, position: 3 } },
    { target: { galaxy: 1, system: 2, position: 16 } }, { observedAt: "01" }, { observedAt: "-0" }, { observedAt: "-1" },
    { observedAt: "Infinity" }, { observedAt: "NaN" }, { observedAt: "0".repeat(101) },
    { stock: [50000.1, 0, 0] }, { stock: [0, 30000.1, 0] }, { stock: [0, 0, 10000.1] },
    { stock: [-1, 0, 0] }, { stock: [NaN, 0, 0] }, { stock: [0, Infinity, 0] }, { stock: [0, 0] },
    { stock: [0, 0, 0, 0] }, { stock: new Array(3) },
    { garrison: { light_fighter: 9, heavy_fighter: 0 } }, { garrison: { light_fighter: 0, heavy_fighter: 2 } },
    { garrison: { light_fighter: .5, heavy_fighter: 0 } }, { garrison: { light_fighter: -1, heavy_fighter: 0 } },
    { defenderTech: { weapons: 1, shields: 0, armour: 0 } }, { universeSeed: 1 }, { seed: 123 },
  ])("rejects malformed historical snapshot %j", patch => {
    expect(() => rehearseNpcScout(freeze({ ...snapshot(), ...patch }), { light_fighter: 1 }, TECH, 1)).toThrow();
  });

  it("rejects missing fields at every exact-key boundary", () => {
    for (const slot of ["snapshot", "tech", "target", "garrison", "defenderTech"] as const) {
      runHostile(slot, value => {
        Reflect.deleteProperty(value, Reflect.ownKeys(value)[0]);
        return value;
      });
    }
  });
});
