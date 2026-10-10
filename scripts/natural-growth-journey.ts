/**
 * Natural two-cycle acceptance, not a pre-funded fixture or a browser-play claim.
 * Run: node --import tsx scripts/natural-growth-journey.ts > natural-growth.json
 * stdout is one report with individually importable milestone save envelopes.
 * stderr reports milestones immediately. A blocker produces the same report and exit 1.
 *
 * All game-state replacements below come from createInitialState, player APIs,
 * strict save loading, or tick(state, 1, "live"). No grants, time jumps, modified
 * balance, production-setting patches, ring prizes, or manual collection are used.
 */
declare const process: {
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  exitCode?: number;
};

import type { BuildingId } from "../src/data/buildings";
import type { ResearchId } from "../src/data/research";
import { nextBeaconIn } from "../src/game/arcade";
import { PRESTIGE_SCORE_UNIT } from "../src/game/content";
import { big, bigFloor, bigSqrt } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { createFormation, createFormationReplenishment, previewFormationReplenishment } from "../src/game/formations";
import { distance, npcAt, sameCoordinates, type Coordinates } from "../src/game/galaxy";
import { emptyTickLog, evaluatePrestige, expansionScore, prestige, tick } from "../src/game/logic";
import { quoteOrderMoney } from "../src/game/order-ledger";
import { addOrderAmounts, compareOrderAmounts, multiplyOrderAmountInteger } from "../src/game/order-money";
import type { CreateOrderRequest, OrderMoney } from "../src/game/order-state";
import { createOrderTask, pauseOrderTask, resumeOrderTask } from "../src/game/orders";
import { canEnqueue, costFor, enqueue } from "../src/game/queue";
import type { ResearchTemplateApplyRequest } from "../src/game/research-template-state";
import { applyResearchTemplate, createResearchTemplate, editResearchTemplate, mapResearchTemplate, quoteResearchTemplate } from "../src/game/research-templates";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { canBuildUnits, orderUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";
import { prestigePreview } from "../src/ui/prestige-preview-model";

const WORLD_SEED = 20261010;
const ARCADE_SEED = 20261010;
const FIRST_CYCLE_LIMIT = 120 * 60;
const SECOND_CYCLE_LIMIT = 60 * 60;
const SAVE_EPOCH = Date.UTC(2026, 9, 10);
let state = createInitialState(WORLD_SEED, ARCADE_SEED);
let elapsed = 0;
let secondCycleStartedAt: number | null = null;
let secondPaidBuildCheckpoint = false;
let stage = "initial-state";
const homeId = state.activePlanetId;
const actions: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];
const waits: Array<Record<string, unknown>> = [];
const milestones: Array<Record<string, unknown>> = [];
const seenJobs = new Set<number>();
const taskSnapshots = new Map<number, string>();
const fleetSnapshots = new Map<number, string>();
interface PaidJobEvidence { jobId: number; taskId: number | null; source: string; kind: string; planetId: string; paid: OrderMoney; target: unknown }
const paidJobs = new Map<number, PaidJobEvidence>();
const researchGoalsByTask = new Map<number, { tech: ResearchId; targetLevel: number }>();
const researchRequestsByTemplate = new Map<number, ResearchTemplateApplyRequest>();
const paymentAudits: Array<Record<string, unknown>> = [];
let researchPaymentWatch: { taskId: number; planetId: string; selectedPlanetId: string; tech: ResearchId; targetLevel: number; price: OrderMoney; label: string; zeroDeuteriumProduction: boolean } | null = null;
let researchPaymentProved = false;
let historicalTasks: GameState["orders"]["tasks"] | null = null;
let historicalFleetIds: number[] = [];
let lastCounters = { task: state.orders.nextTaskId, job: state.orders.nextJobId, work: state.orders.nextWorkId, fleet: state.nextFleetId };
interface ExactDifference { path: string; before: unknown; after: unknown; reason: string }
let saveDifference: { phase: string; difference: ExactDifference } | null = null;

