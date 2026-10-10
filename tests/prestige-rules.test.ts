import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildPrestigeFixtures } from "../scripts/prestige-r8-fixtures";
import * as state from "../src/game/state";
import * as save from "../src/game/save";
import * as decimal from "../src/game/decimal";
import * as logic from "../src/game/logic";
import * as orders from "../src/game/orders";
import * as formations from "../src/game/formations";
import * as templates from "../src/game/research-templates";
import * as yard from "../src/game/shipyard";
import * as queue from "../src/game/queue";
import * as fleet from "../src/game/fleet";
import * as empire from "../src/game/empire";
import * as arcade from "../src/game/arcade";
import * as engine from "../src/automation/engine";
import * as deep from "../src/game/deep-space";
import { chargeDeliveryStatus } from "../src/game/deep-state";
import { PRESTIGE_SCORE_UNIT, SCORE_WEIGHTS, STARTING_RESOURCES } from "../src/game/content";
import { CURVATURE_EFFECTS } from "../src/data/curvature-tech";
import { DM_ACHIEVEMENT_REWARD } from "../src/data/dark-matter";
import { passiveCoreBonus, unspentCores } from "../src/prestige/tree";
import type { GameState } from "../src/game/types";

const { big } = decimal;
const { evaluatePrestige, prestige, warpGain } = logic;
const serialize = save.serializeState;
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
let fixtures: Record<string, GameState>;
beforeAll(() => {
  fixtures = buildPrestigeFixtures({ state, save, decimal, logic, orders, formations, templates, yard, queue, fleet, empire, arcade, engine, deep });
  Object.values(fixtures).forEach(freeze);
});
const fixture = (name: string): GameState => fixtures[name]!;
const phase = (value: GameState) => value.orders.tasks[0]!.transport!.trips[0]!.phase;

