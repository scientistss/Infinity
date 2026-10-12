/**
 * Natural IRN continuation from an independently identified terraformer report.
 * This is compressed engine execution, never continuous human/browser play.
 *
 * node --import tsx scripts/natural-research-network-journey.ts \
 *   --report /path/to/terraformer-report.json \
 *   --expected-report-sha256 <independently-supplied-report-byte-hash> \
 *   --source-sha <independently-supplied-terraformer-source-commit>
 *
 * The supplied digest must come from the caller's reviewed evidence, not a digest
 * calculated by this script and then treated as its own authorization. Clean
 * source metadata is checked, but does not establish a successful CI run.
 * Only player APIs, strict reloads and tick(state, 1, "live") adopt a new state.
 */
declare const process: {
  argv: string[]; env: Record<string, string | undefined>;
  stdout: { write(value: string): void }; stderr: { write(value: string): void };
  exitCode?: number;
};

import { setProductionPct } from "../src/automation/engine";
import { researchById, type ResearchId } from "../src/data/research";
import { nextBeaconIn } from "../src/game/arcade";
import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION } from "../src/game/content";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyTickLog, tick } from "../src/game/logic";
import type { CreateOrderRequest, OrderMoney, OrderTask } from "../src/game/order-state";
import { createOrderTask } from "../src/game/orders";
import { usedFields } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch, researchNetworkView, researchSecondsFor } from "../src/game/research";
import { captureAdoptedSteps } from "./capture-adopted-steps.mjs";
import { expectedNpcEconomy, advanceExpectedNpcWallet, assertNpcEconomy, liftR10StateToR14 } from "./r14-compatibility.mjs";
import { deserializeState, exportSave, importSave, serializeState, type SerializedState } from "../src/game/save";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";

const ORIGIN_MILESTONE = "12-two-real-home-terraformers-complete-and-reloaded";
const HOME = "homeworld", COLONY = "colony-1";
const TOTAL_LIMIT = 6 * 60 * 60, WAIT_LIMIT = 2 * 60 * 60, ACTION_LIMIT = 100;
const ZERO: OrderMoney = { metal: "0", crystal: "0", deuterium: "0" };
const GOLDEN = {
  lab6To10: { metal: "192000", crystal: "384000", deuterium: "192000" },
  shielding0To5: { metal: "6200", crystal: "18600", deuterium: "0" },
  hyperspace0To8: { metal: "0", crystal: "1020000", deuterium: "510000" },
  irn1: { metal: "240000", crystal: "400000", deuterium: "160000" },
  prerequisites: { metal: "438200", crystal: "1822600", deuterium: "862000" },
  computer11: { metal: "0", crystal: "409600", deuterium: "614400" },
  allPayments: { metal: "438200", crystal: "2232200", deuterium: "1476400" },
  irn1Seconds: 3840 / 11,
  computer11BeforeNetworkSeconds: 12288 / 55,
  computer11AfterNetworkSeconds: 6144 / 35,
  researchSpeed: 600,
  minimumSeconds: 1,
};
const RESEARCH_BASE: Partial<Record<ResearchId, readonly [number, number, number]>> = {
  shielding_tech: [200, 600, 0], hyperspace_tech: [0, 4000, 2000],
  intergalactic_research_network: [240000, 400000, 160000], computer_tech: [0, 400, 600],
};
type Save = ReturnType<typeof importSave>;
type OriginSave = Omit<Save, "revision"> & { revision: number };
interface Milestone {
  name: string; gameSeconds: number; continuationSeconds: number; strictRoundtrips: number;
  stateAdoptedFromReload: boolean; subsequentLiveTickObserved: boolean; firstSubsequentLiveTickAt?: number;
  snapshot: ReturnType<typeof snapshot>; save: Save;
}
interface OriginMilestone {
  name: string; gameSeconds: number; strictRoundtrips: number; stateAdoptedFromReload: boolean;
  subsequentLiveTickObserved: boolean; firstSubsequentLiveTickAt?: number; save: OriginSave;
}
interface PaidProof {
  jobId: number; taskId: number | null; planetId: string; source: string;
  kind: "building" | "research"; target: string; targetLevel: number; paid: OrderMoney; totalSeconds: number;
}
let state!: GameState, initial!: SerializedState;
let stateInitialized = false, stage = "verify-origin", elapsed = 0, originGameSeconds = 0, originSavedAt = 0, originNpcAge = expectedNpcEconomy();
let firstNewJobId = 0, finiteTaskId: number | null = null, finiteJobId: number | null = null;
let finitePaidAt: number | null = null, finiteCompletedAt: number | null = null;
let postPaymentProductionOnlyTicks = 0;
let source: Record<string, unknown> | null = null, origin: Record<string, unknown> | null = null, saveDifference: unknown = null;
const wallStartedAt = new Date().toISOString(), wallStartMs = performance.now();
const actions: Array<Record<string, unknown>> = [], waits: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [], payments: Array<Record<string, unknown>> = [];
const milestones: Milestone[] = [], jobs = new Map<number, PaidProof>();
const completions: Array<{ jobId: number; kind: string; target: string; level: number; continuationSeconds: number }> = [];