class JourneyBlocked extends Error {}
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new JourneyBlocked(`${stage}: ${reason}`);
}
/** Object insertion order is not state. Every field, array index and value is. */
function firstDifference(before: unknown, after: unknown, path = "$state"): ExactDifference | null {
  if (Object.is(before, after)) return null;
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object") {
    return { path, before, after, reason: "exact primitive value or type differs" };
  }
  if (Array.isArray(before) !== Array.isArray(after)) return { path, before, after, reason: "array/object type differs" };
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) {
    return { path: `${path}.length`, before: before.length, after: after.length, reason: "array length differs" };
  }
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    return { path: `${path}.[keys]`, before: leftKeys, after: rightKeys, reason: "field presence differs" };
  }
  // Compare arrays by their actual indices, never by sorting their values.
  const keys = Array.isArray(before) ? Object.keys(before) : leftKeys;
  for (const key of keys) {
    const difference = firstDifference(left[key], right[key], Array.isArray(before) ? `${path}[${key}]` : `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}
function requireExactSave(before: unknown, after: unknown, phase: string): void {
  const difference = firstDifference(before, after);
  if (!difference) return;
  saveDifference = { phase, difference };
  throw new JourneyBlocked(`${stage}: ${phase} changed ${difference.path}: ${difference.reason}`);
}
function money(value: ResourceAmounts): OrderMoney {
  return { metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() };
}
function wallets(): Record<string, OrderMoney> {
  return Object.fromEntries(state.planets.map(planet => [planet.id, money(planet.resources)]));
}
function describe() {
  return {
    gameSeconds: elapsed, totalTime: state.totalTime.toString(), score: expansionScore(state).toString(),
    lifetime: money(state.lifetime), research: { ...state.research.levels },
    planets: state.planets.map(planet => ({
      id: planet.id, coordinates: planet.coordinates, resources: money(planet.resources),
      buildings: planet.buildings, units: planet.units,
      netPerSecond: economy(selectPlanet(state, planet.id)).net,
      storage: economy(selectPlanet(state, planet.id)).caps,
      energyEfficiency: economy(selectPlanet(state, planet.id)).efficiency,
      buildQueue: planet.buildQueue, shipyardQueue: planet.shipyardQueue,
    })),
    researchQueue: state.research.queue, tasks: state.orders.tasks, fleets: state.fleets,
  };
}
function event(kind: string, detail: unknown): void {
  events.push({ gameSeconds: elapsed, stage, kind, detail });
}
/** Observe real queues; the final contiguous-ID audit fails if any short job was missed. */
function observe(): void {
  const counters = { task: state.orders.nextTaskId, job: state.orders.nextJobId, work: state.orders.nextWorkId, fleet: state.nextFleetId };
  check(Object.entries(counters).every(([key, value]) => value >= lastCounters[key as keyof typeof lastCounters]),
    "an authoritative task/job/work/fleet identity counter moved backwards");
  lastCounters = counters;
  if (historicalTasks) {
    for (const old of historicalTasks) check(!firstDifference(old, state.orders.tasks.find(task => task.id === old.id)),
      `retired/completed historical task #${old.id} changed or was reauthorized`);
    check(!state.fleets.some(fleet => historicalFleetIds.includes(fleet.id)), "a returned historical logistics fleet was relaunched");
  }
  const jobs = [
    ...state.planets.flatMap(planet => [
      ...planet.buildQueue.map(job => ({ ...job, kind: "building" as const, planetId: planet.id })),
      ...planet.shipyardQueue.map(job => ({ ...job, kind: "shipyard" as const, planetId: planet.id })),
    ]),
    ...state.research.queue.map(job => ({ ...job, kind: "research" as const })),
  ];
  check(new Set(jobs.map(job => job.jobId)).size === jobs.length, "duplicate live paid-job identity");
  for (const job of jobs) {
    const quoted = quoteOrderMoney(job.kind === "shipyard" ? job.paidPerUnit : job.paid);
    check(quoted, `job #${job.jobId} has no exact paid quote`);
    const paid = { ...quoted };
    if (job.kind === "shipyard") for (const id of RESOURCE_IDS) {
      const total = multiplyOrderAmountInteger(quoted[id], job.orderedCount);
      check(total !== null, "observed ship payment overflow");
      paid[id] = total;
    }
    const target = job.kind === "shipyard" ? { unit: job.unit, quantity: job.orderedCount }
      : job.kind === "research" ? { tech: job.tech, targetLevel: job.targetLevel } : { building: job.building, targetLevel: job.targetLevel };
    const evidence = { jobId: job.jobId, taskId: job.taskId, source: job.source, kind: job.kind, planetId: job.planetId, paid, target };
    if (seenJobs.has(job.jobId)) {
      check(!firstDifference(paidJobs.get(job.jobId), evidence), `paid job #${job.jobId} changed immutable identity or quote`);
      continue;
    }
    if (job.taskId !== null) {
      const owner = state.orders.tasks.find(task => task.id === job.taskId);
      check(owner && owner.planetId === job.planetId && owner.kind === job.kind, `paid job #${job.jobId} has wrong owner/payer`);
      check(job.kind === "research" ? owner.kind === "research" && owner.tech === job.tech && job.targetLevel <= owner.targetLevel
        : job.kind === "building" ? owner.kind === "building" && owner.building === job.building && job.targetLevel <= owner.targetLevel
        : owner.kind === "shipyard" && owner.unit === job.unit && job.orderedCount <= owner.quantity,
      `paid job #${job.jobId} has wrong owned target`);
    }
    seenJobs.add(job.jobId);
    paidJobs.set(job.jobId, evidence);
    event("paid-job-observed", job);
  }
  for (const task of state.orders.tasks) {
    const snapshot = JSON.stringify(task);
    if (taskSnapshots.get(task.id) !== snapshot) {
      taskSnapshots.set(task.id, snapshot);
      event("finite-order-receipt", task);
    }
  }
  const liveFleetIds = new Set(state.fleets.map(fleet => fleet.id));
  for (const fleet of state.fleets) {
    // Only flight transitions; countdowns are represented by the audited tick clock.
    const detail = { id: fleet.id, mission: fleet.mission, originId: fleet.originId,
      target: fleet.target, ships: fleet.ships, cargo: money(fleet.cargo),
      duration: fleet.duration, returning: fleet.returning, orderTransport: fleet.orderTransport };
    const snapshot = JSON.stringify(detail);
    if (fleetSnapshots.get(fleet.id) !== snapshot) {
      fleetSnapshots.set(fleet.id, snapshot);
      event("flight-transition", detail);
    }
  }
  for (const id of fleetSnapshots.keys()) if (!liveFleetIds.has(id)) {
    event("flight-left-active-list", { fleetId: id });
    fleetSnapshots.delete(id);
  }
}
function action<T extends { state: GameState; ok: boolean; reason: string }>(
  api: string, request: unknown, run: () => T,
): T {
  const before = wallets();
  const result = run();
  state = result.state;
  actions.push({ index: actions.length + 1, gameSeconds: elapsed, stage, api, request,
    ok: result.ok, reason: result.reason, beforeWallets: before, afterWallets: wallets() });
  observe();
  check(result.ok, `${api}: ${result.reason}`);
  return result;
}
function select(planetId: string): void {
  if (state.activePlanetId === planetId) return;
  check(state.planets.some(planet => planet.id === planetId), `missing planet ${planetId}`);
  const previous = state.activePlanetId;
  state = selectPlanet(state, planetId);
  actions.push({ index: actions.length + 1, gameSeconds: elapsed, stage,
    api: "selectPlanet", request: { planetId }, previous, ok: true });
}
function oneSecond(): void {
  checkCycleLimit();
  const before = state;
  const log = emptyTickLog();
  state = tick(state, 1, "live", log);
  elapsed += 1;
  check(Math.abs(state.totalTime.toNumber() - elapsed) < 1e-7, "game clock differs from counted one-second live ticks");
  if (log.completedBuilds.length || log.completedResearch.length || log.completedUnits.length) event("tick-completions", log);
  if (researchPaymentWatch && !researchPaymentProved && state.research.queue.some(job => job.taskId === researchPaymentWatch!.taskId)) {
    proveResearchPayment(before, researchPaymentWatch);
  }
  observe();
  for (const milestone of milestones) if (milestone.subsequentLiveTickObserved === false) {
    milestone.subsequentLiveTickObserved = true;
    milestone.firstSubsequentLiveTickAt = elapsed;
  }
  const paused = state.orders.tasks.find(task => task.status === "paused");
  check(!paused, `finite order #${paused?.id} paused: ${paused?.reason}`);
}
function checkCycleLimit(): void {
  if (secondCycleStartedAt === null) check(elapsed < FIRST_CYCLE_LIMIT, `first cycle reached the strict ${FIRST_CYCLE_LIMIT}-second limit`);
  else check(elapsed - secondCycleStartedAt < SECOND_CYCLE_LIMIT, `second cycle reached the strict ${SECOND_CYCLE_LIMIT}-second offset limit`);
}
function until(label: string, ready: () => boolean, reason: () => string): void {
  const startedAt = elapsed;
  const reasonSeconds: Record<string, number> = {};
  try {
    while (!ready()) {
      checkCycleLimit();
      const why = reason();
      reasonSeconds[why] = (reasonSeconds[why] ?? 0) + 1;
      oneSecond();
    }
  } finally {
    waits.push({ stage, label, startedAt, endedAt: elapsed, waitedSeconds: elapsed - startedAt, reasonSeconds });
  }
}
function checkpoint(name: string): void {
  const savedAt = SAVE_EPOCH + elapsed * 1000;
  const before = serializeState(state);
  const encoded = exportSave(state, savedAt, savedAt);
  const restored = deserializeState(importSave(encoded).state);
  const after = serializeState(restored);
  // Compare the entire serialized state. No economic or display field is omitted.
  requireExactSave(before, after, "first strict roundtrip");
  if (JSON.stringify(before) !== JSON.stringify(after)) event("save-object-key-order-only", {
    milestone: name, allFieldsExactlyEqual: true,
    fleetKeysBefore: before.fleets.map(fleet => Object.keys(fleet)),
    fleetKeysAfter: after.fleets.map(fleet => Object.keys(fleet)),
  });
  const reencoded = exportSave(restored, savedAt, savedAt);
  const reread = deserializeState(importSave(reencoded).state);
  requireExactSave(after, serializeState(reread), "second strict roundtrip");
  state = reread; // Actual continuation uses the restored state, not the pre-save object.
  const record = { name, gameSeconds: elapsed, gameMinutes: elapsed / 60,
    actionCount: actions.length, eventCount: events.length, strictRoundtrips: 2,
    stateAdoptedFromReload: true, subsequentLiveTickObserved: false,
    snapshot: describe(), save: JSON.parse(exportSave(state, savedAt, savedAt)) };
  milestones.push(record);
  actions.push({ index: actions.length + 1, gameSeconds: elapsed, stage,
    api: "exportSave/importSave/deserializeState", request: { milestone: name, strictRoundtrips: 2 }, ok: true });
  process.stderr.write(JSON.stringify({ milestone: name, gameSeconds: elapsed, score: expansionScore(state).toString() }) + "\n");
}
function build(planetId: string, building: BuildingId, target: number): void {
  select(planetId);
  while (activePlanet(state).buildings[building] < target) {
    until(`afford ${planetId}/${building}`, () => canEnqueue(state, building).ok, () => canEnqueue(state, building).reason);
    const quote = canEnqueue(state, building);
    action("enqueue", { planetId, building, source: "manual", targetLevel: quote.targetLevel, quotedCost: money(quote.cost) },
      () => enqueue(state, building, "manual"));
    if (seenJobs.size === 1) checkpoint("01b-manual-building-paid-and-in-progress");
    if (secondCycleStartedAt !== null && !secondPaidBuildCheckpoint) {
      secondPaidBuildCheckpoint = true;
      checkpoint("13b-second-cycle-building-paid-and-in-progress");
    }
    until(`complete ${planetId}/${building}/${quote.targetLevel}`,
      () => activePlanet(state).buildings[building] >= quote.targetLevel,
      () => "waiting for the real paid build queue");
  }
}
function buildingSequence(sequence: Array<[BuildingId, number]>): void {
  for (const [building, target] of sequence) build(homeId, building, target);
}
function exactMoney(actual: OrderMoney | null, expected: OrderMoney, label: string): void {
  check(actual && RESOURCE_IDS.every(id => compareOrderAmounts(actual[id], expected[id]) === 0), `${label}: exact money mismatch`);
}
/** Narrow proof for the two isolated computer-tech payments, not a general tick auditor. */
function proveResearchPayment(before: GameState, watched: NonNullable<typeof researchPaymentWatch>): void {
  const job = state.research.queue.find(value => value.taskId === watched.taskId)!;
  check(job.source === "plan" && job.planetId === watched.planetId && job.tech === watched.tech
    && job.targetLevel === watched.targetLevel && before.activePlanetId === watched.selectedPlanetId, "research job did not retain its fixed payer/target");
  exactMoney(money(job.paid), watched.price, "actual fixed-payer research paid job");
  check(before.research.queue.length === 0 && before.fleets.length === 0 && before.boosters.length === 0
    && before.planets.every(planet => planet.buildQueue.length === 0 && planet.shipyardQueue.length === 0)
    && before.protocols.slots.every(slot => slot.card === null) && before.protocols.accumulator === 0
    && before.orders.accumulator === 9 && nextBeaconIn(before) > 1
    && state.orders.nextJobId === before.orders.nextJobId + 1
    && before.orders.tasks.filter(task => task.status === "running").every(task => task.id === watched.taskId),
  "isolated research payment proof encountered an unexpected in-tick event; no approximate payer claim made");
  const proof: Array<Record<string, unknown>> = [];
  for (const planet of before.planets) {
    const after = state.planets.find(value => value.id === planet.id)!;
    const eco = economy(selectPlanet(before, planet.id));
    const nextEco = economy(selectPlanet(state, planet.id));
    const expected: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
    for (const id of RESOURCE_IDS) {
      // The first-cycle witness still demands identical before/after net rates.
      // In the second cycle a payment can restart a previously full mine at the
      // exact end-of-tick order pass. Its physical rate/cap must remain unchanged.
      check(eco.net[id] >= 0 && (watched.zeroDeuteriumProduction ? eco.net[id] === nextEco.net[id]
        : eco.gross[id] === nextEco.gross[id] && eco.caps[id] === nextEco.caps[id]),
      "payer witness production changed during the observed payment tick");
      const produced = planet.resources[id].add(eco.net[id]);
      check(eco.net[id] === 0 || produced.lt(big(eco.caps[id]).sub(eco.caps[id] * 1e-12)),
        "payer witness would cross a storage boundary; no approximate payer claim made");
      expected[id] = produced.sub(planet.id === watched.planetId ? job.paid[id] : 0).toString();
      check(after.resources[id].toString() === expected[id], `exact research payment wallet proof differs for ${planet.id}/${id}`);
    }
    if (planet.id === watched.planetId && watched.zeroDeuteriumProduction) check(eco.net.deuterium === 0 && planet.resources.deuterium.sub(job.paid.deuterium).eq(after.resources.deuterium),
      "colony deuterium did not pay the actual research cost");
    proof.push({ planetId: planet.id, before: money(planet.resources), netPerSecond: eco.net,
      paid: planet.id === watched.planetId ? money(job.paid) : { metal: "0", crystal: "0", deuterium: "0" }, expected, actual: money(after.resources) });
  }
  researchPaymentProved = true;
  event(watched.label, { taskId: watched.taskId, jobId: job.jobId,
    tickSeconds: 1, activePlanetId: before.activePlanetId, payerId: job.planetId, exactDecimalWalletEquality: true, wallets: proof });
}
function auditFinitePayments(expectedTasks = 14, cancelledTaskId: number | null = null): void {
  check(state.orders.tasks.length === expectedTasks, `expected exactly ${expectedTasks} explicitly authorized finite tasks`);
  check(seenJobs.size === state.orders.nextJobId - 1, "an issued paid job was missed or counted twice");
  for (let id = 1; id < state.orders.nextJobId; id += 1) check(paidJobs.has(id), `missing real paid-job evidence #${id}`);
  for (const task of state.orders.tasks) {
    const owned = [...paidJobs.values()].filter(job => job.taskId === task.id);
    if (task.id === cancelledTaskId) {
      check(task.status === "cancelled" && task.activeJob === null && task.currentWork === null && owned.length === 0,
        "the uncharged retired authorization acquired a paid job or became live");
      exactMoney(task.charged, { metal: "0", crystal: "0", deuterium: "0" }, "retired authorization charge");
      exactMoney(task.refunded, { metal: "0", crystal: "0", deuterium: "0" }, "retired authorization refund");
      continue;
    }
    check(task.status === "completed" && task.activeJob === null && task.currentWork === null, `task #${task.id} is not fully settled`);
    check(owned.length > 0, `task #${task.id} has no real paid-job evidence`);
    const total: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
    for (const job of owned) for (const id of RESOURCE_IDS) {
      const sum = addOrderAmounts(total[id], job.paid[id]);
      check(sum !== null, "paid-job audit overflow");
      total[id] = sum;
    }
    const actualPaidCost = { ...total };
    let fuel = "0";
    for (const trip of task.transport?.trips ?? []) {
      check(trip.phase.kind === "returned" && trip.phase.outcome.kind === "delivered", "unsettled/undelivered audited shipment");
      const sum = addOrderAmounts(fuel, trip.fuel);
      check(sum !== null, "fuel audit overflow");
      fuel = sum;
    }
    const withFuel = addOrderAmounts(total.deuterium, fuel);
    check(withFuel !== null, "total payment audit overflow");
    total.deuterium = withFuel;
    exactMoney(task.charged, total, `task #${task.id} actual paid quotes plus actual fuel`);
    for (const id of RESOURCE_IDS) check(compareOrderAmounts(task.charged[id], task.budget[id]) !== 1
      && compareOrderAmounts(task.refunded[id], "0") === 0, `task #${task.id} exceeded its budget or recorded a refund`);
    const audit = { taskId: task.id, planetId: task.planetId, paidJobIds: owned.map(job => job.jobId),
      actualPaidCost, actualFuelDeuterium: fuel, expectedCharged: total, charged: task.charged, refunded: task.refunded, budget: task.budget };
    const previous = paymentAudits.find(value => value.taskId === task.id);
    if (previous) check(!firstDifference(previous, audit), `historical payment audit #${task.id} changed`);
    else paymentAudits.push(audit);
  }
  check(researchPaymentProved, "colony research payer wallet proof was never observed");
}
function waitTasks(ids: number[]): void {
  until(`complete finite orders ${ids.join(",")}`,
    () => ids.every(id => state.orders.tasks.find(task => task.id === id)?.status === "completed"),
    () => ids.map(id => { const task = state.orders.tasks.find(value => value.id === id); return `#${id} ${task?.status}: ${task?.reason}`; }).join("; "));
  for (const id of ids) {
    const task = state.orders.tasks.find(value => value.id === id)!;
    check(task.activeJob === null && task.currentWork === null, `completed task #${id} still owns unfinished work`);
    const goal = researchGoalsByTask.get(id);
    if (goal) check(state.research.levels[goal.tech] === goal.targetLevel,
      `research task #${id} did not reach its original intended completed level`);
  }
}
function researchTemplate(name: string, payerId: string, goals: Array<{ tech: ResearchId; targetLevel: number }>, expectedTotal: OrderMoney): number[] {
  const templateId = state.researchTemplates.nextTemplateId;
  const draft = { name, goals };
  action("createResearchTemplate", { draft, expectedNextTemplateId: templateId },
    () => createResearchTemplate(state, draft, templateId));
  const quote = quoteResearchTemplate(state, templateId, payerId);
  event("research-template-review", quote);
  check(quote.ok, quote.reason);
  check(quote.rows.length === goals.length && goals.every(goal => {
    const matches = quote.rows.filter(row => row.tech === goal.tech);
    return matches.length === 1 && matches[0]!.targetLevel === goal.targetLevel;
  }), "template review differs from the original intended research goals");
  exactMoney(quote.totalQuote, expectedTotal, name);
  const budgets = quote.rows.filter(row => row.status === "new").map(row => {
    check(row.quote, `missing quote for ${row.tech}`);
    return { tech: row.tech, budget: { ...row.quote } };
  });
  const request = { templateId, expectedTemplateRevision: quote.templateRevision, planetId: payerId,
    expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey, budgets };
  const result = action("applyResearchTemplate", request, () => applyResearchTemplate(state, request));
  researchRequestsByTemplate.set(templateId, request);
  check(result.createdTaskIds.length === goals.length, "template did not authorize exactly the requested finite goals");
  const rows = quote.rows.filter(row => row.status === "new");
  result.createdTaskIds.forEach((id, index) => {
    const task = state.orders.tasks.find(value => value.id === id), row = rows[index]!;
    check(task?.kind === "research" && task.tech === row.tech && task.targetLevel === row.targetLevel
      && task.planetId === payerId, `template task #${id} differs from its reviewed identity/target/payer`);
    const goal = goals.find(value => value.tech === task.tech);
    check(goal && goal.targetLevel === task.targetLevel, `template task #${id} differs from its original intended goal`);
    researchGoalsByTask.set(id, { ...goal });
    exactMoney(task.budget, budgets[index]!.budget, `template task #${id} budget`);
  });
  return result.createdTaskIds;
}
function nearestEmpty(): Coordinates {
  const home = state.planets.find(planet => planet.id === homeId)!;
  const candidates = Array.from({ length: 15 }, (_, index) => ({ ...home.coordinates, position: index + 1 }))
    .filter(coordinates => !state.planets.some(planet => sameCoordinates(planet.coordinates, coordinates)) && !npcAt(state, coordinates))
    .sort((a, b) => distance(home.coordinates, a) - distance(home.coordinates, b) || a.position - b.position);
  check(candidates[0], "no unoccupied slot in the home system");
  return candidates[0];
}
function createFinite(request: CreateOrderRequest): number {
  const id = state.orders.nextTaskId;
  check(request.expectedNextTaskId === id, "finite authorization became stale");
  action("createOrderTask", request, () => createOrderTask(state, request));
  return id;
}
function finiteBuilding(planetId: string, building: BuildingId, targetLevel: number): number {
  const local = selectPlanet(state, planetId);
  const budget: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
  for (let level = activePlanet(local).buildings[building] + 1; level <= targetLevel; level += 1) {
    const price = quoteOrderMoney(costFor(local, building, level));
    check(price, "building quote is not exactly representable");
    for (const id of RESOURCE_IDS) {
      const sum = addOrderAmounts(budget[id], price[id]);
      check(sum !== null, "building budget overflow");
      budget[id] = sum;
    }
  }
  const request: CreateOrderRequest = { kind: "building", planetId, building, targetLevel, budget,
    expectedNextTaskId: state.orders.nextTaskId, transport: null };
  return createFinite(request);
}
function rejected<T extends { state: GameState; ok: boolean; reason: string }>(api: string, request: unknown, run: () => T): void {
  const before = serializeState(state);
  const result = run();
  check(!result.ok && !firstDifference(before, serializeState(result.state)) && !firstDifference(before, serializeState(state)),
    `${api} accepted or mutated state for a retired/stale authorization`);
  state = result.state;
  actions.push({ index: actions.length + 1, gameSeconds: elapsed, stage, api, request,
    ok: false, expectedRejection: true, reason: result.reason, entireStateUnchanged: true });
  observe();
}
function proveImmediateDebit(before: Record<string, OrderMoney>, payerId: string, paid: OrderMoney, label: string, subsequentDebit?: OrderMoney): void {
  const after = wallets();
  check(!firstDifference(Object.keys(before).sort(), Object.keys(after).sort()), `${label}: wallets appeared or disappeared during payment`);
  for (const [planetId, wallet] of Object.entries(before)) for (const id of RESOURCE_IDS) {
    let expected = big(wallet[id]);
    if (planetId === payerId) {
      expected = expected.sub(paid[id]);
      if (subsequentDebit) expected = expected.sub(subsequentDebit[id]);
    }
    check(after[planetId]![id] === expected.toString(), `${label}: exact immediate debit differs for ${planetId}/${id}`);
  }
  event("exact-immediate-payment-proof", { label, payerId, paid, subsequentDebit: subsequentDebit ?? null, before, after });
}

