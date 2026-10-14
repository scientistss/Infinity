/** Strict handoff. Produces no funds, research, ships, reports or clock overlays.
 * node --import tsx scripts/npc-economy-browser-fixture.ts REPORT REPORT_SHA256 SOURCE_SHA
 * Its report may only come from the real pinned ca5 reader/exporter + current
 * paid research/probe/two-scout continuation. Native evidence is a separate gate.
 */
declare const process: { argv: string[]; stdout: { write(text: string): void } };
import { expectedNpcEconomy, assertNpcEconomy, projectVerifiedNpcEconomy } from "./r16-compatibility.mjs";
import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION, STORAGE_KEY } from "../src/game/content";
import { deserializeState, exportSave, importSave, serializeState } from "../src/game/save";
import { exactEvidence as exact, requireEvidence as check } from "./demolition-fixture";
import { NPC_SCOUT_UI_SELECTION } from "./npc-scout-ui-selection";

export const NPC_NATURAL_MILESTONES = [
  "origin-migrated-r11-age-zero", "selected-home", "research-paid-unfinished", "research-complete",
  "probe-paid-unfinished", "probe-complete", "first-scout-outbound", "first-snapshot-returning",
  "first-probe-returned", "ordinary-wait-complete", "second-scout-outbound",
  "second-scout-halfway-native-free-strict-reload", "second-snapshot-returning", "final-returned-and-reloaded",
] as const;
const ACTIVE_SCOUT_MILESTONES: Partial<Record<typeof NPC_NATURAL_MILESTONES[number], number>> = {
  "first-scout-outbound": 4, "first-snapshot-returning": 4,
  "second-scout-outbound": 5, "second-scout-halfway-native-free-strict-reload": 5, "second-snapshot-returning": 5,
};

