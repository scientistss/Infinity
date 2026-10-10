/**
 * Anonymous, deterministic combined presentation load. No player data.
 * Only initial wallets, completed technologies/buildings and landed ship inventory
 * are synthetic. Colonies, fleets, tasks, transport receipts, paid job identities
 * and saved libraries are created by the actual public game APIs.
 *
 * Generate once, outside benchmark timing:
 *   node --import tsx scripts/performance-fixture.ts > /tmp/infinity-performance-fixture.json
 * A deliberately small smoke profile is available with --smoke.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void }; stderr: { write(text: string): void }; exitCode?: number };
import { RESEARCH_IDS } from "../src/data/research";
import { STORAGE_KEY } from "../src/game/content";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { FLYABLE_SHIP_IDS } from "../src/game/formation-state";
import { createFormation } from "../src/game/formations";
import { coordinateKey, npcAt, sameCoordinates, SPACE, type Coordinates } from "../src/game/galaxy";
import { tick } from "../src/game/logic";
import { type OrderMoney, type OrderTransportAuthorization } from "../src/game/order-state";
import { quoteNextOrderWork } from "../src/game/order-transport";
import { cancelOrderTask, createOrderTask } from "../src/game/orders";
import { usedFields, type PlanetState } from "../src/game/planet";
import { enqueue, queueCapacity } from "../src/game/queue";
import { enqueueResearch } from "../src/game/research";
import { createResearchTemplate } from "../src/game/research-templates";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { orderUnits, SHIPYARD } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";

export const PERFORMANCE_FIXTURE_TIMESTAMP = 1_791_590_400_000;
const SEED = 20261010;
const PREFUND = 10_000_000_000;
const BUDGET: OrderMoney = { metal: "1000000000", crystal: "1000000000", deuterium: "1000000000" };
const INITIAL_BUILDINGS = {
  robotics_factory: 4, shipyard: 8, research_lab: 8,
  metal_mine: 10, crystal_mine: 10, solar_plant: 10,
  metal_storage: 8, crystal_storage: 8, deuterium_tank: 8,
} as const;
const INITIAL_RESEARCH = {
  computer_tech: 999, astrophysics: 198, combustion_drive: 6,
  impulse_drive: 6, hyperspace_tech: 0, hyperspace_drive: 0,
  energy_tech: 8, laser_tech: 10, ion_tech: 5, plasma_tech: 5,
  espionage_tech: 4, weapons_tech: 4, shielding_tech: 4, armour_tech: 4,
} as const;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Performance fixture: ${message}`);
}
function accept(label: string, result: { state: GameState; ok: boolean; reason: string }): GameState {
  ensure(result.ok, `${label}: ${result.reason}`);
  return result.state;
}
function initializeWorld(world: PlanetState, index: number, deuterium: number): void {
  // This is disclosed initial setup for each newly API-created world, never a
  // fabricated world/queue/fleet/task or an alteration of historical receipts.
  world.name = `匿名性能星球 ${String(index).padStart(3, "0")} <测试&🚀>`;
  world.resources = { metal: big(PREFUND), crystal: big(PREFUND), deuterium: big(deuterium) };
  Object.assign(world.buildings, INITIAL_BUILDINGS);
  for (const id of Object.keys(world.productionPct) as Array<keyof PlanetState["productionPct"]>) world.productionPct[id] = 0;
  ensure(usedFields(world) + 2 <= world.fieldsMax, `${world.id} synthetic completed buildings must fit actual generated fields`);
}
function unoccupied(state: GameState, target: Coordinates): boolean {
  return !npcAt(state, target) && !state.planets.some(world => sameCoordinates(world.coordinates, target));
}
function colonize(state: GameState, target: Coordinates): GameState {
  const count = state.planets.length;
  const request: FleetRequest = { mission: "colonize", target, ships: { colony_ship: 1 }, cargo: emptyCargo(), speedPercent: 100 };
  // A lone colony ship's 7,500 cargo also reserves return fuel. At two-galaxy
  // distance 100% does not fit; choose the fastest actual legal throttle rather
  // than changing cargo capacity, adding fabricated worlds, or skipping payment.
  while (!quoteFlight(state, request).ok && request.speedPercent > 10) request.speedPercent -= 10;
  const result = sendFleet(state, request);
  let next = accept(`colonize ${coordinateKey(target)}`, result);
  const fleet = next.fleets.find(value => value.id === result.fleetId);
  ensure(fleet, "colonization must create a real fleet identity");
  next = tick(next, fleet.remaining, "offline");
  ensure(next.planets.length === count + 1 && next.fleets.length === 0, "one colony ship must settle into exactly one real colony");
  return next;
}
function transportAuthorization(homeId: string, speedPercent: number, maxTrips: number): OrderTransportAuthorization {
  return { donorPlanetId: homeId, ship: "large_cargo", count: 1, speedPercent, maxTrips,
    grossCargoCap: { metal: "0", crystal: "0", deuterium: String(15_000 * maxTrips) } };
}
function cloneStrict(state: GameState): GameState {
  return deserializeState(importSave(exportSave(state, PERFORMANCE_FIXTURE_TIMESTAMP)).state);
}
/** Settlement is separate from measurement, and must reach a fixed point twice. */
export function settlePerformanceState(state: GameState): GameState {
  let next = cloneStrict(tick(state, 0));
  next = cloneStrict(tick(next, 0));
  const canonical = JSON.stringify(serializeState(next));
  for (let pass = 0; pass < 2; pass++) {
    ensure(JSON.stringify(serializeState(cloneStrict(next))) === canonical, `strict reader drift on repeat ${pass + 1}`);
    const settled = tick(next, 0);
    ensure(JSON.stringify(serializeState(settled)) === canonical, `zero-time startup drift on repeat ${pass + 1}`);
    next = settled;
  }
  return next;
}
export function performanceFixtureCounts(state: GameState) {
  const trips = state.orders.tasks.flatMap(task => task.transport?.trips ?? []);
  const buildJobs = state.planets.reduce((sum, world) => sum + world.buildQueue.length, 0);
  const shipyardJobs = state.planets.reduce((sum, world) => sum + world.shipyardQueue.length, 0);
  const researchJobs = state.research.queue.length;
  return {
    worlds: state.planets.length, fleets: state.fleets.length,
    ownedFleets: state.fleets.filter(fleet => fleet.orderTransport !== null).length,
    ordinaryFleets: state.fleets.filter(fleet => fleet.orderTransport === null).length,
    tasks: state.orders.tasks.length,
    terminalTasks: state.orders.tasks.filter(task => task.status === "completed" || task.status === "cancelled").length,
    completedTasks: state.orders.tasks.filter(task => task.status === "completed").length,
    cancelledTasks: state.orders.tasks.filter(task => task.status === "cancelled").length,
    runningTasks: state.orders.tasks.filter(task => task.status === "running").length,
    pausedTasks: state.orders.tasks.filter(task => task.status === "paused").length,
    transportReceipts: trips.length,
    returnedReceipts: trips.filter(trip => trip.phase.kind === "returned").length,
    outboundReceipts: trips.filter(trip => trip.phase.kind === "outbound").length,
    paidLocalPlans: state.orders.tasks.filter(task => !task.transport && task.activeJob !== null).length,
    buildJobs, shipyardJobs, researchJobs, paidJobs: buildJobs + shipyardJobs + researchJobs,
    templates: state.researchTemplates.templates.length,
    templateGoals: state.researchTemplates.templates.reduce((sum, template) => sum + template.goals.length, 0),
    formations: state.formations.entries.length,
    formationShipEntries: state.formations.entries.reduce((sum, formation) => sum + Object.keys(formation.ships).length, 0),
    messages: state.messages.length,
  };
}

