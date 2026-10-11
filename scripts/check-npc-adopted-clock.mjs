/** Exact prior-engine segment witness and r12 full-state adoption, no browser clock changes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';
import { oracle as r10Oracle } from './r10-startup-oracle.mjs';
import * as currentSave from '../src/game/save.ts';
import { catchUp as currentCatchUp } from '../src/core/offline.ts';

const [r10Root, r11Root] = process.argv.slice(2);
assert.ok(r10Root && r11Root, 'Provide exact ac3 r10 and ca5 r11 checkout roots');
const pins = ['ac3cce98403bea1e7162bcb4092e4cfeeb448a9a', 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'];
const modules = [];
for (const [index, root] of [r10Root, r11Root].entries()) {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), pins[index]);
  execFileSync('git', ['diff', '--exit-code', pins[index], '--', 'src', 'package.json', 'package-lock.json'], { cwd: root });
  assert.equal(execFileSync('git', ['ls-files', '--others', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim(), '');
  const load = path => import(pathToFileURL(resolve(root, `src/${path}.ts`)).href);
  const [save, state, offline] = await Promise.all(['game/save', 'game/state', 'core/offline'].map(load));
  modules.push({ save, state, offline });
}
const [r10, r11] = modules;
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/npc-economy-r11.json', import.meta.url), 'utf8'));
assert.equal(fixture.sourceSha, pins[1]);
const sha = raw => createHash('sha256').update(raw).digest('hex');
const cases = fixture.rows.map(row => {
  assert.equal(sha(row.raw), row.rawSha256);
  assert.deepEqual(r11.save.importSave(row.raw), row.oldReaderOutput);
  return { name: `r11:${row.id}`, revision: 11, raw: row.raw, source: r11 };
});
cases.push({ name: 'r10:natural-original', revision: 10, source: r10,
  raw: readFileSync(new URL('../tests/fixtures/demolition-origin-r10-save.json', import.meta.url), 'utf8') });
for (const hours of [0, 6]) {
  const state = r10.state.createInitialState(20261010, 20261010);
  // Explicit synthetic old-source setting exercises the existing 2h/8h caps.
  state.offlineBonusHours = hours;
  cases.push({ name: `r10:synthetic-fresh-bonus${hours}`, revision: 10, source: r10,
    raw: r10.save.exportSave(state, 1791590400000) });
}
const rows = [];
for (const scenario of cases) for (const milliseconds of [-1000, 0, 1, 17, 381, 424, 1000, 60000, 7200000, 100000000]) {
  const { source, raw } = scenario, oldEnvelope = source.save.importSave(raw);
  const oldState = source.save.deserializeState(oldEnvelope.state);
  const witness = captureAdoptedSteps(oldState, state => source.offline.catchUp(state, milliseconds / 1000), source.save.serializeState);
  const adopted = currentSave.importSave(raw);
  assert.deepEqual(adopted.state.npcEconomy, { model: 'fixed-production-v1', elapsedSeconds: 0 });
  const result = currentCatchUp(currentSave.deserializeState(adopted.state), milliseconds / 1000);
  const actual = currentSave.serializeState(result.state), expected = source.save.serializeState(witness.result.state);
  if (scenario.revision === 10) for (const planet of expected.planets) planet.demolition = null;
  expected.npcEconomy = { model: 'fixed-production-v1', elapsedSeconds: witness.npcElapsedSeconds };
  assert.deepEqual(actual, expected, `${scenario.name}/${milliseconds}: full historical state and independently observed NPC age`);
  if (scenario.revision === 10) {
    const oracle = await r10Oracle(r10Root, raw, oldEnvelope.lastTickAt + milliseconds);
    assert.deepEqual(oracle.adoptedSegmentsSeconds, witness.adoptedSegmentsSeconds);
    assert.equal(oracle.npcElapsedSeconds, witness.npcElapsedSeconds);
  }
  rows.push({ case: scenario.name, milliseconds, inputSha256: sha(raw), appliedSeconds: result.appliedSeconds,
    segmentCount: witness.adoptedSegmentsSeconds.length, npcElapsedSeconds: witness.npcElapsedSeconds, fullStateEqual: true });
}
const fresh = currentSave.exportSave(currentSave.deserializeState(currentSave.importSave(fixture.rows[0].raw).state), 1791590400000);
assert.equal(JSON.parse(fresh).revision, 12);
assert.throws(() => r11.save.importSave(fresh), /修订不兼容/, 'Actual archived ca5 reader rejects actual new r12 output');
console.log(JSON.stringify({ schema: 'infinity-npc-adopted-clock-check-v1', sourcePins: pins,
  cases: cases.length, comparisons: rows.length, actualOldReaderRejectsR12: true,
  observation: 'Fixed old engine with/without read-only totalTime.add observer; exact entire state before r12 extension',
  rows, result: 'passed' }, null, 2));
