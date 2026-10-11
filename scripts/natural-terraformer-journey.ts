/**
 * Strict natural continuation of the immutable 5332526 CI growth report.
 * This is compressed engine execution, NOT continuous real-time browser play.
 *
 * node --import tsx scripts/natural-terraformer-journey.ts \
 *   --report /path/to/natural-growth-report.json \
 *   --expected-report-sha256 f331fa2e81d9fbfa2e1d86eaf710a824d8d66e6c5b738646b26c098eea97e826 \
 *   --source-sha 53325263ddbd654b8e8b9511ec62b944fa955233
 *
 * stdout is a report on success AND failure. Only public player APIs, strict
 * import/reload, and tick(state, 1, "live") replace the adopted game state.
 * No wallet grants, raw settings patches, reward reveals, seed searches,
 * synthetic paid jobs, clock assignments, or shortened economic timers.
 */
declare const process: {
  argv: string[]; env: Record<string, string | undefined>;
  stdout: { write(value: string): void }; stderr: { write(value: string): void };
  exitCode?: number;
};

import { assertNpcEconomy } from "./r12-compatibility.mjs";
import { setProductionPct } from "../src/automation/engine";
import type { BuildingId } from "../src/data/buildings";
import type { ResearchId } from "../src/data/research";
import type { UnitId } from "../src/data/units";
import { nextBeaconIn } from "../src/game/arcade";
import { PRESTIGE_SCORE_UNIT, SAVE_REVISION, SAVE_VERSION } from "../src/game/content";
import { big, bigFloor, bigSqrt } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { emptyTickLog, evaluatePrestige, expansionScore, prestige, tick } from "../src/game/logic";
import { compareOrderAmounts } from "../src/game/order-money";
import type { CreateOrderRequest, OrderMoney } from "../src/game/order-state";
import { cancelOrderTask, cancelPaidJob, createOrderTask, pauseOrderTask, resumeOrderTask } from "../src/game/orders";
import { usedFields } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { canBuildUnits, orderUnits } from "../src/game/shipyard";
import { terraformerEnergyRequirement } from "../src/game/terraformer";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";
import { prestigePreview } from "../src/ui/prestige-preview-model";

const ORIGIN_SHA = "53325263ddbd654b8e8b9511ec62b944fa955233";
const ORIGIN_REPORT_HASH = "f331fa2e81d9fbfa2e1d86eaf710a824d8d66e6c5b738646b26c098eea97e826";
const ORIGIN_MILESTONE = "11-first-slice-complete-and-reloaded";
const LIMIT_SECONDS = 12 * 60 * 60;
const ZERO: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
const GOLDEN = {
  nanite1: { metal: "1000000", crystal: "500000", deuterium: "100000" },
  computer10: { metal: "0", crystal: "204800", deuterium: "307200" },
  energy12: { metal: "0", crystal: "1638400", deuterium: "819200" },
  terra1: { metal: "0", crystal: "50000", deuterium: "100000" },
  terra2: { metal: "0", crystal: "100000", deuterium: "200000" },
  terra1SecondsR10N1: 1.5584415584415583,
  terra2SecondsR10N1: 3.636363636363636,
  nanite1SecondsR10N0: 327.27272727272725,
  energy12SecondsLab6: 1404.3428571428572,
  minimumStorageCaps: { metal: 1590000, crystal: 2920000, deuterium: 865000 },
  motherSolar18Supply: 2001.5702328572063,
  motherSolar18And66SatellitesSupply: 3981.5702328572063,
  motherSolarOffAnd66SatellitesSupply: 1980,
};
// Independent catalog arithmetic, never an expected value from the tested quote.
const BUILD_BASE: Partial<Record<BuildingId, readonly [number, number, number, number]>> = {
  metal_mine: [60, 15, 0, 1.5], crystal_mine: [48, 24, 0, 1.6],
  deuterium_synth: [225, 75, 0, 1.5], solar_plant: [75, 30, 0, 1.5],
  metal_storage: [1000, 0, 0, 2], crystal_storage: [1000, 500, 0, 2],
  deuterium_tank: [1000, 1000, 0, 2], robotics_factory: [400, 120, 200, 2],
  nanite_factory: [1000000, 500000, 100000, 2], research_lab: [200, 400, 200, 2],
  shipyard: [400, 200, 100, 2], terraformer: [0, 50000, 100000, 2],
};
const TECH_BASE: Partial<Record<ResearchId, readonly [number, number, number, number]>> = {
  computer_tech: [0, 400, 600, 2], energy_tech: [0, 800, 400, 2], combustion_drive: [400, 0, 600, 2],
};
const UNIT_BASE: Partial<Record<UnitId, readonly [number, number, number]>> = {
  solar_satellite: [0, 2000, 500], large_cargo: [6000, 6000, 0],
};
const STORAGE: Record<keyof ResourceAmounts, BuildingId> = {
  metal: "metal_storage", crystal: "crystal_storage", deuterium: "deuterium_tank",
};

interface OriginMilestone {
  name: string; gameSeconds: number; strictRoundtrips: number; subsequentLiveTickObserved: boolean;
  save: { schema: string; version: number; revision: number; savedAt: number; lastTickAt: number; state: Record<string, unknown> };
}
interface SaveMilestone {
  name: string; gameSeconds: number; continuationSeconds: number; strictRoundtrips: number;
  stateAdoptedFromReload: boolean; subsequentLiveTickObserved: boolean; firstSubsequentLiveTickAt?: number;
  snapshot: unknown; save: ReturnType<typeof importSave>;
}
interface JobProof {
  jobId: number; planetId: string; source: string; taskId: number | null; kind: string;
  paid: OrderMoney; target: unknown;
}
// loadOrigin must finish before the journey starts. TypeScript cannot infer that
// an awaited helper assigns this module variable; the separate runtime flag
// also keeps a failed pre-import setup safe in the failure-reporting branch.
let state!: GameState;
let stateInitialized = false;
let elapsed = 0, originGameSeconds = 0, originSavedAt = 0, firstNewJobId = 0;
let homeId = "", colonyId = "", stage = "verify-immutable-origin";
let source: Record<string, unknown> | null = null;
let origin: Record<string, unknown> | null = null;
let saveDifference: unknown = null;
let planPaymentWatch: number | null = null;
let planPaymentProved = false;
let colonyTransportEnabled = false;
const actions: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];
const waits: Array<Record<string, unknown>> = [];
const milestones: SaveMilestone[] = [];
const payments: Array<Record<string, unknown>> = [];
const shipments: Array<Record<string, unknown>> = [];
const paidJobs = new Map<number, JobProof>();
const completedTerraformers: Array<Record<string, unknown>> = [];
const cancelledTerraformers: Array<Record<string, unknown>> = [];

