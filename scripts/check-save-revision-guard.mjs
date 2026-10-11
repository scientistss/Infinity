/** The actual fixed r10 reader must reject both native r11 empty and active slots. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportSave } from "../src/game/save.ts";
import { createInitialState } from "../src/game/state.ts";
import { SAVE_REVISION } from "../src/game/content.ts";
import { big } from "../src/game/decimal.ts";
import { quoteDemolition, commitDemolition } from "../src/game/demolition.ts";
import { tick } from "../src/game/logic.ts";

const root = process.argv[2], SOURCE = "ac3cce98403bea1e7162bcb4092e4cfeeb448a9a";
if (!root) throw Error("Provide the verified preceding source directory");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), SOURCE);
execFileSync("git", ["diff", "--exit-code", SOURCE, "--", "src"], { cwd: root });
assert.equal(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "src"], { cwd: root, encoding: "utf8" }).trim(), "", "Fixed source must not contain untracked implementation files");
const previous = await import(pathToFileURL(resolve(root, "src/game/save.ts")).href);
const previousContent = await import(pathToFileURL(resolve(root, "src/game/content.ts")).href);
assert.equal(SAVE_REVISION, 11, "This boundary protects independent r11 manual demolition");
assert.equal(previousContent.SAVE_REVISION, 10, "Guard must load the actual fixed r10 reader");
assert.equal(previousContent.SAVE_VERSION, 9);
const state = createInitialState(42, 43);
const empty = exportSave(state, 1_000_000);
assert.equal(JSON.parse(empty).state.planets[0].demolition, null);
assert.throws(() => previous.importSave(empty), /修订不兼容/, "Actual r10 reader must reject a true r11 empty slot");
state.planets[0].buildings.metal_mine = 10;
state.planets[0].resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
state.research.levels.ion_tech = 1;
const quote = quoteDemolition(state, "metal_mine");
assert.equal(quote.ok, true, quote.reason);
const committed = commitDemolition(state, quote.quote);
assert.equal(committed.ok, true, committed.reason);
const candidate = exportSave(tick(committed.state, 0.25), 1_000_250);
const job = JSON.parse(candidate).state.planets[0].demolition;
assert.equal(job.paid.metal, "1476");
assert.ok(Math.abs(job.totalSeconds - 4.6104) <= Number.EPSILON * 4.6104, "Existing buildSeconds binary64 evaluation stays within one ULP of the independent time golden");
assert.ok(job.remainingSeconds > 0 && job.remainingSeconds < job.totalSeconds);
assert.throws(() => previous.importSave(candidate), /修订不兼容/, "Actual r10 reader must reject a true serializer-emitted active r11 job");
console.log(JSON.stringify({ currentRevision: SAVE_REVISION, previousSource: SOURCE,
  previousReader: `v${previousContent.SAVE_VERSION}/r${previousContent.SAVE_REVISION}`,
  nativeCases: ["empty-slot", "actual-paid-partial-demolition"], result: "rejected as required" }));