class JourneyBlocked extends Error {}
function check(ok: unknown, reason: string): asserts ok { if (!ok) throw new JourneyBlocked(`${stage}: ${reason}`); }
function difference(a: unknown, b: unknown, path = "$state"): unknown | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return { path, before: a, after: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path, before: a, after: b };
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const ak = Object.keys(left).sort(), bk = Object.keys(right).sort();
  if (ak.length !== bk.length || ak.some((key, i) => key !== bk[i])) return { path: `${path}.[keys]`, before: ak, after: bk };
  for (const key of ak) { const found = difference(left[key], right[key], `${path}.${key}`); if (found) return found; }
  return null;
}
function exact(a: unknown, b: unknown, label: string): void {
  const found = difference(a, b);
  if (found) { saveDifference = { label, difference: found }; throw new JourneyBlocked(`${stage}: ${label}: ${JSON.stringify(found)}`); }
}
function near(a: number, b: number, label: string, tolerance = Math.max(1e-10, Math.abs(b) * 1e-12)): void {
  check(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b} (tolerance ${tolerance})`);
}
function money(value: ResourceAmounts): OrderMoney {
  return { metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() };
}
// Independent rational parsing for integer paid-price/ledger goldens. No order-money,
// order-wallet, quote, or production deduction helper is used as the money oracle.
function integerAmount(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  check(match && value.length <= 80, `not a bounded nonnegative decimal: ${value}`);
  const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0) - fraction.length;
  check(Number.isInteger(exponent) && Math.abs(exponent) <= 80, `unsupported decimal exponent ${value}`);
  const digits = BigInt(match[1]! + fraction);
  if (exponent >= 0) return digits * 10n ** BigInt(exponent);
  const divisor = 10n ** BigInt(-exponent);
  check(digits % divisor === 0n, `noninteger price/ledger amount ${value}`);
  return digits / divisor;
}
function exactMoney(actual: OrderMoney, expected: OrderMoney, label: string): void {
  for (const id of RESOURCE_IDS) check(integerAmount(actual[id]) === integerAmount(expected[id]), `${label}/${id}: ${actual[id]} != ${expected[id]}`);
}
function cost(base: readonly [number, number, number], level: number): OrderMoney {
  const factor = 2n ** BigInt(level - 1);
  return { metal: String(BigInt(base[0]) * factor), crystal: String(BigInt(base[1]) * factor), deuterium: String(BigInt(base[2]) * factor) };
}
function wallets(current = state): Record<string, OrderMoney> {
  return Object.fromEntries(current.planets.map(planet => [planet.id, money(planet.resources)]));
}
function fields(current = state) {
  return current.planets.map(p => ({ planetId: p.id, fieldsMax: p.fieldsMax, base: p.terraformerFields.base,
    grantedLevels: p.terraformerFields.grantedLevels, terraformer: p.buildings.terraformer,
    usedFields: usedFields(p), freeFields: p.fieldsMax - usedFields(p) }));
}
function snapshot() {
  return { gameSeconds: originGameSeconds + elapsed, continuationSeconds: elapsed, totalTime: state.totalTime.toString(),
    activePlanetId: state.activePlanetId, wallets: wallets(), fields: fields(), grantJobFloor: state.terraformerGrantJobFloor,
    research: serializeState(state).research, orders: serializeState(state).orders,
    computerNetwork: researchNetworkView(state, "computer_tech", HOME), irnNetwork: researchNetworkView(state, "intergalactic_research_network", HOME),
    planets: state.planets.map(p => ({ id: p.id, buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, economy: economy(selectPlanet(state, p.id)) })) };
}
function event(kind: string, detail: unknown): void { events.push({ stage, continuationSeconds: elapsed, kind, detail }); }
function progress(detail: unknown): void { process.stderr.write(JSON.stringify({ stage, continuationSeconds: elapsed, detail }) + "\n"); }
function currentJobs(current = state): PaidProof[] {
  return [
    ...current.planets.flatMap(p => p.buildQueue.map(j => ({ jobId: j.jobId, taskId: j.taskId, planetId: p.id, source: j.source,
      kind: "building" as const, target: j.building, targetLevel: j.targetLevel, paid: money(j.paid), totalSeconds: j.totalSeconds }))),
    ...current.research.queue.map(j => ({ jobId: j.jobId, taskId: j.taskId, planetId: j.planetId, source: j.source,
      kind: "research" as const, target: j.tech, targetLevel: j.targetLevel, paid: money(j.paid), totalSeconds: j.totalSeconds })),
  ];
}
function preserve(): void {
  check(state.terraformerGrantJobFloor === initial.terraformerGrantJobFloor, "historical terraformer grant floor changed");
  exact(state.orders.tasks.filter(t => t.id < initial.orders.nextTaskId), initial.orders.tasks, "historical orders and ledgers preserved");
  exact(state.buildingTemplates, initial.buildingTemplates, "building templates preserved");
  exact(state.researchTemplates, initial.researchTemplates, "research templates preserved");
  exact(state.formations, initial.formations, "formations preserved");
  exact(state.universe, initial.universe, "universe preserved");
  exact(state.deepSpace, initial.deepSpace, "deep-space world preserved");
  exact(state.messages, initial.messages, "historical flight messages preserved");
  check(state.offlineBonusHours === initial.offlineBonusHours, "offline allowance changed");
  check(state.planets.length === initial.planets.length, "planet set changed");
  for (const old of initial.planets) {
    const now = state.planets.find(p => p.id === old.id); check(now, `lost planet ${old.id}`);
    exact(now.terraformerFields, old.terraformerFields, `${old.id} field grants preserved`);
    check(now.fieldsMax === old.fieldsMax, `${old.id} field maximum changed`);
    for (const id of Object.keys(old.buildings) as Array<keyof typeof old.buildings>) {
      if (old.id === HOME && id === "research_lab") continue;
      check(now.buildings[id] === old.buildings[id], `unrequested building changed ${old.id}/${id}`);
    }
    exact(now.units, old.units, `${old.id} units preserved`);
    for (const id of Object.keys(old.productionPct) as Array<keyof typeof old.productionPct>) {
      if (old.id === HOME && id === "solar_plant") continue;
      check(now.productionPct[id] === old.productionPct[id], `unrequested production setting changed ${old.id}/${id}`);
    }
    check(now.shipyardQueue.length === 0, "unexpected shipyard job");
  }
  for (const id of Object.keys(initial.research.levels) as ResearchId[]) {
    if (["shielding_tech", "hyperspace_tech", "intergalactic_research_network", "computer_tech"].includes(id)) continue;
    check(state.research.levels[id] === initial.research.levels[id], `unrequested research changed ${id}`);
  }
  check(state.fleets.length === 0 && state.nextFleetId === initial.nextFleetId && state.orders.nextWorkId === initial.orders.nextWorkId,
    "unexpected flight or transport authorization");
  check(state.manualClicks === 0 && state.stats.scrapes === 0 && state.stats.launches === 0 && !state.hasPrestiged,
    "manual resource collection or prestige altered the route");
  check(state.arcade.stats.manualRuns === 0 && state.arcade.stats.autoRuns === 0 && state.arcade.history.length === 0,
    "a ring reward was revealed");
  exact(state.curvature, initial.curvature, "curvature unchanged");
  exact(state.items, initial.items, "items unchanged");
  check(state.darkMatter.toString() === initial.darkMatter && state.warpCores.toString() === initial.warpCores && state.boosters.length === 0,
    "premium resources or boosters changed");
  check(state.protocols.slots.every(slot => slot.card === null), "a protocol was installed");
}
function observe(): void {
  assertNpcEconomy(state, originNpcAge, "source-owned NPC age plus counted adopted one-second continuation");
  preserve();
  const live = currentJobs();
  check(new Set(live.map(j => j.jobId)).size === live.length, "duplicate live paid identity");
  for (const job of live) {
    check(job.jobId >= firstNewJobId && job.jobId < state.orders.nextJobId && job.planetId === HOME, "wrong paid identity or payer");
    check(job.totalSeconds >= GOLDEN.minimumSeconds, "paid job lacks a real positive construction/research duration");
    if (jobs.has(job.jobId)) exact(job, jobs.get(job.jobId), `paid job ${job.jobId} identity, price and frozen duration`);
    else { jobs.set(job.jobId, job); event("new-paid-job", job); }
    if (job.taskId !== null) {
      const task = state.orders.tasks.find(t => t.id === job.taskId);
      check(task && task.id === finiteTaskId && task.kind === "research" && task.planetId === HOME
        && task.activeJob?.jobId === job.jobId && job.source === "plan", "finite research lost its real owner or fixed payer");
    }
  }
}
function action<T extends { state: GameState; ok: boolean; reason: string }>(api: string, request: unknown, run: () => T): T {
  check(actions.length < ACTION_LIMIT, `bounded ${ACTION_LIMIT}-action budget exhausted`);
  const before = state, result = run(); state = result.state;
  actions.push({ index: actions.length + 1, stage, continuationSeconds: elapsed, api, request, ok: result.ok, reason: result.reason,
    beforeWallets: wallets(before), afterWallets: wallets(), beforeNextJobId: before.orders.nextJobId, afterNextJobId: state.orders.nextJobId });
  check(result.ok, `${api}: ${result.reason}`); observe(); return result;
}
function select(planetId: string): void {
  if (state.activePlanetId !== planetId) action("selectPlanet", { planetId }, () => ({ state: selectPlanet(state, planetId), ok: true, reason: "explicit player selection" }));
}
function walletProof(before: GameState, after: GameState, payer: string | null, expectedPrice: OrderMoney, productionSeconds: 0 | 1) {
  const proof: Array<Record<string, unknown>> = [];
  for (const old of before.planets) {
    const now = after.planets.find(p => p.id === old.id)!;
    const eco = economy(selectPlanet(before, old.id));
    const expected: Record<string, number> = {}, actual: Record<string, number> = {}, error: Record<string, number> = {};
    for (const id of RESOURCE_IDS) {
      const balance = Number(old.resources[id].toString()), price = old.id === payer ? Number(expectedPrice[id]) : 0;
      check(balance >= 0 && balance < 1e8 && eco.net[id] >= 0 && eco.consumption[id] === 0, "wallet oracle requires bounded nonnegative no-fusion regime");
      // Number arithmetic is independent of the game's mantissa/exponent wallet.
      const produced = productionSeconds === 0 ? balance : Math.min(eco.caps[id], balance + eco.net[id]);
      expected[id] = produced - price; actual[id] = Number(now.resources[id].toString());
      error[id] = actual[id]! - expected[id]!;
      const tolerance = 1e-7 + Math.abs(expected[id]!) * 2e-14;
      near(actual[id]!, expected[id]!, `independent wallet movement ${old.id}/${id}`, tolerance);
    }
    proof.push({ planetId: old.id, before: money(old.resources), oneSecondProduction: productionSeconds ? eco.net : ZERO,
      storageCaps: eco.caps, exactIntegerPaid: old.id === payer ? expectedPrice : ZERO, independentNumberExpected: expected,
      actualWalletRepresentation: money(now.resources), absoluteError: error });
  }
  return proof;
}
function recordManualPayment(before: GameState, jobId: number | undefined, expected: OrderMoney, category: string): void {
  check(jobId === before.orders.nextJobId && state.orders.nextJobId === before.orders.nextJobId + 1, "manual payment failed unique issuance");
  const job = jobs.get(jobId); check(job && job.source === "manual" && job.taskId === null, "manual paid queue identity missing");
  exactMoney(job.paid, expected, `${category} independently calculated paid price`);
  payments.push({ category, continuationSeconds: elapsed, jobId, taskId: null, payerId: HOME, exactIntegerPaid: expected,
    walletOracle: "independent bounded Number arithmetic, with documented wallet representation tolerance",
    wallets: walletProof(before, state, HOME, expected, 0) });
}
function task(): OrderTask { const found = state.orders.tasks.find(t => t.id === finiteTaskId); check(found, "finite task missing"); return found; }
function proveFinitePayment(before: GameState): void {
  const job = state.research.queue.find(j => j.taskId === finiteTaskId); check(job, "scheduler paid no live research");
  check(finiteJobId === null && before.orders.accumulator === 9 && before.activePlanetId === COLONY && state.activePlanetId === COLONY
    && before.research.queue.length === 0 && before.planets.every(p => p.buildQueue.length === 0)
    && nextBeaconIn(before) > 1 && before.protocols.accumulator === 0 && state.orders.nextJobId === before.orders.nextJobId + 1,
    "finite payment is not the isolated real ten-second scheduler boundary");
  exact(before.unlocked, state.unlocked, "payment tick must not change production achievements");
  check(job.jobId === before.orders.nextJobId && job.planetId === HOME && job.tech === "computer_tech" && job.targetLevel === 11
    && job.source === "plan" && job.taskId === finiteTaskId, "scheduler paid the wrong target or payer");
  exactMoney(money(job.paid), GOLDEN.computer11, "finite computer11 paid price");
  exactMoney(task().charged, GOLDEN.computer11, "finite computer11 exact charged ledger");
  exactMoney(task().budget, GOLDEN.computer11, "finite computer11 explicit budget");
  exactMoney(task().refunded, ZERO, "finite computer11 refund ledger");
  near(job.totalSeconds, GOLDEN.computer11AfterNetworkSeconds, "main10 plus colony3 duration golden");
  near(job.remainingSeconds, job.totalSeconds, "job starts at scheduler boundary without fabricated elapsed time");
  finiteJobId = job.jobId; finitePaidAt = elapsed;
  payments.push({ category: "finite-computer11", continuationSeconds: elapsed, jobId: job.jobId, taskId: finiteTaskId,
    payerId: HOME, selectedPlanetId: before.activePlanetId, exactIntegerPaid: GOLDEN.computer11,
    schedulerAccumulatorBefore: before.orders.accumulator, actualNetwork: researchNetworkView(before, "computer_tech", HOME),
    totalSeconds: job.totalSeconds, wallets: walletProof(before, state, HOME, GOLDEN.computer11, 1) });
  event("finite-plan-actually-paid-from-fixed-home-while-colony-selected", { task: structuredClone(task()), job: jobs.get(job.jobId) });
}
function oneSecond(): void {
  check(elapsed < TOTAL_LIMIT, `total ${TOTAL_LIMIT}-second continuation budget exhausted; inspect last wait/resources rather than extending silently`);
  const before = state, alreadyPaid = finiteJobId !== null, log = emptyTickLog(); let calls = 0;
  const witnessed = captureAdoptedSteps(state,value=>({state:tick(value,1,"live",calls++ === 0 ? log : emptyTickLog())}),serializeState);
  state = witnessed.result.state; originNpcAge = advanceExpectedNpcWallet(originNpcAge,witnessed.adoptedSegmentsSeconds); elapsed += 1;
  near(state.totalTime.toNumber(), originGameSeconds + elapsed, "counted real one-second engine clock");
  check(state.orders.nextJobId >= before.orders.nextJobId && state.orders.nextTaskId >= before.orders.nextTaskId, "identity counter regressed");
  observe();
  if (finiteTaskId !== null && finiteJobId === null && state.research.queue.some(j => j.taskId === finiteTaskId)) proveFinitePayment(before);
  if (alreadyPaid) {
    check(state.orders.nextJobId === before.orders.nextJobId, "finite research made an additional paid job");
    exactMoney(task().charged, GOLDEN.computer11, "in-flight/finished exact charge remains one computer11");
    exactMoney(task().refunded, ZERO, "in-flight/finished exact refund remains zero");
    const proof = walletProof(before, state, null, ZERO, 1);
    postPaymentProductionOnlyTicks += 1;
    if (log.completedResearch.length) event("completion-tick-production-only-no-second-debit", proof);
  }
  for (const done of log.completedBuilds) {
    const job = currentJobs(before).find(j => j.kind === "building" && j.target === done.building && j.targetLevel === done.level);
    check(job && done.building === "research_lab" && (!done.planetId || done.planetId === HOME), "unexpected or unowned building completion");
    check(!completions.some(c => c.jobId === job.jobId), "building completed twice");
    completions.push({ jobId: job.jobId, kind: job.kind, target: job.target, level: done.level, continuationSeconds: elapsed });
  }
  for (const done of log.completedResearch) {
    const job = currentJobs(before).find(j => j.kind === "research" && j.target === done.tech && j.targetLevel === done.level);
    check(job && !completions.some(c => c.jobId === job.jobId), "research completed without an observed payment, or completed twice");
    completions.push({ jobId: job.jobId, kind: job.kind, target: job.target, level: done.level, continuationSeconds: elapsed });
    if (job.jobId === finiteJobId) finiteCompletedAt = elapsed;
  }
  check(log.completedUnits.length === 0, "unexpected unit completion");
  if (log.completedBuilds.length || log.completedResearch.length) event("actual-paid-queue-completion", log);
  for (const saved of milestones) if (!saved.subsequentLiveTickObserved) {
    saved.subsequentLiveTickObserved = true; saved.firstSubsequentLiveTickAt = originGameSeconds + elapsed;
  }
  if (elapsed % 1800 === 0) progress({ waiting: true, snapshot: snapshot() });
}
function until(label: string, ready: () => boolean, reason: () => string, limit = WAIT_LIMIT): void {
  const start = elapsed; let firstReason = "", lastReason = "";
  try {
    while (!ready()) {
      lastReason = reason(); if (!firstReason) firstReason = lastReason;
      check(elapsed - start < limit, `${label} exceeded ${limit}s: ${lastReason}; wallets=${JSON.stringify(wallets())}`);
      oneSecond();
    }
  } finally { waits.push({ stage, label, start, end: elapsed, waitedSeconds: elapsed - start, limit, firstReason, lastReason }); }
}
function checkpoint(name: string): void {
  const at = originSavedAt + elapsed * 1000;
  for (let round = 1; round <= 2; round++) {
    const before = serializeState(state), saved = importSave(exportSave(state, at, at)), restored = deserializeState(saved.state);
    exact(before, saved.state, `${name} raw full-state export/import ${round}`);
    exact(before, serializeState(restored), `${name} strict full-state reload ${round}`); state = restored;
  }
  observe();
  milestones.push({ name, gameSeconds: originGameSeconds + elapsed, continuationSeconds: elapsed, strictRoundtrips: 2,
    stateAdoptedFromReload: true, subsequentLiveTickObserved: false, snapshot: snapshot(), save: importSave(exportSave(state, at, at)) });
  actions.push({ stage, continuationSeconds: elapsed, api: "exportSave/importSave/deserializeState", name, strictRoundtrips: 2, ok: true });
  progress({ milestone: name, wallets: wallets(), network: researchNetworkView(state, "computer_tech", HOME) });
}
function ensureFundingPossible(expected: OrderMoney): void {
  const home = state.planets.find(p => p.id === HOME)!, eco = economy(selectPlanet(state, HOME));
  for (const id of RESOURCE_IDS) {
    const need = Number(expected[id]);
    check(need <= eco.caps[id], `${id} price ${need} exceeds actual storage cap ${eco.caps[id]}; this approved route does not upgrade storage`);
    check(home.resources[id].toNumber() >= need || eco.net[id] > 0, `no natural ${id} income can fund ${need}; inspect production settings`);
  }
}
function buildLabTo10(): void {
  select(HOME);
  while (activePlanet(state).buildings.research_lab < 10) {
    check(state.research.queue.length === 0 && state.planets.every(p => p.buildQueue.length === 0), "lab upgrade attempted while paid work is active");
    const level = activePlanet(state).buildings.research_lab + 1, expected = cost([200, 400, 200], level);
    ensureFundingPossible(expected);
    until(`naturally fund mother research lab ${level}`, () => {
      const quote = canEnqueue(state, "research_lab");
      check(quote.ok || quote.onlyResources, `lab ${level} structural blocker: ${quote.reason}`); return quote.ok;
    }, () => canEnqueue(state, "research_lab").reason);
    const quote = canEnqueue(state, "research_lab"), before = state;
    check(quote.targetLevel === level, "lab quote changed target"); exactMoney(money(quote.cost), expected, "lab independent price");
    const paid = action("enqueue", { planetId: HOME, building: "research_lab", targetLevel: level, source: "manual", expectedCost: expected }, () => enqueue(state, "research_lab", "manual"));
    recordManualPayment(before, paid.jobId, expected, "mother-lab6-to10");
    until(`complete actual paid mother lab ${level}`, () => activePlanet(state).buildings.research_lab === level, () => "real paid construction timer");
  }
}
function researchTo(tech: ResearchId, target: number, category: string): void {
  select(HOME);
  while (state.research.levels[tech] < target) {
    check(state.research.queue.length === 0 && state.planets.every(p => p.buildQueue.length === 0), "prerequisite research overlaps other paid work");
    const level = state.research.levels[tech] + 1, base = RESEARCH_BASE[tech]; check(base, `missing independent ${tech} price`);
    const expected = cost(base, level); ensureFundingPossible(expected);
    until(`naturally fund ${tech}/${level}`, () => {
      const quote = canEnqueueResearch(state, tech); check(quote.ok || quote.onlyResources, `${tech} structural blocker: ${quote.reason}`); return quote.ok;
    }, () => canEnqueueResearch(state, tech).reason);
    const quote = canEnqueueResearch(state, tech), before = state;
    check(quote.targetLevel === level, "research quote changed target"); exactMoney(money(quote.cost), expected, `${tech} independent cost`);
    const beforeNetwork = researchNetworkView(state, tech, HOME);
    check(beforeNetwork.networkLevel === 0 && beforeNetwork.effectiveLabLevel === 10 && beforeNetwork.supports.length === 0,
      "prerequisite research used an unearned network");
    const paid = action("enqueueResearch", { planetId: HOME, tech, targetLevel: level, source: "manual", expectedCost: expected }, () => enqueueResearch(state, tech, "manual"));
    recordManualPayment(before, paid.jobId, expected, category);
    const job = state.research.queue[0]!;
    near(job.totalSeconds, Math.max(GOLDEN.minimumSeconds, (Number(expected.metal) + Number(expected.crystal)) * 3600 / (1000 * 11 * 600)), `${tech}/${level} independent duration`);
    if (tech === "intergalactic_research_network") {
      exactMoney(money(job.paid), GOLDEN.irn1, "IRN1 golden"); near(job.totalSeconds, GOLDEN.irn1Seconds, "IRN1 own old-network duration");
      check(beforeNetwork.requiredLabLevel === 10 && state.research.levels.intergalactic_research_network === 0,
        "colony lab3 helped IRN1 or IRN1 completed without its timer");
      checkpoint("04-irn1-really-paid-in-flight-old-network-zero-and-reloaded");
    }
    until(`complete actual paid ${tech}/${level}`, () => state.research.levels[tech] === level, () => "real paid research timer");
  }
}
function paymentTotal(category?: string): OrderMoney {
  const sums = { metal: 0n, crystal: 0n, deuterium: 0n };
  for (const p of payments) if (!category || p.category === category) for (const id of RESOURCE_IDS) sums[id] += integerAmount((p.exactIntegerPaid as OrderMoney)[id]);
  return { metal: String(sums.metal), crystal: String(sums.crystal), deuterium: String(sums.deuterium) };
}

/** The workflow's fixed pre-IRN source is r10; current-source handoffs are r14.
 * Build the entire expected migrated envelope independently. Never erase source
 * fields to make a comparison pass, and never admit live demolition as origin.
 */
function sourceOwnedNpcWallet(sourceState: OriginSave["state"]) {
  const saved = sourceState.npcEconomy;
  const expected = { model: "npc-wallet-garrison-v1" as const, now: saved.now,
    baseline: { stock: [...saved.baseline.stock], mark: saved.baseline.mark }, sites: {} };
  assertNpcEconomy(sourceState, expected, "unchanged source-owned no-attack wallet");
  return expected;
}

export function readNaturalResearchOrigin(original: OriginSave, sourceSha: string) {
  check(original.schema === SAVE_SCHEMA && original.version === SAVE_VERSION && SAVE_REVISION === 14,
    "origin schema/version or current revision differs");
  const historical = original.revision === 10;
  check(historical ? sourceSha === "4afa5331d6e54509a643572570dc3cd194c78ebf" : original.revision === SAVE_REVISION,
    "only the exact pinned pre-IRN r10 source or an unchanged current r14 origin is supported");
  check(Array.isArray(original.state.planets), "origin planet list missing");
  if (historical) for (const planet of original.state.planets) check(!Object.hasOwn(planet, "demolition"), "r10 source already contains a forbidden demolition field");
  else for (const planet of original.state.planets) check(Object.hasOwn(planet, "demolition") && planet.demolition === null, "current origin has missing or competing demolition authority");
  const expected = historical ? { ...original, revision: SAVE_REVISION, state: liftR10StateToR14(original.state, expectedNpcEconomy()) } : structuredClone(original);
  // For a true current handoff, the unchanged source envelope owns its saved age.
  // For a genuine old source, migration is a pure zero-time initialization.
  assertNpcEconomy(expected.state, historical ? expectedNpcEconomy() : sourceOwnedNpcWallet(original.state), "independent original handoff NPC metadata");
  const imported = importSave(JSON.stringify(original)), candidate = deserializeState(imported.state);
  exact(imported, expected, "origin entire envelope equals only the independently allowed revision, zero-age NPC and null additions");
  exact(serializeState(candidate), expected.state, "origin entire strict reload equals independently expected state");
  check(candidate.planets.every(planet => planet.demolition === null), "origin contains competing demolition work");
  return { imported, candidate, migration: historical ? "r10→r14: revision plus exact zero-age wallet/empty-receipt state and one explicit null demolition slot per planet and one explicit null scout snapshot slot per message; every prior field preserved" : "r14 unchanged complete envelope and state" };
}

async function loadOrigin(): Promise<void> {
  const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
    import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
  ]);
  const root = new URL("../", import.meta.url), git = (argv: string[]) => String(execFileSync("git", argv, { cwd: root, encoding: "utf8", timeout: 10000 })).trimEnd();
  const head = git(["rev-parse", "HEAD"]), scriptPath = "scripts/natural-research-network-journey.ts";
  source = { sourceSha: head, gitHead: head, scriptPath,
    scriptSha256: String(createHash("sha256").update(readFileSync(new URL("./natural-research-network-journey.ts", import.meta.url))).digest("hex")),
    worktreeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all"]),
    sourceScopeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github"]),
    identityNote: "HEAD alone does not identify dirty runtime source. See the script digest and both worktree statuses; CI success is a separate gate." };
  check(!process.env.GITHUB_SHA || process.env.GITHUB_SHA === head, "GITHUB_SHA differs from actual runtime checkout");
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    check(flag && ["--report", "--expected-report-sha256", "--source-sha"].includes(flag) && value && !args.has(flag),
      "usage: --report PATH --expected-report-sha256 INDEPENDENT_HASH --source-sha INDEPENDENT_SHA");
    args.set(flag, value);
  }
  const expectedHash = args.get("--expected-report-sha256"), expectedSource = args.get("--source-sha");
  check(args.size === 3 && expectedHash && /^[0-9a-f]{64}$/.test(expectedHash) && expectedSource && /^[0-9a-f]{40}$/.test(expectedSource),
    "all three explicit origin inputs are required; source SHA and report digest must be supplied independently");
  const bytes = readFileSync(args.get("--report")), hash = String(createHash("sha256").update(bytes).digest("hex"));
  check(hash === expectedHash, `origin report byte digest mismatch: expected ${expectedHash}, got ${hash}`);
  const report = JSON.parse(String(bytes)) as {
    schema: string; source: { sourceSha: string; gitHead: string; worktreeStatusPorcelain: string; sourceScopeStatusPorcelain: string };
    outcome: { status: string }; milestones: OriginMilestone[];
  };
  check(report.schema === "infinity-natural-terraformer-journey-v1" && report.outcome?.status === "passed", "origin is not a successful terraformer journey report");
  check(report.source?.sourceSha === expectedSource && report.source.gitHead === expectedSource, "origin sourceSha/gitHead does not match caller-supplied source SHA");
  check(report.source.worktreeStatusPorcelain === "" && report.source.sourceScopeStatusPorcelain === "", "origin was not run from a clean full and scoped worktree");
  check(Array.isArray(report.milestones), "origin milestone list is missing");
  const found = report.milestones.filter(m => m.name === ORIGIN_MILESTONE); check(found.length === 1, "required live terraformer milestone missing or duplicated");
  const old = found[0]!;
  check(old.strictRoundtrips === 2 && old.stateAdoptedFromReload && old.subsequentLiveTickObserved
    && typeof old.firstSubsequentLiveTickAt === "number" && old.firstSubsequentLiveTickAt > old.gameSeconds
    && old.save.schema === SAVE_SCHEMA && old.save.version === SAVE_VERSION && (old.save.revision === 10 || old.save.revision === SAVE_REVISION) && SAVE_REVISION === 14,
    "origin milestone lacks strict live reload evidence or a supported r10/r14 envelope");
  check(Number.isSafeInteger(old.gameSeconds) && old.gameSeconds > 0 && Number.isSafeInteger(old.save.savedAt) && old.save.lastTickAt === old.save.savedAt,
    "origin game time or save envelope clocks are invalid");
  origin = { sourceSha: expectedSource, gitHead: report.source.gitHead, reportPath: args.get("--report"), reportSha256: hash,
    expectedReportSha256: expectedHash, milestoneName: ORIGIN_MILESTONE, gameSeconds: old.gameSeconds,
    sourceWorktreeStatusPorcelain: report.source.worktreeStatusPorcelain, sourceScopeStatusPorcelain: report.source.sourceScopeStatusPorcelain,
    sourceBinding: "Caller-supplied digest and SHA, matched to raw report bytes and both embedded SHA fields. This does not by itself claim CI success.",
    originalSave: old.save };
  originNpcAge = old.save.revision === 10 ? expectedNpcEconomy() : sourceOwnedNpcWallet(old.save.state);
  const { candidate, migration } = readNaturalResearchOrigin(old.save, expectedSource);
  origin.migration = migration;
  const home = candidate.planets.find(p => p.id === HOME), colony = candidate.planets.find(p => p.id === COLONY);
  check(candidate.planets.length === 2 && home && colony, "route requires the actual mother and one actual colony");
  check(home.buildings.research_lab === 6 && colony.buildings.research_lab === 3
    && candidate.research.levels.computer_tech === 10 && candidate.research.levels.energy_tech === 12
    && candidate.research.levels.shielding_tech === 0 && candidate.research.levels.hyperspace_tech === 0
    && candidate.research.levels.intergalactic_research_network === 0, "origin initial research/lab levels differ from approved minimal route");
  check(home.buildings.terraformer === 2 && home.terraformerFields.grantedLevels === 2 && home.fieldsMax === 173
    && home.terraformerFields.base === 163 && colony.buildings.terraformer === 0 && colony.terraformerFields.grantedLevels === 0,
    "origin is not the two-real-mother-terraformer world");
  check(candidate.research.queue.length === 0 && candidate.planets.every(p => p.demolition === null && p.buildQueue.length === 0 && p.shipyardQueue.length === 0)
    && candidate.fleets.length === 0 && candidate.boosters.length === 0
    && candidate.orders.tasks.every(t => t.status === "completed" || t.status === "cancelled")
    && candidate.orders.accumulator === 0 && candidate.protocols.slots.every(s => s.card === null), "origin has competing active or unpaid work");
  check(home.fieldsMax - usedFields(home) >= 4 && home.buildings.robotics_factory === 10 && home.buildings.nanite_factory === 1
    && home.buildings.metal_storage === 9 && home.buildings.crystal_storage === 9 && home.buildings.deuterium_tank === 7,
    "origin storage, construction prerequisites or four free laboratory fields differ");
  near(candidate.totalTime.toNumber(), old.gameSeconds, "origin totalTime equals milestone game time");
  state = candidate; initial = serializeState(candidate); stateInitialized = true;
  originGameSeconds = old.gameSeconds; originSavedAt = old.save.savedAt; firstNewJobId = candidate.orders.nextJobId;
  observe();
}

async function main(): Promise<void> {
let outcome: Record<string, unknown>;
try {
  await loadOrigin();
  checkpoint("00-unchanged-origin-full-world-imported-and-reloaded");
  stage = "real-laboratory-upgrades";
  select(HOME);
  if (activePlanet(state).productionPct.solar_plant !== 100) {
    const oldPct = activePlanet(state).productionPct.solar_plant;
    action("setProductionPct", { planetId: HOME, building: "solar_plant", from: oldPct, pct: 100 }, () => ({
      state: setProductionPct(state, "solar_plant", 100), ok: true, reason: "restore normal solar production using the player API" }));
    check(activePlanet(state).productionPct.solar_plant === 100, "normal solar setting was not restored");
  }
  buildLabTo10(); exactMoney(paymentTotal("mother-lab6-to10"), GOLDEN.lab6To10, "four individual lab payments total");
  checkpoint("01-four-real-paid-lab-upgrades-main10-colony3-and-reloaded");

  stage = "real-shield-and-hyperspace-prerequisites";
  researchTo("shielding_tech", 5, "shielding0-to5");
  exactMoney(paymentTotal("shielding0-to5"), GOLDEN.shielding0To5, "five individual shield payments total");
  checkpoint("02-five-real-paid-shield-levels-complete-and-reloaded");
  researchTo("hyperspace_tech", 8, "hyperspace0-to8");
  exactMoney(paymentTotal("hyperspace0-to8"), GOLDEN.hyperspace0To8, "eight individual hyperspace payments total");
  const beforeNetwork = researchNetworkView(state, "computer_tech", HOME);
  check(beforeNetwork.primaryLabLevel === 10 && beforeNetwork.networkLevel === 0 && beforeNetwork.effectiveLabLevel === 10 && beforeNetwork.supports.length === 0,
    "pre-IRN mother quote is not local lab10");
  near(researchSecondsFor(state, researchById("computer_tech"), 11), GOLDEN.computer11BeforeNetworkSeconds, "independent computer11 pre-IRN time");
  event("before-network-quote", { network: beforeNetwork, computer11Seconds: GOLDEN.computer11BeforeNetworkSeconds });
  checkpoint("03-real-hyperspace8-and-main10-before-network-and-reloaded");

  stage = "real-irn1-payment-and-completion";
  researchTo("intergalactic_research_network", 1, "irn0-to1");
  exactMoney(paymentTotal(), GOLDEN.prerequisites, "18 separate prerequisite payments aggregate");
  const connected = researchNetworkView(state, "computer_tech", HOME), ownNext = researchNetworkView(state, "intergalactic_research_network", HOME);
  check(connected.primaryLabLevel === 10 && connected.networkLevel === 1 && connected.requiredLabLevel === 1
    && connected.effectiveLabLevel === 13 && connected.supports.length === 1
    && connected.supports[0]!.planetId === COLONY && connected.supports[0]!.labLevel === 3,
    "real IRN1 did not connect the existing colony lab3 to mother10");
  check(ownNext.requiredLabLevel === 10 && ownNext.effectiveLabLevel === 10 && ownNext.supports.length === 0,
    "colony lab3 incorrectly satisfies the IRN research lab10 requirement");
  near(researchSecondsFor(state, researchById("computer_tech"), 11), GOLDEN.computer11AfterNetworkSeconds, "independent computer11 post-IRN time");
  event("earned-network-quote", { connected, nextIrn: ownNext, computer11Seconds: GOLDEN.computer11AfterNetworkSeconds });
  checkpoint("05-real-irn1-complete-main10-plus-colony3-effective13-and-reloaded");

  stage = "finite-fixed-mother-computer11-intent-and-payment";
  ensureFundingPossible(GOLDEN.computer11);
  until("naturally fund exact finite computer11 budget", () => RESOURCE_IDS.every(id => activePlanet(state).resources[id].toNumber() >= Number(GOLDEN.computer11[id])), () => "natural mother C/D production");
  until("isolated scheduler audit window", () => nextBeaconIn(state) > 12 && state.protocols.accumulator === 0, () => "natural beacon/protocol boundary", 1810);
  select(COLONY);
  finiteTaskId = state.orders.nextTaskId;
  const request: CreateOrderRequest = { kind: "research", planetId: HOME, tech: "computer_tech", targetLevel: 11,
    budget: { ...GOLDEN.computer11 }, expectedNextTaskId: finiteTaskId };
  const beforeIntent = state;
  action("createOrderTask", request, () => createOrderTask(state, request));
  exact(wallets(beforeIntent), wallets(), "finite intent creation has no resource charge");
  check(state.orders.nextJobId === beforeIntent.orders.nextJobId && state.research.queue.length === 0 && task().activeJob === null,
    "finite intent manufactured a paid job");
  exactMoney(task().charged, ZERO, "unpaid finite intent ledger");
  checkpoint("06-finite-computer11-explicit-budget-fixed-mother-unpaid-colony-selected");
  until("actual ten-second scheduler pays mother while colony selected", () => finiteJobId !== null,
    () => `finite task status=${task().status}, reason=${task().reason}`, 11);
  check(state.research.levels.computer_tech === 10, "finite research completed at payment instead of following its timer");
  checkpoint("07-finite-computer11-real-payment-in-flight-frozen-network-duration-reloaded");

  stage = "strict-live-network-research-continuation";
  const paidNextId = state.orders.nextJobId;
  select(HOME); oneSecond(); select(COLONY);
  for (let i = 0; i < 4; i++) oneSecond();
  const inflight = state.research.queue.find(j => j.jobId === finiteJobId); check(inflight && finitePaidAt !== null, "finite research disappeared before its timer");
  near(inflight.totalSeconds, GOLDEN.computer11AfterNetworkSeconds, "duration remains frozen across selection and live reload");
  near(inflight.remainingSeconds, GOLDEN.computer11AfterNetworkSeconds - (elapsed - finitePaidAt), "remaining duration follows only counted live seconds");
  checkpoint("08-finite-computer11-still-in-flight-after-live-ticks-and-second-reload");
  until("actual finite computer11 completion", () => state.research.levels.computer_tech === 11, () => "frozen actual paid research countdown", 180);
  check(finiteCompletedAt !== null && finitePaidAt !== null && finiteCompletedAt - finitePaidAt === Math.ceil(GOLDEN.computer11AfterNetworkSeconds),
    "observed completion does not match the true fractional research duration");
  check(task().status === "completed" && task().activeJob === null && state.research.queue.length === 0 && state.orders.nextJobId === paidNextId,
    "finite target did not finish exactly once without replacement work");
  exactMoney(task().charged, GOLDEN.computer11, "completed finite exact charge"); exactMoney(task().refunded, ZERO, "completed finite no refunds");
  checkpoint("09-finite-computer11-completed-once-exact-ledger-and-reloaded");
  const finishedTask = structuredClone(task()), finishedStats = state.stats.researchCompleted;
  const stablePaidSeconds = 21;
  for (let i = 0; i < stablePaidSeconds; i++) {
    const before = state; oneSecond();
    check(state.orders.nextJobId === paidNextId && state.stats.researchCompleted === finishedStats && state.research.queue.length === 0,
      "completed finite task spent or completed again");
    exact(task(), finishedTask, "completed finite task and exact ledger remain finished");
    walletProof(before, state, null, ZERO, 1);
  }
  checkpoint("10-finished-target-survives-extra-live-ticks-and-reloads-without-extra-consumption");
  oneSecond();
  exactMoney(paymentTotal(), GOLDEN.allPayments, "all 19 separately witnessed payments aggregate");
  check(jobs.size === 19 && payments.length === 19 && completions.length === 19 && state.orders.nextJobId === firstNewJobId + 19,
    "19 expected paid identities/payments/completions were not each observed exactly once");
  for (let id = firstNewJobId; id < state.orders.nextJobId; id++) check(jobs.has(id) && completions.filter(c => c.jobId === id).length === 1, `job ${id} missing or repeated`);
  check(milestones.every(m => m.subsequentLiveTickObserved), "a strict saved milestone lacks subsequent live continuation");
  check(state.research.levels.energy_tech === 12 && Number(state.research.levels.computer_tech) === 11
    && state.research.levels.intergalactic_research_network === 1 && task().status === "completed", "final actual target levels differ");
  outcome = { status: "passed", continuationGameSeconds: elapsed, totalGameSeconds: originGameSeconds + elapsed,
    paidJobsObserved: jobs.size, separatelyAuditedPayments: payments.length, actualCompletions: completions.length,
    finiteTaskId, finiteJobId, finitePaidAt, finiteCompletedAt, frozenComputer11Seconds: GOLDEN.computer11AfterNetworkSeconds,
    finiteFinished: true, postPaymentProductionOnlyTicks, extraPostCompletionSeconds: stablePaidSeconds + 1, totalPaid: paymentTotal(), finalSnapshot: snapshot(),
    nativeBrowserContinuation: "not run by this engine script" };
} catch (error) {
  process.exitCode = 1;
  outcome = { status: "blocked", stage, reason: error instanceof Error ? error.message : String(error),
    continuationGameSeconds: elapsed, totalGameSeconds: stateInitialized ? originGameSeconds + elapsed : null,
    finalSnapshot: stateInitialized ? snapshot() : null, nativeBrowserContinuation: "not run by this engine script" };
  progress(outcome);
}
process.stdout.write(JSON.stringify({ schema: "infinity-natural-research-network-journey-v1", source, origin,
  provenance: {
    mode: "compressed normal engine execution with one-second live ticks; not continuous human browser play",
    injectedGameState: false, noSyntheticFunds: true, noSyntheticTech: true, noSyntheticJobs: true,
    noRawSettingsPatches: true, noRingRewardReveals: true, noClockAssignments: true,
    clock: "Only tick(state, 1, live) advances game time; savedAt metadata is origin savedAt plus counted game seconds, not human elapsed time.",
    money: "Exact integer prices and task ledger totals use independent BigInt arithmetic. Wallet movement uses independent bounded Number arithmetic with tolerance 1e-7 + abs(expected)*2e-14; wallet decimal representation is not claimed exact.",
    originQualification: "A clean source-bound successful report is required. Preparatory local evidence is not thereby CI-green; CI and native browser are separate verification gates.",
    offline: "No offline catch-up or changes to offline limits are used.",
  }, timing: { wallStartedAt, wallFinishedAt: new Date().toISOString(), wallElapsedSeconds: (performance.now() - wallStartMs) / 1000,
    originGameSeconds: stateInitialized ? originGameSeconds : null, continuationGameSeconds: elapsed,
    totalGameSeconds: stateInitialized ? originGameSeconds + elapsed : null },
  limits: { totalGameSeconds: TOTAL_LIMIT, individualWaitSeconds: WAIT_LIMIT, playerActions: ACTION_LIMIT }, golden: GOLDEN,
  outcome, milestones, actions, waits, events, payments, paidJobs: [...jobs.values()], completions, saveDifference }, null, 2) + "\n");
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/natural-research-network-journey.ts")) await main();
