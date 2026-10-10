import { afterEach, describe, expect, it, vi } from "vitest";
import { armAutoRunner, equipCard } from "../src/automation/engine";
import { DEEP } from "../src/data/deep-space";
import { grantRun } from "../src/game/arcade";
import { big } from "../src/game/decimal";
import { storedRunLimit } from "../src/game/deep-state";
import { activePlanet } from "../src/game/empire";
import * as fleet from "../src/game/fleet";
import { emptyCargo, quoteFlight, recallFleet, sendFleet, type FleetRequest } from "../src/game/fleet";
import { createFormation } from "../src/game/formations";
import { coordinateKey, distance, npcAt, planetProperties, positionBonus, SPACE, type Coordinates } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { createOffer } from "../src/game/merchant";
import { createOrderTask } from "../src/game/orders";
import { createPlanet, HOMEWORLD_ID } from "../src/game/planet";
import { enqueue } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { createResearchTemplate } from "../src/game/research-templates";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { enqueueUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { expansionNavigation, type ExpansionQuote } from "../src/ui/expansion-navigation-model";

afterEach(() => vi.restoreAllMocks());

/** Save-reader-valid fixtures; configured stock/levels do not claim a from-new-game playthrough. */
function valid(state: GameState): GameState {
  const read = deserializeState(importSave(exportSave(state, 123)).state);
  const second = deserializeState(importSave(exportSave(read, 123)).state);
  expect(serializeState(second)).toEqual(serializeState(read));
  return read;
}
function ready(): GameState {
  const state = createInitialState(42, 4242), home = activePlanet(state);
  home.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
  Object.assign(home.units, { colony_ship: 8, small_cargo: 12, recycler: 3, espionage_probe: 5 });
  Object.assign(state.research.levels, { astrophysics: 4, computer_tech: 6, impulse_drive: 3, combustion_drive: 6, shielding_tech: 2 });
  return valid(state);
}
function emptyPositions(state: GameState, cursor = activePlanet(state).coordinates): Coordinates[] {
  return Array.from({ length: 15 }, (_, index) => ({ ...cursor, position: index + 1 })).filter(target =>
    !npcAt(state, target) && !state.planets.some(planet => coordinateKey(planet.coordinates) === coordinateKey(target))
    && !state.fleets.some(value => value.mission === "colonize" && !value.returning && coordinateKey(value.target) === coordinateKey(target)));
}
function request(target: Coordinates, mission: "colonize" | "charge" | "recycle" = "colonize"): FleetRequest {
  return { mission, target: { ...target }, ships: mission === "colonize" ? { colony_ship: 1 } : mission === "charge" ? { small_cargo: 1 } : { recycler: 1 },
    cargo: emptyCargo(), speedPercent: 100, ...(mission === "charge" ? { holdSlots: 1, chargeWithBets: false } : {}) };
}
function apply(result: { state: GameState; ok: boolean; reason: string }): GameState {
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
function compareQuote(shown: ExpansionQuote, state: GameState, command: FleetRequest): void {
  const actual = quoteFlight(state, command);
  expect(shown.ok).toBe(actual.ok);
  expect(shown.reason).toBe(actual.reason);
  if (shown.ok) {
    expect(shown.duration).toBe(actual.duration);
    expect(shown.fuel).toBe(actual.fuel.toString());
    expect(shown.capacity).toBe(actual.capacity.toString());
    expect(shown.holdSeconds).toBe(actual.holdSeconds ?? 0);
    expect(shown.stake).toBe(actual.stake ?? 0);
    expect(shown.duration).toBeGreaterThan(0);
    expect(big(shown.fuel).gt(0)).toBe(true);
  } else {
    expect(shown.text).toBe(actual.reason);
    for (const key of ["duration", "fuel", "capacity", "holdSeconds", "stake"]) expect(shown).not.toHaveProperty(key);
  }
}

/** Collections are populated by real mutation APIs, then verified by the strict save reader. */
function populated(): GameState {
  let state = ready();
  const colonyTarget = emptyPositions(state)[0]!;
  state = apply(sendFleet(state, request(colonyTarget)));
  state = tick(state, state.fleets[0]!.duration);
  const home = activePlanet(state);
  Object.assign(home.buildings, { robotics_factory: 2, shipyard: 4, research_lab: 3 });
  Object.assign(state.research.levels, { energy_tech: 3, espionage_tech: 4 });
  state = apply(enqueue(state, "metal_mine", "manual"));
  state = apply(enqueueResearch(state, "computer_tech", "manual"));
  state = apply(enqueueUnits(state, "colony_ship", 2, "manual"));
  state = apply(createOrderTask(state, { kind: "building", planetId: state.planets[1]!.id, building: "crystal_mine", targetLevel: 2,
    expectedNextTaskId: state.orders.nextTaskId, budget: { metal: "10000", crystal: "10000", deuterium: "0" } }));
  state = apply(createFormation(state, { name: "远航编成", ships: { small_cargo: 3, colony_ship: 1 }, expectedNextFormationId: 1 }));
  state = apply(createResearchTemplate(state, { name: "扩张研究", goals: [{ tech: "astrophysics", targetLevel: 5 }] }, 1));
  state = grantRun(state, "bonus").state;
  state.arcade.stats.manualRuns = 10;
  if (!state.unlockedCards.includes("auto_runner")) state.unlockedCards.push("auto_runner");
  state = equipCard(state, 0, "auto_runner").state;
  state = apply(armAutoRunner(state, 0, { planetId: HOMEWORLD_ID, count: 1, maxDeuterium: "0" }));
  state = createOffer(state, HOMEWORLD_ID, 123, true).state;
  state.deepSpace.debris = [{ target: { ...home.coordinates, position: 16 }, metal: "2300", crystal: "2900" }];
  state.darkMatter = big(2000);
  state.items.kraken_box = 2;
  state.boosters = [{ res: "metal", pct: 10, until: 1000 }];
  state = apply(sendFleet(state, request(emptyPositions(state)[0]!)));
  return valid(state);
}

describe("bounded read-only expansion navigation", () => {
  it("returns exactly the current system's 16 unique statuses, without a launch-ready flag", () => {
    const state = ready(), cursor = { galaxy: 5, system: 100, position: 8 };
    const model = expansionNavigation(state, cursor, 1);
    expect(model.positions).toHaveLength(16);
    expect(model.positions.map(row => row.position)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(new Set(model.positions.map(row => row.key)).size).toBe(16);
    expect(model.positions.every(row => row.key.startsWith("5:100:"))).toBe(true);
    expect(model.positions[15]!.status).toBe("deep");
    expect(model.positions.every(row => !("canColonize" in row))).toBe(true);
    expect(model.system).toMatchObject({ galaxy: 5, system: 100 });
  });
  it("reports owned, NPC, outbound reservation, empty and deep separately in one system", () => {
    let state = ready();
    const [ownedTarget, reservedTarget] = emptyPositions(state);
    state.planets.push(createPlanet("fixture-colony", ownedTarget!));
    state = valid(apply(sendFleet(state, request(reservedTarget!))));
    const model = expansionNavigation(state, reservedTarget!, reservedTarget!.position);
    expect(new Set(model.positions.map(row => row.status))).toEqual(new Set(["owned", "npc", "reserved", "empty", "deep"]));
    expect(model.selected.status).toBe("reserved");
    expect(model.selected.scenarios[0]!.quote.reason).toBe("该位置已有殖民舰队在途");
    expect(model.positions[ownedTarget!.position - 1]!.status).toBe("owned");
  });
  it("uses saved owned-world properties and the homeworld's actual baseline", () => {
    const state = ready(), home = activePlanet(state);
    home.tempMax = 17; home.fieldsMax = 199;
    const model = expansionNavigation(valid(state), home.coordinates, home.coordinates.position);
    expect(model.selected.properties).toMatchObject({ source: "stored", tempMin: -23, tempMax: 17, fieldsMax: 199 });
    expect(model.selected.bonuses).toMatchObject({ homeBaseline: true, metal: 1, crystal: 1, deuterium: 1 });
    expect(model.selected.bonuses!.label).toContain("母星基准");
    expect(model.selected.scenarios[0]!.quote.reason).toBe("不能向当前星球派遣舰队");
  });
  it.each([1, 3, 6, 8, 10, 15])("uses actual position bonus for owned colony at position %i", position => {
    const state = ready(), target = { galaxy: 2, system: 1, position };
    state.planets.push({ ...createPlanet("fixture-colony", target), tempMax: -12, fieldsMax: 177 });
    const model = expansionNavigation(valid(state), target, position);
    expect(model.selected.properties).toMatchObject({ source: "stored", tempMax: -12, fieldsMax: 177 });
    expect(model.selected.bonuses).toMatchObject({ homeBaseline: false, metal: positionBonus(position, "metal"), crystal: positionBonus(position, "crystal") });
  });
  it("labels non-owned generated properties provisional and never projects them onto the homeworld", () => {
    const state = ready(), target = emptyPositions(state)[0]!;
    const model = expansionNavigation(state, target, target.position);
    expect(model.selected.properties).toMatchObject({ source: "provisional", ...planetProperties(state.universe.seed, target) });
    expect(model.selected.properties!.label).toContain("暂定");
    expect(model.selected.note).toContain("不代表可立即殖民");
  });
  it("quotes from the actual selected origin without adopting the inspected owned world", () => {
    const state = ready(), colony = createPlanet("remote", { galaxy: 5, system: 100, position: 8 });
    colony.name = "真实出发港"; colony.units.colony_ship = 1; colony.resources.deuterium = big(1e6);
    state.planets.push(colony); state.activePlanetId = colony.id;
    const checked = valid(state), target = emptyPositions(checked, { galaxy: 1, system: 1, position: 1 })[0]!;
    const before = exportSave(checked, 123), model = expansionNavigation(checked, target, target.position);
    expect(model.origin).toMatchObject({ id: colony.id, name: "真实出发港", coordinates: colony.coordinates });
    expect(model.origin.label).toContain("实际出发星球");
    expect(model.selected.distance).toBe(distance(colony.coordinates, target));
    expect(model.selected.distance).toBe(20000);
    compareQuote(model.selected.scenarios[0]!.quote, checked, request(target));
    expect(exportSave(checked, 123)).toBe(before);
  });
  it.each([
    [{ galaxy: 1, system: 1, position: 8 }, { galaxy: 1, system: 100, position: 1 }, 2795],
    [{ galaxy: 1, system: 1, position: 8 }, { galaxy: 5, system: 1, position: 1 }, 20000],
    [{ galaxy: 1, system: 1, position: 8 }, { galaxy: 1, system: 1, position: 9 }, 1005],
  ] as const)("uses ring distance from %j to %j", (origin, target, expected) => {
    const state = ready(); activePlanet(state).coordinates = { ...origin };
    expect(expansionNavigation(valid(state), target, target.position).selected.distance).toBe(expected);
  });
  it.each([0, 17, -1, 1.5, NaN, Infinity])("normalizes invalid local selection %s without changing the cursor", selection => {
    const state = ready(), cursor = { galaxy: 5, system: 100, position: 16 }, before = { ...cursor };
    expect(expansionNavigation(state, cursor, selection).selected.position).toBe(1);
    expect(cursor).toEqual(before);
  });
  it("rejects invalid browsed systems rather than generating extra-universe results", () => {
    expect(() => expansionNavigation(ready(), { galaxy: 1, system: 101, position: 8 }, 1)).toThrow("浏览星系坐标无效");
  });
  it("does not retain mutable references to coordinates or owned properties", () => {
    const state = ready(), home = activePlanet(state), before = serializeState(state);
    const model = expansionNavigation(state, home.coordinates, home.coordinates.position);
    model.origin.coordinates.galaxy = 4; model.selected.coordinates.position = 1;
    model.selected.properties!.tempMax = 999;
    expect(serializeState(state)).toEqual(before);
  });
});

describe("expansion capacities and completed prerequisites", () => {
  it.each([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [199, 100], [200, 100], [1000, 500]])("completed astrophysics %i gives colony limit %i", (level, limit) => {
    const state = ready(); state.research.levels.astrophysics = level;
    const model = expansionNavigation(valid(state), activePlanet(state).coordinates, 1);
    expect(model.capacity.colonies).toMatchObject({ used: 0, reserved: 0, limit });
    expect(model.capacity.planets).toMatchObject({ used: 1, limit: 100 });
    expect(model.research.astrophysics).toBe(level);
  });
  it("releases a recalled colony reservation but keeps the returning fleet slot", () => {
    let state = ready(); state.research.levels.astrophysics = 1;
    const target = emptyPositions(state)[0]!;
    state = apply(sendFleet(state, request(target)));
    let model = expansionNavigation(valid(state), target, target.position);
    expect(model.capacity.colonies).toMatchObject({ used: 0, limit: 1, reserved: 1, remaining: 0 });
    expect(model.capacity.planets).toMatchObject({ used: 1, reserved: 1, remaining: 98 });
    expect(model.capacity.fleets).toMatchObject({ used: 1, returning: 0 });
    state = tick(state, .1); state = valid(apply(recallFleet(state, state.fleets[0]!.id)));
    model = expansionNavigation(state, target, target.position);
    expect(model.selected.status).toBe("empty");
    expect(model.capacity.colonies).toMatchObject({ reserved: 0, remaining: 1 });
    expect(model.capacity.planets.reserved).toBe(0);
    expect(model.capacity.fleets).toMatchObject({ used: 1, returning: 1 });
    expect(model.selected.scenarios[0]!.quote.ok).toBe(true);
  });
  it("reads queued local shipyard and research upgrades as unfinished facts", () => {
    let state = ready();
    const home = activePlanet(state);
    Object.assign(home.buildings, { shipyard: 3, robotics_factory: 2, research_lab: 3 });
    Object.assign(state.research.levels, { energy_tech: 1, impulse_drive: 2, astrophysics: 0 });
    state = apply(enqueue(state, "shipyard", "manual"));
    state = valid(apply(enqueueResearch(state, "impulse_drive", "manual")));
    const target = emptyPositions(state)[0]!, model = expansionNavigation(state, target, target.position);
    expect(model.prerequisites.find(group => group.id === "colony_ship")!.requirements).toMatchObject([
      { id: "shipyard", completed: 3, required: 4, met: false }, { id: "impulse_drive", completed: 2, required: 3, met: false },
    ]);
    expect(model.capacity.colonies.limit).toBe(0);
    expect(model.selected.scenarios[0]!.quote.reason).toBe("殖民地名额不足，需提升天体物理学");
  });
  it("does not count queued astrophysics or computer levels in capacities", () => {
    let state = ready(); activePlanet(state).buildings.research_lab = 3;
    state.research.levels.astrophysics = 2; state.research.levels.espionage_tech = 4;
    state = apply(enqueueResearch(state, "astrophysics", "manual"));
    state = valid(apply(enqueueResearch(state, "computer_tech", "manual")));
    const model = expansionNavigation(state, activePlanet(state).coordinates, 1);
    expect(model.capacity.colonies.limit).toBe(1);
    expect(model.capacity.fleets.limit).toBe(7);
    expect(model.research).toMatchObject({ astrophysics: 2, computerTech: 6 });
  });
  it("allows existing colony ships despite missing construction requirements", () => {
    const state = ready(); state.research.levels.impulse_drive = 0;
    const target = emptyPositions(state)[0]!, model = expansionNavigation(valid(state), target, target.position);
    const group = model.prerequisites.find(value => value.id === "colony_ship")!;
    expect(group.requirements.every(value => !value.met)).toBe(true);
    expect(group.note).toContain("新造舰船");
    expect(model.selected.scenarios[0]!.quote.ok).toBe(true);
    compareQuote(model.selected.scenarios[0]!.quote, state, request(target));
  });
  it("uses active origin local buildings, never a richer remote shipyard", () => {
    const state = ready(), colony = createPlanet("remote", { galaxy: 2, system: 1, position: 8 });
    activePlanet(state).buildings.shipyard = 9; colony.buildings.shipyard = 1;
    state.planets.push(colony); state.activePlanetId = colony.id;
    const model = expansionNavigation(valid(state), activePlanet(state).coordinates, 1);
    expect(model.prerequisites.find(value => value.id === "colony_ship")!.requirements[0]).toMatchObject({ completed: 1, required: 4, met: false });
  });
  it.each([99, 100])("strict-reader-valid %i-world capacity fixture separates the global safety cap", count => {
    let state = ready(); state.research.levels.astrophysics = 1000;
    // Directly populated, unique legal worlds test the reader-valid bound, not a playthrough.
    for (let index = 0; index < count - 1; index++) state.planets.push(createPlanet(`capacity-${index}`, { galaxy: 2, system: 1 + Math.floor(index / 15), position: 1 + index % 15 }));
    const target = emptyPositions(state)[0]!;
    if (count === 99) state = apply(sendFleet(state, request(target)));
    state = valid(state);
    const other = emptyPositions(state)[0]!, model = expansionNavigation(state, other, other.position);
    expect(model.capacity.colonies.limit).toBe(500);
    expect(model.capacity.colonies.remaining).toBeGreaterThan(0);
    expect(model.capacity.planets).toMatchObject({ used: count, limit: 100, reserved: count === 99 ? 1 : 0, remaining: 0 });
    expect(model.selected.scenarios[0]!.quote.reason).toBe("已达到开发版星球安全上限");
  });
  it("strict-reader-valid 1000-fleet fixture enforces the cap and counts returns", () => {
    let state = ready(); state.research.levels.computer_tech = 1000;
    const target = emptyPositions(state)[0]!;
    const sample = apply(sendFleet(state, { ...request(target), mission: "scout", ships: { espionage_probe: 1 } })).fleets[0]!;
    // Structural population at the strict-reader limit, not 1000 gameplay dispatches.
    state.fleets = Array.from({ length: SPACE.maxFleets }, (_, index) => ({ ...sample, id: index + 1, returning: index % 2 === 1, target: { ...sample.target }, ships: { ...sample.ships }, cargo: emptyCargo() }));
    state.nextFleetId = SPACE.maxFleets + 1; state = valid(state);
    const model = expansionNavigation(state, target, target.position);
    expect(model.capacity.fleets).toMatchObject({ used: 1000, limit: 1000, returning: 500, remaining: 0 });
    expect(model.selected.scenarios[0]!.quote.reason).toBe("舰队槽位已满");
  });
});

describe("selected-only authoritative expansion quotes", () => {
  it("makes just one exact one-colony-ship quote for any planetary selection", () => {
    const state = ready(), target = emptyPositions(state)[0]!, spy = vi.spyOn(fleet, "quoteFlight");
    const model = expansionNavigation(state, target, target.position);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(state, request(target));
    expect(model.selected.scenarios).toHaveLength(1);
    expect(model.selected.scenarios[0]).toMatchObject({ mission: "colonize", shipId: "colony_ship", availableShips: 8 });
    expect(model.selected.scenarios[0]!.assumptions).toContain("100% 速度 · 零货物");
    compareQuote(model.selected.scenarios[0]!.quote, state, request(target));
  });
  it("quotes even occupied selections and preserves engine first-failure ordering", () => {
    const state = ready(), home = activePlanet(state); home.units.colony_ship = 0;
    const model = expansionNavigation(valid(state), home.coordinates, home.coordinates.position);
    expect(model.selected.scenarios[0]!.quote.reason).toBe("不能向当前星球派遣舰队");
    compareQuote(model.selected.scenarios[0]!.quote, state, request(home.coordinates));
  });
  it("shows the exact first failure without fake zero ETA, fuel or capacity", () => {
    const state = createInitialState(42, 4242), target = emptyPositions(state)[0]!;
    const model = expansionNavigation(valid(state), target, target.position);
    expect(model.selected.status).toBe("empty");
    expect(model.selected.scenarios[0]!.quote.reason).toBe("殖民船 数量不足");
    compareQuote(model.selected.scenarios[0]!.quote, state, request(target));
  });
  it("reflects actual origin fuel and completed drive/cargo technology changes", () => {
    const state = ready(), target = emptyPositions(state)[0]!;
    const initial = expansionNavigation(state, target, target.position).selected.scenarios[0]!.quote;
    state.research.levels.impulse_drive = 12; state.research.levels.hyperspace_tech = 10;
    const updated = expansionNavigation(valid(state), target, target.position).selected.scenarios[0]!.quote;
    expect(initial.ok && updated.ok).toBe(true);
    if (initial.ok && updated.ok) {
      expect(updated.duration).toBeLessThanOrEqual(initial.duration);
      expect(big(updated.capacity).eq(big(initial.capacity).mul(1.5))).toBe(true);
    }
    compareQuote(updated, state, request(target));
    activePlanet(state).resources.deuterium = big(0);
    const failed = expansionNavigation(valid(state), target, target.position).selected.scenarios[0]!.quote;
    expect(failed.reason).toBe("重氢（含往返燃料）不足");
    compareQuote(failed, state, request(target));
  });
  it("deep space has no planetary properties, bonuses or colonize scenario, and exactly two quotes", () => {
    const state = ready(), target = { ...activePlanet(state).coordinates, position: 16 };
    state.deepSpace.debris = [{ target, metal: "123", crystal: "456" }];
    const checked = valid(state), spy = vi.spyOn(fleet, "quoteFlight"), model = expansionNavigation(checked, target, 16);
    expect(model.selected).toMatchObject({ status: "deep", properties: null, bonuses: null });
    expect(model.selected.scenarios.map(value => value.mission)).toEqual(["charge", "recycle"]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, checked, request(target, "charge"));
    expect(spy).toHaveBeenNthCalledWith(2, checked, request(target, "recycle"));
    for (const value of model.selected.scenarios) compareQuote(value.quote, checked, request(target, value.mission));
    const quote = model.selected.scenarios[0]!.quote;
    expect(quote.ok).toBe(true);
    if (quote.ok) { expect(quote.holdSeconds).toBe(DEEP.segmentSeconds); expect(quote.stake).toBe(0); }
    expect(model.selected.scenarios[0]!.risk).toContain("战损或全损");
    expect(model.selected.scenarios[1]!.risk).toContain("不保证回收收益");
  });
  it("never opts the deep reference scenario into the player's standing bets", () => {
    const state = ready(), target = { ...activePlanet(state).coordinates, position: 16 };
    state.arcade.bets = { metal: 1, crystal: 2, deuterium: 3, drifter: 1 };
    const checked = valid(state), before = exportSave(checked, 123), model = expansionNavigation(checked, target, 16);
    expect(model.selected.scenarios[0]!.assumptions).toContain("驻留 1 段 · 无押注");
    expect(model.selected.scenarios[0]!.quote).toMatchObject({ ok: true, stake: 0, holdSeconds: 60 });
    expect(exportSave(checked, 123)).toBe(before);
  });
  it("returns authoritative deep failures for missing research and absent debris", () => {
    const state = createInitialState(42, 4242), target = { ...activePlanet(state).coordinates, position: 16 };
    const model = expansionNavigation(valid(state), target, 16);
    expect(model.selected.scenarios[0]!.quote.reason).toBe("远征槽不足：需要天体物理，返航也占槽");
    expect(model.selected.scenarios[1]!.quote.reason).toBe("目标没有可回收残骸");
    for (const value of model.selected.scenarios) compareQuote(value.quote, state, request(target, value.mission));
  });
  it("counts a returning charge against expedition slots after its reservation is released", () => {
    let state = ready(); state.research.levels.astrophysics = 1;
    const target = { ...activePlanet(state).coordinates, position: 16 };
    state = apply(sendFleet(state, request(target, "charge")));
    state = tick(state, .1); state = valid(apply(recallFleet(state, state.fleets[0]!.id)));
    const model = expansionNavigation(state, target, 16);
    expect(model.capacity.expeditions).toMatchObject({ used: 1, limit: 1 });
    expect(model.capacity.fleets).toMatchObject({ used: 1, returning: 1 });
    expect(model.capacity.colonies.reserved).toBe(0);
    expect(model.selected.scenarios[0]!.quote.reason).toBe("远征槽不足：需要天体物理，返航也占槽");
  });
  it("reports filled stored-run reservations and exhausted run IDs with exact first reasons", () => {
    let state = ready(); const target = { ...activePlanet(state).coordinates, position: 16 };
    while (state.arcade.runs.length < storedRunLimit(state)) state = grantRun(state, "bonus").state;
    state = valid(state);
    expect(expansionNavigation(state, target, 16).selected.scenarios[0]!.quote.reason).toBe("充能开奖预留已满，先揭晓存量");
    state.arcade.nextRunId = Number.MAX_SAFE_INTEGER;
    state = valid(state);
    expect(expansionNavigation(state, target, 16).selected.scenarios[0]!.quote.reason).toBe("开奖次数编号已用尽或已被在途充能预留");
  });
  it("does not use ship construction prerequisites as a deep dispatch gate", () => {
    const state = ready(); state.research.levels.combustion_drive = 0; state.research.levels.shielding_tech = 0;
    const target = { ...activePlanet(state).coordinates, position: 16 };
    state.deepSpace.debris = [{ target, metal: "1", crystal: "1" }];
    const model = expansionNavigation(valid(state), target, 16);
    expect(model.prerequisites.filter(value => value.id !== "astrophysics").every(group => group.requirements.every(value => !value.met))).toBe(true);
    expect(model.selected.scenarios.every(value => value.quote.ok)).toBe(true);
  });
});

describe("full-state purity and hidden outcome independence", () => {
  it("deep-freezes a populated reader-valid whole state and preserves every serialized field", () => {
    const state = populated(), before = exportSave(state, 123), cursor = { ...activePlanet(state).coordinates };
    expect(state.orders.tasks).not.toHaveLength(0);
    expect(state.formations.entries).not.toHaveLength(0);
    expect(state.researchTemplates.templates).not.toHaveLength(0);
    expect(activePlanet(state).buildQueue).not.toHaveLength(0);
    expect(activePlanet(state).shipyardQueue).not.toHaveLength(0);
    expect(state.research.queue).not.toHaveLength(0);
    expect(state.arcade.autoBatch?.armed).toBe(true);
    expect(state.deepSpace.offers).not.toHaveLength(0);
    freeze(state); freeze(cursor);
    const entropy = vi.spyOn(Math, "random").mockImplementation(() => { throw Error("inspector must not consume entropy"); });
    for (let pass = 0; pass < 3; pass++) for (let position = 1; position <= 16; position++) {
      const first = expansionNavigation(state, cursor, position);
      expect(expansionNavigation(state, cursor, position)).toEqual(first);
    }
    expect(entropy).not.toHaveBeenCalled();
    expect(exportSave(state, 123)).toBe(before);
  });
  it("does not reveal or depend on an unrevealed ticket outcome or RNG seed", () => {
    const state = populated(), cursor = { ...activePlanet(state).coordinates };
    const before = expansionNavigation(state, cursor, 16);
    state.arcade.seed = 999; state.deepSpace.seed = 123;
    const run = state.arcade.runs[0]!;
    // Structural independence probe, not a claimed legal RNG history.
    run.outcome.main.tile = (run.outcome.main.tile + 1) % 24;
    expect(expansionNavigation(state, cursor, 16)).toEqual(before);
  });
});
