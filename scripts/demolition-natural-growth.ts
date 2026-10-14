/** Natural ordinary demolition A from the immutable green r10 IRN serializer.
 * node --import tsx scripts/demolition-natural-growth.ts --report FILE \
 *   --expected-report-sha256 HASH --source-sha ac3cce98403bea1e7162bcb4092e4cfeeb448a9a
 * CI: --origin tests/fixtures/demolition-origin-provenance.json --expected-origin-sha256 HASH
 * Only documented player APIs, strict actual reloads and ordinary tick(1,'live').
 * This compressed engine execution is not native browser or continuous human play.
 */
declare const process: { argv: string[]; env: Record<string, string | undefined>; stdout: { write(value: string): void }; stderr: { write(value: string): void }; exitCode?: number };
import { captureAdoptedSteps } from "./capture-adopted-steps.mjs";
let independentlyExpectedNpcWallet = expectedNpcEconomy(), independentlyExpectedControlWallet = expectedNpcEconomy();
const npcAdoptedSegmentsSeconds: number[] = [];
import { expectedNpcEconomy, advanceExpectedNpcWallet, assertNpcEconomy } from "./r16-compatibility.mjs";
import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION } from "../src/game/content";
import { quoteDemolition, commitDemolition, cancelDemolition } from "../src/game/demolition";
import type { DemolitionJobRef } from "../src/game/demolition-state";
import { economy } from "../src/game/economy";
import { selectPlanet } from "../src/game/empire";
import { emptyTickLog, tick } from "../src/game/logic";
import { usedFields } from "../src/game/planet";
import { canEnqueue, enqueue } from "../src/game/queue";
import { researchNetworkView } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { RESOURCE_IDS, type GameState, type ResourceAmounts } from "../src/game/types";
import { DEMOLITION_GOLDEN as GOLD, exactEvidence as exact, requireEvidence as check, projectR14ZeroToR10 } from "./demolition-fixture";