describe("shared deterministic curvature rules", () => {
  it.each([[0, 0], [0.99999, 0], [1, 1], [3.99999, 1], [4, 2], [9, 3]])("keeps threshold and square boundary %s", (multiple, expected) => {
    const before = state.createInitialState(42, 771);
    before.lifetime.metal = big(PRESTIGE_SCORE_UNIT).mul(multiple).div(SCORE_WEIGHTS.metal);
    freeze(before);
    const result = evaluatePrestige(before);
    expect(result.gain.eq(expected)).toBe(true);
    expect(result.gain.eq(warpGain(before))).toBe(true);
    if (!expected) expect(result.next).toBe(before);
    else expect(result.next.warpCores.eq(expected)).toBe(true);
  });

  it("keeps the real score boost, seed stock, core arithmetic and large-number precision", () => {
    const before = state.createInitialState(42, 771);
    before.curvature.score_boost = 1;
    before.curvature.seed_stock = 1;
    before.warpCores = big(10);
    before.lifetime.metal = big(PRESTIGE_SCORE_UNIT).mul(3.2).div(SCORE_WEIGHTS.metal);
    const { gain, next } = evaluatePrestige(freeze(before));
    expect(gain.eq(2)).toBe(true);
    expect(next.warpCores.eq(12)).toBe(true);
    expect(unspentCores(next).sub(unspentCores(before)).eq(gain)).toBe(true);
    expect(passiveCoreBonus(next).gt(passiveCoreBonus(before))).toBe(true);
    expect(next.planets[0]!.resources.metal.eq(STARTING_RESOURCES.metal + CURVATURE_EFFECTS.seed.metal)).toBe(true);
    expect(next.planets[0]!.resources.crystal.eq(STARTING_RESOURCES.crystal + CURVATURE_EFFECTS.seed.crystal)).toBe(true);
    expect(next.lifetime).toEqual({ metal: big(0), crystal: big(0), deuterium: big(0) });
    const huge = { ...before, warpCores: big("1e100") };
    const hugeResult = evaluatePrestige(huge);
    expect(hugeResult.gain.eq(2)).toBe(true);
    expect(hugeResult.next.warpCores.eq(huge.warpCores.add(hugeResult.gain))).toBe(true);
    expect(hugeResult.next.warpCores.eq(huge.warpCores)).toBe(true);
    const enormousScore = { ...huge, lifetime: { ...huge.lifetime, metal: big("1e1000") } };
    const enormous = evaluatePrestige(enormousScore);
    expect(enormous.gain.eq(warpGain(enormousScore))).toBe(true);
    expect(enormous.gain.gt("1e497")).toBe(true);
    expect(enormous.next.warpCores.eq(enormousScore.warpCores.add(enormous.gain))).toBe(true);
  });

  it("evaluates every deeply frozen rich case repeatedly without external entropy or input changes", () => {
    const snapshots = Object.fromEntries(Object.entries(fixtures).map(([name, before]) => [name, serialize(before)]));
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("unexpected external entropy"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("unexpected wall time"); });
    try {
      for (const [name, before] of Object.entries(fixtures)) {
        const first = evaluatePrestige(before), second = evaluatePrestige(before);
        expect(serialize(second.next), name).toEqual(serialize(first.next));
        expect(serialize(prestige(before)), name).toEqual(serialize(first.next));
        expect(serialize(before), name).toEqual(snapshots[name]);
        expect(first.next.totalTime, name).toBe(before.totalTime);
        expect(typeof first.next.planets[0]!.resources.metal.add).toBe("function");
      }
      expect(random).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    } finally { random.mockRestore(); now.mockRestore(); }
  });

  it("preserves fresh entropy for ordinary new games and one-seed callers", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const now = vi.spyOn(Date, "now").mockReturnValue(123456);
    try {
      const newGame = state.createInitialState(), explicitWorld = state.createInitialState(42);
      const expected = (Math.floor(0.25 * 4294967296) ^ 123456) >>> 0;
      expect(newGame.arcade.seed).toBe(expected);
      expect(newGame.universe.seed).toBe(expected);
      expect(explicitWorld.arcade.seed).toBe(expected);
      expect(explicitWorld.universe.seed).toBe(42);
      expect(random).toHaveBeenCalledTimes(2);
      expect(now).toHaveBeenCalledTimes(2);
      expect(state.createInitialState(42, 0).arcade.seed).toBe(0);
      expect(random).toHaveBeenCalledTimes(2);
      expect(now).toHaveBeenCalledTimes(2);
    } finally { random.mockRestore(); now.mockRestore(); }
  });

  it("drops real paid work without refund, retaining levels, IDs, ledgers and old formation origin", () => {
    const before = fixture("rich"), next = evaluatePrestige(before).next;
    expect(before.planets[0]!.buildQueue).toHaveLength(1);
    expect(before.planets[1]!.shipyardQueue[0]).toMatchObject({ count: 8, orderedCount: 10, source: "plan" });
    expect(before.research.queue[0]).toMatchObject({ source: "plan", planetId: before.planets[1]!.id });
    expect(next.planets).toHaveLength(1);
    expect(next.planets[0]!.buildQueue).toEqual([]);
    expect(next.planets[0]!.shipyardQueue).toEqual([]);
    expect(Object.values(next.planets[0]!.units).every(value => value === 0)).toBe(true);
    expect(next.planets[0]!.resources).toEqual({ metal: big(600), crystal: big(520), deuterium: big(0) });
    expect(next.research).toEqual({ levels: before.research.levels, queue: [] });
    expect(next.nextFleetId).toBe(before.nextFleetId);
    expect(next.orders).toMatchObject({ nextTaskId: before.orders.nextTaskId, nextJobId: before.orders.nextJobId, nextWorkId: before.orders.nextWorkId, accumulator: 0 });
    for (const [index, original] of before.orders.tasks.entries()) {
      const retired = next.orders.tasks[index]!;
      expect(retired).toMatchObject({ budget: original.budget, charged: original.charged, refunded: original.refunded, completedUnits: original.completedUnits });
      expect(retired.activeJob).toBeNull();
      expect(retired.currentWork).toBeNull();
      expect(retired.status).toBe("cancelled");
    }
    expect(next.formations).toEqual(before.formations);
    expect(next.formations.entries[0]).toMatchObject({ revision: 2, name: "Edited synthetic wing", ships: { small_cargo: 4 } });
    expect(next.orders.tasks[0]!.formationOrigin).toEqual(before.orders.tasks[0]!.formationOrigin);
    expect(next.orders.tasks[0]!.formationOrigin!.formation).toMatchObject({ revision: 1, name: "Original synthetic wing", ships: { light_fighter: 10 } });
    expect(next.orders.tasks[0]!.transport).toBeNull();
    expect(formations.deleteFormation(next, { formationId: 1, expectedRevision: 2 }).ok).toBe(false);
    expect(next.researchTemplates).toEqual(before.researchTemplates);
    expect(next.researchTemplates.templates[0]!.goals).not.toBe(before.researchTemplates.templates[0]!.goals);
    expect(next.orders.tasks[1]).not.toHaveProperty("templateOrigin");
    expect(serialize(save.deserializeState(save.importSave(save.exportSave(next, 1234)).state))).toEqual(serialize(next));
  });

  it("retires actual owned outbound, delivered, recalled and blocked legs, keeping real outcomes", () => {
    for (const name of ["outbound", "delivered", "recalled", "blocked"]) {
      const before = fixture(name), oldPhase = phase(before), next = evaluatePrestige(before).next;
      expect(before.fleets).toHaveLength(1);
      expect(next.fleets, name).toEqual([]);
      expect(phase(next), name).toEqual({ kind: "prestige-retired", outcome: oldPhase.kind === "outbound" ? null : oldPhase.outcome });
      expect(next.orders.tasks[0]).toMatchObject({ status: "cancelled", currentWork: null, activeJob: null,
        charged: before.orders.tasks[0]!.charged, refunded: before.orders.tasks[0]!.refunded });
      expect(next.orders.tasks[0]!.transport!.authorization).toEqual(before.orders.tasks[0]!.transport!.authorization);
    }
    expect(phase(fixture("blocked"))).toMatchObject({ kind: "returning", dockBlocked: true, outcome: { kind: "not-delivered", reason: "manual-recall" } });
    const delivered = fixture("delivered");
    expect(delivered.fleets[0]!.cargo).toEqual(fleet.emptyCargo());
    expect(delivered.orders.tasks[0]!.transport!.trips[0]!.cargo.metal).toBe("60");
    expect(evaluatePrestige(delivered).next.planets[0]!.resources.metal.eq(600)).toBe(true);
    const returned = fixture("returned"), returnedNext = evaluatePrestige(returned).next;
    expect(returned.fleets).toEqual([]);
    expect(phase(returnedNext)).toEqual({ kind: "returned", outcome: { kind: "delivered" } });
    expect(fixture("completed").orders.tasks[0]!.status).toBe("completed");
    expect(evaluatePrestige(fixture("completed")).next.orders.tasks[0]!.status).toBe("completed");
  });

  it("keeps ring tickets and audit while stopping its authority, preserving other configured protocols", () => {
    const before = fixture("rich"), next = evaluatePrestige(before).next;
    expect(before.arcade.autoBatch!.armed).toBe(true);
    expect(next.arcade.autoBatch).toMatchObject({ ...before.arcade.autoBatch, armed: false, stopReason: "重置后需要重新授权自动批次" });
    expect(next.arcade.runs).toEqual(before.arcade.runs);
    expect(next.arcade.seed).toBe(before.arcade.seed);
    expect(next.arcade.nextRunId).toBe(before.arcade.nextRunId);
    expect(next.protocols.slots[0]!.card!.enabled).toBe(false);
    expect(next.protocols.slots[1]).toEqual(before.protocols.slots[1]);
    expect(next.protocols.slots[1]!.card!.enabled).toBe(true);
    expect(next.protocols.accumulator).toBe(0);
    expect(engine.unlockedSlotCount(next)).toBeLessThan(engine.unlockedSlotCount(before));
    expect(next.boosters).toEqual(before.boosters);
    expect(next.items).toEqual(before.items);
    expect(next.stats).toMatchObject({ launches: before.stats.launches + 1, manualActions: 0, automatedLaunches: before.stats.automatedLaunches });
    expect(next.darkMatter.sub(before.darkMatter).eq((next.unlocked.length - before.unlocked.length) * DM_ACHIEVEMENT_REWARD)).toBe(true);
  });

  it("drops unsettled escrow and undelivered charge rewards without paying or rerolling retained reports", () => {
    expect(fixture("pending").fleets[0]!.charge).toMatchObject({ reportId: null, phase: "outbound" });
    expect(fixture("pending").fleets[0]!.charge!.stake).toBeGreaterThan(0);
    expect(fixture("dmReturn").fleets[0]!.charge!.dm).toBeGreaterThan(0);
    expect(Object.values(fixture("supplyReturn").fleets[0]!.charge!.items).some(value => (value ?? 0) > 0)).toBe(true);
    for (const name of ["pending", "dmReturn", "supplyReturn", "withDebris", "chargeReturned", "destroyed"]) {
      const before = fixture(name), next = evaluatePrestige(before).next;
      expect(next.fleets).toEqual([]);
      expect(next.deepSpace).toEqual({ ...before.deepSpace, offers: [], debris: [] });
      expect(next.arcade.runs).toEqual(before.arcade.runs);
      expect(next.items).toEqual(before.items);
      expect(next.darkMatter.sub(before.darkMatter).eq((next.unlocked.length - before.unlocked.length) * DM_ACHIEVEMENT_REWARD)).toBe(true);
    }
    expect(fixture("withDebris").deepSpace.offers).not.toEqual([]);
    expect(fixture("withDebris").deepSpace.debris).not.toEqual([]);
    for (const name of ["dmReturn", "supplyReturn"]) {
      const next = evaluatePrestige(fixture(name)).next;
      expect(chargeDeliveryStatus(next, next.deepSpace.reports[0]!)).toBe("任务已结束（未入港奖励不保留）");
    }
    expect(fixture("chargeReturned").deepSpace.reports[0]!.returned).toBe(true);
    expect(fixture("destroyed").deepSpace.reports[0]!.destroyed).toBe(true);
  });

  it("may deterministically roll an actual newly earned achievement only in the candidate", () => {
    const before = state.createInitialState(42, 771);
    before.research.levels.astrophysics = 1;
    before.lifetime.metal = big(PRESTIGE_SCORE_UNIT).mul(4).div(SCORE_WEIGHTS.metal);
    const saved = serialize(before);
    freeze(before);
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("external entropy"); });
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw Error("wall clock"); });
    try {
      const a = evaluatePrestige(before), b = evaluatePrestige(before);
      expect(serialize(a.next)).toEqual(serialize(b.next));
      expect(a.next.arcade.seed).not.toBe(before.arcade.seed);
      expect(a.next.arcade.runs).toHaveLength(1);
      expect(a.next.arcade.nextRunId).toBe(before.arcade.nextRunId + 1);
      expect(a.next.unlocked).toContain("astrophysics_1");
      expect(a.next.stats.automatedLaunches).toBe(before.stats.automatedLaunches + 1);
      expect(serialize(before)).toEqual(saved);
      expect(random).not.toHaveBeenCalled();
      expect(now).not.toHaveBeenCalled();
    } finally { random.mockRestore(); now.mockRestore(); }
  });
});