let outcome: Record<string, unknown>;
try {
  check(state.planets.length === 1 && state.totalTime.eq(0) && state.lifetime.metal.eq(0)
    && activePlanet(state).resources.metal.eq(500) && activePlanet(state).resources.crystal.eq(500)
    && activePlanet(state).resources.deuterium.eq(0), "factory start differs from 500M/500C/0D");
  checkpoint("01-true-new-game");
  stage = "natural-economic-bootstrap";
  buildingSequence([
    ["solar_plant", 1], ["metal_mine", 2], ["crystal_mine", 1], ["solar_plant", 2],
    ["metal_mine", 3], ["crystal_mine", 2], ["solar_plant", 3], ["metal_mine", 4],
    ["deuterium_synth", 1], ["solar_plant", 4],
  ]);
  checkpoint("02-natural-early-economy");
  buildingSequence([
    ["metal_mine", 5], ["crystal_mine", 3], ["solar_plant", 5], ["deuterium_synth", 2],
    ["metal_mine", 6], ["crystal_mine", 4], ["solar_plant", 6], ["robotics_factory", 1],
    ["metal_mine", 7], ["crystal_mine", 5], ["solar_plant", 7], ["deuterium_synth", 3],
    ["robotics_factory", 2], ["metal_mine", 8], ["crystal_mine", 6], ["solar_plant", 8],
    ["metal_storage", 2], ["crystal_storage", 3], ["deuterium_tank", 3],
    ["solar_plant", 9], ["metal_mine", 9], ["crystal_mine", 7], ["deuterium_synth", 4],
    ["solar_plant", 10], ["metal_mine", 10], ["crystal_mine", 8], ["deuterium_synth", 5],
    ["solar_plant", 11], ["metal_mine", 11], ["crystal_mine", 9], ["deuterium_synth", 6],
    ["solar_plant", 12], ["metal_mine", 12], ["crystal_mine", 10], ["deuterium_synth", 7],
    ["solar_plant", 14], ["research_lab", 3], ["shipyard", 4],
  ]);
  checkpoint("03-natural-homeworld-infrastructure");

  stage = "finite-homeworld-research-template";
  const homeResearch = researchTemplate("首轮真实殖民准备", homeId, [
    { tech: "energy_tech", targetLevel: 1 }, { tech: "combustion_drive", targetLevel: 2 },
    { tech: "impulse_drive", targetLevel: 3 }, { tech: "espionage_tech", targetLevel: 4 },
    { tech: "astrophysics", targetLevel: 1 }, { tech: "computer_tech", targetLevel: 1 },
  ], { metal: "22200", crystal: "52200", deuterium: "14000" });
  checkpoint("04-home-research-explicitly-authorized");
  until("observe actual paid home research", () => state.research.queue.some(job => job.taskId !== null && homeResearch.includes(job.taskId)),
    () => "waiting for a real template-owned research payment");
  checkpoint("04b-home-template-research-paid-and-in-progress");
  waitTasks(homeResearch);
  checkpoint("05-home-research-naturally-paid-and-completed");

  stage = "one-time-mixed-formation";
  const formationId = state.formations.nextFormationId;
  const formation = { expectedNextFormationId: formationId, name: "首轮母星运输护航编队", ships: { small_cargo: 2, light_fighter: 1 } };
  action("createFormation", formation, () => createFormation(state, formation));
  const preview = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: homeId });
  event("formation-deficit-review", preview);
  check(preview.ok && preview.request, preview.reason);
  exactMoney(preview.request.totalBudget, { metal: "7000", crystal: "5000", deuterium: "0" }, "mixed formation");
  const replenishment = preview.request;
  const formed = action("createFormationReplenishment", replenishment, () => createFormationReplenishment(state, replenishment));
  check(formed.createdTaskIds.length === replenishment.lines.length, "formation did not create exactly its reviewed lines");
  formed.createdTaskIds.forEach((id, index) => {
    const task = state.orders.tasks.find(value => value.id === id), line = replenishment.lines[index]!;
    check(task?.kind === "shipyard" && task.unit === line.unit && task.quantity === line.quantity && task.planetId === homeId,
      `formation task #${id} differs from the reviewed finite unit/quantity/payer`);
    exactMoney(task.budget, line.budget, `formation task #${id} budget`);
    check(task.formationOrigin && !firstDifference(task.formationOrigin.formation,
      state.formations.entries.find(value => value.id === formationId)), `formation task #${id} lost its immutable design origin`);
    exactMoney(task.formationOrigin.quotedUnitCost, line.quotedUnitCost, `formation task #${id} original quote`);
  });
  waitTasks(formed.createdTaskIds);
  const manufactured = state.planets.find(planet => planet.id === homeId)!;
  check(manufactured.units.small_cargo === 2 && manufactured.units.light_fighter === 1
    && manufactured.shipyardQueue.every(job => job.unit !== "small_cargo" && job.unit !== "light_fighter"),
  "formation coverage was not actual completed local inventory");
  const covered = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: homeId });
  check(covered.ok && covered.request === null, "finished formation still asks for replenishment");
  event("formation-covered-without-new-authorization", covered);
  checkpoint("06-named-mixed-formation-completed");

  stage = "real-colony-ship-and-dispatch";
  select(homeId);
  until("afford actual colony ship", () => canBuildUnits(state, "colony_ship", 1).ok,
    () => canBuildUnits(state, "colony_ship", 1).reason);
  action("orderUnits", { planetId: homeId, unit: "colony_ship", count: 1, source: "manual",
    quotedCost: money(canBuildUnits(state, "colony_ship", 1).cost) }, () => orderUnits(state, "colony_ship", 1, "manual"));
  checkpoint("06b-manual-colony-ship-paid-and-in-progress");
  until("complete actual colony ship", () => activePlanet(state).units.colony_ship === 1, () => "waiting for the real shipyard");
  const target = nearestEmpty();
  const colonization: FleetRequest = { mission: "colonize", target, ships: { colony_ship: 1 },
    cargo: { metal: big(1500), crystal: big(1500), deuterium: big(2500) }, speedPercent: 100 };
  until("afford colony cargo and quoted return fuel", () => quoteFlight(state, colonization).ok, () => quoteFlight(state, colonization).reason);
  event("colonization-flight-review", { request: colonization, quote: quoteFlight(state, colonization) });
  const departure = action("sendFleet", colonization, () => sendFleet(state, colonization));
  checkpoint("07-real-colonization-in-flight");
  until("arrive and establish colony", () => state.planets.length === 2, () => "waiting for dispatched colony ship arrival");
  const colony = state.planets.find(planet => planet.id !== homeId)!;
  check(colony.id === `colony-${departure.fleetId}` && sameCoordinates(colony.coordinates, target), "wrong colony identity");
  check(state.planets.find(planet => planet.id === homeId)!.units.colony_ship === 0, "colonization did not consume the real ship");
  checkpoint("08-colony-established-by-fleet-arrival");

  stage = "two-planet-finite-division-of-labor";
  const colonyBuilds = [finiteBuilding(colony.id, "metal_mine", 3), finiteBuilding(colony.id, "crystal_mine", 2),
    finiteBuilding(colony.id, "solar_plant", 3), finiteBuilding(colony.id, "research_lab", 1)];
  waitTasks(colonyBuilds);
  const colonyResearch = researchTemplate("首轮殖民地科研职责", colony.id,
    [{ tech: "computer_tech", targetLevel: 2 }], { metal: "0", crystal: "800", deuterium: "1200" });
  // Keep the other planet selected throughout payment: payer is the authorization.
  select(homeId);
  researchPaymentWatch = { taskId: colonyResearch[0]!, planetId: colony.id, tech: "computer_tech", targetLevel: 2,
    selectedPlanetId: homeId, price: { metal: "0", crystal: "800", deuterium: "1200" },
    label: "isolated-colony-research-payment-proof", zeroDeuteriumProduction: true };
  until("observe colony research paid job and exact wallet debit", () => researchPaymentProved,
    () => "waiting for the fixed-colony research payment while the homeworld remains selected");
  checkpoint("08b-colony-research-paid-job-and-wallet-proof");
  waitTasks(colonyResearch);
  check(state.orders.tasks.find(task => task.id === colonyResearch[0])?.planetId === colony.id,
    "colony research payer followed UI selection");
  checkpoint("09-home-manufacturing-colony-research");

  stage = "single-source-finite-logistics";
  const shipping: FleetRequest = { mission: "transport", target: colony.coordinates,
    ships: { small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 };
  until("quote homeworld logistics fuel", () => quoteFlight(state, shipping).ok, () => quoteFlight(state, shipping).reason);
  const shippingQuote = quoteFlight(state, shipping);
  event("single-source-fuel-review", { request: shipping, quote: shippingQuote });
  // Template application cannot attach transport. A separate, explicitly funded
  // finite lab expansion proves the real single-source coordinator without edits.
  // The colony has no deuterium production: lab 1→3 after computer 2 needs supply.
  const transportBudget = { metal: "1200", crystal: "2400", deuterium: big(1200).add(shippingQuote.fuel.mul(2)).toString() };
  const logisticsRequest: CreateOrderRequest = { kind: "building", planetId: colony.id,
    building: "research_lab", targetLevel: 3, expectedNextTaskId: state.orders.nextTaskId,
    budget: transportBudget, transport: { donorPlanetId: homeId, ship: "small_cargo", count: 2,
      speedPercent: 100, maxTrips: 2, grossCargoCap: { metal: "1200", crystal: "2400", deuterium: "1200" } } };
  const logisticsId = createFinite(logisticsRequest);
  checkpoint("10-single-source-logistics-authorized");
  until("observe owned outbound shipment", () => state.fleets.some(fleet => fleet.orderTransport?.taskId === logisticsId && !fleet.returning),
    () => "waiting for real single-source dispatch");
  checkpoint("10a-logistics-outbound-with-pending-work");
  until("observe owned returning shipment", () => state.fleets.some(fleet => fleet.orderTransport?.taskId === logisticsId && fleet.returning),
    () => "waiting for real delivery and return transition");
  checkpoint("10b-logistics-returning-with-pending-work");
  until("observe logistics-owned paid construction", () => {
    const task = state.orders.tasks.find(value => value.id === logisticsId)!;
    return task.currentWork?.stage === "paid" && task.activeJob !== null
      && state.planets.some(planet => planet.buildQueue.some(job => job.taskId === logisticsId && job.jobId === task.activeJob!.jobId));
  }, () => "waiting for actual cargo-backed construction payment");
  checkpoint("10c-logistics-paid-work-and-active-job");
  waitTasks([logisticsId]);
  until("return all authorized logistics ships", () => !state.fleets.some(fleet => fleet.orderTransport?.taskId === logisticsId),
    () => "waiting for actual transport return and docking");
  const logistics = state.orders.tasks.find(task => task.id === logisticsId)!;
  check(logistics.transport && logistics.transport.trips.length > 0, "lab expansion never exercised a real logistics trip");
  check(logistics.transport.trips.every(trip => trip.phase.kind === "returned" && trip.phase.outcome.kind === "delivered"),
    "a logistics trip failed delivery or return");
  check(state.planets.find(planet => planet.id === homeId)!.units.small_cargo === 2, "logistics ships did not return to fixed donor");
  check(state.planets.find(planet => planet.id === colony.id)!.buildings.research_lab === 3, "finite supplied lab target not complete");
  auditFinitePayments();
  checkpoint("11-first-slice-complete-and-reloaded");
  const firstSliceGameSeconds = elapsed;

  stage = "first-curvature-preview-and-authority-retirement";
  until("reach actual first curvature threshold", () => evaluatePrestige(state).gain.gte(1),
    () => "waiting for naturally accumulated lifetime production, without spending or granting score");
  const completedHistory = structuredClone(state.orders.tasks);
  const oldResearchRequest = researchRequestsByTemplate.get(2);
  check(oldResearchRequest && oldResearchRequest.planetId === colony.id, "missing original colony template authorization");
  const retireBudget = quoteOrderMoney(costFor(selectPlanet(state, colony.id), "metal_mine", 4));
  check(retireBudget, "retirement demonstration has no exact real building quote");
  const retireRequest: CreateOrderRequest = { kind: "building", planetId: colony.id, building: "metal_mine", targetLevel: 4,
    budget: retireBudget, expectedNextTaskId: state.orders.nextTaskId, transport: null };
  const unchargedWallets = wallets(), unchargedJobId = state.orders.nextJobId, unchargedAt = elapsed;
  const retiredTaskId = createFinite(retireRequest);
  action("pauseOrderTask", { taskId: retiredTaskId }, () => pauseOrderTask(state, retiredTaskId));
  const pausedAuthorization = structuredClone(state.orders.tasks.find(task => task.id === retiredTaskId)!);
  check(pausedAuthorization.status === "paused" && pausedAuthorization.activeJob === null && pausedAuthorization.currentWork === null
    && state.orders.nextJobId === unchargedJobId && elapsed === unchargedAt && !firstDifference(unchargedWallets, wallets()),
  "retirement demonstration paid, ticked, or changed wallets before pause");
  exactMoney(pausedAuthorization.charged, { metal: "0", crystal: "0", deuterium: "0" }, "paused authorization charge");
  exactMoney(pausedAuthorization.refunded, { metal: "0", crystal: "0", deuterium: "0" }, "paused authorization refund");
  // This valid, never-applied pre-reset review has the still-current next task ID.
  // Its old payer must be rejected even though the ID counter survives the reset.
  const oldColonyFormation = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: colony.id });
  check(oldColonyFormation.ok && oldColonyFormation.request, "could not prepare genuine pre-reset formation review");
  checkpoint("12-paused-unpaid-colony-authorization-before-curvature");
  const beforeCurvature = state, beforeCurvatureSave = serializeState(state);
  const evaluation = evaluatePrestige(state);
  const evaluatedSave = serializeState(evaluation.next);
  const resetPreview = prestigePreview(state, evaluation);
  const repeatPreview = prestigePreview(state, evaluatePrestige(state));
  check(!firstDifference(beforeCurvatureSave, serializeState(state)) && !firstDifference(evaluatedSave, serializeState(evaluation.next))
    && !firstDifference(resetPreview, repeatPreview), "curvature evaluation/preview mutated input or produced a different repeated projection");
  const expectedGain = bigFloor(bigSqrt(expansionScore(state).div(PRESTIGE_SCORE_UNIT)));
  check(resetPreview.eligible && evaluation.gain.eq(expectedGain) && expectedGain.eq(1)
    && resetPreview.gain === expectedGain.toString(), "curvature payout disagrees with the production score/divisor rule");
  check(resetPreview.orders.stopped === 1 && resetPreview.orders.returnedTrips === 2 && resetPreview.orders.retiredTrips === 0
    && resetPreview.orders.releasedWork === 0 && resetPreview.paid.buildings === 0 && resetPreview.paid.research === 0
    && resetPreview.paid.shipyard === 0 && resetPreview.fleets.count === 0, "preview misreported paused authority or completed logistics history");
  exactMoney(resetPreview.newHome, { metal: "500", crystal: "500", deuterium: "0" }, "preview new home");
  event("curvature-pure-preview-and-rule-proof", { score: expansionScore(state).toString(), divisor: PRESTIGE_SCORE_UNIT,
    rule: "floor(sqrt(actual expansionScore / production PRESTIGE_SCORE_UNIT))", expectedGain: expectedGain.toString(),
    pausedTaskId: retiredTaskId, preview: resetPreview, repeatedPreviewIdentical: true, entireInputUnchanged: true });
  action("prestige", { reviewedGain: resetPreview.gain, stoppedTaskId: retiredTaskId },
    () => ({ state: prestige(state), ok: true, reason: "explicit first-curvature authorization using the production reset API" }));
  check(!firstDifference(evaluatedSave, serializeState(state)), "actual curvature result differs from the entire evaluated candidate");
  check(!firstDifference(beforeCurvatureSave, serializeState(beforeCurvature)), "actual curvature mutated its previous world");
  check(state.totalTime.eq(beforeCurvature.totalTime) && state.totalTime.eq(elapsed) && state.stats.launches === 1
    && state.warpCores.eq(beforeCurvature.warpCores.add(expectedGain)), "curvature changed elapsed time or paid the wrong core balance");
  check(state.orders.nextTaskId === beforeCurvature.orders.nextTaskId && state.orders.nextJobId === beforeCurvature.orders.nextJobId
    && state.orders.nextWorkId === beforeCurvature.orders.nextWorkId && state.nextFleetId === beforeCurvature.nextFleetId,
  "curvature reset a monotonic authorization/job/work/fleet counter");
  check(state.planets.length === 1 && activePlanet(state).id === homeId
    && Object.values(activePlanet(state).buildings).every(level => level === 0)
    && Object.values(activePlanet(state).units).every(count => count === 0)
    && activePlanet(state).buildQueue.length === 0 && activePlanet(state).shipyardQueue.length === 0
    && state.research.queue.length === 0 && state.fleets.length === 0
    && RESOURCE_IDS.every(id => state.lifetime[id].eq(0)), "curvature carried old assets, queues, fleets, or run score into the new world");
  exactMoney(money(activePlanet(state).resources), { metal: "500", crystal: "500", deuterium: "0" }, "actual reset home");
  check(!firstDifference(beforeCurvature.research.levels, state.research.levels)
    && !firstDifference(beforeCurvature.formations, state.formations)
    && !firstDifference(beforeCurvature.researchTemplates, state.researchTemplates), "curvature changed retained research/design/template intent");
  for (const task of completedHistory) check(!firstDifference(task, state.orders.tasks.find(value => value.id === task.id)),
    `completed task/trip history #${task.id} was reset or refunded`);
  const retired = state.orders.tasks.find(task => task.id === retiredTaskId)!;
  check(retired.status === "cancelled" && !firstDifference({ ...pausedAuthorization, status: "cancelled", reason: retired.reason }, retired),
    "curvature changed retired task identity, payer, original budget, charged, refunded, or completed-work history");
  historicalTasks = structuredClone(state.orders.tasks);
  historicalFleetIds = historicalTasks.flatMap(task => task.transport?.trips.map(trip => trip.fleetId) ?? []);
  secondCycleStartedAt = elapsed;
  const oldPayerMapping = mapResearchTemplate(state, 2, colony.id);
  const oldPayerFormation = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: colony.id });
  check(!oldPayerMapping.ok && !oldPayerFormation.ok && oldPayerFormation.request === null, "old colony ID remained a valid template/formation payer");
  event("removed-payer-mappings-rejected", { oldColonyId: colony.id, research: oldPayerMapping, formation: oldPayerFormation });
  rejected("resumeOrderTask", { taskId: retiredTaskId }, () => resumeOrderTask(state, retiredTaskId));
  rejected("createOrderTask", retireRequest, () => createOrderTask(state, retireRequest));
  rejected("applyResearchTemplate", oldResearchRequest, () => applyResearchTemplate(state, oldResearchRequest));
  rejected("createFormationReplenishment", oldColonyFormation.request,
    () => createFormationReplenishment(state, oldColonyFormation.request!));
  checkpoint("13-actual-curvature-reset-retired-authority-and-reload");

  stage = "second-cycle-explicit-template-revision";
  const preservedTemplate = state.researchTemplates.templates.find(template => template.id === 2)!;
  check(preservedTemplate && preservedTemplate.revision === 1 && preservedTemplate.goals.length === 1
    && preservedTemplate.goals[0]!.tech === "computer_tech" && preservedTemplate.goals[0]!.targetLevel === 2,
  "the original colony research intent was not preserved");
  const revisedDraft = { name: "第二轮母星科研职责", goals: [{ tech: "computer_tech" as const, targetLevel: 3 }] };
  const beforeEdit = serializeState(state);
  action("editResearchTemplate", { templateId: 2, expectedTemplateRevision: preservedTemplate.revision, draft: revisedDraft },
    () => editResearchTemplate(state, 2, preservedTemplate.revision, revisedDraft));
  const afterEdit = serializeState(state);
  check(!firstDifference({ ...beforeEdit, researchTemplates: afterEdit.researchTemplates }, afterEdit),
    "editing preserved research intent changed orders, wallets, queues, or another game subsystem");
  check(state.researchTemplates.templates.length === 2 && state.researchTemplates.nextTemplateId === beforeCurvature.researchTemplates.nextTemplateId
    && state.researchTemplates.templates.find(template => template.id === 2)?.revision === preservedTemplate.revision + 1
    && !firstDifference(beforeCurvature.researchTemplates.templates.find(template => template.id === 1),
      state.researchTemplates.templates.find(template => template.id === 1)), "research edit replaced identities or changed an unrelated template");
  event("preserved-template-explicit-edit-proof", { templateId: 2, oldRevision: preservedTemplate.revision,
    newRevision: preservedTemplate.revision + 1, oldGoal: preservedTemplate.goals, newGoal: revisedDraft.goals,
    allNonTemplateStateUnchanged: true });

  stage = "second-cycle-natural-homeworld-rebuild";
  buildingSequence([
    ["solar_plant", 1], ["metal_mine", 2], ["crystal_mine", 1], ["solar_plant", 2],
    ["metal_mine", 3], ["crystal_mine", 2], ["solar_plant", 3], ["metal_mine", 4],
    ["deuterium_synth", 1], ["solar_plant", 4], ["metal_mine", 5], ["crystal_mine", 3],
    ["solar_plant", 5], ["deuterium_synth", 2], ["metal_mine", 6], ["crystal_mine", 4],
    ["solar_plant", 6], ["robotics_factory", 1], ["metal_mine", 7], ["crystal_mine", 5],
    ["solar_plant", 7], ["deuterium_synth", 3], ["robotics_factory", 2], ["metal_mine", 8],
    ["crystal_mine", 6], ["solar_plant", 8], ["metal_storage", 1], ["crystal_storage", 1],
    ["deuterium_tank", 1], ["solar_plant", 9], ["metal_mine", 9], ["crystal_mine", 7],
    ["deuterium_synth", 4], ["solar_plant", 10], ["metal_mine", 10], ["crystal_mine", 8],
    ["deuterium_synth", 5], ["solar_plant", 11], ["research_lab", 1], ["shipyard", 4],
  ]);
  check(state.planets.length === 1 && activePlanet(state).buildings.shipyard === 4,
    "second-cycle colony ship infrastructure was not built on the sole real homeworld");
  checkpoint("14-second-cycle-home-lab-and-temporary-colony-ship-yard");
  until("afford second-cycle real colony ship", () => canBuildUnits(state, "colony_ship", 1).ok,
    () => canBuildUnits(state, "colony_ship", 1).reason);
  const secondShipPrice = money(canBuildUnits(state, "colony_ship", 1).cost), beforeShipWallets = wallets();
  const secondColonyShip = action("orderUnits", { planetId: homeId, unit: "colony_ship", count: 1, source: "manual", quotedCost: secondShipPrice },
    () => orderUnits(state, "colony_ship", 1, "manual"));
  proveImmediateDebit(beforeShipWallets, homeId, secondShipPrice, "new second-cycle colony ship");
  check(secondColonyShip.jobId !== undefined && secondColonyShip.jobId >= beforeCurvature.orders.nextJobId,
    "the new colony ship reused an old paid-job identity");
  checkpoint("14b-second-colony-ship-paid-and-in-progress");
  until("finish second-cycle colony ship", () => activePlanet(state).units.colony_ship === 1,
    () => "waiting for naturally paid, newly issued colony ship manufacture");
  const secondTarget = nearestEmpty();
  const secondColonization: FleetRequest = { mission: "colonize", target: secondTarget, ships: { colony_ship: 1 },
    cargo: { metal: big(1500), crystal: big(1500), deuterium: big(2500) }, speedPercent: 100 };
  until("afford second colony cargo and actual fuel", () => quoteFlight(state, secondColonization).ok,
    () => quoteFlight(state, secondColonization).reason);
  const secondFlightQuote = quoteFlight(state, secondColonization), beforeFlightWallets = wallets();
  event("second-colonization-flight-review", { request: secondColonization, quote: secondFlightQuote });
  const secondDeparture = action("sendFleet", secondColonization, () => sendFleet(state, secondColonization));
  proveImmediateDebit(beforeFlightWallets, homeId, { metal: "1500", crystal: "1500", deuterium: "2500" },
    "new colony cargo and actual launch fuel", { metal: "0", crystal: "0", deuterium: secondFlightQuote.fuel.toString() });
  check(secondDeparture.fleetId === beforeCurvature.nextFleetId && secondDeparture.fleetId !== departure.fleetId,
    "second colonization did not use the retained monotonic fleet identity");
  checkpoint("15-second-colonization-paid-and-in-flight");
  until("arrive and establish newly identified colony", () => state.planets.length === 2,
    () => "waiting for the real second-cycle colony ship to arrive");
  const secondColony = state.planets.find(planet => planet.id !== homeId)!;
  check(secondColony.id === `colony-${secondDeparture.fleetId}` && secondColony.id !== colony.id
    && sameCoordinates(secondColony.coordinates, secondTarget) && state.fleets.length === 0
    && state.planets.find(planet => planet.id === homeId)!.units.colony_ship === 0
    && Object.values(secondColony.units).every(count => count === 0), "second colony was not established by consumption of its newly built, dispatched ship");
  check(secondColony.resources.deuterium.eq(2500) && secondColony.resources.metal.gte(1500)
    && secondColony.resources.crystal.gte(1500), "second colony did not receive its real dispatch cargo");
  checkpoint("16-second-colony-established-with-new-identity");

  stage = "second-cycle-remapped-mother-research";
  const remapBefore = serializeState(state);
  const remapped = quoteResearchTemplate(state, 2, homeId);
  check(!firstDifference(remapBefore, serializeState(state)), "fresh template quote mutated the rebuilt world");
  check(remapped.ok && remapped.templateRevision === 2 && remapped.rows.length === 1
    && remapped.rows[0]!.status === "new" && remapped.rows[0]!.tech === "computer_tech"
    && remapped.rows[0]!.targetLevel === 3 && remapped.rows[0]!.currentLevel === 2, "remapped template quote lost its explicit new goal/payer");
  exactMoney(remapped.totalQuote, { metal: "0", crystal: "1600", deuterium: "2400" }, "new mother computer-3 quote");
  const remappedRequest: ResearchTemplateApplyRequest = { templateId: 2, expectedTemplateRevision: remapped.templateRevision,
    planetId: homeId, expectedNextTaskId: remapped.nextTaskId, expectedReviewKey: remapped.reviewKey,
    budgets: [{ tech: "computer_tech", budget: { metal: "0", crystal: "1600", deuterium: "2400" } }] };
  event("second-cycle-template-remap-review", remapped);
  const remappedWallets = wallets(), remappedNextJobId = state.orders.nextJobId;
  const remappedResult = action("applyResearchTemplate", remappedRequest, () => applyResearchTemplate(state, remappedRequest));
  check(remappedResult.createdTaskIds.length === 1 && !firstDifference(remappedWallets, wallets())
    && state.orders.nextJobId === remappedNextJobId, "template authorization itself paid or created extra jobs");
  const motherResearchId = remappedResult.createdTaskIds[0]!, motherResearchTask = state.orders.tasks.find(task => task.id === motherResearchId)!;
  check(motherResearchTask.kind === "research" && motherResearchTask.planetId === homeId
    && motherResearchTask.tech === "computer_tech" && motherResearchTask.targetLevel === 3 && motherResearchTask.transport === null,
  "new research authorization did not fix the mother as sole payer and executor");
  exactMoney(motherResearchTask.budget, remappedRequest.budgets[0]!.budget, "new mother research budget");
  researchGoalsByTask.set(motherResearchId, { tech: "computer_tech", targetLevel: 3 });
  // The colony is selected while the mother pays. No other live work can debit.
  select(secondColony.id);
  researchPaymentProved = false;
  researchPaymentWatch = { taskId: motherResearchId, planetId: homeId, selectedPlanetId: secondColony.id,
    tech: "computer_tech", targetLevel: 3, price: { metal: "0", crystal: "1600", deuterium: "2400" },
    label: "isolated-second-cycle-mother-research-payment-proof", zeroDeuteriumProduction: false };
  until("observe mother payment while colony is selected", () => researchPaymentProved,
    () => "waiting for newly remapped mother-funded computer-3 payment");
  checkpoint("17-remapped-mother-research-paid-and-in-progress");
  waitTasks([motherResearchId]);

  stage = "second-cycle-finite-colony-manufacturing";
  const secondColonyBuilds = [finiteBuilding(secondColony.id, "metal_mine", 3), finiteBuilding(secondColony.id, "crystal_mine", 2),
    finiteBuilding(secondColony.id, "solar_plant", 3), finiteBuilding(secondColony.id, "robotics_factory", 2),
    finiteBuilding(secondColony.id, "shipyard", 2)];
  waitTasks(secondColonyBuilds);
  const secondFormation = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: secondColony.id });
  check(secondFormation.ok && secondFormation.request && secondFormation.rows.length === 2
    && secondFormation.rows.every(row => row.localStock === 0 && row.paidQueueRemaining === 0)
    && secondFormation.rows.find(row => row.unit === "small_cargo")?.deficit === 2
    && secondFormation.rows.find(row => row.unit === "light_fighter")?.deficit === 1,
  "preserved formation did not quote the actual new-colony inventory deficit");
  exactMoney(secondFormation.request.totalBudget, { metal: "7000", crystal: "5000", deuterium: "0" }, "new colony formation budget");
  event("second-cycle-preserved-formation-fresh-deficit-review", secondFormation);
  const secondFormationRequest = secondFormation.request, formationWallets = wallets(), formationNextJobId = state.orders.nextJobId;
  const secondFormed = action("createFormationReplenishment", secondFormationRequest,
    () => createFormationReplenishment(state, secondFormationRequest));
  check(secondFormed.createdTaskIds.length === 2 && !firstDifference(formationWallets, wallets())
    && state.orders.nextJobId === formationNextJobId, "fresh formation authorization itself paid or created extra jobs");
  secondFormed.createdTaskIds.forEach((id, index) => {
    const task = state.orders.tasks.find(value => value.id === id)!, line = secondFormationRequest.lines[index]!;
    check(task.kind === "shipyard" && task.planetId === secondColony.id && task.unit === line.unit
      && task.quantity === line.quantity && task.transport === null && task.formationOrigin
      && !firstDifference(task.formationOrigin.formation, beforeCurvature.formations.entries.find(value => value.id === formationId)),
    `new colony formation task #${id} lost its fixed payer, quantity, or retained design origin`);
    exactMoney(task.budget, line.budget, `new formation task #${id} budget`);
    exactMoney(task.formationOrigin.quotedUnitCost, line.quotedUnitCost, `new formation task #${id} unit quote`);
  });
  // Selection remains a UI choice; the new colony alone accrues and pays locally.
  select(homeId);
  until("observe new-colony paid formation job", () => state.planets.find(planet => planet.id === secondColony.id)!.shipyardQueue
    .some(job => job.taskId !== null && secondFormed.createdTaskIds.includes(job.taskId)),
  () => "waiting for natural colony production within the newly approved finite budget; no resupply or top-up");
  checkpoint("18-new-colony-formation-paid-and-in-progress");
  waitTasks(secondFormed.createdTaskIds);
  const finalMother = state.planets.find(planet => planet.id === homeId)!, finalColony = state.planets.find(planet => planet.id === secondColony.id)!;
  check(state.research.levels.computer_tech === 3 && finalMother.buildings.research_lab === 1
    && finalMother.units.small_cargo === 0 && finalMother.units.light_fighter === 0 && finalMother.units.colony_ship === 0
    && finalColony.buildings.metal_mine === 3 && finalColony.buildings.crystal_mine === 2 && finalColony.buildings.solar_plant === 3
    && finalColony.buildings.robotics_factory === 2 && finalColony.buildings.shipyard === 2 && finalColony.buildings.research_lab === 0
    && finalColony.units.small_cargo === 2 && finalColony.units.light_fighter === 1 && finalColony.units.colony_ship === 0
    && state.planets.every(planet => planet.buildQueue.length === 0 && planet.shipyardQueue.length === 0)
    && state.research.queue.length === 0 && state.fleets.length === 0, "second-cycle role swap was not actually completed in local inventories and empty queues");
  const secondCovered = previewFormationReplenishment(state, { formationId, formationRevision: 1, planetId: secondColony.id });
  check(secondCovered.ok && secondCovered.request === null, "new-colony completed formation still has an actual deficit");
  check(!state.planets.some(planet => planet.id === colony.id)
    && state.orders.tasks.filter(task => task.id > retiredTaskId).every(task => task.transport === null),
  "old colony identity or logistics authorization was reused in the rebuilt world");
  auditFinitePayments(23, retiredTaskId);
  observe();
  event("second-cycle-completed-role-swap", { mother: { planetId: homeId, taskId: motherResearchId, computerTech: 3 },
    manufacturing: { planetId: secondColony.id, taskIds: secondFormed.createdTaskIds, actualUnits: finalColony.units },
    oldColonyId: colony.id, oldTaskHistoryUnchanged: true, oldReturnedTripsUnchanged: historicalFleetIds,
    naturalLocalManufacturingWithoutResupply: true, covered: secondCovered });
  checkpoint("19-second-cycle-role-swap-complete-and-reloaded");
  outcome = { status: "passed", completedScope: "natural first-cycle economy, research template, mixed formation, colonization, two-planet roles, finite single-source logistics, exact curvature preview/reset, retired authorization, natural second-cycle rebuild and newly funded role swap, whole-state save/reload continuation",
    firstSliceGameSeconds, firstCycleGameSeconds: secondCycleStartedAt, firstCycleGameMinutes: secondCycleStartedAt / 60,
    secondCycleGameSeconds: elapsed - secondCycleStartedAt, secondCycleGameMinutes: (elapsed - secondCycleStartedAt) / 60,
    totalGameSeconds: elapsed, curvatureGain: expectedGain.toString(), retiredTaskId,
    firstColonyId: colony.id, secondColonyId: secondColony.id, paidJobIdentities: seenJobs.size,
    settledFiniteOrders: state.orders.tasks.filter(task => task.status === "completed").length,
    cancelledUnpaidOrders: state.orders.tasks.filter(task => task.status === "cancelled").length };
} catch (error) {
  process.exitCode = 1;
  outcome = { status: "blocked", stage, gameSeconds: elapsed,
    reason: error instanceof Error ? error.message : String(error),
    unexpectedError: !(error instanceof JourneyBlocked), saveDifference, current: describe(),
    lastPassedMilestone: milestones.at(-1)?.name ?? null };
  process.stderr.write(JSON.stringify({ status: "blocked", stage, gameSeconds: elapsed, reason: outcome.reason }) + "\n");
}
process.stdout.write(JSON.stringify({
  schema: "infinity-natural-growth-journey-v1", seeds: { world: WORLD_SEED, arcade: ARCADE_SEED },
  provenance: {
    factory: "createInitialState(20261010, 20261010)", injectedGameState: false,
    clock: "Only tick(state, 1, live); no offline catch-up, tick(0), or direct clock assignment",
    humanActionStrategy: "Explicit serial infrastructure, fixed finite approvals, one curvature reset and two real colony launches; zero manual scrapes or top-ups",
    saveClock: "Deterministic envelope metadata only; SAVE_EPOCH plus audited live seconds. Restore at this clock for browser handoffs to avoid unrelated offline catch-up.",
    browserClaim: "This is a headless natural-growth driver. Importing its milestones into a browser is a separate handoff, not continuous multi-hour UI play.",
  },
  limits: { firstCycleSeconds: FIRST_CYCLE_LIMIT, secondCycleSeconds: SECOND_CYCLE_LIMIT,
    secondCycleExecuted: secondCycleStartedAt !== null, secondCycleStartedAt, secondCycleElapsed: secondCycleStartedAt === null ? null : elapsed - secondCycleStartedAt },
  outcome, milestones, actions, events, waits, paymentAudits,
}, null, 2) + "\n");