const HOME = GOLD.homeId, COLONY = GOLD.colonyId;
const startedAt = new Date().toISOString(), hostStarted = performance.now();
let state!: GameState, control!: GameState, initial!: ReturnType<typeof serializeState>;
let stage = "verify-origin", elapsed = 0, originAt = 0, source: Record<string, unknown> = {}, origin: Record<string, unknown> = {};
let originalFinalSnapshot: unknown = null, initialOriginalContinuation = 0, ready = false;
let grossPaid = 0, refunded = 0, expectedManualActions = 0;
const produced = { metal: 0, crystal: 0, deuterium: 0 };
const milestones: Array<Record<string, unknown>> = [], events: Array<Record<string, unknown>> = [], actions: Array<Record<string, unknown>> = [];
const money = (value: ResourceAmounts) => ({ metal: value.metal.toString(), crystal: value.crystal.toString(), deuterium: value.deuterium.toString() });
const home = (s = state) => { const p = s.planets.find(p => p.id === HOME); check(p, "Actual home planet missing"); return p; };
const nearWallet = (actual: number, expected: number, label: string) => check(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= GOLD.walletAbsoluteTolerance, `${label}: ${actual} != ${expected}; wallet-only absolute tolerance=${GOLD.walletAbsoluteTolerance}`);
const zero = { metal: "0", crystal: "0", deuterium: "0" };
function snapshot(s = state, legacy = false) {
  return { gameSeconds: Number(s.totalTime.toString()), continuationSeconds: legacy ? initialOriginalContinuation + elapsed : elapsed,
    totalTime: s.totalTime.toString(), activePlanetId: s.activePlanetId,
    wallets: Object.fromEntries(s.planets.map(p => [p.id, money(p.resources)])),
    fields: s.planets.map(p => ({ planetId: p.id, fieldsMax: p.fieldsMax, base: p.terraformerFields.base, grantedLevels: p.terraformerFields.grantedLevels,
      terraformer: p.buildings.terraformer, usedFields: usedFields(p), freeFields: p.fieldsMax - usedFields(p) })),
    grantJobFloor: s.terraformerGrantJobFloor, research: serializeState(s).research, orders: serializeState(s).orders,
    computerNetwork: researchNetworkView(s, "computer_tech", HOME), irnNetwork: researchNetworkView(s, "intergalactic_research_network", HOME),
    planets: s.planets.map(p => ({ id: p.id, buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, economy: economy(selectPlanet(s, p.id)) })) };
}
function observe() {
  if (!ready) return;
  assertNpcEconomy(state, independentlyExpectedNpcWallet, `${stage}: original second plus independently counted adopted live seconds`);
  assertNpcEconomy(control, independentlyExpectedControlWallet, `${stage}: independently counted no-demolition control age`);
  const now = serializeState(state), expected = serializeState(control);
  check(state.totalTime.toNumber() === GOLD.originGameSeconds + elapsed, "Only counted actual live seconds advance game time");
  // Full independent no-demolition trajectory retains RNG, all histories, terminal
  // plans, fleets, templates and every unlisted state field. Only audited effects
  // below are transplanted; there is no blanket unknown-field projection.
  expected.activePlanetId = now.activePlanetId;
  expected.orders.nextJobId = 202 + (grossPaid === 0 ? 0 : grossPaid < 256000 ? 1 : grossPaid < 512000 ? 2 : 3);
  expected.stats.manualActions = expectedManualActions;
  expected.stats.buildsCompleted = initial.stats.buildsCompleted + (elapsed >= 44 ? 1 : 0);
  for (const resource of RESOURCE_IDS) {
    const net = resource === "metal" ? grossPaid - refunded : 0;
    nearWallet(Number(home().resources[resource].toString()), Number(GOLD.originWallet[resource]) + produced[resource] - net, `${stage}: cumulative ${resource} wallet ledger`);
    nearWallet(Number(state.lifetime[resource].toString()), Number(initial.lifetime[resource]) + produced[resource], `${stage}: lifetime increases only by actual ${resource} production`);
    expected.lifetime[resource] = now.lifetime[resource];
  }
  for (let index = 0; index < now.planets.length; index++) {
    const p = now.planets[index]!, target = expected.planets[index]!;
    if (p.id !== HOME) continue;
    target.resources = p.resources;
    target.buildings.metal_storage = p.buildings.metal_storage;
    target.buildQueue = p.buildQueue;
    target.demolition = p.demolition;
  }
  exact(now, expected, `${stage}: complete state outside independently audited intended changes`);
  const p = home(), eco = economy(selectPlanet(state, HOME));
  check(p.fieldsMax === GOLD.totalFields && state.terraformerGrantJobFloor === GOLD.grantFloor && p.terraformerFields.base === 163 && p.terraformerFields.grantedLevels === 2,
    "Demolition never changes old field base/grants/total/payment floor");
  check(usedFields(p) === (p.buildings.metal_storage === 8 ? GOLD.used8 : GOLD.used9), "Exactly one occupied field follows real warehouse level");
  check(eco.caps.metal === (p.buildings.metal_storage === 8 ? GOLD.cap8 : GOLD.cap9), "Actual warehouse capacity follows exact independent level golden");
  check(state.orders.tasks.every(t => t.status === "completed" || t.status === "cancelled") && state.protocols.slots.every(s => s.card === null), "Natural route must not restart plans or install protocols");
}
function checkpoint(name: string) {
  stage = name;
  const at = originAt + elapsed * 1000;
  for (let round = 1; round <= 2; round++) {
    const before = serializeState(state), save = importSave(exportSave(state, at, at));
    exact(save.state, before, `${name}: serializer preserves every state field, round ${round}`);
    state = deserializeState(save.state); exact(serializeState(state), before, `${name}: reload adopted unchanged full world, round ${round}`);
  }
  observe();
  milestones.push({ name, gameSeconds: GOLD.originGameSeconds + elapsed, continuationSeconds: elapsed, npcAdoptedSegmentsSeconds:[...npcAdoptedSegmentsSeconds], strictRoundtrips: 2, stateAdoptedFromReload: true,
    subsequentLiveTickObserved: false, snapshot: snapshot(), save: importSave(exportSave(state, at, at)) });
  process.stderr.write(JSON.stringify({ stage, elapsed, wallet: money(home().resources), level: home().buildings.metal_storage, jobId: home().demolition?.jobId ?? home().buildQueue[0]?.jobId ?? null }) + "\n");
}
function action(name: string, execute: () => { ok: boolean; reason: string; state: GameState }) {
  const before = serializeState(state), result = execute(); check(result.ok, `${name}: ${result.reason}`); state = result.state;
  actions.push({ name, continuationSeconds: elapsed, actualGameSeconds: state.totalTime.toString(), before, after: serializeState(state) });
}
function transfer(before: GameState, after: GameState, expected: typeof GOLD.paid | typeof GOLD.rebuildPaid, direction: -1 | 1) {
  for (const p of before.planets) {
    const afterPlanet = after.planets.find(x => x.id === p.id)!;
    for (const r of RESOURCE_IDS) {
      const amount = p.id === HOME ? Number(expected[r]) : 0;
      nearWallet(afterPlanet.resources[r].toNumber(), p.resources[r].toNumber() + direction * amount, `Immediate all-resource ${direction === -1 ? "debit" : "refund"} ${p.id}/${r}`);
      if (amount > 0) check(direction === -1 ? afterPlanet.resources[r].lt(p.resources[r]) : afterPlanet.resources[r].gt(p.resources[r]), "Every positive transfer has actual correct direction");
      if (amount === 0) check(afterPlanet.resources[r].eq(p.resources[r]), "Zero fee never moves resource");
    }
  }
  exact(serializeState(after).lifetime, serializeState(before).lifetime, "Payment/refund creates no production lifetime");
}
function pay(expectedJobId: number) {
  const preview = quoteDemolition(state, "metal_storage"); check(preview.ok && preview.quote, `Natural quote rejected: ${preview.reason}`);
  const quote = preview.quote;
  check(quote.planetId === HOME && quote.building === "metal_storage" && quote.fromLevel === 9 && quote.toLevel === 8, "Independent demolition target/planet golden");
  exact(money(quote.paid), GOLD.paid, "Independent strict integer demolition fee");
  check(quote.totalSeconds === GOLD.demolitionSeconds && quote.currentCaps.metal === GOLD.cap9 && quote.nextCaps.metal === GOLD.cap8,
    "Independent exact duration/current/new capacity quote");
  const before = state; action("explicit manual demolition confirmation", () => commitDemolition(state, quote)); grossPaid += 128000; expectedManualActions++;
  const job = home().demolition; check(job && job.kind === "demolition" && job.jobId === expectedJobId && job.source === "manual" && job.taskId === null && job.fromLevel === 9 && job.toLevel === 8
    && job.totalSeconds === GOLD.demolitionSeconds && job.remainingSeconds === GOLD.demolitionSeconds, "Fixed paid job identity and exact timer");
  exact(money(job.paid), GOLD.paid, "Actual paid integer snapshot"); transfer(before, state, GOLD.paid, -1);
  const ordinary = canEnqueue(state, "metal_storage"); check(!ordinary.ok && !ordinary.onlyResources, "Live demolition structurally interlocks original build payment");
  observe();
}
function oneSecond() {
  check(elapsed < 45, "Approved 45-second natural journey bound exceeded");
  const before = state, oldHome = home(before), oldCap = oldHome.buildings.metal_storage === 9 ? GOLD.cap9 : GOLD.cap8;
  const job = oldHome.demolition, build = oldHome.buildQueue[0];
  const boundary = job && job.remainingSeconds <= 1 ? job.remainingSeconds : build && build.remainingSeconds <= 1 ? build.remainingSeconds : 1;
  const newCap = job && boundary < 1 ? GOLD.cap8 : build && boundary < 1 ? GOLD.cap9 : oldCap;
  const metalBefore = oldHome.resources.metal.toNumber();
  const first = Math.min(GOLD.grossPerSecond.metal * boundary, Math.max(0, oldCap - metalBefore));
  const second = Math.min(GOLD.grossPerSecond.metal * (1 - boundary), Math.max(0, newCap - metalBefore - first));
  produced.metal += first + second; produced.crystal += GOLD.grossPerSecond.crystal; produced.deuterium += GOLD.grossPerSecond.deuterium;
  const log = emptyTickLog(); let calls=0;
  const witnessed=captureAdoptedSteps(state,value=>({state:tick(value,1,"live",calls++ === 0 ? log : emptyTickLog())}),serializeState);
  const controlWitness=captureAdoptedSteps(control,value=>({state:tick(value,1,"live")}),serializeState);
  state=witnessed.result.state;control=controlWitness.result.state;
  npcAdoptedSegmentsSeconds.push(...witnessed.adoptedSegmentsSeconds);
  independentlyExpectedNpcWallet=advanceExpectedNpcWallet(independentlyExpectedNpcWallet,witnessed.adoptedSegmentsSeconds);
  independentlyExpectedControlWallet=advanceExpectedNpcWallet(independentlyExpectedControlWallet,controlWitness.adoptedSegmentsSeconds);elapsed++;
  if (oldHome.buildings.metal_storage !== home().buildings.metal_storage) events.push({ kind: job ? "real-demolition-completion-boundary" : "real-ordinary-rebuild-completion-boundary", jobId: job?.jobId ?? build!.jobId,
    continuationSecondBefore: elapsed - 1, eventOffsetInTick: boundary, fromLevel: oldHome.buildings.metal_storage, toLevel: home().buildings.metal_storage,
    before: serializeState(before), after: serializeState(state), independentProduction: { metalBeforeBoundary: first, metalAfterBoundary: second }, log });
  observe();
  for (const milestone of milestones) if (!milestone.subsequentLiveTickObserved) { milestone.subsequentLiveTickObserved = true; milestone.firstSubsequentLiveTickAt = GOLD.originGameSeconds + elapsed; }
}
async function loadOrigin() {
  const [{ readFileSync }, { createHash }, { execFileSync }, { dirname, join }] = await Promise.all([import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string), import("node:path" as string)]);
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1]; check(key && ["--report", "--expected-report-sha256", "--source-sha", "--origin", "--expected-origin-sha256"].includes(key) && value && !args.has(key), "Require explicit report path, independent byte hash and prior source SHA"); args.set(key, value);
  }
  const slicedOrigin = args.has("--origin");
  check(slicedOrigin ? args.size === 2 && args.get("--expected-origin-sha256") === GOLD.originMetadataSha256
    : args.size === 3 && args.get("--source-sha") === GOLD.sourceSha && args.get("--expected-report-sha256") === GOLD.sourceReportSha256, "Natural origin must be exact reviewed green ac3 report or its byte-exact save slice, never a reconstructed final snapshot");
  const git = (a: string[]) => String(execFileSync("git", a, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
  const head = git(["rev-parse", "HEAD"]);
  source = { sourceSha: head, gitHead: head, scriptPath: "scripts/demolition-natural-growth.ts", scriptSha256: String(createHash("sha256").update(readFileSync(new URL("./demolition-natural-growth.ts", import.meta.url))).digest("hex")),
    worktreeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all"]),
    sourceScopeStatusPorcelain: git(["status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github"]),
    identityNote: "Local dirty output is preparation only. Formal native fixture requires exact clean candidate source. CI/deployment are separate gates." };
  check(!process.env.GITHUB_SHA || process.env.GITHUB_SHA === head, "GITHUB_SHA differs from actual checkout");
  let report: any, rawOrigin = "", sliceMetadata: unknown = null;
  const hash = GOLD.sourceReportSha256;
  if (slicedOrigin) {
    const path = args.get("--origin")!, bytes = readFileSync(path);
    check(String(createHash("sha256").update(bytes).digest("hex")) === GOLD.originMetadataSha256, "Pinned original-envelope provenance bytes changed");
    const meta = JSON.parse(String(bytes));
    check(meta.schema === "infinity-demolition-original-envelope-v1" && meta.sourceReport.sha256 === GOLD.sourceReportSha256 && meta.saveSha256 === GOLD.originalSaveSha256 && meta.saveFile === "demolition-origin-r10-save.json", "Original-envelope extraction binding invalid");
    const rawBytes = readFileSync(join(dirname(path), meta.saveFile));
    check(rawBytes.length === meta.saveBytes && String(createHash("sha256").update(rawBytes).digest("hex")) === GOLD.originalSaveSha256, "Unchanged r10 serializer byte-slice mismatch");
    rawOrigin = String(rawBytes); sliceMetadata = meta;
    report = { schema: "infinity-natural-research-network-journey-v1", source: meta.source, outcome: meta.originalOutcome,
      provenance: meta.originalProvenance, milestones: [{ ...meta.originalMilestone, save: JSON.parse(rawOrigin) }] };
  } else {
    const bytes = readFileSync(args.get("--report")); check(String(createHash("sha256").update(bytes).digest("hex")) === GOLD.sourceReportSha256, "Raw prior report hash mismatch");
    report = JSON.parse(String(bytes));
    // The separately pinned literal slice remains the native file input even
    // when the full independently identified report is available for review.
    const rawBytes = readFileSync(new URL("../tests/fixtures/demolition-origin-r10-save.json", import.meta.url));
    check(String(createHash("sha256").update(rawBytes).digest("hex")) === GOLD.originalSaveSha256, "Original serializer slice changed"); rawOrigin = String(rawBytes);
  }
  check(report.schema === "infinity-natural-research-network-journey-v1" && report.outcome.status === "passed" && report.source.sourceSha === GOLD.sourceSha && report.source.gitHead === GOLD.sourceSha && report.source.worktreeStatusPorcelain === "" && report.source.sourceScopeStatusPorcelain === "", "Prior source/report did not pass exact clean origin contract");
  const matches = report.milestones.filter((m: { name: string }) => m.name === GOLD.sourceMilestone); check(matches.length === 1, "Exact final serializer milestone missing/duplicated"); const m = matches[0];
  check(m.gameSeconds === GOLD.sourceGameSeconds && m.strictRoundtrips === 2 && m.stateAdoptedFromReload && m.subsequentLiveTickObserved && m.firstSubsequentLiveTickAt === GOLD.originGameSeconds && m.save.schema === SAVE_SCHEMA && m.save.version === SAVE_VERSION && m.save.revision === 10 && SAVE_REVISION === 16 && m.save.savedAt === m.save.lastTickAt, "Original actual r10 serializer/reload/live-tick chain is incomplete");
  exact(JSON.parse(rawOrigin), m.save, "Literal original serializer bytes equal exact prior complete milestone save");
  const migrated = importSave(rawOrigin); projectR14ZeroToR10(migrated.state, m.save.state);
  exact({ ...migrated, revision: 10, state: m.save.state }, m.save, "Only revision, exact zero NPC age and null fields added; original envelope clocks preserved");
  state = deserializeState(migrated.state); exact(serializeState(state), migrated.state, "Full migrated original state is strict-readable");
  initialOriginalContinuation = m.continuationSeconds + 1; originalFinalSnapshot = report.outcome.finalSnapshot;
  const firstWitness=captureAdoptedSteps(state,value=>({state:tick(value,1,"live")}),serializeState);
  state=firstWitness.result.state;npcAdoptedSegmentsSeconds.push(...firstWitness.adoptedSegmentsSeconds);
  independentlyExpectedNpcWallet=expectedNpcEconomy(npcAdoptedSegmentsSeconds);independentlyExpectedControlWallet=structuredClone(independentlyExpectedNpcWallet);
  assertNpcEconomy(state, independentlyExpectedNpcWallet, "first actual original live tick advances migrated zero NPC age once");
  exact(snapshot(state, true), originalFinalSnapshot, "One actual original live tick recreates entire prior recorded final snapshot");
  check(state.activePlanetId === COLONY && Number(state.orders.nextJobId) === 202 && state.orders.nextTaskId === 17 && state.orders.nextWorkId === 3 && Number(state.stats.buildsCompleted) === 135, "Origin IDs/counters/selection differ from independent route");
  exact(money(home().resources), GOLD.originWallet, "Exact natural-origin wallet");
  const eco = economy(selectPlanet(state, HOME));
  for (const r of RESOURCE_IDS) check(eco.gross[r] === GOLD.grossPerSecond[r] && eco.consumption[r] === 0, `Independent actual natural gross rate ${r}`);
  check(state.planets.length === 2 && state.planets.every(p => !p.demolition && !p.buildQueue.length && !p.shipyardQueue.length) && !state.research.queue.length && !state.fleets.length && !state.boosters.length, "Origin has unexpected competing work");
  initial = serializeState(state); control = deserializeState(initial); expectedManualActions = state.stats.manualActions; originAt = m.save.savedAt + 1000;
  origin = { sourceSha: GOLD.sourceSha, reportSha256: hash, milestoneName: m.name, gameSeconds: m.gameSeconds, originalSave: m.save, originalSaveRaw: rawOrigin, originalSaveSha256: GOLD.originalSaveSha256, extraction: sliceMetadata, migration: { sourceRevision: 10, targetRevision: SAVE_REVISION, addedNpcEconomy: expectedNpcEconomy(), addedPerPlanet: { demolition: null }, addedPerMessage: { npcScoutSnapshot: null }, everyOldFieldPreserved: true }, replayedLiveSeconds: 1, finalSnapshotReproducedExactly: true, originalFinalSnapshot };
  ready = true; checkpoint("origin");
}
let error: unknown = null;
try {
  await loadOrigin();
  state = selectPlanet(state, HOME); control = selectPlanet(control, HOME); checkpoint("selectedHome");
  const beforePreview = serializeState(state), preview = quoteDemolition(state, "metal_storage"); check(preview.ok && preview.quote, preview.reason);
  exact(money(preview.quote.paid), GOLD.paid, "Dismissed quote independent fee"); exact(serializeState(state), beforePreview, "Preview/dismiss makes no change to any state field"); checkpoint("previewDismissed");
  pay(202); checkpoint("firstPaid"); oneSecond(); oneSecond(); checkpoint("firstTwoSeconds");
  check(home().demolition!.remainingSeconds === GOLD.demolitionSeconds - 2, "First job exact remaining timer before cancel");
  const cancelRef: DemolitionJobRef = { kind: "demolition", planetId: HOME, jobId: 202, taskId: null }, beforeRefund = state;
  action("explicit paid job202 cancellation", () => cancelDemolition(state, cancelRef)); refunded += 128000;
  transfer(beforeRefund, state, GOLD.paid, 1); check(home().demolition === null && Number(state.orders.nextJobId) === 203 && home().resources.metal.gt(GOLD.cap9), "Cancellation consumes job once and retains legitimate two-second over-cap production");
  const stale = cancelDemolition(state, cancelRef); check(!stale.ok, "Duplicate cancelled identity must reject"); exact(serializeState(stale.state), serializeState(state), "Duplicate cancel has no second refund or side effect"); checkpoint("firstRefunded");
  pay(203); checkpoint("secondPaid"); for (let i = 0; i < 5; i++) oneSecond(); checkpoint("partialFiveSeconds");
  check(home().demolition?.jobId === 203 && home().demolition!.remainingSeconds === GOLD.demolitionSeconds - 5 && home().demolition!.remainingSeconds > 0, "Reload starts from actual positive live timer"); checkpoint("partialReloaded");
  for (let i = 0; i < 9; i++) oneSecond();
  check(Number(elapsed) === 16 && !home().demolition && home().buildings.metal_storage === 8 && home().resources.metal.gt(GOLD.cap8) && economy(state).net.metal === 0 && Number(state.orders.nextJobId) === 204 && Number(state.stats.buildsCompleted) === 135, "Real demolition completion frees one field, retains stock, stops metal production, grants no build/reward/ID");
  checkpoint("demolitionComplete");
  const ordinary = canEnqueue(state, "metal_storage"); check(ordinary.ok && ordinary.targetLevel === 9, "Old normal rebuild entry available after real demolition"); exact(money(ordinary.cost), GOLD.rebuildPaid, "Independent original-upgrade price256000");
  const beforeRebuild = state; action("original manual enqueue metal_storage9", () => enqueue(state, "metal_storage", "manual")); grossPaid += 256000; expectedManualActions++;
  const rebuild = home().buildQueue[0]; check(rebuild && rebuild.jobId === 204 && rebuild.taskId === null && rebuild.source === "manual" && rebuild.targetLevel === 9 && rebuild.totalSeconds === GOLD.rebuildSeconds && rebuild.remainingSeconds === GOLD.rebuildSeconds, "Original paid rebuild fixed identity/fee/time");
  exact(money(rebuild.paid), GOLD.rebuildPaid, "Rebuild actual paid integer snapshot"); transfer(beforeRebuild, state, GOLD.rebuildPaid, -1); checkpoint("rebuildPaid");
  for (let i = 0; i < 28; i++) oneSecond();
  check(Number(elapsed) === 44 && !home().buildQueue.length && !home().demolition && home().buildings.metal_storage === 9 && Number(state.stats.buildsCompleted) === 136 && Number(state.orders.nextJobId) === 205 && economy(state).net.metal === GOLD.grossPerSecond.metal, "Ordinary rebuild completes once and resumes production at actual boundary");
  checkpoint("rebuildComplete"); checkpoint("completeReloaded"); oneSecond(); checkpoint("later");
  check(events.length === 2 && events[0]!.jobId === 203 && events[1]!.jobId === 204 && grossPaid === 512000 && refunded === 128000, "Exactly paid cancellation, second demolition and ordinary rebuild ledger");
} catch (caught) { error = caught; process.exitCode = 1; }
process.stdout.write(JSON.stringify({ schema: "infinity-demolition-natural-growth-v1", source, origin, golden: GOLD,
  execution: { startedAt, hostElapsedSeconds: (performance.now() - hostStarted) / 1000, clockMode: "One original source replay tick plus 45 ordinary one-second live engine ticks. No clocks/state/resources are assigned. Serializer metadata is supplied at the counted source epoch.", phase: stage },
  provenance: { injectedGameState: false, unchangedSourceEnvelope: true, replayedOneOriginalLiveTick: true, noSyntheticFunds: true, noSyntheticTech: true, noSyntheticJobs: true, noRawSettingsPatches: true, noRingRewardReveals: true, noClockAssignments: true },
  actions, events, milestones,
  outcome: { status: error ? "blocked" : "passed", reason: error ? String(error) : null, continuationGameSeconds: elapsed, totalGameSeconds: ready ? state.totalTime.toString() : null,
    grossPaid: { ...zero, metal: String(grossPaid) }, refunded: { ...zero, metal: String(refunded) }, netPaid: { ...zero, metal: String(grossPaid - refunded) }, integratedProduction: produced,
    finalSnapshot: ready ? snapshot() : null, finalSave: ready ? importSave(exportSave(state, originAt + elapsed * 1000)) : null,
    boundary: "Domain engine evidence only. Native HTTP controls, storage, file/dialog/reload and responsive rendering require the independent CI browser execution." },
}, null, 2) + "\n");
