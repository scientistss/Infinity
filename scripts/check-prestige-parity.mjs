/** Full-state prestige parity against the independently archived, last-green r8 engine.
 * Usage: node --import tsx scripts/check-prestige-parity.mjs /path/to/6016391
 * Synthetic engine-built fixtures only; no production saves and no field projection.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as currentSave from "../src/game/save.ts";
import { evaluatePrestige } from "../src/game/logic.ts";
import { buildPrestigeFixtures } from "./prestige-r8-fixtures.ts";

const root = process.argv[2];
if (!root) throw Error("Provide the verified 6016391 r8 source directory");
const baseline = "6016391ed947e72b6e53d5307091c152c0c69079";
const hashes = {
  logic: "0c31561a5116b04fe284d9203cc18cdcf44cd844797ff091e56ab06f2215687e",
  state: "99812f43c1d911dfbec282a02c9fa2e009e9e78118e3ce3f6988c48682a6ff21",
  save: "470679db2ae643ae948237dc6a5d47e47be6428acc05d73acd9a6562b1979354",
};
for (const [name, expected] of Object.entries(hashes)) {
  assert.equal(createHash("sha256").update(readFileSync(resolve(root, `src/game/${name}.ts`))).digest("hex"), expected,
    `Historical ${name} must be the reviewed unchanged ${baseline} source`);
}
const paths = { state: "game/state", save: "game/save", decimal: "game/decimal", logic: "game/logic", orders: "game/orders",
  formations: "game/formations", templates: "game/research-templates", yard: "game/shipyard", queue: "game/queue", fleet: "game/fleet",
  empire: "game/empire", arcade: "game/arcade", engine: "automation/engine", deep: "game/deep-space", content: "game/content" };
const old = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await import(pathToFileURL(resolve(root, `src/${path}.ts`)).href)])));
assert.equal(old.content.SAVE_REVISION, 8);
assert.equal(old.content.SAVE_VERSION, 9);
assert.equal("evaluatePrestige" in old.logic, false, "This must run the actual preceding prestige implementation");
const fixtures = buildPrestigeFixtures(old);
for (const multiplier of [0, 0.99999, 1, 3.99999, 4, 9]) {
  const state = old.state.createInitialState(20261010);
  state.arcade.seed = 771;
  state.lifetime.metal = old.decimal.big(old.content.PRESTIGE_SCORE_UNIT).mul(multiplier).div(old.content.SCORE_WEIGHTS.metal);
  fixtures[`threshold-${multiplier}`] = old.save.deserializeState(old.save.importSave(old.save.exportSave(old.logic.tick(state, 0), 1234)).state);
}
const reward = old.state.createInitialState(20261010);
reward.arcade.seed = 771;
reward.research.levels.astrophysics = 1;
reward.lifetime.metal = old.decimal.big(old.content.PRESTIGE_SCORE_UNIT).mul(4).div(old.content.SCORE_WEIGHTS.metal);
// Deliberately unsettled achievement case: the candidate, and only the candidate, rolls a bonus.
fixtures["unsettled-achievement"] = old.save.deserializeState(old.save.serializeState(reward));
const precision = old.save.deserializeState(old.save.serializeState(fixtures["threshold-9"]));
precision.warpCores = old.decimal.big("1e100");
fixtures["precision-swallowed-cores"] = old.save.deserializeState(old.save.serializeState(precision));
const huge = old.save.deserializeState(old.save.serializeState(precision));
huge.lifetime.metal = old.decimal.big("1e1000");
fixtures["huge-score"] = old.save.deserializeState(old.save.serializeState(huge));
const results = [];
for (const [name, before] of Object.entries(fixtures)) {
  const raw = old.save.serializeState(before);
  const current = currentSave.deserializeState(raw);
  assert.deepEqual(currentSave.serializeState(current), raw, `${name}: canonical reader must preserve the actual old input`);
  const expected = old.logic.prestige(before);
  const evaluation = evaluatePrestige(current);
  assert.equal(evaluation.gain.toString(), old.logic.warpGain(before).toString(), `${name}: nominal gain`);
  assert.deepEqual(currentSave.serializeState(evaluation.next), old.save.serializeState(expected), `${name}: complete serialized state`);
  assert.deepEqual(old.save.serializeState(before), raw, `${name}: archived input was mutated`);
  assert.deepEqual(currentSave.serializeState(current), raw, `${name}: current input was mutated`);
  assert.equal(evaluation.next === current, expected === before, `${name}: threshold reference identity`);
  const restored = currentSave.deserializeState(currentSave.importSave(currentSave.exportSave(evaluation.next, 1234)).state);
  assert.deepEqual(currentSave.serializeState(restored), currentSave.serializeState(evaluation.next), `${name}: candidate reader roundtrip`);
  results.push({ name, gain: evaluation.gain.toString(), launches: evaluation.next.stats.launches });
}
console.log(JSON.stringify({ baseline, result: "passed", comparisons: results.length, projection: "none: every serialized field",
  scope: "Actual old-r8 APIs, stored seeds, settled readers, paid queues, old formation origin, templates, owned transport phases, ring authority, deep rewards and threshold/achievement boundaries", scenarios: results }, null, 2));
