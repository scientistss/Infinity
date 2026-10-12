/** Exact pinned r13 catchUp, no candidate state used as expected data. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { oracle, assertPinnedSource, SOURCE_SHA, dependencyIdentity, DEPENDENCIES } from './r14-r13-startup-oracle.mjs';
const root = resolve(process.env.R13_ORACLE_SOURCE || '/tmp/infinity-r13-startup-source');
assertPinnedSource(root); assert.deepEqual(dependencyIdentity(root), DEPENDENCIES);
const [save, state, logic, offline] = await Promise.all(['game/save', 'game/state', 'game/logic', 'core/offline']
  .map(name => import(pathToFileURL(resolve(root, `src/${name}.ts`)).href)));
const at = 1_792_000_000_000;
const sourceRaw = seconds => save.exportSave(logic.tick(state.createInitialState(42, 43), seconds), at);
async function verify(raw, milliseconds) {
  const read = save.importSave(raw), now = read.lastTickAt + milliseconds, result = await oracle(root, raw, now);
  const expected = offline.catchUp(save.deserializeState(read.state), milliseconds / 1000);
  assert.equal(result.schema, 'infinity-fixed-r13-startup-oracle-v1'); assert.equal(result.sourceSha, SOURCE_SHA);
  assert.equal(result.sourceRevision, 13); assert.deepEqual(result.sourceState, read.state); assert.deepEqual(result.sourceNpc, read.state.npcEconomy);
  assert.deepEqual(result.state, save.serializeState(expected.state)); assert.equal(result.oldObservedAndUnobservedStateEqual, true);
  for (const key of ['rawSeconds', 'appliedSeconds', 'capSeconds', 'capped']) assert.equal(result[key], expected[key]);
  return result;
}
test('actual fractional, rebased and capped r13 source wallet is preserved through complete old startup', async () => {
  for (const age of [0, .1 + .2, 66, 11999.875, 12000, 18000]) for (const gap of [-1, 0, 381, 7200001]) await verify(sourceRaw(age), gap);
});
test('genuine paid r13 scouts, attacks, historical messages and resource rights use complete archived state', async () => {
  const fixtures = JSON.parse(readFileSync(new URL('../tests/fixtures/npc-scout-legacy.json', import.meta.url), 'utf8'));
  const rows = fixtures.rows.filter(row => row.revision === 13 && row.synthetic === false);
  assert.ok(rows.length >= 6, 'actual pinned natural r13 route coverage required');
  for (const row of rows) for (const gap of [0, 381, 7200001]) await verify(row.raw, gap);
});
test('older/current/future revisions, forged extra args and wrong source cannot seed the oracle', async () => {
  const raw = sourceRaw(66);
  for (const revision of [2, 11, 12, 14, 15, 999]) { const value = JSON.parse(raw); value.revision = revision; await assert.rejects(oracle(root, JSON.stringify(value), at)); }
  await assert.rejects(oracle(root, raw, at, { candidateState: {} }));
  await assert.rejects(oracle(new URL('../', import.meta.url).pathname, raw, at));
});