export interface PerformanceFixtureOptions { profile?: "combined" | "smoke" }
/** No I/O and no import-time generation, so a small profile can be unit tested. */
export function buildPerformanceState(options: PerformanceFixtureOptions = {}) {
  const smoke = options.profile === "smoke";
  const goals = smoke
    ? { worlds: 2, fleets: 4, history: 1, cancelled: 1, remote: 0, local: 1, libraries: 2 }
    : { worlds: 100, fleets: 1000, history: 60, cancelled: 8, remote: 16, local: 16, libraries: 32 };
  let state = createInitialState(SEED, SEED);
  const homeId = state.activePlanetId;
  initializeWorld(activePlanet(state), 0, PREFUND);
  Object.assign(state.research.levels, INITIAL_RESEARCH);
  for (const id of FLYABLE_SHIP_IDS) activePlanet(state).units[id] = 10_000;
  const homeCoordinates = { ...activePlanet(state).coordinates };
  const nearby = Array.from({ length: 15 }, (_, index) => ({ ...homeCoordinates, position: index + 1 })).find(target => unoccupied(state, target));
  ensure(nearby, "fixed home system requires an unoccupied history payer");
  state = colonize(state, nearby);
  const historyPayerId = state.planets.at(-1)!.id;
  initializeWorld(state.planets.at(-1)!, 1, 0);
  state = tick(state, 0);

  let historyTicks = 0;
  for (let index = 0; index < goals.history; index++) {
    const taskId = state.orders.nextTaskId;
    state = accept(`create history task ${taskId}`, createOrderTask(state, {
      kind: "shipyard", planetId: historyPayerId, unit: "bomber", quantity: 4,
      expectedNextTaskId: taskId, budget: { ...BUDGET }, transport: transportAuthorization(homeId, 100, 4),
    }));
    const quote = quoteNextOrderWork(state, state.orders.tasks.at(-1)!);
    ensure(quote.ok && quote.spec.kind === "shipyard" && quote.spec.quantity === 1,
      `history task ${taskId} must quote exactly one bomber per real 25,000-capacity shipment; ${quote.ok ? JSON.stringify(quote.spec) : quote.reason}`);
    let complete = false;
    for (let pass = 0; pass < 200; pass++) {
      state = tick(state, 10, "offline");
      historyTicks++;
      const task = state.orders.tasks.find(value => value.id === taskId)!;
      ensure(task.status !== "paused", `history task ${taskId} paused: ${task.reason}`);
      if (task.status === "completed" && task.transport!.trips.every(trip => trip.phase.kind === "returned")) {
        ensure(task.transport!.trips.length === 4 && task.completedUnits === 4,
          `history task ${taskId} must produce four paid bombers and four actual returned receipts`);
        ensure(task.transport!.trips.every(trip => trip.cargo.deuterium === "15000" && trip.phase.kind === "returned" && trip.phase.outcome.kind === "delivered"),
          `history task ${taskId} cargo/delivery proof differs from the one-bomber recipe`);
        complete = true;
        break;
      }
    }
    ensure(complete, `history task ${taskId} failed its bounded 2,000-second completion window: ${state.orders.tasks.at(-1)?.reason}`);
    ensure(state.fleets.length === 0, `history task ${taskId} left a fleet unsettled`);
  }

  // First remote worlds are in galaxy 3, far from the real galaxy-1 home.
  // Only colony identities and procedural coordinates/properties are generated.
  for (let system = 1; system <= SPACE.systems && state.planets.length < goals.worlds; system++) {
    for (let position = 1; position <= 15 && state.planets.length < goals.worlds; position++) {
      const target = { galaxy: 3, system, position };
      if (!unoccupied(state, target)) continue;
      state = colonize(state, target);
      const index = state.planets.length - 1;
      initializeWorld(state.planets.at(-1)!, index, index < 2 + goals.remote ? 0 : PREFUND);
    }
  }
  ensure(state.planets.length === goals.worlds, "bounded real colonization must reach the requested world count");

  for (let index = 0; index < goals.libraries; index++) {
    state = accept(`create research template ${index + 1}`, createResearchTemplate(state, {
      name: `匿名研究模板 ${index + 1} <意图&🌌>`,
      goals: RESEARCH_IDS.map(tech => ({ tech, targetLevel: Math.min(1000, state.research.levels[tech] + index + 1) })),
    }, state.researchTemplates.nextTemplateId));
    state = accept(`create formation ${index + 1}`, createFormation(state, {
      expectedNextFormationId: state.formations.nextFormationId,
      name: `匿名舰队编成 ${index + 1} <意图&🚀>`,
      ships: Object.fromEntries(FLYABLE_SHIP_IDS.map((id, offset) => [id, 100 + index * 7 + offset])),
    }));
  }
  for (let index = 0; index < goals.cancelled; index++) {
    const id = state.orders.nextTaskId;
    state = accept(`create cancellation ${id}`, createOrderTask(state, {
      kind: "shipyard", planetId: historyPayerId, unit: "bomber", quantity: 1,
      expectedNextTaskId: id, budget: { ...BUDGET }, transport: transportAuthorization(homeId, 100, 1),
    }));
    state = accept(`cancel zero-trip task ${id}`, cancelOrderTask(state, id));
  }
  const remotePayers = state.planets.slice(2, 2 + goals.remote);
  const remoteDurations: number[] = [];
  for (const payer of remotePayers) {
    const request: FleetRequest = { mission: "transport", target: payer.coordinates, ships: { large_cargo: 1 },
      cargo: { ...emptyCargo(), deuterium: big(15_000) }, speedPercent: 10 };
    const flight = quoteFlight(selectPlanet(state, homeId), request);
    ensure(flight.ok && flight.duration > 60, `remote shipment must be legal and remain outbound: ${flight.reason}`);
    remoteDurations.push(flight.duration);
    state = accept(`create remote task ${payer.id}`, createOrderTask(state, {
      kind: "shipyard", planetId: payer.id, unit: "bomber", quantity: 4,
      expectedNextTaskId: state.orders.nextTaskId, budget: { ...BUDGET }, transport: transportAuthorization(homeId, 10, 4),
    }));
  }
  const localPayers = smoke ? [homeId] : state.planets.slice(2 + goals.remote, 2 + goals.remote + goals.local).map(world => world.id);
  ensure(localPayers.length === goals.local, "distinct local payers exist");
  for (const planetId of localPayers) {
    state = accept(`create paid local task ${planetId}`, createOrderTask(state, {
      kind: "shipyard", planetId, unit: "bomber", quantity: 10_000,
      expectedNextTaskId: state.orders.nextTaskId, budget: { ...BUDGET }, transport: null,
    }));
  }
  state = tick(state, 10, "offline");
  ensure(state.orders.tasks.filter(task => task.activeJob !== null).length === goals.local, "one ten-second pass must pay every local plan");
  ensure(state.fleets.length === goals.remote && state.fleets.every(fleet => fleet.orderTransport && !fleet.returning), "one pass must dispatch every remote plan exactly once");

  // All 1,202 active paid rows use API capacities (2 builds, 10 shipyard, 2
  // empire research), not the reader's looser five-row legacy bounds.
  for (const worldId of state.planets.map(world => world.id)) {
    state = selectPlanet(state, worldId);
    state = accept(`pay build ${worldId}/metal`, enqueue(state, "metal_storage", "manual"));
    state = accept(`pay build ${worldId}/crystal`, enqueue(state, "crystal_storage", "manual"));
    ensure(activePlanet(state).buildQueue.length === queueCapacity(state), "actual construction capacity");
    while (activePlanet(state).shipyardQueue.length < SHIPYARD.maxOrders) {
      state = accept(`pay shipyard ${worldId}/${activePlanet(state).shipyardQueue.length}`, orderUnits(state, "light_fighter", 10_000, "manual"));
    }
  }
  state = selectPlanet(state, homeId);
  state = accept("pay research energy", enqueueResearch(state, "energy_tech", "manual"));
  state = accept("pay research laser", enqueueResearch(state, "laser_tech", "manual"));
  const farTarget = smoke ? state.planets[1]!.coordinates : remotePayers[0]!.coordinates;
  const ordinaryShips = Object.fromEntries(FLYABLE_SHIP_IDS.map(id => [id, 1]));
  while (state.fleets.length < goals.fleets) {
    state = accept(`dispatch ordinary fleet ${state.fleets.length}`, sendFleet(state, {
      mission: "transport", target: { ...farTarget }, ships: { ...ordinaryShips }, cargo: emptyCargo(), speedPercent: 10,
    }));
  }
  state = settlePerformanceState(state);
  const counts = performanceFixtureCounts(state);
  const expected = {
    worlds: goals.worlds, fleets: goals.fleets, ownedFleets: goals.remote,
    ordinaryFleets: goals.fleets - goals.remote, tasks: goals.history + goals.cancelled + goals.remote + goals.local,
    terminalTasks: goals.history + goals.cancelled, completedTasks: goals.history, cancelledTasks: goals.cancelled,
    runningTasks: goals.remote + goals.local, pausedTasks: 0,
    transportReceipts: goals.history * 4 + goals.remote, returnedReceipts: goals.history * 4, outboundReceipts: goals.remote,
    paidLocalPlans: goals.local, buildJobs: goals.worlds * 2, shipyardJobs: goals.worlds * 10,
    researchJobs: 2, paidJobs: goals.worlds * 12 + 2,
    templates: goals.libraries, templateGoals: goals.libraries * 16,
    formations: goals.libraries, formationShipEntries: goals.libraries * 13,
  };
  for (const [key, value] of Object.entries(expected)) ensure(counts[key as keyof typeof counts] === value, `${key}: expected ${value}, got ${counts[key as keyof typeof counts]}`);
  return { state, goals, homeId, historyPayerId, remoteDurations, historyTicks, counts };
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
export async function generatePerformanceFixture(options: PerformanceFixtureOptions = {}) {
  const built = buildPerformanceState(options);
  const { state, counts } = built;
  const save = exportSave(state, PERFORMANCE_FIXTURE_TIMESTAMP);
  const ready = JSON.parse(save) as ReturnType<typeof importSave>;
  const canonical = JSON.stringify(ready);
  const encode = (value: string) => new TextEncoder().encode(value).length;
  const buildIds = state.planets.flatMap(world => world.buildQueue.map(job => job.jobId));
  const shipyardIds = state.planets.flatMap(world => world.shipyardQueue.map(job => job.jobId));
  const researchIds = state.research.queue.map(job => job.jobId);
  const allJobIds = [...buildIds, ...shipyardIds, ...researchIds];
  ensure(new Set(allJobIds).size === counts.paidJobs, "all active paid jobs have unique real ledger identities");
  return {
    description: "Anonymous deterministic combined presentation load. Initial balances, completed buildings/research and home landed ship inventory are explicitly synthetic. Every world identity beyond the initial home, task, paid job, fleet, transport receipt, template and formation uses real APIs. Completed transport history advances real simulated time. Strict current readers and zero-time startup are stable twice. This is a simultaneous bounded legal profile, not a claim that all possible scalar/deep-space maxima coexist, and not a native-browser quota or performance pass.",
    key: STORAGE_KEY, profile: options.profile === "smoke" ? "combined-smoke-v1" : "combined-max-v1", save, ready,
    manifest: {
      schema: "infinity-performance-fixture-v1", seed: SEED, savedAt: PERFORMANCE_FIXTURE_TIMESTAMP,
      sha256: await sha256(save), utf8Bytes: encode(save), stringChars: save.length,
      canonicalSha256: await sha256(canonical), canonicalUtf8Bytes: encode(canonical), canonicalStringChars: canonical.length,
      storageNote: "sha256/utf8Bytes/stringChars refer to exact indented native exportSave text in save. Canonical fields refer to JSON.stringify(ready). Native current plus one equal-size backup needs at least twice stringChars UTF-16 code units, excluding keys/other origin storage; actual quota behavior must be measured in an unmodified browser.",
      currentPlusEqualBackupStringChars: save.length * 2,
      counts,
      phases: Object.fromEntries(["outbound", "returning", "returned", "prestige-retired"].map(kind => [kind, state.orders.tasks.flatMap(task => task.transport?.trips ?? []).filter(trip => trip.phase.kind === kind).length])),
      paidJobIds: { build: buildIds, shipyard: shipyardIds, research: researchIds },
      identityHighWater: { nextTaskId: state.orders.nextTaskId, nextJobId: state.orders.nextJobId, nextWorkId: state.orders.nextWorkId, nextFleetId: state.nextFleetId },
      origins: { homeId: built.homeId, historyPayerId: built.historyPayerId },
      syntheticSetup: { prefundPerResource: PREFUND, historyAndRemotePayerDeuterium: 0, completedBuildings: INITIAL_BUILDINGS,
        completedResearch: INITIAL_RESEARCH, initialHomeLandedInventoryPerFlyableShip: 10_000,
        productionPercentages: 0, worldNames: "anonymous Unicode/HTML-sensitive labels", generatedCoordinatesAndFieldsPreserved: true },
      generation: { mode: "real tick(..., offline) for bounded generation; all plan passes remain ten simulated seconds", historyTenSecondTicks: built.historyTicks,
        simulatedSeconds: state.totalTime.toString(), remoteOneWayDurations: built.remoteDurations,
        oneBomberShipmentDeuterium: 15_000, shipmentCapacity: 25_000, strictRoundtripsStable: 2, zeroTimeStartupStable: 2 },
      limitations: ["No fabricated historical receipts or reader-only oversized queues", "No optional 100-owned-fleet extremum, deep-flight maximum, or adversarial 8,000 debris entries", "No player data; synthetic initial assets are not normal gameplay progression"],
    },
  };
}

if (typeof process !== "undefined" && /(?:^|\/)performance-fixture\.ts$/.test(process.argv[1] ?? "")) {
  generatePerformanceFixture({ profile: process.argv.includes("--smoke") ? "smoke" : "combined" }).then(
    fixture => process.stdout.write(JSON.stringify(fixture, null, 2) + "\n"),
    error => { process.stderr.write(String(error instanceof Error ? error.stack : error) + "\n"); process.exitCode = 1; },
  );
}