async function main(): Promise<void> {
  const [{ readFileSync }, { createHash }, { execFileSync }] = await Promise.all([
    import("node:fs" as string), import("node:crypto" as string), import("node:child_process" as string),
  ]);
  const [path, expectedHash, expectedSha] = process.argv.slice(2);
  check(process.argv.length === 5 && /^[0-9a-f]{64}$/.test(expectedHash ?? "") && /^[0-9a-f]{40}$/.test(expectedSha ?? ""), "Usage: REPORT INDEPENDENT_REPORT_SHA256 CANDIDATE_SOURCE_SHA");
  const hash = (bytes: string | Uint8Array): string => String(createHash("sha256").update(bytes).digest("hex"));
  const bytes = readFileSync(path), report = JSON.parse(String(bytes));
  check(hash(bytes) === expectedHash, "Independent natural report digest differs");
  const git = (...args: string[]): string => String(execFileSync("git", args, { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000 })).trimEnd();
  const sourceScope = git("status", "--porcelain=v1", "--untracked-files=all", "--", "src", "scripts", "tests", "public", ":(glob)*.json", ":(glob)*.ts", ":(glob)*.mjs", "index.html", ".github");
  check(git("rev-parse", "HEAD") === expectedSha && sourceScope === "" && git("ls-files", "--others", "--ignored", "--exclude-standard", "--", "src") === "", "Formal fixture requires exact clean candidate source");
  check(report.schema === "infinity-npc-natural-r11-route-v1" && report.outcome.status === "passed"
    && report.source.sourceSha === expectedSha && report.source.gitHead === expectedSha && report.source.sourceScopeStatusPorcelain === "", "Passing natural report must bind exact clean candidate source");
  check(report.source.historicalProducer.sourceSha === "ca5ef0c769856f2c4c8925e76a5c7d322822fe1b"
    && report.source.historicalProducer.sourceScopeStatusPorcelain === "" && report.source.historicalProducer.sourceFiles.length > 0, "Historical producer must be clean, complete pinned ca5 source");
  check(SAVE_SCHEMA === "infinity-original-p4" && SAVE_VERSION === 9 && SAVE_REVISION === 16, "Exact r16 acceptance only");
  check(report.provenance.originalBytesUnchanged && report.provenance.injectedGameState === false
    && report.provenance.noWalletTechnologyShipClockInjection && report.provenance.exactHistoricalControl, "Natural provenance incomplete");
  const origin = report.origin;
  check(hash(origin.originalSaveRaw) === origin.originalSaveSha256 && origin.originalSaveSha256 === "d456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a"
    && new TextEncoder().encode(origin.originalSaveRaw).length === 35551, "Original ac3/r10 bytes changed");
  check(hash(origin.r11Raw) === origin.r11Sha256 && origin.r11Save.revision === 11 && !Object.hasOwn(origin.r11Save.state, "npcEconomy"), "Real r11 handoff is missing or altered");
  exact(JSON.parse(origin.r11Raw), origin.r11Save, "Actual ca5 raw r11 handoff");
  const importedSave = importSave(origin.r11Raw);
  const projected = projectVerifiedNpcEconomy(importedSave.state,expectedNpcEconomy(),"pure r11 migration zero rights");
  exact(projected, origin.r11Save.state, "Every old r11 field preserved");
  exact(importedSave.state.npcEconomy, expectedNpcEconomy(), "No historical retroactive production");
  const expected: Record<string, ReturnType<typeof serializeState>> = {};
  const milestones: Record<string, unknown> = {};
  for (const key of NPC_NATURAL_MILESTONES) {
    const rows = report.milestones.filter((row: { name: string }) => row.name === key);
    check(rows.length === 1, `Missing/duplicate ${key}`);
    const row = rows[0];
    check(row.strictRoundtrips === 2 && row.stateAdoptedFromReload && row.save.revision === 16
      && row.save.savedAt === row.save.lastTickAt && row.rawSha256 === hash(row.raw), `${key}: complete strict adopted handoff required`);
    exact(JSON.parse(row.raw), row.save, `${key}: full raw envelope`);
    assertNpcEconomy(row.save.state, row.npcWallet, `${key}: independently witnessed old-engine wallet`);
    const parsed = importSave(row.raw), state = deserializeState(parsed.state);
    exact(parsed, row.save, `${key}: strict complete envelope`);
    exact(serializeState(state), row.save.state, `${key}: full state roundtrip`);
    exact(exportSave(state, row.save.savedAt, row.save.lastTickAt), row.raw, `${key}: canonical exact output bytes`);
    const scoutId = ACTIVE_SCOUT_MILESTONES[key];
    exact(state.fleets.length, scoutId === undefined ? 0 : 1, `${key}: exact natural-route fleet count`);
    if (scoutId !== undefined) {
      exact(state.fleets[0].id, scoutId, `${key}: original paid scout identity`);
      exact(state.fleets[0].ships, NPC_SCOUT_UI_SELECTION, `${key}: exact real UI ship selection, including legal zeros`);
    }
    expected[key] = serializeState(state); milestones[key] = row;
  }
  exact(importedSave.state, expected["origin-migrated-r11-age-zero"], "First milestone is pure actual r11 migration");
  check(report.outcome.totalGameSeconds === "25876" && report.timing.adoptedContinuationGameSeconds === 66
    && report.outcome.finalProbeCount === 1 && report.outcome.nextFleetId === 6, "Actual natural route IDs/time/ship conservation");
  exact(report.outcome.realDebits, { metal: 1600, crystal: 1000, deuterium: 2408 }, "Independent real research/probe/two-flight payment total");
  const branches = report.branches;
  check(branches.legacyIdentity.sourceSha === report.source.historicalProducer.sourceSha
    && hash(branches.legacyIdentity.raw) === branches.legacyIdentity.rawSha256, "Genuine old identity branch must bind historical producer");
  exact(importSave(branches.legacyIdentity.raw), branches.legacyIdentity.migratedSave, "Old identity reports preserved by actual migration");
  for (const value of [branches.curvature.base, branches.curvature.expected, branches.offline.base, branches.offline.expected]) {
    exact(importSave(JSON.stringify(value)), value, "Branch strict current complete envelope");
  }
  check(branches.offline.rawGapSeconds === 100000 && branches.offline.appliedSeconds === 7200 && branches.offline.sameTimeReloadApplied === 0,
    "Offline branch proves one actual adopted cap and no repeated remainder");
  process.stdout.write(JSON.stringify({ schema: "infinity-npc-economy-browser-fixture-v1", key: STORAGE_KEY, homeId: "homeworld", colonyId: "colony-1",
    description: "Real r10 bytes → pinned ca5 reader/exporter r11 at unchanged clocks → r14 age0. Actual native research/probe/scouts; current domain milestones are a full-state oracle, with separate independent payment/stock goldens.",
    source: { reportSha256: expectedHash, sourceSha: expectedSha, gitHead: report.source.gitHead, sourceScopeStatusPorcelain: report.source.sourceScopeStatusPorcelain, oracleSourceScopeStatusPorcelain: sourceScope },
    origin, originalSave: origin.r11Save, originalSaveRaw: origin.r11Raw, importedSave,
    base: (milestones["origin-migrated-r11-age-zero"] as { save: unknown }).save,
    golden: report.literalGoldens, naturalMilestones: milestones, expected, branches, outcome: report.outcome,
  }, null, 2) + "\n");
}
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/npc-economy-browser-fixture.ts")) await main();
