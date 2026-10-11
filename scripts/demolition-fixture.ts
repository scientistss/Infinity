/** Hash-bound handoff for native demolition acceptance. No manufactured natural state.
 * CLI: node --import tsx scripts/demolition-fixture.ts REPORT REPORT_SHA256 SOURCE_SHA
 * Helpers are also used by unit tests and the domain journey.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { expectedNpcEconomy, assertNpcEconomy, projectVerifiedNpcEconomy } from "./r13-compatibility.mjs";
import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { clearSlot, equipCard, refreshUnlocks, toggleSlot, unlockedSlotCount } from "../src/automation/engine";
import { big } from "../src/game/decimal";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { activePlanet } from "../src/game/empire";
import { evaluatePrestige, prestige, tick } from "../src/game/logic";
import { enqueue } from "../src/game/queue";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { prestigeConfirmation } from "../src/ui/prestige-preview-model";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";

export function requireEvidence(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export function evidenceDifference(a: unknown, b: unknown, path = "$state"): unknown | null {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return { path, before: a, after: b };
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const ak = Object.keys(left).sort(), bk = Object.keys(right).sort();
  if (ak.length !== bk.length || ak.some((key, index) => key !== bk[index])) return { path: `${path}.[keys]`, before: ak, after: bk };
  for (const key of ak) { const difference = evidenceDifference(left[key], right[key], `${path}.${key}`); if (difference) return difference; }
  return null;
}
export function exactEvidence(a: unknown, b: unknown, label: string): void {
  const difference = evidenceDifference(a, b); requireEvidence(difference === null, `${label}: ${JSON.stringify(difference)}`);
}
/** This narrowly specified migration projection is never applied to live jobs.
 * It first proves every new field is exactly null, and rejects new/missing planets.
 * Only those null fields are removed. Every old field and key remains comparable.
 */
export function projectR11NullToR10(current: unknown, old: unknown): unknown {
  requireEvidence(current !== null && typeof current === "object" && old !== null && typeof old === "object", "Migration requires two complete state objects");
  const projection = structuredClone(current) as Record<string, unknown>;
  const previous = old as Record<string, unknown>;
  requireEvidence(Array.isArray(projection.planets) && Array.isArray(previous.planets) && projection.planets.length === previous.planets.length, "Migration changed planet set");
  for (let index = 0; index < projection.planets.length; index++) {
    const planet = projection.planets[index], source = previous.planets[index];
    requireEvidence(planet && source && planet.id === source.id && !Object.hasOwn(source, "demolition") && Object.hasOwn(planet, "demolition") && planet.demolition === null,
      "Migration projection permits only one added explicit demolition:null per unchanged old planet");
    delete planet.demolition;
  }
  exactEvidence(projection, old, "r10→r11 migration preserved every original state field");
  return projection;
}
/** Pure r10 migration only: zero NPC age is proven before the frozen r11 null-slot adapter. */
export function projectR13ZeroToR10(current: unknown, old: unknown): unknown {
  return projectR11NullToR10(projectVerifiedNpcEconomy(current, expectedNpcEconomy(), "r10→r13 pure migration"), old);
}
export const DEMOLITION_GOLDEN = {
  homeId: "homeworld", colonyId: "colony-1", building: "metal_storage",
  sourceSha: "ac3cce98403bea1e7162bcb4092e4cfeeb448a9a",
  sourceReportSha256: "303175f79caeb3b27bdd6d03262aff5c67ced0171b2c60c07794c42dca394025",
  originMetadataSha256: "a1a8ce7985030f6a8e500755eda4d908c8834b3ecfa888197d5ef5ed8ef27f69",
  originalSaveSha256: "d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a",
  sourceMilestone: "10-finished-target-survives-extra-live-ticks-and-reloads-without-extra-consumption",
  sourceGameSeconds: 25810, originGameSeconds: 25811, firstJobId: 202, secondJobId: 203, rebuildJobId: 204, nextJobId: 205,
  paid: { metal: "128000", crystal: "0", deuterium: "0" }, rebuildPaid: { metal: "256000", crystal: "0", deuterium: "0" },
  grossPaid: { metal: "512000", crystal: "0", deuterium: "0" }, refund: { metal: "128000", crystal: "0", deuterium: "0" }, netPaid: { metal: "384000", crystal: "0", deuterium: "0" },
  demolitionSeconds: 768 / 55, rebuildSeconds: 1536 / 55, demolitionSecondsRational: "768/55", rebuildSecondsRational: "1536/55",
  cap9: 2920000, cap8: 1590000, used9: 124, used8: 123, totalFields: 173, grantFloor: 89,
  originWallet: { metal: "2920000", crystal: "422694.07506993704", deuterium: "50827.623029905495" },
  grossPerSecond: { metal: 578.1007209732234, crystal: 384.44214731548226, deuterium: 244.20297428190867 },
  walletAbsoluteTolerance: 0.000001,
  walletToleranceScope: "Absolute 1e-6 units for integration-only wallet/lifetime decimal predictions. Exact fee/refund integers, identities, serialized engine comparisons, saved timers and old-state projections receive no tolerance.",
} as const;
export const DEMOLITION_MILESTONES = ["origin", "selectedHome", "previewDismissed", "firstPaid", "firstTwoSeconds", "firstRefunded", "secondPaid", "partialFiveSeconds", "partialReloaded", "demolitionComplete", "rebuildPaid", "rebuildComplete", "completeReloaded", "later"] as const;

