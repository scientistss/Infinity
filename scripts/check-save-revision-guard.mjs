/** The actual fixed r11 reader must reject native r12 zero and advanced NPC economies. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportSave, importSave, deserializeState } from "../src/game/save.ts";
import { createInitialState } from "../src/game/state.ts";
import { SAVE_REVISION } from "../src/game/content.ts";
import { big } from "../src/game/decimal.ts";
import { quoteDemolition, commitDemolition } from "../src/game/demolition.ts";
import { tick } from "../src/game/logic.ts";

const root = process.argv[2], SOURCE = "ca5ef0c769856f2c4c8925e76a5c7d322822fe1b";
if (!root) throw Error("Provide the verified preceding source directory");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), SOURCE);
execFileSync("git", ["diff", "--exit-code", SOURCE, "--", "src"], { cwd: root });
assert.equal(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "src"], { cwd: root, encoding: "utf8" }).trim(), "", "Fixed source must not contain untracked implementation files");
const previous = await import(pathToFileURL(resolve(root, "src/game/save.ts")).href);
const previousContent = await import(pathToFileURL(resolve(root, "src/game/content.ts")).href);
assert.equal(SAVE_REVISION, 12, "This boundary protects independently adopted NPC economy age");
assert.equal(previousContent.SAVE_REVISION, 11, "Guard must load the actual fixed r11 reader");
assert.equal(previousContent.SAVE_VERSION, 9);
const state = createInitialState(42, 43);
const empty = exportSave(state, 1_000_000);
assert.equal(JSON.parse(empty).state.planets[0].demolition, null);
assert.deepEqual(JSON.parse(empty).state.npcEconomy, { model: "fixed-production-v1", elapsedSeconds: 0 });
assert.throws(() => previous.importSave(empty), /修订不兼容/, "Actual r11 reader must reject a true r12 zero-age economy");
state.planets[0].buildings.metal_mine = 10;
state.planets[0].resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
state.research.levels.ion_tech = 1;
const quote = quoteDemolition(state, "metal_mine");
assert.equal(quote.ok, true, quote.reason);
const committed = commitDemolition(state, quote.quote);
assert.equal(committed.ok, true, committed.reason);
const candidate = exportSave(tick(committed.state, 0.25), 1_000_250);
assert.deepEqual(JSON.parse(candidate).state.npcEconomy, { model: "fixed-production-v1", elapsedSeconds: 0.25 });
const job = JSON.parse(candidate).state.planets[0].demolition;
assert.equal(job.paid.metal, "1476");
assert.ok(Math.abs(job.totalSeconds - 4.6104) <= Number.EPSILON * 4.6104, "Existing buildSeconds binary64 evaluation stays within one ULP of the independent time golden");
assert.ok(job.remainingSeconds > 0 && job.remainingSeconds < job.totalSeconds);
assert.throws(() => previous.importSave(candidate), /修订不兼容/, "Actual r11 reader must reject a true serializer-emitted advanced r12 economy");
const historical = JSON.parse(readFileSync(new URL('../tests/fixtures/npc-economy-r11.json', import.meta.url), 'utf8'));
assert.equal(historical.sourceSha, SOURCE);
for (const row of historical.rows) {
  const old = previous.importSave(row.raw);
  assert.deepEqual(old, row.oldReaderOutput);
  const adopted = importSave(row.raw);
  assert.deepEqual(adopted.state.npcEconomy, { model: 'fixed-production-v1', elapsedSeconds: 0 });
  const projected = structuredClone(adopted.state); delete projected.npcEconomy;
  assert.deepEqual(projected, old.state, `${row.id}: every old paid job/grant/wallet/clock remains identical`);
  const rewritten = exportSave(deserializeState(adopted.state), old.savedAt);
  assert.throws(() => previous.importSave(rewritten), /修订不兼容/, `${row.id}: old reader cannot discard new age`);
}
console.log(JSON.stringify({ currentRevision: SAVE_REVISION, previousSource: SOURCE,
  previousReader: `v${previousContent.SAVE_VERSION}/r${previousContent.SAVE_REVISION}`,
  nativeCases: ["zero-age-empty-slot", "advanced-age-actual-paid-partial-demolition", ...historical.rows.map(row => `genuine-r11:${row.id}`)], result: "rejected as required" }));
