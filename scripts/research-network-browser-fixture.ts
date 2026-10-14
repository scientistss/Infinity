/** Native IRN acceptance oracles, produced only from a clean, hash-bound natural report.
 * node --import tsx scripts/research-network-browser-fixture.ts REPORT REPORT_SHA256 SOURCE_SHA
 * No state is funded, unlocked, or manufactured. The separately labeled saved-timer
 * compatibility probe changes only a paid job's persisted total/remaining duration.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { researchById } from "../src/data/research";
import { catchUp } from "../src/core/offline";
import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { economy } from "../src/game/economy";
import { selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { createOrderTask } from "../src/game/orders";
import { usedFields } from "../src/game/planet";
import { canEnqueueResearch, enqueueResearch, researchNetworkView, researchSecondsFor } from "../src/game/research";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
]);
function check(value: unknown, reason: string): asserts value { if (!value) throw Error(reason); }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = (a: unknown, b: unknown, label: string) => check(stable(a) === stable(b), label);
const near = (a: number, b: number, label: string) => check(Number.isFinite(a) && Math.abs(a - b) < 1e-10, label);
const [path, expectedHash, expectedSha] = process.argv.slice(2);
check(process.argv.length === 5 && /^[a-f0-9]{64}$/.test(expectedHash ?? "") && /^[a-f0-9]{40}$/.test(expectedSha ?? ""),
  "Usage: REPORT INDEPENDENT_REPORT_SHA256 INDEPENDENT_SOURCE_SHA");
const bytes = readFileSync(path), hash = String(createHash("sha256").update(bytes).digest("hex"));
check(hash === expectedHash, "Independent natural report byte hash mismatch");
const report = JSON.parse(String(bytes));
const git = (args: string[]) => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
check(git(["rev-parse", "HEAD"]) === expectedSha, "Oracle runtime checkout differs from independently supplied SHA");
const sourceScope = git(["status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github"]);
check(sourceScope === "", "Oracle runtime source scope is dirty; local preparation is not formal native evidence");
check(report.schema === "infinity-natural-research-network-journey-v1" && report.outcome?.status === "passed", "Natural IRN report did not pass");
check(report.source?.sourceSha === expectedSha && report.source.gitHead === expectedSha && report.source.sourceScopeStatusPorcelain === "", "Report source SHA/scope is not the clean requested source");
check(report.provenance?.injectedGameState === false && ["noSyntheticFunds", "noSyntheticTech", "noSyntheticJobs", "noRawSettingsPatches", "noRingRewardReveals", "noClockAssignments"].every(key => report.provenance[key] === true), "Natural provenance incomplete");
check(report.origin?.reportSha256 === report.origin.expectedReportSha256 && /^[a-f0-9]{64}$/.test(report.origin.reportSha256)
  && /^[a-f0-9]{40}$/.test(report.origin.sourceSha) && report.origin.sourceSha === report.origin.gitHead
  && report.origin.sourceScopeStatusPorcelain === "" && report.origin.sourceWorktreeStatusPorcelain === "", "Natural origin binding incomplete");
const HOME = "homeworld", COLONY = "colony-1", RES = ["metal", "crystal", "deuterium"] as const;
const names = {
  before: "03-real-hyperspace8-and-main10-before-network-and-reloaded",
  irnPaid: "04-irn1-really-paid-in-flight-old-network-zero-and-reloaded",
  network: "05-real-irn1-complete-main10-plus-colony3-effective13-and-reloaded",
  unpaid: "06-finite-computer11-explicit-budget-fixed-mother-unpaid-colony-selected",
  paid: "07-finite-computer11-real-payment-in-flight-frozen-network-duration-reloaded",
  inflight: "08-finite-computer11-still-in-flight-after-live-ticks-and-second-reload",
  complete: "09-finite-computer11-completed-once-exact-ledger-and-reloaded",
  later: "10-finished-target-survives-extra-live-ticks-and-reloads-without-extra-consumption",
};
const GOLD = { irn1: { metal: "240000", crystal: "400000", deuterium: "160000" }, computer11: { metal: "0", crystal: "409600", deuterium: "614400" },
  irn1Seconds: 3840 / 11, computer11BeforeNetworkSeconds: 12288 / 55, computer11AfterNetworkSeconds: 6144 / 35 };
const money = (value: GameState["planets"][number]["resources"]) => Object.fromEntries(RES.map(id => [id, value[id].toString()]));
const milestones = Object.fromEntries(Object.entries(names).map(([key, name]) => {
  const matches = report.milestones.filter((row: { name: string }) => row.name === name);
  check(matches.length === 1, `Missing/duplicate milestone ${name}`); const m = matches[0];
  check(m.strictRoundtrips === 2 && m.stateAdoptedFromReload === true && m.subsequentLiveTickObserved === true
    && Number.isSafeInteger(m.firstSubsequentLiveTickAt) && m.firstSubsequentLiveTickAt > m.gameSeconds, `${name}: live strict handoff incomplete`);
  check(m.save.schema === SAVE_SCHEMA && m.save.version === SAVE_VERSION && m.save.revision === SAVE_REVISION
    && SAVE_REVISION === 16 && Number.isSafeInteger(m.save.savedAt) && m.save.savedAt === m.save.lastTickAt, `${name}: strict zero-gap current envelope required`);
  const imported = importSave(JSON.stringify(m.save)), state = deserializeState(imported.state);
  exact(imported, m.save, `${name}: strict reader changed full save envelope`);
  exact(serializeState(state), m.save.state, `${name}: strict reader changed full state`);
  exact(serializeState(catchUp(state, 0).state), m.save.state, `${name}: zero-gap startup changed state`);
  const snapshot = { gameSeconds: m.gameSeconds, continuationSeconds: m.continuationSeconds, totalTime: state.totalTime.toString(), activePlanetId: state.activePlanetId,
    wallets: Object.fromEntries(state.planets.map(p => [p.id, money(p.resources)])),
    fields: state.planets.map(p => ({ planetId: p.id, fieldsMax: p.fieldsMax, base: p.terraformerFields.base, grantedLevels: p.terraformerFields.grantedLevels,
      terraformer: p.buildings.terraformer, usedFields: usedFields(p), freeFields: p.fieldsMax - usedFields(p) })),
    grantJobFloor: state.terraformerGrantJobFloor, research: serializeState(state).research, orders: serializeState(state).orders,
    computerNetwork: researchNetworkView(state, "computer_tech", HOME), irnNetwork: researchNetworkView(state, "intergalactic_research_network", HOME),
    planets: state.planets.map(p => ({ id: p.id, buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, economy: economy(selectPlanet(state, p.id)) })) };
  exact(snapshot, m.snapshot, `${name}: entire recorded snapshot is not reproduced from the unchanged strict save`);
  return [key, m];
}));
const expected: Record<string, ReturnType<typeof serializeState>> = {};
const load = (key: keyof typeof names) => deserializeState(importSave(JSON.stringify(milestones[key].save)).state);
const clone = (state: GameState) => deserializeState(importSave(exportSave(state, milestones.before.save.savedAt)).state);
const put = (key: string, state: GameState) => { expected[key] = serializeState(state); exact(importSave(exportSave(state, milestones.before.save.savedAt)).state, expected[key], `${key}: oracle is not strict-readable`); return state; };
const accepted = (result: { ok: boolean; reason: string; state: GameState }) => { check(result.ok, result.reason); return result.state; };
function boundedUntil(state: GameState, predicate: (s: GameState) => boolean, limit: number) {
  let seconds = 0;
  while (!predicate(state)) { check(seconds++ < limit, "Bounded natural production/live completion wait exceeded"); state = tick(state, 1, "live"); }
  return { state, seconds };
}
function paid(state: GameState, tech: string, source: "manual" | "plan", target: number, amount: object, seconds: number) {
  const job = state.research.queue[0]!;
  check(job?.tech === tech && job.planetId === HOME && job.targetLevel === target && job.source === source && job.jobId === state.orders.nextJobId - 1, "Paid identity/payer/level golden failed");
  exact(money(job.paid), amount, "Literal price golden failed"); near(job.totalSeconds, seconds, "Independent duration golden failed"); return job;
}
function wallet(before: GameState, after: GameState, amounts: Record<typeof RES[number], string>, produced: boolean) {
  const proofs = before.planets.map(p => {
    const eco = economy(selectPlanet(before, p.id)), now = after.planets.find(x => x.id === p.id)!;
    for (const r of RES) {
      check(eco.consumption[r] === 0 && eco.net[r] >= 0 && p.resources[r].toNumber() < 1e8, "Wallet oracle requires bounded no-fusion natural world");
      const expected = (produced ? Math.min(eco.caps[r], Number(p.resources[r].toString()) + eco.net[r]) : Number(p.resources[r].toString())) - (p.id === HOME ? Number(amounts[r]) : 0);
      check(Math.abs(Number(now.resources[r].toString()) - expected) <= 1e-7 + Math.abs(expected) * 2e-14, `${p.id}/${r}: independent Number payment movement failed`);
    }
    return { planetId: p.id, before: money(p.resources), after: money(now.resources), net: eco.net, caps: eco.caps, productionSeconds: produced ? 1 : 0, paid: p.id === HOME ? amounts : { metal: "0", crystal: "0", deuterium: "0" } };
  }); return proofs;
}
const before = put("before", load("before"));
check(before.planets.find(p => p.id === HOME)!.buildings.research_lab === 10 && before.planets.find(p => p.id === COLONY)!.buildings.research_lab === 3
  && before.research.levels.intergalactic_research_network === 0 && before.research.levels.hyperspace_tech === 8, "Natural prerequisite golden changed");
near(researchSecondsFor(before, researchById("computer_tech"), 11), GOLD.computer11BeforeNetworkSeconds, "Pre-network computer quote golden");
const irnWait = boundedUntil(clone(before), s => { const check = canEnqueueResearch(s, "intergalactic_research_network"); return check.ok; }, 7200);
let state = put("irnReady", irnWait.state);
const irnBefore = state; state = put("irnPaid", accepted(enqueueResearch(state, "intergalactic_research_network", "manual")));
paid(state, "intergalactic_research_network", "manual", 1, GOLD.irn1, GOLD.irn1Seconds);
const irnPayment = wallet(irnBefore, state, GOLD.irn1, false);
exact(expected.irnPaid, milestones.irnPaid.save.state, "Actual manual IRN branch differs from unchanged natural milestone 04");
state = put("irnOneSecond", tick(state, 1, "live")); state = put("irnReloaded", catchUp(clone(state), 0).state);
const irnFinish = boundedUntil(state, s => s.research.levels.intergalactic_research_network === 1, 350);
state = put("network", irnFinish.state); exact(expected.network, milestones.network.save.state, "Actual native IRN branch must reach unchanged milestone 05");
const network = researchNetworkView(state, "computer_tech", HOME), ownNetwork = researchNetworkView(state, "intergalactic_research_network", HOME);
check(network.primaryLabLevel === 10 && network.effectiveLabLevel === 13 && network.supports.length === 1 && network.supports[0]!.planetId === COLONY
  && network.supports[0]!.labLevel === 3 && ownNetwork.supports.length === 0 && ownNetwork.effectiveLabLevel === 10, "Per-tech natural support golden failed");
near(researchSecondsFor(state, researchById("computer_tech"), 11), GOLD.computer11AfterNetworkSeconds, "Post-network computer quote golden");
// The UI branch creates its actual intent immediately at 05, before affordability.
// It is explicitly separate from canonical 06 (which waited before creating intent).
state = put("uiSelectedColony", selectPlanet(state, COLONY)); const taskId = state.orders.nextTaskId;
state = put("uiIntent", accepted(createOrderTask(state, { kind: "research", planetId: HOME, tech: "computer_tech", targetLevel: 11,
  budget: { ...GOLD.computer11 }, expectedNextTaskId: taskId })));
check(state.research.queue.length === 0 && state.orders.nextJobId === milestones.network.save.state.orders.nextJobId, "Creating finite intent paid early");
exact(state.planets.map(p => money(p.resources)), load("network").planets.map(p => money(p.resources)), "Intent changed wallet");
const firstPass = 10; for (let i = 0; i < firstPass; i++) state = tick(state, 1, "live"); put("uiWaiting", state);
check(state.research.queue.length === 0 && state.orders.tasks.find(t => t.id === taskId)!.charged.crystal === "0", "Insufficient natural stock did not wait");
let fundingSeconds = firstPass, prePayment = state;
while (state.research.queue.length === 0) {
  check(++fundingSeconds <= 7200, "Finite production funding did not pay within two hours"); prePayment = state; state = tick(state, 1, "live");
}
put("uiBeforePayment", prePayment); put("uiPaid", state);
const uiJob = paid(state, "computer_tech", "plan", 11, GOLD.computer11, GOLD.computer11AfterNetworkSeconds);
check(uiJob.taskId === taskId && state.activePlanetId === COLONY, "UI finite plan did not use fixed mother while colony selected");
const uiPayment = wallet(prePayment, state, GOLD.computer11, true);
state = put("uiFiveSeconds", tick(tick(tick(tick(tick(state, 1, "live"), 1, "live"), 1, "live"), 1, "live"), 1, "live"));
state = put("uiReloaded", catchUp(clone(state), 0).state);
const uiFinish = boundedUntil(state, s => s.research.levels.computer_tech === 11, 176);
state = put("uiComplete", uiFinish.state);
const done = state.orders.tasks.find(t => t.id === taskId)!;
check(done.status === "completed" && done.activeJob === null && state.research.queue.length === 0, "UI finite task did not complete once");
exact(done.charged, GOLD.computer11, "UI completed charge differs from literal budget");
const nextJob = state.orders.nextJobId, completedCount = state.stats.researchCompleted;
for (let i = 0; i < 21; i++) state = tick(state, 1, "live"); put("uiLater", state);
check(state.orders.nextJobId === nextJob && state.stats.researchCompleted === completedCount && !state.research.queue.length, "Completed UI plan produced extra work");
exact(state.orders.tasks.find(t => t.id === taskId), done, "Completed UI ledger changed");
// Canonical report handoffs are also replayed exactly, without recreating or patching them.
state = put("unpaid", load("unpaid"));
const canonicalPayment = boundedUntil(state, s => s.research.queue.length > 0, 11); state = put("paid", canonicalPayment.state);
exact(expected.paid, milestones.paid.save.state, "Canonical 06->07 full-state mismatch");
state = selectPlanet(state, HOME); state = tick(state, 1, "live"); state = selectPlanet(state, COLONY);
for (let i = 0; i < 4; i++) state = tick(state, 1, "live"); put("inflight", state);
exact(expected.inflight, milestones.inflight.save.state, "Canonical 07->08 full-state mismatch");
state = catchUp(clone(state), 0).state;
const canonicalFinish = boundedUntil(state, s => s.research.levels.computer_tech === 11, 176); state = put("complete", canonicalFinish.state);
exact(expected.complete, milestones.complete.save.state, "Canonical 08->09 full-state mismatch");
for (let i = 0; i < 21; i++) state = tick(state, 1, "live"); put("later", state);
exact(expected.later, milestones.later.save.state, "Canonical 09->10 full-state mismatch");
// Explicitly synthetic saved-duration compatibility. No technology, money, job,
// owner, or authority is created. It cannot be described as natural evidence.
const frozen = load("paid"); frozen.research.queue[0]!.totalSeconds = 600; frozen.research.queue[0]!.remainingSeconds = 123;
put("syntheticFrozen", frozen);
state = put("syntheticFrozenHome", selectPlanet(clone(frozen), HOME));
state = put("syntheticWaitingLaser", accepted(enqueueResearch(state, "laser_tech", "manual")));
check(state.research.queue[0]!.totalSeconds === 600 && state.research.queue[0]!.remainingSeconds === 123
  && state.research.queue[1]!.totalSeconds === 0 && state.research.queue[1]!.remainingSeconds === 0, "Waiting quote repriced active timer or started waiting job");
exact(money(state.research.queue[1]!.paid), { metal: "200", crystal: "100", deuterium: "0" }, "Ordinary laser payment golden changed");
state = put("syntheticWaitingColony", selectPlanet(state, COLONY));
const syntheticSave = importSave(exportSave(frozen, milestones.paid.save.savedAt));
process.stdout.write(JSON.stringify({ schema: "infinity-research-network-browser-fixture-v1", key: STORAGE_KEY, homeId: HOME, colonyId: COLONY,
  description: "Unchanged natural IRN handoffs with native player continuations. Immediate-at-05 UI intent branch differs from canonical 06. Only the labeled saved-duration compatibility case is synthetic; no grants, funding, or unlocks.",
  source: { reportSha256: hash, sourceSha: expectedSha, gitHead: report.source.gitHead, sourceScopeStatusPorcelain: report.source.sourceScopeStatusPorcelain,
    worktreeStatusPorcelain: report.source.worktreeStatusPorcelain, oracleSourceScopeStatusPorcelain: sourceScope, origin: report.origin, provenance: report.provenance },
  base: milestones.before.save, naturalMilestones: milestones, golden: GOLD, independentPaymentProofs: { irnPayment, uiPayment },
  execution: { irnWaitSeconds: irnWait.seconds, irnFinishAfterOneSecond: irnFinish.seconds, taskId, fundingSeconds, uiFinishAfterFiveSeconds: uiFinish.seconds,
    canonicalPaymentSeconds: canonicalPayment.seconds, canonicalFinishAfterFiveSeconds: canonicalFinish.seconds, uiJobId: uiJob.jobId },
  syntheticFrozen: syntheticSave, expected }, null, 2) + "\n");
