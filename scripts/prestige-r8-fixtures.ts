/** Anonymous, pre-funded r8 fixtures, using only the supplied engine's actual APIs and serializer.
 * The historical parity caller supplies archived modules; no current rule implementation is imported here.
 */
import type { GameState } from "../src/game/types";

export interface PrestigeFixtureApi {
  state: typeof import("../src/game/state");
  save: typeof import("../src/game/save");
  decimal: typeof import("../src/game/decimal");
  logic: Pick<typeof import("../src/game/logic"), "tick">;
  orders: typeof import("../src/game/orders");
  formations: typeof import("../src/game/formations");
  templates: typeof import("../src/game/research-templates");
  yard: typeof import("../src/game/shipyard");
  queue: typeof import("../src/game/queue");
  fleet: typeof import("../src/game/fleet");
  empire: typeof import("../src/game/empire");
  arcade: typeof import("../src/game/arcade");
  engine: typeof import("../src/automation/engine");
  deep: typeof import("../src/game/deep-space");
}

export function buildPrestigeFixtures(api: PrestigeFixtureApi): Record<string, GameState> {
  const { state: factory, save, decimal: { big }, logic, orders, formations, templates, yard, queue, fleet, empire, arcade, engine, deep } = api;
  const fixedTime = 1_791_590_400_000;
  const budget = { metal: "10000000", crystal: "10000000", deuterium: "10000000" };
  const ok = (result: { state: GameState; ok: boolean; reason: string }, label: string): GameState => {
    if (!result.ok) throw Error(`${label}: ${result.reason}`);
    return result.state;
  };
  const clone = (state: GameState): GameState => save.deserializeState(save.importSave(save.exportSave(state, fixedTime)).state);
  const settle = (state: GameState): GameState => {
    const restored = clone(logic.tick(state, 0));
    const stable = clone(logic.tick(restored, 0));
    if (JSON.stringify(save.serializeState(restored)) !== JSON.stringify(save.serializeState(stable))) throw Error("r8 fixture must settle real unlocks before comparison");
    return stable;
  };
  function ready(): GameState {
    let state = factory.createInitialState(20261010);
    // Old createInitialState still requests entropy. Its disposable initial arcade seed is replaced
    // before any reward is rolled, so old fixture contents do not depend on wall time/randomness.
    state.arcade.seed = 771;
    const home = state.planets[0]!;
    home.name = "Synthetic r8 home";
    const colony = factory.createPlanet("synthetic-r8-colony", { ...home.coordinates, position: home.coordinates.position === 15 ? 14 : home.coordinates.position + 1 });
    colony.name = "Synthetic r8 colony";
    state.planets.push(colony);
    for (const planet of state.planets) {
      Object.assign(planet.buildings, { metal_mine: 5, crystal_mine: 4, solar_plant: 15, robotics_factory: 4, research_lab: 8, shipyard: 7 });
      planet.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
    }
    Object.assign(home.units, { small_cargo: 100, light_fighter: 1000 });
    Object.assign(state.research.levels, { astrophysics: 4, combustion_drive: 6, computer_tech: 8, energy_tech: 4, impulse_drive: 4 });
    state.warpCores = big(30);
    Object.assign(state.curvature, { seed_stock: 1, score_boost: 1, offline_extend: 1 });
    state.offlineBonusHours = 2;
    state.totalTime = big(123);
    state.manualClicks = 100;
    state.items.supply_pack = 3;
    state.boosters = [{ res: "metal", pct: 10, until: 9876 }];
    state.lifetime = { metal: big(1e10), crystal: big(2e9), deuterium: big(3e8) };
    return settle(state);
  }

  let rich = ready();
  const homeId = rich.activePlanetId, colonyId = rich.planets[1]!.id;
  rich = ok(formations.createFormation(rich, { expectedNextFormationId: 1, name: "Original synthetic wing", ships: { light_fighter: 10 } }), "formation");
  const review = formations.previewFormationReplenishment(rich, { formationId: 1, formationRevision: 1, planetId: colonyId });
  if (!review.ok || !review.request) throw Error(`formation review: ${review.reason}`);
  rich = ok(formations.createFormationReplenishment(rich, review.request), "replenishment");
  rich = orders.advanceOrderPlans(rich, 10);
  let local = empire.selectPlanet(rich, colonyId);
  local = yard.advanceShipyard(local, yard.unitSeconds(local, "light_fighter") * 2.5, false).state;
  rich = empire.selectPlanet(local, homeId);
  rich = ok(formations.editFormation(rich, { formationId: 1, expectedRevision: 1, name: "Edited synthetic wing", ships: { small_cargo: 4 } }), "formation edit");
  rich = ok(templates.createResearchTemplate(rich, { name: "Synthetic research intent", goals: [{ tech: "energy_tech", targetLevel: 6 }] }, 1), "template");
  const quote = templates.quoteResearchTemplate(rich, 1, colonyId);
  rich = ok(templates.applyResearchTemplate(rich, { templateId: 1, expectedTemplateRevision: quote.templateRevision, planetId: colonyId,
    expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
    budgets: quote.rows.filter(row => row.status === "new").map(row => ({ tech: row.tech, budget: { ...budget } })) }), "template apply");
  rich = orders.advanceOrderPlans(rich, 10);
  rich = ok(queue.enqueue(rich, "metal_mine", "manual"), "paid building");
  rich = ok(yard.enqueueUnits(rich, "small_cargo", 3, "manual"), "paid ships");
  rich = ok(orders.pauseOrderTask(rich, 1), "pause paid origin");
  rich = ok(orders.createOrderTask(rich, { kind: "building", building: "deuterium_synth", targetLevel: 1, planetId: colonyId, budget, expectedNextTaskId: rich.orders.nextTaskId }), "historical cancellation");
  rich = ok(orders.cancelOrderTask(rich, rich.orders.tasks.at(-1)!.id), "cancel unpaid history");
  rich = ok(fleet.sendFleet(rich, { mission: "transport", target: rich.planets[1]!.coordinates, ships: { small_cargo: 1 },
    cargo: { metal: big(13), crystal: big(17), deuterium: big(19) }, speedPercent: 100 }), "ordinary cargo");
  rich.arcade.stats.manualRuns = 10;
  rich.arcade.stats.runs = 10;
  rich.arcade.stats.hits.empty = 10;
  rich = engine.equipCard(engine.refreshUnlocks(rich), 0, "auto_runner").state;
  rich = engine.equipCard(rich, 1, "auto_collect").state;
  if (rich.protocols.slots[0]?.card?.id !== "auto_runner" || rich.protocols.slots[1]?.card?.id !== "auto_collect") throw Error("Real ring and collect cards were not equipped");
  rich = engine.toggleSlot(rich, 1, true);
  rich.protocols.slots[1]!.elapsed = 7;
  rich.protocols.accumulator = 0.4;
  rich = ok(engine.armAutoRunner(rich, 0, { planetId: homeId, count: 1, maxDeuterium: "0" }), "ring authorization");
  rich = settle(rich);
  if (rich.planets[1]!.shipyardQueue[0]?.count !== 8 || rich.research.queue.length !== 1 || !rich.arcade.autoBatch?.armed) throw Error("Rich r8 fixture lost its paid remainder, research or armed ring");

  let outbound = ready();
  outbound.planets[1]!.buildings.metal_mine = 0;
  outbound.planets[1]!.resources = fleet.emptyCargo();
  outbound = ok(orders.createOrderTask(outbound, { kind: "building", planetId: colonyId, building: "metal_mine", targetLevel: 1,
    expectedNextTaskId: 1, budget, transport: { donorPlanetId: homeId, ship: "small_cargo", count: 2, speedPercent: 100,
      maxTrips: 2, grossCargoCap: { ...budget } } }), "owned transport plan");
  outbound = orders.advanceOrderPlans(outbound, 10);
  if (outbound.fleets.length !== 1 || outbound.orders.tasks[0]?.transport?.trips[0]?.phase.kind !== "outbound") throw Error("Owned transport did not really dispatch");
  outbound = settle(outbound);
  const delivered = settle(fleet.advanceFleets(outbound, outbound.fleets[0]!.remaining));
  const returned = settle(fleet.advanceFleets(delivered, delivered.fleets[0]!.remaining));
  const elapsed = fleet.advanceFleets(outbound, 0.5);
  const recalled = settle(ok(fleet.recallFleet(elapsed, elapsed.fleets[0]!.id), "actual recall"));
  let blocked = clone(recalled);
  blocked.planets[0]!.resources.metal = big("1e100");
  blocked = settle(fleet.advanceFleets(blocked, blocked.fleets[0]!.remaining));
  if (blocked.orders.tasks[0]!.transport!.trips[0]!.phase.kind !== "returning" || blocked.fleets[0]!.remaining !== 0) throw Error("Blocked return did not reach real dock boundary");

  // Existing completed history is generated by the actual paid build completion primitive.
  let completed = clone(delivered);
  completed = orders.advanceOrderPlans(completed, 10);
  completed = empire.selectPlanet(completed, colonyId);
  completed = queue.completeActive(completed).state;
  completed = settle(empire.selectPlanet(completed, homeId));

  let pending = ready();
  pending = ok(arcade.setBet(pending, "metal", 1), "standing bet");
  pending = ok(fleet.sendFleet(pending, { mission: "charge", target: { ...pending.planets[0]!.coordinates, position: 16 },
    ships: { small_cargo: 2, light_fighter: 10 }, cargo: fleet.emptyCargo(), speedPercent: 100, holdSlots: 1, chargeWithBets: true }), "charge departure");
  pending = settle(pending);
  const holding = fleet.advanceFleets(pending, pending.fleets[0]!.remaining);
  const charge = (symbol: "dark_matter" | "supply" | "merchant" | "blackhole"): GameState => {
    const candidate = clone(holding);
    if (symbol === "blackhole") candidate.deepSpace.completed = 20;
    let found = false;
    for (let seed = 1; seed <= 20000; seed++) {
      candidate.deepSpace.seed = seed;
      if (deep.rollCharge(candidate, candidate.fleets[0]!).rawSymbol === symbol) { found = true; break; }
    }
    if (!found) throw Error(`No synthetic seed for ${symbol}`);
    return settle(fleet.advanceFleets(candidate, candidate.fleets[0]!.remaining));
  };
  const dmReturn = charge("dark_matter"), supplyReturn = charge("supply"), merchantReturn = charge("merchant"), destroyed = charge("blackhole");
  const chargeReturned = settle(fleet.advanceFleets(dmReturn, dmReturn.fleets[0]!.remaining));
  let withDebris = deep.addDebris(merchantReturn, merchantReturn.planets[1]!.coordinates, big(321), big(123));
  withDebris = settle(withDebris);
  return { rich, outbound, delivered, returned, recalled, blocked, completed, pending, dmReturn, supplyReturn, withDebris, chargeReturned, destroyed };
}
