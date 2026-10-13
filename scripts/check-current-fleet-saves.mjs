// Runs after all browser measurement windows have closed. No timing is taken.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceRoot, evidenceRoot] = process.argv.slice(2);
assert.ok(sourceRoot && evidenceRoot, 'Provide target source and native evidence directories');
const source = resolve(sourceRoot), root = resolve(evidenceRoot);
const target = '7ab569045996a1a6ad8ce1aee477092144dfad74';
assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), target);
assert.equal(execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }), '');
const save = await import(pathToFileURL(resolve(source, 'src/game/save.ts')).href);
const report = JSON.parse(readFileSync(resolve(root, 'report.json'), 'utf8'));
assert.equal(report.targetSourceSha, target);
assert.equal(report.completed, true);
assert.deepEqual(report.errors, []);
const expected = [];
for (let repetition = 1; repetition <= 3; repetition++) {
  for (const kind of ['fleet-profiled', 'save-unprofiled', 'save-profiled']) expected.push(`${kind}-r${repetition}`);
}
assert.deepEqual(report.runs.map(row => row.case), expected);
const checks = [];
for (const run of report.runs) {
  assert.equal(run.valid, true);
  assert.equal(run.cleanupComplete, true);
  for (const name of ['seeded-current.json', 'before-current.json', 'after-current.json']) {
    const relative = `${run.case}/${name}`;
    const raw = readFileSync(resolve(root, relative), 'utf8'), parsed = JSON.parse(raw);
    assert.equal(parsed.version, 9); assert.equal(parsed.revision, 14);
    const accepted = save.importSave(raw);
    // Full envelope, including economy, paid jobs, fleets and clocks. No fields
    // are filtered to obtain equality. This is acceptance, not a tick oracle.
    assert.deepEqual(accepted, parsed, `${relative}: actual target strict reader changes input`);
    assert.equal(accepted.state.planets.length, 100);
    assert.equal(accepted.state.fleets.length, 1000);
    const canonical = save.exportSave(save.deserializeState(accepted.state), accepted.savedAt, accepted.lastTickAt);
    assert.deepEqual(JSON.parse(canonical), parsed, `${relative}: whole save read/export changes values`);
    assert.equal(save.exportSave(save.deserializeState(save.importSave(canonical).state), accepted.savedAt, accepted.lastTickAt), canonical,
      `${relative}: repeated canonical serialization is unstable`);
    checks.push({ path: relative, bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex'),
      fullEnvelopeEqual: true, strictReaderAccepted: true, canonicalFixedPoint: true });
  }
}
assert.equal(checks.length, 27);
writeFileSync(resolve(root, 'strict-saves.json'), JSON.stringify({ targetSourceSha: target, checks,
  scope: 'Actual target strict reader and full-envelope round trip, after every native timing/profile window. Not an independent simulation oracle.' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ strictNativeSaves: checks.length, targetSourceSha: target }));