class JourneyBlocked extends Error {}
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new JourneyBlocked(`${stage}: ${reason}`);
}
function difference(a: unknown, b: unknown, path = "$state"): unknown | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return { path, before: a, after: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path, before: a, after: b };
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const ak = Object.keys(left).sort(), bk = Object.keys(right).sort();
  if (ak.length !== bk.length || ak.some((key, index) => key !== bk[index])) return { path: `${path}.[keys]`, before: ak, after: bk };
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return { path: `${path}.length`, before: a.length, after: b.length };
  for (const key of Object.keys(left)) {
    const found = difference(left[key], right[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`);
    if (found) return found;
  }
  return null;
}
function exact(a: unknown, b: unknown, label: string): void {
  const found = difference(a, b);
  if (found) { saveDifference = { label, difference: found }; throw new JourneyBlocked(`${stage}: ${label}: ${JSON.stringify(found)}`); }
}
function near(a: number, b: number, label: string): void {
  check(Number.isFinite(a) && Math.abs(a - b) <= Math.max(1e-10, Math.abs(b) * 1e-12), `${label}: ${a} != ${b}`);
}
function money(value: ResourceAmounts): OrderMoney {
  return { metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() };
}
function exactMoney(actual: OrderMoney, expected: OrderMoney, label: string): void {
  check(RESOURCE_IDS.every(id => compareOrderAmounts(actual[id], expected[id]) === 0), `${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function wallets(current = state): Record<string, OrderMoney> {
  return Object.fromEntries(current.planets.map(planet => [planet.id, money(planet.resources)]));
}
function grantSnapshot(current = state) {
  return current.planets.map(planet => ({ planetId: planet.id, level: planet.buildings.terraformer,
    fieldsMax: planet.fieldsMax, usedFields: usedFields(planet), freeFields: planet.fieldsMax - usedFields(planet),
    base: planet.terraformerFields.base, grantedLevels: planet.terraformerFields.grantedLevels }));
}
function snapshot() {
  return { gameSeconds: originGameSeconds + elapsed, continuationSeconds: elapsed, totalTime: state.totalTime.toString(),
    activePlanetId: state.activePlanetId, score: expansionScore(state).toString(), research: state.research,
    lifetime: money(state.lifetime), grants: grantSnapshot(), floor: state.terraformerGrantJobFloor,
    nextJobId: state.orders.nextJobId, orders: state.orders, fleets: state.fleets,
    planets: state.planets.map(planet => ({ id: planet.id, coordinates: planet.coordinates, tempMax: planet.tempMax,
      buildings: planet.buildings, units: planet.units, productionPct: planet.productionPct, resources: money(planet.resources),
      economy: economy(selectPlanet(state, planet.id)), buildQueue: planet.buildQueue, shipyardQueue: planet.shipyardQueue })) };
}
function event(kind: string, detail: unknown): void { events.push({ continuationSeconds: elapsed, stage, kind, detail }); }
function progress(detail: unknown): void { process.stderr.write(JSON.stringify({ continuationSeconds: elapsed, stage, detail }) + "\n"); }
function independentCost(base: readonly [number, number, number, number], level: number): OrderMoney {
  const factor = base[3] ** (level - 1);
  return { metal: String(Math.floor(base[0] * factor * (1 + 1e-12))),
    crystal: String(Math.floor(base[1] * factor * (1 + 1e-12))), deuterium: String(Math.floor(base[2] * factor * (1 + 1e-12))) };
}
function expectedBuilding(id: BuildingId, level: number): OrderMoney {
  const base = BUILD_BASE[id]; check(base, `no independent building price for ${id}`); return independentCost(base, level);
}
function observe(): void {
  const jobs: JobProof[] = [
    ...state.planets.flatMap(planet => [
      ...planet.buildQueue.map(job => ({ jobId: job.jobId, planetId: planet.id, source: job.source, taskId: job.taskId,
        kind: "building", paid: money(job.paid), target: { building: job.building, targetLevel: job.targetLevel } })),
      ...planet.shipyardQueue.map(job => ({ jobId: job.jobId, planetId: planet.id, source: job.source, taskId: job.taskId,
        kind: "shipyard", paid: money({ metal: job.paidPerUnit.metal.mul(job.orderedCount), crystal: job.paidPerUnit.crystal.mul(job.orderedCount),
          deuterium: job.paidPerUnit.deuterium.mul(job.orderedCount) }), target: { unit: job.unit, quantity: job.orderedCount } })),
    ]),
    ...state.research.queue.map(job => ({ jobId: job.jobId, planetId: job.planetId, source: job.source, taskId: job.taskId,
      kind: "research", paid: money(job.paid), target: { tech: job.tech, targetLevel: job.targetLevel } })),
  ];
  check(new Set(jobs.map(job => job.jobId)).size === jobs.length, "duplicate live paid job");
  for (const job of jobs) {
    check(job.jobId >= firstNewJobId && job.jobId < state.orders.nextJobId, "paid job is outside the continued issuance range");
    if (paidJobs.has(job.jobId)) exact(job, paidJobs.get(job.jobId), `immutable paid job ${job.jobId}`);
    else { paidJobs.set(job.jobId, job); event("paid-job-observed", job); }
    if (job.taskId !== null) {
      const owner = state.orders.tasks.find(task => task.id === job.taskId);
      check(owner && owner.planetId === job.planetId && owner.kind === job.kind && owner.activeJob?.jobId === job.jobId,
        `paid job ${job.jobId} lost its fixed payer/owner`);
    }
  }
  check(state.manualClicks === 0 && state.arcade.stats.manualRuns === 0 && state.arcade.stats.autoRuns === 0,
    "route collected manually or revealed a ring prize");
  check(Object.values(state.curvature).every(rank => rank === 0), "route bought a curvature multiplier");
}
function action<T extends { state: GameState; ok: boolean; reason: string }>(api: string, request: unknown, run: () => T): T {
  check(actions.length < 1500, "bounded player-action count exhausted");
  const before = state, result = run(); state = result.state;
  actions.push({ index: actions.length + 1, continuationSeconds: elapsed, stage, api, request, ok: result.ok, reason: result.reason,
    beforeWallets: wallets(before), afterWallets: wallets(), beforeNextJobId: before.orders.nextJobId, afterNextJobId: state.orders.nextJobId,
    beforeGrants: grantSnapshot(before), afterGrants: grantSnapshot() });
  check(result.ok, `${api}: ${result.reason}`); observe(); return result;
}
function select(planetId: string): void {
  if (state.activePlanetId === planetId) return;
  check(state.planets.some(planet => planet.id === planetId), `missing selected planet ${planetId}`);
  action("selectPlanet", { planetId }, () => ({ state: selectPlanet(state, planetId), ok: true, reason: "explicit planet selection" }));
}
function debit(before: GameState, payerId: string, price: ResourceAmounts, label: string): void {
  for (const planet of before.planets) for (const id of RESOURCE_IDS) {
    const expected = planet.resources[id].sub(planet.id === payerId ? price[id] : 0);
    check(state.planets.find(value => value.id === planet.id)!.resources[id].toString() === expected.toString(), `${label}: wrong immediate wallet ${planet.id}/${id}`);
  }
  payments.push({ label, continuationSeconds: elapsed, payerId, paid: money(price), beforeWallets: wallets(before), afterWallets: wallets(), exactImmediateDebit: true });
}
function oneSecond(): void {
  check(elapsed < LIMIT_SECONDS, `strict ${LIMIT_SECONDS}-game-second continuation budget exhausted`);
  const before = state, log = emptyTickLog(); state = tick(state, 1, "live", log); elapsed += 1;
  near(state.totalTime.toNumber(), originGameSeconds + elapsed, "audited one-second live clock");
  check(state.orders.nextJobId >= before.orders.nextJobId && state.orders.nextTaskId >= before.orders.nextTaskId
    && state.orders.nextWorkId >= before.orders.nextWorkId && state.nextFleetId >= before.nextFleetId, "identity counter moved backwards");
  observe();
  if (planPaymentWatch !== null && !planPaymentProved && state.planets.some(p => p.buildQueue.some(job => job.taskId === planPaymentWatch))) {
    provePlanDebit(before, planPaymentWatch); planPaymentProved = true;
  }
  for (const old of before.planets) {
    const now = state.planets.find(planet => planet.id === old.id)!;
    const delta = now.terraformerFields.grantedLevels - old.terraformerFields.grantedLevels;
    if (delta === 0) { check(now.fieldsMax === old.fieldsMax, "fields changed without a real grant"); continue; }
    const head = old.buildQueue[0];
    check(delta === 1 && head?.building === "terraformer" && head.jobId >= before.terraformerGrantJobFloor
      && head.targetLevel === old.buildings.terraformer + 1 && head.remainingSeconds <= 1 + 1e-9
      && now.buildings.terraformer === old.buildings.terraformer + 1 && now.fieldsMax === old.fieldsMax + 5
      && usedFields(now) === usedFields(old) + 1 && !now.buildQueue.some(job => job.jobId === head.jobId),
    "grant did not correspond to this planet's real paid head reaching completion");
    const proof = { continuationSeconds: elapsed, planetId: old.id, selectedPlanetId: before.activePlanetId, jobId: head.jobId,
      taskId: head.taskId, source: head.source, paid: money(head.paid), before: grantSnapshot(before).find(p => p.planetId === old.id),
      after: grantSnapshot().find(p => p.planetId === old.id), fieldsAdded: 5, usedAdded: 1, freeAdded: 4 };
    completedTerraformers.push(proof); event("actual-terraformer-completion-and-net-four", proof);
  }
  if (log.completedBuilds.length || log.completedResearch.length || log.completedUnits.length) event("paid-queue-completions", log);
  for (const saved of milestones) if (!saved.subsequentLiveTickObserved) {
    saved.subsequentLiveTickObserved = true; saved.firstSubsequentLiveTickAt = originGameSeconds + elapsed;
  }
  if (elapsed % 1800 === 0) {
    const planet = activePlanet(state), eco = economy(state);
    progress({ waiting: true, planetId: planet.id, resources: money(planet.resources), supply: eco.supply,
      netPerSecond: eco.net, caps: eco.caps, nanite: planet.buildings.nanite_factory,
      energyTech: state.research.levels.energy_tech, computerTech: state.research.levels.computer_tech,
      buildingHead: planet.buildQueue[0] ? { building: planet.buildQueue[0].building, target: planet.buildQueue[0].targetLevel,
        remaining: planet.buildQueue[0].remainingSeconds } : null,
      researchHead: state.research.queue[0] ? { tech: state.research.queue[0].tech, target: state.research.queue[0].targetLevel,
        remaining: state.research.queue[0].remainingSeconds } : null });
  }
}
function until(label: string, ready: () => boolean, reason: () => string): void {
  const start = elapsed; let firstReason = "", lastReason = "";
  try { while (!ready()) { lastReason = reason(); if (!firstReason) firstReason = lastReason; oneSecond(); } }
  finally { waits.push({ stage, label, startedAt: start, endedAt: elapsed, waitedSeconds: elapsed - start, firstReason, lastReason }); }
}
function checkpoint(name: string): void {
  const at = originSavedAt + elapsed * 1000;
  for (let round = 1; round <= 2; round += 1) {
    const before = serializeState(state), restored = deserializeState(importSave(exportSave(state, at, at)).state);
    exact(before, serializeState(restored), `${name} strict whole-state roundtrip ${round}`); state = restored;
  }
  milestones.push({ name, gameSeconds: originGameSeconds + elapsed, continuationSeconds: elapsed, strictRoundtrips: 2,
    stateAdoptedFromReload: true, subsequentLiveTickObserved: false, snapshot: snapshot(), save: importSave(exportSave(state, at, at)) });
  actions.push({ continuationSeconds: elapsed, stage, api: "exportSave/importSave/deserializeState", request: { name, strictRoundtrips: 2 }, ok: true });
  progress({ milestone: name, grants: grantSnapshot(), wallets: wallets() });
}
function coverCaps(planetId: string, price: ResourceAmounts): void {
  for (const id of RESOURCE_IDS) {
    select(planetId);
    while (price[id].gt(economy(state).caps[id])) build(planetId, STORAGE[id], activePlanet(state).buildings[STORAGE[id]] + 1);
  }
}
function fund(planetId: string, price: ResourceAmounts): void {
  select(planetId);
  if (planetId === colonyId && colonyTransportEnabled && RESOURCE_IDS.some(id => activePlanet(state).resources[id].lt(price[id]))) shipMissingToColony(price);
  select(planetId);
}
function build(planetId: string, building: BuildingId, target: number): void {
  select(planetId);
  while (activePlanet(state).buildings[building] < target) {
    const first = canEnqueue(state, building); coverCaps(planetId, first.cost); fund(planetId, first.cost);
    until(`afford ${planetId}/${building}`, () => canEnqueue(state, building).ok, () => canEnqueue(state, building).reason);
    const quote = canEnqueue(state, building), before = state;
    exactMoney(money(quote.cost), expectedBuilding(building, quote.targetLevel), `${building}/${quote.targetLevel} independent cost`);
    const result = action("enqueue", { planetId, building, targetLevel: quote.targetLevel, source: "manual", cost: money(quote.cost) }, () => enqueue(state, building, "manual"));
    debit(before, planetId, quote.cost, `${building}/${quote.targetLevel} #${result.jobId}`);
    if (building === "nanite_factory" && quote.targetLevel === 1) {
      exactMoney(money(quote.cost), GOLDEN.nanite1, "nanite1 golden"); near(activePlanet(state).buildQueue[0]!.totalSeconds, GOLDEN.nanite1SecondsR10N0, "nanite1 independent time");
    }
    until(`complete ${planetId}/${building}/${quote.targetLevel}`, () => activePlanet(state).buildings[building] >= quote.targetLevel, () => "real paid building queue");
  }
}
function research(tech: ResearchId, target: number): void {
  select(homeId);
  while (state.research.levels[tech] < target) {
    const first = canEnqueueResearch(state, tech); coverCaps(homeId, first.cost);
    until(`afford ${tech}`, () => canEnqueueResearch(state, tech).ok, () => canEnqueueResearch(state, tech).reason);
    const quote = canEnqueueResearch(state, tech), before = state, base = TECH_BASE[tech]; check(base, `missing independent ${tech} cost`);
    exactMoney(money(quote.cost), independentCost(base, quote.targetLevel), `${tech}/${quote.targetLevel} independent cost`);
    const result = action("enqueueResearch", { planetId: homeId, tech, targetLevel: quote.targetLevel, source: "manual", cost: money(quote.cost) }, () => enqueueResearch(state, tech, "manual"));
    debit(before, homeId, quote.cost, `${tech}/${quote.targetLevel} #${result.jobId}`);
    if (tech === "energy_tech" && quote.targetLevel === 12) {
      exactMoney(money(quote.cost), GOLDEN.energy12, "energy12 golden");
      near(state.research.queue[0]!.totalSeconds, GOLDEN.energy12SecondsLab6, "energy12 independent time");
    }
    if (tech === "computer_tech" && quote.targetLevel === 10) exactMoney(money(quote.cost), GOLDEN.computer10, "computer10 golden");
    until(`complete ${tech}/${quote.targetLevel}`, () => state.research.levels[tech] >= quote.targetLevel, () => "real paid research queue");
  }
}
function units(planetId: string, unit: UnitId, target: number): void {
  select(planetId);
  const count = target - activePlanet(state).units[unit]; if (count <= 0) return;
  const initial = canBuildUnits(state, unit, count); coverCaps(planetId, initial.cost); fund(planetId, initial.cost);
  until(`afford ${planetId}/${unit} x${count}`, () => canBuildUnits(state, unit, count).ok, () => canBuildUnits(state, unit, count).reason);
  const quote = canBuildUnits(state, unit, count), before = state, base = UNIT_BASE[unit]; check(base, `missing independent unit cost ${unit}`);
  const expected = { metal: String(base[0] * count), crystal: String(base[1] * count), deuterium: String(base[2] * count) };
  exactMoney(money(quote.cost), expected, `${unit} independent batch cost`);
  const result = action("orderUnits", { planetId, unit, count, source: "manual", cost: expected }, () => orderUnits(state, unit, count, "manual"));
  debit(before, planetId, quote.cost, `${unit} x${count} #${result.jobId}`);
  until(`complete ${planetId}/${unit} x${count}`, () => activePlanet(state).units[unit] >= target, () => "real paid shipyard batch");
}
function production(pct: number): void {
  select(homeId);
  action("setProductionPct", { planetId: homeId, building: "solar_plant", pct }, () => ({ state: setProductionPct(state, "solar_plant", pct), ok: true, reason: "explicit normal player production setting" }));
  check(activePlanet(state).productionPct.solar_plant === pct, "player production setting was ignored");
}
function provePlanDebit(before: GameState, taskId: number): void {
  const payer = state.planets.find(p => p.buildQueue.some(job => job.taskId === taskId))!;
  const job = payer.buildQueue.find(value => value.taskId === taskId)!;
  check(job.source === "plan" && payer.id === homeId && job.building === "terraformer" && job.targetLevel === 2,
    "finite payment has wrong source, fixed payer or target");
  exactMoney(money(job.paid), GOLDEN.terra2, "finite terra2 price");
  check(before.orders.accumulator === 9 && before.research.queue.length === 0 && before.fleets.length === 0 && before.boosters.length === 0
    && before.planets.every(p => p.buildQueue.length === 0 && p.shipyardQueue.length === 0)
    && nextBeaconIn(before) > 1 && state.orders.nextJobId === before.orders.nextJobId + 1,
  "finite payment was not an isolated end-of-one-second order pass");
  exact(before.unlocked, state.unlocked, "finite payment crossed achievement multiplier change");
  const proof: Array<Record<string, unknown>> = [];
  for (const old of before.planets) {
    const now = state.planets.find(p => p.id === old.id)!, eco = economy(selectPlanet(before, old.id));
    const expected = { ...ZERO };
    for (const id of RESOURCE_IDS) {
      const produced = old.resources[id].add(eco.net[id]);
      check(eco.net[id] >= 0 && (eco.net[id] === 0 || produced.lt(big(eco.caps[id]).sub(eco.caps[id] * 1e-12))), "isolated plan audit crossed storage boundary");
      expected[id] = produced.sub(old.id === payer.id ? job.paid[id] : 0).toString();
      check(now.resources[id].toString() === expected[id], `finite payment exact wallet mismatch ${old.id}/${id}`);
    }
    proof.push({ planetId: old.id, before: money(old.resources), productionPerSecond: eco.net, paid: old.id === payer.id ? money(job.paid) : ZERO,
      expected, actual: money(now.resources) });
  }
  payments.push({ continuationSeconds: elapsed, label: "isolated finite terra2 payment", jobId: job.jobId, taskId, payerId: payer.id,
    selectedPlanetId: before.activePlanetId, exactOneSecondWalletEquality: true, wallets: proof });
}
function proveUnpaidWaitTick(before: GameState): unknown {
  check(before.research.queue.length === 0 && before.fleets.length === 0 && before.boosters.length === 0
    && before.planets.every(p => p.buildQueue.length === 0 && p.shipyardQueue.length === 0)
    && nextBeaconIn(before) > 1 && state.orders.nextJobId === before.orders.nextJobId,
  "underpowered wait audit encountered another financial event");
  exact(before.unlocked, state.unlocked, "underpowered wait changed achievement production multiplier");
  const proof: Array<Record<string, unknown>> = [];
  for (const old of before.planets) {
    const now = state.planets.find(p => p.id === old.id)!, eco = economy(selectPlanet(before, old.id));
    const expected = { ...ZERO };
    for (const id of RESOURCE_IDS) {
      const produced = old.resources[id].add(eco.net[id]);
      check(eco.net[id] >= 0 && (eco.net[id] === 0 || produced.lt(big(eco.caps[id]).sub(eco.caps[id] * 1e-12))),
        "isolated underpowered wait crossed a storage boundary");
      expected[id] = produced.toString();
      check(now.resources[id].toString() === expected[id], `underpowered plan debited ${old.id}/${id}`);
    }
    proof.push({ planetId: old.id, before: money(old.resources), productionPerSecond: eco.net, expected, actual: money(now.resources) });
  }
  return { continuationSeconds: elapsed, nextJobId: state.orders.nextJobId, zeroDebitProved: true, wallets: proof };
}
function shipMissingToColony(price: ResourceAmounts): void {
  select(colonyId);
  const cargo = { metal: big(0), crystal: big(0), deuterium: big(0) };
  for (const id of RESOURCE_IDS) {
    const missing = price[id].sub(activePlanet(state).resources[id]); cargo[id] = missing.gt(0) ? missing.ceil() : big(0);
  }
  if (RESOURCE_IDS.every(id => cargo[id].eq(0))) return;
  const target = { ...activePlanet(state).coordinates }, recipientBefore = money(activePlanet(state).resources);
  select(homeId);
  const request: FleetRequest = { mission: "transport", target, ships: { large_cargo: 80 }, cargo, speedPercent: 100 };
  until("naturally fund exact colony shipment and fuel", () => quoteFlight(state, request).ok, () => quoteFlight(state, request).reason);
  const quote = quoteFlight(state, request), before = state;
  const result = action("sendFleet", { ...request, cargo: money(cargo), quotedFuel: quote.fuel.toString(), from: homeId, to: colonyId }, () => sendFleet(state, request));
  debit(before, homeId, { ...cargo, deuterium: cargo.deuterium.add(quote.fuel) }, `transport fleet #${result.fleetId} cargo plus fuel`);
  until(`actual colony arrival fleet ${result.fleetId}`, () => !!state.fleets.find(f => f.id === result.fleetId)?.returning, () => "real outbound transport countdown");
  const returned = state.fleets.find(f => f.id === result.fleetId)!;
  check(returned.returning && RESOURCE_IDS.every(id => returned.cargo[id].eq(0)), "shipment did not unload before return");
  const landed = state.planets.find(p => p.id === colonyId)!;
  for (const id of RESOURCE_IDS) check(landed.resources[id].gte(price[id]), `actual ${id} delivery cannot fund quoted colony work`);
  shipments.push({ fleetId: result.fleetId, originId: homeId, destinationId: colonyId, cargo: money(cargo), fuel: quote.fuel.toString(),
    recipientBeforeDispatch: recipientBefore, recipientAfterArrival: money(landed.resources), continuationSeconds: elapsed,
    sourceExactDebitAudited: true, actualArrivalObserved: true });
  until(`real return fleet ${result.fleetId}`, () => !state.fleets.some(f => f.id === result.fleetId), () => "real return transport countdown");
  check(state.planets.find(p => p.id === homeId)!.units.large_cargo === 80, "transport fleet failed to return to its origin");
  select(colonyId);
}
function payTerraformer(planetId: string, level: 1 | 2, milestone: string): number {
  select(planetId); const quote = canEnqueue(state, "terraformer");
  check(quote.ok && quote.targetLevel === level, `terraformer ${level} not genuinely ready: ${quote.reason}`);
  exactMoney(money(quote.cost), level === 1 ? GOLDEN.terra1 : GOLDEN.terra2, "terraformer independent price");
  const before = state, oldGrants = grantSnapshot();
  const paid = action("enqueue", { planetId, building: "terraformer", targetLevel: level, source: "manual", reviewedCost: money(quote.cost), supply: economy(state).supply }, () => enqueue(state, "terraformer", "manual"));
  debit(before, planetId, quote.cost, `terraformer ${level} job #${paid.jobId}`);
  exact(oldGrants, grantSnapshot(), "payment must not grant fields");
  const job = activePlanet(state).buildQueue.find(value => value.jobId === paid.jobId)!;
  check(job.source === "manual" && job.taskId === null && job.remainingSeconds > 0 && job.jobId >= state.terraformerGrantJobFloor, "terraformer job is not newly paid and in progress");
  near(job.totalSeconds, level === 1 ? GOLDEN.terra1SecondsR10N1 : GOLDEN.terra2SecondsR10N1, "terraformer independent build time");
  checkpoint(milestone); return job.jobId;
}

async function loadOrigin(): Promise<void> {
  const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
    import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
  ]);
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    check(["--report", "--expected-report-sha256", "--source-sha"].includes(flag!) && value && !args.has(flag!), "usage: --report PATH --expected-report-sha256 HASH --source-sha SHA");
    args.set(flag!, value);
  }
  check(args.size === 3 && args.get("--expected-report-sha256") === ORIGIN_REPORT_HASH && args.get("--source-sha") === ORIGIN_SHA, "origin source/hash does not equal pinned verified 533 CI provenance");
  const bytes = readFileSync(args.get("--report"));
  const hash = String(createHash("sha256").update(bytes).digest("hex")); check(hash === ORIGIN_REPORT_HASH, "immutable natural-growth report byte hash mismatch");
  const report = JSON.parse(String(bytes)) as { schema: string; outcome: { status: string }; milestones: OriginMilestone[]; seeds: unknown };
  check(report.schema === "infinity-natural-growth-journey-v1" && report.outcome.status === "passed", "origin is not the verified successful natural-growth report");
  const found = report.milestones.filter(m => m.name === ORIGIN_MILESTONE); check(found.length === 1, "origin milestone missing or duplicated");
  const old = found[0]!;
  check(old.gameSeconds === 1789 && old.strictRoundtrips === 2 && old.subsequentLiveTickObserved && old.save.version === 9 && old.save.revision === 9, "origin milestone provenance differs");
  const root = new URL("../", import.meta.url), git = (argv: string[]) => String(execFileSync("git", argv, { cwd: root, encoding: "utf8", timeout: 10000 })).trimEnd();
  const head = git(["rev-parse", "HEAD"]); check(!process.env.GITHUB_SHA || process.env.GITHUB_SHA === head, "GITHUB_SHA differs from actual runtime checkout");
  const scriptPath = "scripts/natural-terraformer-journey.ts";
  source = { sourceSha: head, gitHead: head, scriptPath, scriptSha256: String(createHash("sha256").update(readFileSync(new URL("./natural-terraformer-journey.ts", import.meta.url))).digest("hex")),
    worktreeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all"]),
    sourceScopeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", "package.json", "package-lock.json", "index.html", "tsconfig.json", "vite.config.ts"]),
    identityNote: "Dirty running source is identified by the recorded script hash and worktree status, not by HEAD alone." };
  origin = { sourceSha: ORIGIN_SHA, ciRunId: "38109216821", reportPath: args.get("--report"), reportSha256: hash,
    milestoneName: ORIGIN_MILESTONE, strictRoundtrips: old.strictRoundtrips, subsequentLiveTickObserved: old.subsequentLiveTickObserved,
    sourceBinding: "Pinned immutable CI report plus verified source artifact binding; the old report does not itself embed sourceSha.", originalSave: old.save };
  const migrated = importSave(JSON.stringify(old.save)); state = deserializeState(migrated.state); stateInitialized = true;
  check(migrated.revision === 12 && SAVE_REVISION === 12 && SAVE_VERSION === 9, "formal r9-to-r12 migration is not active");
  check(migrated.savedAt === old.save.savedAt && migrated.lastTickAt === old.save.lastTickAt, "migration changed original envelope clocks");
  const projected = structuredClone(serializeState(state)) as unknown as Record<string, unknown>;
  assertNpcEconomy(projected, 0, "pure r9 migration must not backfill historical NPC age");
  delete projected.npcEconomy;
  delete projected.terraformerGrantJobFloor;
  for (const planet of projected.planets as Array<Record<string, unknown>>) {
    check(Object.hasOwn(planet, "demolition") && planet.demolition === null, "Old r9 migration must add only null demolition");
    delete planet.demolition; delete planet.terraformerFields;
  }
  exact(old.save.state, projected, "r12 additive migration complete old-state projection");
  const oldOrders = old.save.state.orders as { nextJobId: number };
  check(state.terraformerGrantJobFloor === oldOrders.nextJobId, "migration floor is not the historical nextJobId");
  for (const planet of state.planets) check(planet.terraformerFields.base === planet.fieldsMax && planet.terraformerFields.grantedLevels === 0,
    "migration awarded fields or changed the historic field base");
  homeId = "homeworld"; colonyId = "colony-1"; originGameSeconds = old.gameSeconds; originSavedAt = old.save.savedAt; firstNewJobId = state.orders.nextJobId;
  check(state.planets.some(p => p.id === homeId) && state.planets.some(p => p.id === colonyId)
    && state.planets.every(p => p.buildQueue.length === 0 && p.shipyardQueue.length === 0) && state.research.queue.length === 0 && state.fleets.length === 0
    && state.orders.tasks.every(task => task.status === "completed") && state.protocols.slots.every(slot => slot.card === null), "origin is not a settled natural world");
  event("strict-additive-migration-proved", { originSha: ORIGIN_SHA, reportSha256: hash, allPriorStateFieldsEqual: true,
    unchangedEnvelopeClocks: true, floor: state.terraformerGrantJobFloor, grants: grantSnapshot() });
}

let outcome: Record<string, unknown>;
try {
  await loadOrigin(); checkpoint("01-verified-r9-natural-origin-additively-migrated-and-reloaded");
  stage = "normal-mine-and-storage-growth";
  build(homeId, "robotics_factory", 4); build(homeId, "research_lab", 6);
  for (let level = 8; level <= 18; level += 1) for (const id of ["deuterium_synth", "crystal_mine", "metal_mine"] as const) {
    select(homeId); if (activePlanet(state).buildings[id] >= level) continue;
    if (activePlanet(state).buildings.solar_plant < 18) build(homeId, "solar_plant", activePlanet(state).buildings.solar_plant + 1);
    const b = activePlanet(state).buildings;
    const demand = (Object.keys({ metal_mine: 0, crystal_mine: 0, deuterium_synth: 0 }) as Array<"metal_mine" | "crystal_mine" | "deuterium_synth">)
      .reduce((sum, key) => { const n = key === id ? level : b[key]; return sum + (key === "deuterium_synth" ? 20 : 10) * n * 1.1 ** n; }, 0);
    const solar = 20 * b.solar_plant * 1.1 ** b.solar_plant;
    units(homeId, "solar_satellite", Math.min(66, Math.max(0, Math.ceil((demand - solar) / 30))));
    build(homeId, id, level);
  }
  units(homeId, "solar_satellite", 66); build(homeId, "metal_storage", 8); build(homeId, "crystal_storage", 9); build(homeId, "deuterium_tank", 7);
  exact(economy(state).caps, GOLDEN.minimumStorageCaps, "minimum peak-payment storage golden");
  near(economy(state).supply, GOLDEN.motherSolar18And66SatellitesSupply, "real full-setting supply");
  checkpoint("02-naturally-funded-mines18-storage8-9-7-and-66-satellites");

  stage = "normal-nanite-and-energy-research";
  build(homeId, "robotics_factory", 10); research("computer_tech", 10); build(homeId, "nanite_factory", 1);
  checkpoint("03-real-nanite1-paid-prerequisites-completed");
  research("energy_tech", 12);
  until("first terra wallet plus second-level headroom", () => activePlanet(state).resources.crystal.gte(200000) && activePlanet(state).resources.deuterium.gte(320000), () => "natural C/D production");
  production(0); near(economy(state).supply, 1980, "real 1980 supply");
  check(terraformerEnergyRequirement(1) === 1000 && terraformerEnergyRequirement(2) === 2000, "independent energy-level goldens");
  checkpoint("04-before-new-payment-nanite1-energy12-real1980-supply-and-wallet-ready");

  stage = "first-real-terraformer-and-reload";
  payTerraformer(homeId, 1, "05-terra1-actually-paid-and-in-progress-no-fields-yet");
  until("real terra1 countdown", () => activePlanet(state).buildings.terraformer === 1, () => "real paid terra1 countdown");
  check(activePlanet(state).fieldsMax === 168 && activePlanet(state).terraformerFields.grantedLevels === 1, "first real terra completion did not add exactly five");
  checkpoint("06-terra1-completed-total-plus5-used-plus1-free-plus4");
  const afterFirstGrants = grantSnapshot(); build(homeId, "metal_storage", 9);
  check(activePlanet(state).fieldsMax === 168 && activePlanet(state).terraformerFields.grantedLevels === 1
    && usedFields(activePlanet(state)) === afterFirstGrants.find(p => p.planetId === homeId)!.usedFields + 1, "ordinary building awarded terra fields or failed to occupy its own field");
  checkpoint("07-real-ordinary-building-after-first-expansion");

  stage = "finite-terra2-energy-wait-and-exact-cancel";
  until("safe isolated plan payment window", () => nextBeaconIn(state) > 45, () => "natural beacon boundary before isolated payment witness");
  const blocked = canEnqueue(state, "terraformer");
  check(!blocked.ok && !blocked.onlyResources && blocked.targetLevel === 2 && economy(state).supply === 1980, "second terra is not blocked specifically by actual supply");
  const taskId = state.orders.nextTaskId, request: CreateOrderRequest = { kind: "building", planetId: homeId, building: "terraformer", targetLevel: 2,
    budget: { ...GOLDEN.terra2 }, expectedNextTaskId: taskId };
  const beforeIntent = state;
  action("createOrderTask", request, () => createOrderTask(state, request));
  exact(wallets(beforeIntent), wallets(), "creating finite intent must not charge");
  check(state.orders.nextJobId === beforeIntent.orders.nextJobId, "creating intent issued a paid job");
  const unpaidWaitProofs: unknown[] = [];
  for (let i = 0; i < 20; i += 1) { const beforeWaitTick = state; oneSecond(); unpaidWaitProofs.push(proveUnpaidWaitTick(beforeWaitTick)); }
  event("underpowered-finite-plan-exact-zero-wallet-debit-for-twenty-live-seconds", { taskId, supply: 1980, ticks: unpaidWaitProofs });
  const waitingTask = state.orders.tasks.find(task => task.id === taskId)!;
  check(state.orders.nextJobId === beforeIntent.orders.nextJobId && activePlanet(state).buildQueue.length === 0
    && waitingTask.activeJob === null && waitingTask.status === "running", "underpowered finite plan spent or stopped permanently");
  exactMoney(waitingTask.charged, ZERO, "underpowered plan gross charge"); exactMoney(waitingTask.refunded, ZERO, "underpowered plan refund");
  checkpoint("08-terra2-finite-plan-waiting-at1980-no-charge-no-job");
  production(100); planPaymentWatch = taskId; planPaymentProved = false;
  select(colonyId);
  until("fixed-home finite plan actually pays after real supply restored", () => planPaymentProved, () => "real ten-second plan pass");
  planPaymentWatch = null;
  const paidPlanJob = state.planets.find(p => p.id === homeId)!.buildQueue.find(job => job.taskId === taskId)!;
  near(paidPlanJob.totalSeconds, GOLDEN.terra2SecondsR10N1, "finite terra2 independent build time");
  checkpoint("09-terra2-finite-plan-paid-on-home-while-colony-selected");
  action("pauseOrderTask", { taskId }, () => pauseOrderTask(state, taskId));
  const beforeCancel = state, beforeCancelGrants = grantSnapshot();
  action("cancelPaidJob", { kind: "building", planetId: homeId, jobId: paidPlanJob.jobId }, () => cancelPaidJob(state, { kind: "building", planetId: homeId, jobId: paidPlanJob.jobId }));
  for (const old of beforeCancel.planets) for (const id of RESOURCE_IDS) {
    const expected = old.resources[id].add(old.id === homeId ? paidPlanJob.paid[id] : 0);
    check(state.planets.find(p => p.id === old.id)!.resources[id].toString() === expected.toString(), `cancel exact refund ${old.id}/${id}`);
  }
  exact(beforeCancelGrants, grantSnapshot(), "paid cancellation must not grant fields");
  const cancelledTask = state.orders.tasks.find(task => task.id === taskId)!;
  exactMoney(cancelledTask.charged, GOLDEN.terra2, "cancelled plan retains original gross paid charge");
  exactMoney(cancelledTask.refunded, GOLDEN.terra2, "cancelled plan refunds actual original price");
  cancelledTerraformers.push({ planetId: homeId, jobId: paidPlanJob.jobId, taskId, source: paidPlanJob.source,
    paid: money(paidPlanJob.paid), refunded: money(paidPlanJob.paid), beforeWallets: wallets(beforeCancel), afterWallets: wallets(), noFieldsGranted: true });
  action("cancelOrderTask", { taskId }, () => cancelOrderTask(state, taskId));
  checkpoint("10-paid-terra2-cancelled-exact-refund-no-new-grant");
  payTerraformer(homeId, 2, "11-explicitly-reauthorized-terra2-paid-again-new-job");
  select(colonyId);
  until("real second home terra completion with different selected planet", () => state.planets.find(p => p.id === homeId)!.buildings.terraformer === 2, () => "real newly paid terra2 countdown");
  check(state.planets.find(p => p.id === homeId)!.fieldsMax === 173 && state.planets.find(p => p.id === homeId)!.terraformerFields.grantedLevels === 2
    && state.planets.find(p => p.id === colonyId)!.terraformerFields.grantedLevels === 0, "second completion credited wrong planet or count");
  checkpoint("12-two-real-home-terraformers-complete-and-reloaded");
  const stableGrants = grantSnapshot(); for (let i = 0; i < 3; i += 1) { oneSecond(); checkpoint(`12${i + 1}-completed-world-reloaded-without-repeat-grant`); }
  exact(stableGrants, grantSnapshot(), "repeat reload/tick awarded already completed terra again");

  stage = "real-colony-logistics-and-local-prerequisites";
  select(homeId); research("combustion_drive", 6); units(homeId, "large_cargo", 80); colonyTransportEnabled = true;
  // Each local purchase gets only its actual shortfall from a real home-source
  // flight, with both legs and fuel recorded. No artificial colony endowment.
  build(colonyId, "robotics_factory", 10);
  build(colonyId, "metal_storage", 8); build(colonyId, "crystal_storage", 7); build(colonyId, "deuterium_tank", 4);
  build(colonyId, "nanite_factory", 1); build(colonyId, "solar_plant", 14);
  const colonyQuote = canEnqueue(state, "terraformer"); fund(colonyId, colonyQuote.cost);
  until("colony terra genuinely payable", () => canEnqueue(state, "terraformer").ok, () => canEnqueue(state, "terraformer").reason);
  checkpoint("13-actual-colony-local-nanite1-solar14-and-transport-funded-wallet");
  const homeBeforeColony = grantSnapshot().find(p => p.planetId === homeId)!;
  const colonyBefore = grantSnapshot().find(p => p.planetId === colonyId)!;
  payTerraformer(colonyId, 1, "14-colony-terra1-actually-paid-and-reloaded"); select(homeId);
  until("real colony terra while home selected", () => state.planets.find(p => p.id === colonyId)!.buildings.terraformer === 1, () => "real colony paid countdown");
  exact(homeBeforeColony, grantSnapshot().find(p => p.planetId === homeId), "colony completion changed home fields");
  check(state.planets.find(p => p.id === colonyId)!.fieldsMax === colonyBefore.fieldsMax + 5
    && state.planets.find(p => p.id === colonyId)!.terraformerFields.base === colonyBefore.base, "colony field base was replaced by home default");
  checkpoint("15-real-second-planet-expansion-attributed-and-reloaded");

  stage = "curvature-retirement-and-no-grant-revival";
  select(homeId); const retiredTaskId = state.orders.nextTaskId;
  const retireRequest: CreateOrderRequest = { kind: "building", planetId: homeId, building: "terraformer", targetLevel: 3,
    budget: { metal: "0", crystal: "200000", deuterium: "400000" }, expectedNextTaskId: retiredTaskId };
  action("createOrderTask", retireRequest, () => createOrderTask(state, retireRequest));
  action("pauseOrderTask", { taskId: retiredTaskId }, () => pauseOrderTask(state, retiredTaskId));
  checkpoint("16-before-curvature-real-expansions-and-unpaid-paused-authority");
  const beforeReset = state, evaluation = evaluatePrestige(state), preview = prestigePreview(state, evaluation);
  const expectedGain = bigFloor(bigSqrt(expansionScore(state).div(PRESTIGE_SCORE_UNIT)));
  check(preview.eligible && evaluation.gain.eq(expectedGain) && expectedGain.gte(1), "actual earned score does not fund curvature");
  event("actual-world-curvature-preview", { preview, beforeGrants: grantSnapshot(), expectedGain: expectedGain.toString() });
  action("prestige", { reviewedGain: preview.gain, explicitRetiredTaskId: retiredTaskId }, () => ({ state: prestige(state), ok: true, reason: "explicit curvature reset of the completed natural world" }));
  exact(serializeState(evaluation.next), serializeState(state), "reset must equal pure preview candidate");
  check(state.planets.length === 1 && activePlanet(state).id === homeId && activePlanet(state).fieldsMax === 163
    && activePlanet(state).terraformerFields.base === 163 && activePlanet(state).terraformerFields.grantedLevels === 0
    && activePlanet(state).buildings.terraformer === 0 && state.terraformerGrantJobFloor === beforeReset.orders.nextJobId
    && state.orders.nextJobId === beforeReset.orders.nextJobId && state.orders.nextTaskId === beforeReset.orders.nextTaskId
    && state.orders.nextWorkId === beforeReset.orders.nextWorkId && state.nextFleetId === beforeReset.nextFleetId,
  "curvature failed to retire the old expansion world and paid-ID boundary");
  exactMoney(money(activePlanet(state).resources), { metal: "500", crystal: "500", deuterium: "0" }, "normal reset wallet");
  exact(beforeReset.research.levels, state.research.levels, "curvature research retention");
  check(state.orders.tasks.find(task => task.id === retiredTaskId)?.status === "cancelled", "old unspent authority survived reset");
  const rejectionBefore = serializeState(state), rejected = resumeOrderTask(state, retiredTaskId);
  check(!rejected.ok, "retired finite terra authority resumed after reset"); exact(rejectionBefore, serializeState(rejected.state), "rejected retired authority changed world");
  event("retired-authority-cannot-resume", { retiredTaskId, reason: rejected.reason });
  checkpoint("17-curvature-new-home163-base163-level0-grants0-old-authority-retired");
  for (let i = 0; i < 2; i += 1) oneSecond();
  check(activePlanet(state).fieldsMax === 163 && activePlanet(state).terraformerFields.grantedLevels === 0 && activePlanet(state).buildQueue.length === 0,
    "post-reset tick revived an old grant or job");
  check(paidJobs.size === state.orders.nextJobId - firstNewJobId, "at least one new paid identity was not independently observed");
  for (let job = firstNewJobId; job < state.orders.nextJobId; job += 1) check(paidJobs.has(job), `missing paid job ${job}`);
  check(completedTerraformers.filter(proof => proof.planetId === homeId).length === 2
    && completedTerraformers.filter(proof => proof.planetId === colonyId).length === 1 && cancelledTerraformers.length === 1 && shipments.length > 0,
  "required natural terra/colony/cancellation scope was not actually completed");
  outcome = { status: "passed", continuationGameSeconds: elapsed, totalGameSeconds: originGameSeconds + elapsed,
    continuationGameHours: elapsed / 3600, completedHomeTerraformers: 2, completedColonyTerraformers: 1,
    cancelledPaidTerraformers: cancelledTerraformers.length, realTransportFlights: shipments.length, newPaidJobsObserved: paidJobs.size,
    maximumContinuationGameSeconds: LIMIT_SECONDS, nativeBrowserContinuation: "not run by this engine script" };
} catch (error) {
  process.exitCode = 1;
  outcome = { status: "blocked", stage, reason: error instanceof Error ? error.message : String(error), continuationGameSeconds: elapsed,
    totalGameSeconds: originGameSeconds + elapsed, maximumContinuationGameSeconds: LIMIT_SECONDS,
    completedHomeTerraformers: completedTerraformers.filter(proof => proof.planetId === homeId).length,
    completedColonyTerraformers: completedTerraformers.filter(proof => proof.planetId === colonyId).length,
    nativeBrowserContinuation: "not run by this engine script", snapshot: stateInitialized ? snapshot() : null };
  progress(outcome);
}
process.stdout.write(JSON.stringify({ schema: "infinity-natural-terraformer-journey-v1", source, origin,
  provenance: { mode: "compressed engine simulation with actual one-second live ticks; not real-time human browser play",
    injectedGameState: false, noManualScrapes: true, noRingPrizeReveals: true, noRawProductionPatches: true,
    clock: "origin totalTime plus counted tick(state, 1, live); deterministic savedAt metadata is not elapsed human time",
    offline: "No offline catch-up is used here. Real continuation remains capped at the unchanged 2–8 hours per catch-up.",
    milestones: "Each milestone is an importable complete world, adopted after two strict whole-state save roundtrips. Native UI continuation is a separate gate." },
  golden: GOLDEN, limits: { continuationGameSeconds: LIMIT_SECONDS, actions: 1500 }, outcome,
  milestones, actions, events, waits, payments, shipments, paidJobs: [...paidJobs.values()], completedTerraformers, cancelledTerraformers, saveDifference }, null, 2) + "\n");
