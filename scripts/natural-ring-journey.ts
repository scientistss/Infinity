/**
 * Natural ring acceptance, independent of the pre-funded ring fixtures and the
 * natural-growth golden. Run: node --import tsx scripts/natural-ring-journey.ts
 * stdout: one evidence report, including importable saves; stderr: progress.
 * Only createInitialState, player APIs, strict reloads, and one-second live ticks
 * replace the adopted state. No seed search, ticket grant, wallet patch or time jump.
 */
declare const process: {
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
  exitCode?: number;
  env: Record<string, string | undefined>;
};
import { armAutoRunner, equipCard, stopAutoRunner, toggleSlot } from "../src/automation/engine";
import { ARCADE, BOARD } from "../src/data/arcade";
import type { BuildingId } from "../src/data/buildings";
import type { ResearchId } from "../src/data/research";
import { arcadeUnlocked, betUnitDeut, compareRingAmounts, nextBeaconIn, prizeCap, productionMe,
  revealRun, rollOutcome, setBet, topUp, topUpPrice, topUpReason, type PendingRun } from "../src/game/arcade";
import { PRESTIGE_SCORE_UNIT, SAVE_REVISION, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { big, bigFloor, bigSqrt } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, quoteFlight, sendFleet, type FleetRequest } from "../src/game/fleet";
import { distance, npcAt, sameCoordinates } from "../src/game/galaxy";
import { emptyTickLog, evaluatePrestige, expansionScore, prestige, tick } from "../src/game/logic";
import { canEnqueue, enqueue } from "../src/game/queue";
import { canEnqueueResearch, enqueueResearch } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { canBuildUnits, orderUnits } from "../src/game/shipyard";
import { createInitialState } from "../src/game/state";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";

/** Built-in Node modules are loaded dynamically because this repo does not ship @types/node. */
async function sourceMetadata() {
  const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
    import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
  ]);
  const root = new URL("../", import.meta.url);
  const git = (args: string[]): string => String(execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
  })).trimEnd();
  const gitHead = git(["rev-parse", "HEAD"]);
  const sourceSha = process.env.GITHUB_SHA || gitHead;
  check(/^[a-f0-9]{40}$/i.test(sourceSha) && sourceSha === gitHead, "source SHA is invalid or differs from the actual checkout HEAD");
  const scriptPath = "scripts/natural-ring-journey.ts";
  const scriptBytes = readFileSync(new URL("./natural-ring-journey.ts", import.meta.url));
  const scriptSha256 = String(createHash("sha256").update(scriptBytes).digest("hex"));
  const worktreeStatusPorcelain = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const scriptStatusPorcelain = git(["status", "--porcelain=v1", "--untracked-files=all", "--", scriptPath]);
  return { sourceSha, sourceShaOrigin: process.env.GITHUB_SHA ? "GITHUB_SHA" : "git HEAD", gitHead,
    scriptPath, scriptSha256, scriptDirty: scriptStatusPorcelain !== "", scriptStatusPorcelain,
    worktreeDirty: worktreeStatusPorcelain !== "", worktreeStatusPorcelain,
    identityNote: "A dirty or untracked script is identified by its exact SHA-256 plus status; HEAD alone does not identify the complete running source. Generated report files may appear as untracked worktree entries." };
}
let source: Awaited<ReturnType<typeof sourceMetadata>> | null = null;

const WORLD_SEED = 20261010;
const ARCADE_SEED = 20261010;
const SAVE_EPOCH = Date.UTC(2026, 9, 10);
const LIMITS = { totalLiveSeconds: 8 * 60 * 60, bootstrapSeconds: 2 * 60 * 60,
  postCurvatureSeconds: 60 * 60, actions: 240, issuedTickets: 40, topUps: 1, batches: 3 };
let state = createInitialState(WORLD_SEED, ARCADE_SEED);
const homeId = state.activePlanetId;
let elapsed = 0;
let stage = "initial-state";
let curvatureAt: number | null = null;
let lastSaveDifference: unknown = null;
const actions: Array<Record<string, unknown>> = [];
const events: Array<Record<string, unknown>> = [];
const waits: Array<Record<string, unknown>> = [];
const milestones: Array<Record<string, unknown>> = [];
const payments: Array<Record<string, unknown>> = [];
const tickets = new Map<number, Record<string, unknown>>();
const ticketValues = new Map<number, PendingRun>();
const consumed = new Set<number>();
const batches: Array<Record<string, unknown>> = [];
const autoDebits: Array<Record<string, unknown>> = [];
let topUpsPaid = 0;
let bootstrapComplete = false;

