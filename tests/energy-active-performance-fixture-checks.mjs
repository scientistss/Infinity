#!/usr/bin/env node
/** Generator-only checks: node --import tsx tests/energy-active-performance-fixture-checks.mjs FIXTURE_DIR [--source-root CLEAN6AF] */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOUNDS, PROFILE_IDS, exactDelta, validateRawInputs } from '../scripts/energy-active-performance-fixture.mjs';

const sourceOption = process.argv.indexOf('--source-root');
const sourceRoot = sourceOption >= 0 ? resolve(process.argv[sourceOption + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromSource = path => import(pathToFileURL(resolve(sourceRoot, path)).href);
const { SaveSession } = await fromSource('src/game/save-session.ts');
const { serializeState } = await fromSource('src/game/save.ts');
const { STORAGE_KEY } = await fromSource('src/game/content.ts');
const { tick } = await fromSource('src/game/logic.ts');
const { economy } = await fromSource('src/game/economy.ts');
const { selectPlanet } = await fromSource('src/game/empire.ts');

const out = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(resolve(out, 'report.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const withoutActive = state => { const copy = JSON.parse(JSON.stringify(serializeState(state))); copy.energyChallenge.active = null; return copy; };
function fraction(text) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text); assert(m);
  const exp = Number(m[3] ?? 0) - (m[2] ?? '').length, n = BigInt(m[1] + (m[2] ?? ''));
  return exp < 0 ? [n, 10n ** BigInt(-exp)] : [n * 10n ** BigInt(exp), 1n];
}
function checkGrant(before, grant, after) {
  const [b, bd] = fraction(before), [g, gd] = fraction(grant), [a, ad] = fraction(after);
  assert.equal(b * gd * ad + g * bd * ad, a * bd * gd);
}
function read(ref) {
  const raw = readFileSync(resolve(out, ref.file), 'utf8'); assert.equal(hash(raw), ref.sha256); assert.equal(Buffer.byteLength(raw), ref.bytes);
  const envelope = JSON.parse(raw), memory = new Map([[STORAGE_KEY, raw]]);
  const reader = new SaveSession({ getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) }, envelope.lastTickAt);
  assert.equal(reader.mode, 'ready'); assert.equal(reader.loaded.appliedSeconds, 0); return reader.loaded.state;
}
assert.equal(exactDelta('0.001', '1000'), '999.999');
assert.equal(exactDelta('1e-7', '1e-6'), '0.0000009');
assert.equal(exactDelta('1000', '1e+4'), '9000');
assert.equal(exactDelta('0', '0'), '0');
assert.throws(() => exactDelta('2', '1'));
assert.throws(() => exactDelta('NaN', '1'));
assert.equal(report.status, 'passed'); assert.deepEqual(report.profiles.map(p => p.id), PROFILE_IDS);
for (const profile of report.profiles) {
  assert.equal(profile.status, 'passed'); assert.equal(profile.replay.status, 'passed');
  assert(profile.bounds.setupPaidJobs <= BOUNDS.setupPaidJobs); assert(profile.bounds.setupSeconds <= BOUNDS.setupSeconds); assert(profile.bounds.coordinateCandidates <= BOUNDS.coordinateCandidates);
  assert.equal(profile.counts.homeProofPaidJobs, 4); assert.equal(profile.counts.postEntryPaidJobs, profile.counts.postNaturalCheckpointPaidJobs + 4);
  for (const grant of profile.grants) for (const id of ['metal', 'crystal', 'deuterium']) checkGrant(grant.beforeWallet[id], grant.granted[id], grant.afterWallet[id]);
  const active = read(profile.variants.active), control = read(profile.variants.control);
  assert.deepEqual(withoutActive(active), serializeState(control));
  const a = tick(active, BOUNDS.nativeRunSeconds, 'live'), b = tick(control, BOUNDS.nativeRunSeconds, 'live');
  assert.deepEqual(withoutActive(a), serializeState(b), 'Matched active/control idle trajectories differ beyond challenge record');
  assert(BigInt(a.energyChallenge.active.scoreUnits) > BigInt(active.energyChallenge.active.scoreUnits));
  assert(BigInt(a.energyChallenge.active.scoreUnits) < 1000000000000000000n);
  assert.equal(a.fleets.length, active.fleets.length); assert.equal(a.messages.length, active.messages.length);
  for (const p of a.planets) {
    const before = active.planets.find(x => x.id === p.id), e = economy(selectPlanet(a, p.id)); assert.equal(e.efficiency, 1);
    for (const id of ['metal', 'crystal', 'deuterium']) { assert(p.resources[id].gt(before.resources[id])); assert(p.resources[id].lt(e.caps[id])); }
  }
  for (const ref of Object.values(profile.checkpoints)) {
    const validation = validateRawInputs(resolve(out, ref.file)); assert.equal(validation.status, 'passed', validation.error); assert.equal(validation.inputs[0].stateSha256, ref.stateSha256);
  }
}
process.stdout.write(JSON.stringify({ status: 'passed', sourceRoot, profiles: report.profiles.length, matchedNativeHorizonSeconds: BOUNDS.nativeRunSeconds, exactGrantReceipts: report.profiles.reduce((n, p) => n + p.grants.length, 0), strictCheckpoints: report.profiles.reduce((n, p) => n + Object.keys(p.checkpoints).length, 0) }) + '\n');