/** Deliberately synthetic boundary fixtures, never a natural milestone or earned unlock.
 * After the enumerated setup, all work/control transitions use ordinary APIs.
 */
export function syntheticDemolitionBoundaries(epoch: number, naturalPaid: ReturnType<typeof serializeState>) {
  const expected: Record<string, ReturnType<typeof serializeState>> = {}, saves: Record<string, ReturnType<typeof importSave>> = {};
  const put = (key: string, value: GameState, elapsed: number, expectedNpcAge = elapsed) => {
    assertNpcEconomy(value, expectedNpcEconomy(Array(expectedNpcAge).fill(1)), `${key}: independently accounted synthetic trajectory`);
    const prior = serializeState(value), save = importSave(exportSave(value, epoch + elapsed * 1000));
    exactEvidence(prior, save.state, `${key}: synthetic oracle strict serializer`);
    const restored = deserializeState(save.state); exactEvidence(serializeState(restored), prior, `${key}: synthetic oracle strict adopted reload`);
    exactEvidence(serializeState(tick(restored, 0, "offline")), prior, `${key}: zero-gap startup preserves every oracle field`);
    expected[key] = prior; saves[key] = save; return restored;
  };
  const accepted = (result: { ok: boolean; reason: string; state: GameState }) => { requireEvidence(result.ok, result.reason); return result.state; };
  let robot = createInitialState(20261011, 11334455);
  activePlanet(robot).buildings.robotics_factory = 2;
  activePlanet(robot).resources = { metal: big(10000), crystal: big(10000), deuterium: big(10000) };
  robot.manualClicks = 100; robot = refreshUnlocks(robot);
  robot = equipCard(robot, 0, "auto_collect").state; robot = toggleSlot(robot, 0, false);
  robot = equipCard(robot, 1, "auto_collect").state;
  robot = tick(robot, 0, "live"); // Settle the synthetic setup through the normal zero-time achievement path before a native reload.
  robot = put("syntheticRobotBase", robot, 0);
  requireEvidence(unlockedSlotCount(robot) === 2 && robot.research.levels.computer_tech === 0 && robot.protocols.slots[1]!.card?.enabled, "Independent robot2/computer0/slot2-on fixture");
  const quote = quoteDemolition(robot, "robotics_factory"); requireEvidence(quote.ok && quote.quote, quote.reason);
  exactEvidence(Object.fromEntries(Object.entries(quote.quote.paid).map(([id, value]) => [id, value.toString()])), { metal: "400", crystal: "120", deuterium: "200" }, "Independent robot2→1 three-resource fee");
  requireEvidence(quote.quote.totalSeconds === 1 && quote.quote.currentSlots === 2 && quote.quote.nextSlots === 1, "Independent robot2→1 minimum time and exact slot count");
  exactEvidence(quote.quote.relockedSlots, [2], "Independent visible relocked slot number");
  robot = put("syntheticRobotPaid", accepted(commitDemolition(robot, quote.quote)), 0);
  robot = put("syntheticRobotLocked", tick(robot, 1, "live"), 1);
  requireEvidence(activePlanet(robot).buildings.robotics_factory === 1 && !activePlanet(robot).demolition && unlockedSlotCount(robot) === 1 && robot.protocols.slots[1]!.card?.enabled, "Actual robot completion relocks while preserving enabled configuration");
  for (const mode of ["Off", "Clear"] as const) {
    let state = deserializeState(expected.syntheticRobotLocked!);
    state = put(`syntheticRobot${mode}`, mode === "Off" ? toggleSlot(state, 1, false) : clearSlot(state, 1), 1);
    const result = enqueue(state, "robotics_factory", "manual"); requireEvidence(result.ok, result.reason); state = result.state;
    const job = activePlanet(state).buildQueue[0]!;
    exactEvidence(Object.fromEntries(Object.entries(job.paid).map(([id, value]) => [id, value.toString()])), { metal: "800", crystal: "240", deuterium: "400" }, "Independent ordinary robot2 rebuild fee");
    requireEvidence(job.jobId === 2 && job.totalSeconds === 1 && job.targetLevel === 2, "Independent ordinary robot rebuild ID/time/level");
    state = put(`syntheticRobot${mode}RebuildPaid`, state, 1);
    state = put(`syntheticRobot${mode}Unlocked`, tick(state, 1, "live"), 2);
    requireEvidence(unlockedSlotCount(state) === 2 && activePlanet(state).buildings.robotics_factory === 2 && (mode === "Off" ? state.protocols.slots[1]!.card?.enabled === false : state.protocols.slots[1]!.card === null), "Ordinary real rebuild cannot revive explicitly disabled/cleared locked card");
  }
  let paid = deserializeState(naturalPaid);
  // firstPaid follows exactly the one adopted original live second; manual actions consume no time.
  assertNpcEconomy(naturalPaid, expectedNpcEconomy([1]), "natural firstPaid handoff age");
  paid = put("naturalCurvaturePaid", paid, 0, 1);
  const evaluation = evaluatePrestige(paid); requireEvidence(evaluation.gain.gte(1), "The unchanged naturally earned paid handoff must actually qualify for prestige");
  const confirmation = prestigeConfirmation(paid, evaluation);
  put("naturalCurvatureReset", prestige(paid), 0, 1);
  return { classification: "Explicit synthetic boundary fixtures, separate from natural source and economic loop. Robot setup seeds robot2/computer0, three resources10000, manualClicks100 and two auto-collect cards through equip APIs, slot1 off/slot2 on, then settles ordinary zero-time achievements before saving. Those setup values are not earned. The separate curvature branch uses the unchanged actual natural paid handoff, whose existing lifetime already qualifies; no eligibility injection.",
    robot: { base: saves.syntheticRobotBase, golden: { fromLevel: 2, toLevel: 1, computerLevel: 0, paid: { metal: "400", crystal: "120", deuterium: "200" }, rebuildPaid: { metal: "800", crystal: "240", deuterium: "400" }, seconds: 1, rebuildSeconds: 1, jobId: 1, rebuildJobId: 2, relockedSlots: [2] } },
    prestige: { base: saves.naturalCurvaturePaid, confirmation, classification: "Unchanged actual natural firstPaid handoff, separate from the continuous economic loop; no synthetic eligibility or wallet changes." }, saves, expected };
}

