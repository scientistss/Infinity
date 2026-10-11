/** Focused test-only oracle checks. Run with the genuine save-session fixture:
 * R11_ORACLE_FIXTURE=/path/to/save-session-review-save.json node --import tsx --test scripts/test-r11-startup-oracle.mjs
 * Optional R11_ORACLE_SOURCE selects the exact ca5 checkout (never current code).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertPinnedSource, dependencyIdentity, DEPENDENCIES, oracle, SOURCE_SHA } from './r11-startup-oracle.mjs';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';

const root = resolve(process.env.R11_ORACLE_SOURCE || fileURLToPath(new URL('../../infinity-npc-r11-source', import.meta.url)));
const evidence = JSON.parse(readFileSync(new URL('../tests/fixtures/npc-economy-r11.json', import.meta.url), 'utf8'));
const raw = evidence.rows[0].raw, original = JSON.parse(raw);
const hash = value => createHash('sha256').update(value).digest('hex');
const fold = segments => segments.reduce((age, step) => Math.min(11900, age + step), 0);
const load = name => import(pathToFileURL(resolve(root, name)).href);
assertPinnedSource(root);
assert.deepEqual(dependencyIdentity(root), DEPENDENCIES);
const [save, offline] = await Promise.all(['src/game/save.ts', 'src/core/offline.ts'].map(load));
const keys = ['schema', 'sourceSha', 'dependencyIdentity', 'inputRawSha256', 'sourceRevision', 'sourceEnvelope',
  'sourceSavedAt', 'sourceLastTickAt', 'constructorNow', 'gapMilliseconds', 'rawSeconds', 'appliedSeconds',
  'capSeconds', 'capped', 'adoptedSegmentsSeconds', 'npcElapsedSeconds', 'adoptedTimeObservation',
  'oldObservedAndUnobservedStateEqual', 'state'].sort();

function checkResult(result, input, now) {
  const envelope = JSON.parse(input), read = save.importSave(input);
  const plain = offline.catchUp(save.deserializeState(read.state), (now - read.lastTickAt) / 1000);
  assert.deepEqual(Object.keys(result).sort(), keys);
  assert.equal(result.schema, 'infinity-fixed-r11-startup-oracle-v1');
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.deepEqual(result.dependencyIdentity, DEPENDENCIES);
  assert.equal(result.inputRawSha256, hash(input));
  assert.equal(result.sourceRevision, envelope.revision);
  assert.deepEqual(result.sourceEnvelope, Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'state')));
  assert.equal(result.sourceSavedAt, envelope.savedAt);
  assert.equal(result.sourceLastTickAt, read.lastTickAt);
  assert.equal(result.constructorNow, now);
  assert.equal(result.gapMilliseconds, now - read.lastTickAt);
  for (const key of ['rawSeconds', 'appliedSeconds', 'capSeconds', 'capped']) assert.equal(result[key], plain[key]);
  assert.equal(result.oldObservedAndUnobservedStateEqual, true);
  assert.equal(result.adoptedTimeObservation, 'old-totalTime-add; full unobserved old-state equivalence verified');
  assert.equal(result.npcElapsedSeconds, fold(result.adoptedSegmentsSeconds));
  assert.deepEqual(result.state, save.serializeState(plain.state));
  assert.equal(Object.hasOwn(result.state, 'npcEconomy'), false);
}

test('exact ca5 source and resolved r10-pinned numerical dependencies are accepted', () => {
  assert.equal(assertPinnedSource(root), root);
  assert.deepEqual(dependencyIdentity(root), DEPENDENCIES);
});

test('actual ca5 startup preserves complete state at negative, zero, fractional, ordinary and capped gaps', async () => {
  for (const row of evidence.rows) for (const milliseconds of [-1, 0, 1, 381, 1000, 7200001]) {
    assert.equal(hash(row.raw), row.rawSha256);
    const now = JSON.parse(row.raw).lastTickAt + milliseconds;
    checkResult(await oracle(root, row.raw, now), row.raw, now);
  }
});

test('genuine r2 through r11 serializers and paid r5 pass unchanged into the actual ca5 reader', async () => {
  assert.ok(process.env.R11_ORACLE_FIXTURE, 'R11_ORACLE_FIXTURE must name the actual ten-revision save-session fixture');
  const fixture = JSON.parse(readFileSync(process.env.R11_ORACLE_FIXTURE, 'utf8'));
  for (let revision = 2; revision <= 11; revision++) {
    assert.equal(fixture.legacySources.find(row => row.revision === revision)?.generatedBy,
      'actual source-revision createInitialState/exportSave');
    const source = fixture.legacy[String(revision)];
    assert.equal(source.revision, revision);
    const input = JSON.stringify(source);
    for (const gap of [-1, 0, 1, 17, 381, 424, 1000, 60000, 7200001, 100000000]) {
      const now = source.lastTickAt + gap;
      checkResult(await oracle(root, input, now), input, now);
    }
  }
  assert.equal(fixture.paidR5.revision, 5);
  const input = JSON.stringify(fixture.paidR5), now = fixture.paidR5.lastTickAt + 424;
  checkResult(await oracle(root, input, now), input, now);
});

test('ca5-supported fallback clocks keep the original envelope while using the actual reader watermark', async () => {
  for (const value of [undefined, null, 'invalid']) {
    const input = structuredClone(original);
    if (value === undefined) delete input.lastTickAt; else input.lastTickAt = value;
    const text = JSON.stringify(input), now = input.savedAt + 125;
    checkResult(await oracle(root, text, now), text, now);
  }
});

test('large old totalTime cannot hide adopted age or turn a requested tiny gap into an adopted step', async () => {
  // Explicit synthetic input derived from real ca5 state, never relabelled schema.
  const input = structuredClone(original); input.state.totalTime = '1e400';
  const text = JSON.stringify(input), now = input.lastTickAt + 381;
  const result = await oracle(root, text, now);
  checkResult(result, text, now);
  assert.equal(result.state.totalTime, '1e+400');
  assert.ok(result.npcElapsedSeconds > 0);
  assert.equal(result.npcElapsedSeconds, fold(result.adoptedSegmentsSeconds));
  const read = save.importSave(text);
  const tiny = captureAdoptedSteps(save.deserializeState(read.state), state => offline.catchUp(state, 1e-12), save.serializeState);
  assert.deepEqual(tiny.adoptedSegmentsSeconds, []);
  assert.equal(tiny.npcElapsedSeconds, 0);
});

test('invalid inputs, unsupported revisions, and candidate-state or fitted-gap request fields fail closed', async () => {
  for (const now of [-1, 1.5, NaN, Infinity, undefined, null, '1']) await assert.rejects(oracle(root, raw, now));
  await assert.rejects(oracle(root, original, original.savedAt));
  await assert.rejects(oracle(root, raw, original.savedAt, { candidateState: {} }));
  for (const revision of [1, 12, 999]) {
    const source = structuredClone(original); source.revision = revision;
    await assert.rejects(oracle(root, JSON.stringify(source), source.savedAt), /修订不兼容/);
  }
  const script = fileURLToPath(new URL('./r11-startup-oracle.mjs', import.meta.url));
  for (const extra of [{ candidateState: {} }, { gapMilliseconds: 381 }, { currentRaw: raw }]) {
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', script, root], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', stdio: 'pipe',
      input: JSON.stringify({ originalRaw: raw, constructorNow: original.savedAt, ...extra }),
    }));
  }
});

function copiedCheckout() {
  const base = mkdtempSync(join(tmpdir(), 'r11-oracle-negative-')), copy = join(base, 'source');
  execFileSync('git', ['clone', '--shared', '--no-checkout', root, copy], { stdio: 'pipe' });
  execFileSync('git', ['checkout', SOURCE_SHA, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: copy, stdio: 'pipe' });
  return { base, copy };
}

test('source guard rejects modified, assume-unchanged, ignored shadow, extra, missing and symlinked source files', () => {
  const { base, copy } = copiedCheckout();
  try {
    assert.equal(assertPinnedSource(copy), copy);
    const file = join(copy, 'src/game/save.ts'), bytes = readFileSync(file);
    execFileSync('git', ['update-index', '--assume-unchanged', 'src/game/save.ts'], { cwd: copy });
    writeFileSync(file, Buffer.concat([bytes, Buffer.from('\n// hidden source change\n')]));
    assert.throws(() => assertPinnedSource(copy), /exact archived file bytes/);
    writeFileSync(file, bytes);
    const ignored = join(copy, 'src/game/save.js');
    writeFileSync(join(copy, '.git/info/exclude'), 'src/game/save.js\n');
    writeFileSync(ignored, 'throw Error("ignored shadow must not execute");');
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src'], { cwd: copy, encoding: 'utf8' }).trim(), '');
    assert.throws(() => assertPinnedSource(copy), /no missing, extra, ignored, or shadow/);
    rmSync(ignored);
    const extra = join(copy, 'src/untracked.ts'); writeFileSync(extra, 'export const unrelated = 1;');
    assert.throws(() => assertPinnedSource(copy), /no missing, extra, ignored, or shadow/); rmSync(extra);
    rmSync(file); assert.throws(() => assertPinnedSource(copy), /ENOENT/);
    symlinkSync(join(root, 'src/game/save.ts'), file);
    assert.throws(() => assertPinnedSource(copy), /ordinary archived file/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('dependency metadata redirects and changed actual entries are rejected', async () => {
  const { base, copy } = copiedCheckout();
  try {
    for (const name of ['break_infinity.js', 'pad-end']) {
      const target = join(copy, 'node_modules', name); mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, 'node_modules', name), target, { recursive: true, dereference: true });
    }
    assert.deepEqual(dependencyIdentity(copy), DEPENDENCIES);
    const manifest = join(copy, 'node_modules/break_infinity.js/package.json'), metadata = readFileSync(manifest);
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(metadata), exports: './dist/break_infinity.common.js' }));
    await assert.rejects(oracle(copy, raw, original.savedAt)); writeFileSync(manifest, metadata);
    const entry = join(copy, 'node_modules/break_infinity.js/dist/break_infinity.common.js'), bytes = readFileSync(entry);
    writeFileSync(entry, Buffer.concat([bytes, Buffer.from('\n// changed numerical entry\n')]));
    await assert.rejects(oracle(copy, raw, original.savedAt), /old resolved numerical dependency/); writeFileSync(entry, bytes);
  } finally { rmSync(base, { recursive: true, force: true }); }
});


test('a nested pad-end installation is checked at the actual dependency edge', async () => {
  // New checkout path avoids reusing Node's own cached resolution from a prior
  // import of this exact dependency edge; each CLI oracle also starts fresh.
  const { base, copy } = copiedCheckout();
  try {
    for (const name of ['break_infinity.js', 'pad-end']) {
      const target = join(copy, 'node_modules', name); mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, 'node_modules', name), target, { recursive: true, dereference: true });
    }
    const nested = join(copy, 'node_modules/break_infinity.js/node_modules/pad-end');
    mkdirSync(dirname(nested), { recursive: true });
    cpSync(join(copy, 'node_modules/pad-end'), nested, { recursive: true });
    writeFileSync(join(nested, 'index.js'), 'module.exports = value => value;\n');
    await assert.rejects(oracle(copy, raw, original.savedAt), /old resolved numerical dependency/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
