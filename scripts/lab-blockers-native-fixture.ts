/** Read-only lab-blocker native acceptance preparation, never browser evidence.
 * Natural branch replays the unchanged historical two-planet laboratory route.
 * Explicit synthetic branches may fund/name planets; they are never natural.
 * Usage: node --import tsx scripts/lab-blockers-native-fixture.ts REPORT REPORT_SHA256 SOURCE_SHA
 */
declare const process: { argv: string[]; version: string; stdout: { write(text: string): void } };
import { SAVE_REVISION, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { catchUp } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { selectPlanet } from "../src/game/empire";
import { tick } from "../src/game/logic";
import { cancel, enqueue } from "../src/game/queue";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { createOrderTask } from "../src/game/orders";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
const [{ readFileSync }, { createHash }, { execFileSync }, { gunzipSync }] = await Promise.all([
  import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string), import("node:zlib" as string),
]);
const REPORT_SHA = "1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d";
const GZIP_SHA = "0ddea5009ff9832630bf5621a1f51b1c1c8211bd253045c45025d43f5c1bc8db";
const HISTORICAL_SHA = "be0e112b964179fc15b89daa4ae6f6a722b78a92";
const HOME = "homeworld", COLONY = "colony-1";
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function check(ok: unknown, reason: string): asserts ok { if (!ok) throw Error(reason); }
const exact = (left: unknown, right: unknown, reason: string) => check(stable(left) === stable(right), reason);
const hash = (bytes: unknown) => String(createHash("sha256").update(bytes).digest("hex"));
const [path, expectedHash, expectedSha] = process.argv.slice(2);
check(process.argv.length === 5 && expectedHash === REPORT_SHA && /^[a-f0-9]{40}$/.test(expectedSha ?? ""), "Exact report and current source SHA required");
const git = (...args: string[]) => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
check(git("rev-parse", "HEAD") === expectedSha, "Current source SHA mismatch");
check(git("status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ".github", "package.json", "package-lock.json") === "", "Clean committed fixture producer required");
const bytes = readFileSync(path); check(hash(bytes) === REPORT_SHA, "Natural report byte mismatch");
const compressed = readFileSync(new URL("../tests/fixtures/lab-blockers-be0-research-network-report.json.gz", import.meta.url));
check(compressed.length === 74414 && hash(compressed) === GZIP_SHA, "Compressed historical source mismatch before decompression");
const original = gunzipSync(compressed);
check(original.length === 836611 && hash(original) === REPORT_SHA && original.equals(bytes), "Lossless archive differs from supplied complete natural source");
const report = JSON.parse(String(bytes));
check(report.schema === "infinity-natural-research-network-journey-v1" && report.outcome.status === "passed"
  && report.source.sourceSha === HISTORICAL_SHA && report.source.gitHead === HISTORICAL_SHA
  && report.source.sourceScopeStatusPorcelain === "" && report.source.worktreeStatusPorcelain === "", "Historical natural report binding failed");
check(report.provenance.injectedGameState === false && ["noSyntheticFunds", "noSyntheticTech", "noSyntheticJobs", "noRawSettingsPatches", "noRingRewardReveals", "noClockAssignments"].every(key => report.provenance[key] === true), "Natural provenance flags failed");
check(SAVE_VERSION === 9 && SAVE_REVISION === 14, "This acceptance does not authorize save-format changes");
const origin = report.milestones[0], final = report.milestones[1];
check(origin.name === "00-unchanged-origin-full-world-imported-and-reloaded"
  && final.name === "01-four-real-paid-lab-upgrades-main10-colony3-and-reloaded", "Exact historical handoffs required");
for (const milestone of [origin, final]) {
  check(milestone.strictRoundtrips === 2 && milestone.stateAdoptedFromReload && milestone.subsequentLiveTickObserved
    && milestone.save.savedAt === milestone.save.lastTickAt, "Verified strict zero-gap handoff required");
  exact(importSave(JSON.stringify(milestone.save)), milestone.save, "Current reader changed historical r14 envelope");
}
const initialRaw = JSON.stringify(origin.save), epoch = origin.save.savedAt;
const load = () => deserializeState(importSave(initialRaw).state);
const clone = (state: GameState) => deserializeState(importSave(exportSave(state, epoch)).state);
const accept = (result: { ok: boolean; reason: string; state: GameState }) => { check(result.ok, result.reason); return result.state; };
type TapeRow = { kind: string; [key: string]: unknown };
const tape: TapeRow[] = [], expected: Record<string, ReturnType<typeof serializeState>> = {};
let state = load(), elapsed = 0;
function checkpoint(name: string) { expected[name] = serializeState(state); tape.push({ kind: "checkpoint", name }); }
function selection(planetId: string, name: string) { state = selectPlanet(state, planetId); tape.push({ kind: "select", planetId }); checkpoint(name); }
function advance(seconds: number, name: string) {
  check(Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 418, "Bounded one-second live route required");
  for (let i = 0; i < seconds; i++) state = tick(state, 1, "live");
  elapsed += seconds; tape.push({ kind: "advance", seconds }); checkpoint(name);
}
exact(serializeState(catchUp(state, 0).state), origin.save.state, "Natural zero-gap startup changed state");
checkpoint("origin"); selection(HOME, "selected-home");
const paidAt = [0, 5, 14, 384], duration = [4.189090909090909, 8.378181818181819, 16.756363636363638, 33.512727272727275];
let paidFinal: GameState | null = null;
for (let offset = 0; offset < 4; offset++) {
  const level = 7 + offset, jobId = 183 + offset;
  advance(paidAt[offset]! - elapsed, `lab${level}-funded`);
  const before = state, n = 12800 * 2 ** offset;
  const paid = { metal: String(n), crystal: String(2 * n), deuterium: String(n) };
  state = accept(enqueue(state, "research_lab", "manual"));
  const job = state.planets.find(p => p.id === HOME)!.buildQueue[0]!;
  check(job.jobId === jobId && job.targetLevel === level && job.source === "manual" && job.taskId === null
    && job.totalSeconds === duration[offset] && state.orders.nextJobId === jobId + 1, "Literal natural paid job identity/duration changed");
  exact(Object.fromEntries(Object.entries(job.paid).map(([key, value]) => [key, value.toString()])), paid, "Literal laboratory cost changed");
  const historical = report.paidJobs.find((item: { jobId: number }) => item.jobId === jobId);
  exact(historical.paid, paid, "Historical paid receipt mismatch");
  for (const key of ["metal", "crystal", "deuterium"] as const) {
    const prior = Number(before.planets[0]!.resources[key].toString()), actual = Number(state.planets[0]!.resources[key].toString());
    check(Math.abs(actual - (prior - Number(paid[key]))) <= 1e-7 + Math.abs(actual) * 2e-14, "Independent wallet subtraction failed");
  }
  tape.push({ kind: "pay", building: "research_lab", level, jobId, paid, totalSeconds: duration[offset] }); checkpoint(`lab${level}-paid`);
  selection(COLONY, `lab${level}-colony`);
  if (level === 10) { paidFinal = clone(state); tape.push({ kind: "four-widths", checkpoint: "lab10-colony" }); }
  selection(HOME, `lab${level}-home`); advance(Math.ceil(duration[offset]!), `lab${level}-complete`);
}
check(elapsed === 418, "Natural route tick count drift");
exact(serializeState(state), final.save.state, "Full natural route differs from historical milestone01");
check(paidFinal !== null, "Natural final paid checkpoint missing");
const cancelSelected = selectPlanet(paidFinal, HOME), cancelled = accept(cancel(cancelSelected, 0));
expected.cancelHome = serializeState(cancelSelected); expected.cancelled = serializeState(cancelled);
expected.cancelledColony = serializeState(selectPlanet(cancelled, COLONY));
expected.completeColony = serializeState(selectPlanet(state, COLONY));

// Every synthetic input is isolated and visibly classified. Only setup funds
// and names are injected; paid jobs are created by original public domain APIs.
const synthetic: Record<string, { classification: string; raw: string; expected: ReturnType<typeof serializeState> }> = {};
function put(name: string, value: GameState, classification: string) {
  value = selectPlanet(value, COLONY);
  const raw = exportSave(value, epoch), restored = importSave(raw);
  exact(serializeState(deserializeState(restored.state)), restored.state, `${name}: strict roundtrip changed input`);
  exact(serializeState(catchUp(deserializeState(restored.state), 0).state), restored.state, `${name}: zero-gap startup changed input`);
  synthetic[name] = { classification: "EXPLICIT SYNTHETIC: " + classification, raw, expected: restored.state };
}
function syntheticBase(longNames = false) {
  const base = load();
  for (const planet of base.planets) {
    planet.resources = { metal: big(10000000), crystal: big(10000000), deuterium: big(10000000) };
    if (longNames) planet.name = (planet.id === HOME ? '<script>&"星🚀' : "<img>&'殖民🛰") + "ABCDEFGHIJKLMNOPQRSTUVWX";
  }
  return selectPlanet(base, HOME);
}
for (const name of ["same-planet-two-jobs", "nonlab-head-lab-tail", "multi-planet-upgrades", "mixed-demolition-long-names"]) {
  let value = syntheticBase(name === "mixed-demolition-long-names");
  const nonlabHead = name === "nonlab-head-lab-tail" || name === "mixed-demolition-long-names";
  if (nonlabHead) value = accept(enqueue(value, "fusion_reactor", "manual"));
  // Existing capacity is two: non-lab head + one lab tail, or two labs.
  if (!nonlabHead) value = accept(enqueue(value, "research_lab", "manual"));
  value = accept(enqueue(value, "research_lab", "manual"));
  if (name === "multi-planet-upgrades") value = accept(enqueue(selectPlanet(value, COLONY), "research_lab", "manual"));
  if (name === "mixed-demolition-long-names") {
    value = selectPlanet(value, COLONY); const quote = quoteDemolition(value, "research_lab");
    check(quote.ok && quote.quote, quote.reason); value = accept(commitDemolition(value, quote.quote));
  }
  put(name, value, "Pre-funded two-planet setup; original APIs pay all queue/demolition jobs. Names contain literal markup characters. Not natural progression.");
}
let unpaid = syntheticBase();
unpaid = accept(createOrderTask(unpaid, { kind: "building", planetId: HOME, building: "research_lab", targetLevel: 7,
  budget: { metal: "12800", crystal: "25600", deuterium: "12800" }, expectedNextTaskId: unpaid.orders.nextTaskId, transport: null }));
put("unpaid-intent-only", unpaid, "Pre-funded setup plus finite unpaid laboratory intent; no scheduler tick and no paid laboratory job.");
process.stdout.write(JSON.stringify({ schema: "infinity-lab-blockers-native-fixture-v1", key: STORAGE_KEY,
  source: { sourceSha: expectedSha, fullTree: git("rev-parse", "HEAD^{tree}"), scriptSha256: hash(readFileSync(new URL(import.meta.url))),
    dependencyLockSha256: hash(readFileSync(new URL("../package-lock.json", import.meta.url))), runtimeNode: process.version },
  historical: { sourceSha: HISTORICAL_SHA, reportSha256: REPORT_SHA, compressedSha256: GZIP_SHA, compressedBytes: 74414,
    uncompressedBytes: 836611, originName: origin.name, finalName: final.name },
  classification: "Natural branch uses exact historical milestone00; actual browser must separately pay jobs183-186. Engine snapshots are full-state oracles, never browser evidence.",
  base: origin.save, initialRaw, initialRawSha256: hash(initialRaw), tape, expected, synthetic, finalSave: final.save,
}, null, 2));