async function main(): Promise<void> {
  const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string)]);
  const [path, expectedHash, expectedSha] = process.argv.slice(2);
  requireEvidence(process.argv.length === 5 && /^[0-9a-f]{64}$/.test(expectedHash ?? "") && /^[0-9a-f]{40}$/.test(expectedSha ?? ""), "Usage: REPORT INDEPENDENT_REPORT_SHA256 CANDIDATE_SOURCE_SHA");
  const bytes = readFileSync(path), hash = String(createHash("sha256").update(bytes).digest("hex"));
  requireEvidence(hash === expectedHash, "Natural demolition report bytes differ from independent hash");
  const report = JSON.parse(String(bytes));
  const git = (args: string[]) => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
  const sourceScope = git(["status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github"]);
  requireEvidence(git(["rev-parse", "HEAD"]) === expectedSha && sourceScope === "", "Formal fixture requires exact clean candidate source");
  requireEvidence(report.schema === "infinity-demolition-natural-growth-v1" && report.outcome.status === "passed" && report.source.sourceSha === expectedSha && report.source.gitHead === expectedSha && report.source.sourceScopeStatusPorcelain === "", "Natural demolition report is not from the passing clean candidate source");
  requireEvidence(report.origin.reportSha256 === DEMOLITION_GOLDEN.sourceReportSha256 && report.origin.sourceSha === DEMOLITION_GOLDEN.sourceSha, "Natural origin is not the independently pinned green r10 report");
  requireEvidence(report.provenance.injectedGameState === false && report.provenance.unchangedSourceEnvelope === true && report.provenance.replayedOneOriginalLiveTick === true, "Natural origin/provenance incomplete");
  exactEvidence(report.golden, DEMOLITION_GOLDEN, "Independent fixed golden contract");
  const expected: Record<string, ReturnType<typeof serializeState>> = {};
  const milestones: Record<string, unknown> = {};
  for (const key of DEMOLITION_MILESTONES) {
    const matches = report.milestones.filter((row: { name: string }) => row.name === key);
    requireEvidence(matches.length === 1, `Missing/duplicate milestone ${key}`); const row = matches[0];
    requireEvidence(row.strictRoundtrips === 2 && row.stateAdoptedFromReload && row.save.schema === SAVE_SCHEMA && row.save.version === SAVE_VERSION && row.save.revision === SAVE_REVISION && SAVE_REVISION === 13 && row.save.savedAt === row.save.lastTickAt, `Incomplete strict current save ${key}`);
    assertNpcEconomy(row.save.state, expectedNpcEconomy(row.npcAdoptedSegmentsSeconds), `${key}: one original adopted second plus counted natural continuation`);
    const parsed = importSave(JSON.stringify(row.save)), state = deserializeState(parsed.state);
    exactEvidence(parsed, row.save, `${key}: entire strict envelope unchanged`);
    exactEvidence(serializeState(state), row.save.state, `${key}: entire strict state unchanged`);
    exactEvidence(importSave(exportSave(state, row.save.savedAt, row.save.lastTickAt)), row.save, `${key}: complete serializer roundtrip`);
    expected[key] = serializeState(state); milestones[key] = row;
  }
  const source = report.origin.originalSave;
  requireEvidence(source.revision === 10 && source.savedAt === source.lastTickAt, "Source raw envelope must stay unchanged r10");
  const imported = importSave(JSON.stringify(source));
  projectR13ZeroToR10(imported.state, source.state);
  exactEvidence({ ...imported, revision: 10, state: source.state }, source, "Migration preserves every envelope field except revision");
  const synthetic = syntheticDemolitionBoundaries(report.milestones.find((row: { name: string }) => row.name === "origin").save.savedAt, expected.firstPaid!);
  Object.assign(expected, synthetic.expected);
  process.stdout.write(JSON.stringify({ schema: "infinity-demolition-browser-fixture-v1", key: STORAGE_KEY, homeId: DEMOLITION_GOLDEN.homeId, colonyId: DEMOLITION_GOLDEN.colonyId,
    description: "Unchanged green r10 serializer envelope, explicit zero-age r13 migration, one original live tick, then one natural cancel/re-pay/reload/demolish/ordinary-rebuild loop. Four-width views are layout evidence, not four economic loops.",
    source: { reportSha256: hash, sourceSha: expectedSha, gitHead: report.source.gitHead, sourceScopeStatusPorcelain: report.source.sourceScopeStatusPorcelain, oracleSourceScopeStatusPorcelain: sourceScope },
    origin: report.origin, originalSave: source, originalSaveRaw: report.origin.originalSaveRaw, importedSave: imported, base: report.milestones.find((row: { name: string }) => row.name === "origin").save,
    golden: DEMOLITION_GOLDEN, naturalMilestones: milestones, expected, synthetic, events: report.events, outcome: report.outcome,
  }, null, 2) + "\n");
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/demolition-fixture.ts")) await main();