class JourneyBlocked extends Error {}
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new JourneyBlocked(`${stage}: ${reason}`);
}
/** Every field and array position counts; object insertion order does not. */
function difference(a: unknown, b: unknown, path = "$state"): unknown | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return { path, before: a, after: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path, before: a, after: b };
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, i) => key !== rightKeys[i])) return { path: `${path}.[keys]`, before: leftKeys, after: rightKeys };
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return { path: `${path}.length`, before: a.length, after: b.length };
  for (const key of Object.keys(left)) {
    const found = difference(left[key], right[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`);
    if (found) return found;
  }
  return null;
}
function same(a: unknown, b: unknown, reason: string): void { check(!difference(a, b), reason); }
function money(resources: ResourceAmounts) {
  return { metal: resources.metal.toString(), crystal: resources.crystal.toString(), deuterium: resources.deuterium.toString() };
}
function wallets(current = state) { return Object.fromEntries(current.planets.map(planet => [planet.id, money(planet.resources)])); }
function ring(current = state) {
  return { seed: current.arcade.seed, nextRunId: current.arcade.nextRunId, runs: current.arcade.runs,
    manualRuns: current.arcade.stats.manualRuns, autoRuns: current.arcade.stats.autoRuns,
    betSpent: current.arcade.stats.betSpent, autoBatch: current.arcade.autoBatch,
    unlocked: current.unlockedCards.includes("auto_runner"), slots: current.protocols.slots };
}
function describe() {
  return { gameSeconds: elapsed, totalTime: state.totalTime.toString(), selectedPlanetId: state.activePlanetId,
    score: expansionScore(state).toString(), lifetime: money(state.lifetime), research: state.research,
    wallets: wallets(), ring: ring(), buildings: state.planets.map(p => ({ planetId: p.id, buildings: p.buildings })),
    nextBeaconIn: Number.isFinite(nextBeaconIn(state)) ? nextBeaconIn(state) : null };
}
function event(kind: string, detail: unknown): void { events.push({ gameSeconds: elapsed, stage, kind, detail }); }
function progress(detail: unknown): void { process.stderr.write(JSON.stringify({ gameSeconds: elapsed, stage, detail }) + "\n"); }

/** Issued identities/outcomes must follow the original saved RNG, without gaps. */
function observe(before: GameState, operation: string): void {
  check(state.universe.seed === WORLD_SEED, "world seed changed");
  check(Math.abs(state.totalTime.toNumber() - elapsed) < 1e-7, "clock differs from counted one-second live ticks");
  check(state.arcade.nextRunId >= before.arcade.nextRunId && state.arcade.nextRunId <= LIMITS.issuedTickets + 1,
    "ticket identity counter moved backwards or exceeded the bound");
  let replay = before.arcade;
  for (let id = before.arcade.nextRunId; id < state.arcade.nextRunId; id += 1) {
    const run = state.arcade.runs.find(value => value.id === id);
    check(run && !tickets.has(id), `issued ticket #${id} is missing, duplicated, or was consumed before observation`);
    check(run.source === "beacon" || run.source === "bonus" || run.source === "topup", "unexpected ticket source");
    if (run.source === "bonus") check(operation === "tick(1,live)" && !before.unlocked.includes("astrophysics_1")
      && state.unlocked.includes("astrophysics_1") && state.research.levels.astrophysics === 1,
    "bonus ticket did not arise from the actual one-time Astrophysics achievement");
    if (run.source === "topup") check(operation === "topUp", "top-up ticket lacks the real paid API operation");
    if (run.source === "beacon") check(operation === "tick(1,live)" || operation === "revealRun(manual)", "beacon ticket has no live-clock/tailwind source");
    const rngBefore = replay.seed;
    const rolled = rollOutcome(replay, run.source === "bonus");
    same(rolled.outcome, run.outcome, `ticket #${id} did not continue the original RNG`);
    replay = rolled.arcade;
    const evidence = { id, source: run.source, outcome: structuredClone(run.outcome), issuedAt: elapsed,
      operation, worldSeed: state.universe.seed, rngBefore,
      rngAfter: replay.seed, manualRunsAtIssue: state.arcade.stats.manualRuns,
      beforeWallets: wallets(before), afterWallets: wallets() };
    tickets.set(id, evidence);
    ticketValues.set(id, structuredClone(run));
    event("natural-ticket-issued", evidence);
  }
  check(state.arcade.seed === replay.seed, "RNG advanced without a real observed ticket issuance");
  same(state.arcade.rollPity, replay.rollPity, "roll pity changed without ticket issuance");
  for (const run of state.arcade.runs) same(ticketValues.get(run.id), run, `pending ticket #${run.id} was rerolled or changed`);
  const removed = before.arcade.runs.filter(run => !state.arcade.runs.some(next => next.id === run.id));
  const manualDelta = state.arcade.stats.manualRuns - before.arcade.stats.manualRuns;
  const autoDelta = state.arcade.stats.autoRuns - before.arcade.stats.autoRuns;
  check(manualDelta >= 0 && autoDelta >= 0 && removed.length === manualDelta + autoDelta,
    "ticket consumption and manual/auto counters disagree");
  check(state.arcade.stats.runs === state.arcade.stats.manualRuns + state.arcade.stats.autoRuns, "total reveal count differs");
  if (removed.length) {
    check((operation === "revealRun(manual)" && manualDelta === 1 && autoDelta === 0)
      || (operation === "tick(1,live)" && autoDelta === 1 && manualDelta === 0), "unobserved or unexpected reveal scheduling");
    same(removed.map(run => run.id), before.arcade.runs.slice(0, removed.length).map(run => run.id), "reveal did not consume the queue prefix");
    for (const run of removed) {
      check(!consumed.has(run.id), `ticket #${run.id} consumed twice`);
      consumed.add(run.id);
      Object.assign(tickets.get(run.id)!, { consumedAt: elapsed, mode: manualDelta ? "manual" : "auto",
        beforeManualRuns: before.arcade.stats.manualRuns, afterManualRuns: state.arcade.stats.manualRuns,
        beforeAutoRuns: before.arcade.stats.autoRuns, afterAutoRuns: state.arcade.stats.autoRuns,
        consumeBeforeWallets: wallets(before), consumeAfterWallets: wallets(),
        history: structuredClone(state.arcade.history.at(-1)) });
    }
    event("ticket-consumed", { operation, ids: removed.map(run => run.id), manualDelta, autoDelta,
      before: ring(before), after: ring(), beforeWallets: wallets(before), afterWallets: wallets() });
    if (autoDelta) auditAutoDebit(before, removed[0]!);
  }
}

/**
 * The isolated one-second auto witness independently accounts for D production,
 * gross bet debit and D prize credits. Frozen bets are metal-only, so jackpot and
 * bet winnings cannot secretly offset the D debit. Other planets only produce.
 */
function auditAutoDebit(before: GameState, run: PendingRun): void {
  const old = before.arcade.autoBatch, current = state.arcade.autoBatch;
  check(old?.armed && current && old.completed < old.ticketIds.length, "auto tick had no remaining finite authority");
  check(old.planetId !== before.activePlanetId && before.activePlanetId === state.activePlanetId,
    "fixed-payer witness did not retain a different selected planet");
  check(old.ticketIds[old.completed] === run.id && current.completed === old.completed + 1, "batch cursor consumed the wrong ticket");
  same(old.ticketIds, current.ticketIds, "batch silently authorized another ticket");
  same(old.bets, current.bets, "frozen batch bets changed");
  same(old.bets, { metal: 1, crystal: 0, deuterium: 0, drifter: 0 }, "D wallet audit requires the explicitly chosen one-metal-bet snapshot");
  check(old.planetId === current.planetId && old.maxDeuterium === current.maxDeuterium, "batch payer or budget changed");
  check(before.research.queue.length === 0 && before.fleets.length === 0 && before.boosters.length === 0
    && before.planets.every(p => p.buildQueue.length === 0 && p.shipyardQueue.length === 0)
    && nextBeaconIn(before) > 1 && before.orders.tasks.length === 0,
  "auto wallet witness encountered a concurrent queue/fleet/booster/order/beacon event");
  const local = selectPlanet(before, old.planetId), eco = economy(local);
  const cost = betUnitDeut(local);
  check(cost > 0 && compareRingAmounts(current.spentDeuterium, String(Number(old.spentDeuterium) + cost)) === 0
    && state.arcade.stats.betSpent - before.arcade.stats.betSpent === cost * 3,
  "gross debit differs from independent source-planet quote or cumulative spending counters");
  check(compareRingAmounts(current.spentDeuterium, current.maxDeuterium) <= 0, "actual gross spend exceeded authorization");
  same(before.unlocked, state.unlocked, "auto witness crossed an achievement-rate change");
  const payer = activePlanet(local);
  let expected = payer.resources.deuterium.add(eco.net.deuterium);
  check(eco.net.deuterium >= 0 && (eco.net.deuterium === 0 || expected.lt(eco.caps.deuterium - eco.caps.deuterium * 1e-12)),
    "auto witness crossed an unaccounted D storage boundary");
  expected = expected.sub(cost);
  const credits: Array<Record<string, unknown>> = [];
  const cap = prizeCap(before), window = productionMe(before) * ARCADE.prizeWindowSeconds;
  for (const light of [run.outcome.main, ...(run.outcome.lucky?.lights ?? [])]) {
    if (BOARD[light.tile] !== "deuterium") continue;
    const tier = light.big ? ARCADE.tiers.big : ARCADE.tiers.normal;
    const value = Math.min(cap * (tier[0]! + (tier[1]! - tier[0]!) * Math.min(1, Math.max(0, light.u))), window);
    const grossPrize = Math.floor(Math.max(0, value / 3));
    const room = Math.floor(Math.max(0, eco.caps.deuterium - expected.toNumber()));
    const credit = Math.min(grossPrize, room);
    expected = expected.add(credit);
    credits.push({ tile: light.tile, grossPrize, storageRoom: room, actualCredit: credit });
  }
  const actual = state.planets.find(p => p.id === old.planetId)!.resources.deuterium;
  check(actual.toString() === expected.toString(), "payer D wallet does not equal exact production minus gross debit plus independently audited D prizes");
  for (const planet of before.planets.filter(p => p.id !== old.planetId)) {
    const otherEco = economy(selectPlanet(before, planet.id));
    const after = state.planets.find(p => p.id === planet.id)!;
    for (const id of RESOURCE_IDS) {
      const projected = planet.resources[id].add(otherEco.net[id]);
      check(otherEco.net[id] >= 0 && (otherEco.net[id] === 0 || projected.lt(otherEco.caps[id] - otherEco.caps[id] * 1e-12)),
        "nonpayer production crossed a storage boundary in the auto witness");
      check(after.resources[id].toString() === projected.toString(), `nonpayer ${planet.id}/${id} paid or received a ring prize`);
    }
  }
  const proof = { gameSeconds: elapsed, ticketId: run.id, source: run.source, payerId: old.planetId,
    selectedPlanetId: before.activePlanetId, quotedGrossDeuterium: cost, productionDeuterium: eco.net.deuterium,
    spentBefore: old.spentDeuterium, spentAfter: current.spentDeuterium, budget: current.maxDeuterium,
    credits, expectedPayerDeuterium: expected.toString(), actualPayerDeuterium: actual.toString(),
    beforeWallets: wallets(before), afterWallets: wallets(), exactWalletEquality: true };
  autoDebits.push(proof); event("exact-fixed-source-gross-debit", proof);
}

function action<T extends { state: GameState; ok: boolean; reason: string }>(api: string, request: unknown, run: () => T): T {
  check(actions.length < LIMITS.actions, "action limit reached");
  const before = state;
  const result = run(); state = result.state;
  actions.push({ index: actions.length + 1, gameSeconds: elapsed, stage, api, request, ok: result.ok, reason: result.reason,
    beforeWallets: wallets(before), afterWallets: wallets() });
  observe(before, api); check(result.ok, `${api}: ${result.reason}`); return result;
}
function stateAction(api: string, request: unknown, run: () => GameState): void {
  action(api, request, () => ({ state: run(), ok: true, reason: "explicit player API" }));
}
function select(planetId: string): void {
  if (state.activePlanetId !== planetId) stateAction("selectPlanet", { planetId }, () => selectPlanet(state, planetId));
}
function oneSecond(): void {
  check(elapsed < LIMITS.totalLiveSeconds, "total live-second limit reached");
  if (!bootstrapComplete) check(elapsed < LIMITS.bootstrapSeconds, "paid bootstrap live-second limit reached");
  if (curvatureAt !== null) check(elapsed - curvatureAt < LIMITS.postCurvatureSeconds, "post-curvature live-second limit reached");
  const before = state, log = emptyTickLog();
  state = tick(state, 1, "live", log); elapsed += 1;
  observe(before, "tick(1,live)");
  if (log.completedBuilds.length || log.completedResearch.length || log.completedUnits.length) event("actual-paid-queue-completion", log);
  for (const saved of milestones) if (saved.subsequentLiveTickObserved === false) {
    saved.subsequentLiveTickObserved = true; saved.firstSubsequentLiveTickAt = elapsed;
  }
  if (elapsed % 1800 === 0) progress({ waiting: true, manualRuns: state.arcade.stats.manualRuns,
    autoRuns: state.arcade.stats.autoRuns, pendingIds: state.arcade.runs.map(run => run.id), nextBeaconIn: nextBeaconIn(state) });
}
function until(label: string, ready: () => boolean, reason: () => string): void {
  const start = elapsed, reasonSeconds: Record<string, number> = {};
  try { while (!ready()) { const why = reason(); reasonSeconds[why] = (reasonSeconds[why] ?? 0) + 1; oneSecond(); } }
  finally { waits.push({ stage, label, startedAt: start, endedAt: elapsed, waitedSeconds: elapsed - start, reasonSeconds }); }
}
function checkpoint(name: string): void {
  const at = SAVE_EPOCH + elapsed * 1000;
  let expected = serializeState(state);
  for (let round = 1; round <= 2; round += 1) {
    const restored = deserializeState(importSave(exportSave(state, at, at)).state);
    const actual = serializeState(restored), mismatch = difference(expected, actual);
    if (mismatch) { lastSaveDifference = { name, round, difference: mismatch }; throw new JourneyBlocked(`${stage}: complete-state strict roundtrip differs at ${JSON.stringify(mismatch)}`); }
    state = restored; expected = actual;
  }
  const saved = { name, gameSeconds: elapsed, strictRoundtrips: 2, stateAdoptedFromReload: true,
    subsequentLiveTickObserved: false, snapshot: describe(), save: JSON.parse(exportSave(state, at, at)) };
  milestones.push(saved); progress({ milestone: name, manualRuns: state.arcade.stats.manualRuns, autoRuns: state.arcade.stats.autoRuns,
    pendingIds: state.arcade.runs.map(run => run.id), batch: state.arcade.autoBatch });
}
function debitProof(before: GameState, paid: ResourceAmounts, label: string): void {
  for (const planet of before.planets) for (const id of RESOURCE_IDS) {
    const expected = planet.resources[id].sub(planet.id === before.activePlanetId ? paid[id] : 0);
    check(state.planets.find(p => p.id === planet.id)!.resources[id].toString() === expected.toString(), `${label}: wrong immediate payer debit ${planet.id}/${id}`);
  }
  payments.push({ label, gameSeconds: elapsed, payerId: before.activePlanetId, paid: money(paid), beforeWallets: wallets(before), afterWallets: wallets() });
}
function build(building: BuildingId, target: number): void {
  select(homeId);
  while (activePlanet(state).buildings[building] < target) {
    check(elapsed < LIMITS.bootstrapSeconds, "economic bootstrap limit reached");
    until(`afford ${building}`, () => canEnqueue(state, building).ok, () => canEnqueue(state, building).reason);
    const quote = canEnqueue(state, building), before = state;
    const result = action("enqueue", { building, targetLevel: quote.targetLevel, source: "manual", cost: money(quote.cost) }, () => enqueue(state, building, "manual"));
    debitProof(before, quote.cost, `building ${building}/${quote.targetLevel} job ${result.jobId}`);
    until(`complete ${building}/${quote.targetLevel}`, () => activePlanet(state).buildings[building] >= quote.targetLevel, () => "real paid building queue");
  }
}
function research(tech: ResearchId, target: number): void {
  while (state.research.levels[tech] < target) {
    check(elapsed < LIMITS.bootstrapSeconds, "research bootstrap limit reached");
    until(`afford ${tech}`, () => canEnqueueResearch(state, tech).ok, () => canEnqueueResearch(state, tech).reason);
    const quote = canEnqueueResearch(state, tech), before = state;
    const result = action("enqueueResearch", { tech, targetLevel: quote.targetLevel, source: "manual", cost: money(quote.cost) }, () => enqueueResearch(state, tech, "manual"));
    debitProof(before, quote.cost, `research ${tech}/${quote.targetLevel} job ${result.jobId}`);
    if (tech === "astrophysics") checkpoint("03-astrophysics-paid-and-in-progress");
    until(`complete ${tech}/${quote.targetLevel}`, () => state.research.levels[tech] >= quote.targetLevel, () => "real paid research queue");
  }
}
function paidTopUp(): void {
  check(topUpsPaid < LIMITS.topUps && topUpReason(state) === "", "top-up unavailable or bounded count exceeded");
  const before = state, price = topUpPrice(state), id = state.arcade.nextRunId;
  action("topUp", { planetId: state.activePlanetId, priceDeuterium: price, expectedTicketId: id }, () => topUp(state));
  debitProof(before, { metal: big(0), crystal: big(0), deuterium: big(price) }, `real top-up ticket #${id}`);
  topUpsPaid += 1;
  same(state.arcade.topUps, [...before.arcade.topUps, elapsed], "top-up did not retain the real paid time");
  check(state.arcade.nextRunId === before.arcade.nextRunId + 1, "one top-up did not issue exactly one ticket");
  check(state.arcade.runs.some(run => run.id === id && run.source === "topup"), "paid top-up did not issue the observed ticket");
  same(before.arcade.stats, state.arcade.stats, "top-up prematurely counted as a reveal");
}
function prepareTickets(count: number): void {
  until(`wait for ${count} actual existing tickets`, () => state.arcade.runs.length >= count,
    () => `natural beacon; pending ${state.arcade.runs.length}/${count}`);
}
function authorize(label: string, count: number): void {
  check(batches.length < LIMITS.batches, "batch authorization limit reached");
  const source = selectPlanet(state, homeId), cost = betUnitDeut(source), budget = String(cost * count);
  check(activePlanet(source).resources.deuterium.gte(budget), "current source wallet cannot fund the explicitly reviewed finite budget");
  check(state.arcade.runs.length >= count, "attempted to authorize future tickets");
  const before = state, request = { planetId: homeId, count, maxDeuterium: budget };
  const prefix = state.arcade.runs.slice(0, count).map(run => run.id);
  action("armAutoRunner", { slotIndex: 0, label, request, currentPrefix: prefix, quotedGrossDeuteriumPerRun: cost }, () => armAutoRunner(state, 0, request));
  same(wallets(before), wallets(), "authorization itself debited a wallet");
  same(before.arcade.runs, state.arcade.runs, "authorization itself consumed or changed tickets");
  same(before.arcade.stats, state.arcade.stats, "authorization itself incremented reveal counters");
  const batch = state.arcade.autoBatch!;
  check(batch.armed && batch.completed === 0 && batch.spentDeuterium === "0", "new authority did not start unused");
  same(batch.ticketIds, prefix, "authorized IDs differ from reviewed current prefix");
  batches.push({ label, gameSeconds: elapsed, request, snapshot: structuredClone(batch) });
}
function noReveal(before: GameState, label: string): void {
  check(Number(state.arcade.stats.manualRuns) === before.arcade.stats.manualRuns && Number(state.arcade.stats.autoRuns) === before.arcade.stats.autoRuns
    && state.arcade.stats.betSpent === before.arcade.stats.betSpent, `${label}: a reveal or wager happened without current authority`);
  for (const run of before.arcade.runs) same(run, state.arcade.runs.find(next => next.id === run.id), `${label}: existing ticket changed`);
}

let outcome: Record<string, unknown>;
try {
  source = await sourceMetadata();
  check(state.planets.length === 1 && activePlanet(state).resources.metal.eq(500) && activePlanet(state).resources.crystal.eq(500)
    && activePlanet(state).resources.deuterium.eq(0) && state.totalTime.eq(0)
    && Object.values(state.research.levels).every(level => level === 0) && Number(state.arcade.runs.length) === 0
    && Number(state.arcade.stats.manualRuns) === 0 && state.arcade.seed === ARCADE_SEED, "not an unmodified real factory start");
  checkpoint("01-true-new-game");
  stage = "natural-paid-economic-and-research-bootstrap";
  const strategy: Array<[BuildingId, number]> = [
    ["solar_plant", 1], ["metal_mine", 2], ["crystal_mine", 1], ["solar_plant", 2],
    ["metal_mine", 3], ["crystal_mine", 2], ["solar_plant", 3], ["metal_mine", 4],
    ["deuterium_synth", 1], ["solar_plant", 4], ["metal_mine", 5], ["crystal_mine", 3],
    ["solar_plant", 5], ["deuterium_synth", 2], ["metal_mine", 6], ["crystal_mine", 4],
    ["solar_plant", 6], ["robotics_factory", 1], ["metal_mine", 7], ["crystal_mine", 5],
    ["solar_plant", 7], ["deuterium_synth", 3], ["robotics_factory", 2], ["metal_mine", 8],
    ["crystal_mine", 6], ["solar_plant", 8], ["metal_storage", 2], ["crystal_storage", 3], ["deuterium_tank", 4],
    ["solar_plant", 9], ["metal_mine", 9], ["crystal_mine", 7], ["deuterium_synth", 4],
    ["solar_plant", 10], ["metal_mine", 10], ["crystal_mine", 8], ["deuterium_synth", 5],
    ["solar_plant", 11], ["metal_mine", 11], ["crystal_mine", 9], ["deuterium_synth", 6],
    ["solar_plant", 12], ["metal_mine", 12], ["crystal_mine", 10], ["deuterium_synth", 7],
    ["solar_plant", 14], ["research_lab", 3], ["shipyard", 4],
  ];
  for (const [building, target] of strategy) build(building, target);
  checkpoint("02-naturally-paid-infrastructure");
  research("energy_tech", 1); research("combustion_drive", 2); research("impulse_drive", 3);
  research("espionage_tech", 4); research("astrophysics", 1);
  check(arcadeUnlocked(state) && Number(state.arcade.runs.length) === 1 && state.arcade.runs[0]!.source === "bonus"
    && state.arcade.runs[0]!.outcome.main.big && Number(state.arcade.stats.manualRuns) === 0, "real Astrophysics completion did not grant exactly the opening bonus");
  checkpoint("04-ring-naturally-unlocked-with-achievement-ticket");

  stage = "real-colony-for-fixed-source-witness";
  until("afford colony ship", () => canBuildUnits(state, "colony_ship", 1).ok, () => canBuildUnits(state, "colony_ship", 1).reason);
  const shipQuote = canBuildUnits(state, "colony_ship", 1), beforeShip = state;
  action("orderUnits", { unit: "colony_ship", count: 1, source: "manual", cost: money(shipQuote.cost) }, () => orderUnits(state, "colony_ship", 1, "manual"));
  debitProof(beforeShip, shipQuote.cost, "naturally paid colony ship");
  until("complete actual colony ship", () => activePlanet(state).units.colony_ship >= 1, () => "real paid shipyard queue");
  const home = activePlanet(state);
  const target = Array.from({ length: 15 }, (_, i) => ({ ...home.coordinates, position: i + 1 }))
    .filter(c => !sameCoordinates(c, home.coordinates) && !npcAt(state, c))
    .sort((a, b) => distance(home.coordinates, a) - distance(home.coordinates, b) || a.position - b.position)[0];
  check(target, "no naturally colonizable nearby position");
  const flight: FleetRequest = { mission: "colonize", target, ships: { colony_ship: 1 }, cargo: emptyCargo(), speedPercent: 100 };
  until("afford actual colonization fuel", () => quoteFlight(state, flight).ok, () => quoteFlight(state, flight).reason);
  const quote = quoteFlight(state, flight), beforeFlight = state;
  const launch = action("sendFleet", { ...flight, fuel: quote.fuel.toString() }, () => sendFleet(state, flight));
  debitProof(beforeFlight, { metal: big(0), crystal: big(0), deuterium: quote.fuel }, "actual colonization fuel");
  until("establish colony by actual flight arrival", () => state.planets.length === 2, () => "real colony ship flight");
  const colonyId = state.planets.find(p => p.id !== homeId)!.id;
  check(colonyId === `colony-${launch.fleetId}` && state.fleets.length === 0
    && state.planets.find(p => p.id === colonyId)!.resources.deuterium.eq(0), "colony or zero-D nonpayer was not established naturally");
  checkpoint("05-real-colony-established");
  bootstrapComplete = true;

  stage = "natural-tickets-to-nine-manual-reveals";
  while (state.arcade.stats.manualRuns < 9) {
    if (topUpsPaid < LIMITS.topUps && topUpReason(state) === "") paidTopUp();
    if (Number(state.arcade.runs.length) === 0) {
      until("next natural beacon or affordable real top-up", () => state.arcade.runs.length > 0 || (topUpsPaid < LIMITS.topUps && topUpReason(state) === ""),
        () => "waiting for an actual beacon or naturally funded bounded top-up");
      if (Number(state.arcade.runs.length) === 0) paidTopUp();
    }
    const next = state.arcade.runs[0]!;
    action("revealRun(manual)", { ticketId: next.id, source: next.source, expectedManualCount: state.arcade.stats.manualRuns + 1 }, () => revealRun(state, "manual"));
    oneSecond();
    check(!state.unlockedCards.includes("auto_runner"), "auto runner unlocked before ten manual reveals");
  }
  check(topUpsPaid === 1, "route did not actually pay its one bounded natural top-up");
  prepareTickets(1);
  check(Number(state.arcade.stats.manualRuns) === 9 && !state.unlockedCards.includes("auto_runner"), "ninth-reveal boundary is not locked");
  checkpoint("06-nine-manual-locked-with-tenth-ticket-ready");
  stage = "tenth-manual-reveal-and-safe-default";
  action("revealRun(manual)", { ticketId: state.arcade.runs[0]!.id, expectedManualCount: 10 }, () => revealRun(state, "manual"));
  oneSecond();
  check(Number(state.arcade.stats.manualRuns) === 10 && state.unlockedCards.includes("auto_runner") && Number(state.arcade.stats.autoRuns) === 0, "tenth manual reveal did not unlock the card naturally");
  checkpoint("07-ten-manual-card-unlocked");
  const equipped = equipCard(state, 0, "auto_runner");
  stateAction("equipCard", { slot: 0, cardId: "auto_runner", status: equipped.status }, () => equipped.state);
  check(state.protocols.slots[0]!.card?.id === "auto_runner" && !state.protocols.slots[0]!.card?.enabled && !state.arcade.autoBatch?.armed,
    "newly equipped auto runner did not default to off without spending authority");
  prepareTickets(3);
  action("setBet", { symbol: "metal", units: 1 }, () => setBet(state, "metal", 1));
  checkpoint("08-equipped-off-current-three-tickets");
  const beforeToggle = state;
  stateAction("toggleSlot", { slot: 0, enabled: true }, () => toggleSlot(state, 0, true));
  check(!state.arcade.autoBatch?.armed, "plain switch created authority");
  same(wallets(beforeToggle), wallets(), "plain switch itself spent resources");
  same(beforeToggle.arcade.runs, state.arcade.runs, "plain switch itself changed pending tickets");
  oneSecond(); noReveal(beforeToggle, "plain enable followed by real engine tick");
  check(beforeToggle.planets.every(planet => RESOURCE_IDS.every(id => economy(selectPlanet(beforeToggle, planet.id)).net[id] === 0)),
    "unarmed-switch wallet witness no longer has naturally saturated or zero-rate wallets");
  same(wallets(beforeToggle), wallets(), "unarmed engine attempt debited a saturated/zero-rate wallet");
  check(!state.protocols.slots[0]!.card?.enabled, "unarmed attempted engine execution did not disable the slot");
  checkpoint("09-toggle-alone-cannot-spend");

  stage = "finite-existing-prefix-and-strict-reload-continuation";
  authorize("A-complete-only-two-existing-tickets", 2);
  select(colonyId);
  checkpoint("10-armed-two-existing-tickets-fixed-home-source");
  oneSecond();
  check(state.arcade.autoBatch?.armed && Number(state.arcade.autoBatch.completed) === 1, "first genuine auto engine tick did not leave exactly one authorized ticket");
  const remaining = structuredClone(state.arcade.autoBatch);
  checkpoint("11-armed-one-remaining-strict-save-reload");
  same(state.arcade.autoBatch, remaining, "reload changed remaining batch identity or spending cursor");
  oneSecond();
  check(Number(state.arcade.autoBatch?.completed) === 2 && !state.arcade.autoBatch.armed
    && Number(state.arcade.stats.autoRuns) === 2 && !state.protocols.slots[0]!.card?.enabled, "batch did not stop at the authorized prefix");
  const completedBatch = structuredClone(state.arcade.autoBatch), afterCompleted = state;
  const nextFutureId = state.arcade.nextRunId;
  until("observe future natural beacon outside completed authority", () => state.arcade.nextRunId > nextFutureId,
    () => "new natural ticket cannot extend the completed two-ticket authorization");
  noReveal(afterCompleted, "future ticket after completed finite prefix");
  same(state.arcade.autoBatch, completedBatch, "future ticket changed or extended completed authority");
  check(state.arcade.runs.some(run => run.id >= nextFutureId && !completedBatch.ticketIds.includes(run.id)), "no outside-prefix future ticket observed");
  checkpoint("12-completed-prefix-future-ticket-not-consumed");

  stage = "explicit-stop-retires-current-authority";
  prepareTickets(2); authorize("B-explicit-stop-before-any-spend", 2);
  checkpoint("13-armed-before-explicit-stop");
  const beforeStop = state;
  stateAction("stopAutoRunner", {}, () => stopAutoRunner(state));
  noReveal(beforeStop, "explicit stop"); same(wallets(beforeStop), wallets(), "stop debited a wallet");
  check(state.arcade.autoBatch && !state.arcade.autoBatch.armed && Number(state.arcade.autoBatch.completed) === 0
    && !state.protocols.slots[0]!.card?.enabled, "stop left authority or its slot enabled");
  const stopped = structuredClone(state.arcade.autoBatch);
  checkpoint("14-stopped-unspent-existing-tickets");
  stateAction("toggleSlot", { slot: 0, enabled: true }, () => toggleSlot(state, 0, true));
  oneSecond(); oneSecond();
  noReveal(beforeStop, "plain re-enable after explicit stop");
  same(stopped, state.arcade.autoBatch, "plain re-enable restored or changed stopped authority");
  check(!state.protocols.slots[0]!.card?.enabled, "retired authority allowed the slot to stay enabled after evaluation");

  stage = "natural-curvature-with-remaining-authority";
  until("legal curvature threshold from actual lifetime production", () => evaluatePrestige(state).gain.gte(1), () => "naturally accumulated lifetime-production score");
  authorize("C-curvature-with-one-authorized-ticket-remaining", 2);
  oneSecond();
  check(state.arcade.autoBatch?.armed && Number(state.arcade.autoBatch.completed) === 1
    && state.arcade.autoBatch.ticketIds.length === 2 && state.protocols.slots[0]!.card?.enabled, "curvature witness lacks genuinely remaining enabled authority");
  checkpoint("15-before-curvature-active-batch-one-remaining");
  const beforeCurvature = state, beforeSave = serializeState(state), preview = evaluatePrestige(state);
  const gain = bigFloor(bigSqrt(expansionScore(state).div(PRESTIGE_SCORE_UNIT)));
  check(gain.gte(1) && preview.gain.eq(gain), "curvature did not meet the real production-score rule");
  same(beforeSave, serializeState(state), "curvature evaluation mutated its input");
  stateAction("prestige", { reviewedGain: gain.toString(), remainingBatch: state.arcade.autoBatch }, () => prestige(state));
  same(serializeState(preview.next), serializeState(state), "actual reset differs from the complete evaluated candidate");
  same(beforeSave, serializeState(beforeCurvature), "reset mutated its previous world");
  curvatureAt = elapsed;
  check(state.stats.launches === 1 && state.warpCores.eq(beforeCurvature.warpCores.add(gain)) && state.totalTime.eq(elapsed), "reset payout or clock differs");
  check(state.planets.length === 1 && state.planets[0]!.id === homeId && !state.planets.some(p => p.id === colonyId)
    && activePlanet(state).resources.metal.eq(500) && activePlanet(state).resources.crystal.eq(500)
    && activePlanet(state).resources.deuterium.eq(0) && Object.values(activePlanet(state).buildings).every(value => value === 0), "reset did not produce the rule-defined new world");
  same(beforeCurvature.research.levels, state.research.levels, "reset removed retained research");
  same(beforeCurvature.arcade.runs, state.arcade.runs, "reset lost or rerolled remaining tickets");
  same(beforeCurvature.arcade.stats, state.arcade.stats, "reset changed retained ring progress");
  check(Number(state.arcade.stats.manualRuns) === 10 && state.unlockedCards.includes("auto_runner")
    && state.arcade.autoBatch && !state.arcade.autoBatch.armed
    && state.arcade.autoBatch.stopReason === "重置后需要重新授权自动批次"
    && state.protocols.slots.every(slot => slot.card?.action.kind !== "runLights" || !slot.card.enabled), "reset did not preserve unlock while disabling all ring authority");
  same({ ...beforeCurvature.arcade.autoBatch, armed: false, stopReason: state.arcade.autoBatch.stopReason }, state.arcade.autoBatch,
    "reset changed old batch identity, budget, bets, spend or cursor instead of only retiring it");
  checkpoint("16-after-curvature-old-batch-and-slot-disabled");
  const retired = structuredClone(state.arcade.autoBatch), resetState = state, postResetNextId = state.arcade.nextRunId;
  until("post-curvature naturally issued beacon", () => state.arcade.nextRunId > postResetNextId,
    () => "real retained Astrophysics beacon; old authority must stay retired");
  noReveal(resetState, "post-curvature natural beacon");
  same(retired, state.arcade.autoBatch, "post-curvature beacon reactivated or modified old authority");
  check(state.arcade.runs.some(run => run.id >= postResetNextId && run.source === "beacon")
    && state.protocols.slots.every(slot => slot.card?.action.kind !== "runLights" || !slot.card.enabled), "post-reset beacon did not preserve safe disabled defaults");
  stateAction("toggleSlot", { slot: 0, enabled: true }, () => toggleSlot(state, 0, true));
  oneSecond(); noReveal(resetState, "plain toggle after curvature and a new beacon");
  same(retired, state.arcade.autoBatch, "post-reset toggle renewed retired spending authority");
  check(!state.protocols.slots[0]!.card?.enabled, "post-reset unarmed slot did not disable after its engine attempt");
  checkpoint("17-post-curvature-natural-beacon-cannot-resume-old-authority");
  for (let id = 1; id < state.arcade.nextRunId; id += 1) check(tickets.has(id), `missing issued-ticket evidence #${id}`);
  check(consumed.size === state.arcade.stats.runs && Number(state.arcade.stats.manualRuns) === 10
    && Number(state.arcade.stats.autoRuns) === 3 && autoDebits.length === 3 && batches.length === 3,
  "final reveal, authority or exact debit proof counts differ");
  outcome = { status: "passed", gameSeconds: elapsed, gameHours: elapsed / 3600, curvatureAt,
    curvatureGain: gain.toString(), issuedTickets: tickets.size, manualReveals: 10, autoReveals: 3,
    paidTopUps: topUpsPaid, finiteBatches: batches.length, exactAutoWalletAudits: autoDebits.length,
    milestones: milestones.length, wholeStateStrictRoundtrips: milestones.length * 2,
    continuedAfterReload: milestones.filter(value => value.subsequentLiveTickObserved).length };
  progress(outcome);
} catch (error) {
  process.exitCode = 1;
  outcome = { status: "blocked", stage, gameSeconds: elapsed, reason: error instanceof Error ? error.message : String(error),
    unexpectedError: !(error instanceof JourneyBlocked), lastPassedMilestone: milestones.at(-1)?.name ?? null,
    lastSaveDifference, current: describe() };
  progress(outcome);
}
process.stdout.write(JSON.stringify({ schema: "infinity-natural-ring-journey-v1", sourceSha: source?.sourceSha ?? null, source, saveVersion: SAVE_VERSION,
  saveRevision: SAVE_REVISION, storageKey: STORAGE_KEY, seeds: { world: WORLD_SEED, arcade: ARCADE_SEED },
  provenance: { factory: "createInitialState(20261010, 20261010)", startingResources: { metal: "500", crystal: "500", deuterium: "0" },
    injectedGameState: false, seedSearch: false, clock: "only tick(state, 1, live); no offline tick, tick(0), or direct clock mutation",
    strategy: "bounded serial paid infrastructure/research, actual colonization, one real paid top-up, natural beacons, ten manual reveals, three finite batch requests, one legal curvature reset",
    rewards: "Actual pre-rolled fixed-seed ring prizes apply normally; they are disclosed in per-ticket wallet/history evidence, never selected or injected",
    rngAudit: "Pure rollOutcome replay verifies each issued outcome and next seed; it never grants a ticket or replaces adopted state",
    saveClock: "Fixed envelope metadata epoch plus counted live seconds only. Align browser clock on import to exclude unrelated offline catch-up.",
    browserClaim: "Time-compressed domain execution; native UI imports are separate handoffs, not continuous real-time human/browser play" },
  limits: LIMITS, outcome, milestones, actions, events, waits, payments, tickets: [...tickets.values()], batches, autoDebits,
}, null, 2) + "\n");
