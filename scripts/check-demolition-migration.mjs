/** Independent ac3 r10 reader oracle, exact raw hashes, and an exact zero-age r13 lift composed with the frozen null-only r11 contract. */
import { expectedNpcEconomy, liftR10StateToR13, projectVerifiedNpcEconomy } from "./r13-compatibility.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { importSave, deserializeState, serializeState } from "../src/game/save.ts";
const root = process.argv[2], source = "ac3cce98403bea1e7162bcb4092e4cfeeb448a9a";
if (!root) throw Error("Provide the exact fixed r10 source directory");
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), source);
execFileSync("git", ["diff", "--exit-code", source, "--", "src"], { cwd: root });
assert.equal(execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "src"], { cwd: root, encoding: "utf8" }).trim(), "", "Fixed source must not contain untracked implementation files");
const previous = await import(pathToFileURL(resolve(root, "src/game/save.ts")).href);
const content = await import(pathToFileURL(resolve(root, "src/game/content.ts")).href);
assert.equal(content.SAVE_REVISION, 10);
const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/demolition-r10.json", import.meta.url), "utf8"));
assert.equal(fixtures.sourceSha, source);
const sha = text => createHash("sha256").update(text).digest("hex");
function verify(raw, old, label) {
  assert.deepEqual(previous.importSave(raw), old, `${label}: actual fixed r10 reader output`);
  const migrated = importSave(raw);
  assert.equal(migrated.revision, 13);
  assert.equal(migrated.savedAt, old.savedAt); assert.equal(migrated.lastTickAt, old.lastTickAt);
  assert.equal(migrated.state.planets.length, old.state.planets.length);
  for (const planet of migrated.state.planets) {
    assert.equal(Object.hasOwn(planet, "demolition"), true, `${label}: explicit slot`);
    assert.equal(planet.demolition, null, `${label}: no new authority`);
  }
  assert.deepEqual(migrated.state, liftR10StateToR13(old.state, expectedNpcEconomy()), `${label}: exact zero-age NPC plus null-demolition lift`);
  const prior = { ...structuredClone(migrated), state: projectVerifiedNpcEconomy(migrated.state, expectedNpcEconomy(), label) };
  prior.revision = 10;
  for (const planet of prior.state.planets) delete planet.demolition;
  assert.deepEqual(prior, old, `${label}: no state delta beyond independently verified zero-age NPC, null slots and revision`);
  assert.deepEqual(importSave(JSON.stringify(migrated)), migrated, `${label}: idempotent cold read`);
  assert.deepEqual(serializeState(deserializeState(migrated.state)), migrated.state, `${label}: cold runtime round trip`);
}
for (const row of fixtures.rows) {
  assert.equal(sha(row.raw), row.rawSha256); assert.equal(Buffer.byteLength(row.raw), row.rawBytes);
  assert.equal(sha(row.oldReaderRaw), row.oldReaderSha256); assert.deepEqual(JSON.parse(row.oldReaderRaw), row.oldReaderOutput);
  assert.equal(JSON.parse(row.raw).revision, 10);
  verify(row.raw, row.oldReaderOutput, row.id);
}
for (const row of fixtures.legacyInputs) {
  assert.equal(sha(row.raw), row.rawSha256); assert.equal(sha(row.fixedR10Raw), row.fixedR10Sha256);
  verify(row.raw, JSON.parse(row.fixedR10Raw), row.id);
}
console.log(JSON.stringify({ source, originalManifest: fixtures.originalEvidenceManifestSha256,
  sourceRows: fixtures.rows.length, preservedLegacyInputs: fixtures.legacyInputs.length,
  oracle: "actual fixed r10 reader", delta: "revision 13, exact zero-time wallet/empty-receipt state, and one explicit null demolition slot per planet only", result: "passed" }));
