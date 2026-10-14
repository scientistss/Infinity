#!/usr/bin/env node
/** Independent public-r14 migration oracle. No candidate production import.
 * Under the shared execution lease only:
 *   node --import tsx scripts/energy-challenge-migration-fixtures.mjs generate PUBLIC_ROOT OUT
 *   node --import tsx scripts/energy-challenge-migration-fixtures.mjs oracle PUBLIC_ROOT < input.json
 *   node --import tsx scripts/energy-challenge-migration-fixtures.mjs verify-startup ORACLE OBSERVATION
 *   node --import tsx scripts/energy-challenge-migration-fixtures.mjs replay PUBLIC_ROOT < trace.json
 * oracle input is exactly {originalRaw, constructorNow}; the timestamp must be the
 * observed constructor argument, never inferred from candidate balances/time.
 * Generated zero/positive cases are domain preparations, not native acceptance.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PUBLIC_SHA = '64176f94a43564be73c64ce21968d36e2ae329a3';
export const PUBLIC_TREE = 'f623daf62bb673f88f25705670f53100387c5038';
export const POOL_PATH = 'tests/fixtures/npc-scout-legacy.json';
export const POOL_SHA256 = 'd4b68b8a67ed6c2b8eb205363f83423c3c23bb09386042be1c096aad5cd5bf04';
export const DEFAULT_CHALLENGE = Object.freeze({ model: 'energy-tightening-v1', nextAttemptId: 1, active: null, completion: null });
export const ORACLE_SCHEMA = 'infinity-energy-challenge-public-r14-startup-oracle-v1';
export const FIXTURE_SCHEMA = 'infinity-energy-challenge-migration-fixtures-v2';
export const REPLAY_SCHEMA = 'infinity-energy-challenge-public-r14-native-replay-v1';
export const REPLAY_LIMITS = Object.freeze({ events: 4096, frameSpanMilliseconds: 120000, primaryWrites: 64, inputBytes: 32 * 1024 * 1024 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATHS = ['src', 'package.json', 'package-lock.json', 'tsconfig.json'];
const SELECTED = Object.freeze([
  'r2-scout-history-paid-queues', 'r3-scout-history-paid-queues', 'r4-scout-history-paid-queues',
  'r5-scout-history-paid-queues', 'r6-paid-transport-outbound', 'r7-paid-transport-outbound',
  'r8-outbound', 'r9-complete_world_outbound', 'r10-G10c-mixed-old-new-pending',
  'r11-partial-demolition-earned-grants', 'r12-final-returned-and-reloaded', 'r13-attack7-live-loop-3',
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const modules = new Map();

function git(root, ...args) {
  return execFileSync('git', ['--no-replace-objects', '-C', root, ...args],
    { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
}
function gitText(root, ...args) { return git(root, ...args).toString('utf8').trim(); }
function exactKeys(value, names, where) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${where}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), `${where}: exact keys required`);
}
function milliseconds(value, where) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    `${where}: finite nonnegative safe milliseconds required; fractions must be preserved`);
}
function treeFiles(root, commit) {
  return git(root, 'ls-tree', '-r', '-z', commit, '--', ...SOURCE_PATHS).toString('utf8').split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    assert.ok(match, `Regular source/config file required: ${row}`);
    return { mode: match[1], blob: match[2], path: match[3] };
  });
}
/** Exact actual source inventory, including ignored files and import shadows. */
export function assertPublicSource(root) {
  root = realpathSync(root);
  assert.equal(gitText(root, 'rev-parse', '--show-toplevel'), root);
  assert.equal(gitText(root, 'rev-parse', 'HEAD'), PUBLIC_SHA, 'Exact public r14 source commit required');
  assert.equal(gitText(root, 'rev-parse', 'HEAD^{tree}'), PUBLIC_TREE);
  const files = treeFiles(root, PUBLIC_SHA);
  for (const file of files) {
    const stat = lstatSync(resolve(root, file.path));
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Ordinary source file required: ${file.path}`);
    assert.equal(Boolean(stat.mode & 0o111), file.mode === '100755', `Exact file mode: ${file.path}`);
    const bytes = readFileSync(resolve(root, file.path));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.blob,
      `Unmodified public source: ${file.path}`);
    file.sha256 = hash(bytes);
  }
  const actual = [];
  function scan(path) {
    const stat = lstatSync(resolve(root, path));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `Ordinary source directory required: ${path}`);
    for (const item of readdirSync(resolve(root, path), { withFileTypes: true })) {
      const relative = `${path}/${item.name}`;
      if (item.isDirectory()) scan(relative); else actual.push(relative);
    }
  }
  scan('src');
  assert.deepEqual(actual.sort(), files.filter(file => file.path.startsWith('src/')).map(file => file.path).sort(),
    'No extra/missing/ignored/shadow production source');
  return { root, commit: PUBLIC_SHA, tree: PUBLIC_TREE, sourceFiles: files };
}
function dependencyIdentity(root) {
  const require = createRequire(pathToFileURL(resolve(root, 'src/game/decimal.ts')));
  const entry = require.resolve('break_infinity.js'), nested = createRequire(entry);
  const packagePath = require.resolve('break_infinity.js/package.json');
  const padPath = nested.resolve('pad-end/package.json');
  const packageBytes = readFileSync(packagePath), padBytes = readFileSync(padPath);
  assert.equal(hash(packageBytes), '28c409896f3b0c9de03b55dade1c5ba9555ca236a2268328df0bc4285926990f');
  assert.equal(hash(padBytes), '428212d66fdffecb142ef13ba9b91e67fe3b0ffaa48d4c04961ff0dae177d0a4');
  const pkg = JSON.parse(packageBytes), pad = JSON.parse(padBytes);
  const identity = { breakInfinity: { version: pkg.version, commonSha256: hash(readFileSync(entry)),
    esmSha256: hash(readFileSync(resolve(dirname(packagePath), pkg.module))) },
  padEnd: { version: pad.version, entrySha256: hash(readFileSync(nested.resolve('pad-end'))) } };
  assert.deepEqual(identity, {
    breakInfinity: { version: '2.2.0', commonSha256: 'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06',
      esmSha256: '1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a' },
    padEnd: { version: '1.0.2', entrySha256: '063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330' },
  }, 'Exact resolved public numerical dependency bytes');
  return identity;
}
async function loadPublic(root) {
  const source = assertPublicSource(root), dependencies = dependencyIdentity(source.root);
  assert.deepEqual(dependencyIdentity(ROOT), dependencies, 'Runner/public numerical dependencies must match');
  if (!modules.has(source.root)) {
    const [save, offline, content, logic] = await Promise.all(
      ['src/game/save.ts', 'src/core/offline.ts', 'src/game/content.ts', 'src/game/logic.ts']
        .map(path => import(pathToFileURL(resolve(source.root, path)).href)));
    assert.equal(content.SAVE_REVISION, 14);
    assert.equal(content.SAVE_VERSION, 9);
    assert.deepEqual(content.SUPPORTED_SAVE_REVISIONS, Array.from({ length: 13 }, (_, i) => i + 2));
    modules.set(source.root, { save, offline, content, logic });
  }
  return { ...modules.get(source.root), source, dependencies };
}
/** Observe real adopted segments; compare every state field against an unobserved run. */
function adoptedSteps(state, advance, serialize) {
  const steps = [], tracked = new WeakSet(), before = serialize(state);
  function wrap(decimal) {
    const proxy = new Proxy(decimal, { get(target, key, receiver) {
      if (key === 'add') return step => {
        assert.ok(typeof step === 'number' && Number.isFinite(step) && step >= 0);
        steps.push(step);
        return wrap(target.add(step));
      };
      return Reflect.get(target, key, receiver);
    } });
    tracked.add(proxy);
    return proxy;
  }
  const result = advance(state);
  assert.deepEqual(serialize(state), before, 'Public engine must not mutate input');
  const observed = advance({ ...state, totalTime: wrap(state.totalTime) });
  assert.ok(tracked.has(observed.state.totalTime), 'Adopted public time carrier stays observed');
  assert.deepEqual(serialize(result.state), serialize(observed.state), 'Observed/unobserved complete public states agree');
  if (result.gains) assert.deepEqual(loadedSummary(observed), loadedSummary(result), 'Observer preserves complete catch-up accounting');
  assert.deepEqual(serialize(state), before, 'Observer must not mutate input');
  return { result, steps };
}
function loadedSummary(loaded) {
  const { state, gains, ...rest } = loaded;
  return { ...plain(rest), gains: { metal: gains.metal.toString(), crystal: gains.crystal.toString(), deuterium: gains.deuterium.toString() } };
}
/** Runs only the exact public reader and public catchUp. No expected-state input. */
export async function publicStartupOracle(root, originalRaw, constructorNow) {
  assert.equal(arguments.length, 3, 'Only public root, original raw bytes and actual constructor time are admitted');
  assert.equal(typeof originalRaw, 'string');
  milliseconds(constructorNow, 'constructorNow');
  const { save, offline, source, dependencies } = await loadPublic(root);
  const original = JSON.parse(originalRaw);
  assert.ok(Number.isInteger(original.revision) && original.revision >= 2 && original.revision <= 14,
    'Only real supported r2–r14 source inputs belong in the positive oracle');
  const read = save.importSave(originalRaw), beforeState = copy(read.state);
  assert.equal(Object.hasOwn(beforeState, 'energyChallenge'), false, 'Public state has no challenge data');
  const gapMilliseconds = constructorNow - read.lastTickAt;
  const adopted = adoptedSteps(save.deserializeState(read.state),
    state => offline.catchUp(state, gapMilliseconds / 1000), save.serializeState);
  const state = save.serializeState(adopted.result.state);
  const publicEnvelope = JSON.parse(save.exportSave(adopted.result.state, constructorNow, constructorNow));
  assert.deepEqual(publicEnvelope.state, state);
  return { schema: ORACLE_SCHEMA, publicSource: source, dependencyIdentity: dependencies,
    producerSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    inputRawSha256: hash(originalRaw), inputRawBytes: Buffer.byteLength(originalRaw),
    sourceRevision: original.revision, sourceSavedAt: read.savedAt, sourceLastTickAt: read.lastTickAt,
    constructorNow, gapMilliseconds, adoptedLastTickAt: constructorNow,
    adoptedSegmentsSeconds: adopted.steps, adoptedSecondsFold: adopted.steps.reduce((sum, step) => sum + step, 0),
    observation: 'Public totalTime.add segments; complete unobserved-public-state equality; no fitted clocks',
    beforeState, state, loaded: loadedSummary(adopted.result), publicEnvelope,
    expectedChallenge: copy(DEFAULT_CHALLENGE), allowedAddedStateFields: ['energyChallenge'],
    expectedBackupRawSha256: hash(originalRaw), boundary: 'Independent domain oracle; native capture provenance is separate' };
}

/** Only the one independently asserted challenge field may be projected away. */
export function assertAdditiveState(actual, expectedPublic, where = 'state') {
  assert.ok(actual && typeof actual === 'object' && !Array.isArray(actual), `${where}: complete state required`);
  assert.equal(Object.hasOwn(actual, 'energyChallenge'), true, `${where}: explicit challenge field required`);
  assert.deepEqual(actual.energyChallenge, DEFAULT_CHALLENGE, `${where}: exact unearned inactive default`);
  const { energyChallenge, ...previous } = actual;
  assert.deepEqual(previous, expectedPublic, `${where}: every prior field matches the independent public state`);
}
export function expectedCandidateEnvelope(oracle) {
  assert.equal(oracle.schema, ORACLE_SCHEMA);
  assert.deepEqual(oracle.expectedChallenge, DEFAULT_CHALLENGE);
  assert.equal(oracle.publicEnvelope.revision, 14);
  return { ...oracle.publicEnvelope, revision: 16,
    state: { energyChallenge: copy(DEFAULT_CHALLENGE), ...oracle.publicEnvelope.state } };
}
/** Ready snapshot must be captured before any live RAF advancement. No filtering. */
export function verifyCandidateStartup(oracle, observed) {
  assert.equal(oracle.schema, ORACLE_SCHEMA);
  exactKeys(observed, ['sourceRaw', 'constructorNow', 'mode', 'state', 'loaded', 'primaryRaw', 'backupRaw', 'lastTickAt'], 'startup observation');
  assert.equal(hash(observed.sourceRaw), oracle.inputRawSha256, 'Exact original input bytes');
  assert.equal(Buffer.byteLength(observed.sourceRaw), oracle.inputRawBytes);
  assert.equal(observed.constructorNow, oracle.constructorNow, 'Actual constructor argument is oracle input');
  assert.equal(observed.mode, 'ready');
  assert.equal(observed.lastTickAt, oracle.adoptedLastTickAt, 'Actual adopted clock, including capped discarded time');
  assertAdditiveState(observed.state, oracle.state);
  assert.deepEqual(observed.loaded, oracle.loaded, 'Complete catch-up accounting summary');
  assert.equal(observed.backupRaw, observed.sourceRaw, 'Byte-exact original backup, no parse/reserialize');
  const expected = expectedCandidateEnvelope(oracle);
  assert.deepEqual(JSON.parse(observed.primaryRaw), expected, 'Complete migration envelope');
  assert.equal(observed.primaryRaw, json(expected), 'Exact runtime canonical migration write');
  return { schema: 'infinity-energy-challenge-migration-verification-v1', status: 'passed',
    inputRawSha256: oracle.inputRawSha256, publicSourceSha: PUBLIC_SHA,
    constructorNow: oracle.constructorNow, sourceSavedAt: oracle.sourceSavedAt,
    sourceLastTickAt: oracle.sourceLastTickAt, adoptedLastTickAt: observed.lastTickAt,
    priorState: 'full exact equality', challenge: 'exact inactive unearned default',
    originalBackup: 'exact bytes', excludedPriorFields: [], nativeProvenanceClaimed: false };
}

function readHistoricalPool(root) {
  const raw = git(root, 'show', `${PUBLIC_SHA}:${POOL_PATH}`);
  assert.equal(hash(raw), POOL_SHA256, 'Pinned public archived fixture pool');
  const pool = JSON.parse(raw);
  assert.equal(pool.schema, 'infinity-scout-genuine-legacy-fixtures-v1');
  assert.deepEqual(Object.keys(pool.sourceBindings).sort((a, b) => Number(a) - Number(b)),
    Array.from({ length: 12 }, (_, i) => String(i + 2)), 'No missing archived revisions');
  // cat-file reads the pinned public source blobs; no private artifacts or Library inputs.
  for (const [revision, binding] of Object.entries(pool.sourceBindings)) {
    assert.equal(binding.revision, Number(revision));
    assert.equal(gitText(root, 'rev-parse', `${binding.sourceSha}:src`), binding.sourceTree);
    const files = treeFiles(root, binding.sourceSha);
    assert.deepEqual(files.map(file => file.path).sort(), binding.sourceFiles.map(file => file.path).sort(),
      `Exact archived source/config inventory r${revision}`);
    const requested = files.map(file => `${binding.sourceSha}:${file.path}`).join('\n') + '\n';
    const batch = execFileSync('git', ['--no-replace-objects', '-C', root, 'cat-file', '--batch'],
      { input: requested, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    let cursor = 0;
    const expected = new Map(binding.sourceFiles.map(file => [file.path, file.sha256]));
    for (const file of files) {
      const newline = batch.indexOf(10, cursor);
      const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(batch.subarray(cursor, newline).toString('utf8'));
      assert.ok(match); assert.equal(match[1], file.blob);
      cursor = newline + 1;
      const bytes = batch.subarray(cursor, cursor + Number(match[2]));
      assert.equal(hash(bytes), expected.get(file.path), `Bound original r${revision} source: ${file.path}`);
      cursor += bytes.length; assert.equal(batch[cursor++], 10);
    }
    assert.equal(cursor, batch.length);
    assert.equal(binding.serializerSha256, expected.get('src/game/save.ts'));
  }
  assert.equal(new Set(pool.rows.map(row => row.id)).size, pool.rows.length);
  for (const row of pool.rows) {
    assert.equal(hash(row.raw), row.rawSha256, `${row.id}: exact archived raw bytes`);
    assert.equal(Buffer.byteLength(row.raw), row.rawBytes);
    assert.equal(JSON.parse(row.raw).revision, row.revision);
    assert.equal(row.sourceSha, pool.sourceBindings[row.revision].sourceSha);
  }
  const rows = SELECTED.map(id => {
    const row = pool.rows.find(row => row.id === id);
    assert.ok(row, `Missing archived input: ${id}; do not substitute retagged state`);
    return row;
  });
  return { pool, rows, binding: { commit: PUBLIC_SHA, path: POOL_PATH,
    blob: gitText(root, 'rev-parse', `${PUBLIC_SHA}:${POOL_PATH}`), sha256: POOL_SHA256, bytes: raw.length } };
}

/** Reproduce the sole r14 REALCLOCK source with the pinned public serializer. */
function genuinePublicR14Source(ctx, history) {
  // r14 is a genuine new export by the public serializer after public adoption.
  // No candidate state, publicR14 projection, revision retag, or field reconstruction.
  const origin = history.rows.find(row => row.revision === 13);
  const read = ctx.save.importSave(origin.raw), producerGapSeconds = 3.25;
  const continuation = adoptedSteps(ctx.save.deserializeState(read.state),
    state => ctx.offline.catchUp(state, producerGapSeconds), ctx.save.serializeState);
  const lastTickAt = read.lastTickAt + producerGapSeconds * 1000;
  const r14 = ctx.save.exportSave(continuation.result.state, lastTickAt, lastTickAt);
  assert.equal(JSON.parse(r14).revision, 14);
  assert.deepEqual(ctx.save.importSave(r14).state, ctx.save.serializeState(continuation.result.state));
  const provenance = { kind: 'new-unmodified-public-r14-serializer-output', syntheticSetup: false,
    naturalProgression: false, classification: 'Deterministic public-source continuation of archived natural r13; not native gameplay',
    sourceBinding: ctx.source, originRow: origin.id, originRawSha256: origin.rawSha256,
    producerActions: ['public importSave(original r13 bytes)', 'public deserializeState', 'public catchUp(3.25)', 'public exportSave'],
    producerGapSeconds, adoptedSegmentsSeconds: continuation.steps, savedAt: lastTickAt, lastTickAt };
  return { raw: r14, provenance, continuation, lastTickAt };
}

export async function generateFixtures(root, output) {
  const ctx = await loadPublic(root), history = readHistoricalPool(ctx.source.root);
  output = resolve(output); mkdirSync(output, { recursive: true });
  assert.equal(readdirSync(output).length, 0, 'Fixture output must be a fresh empty directory; never overwrite original evidence');
  function put(name, raw) {
    const file = resolve(output, name); writeFileSync(file, raw, { flag: 'wx' });
    assert.equal(readFileSync(file, 'utf8'), raw, 'Durable fixture bytes read back');
    return { file, sha256: hash(raw), bytes: Buffer.byteLength(raw) };
  }
  const sources = history.rows.map(row => ({ id: row.id, revision: row.revision, raw: row.raw,
    provenance: { kind: 'archived-unmodified-source-serializer-output', fixturePool: history.binding,
      fixtureRow: row.id, sourceBinding: history.pool.sourceBindings[row.revision],
      syntheticSetup: row.synthetic, naturalProgression: row.naturalProgression,
      originalProvenance: copy(row.provenance), sourceRawSha256: row.rawSha256 } }));
  const { raw: r14, provenance, continuation, lastTickAt } = genuinePublicR14Source(ctx, history);
  sources.push({ id: 'r14-public-serializer-continuation', revision: 14, raw: r14, provenance });
  const cases = [];
  for (const source of sources) {
    const rawFile = put(`${source.id}-source.json`, source.raw);
    const input = JSON.parse(source.raw);
    for (const [suffix, gapMs] of [['zero-elapsed', 0], ['positive-61_25-seconds', 61250]]) {
      const now = input.lastTickAt + gapMs;
      const oracle = await publicStartupOracle(ctx.source.root, source.raw, now);
      const expected = put(`${source.id}-${suffix}-oracle.json`, json(oracle));
      const expectedState = put(`${source.id}-${suffix}-expected-state.json`, json({ energyChallenge: copy(DEFAULT_CHALLENGE), ...oracle.state }));
      cases.push({ id: `${source.id}-${suffix}`, revision: source.revision, expectedMode: 'ready',
        sourceFile: rawFile.file, sourceSha256: rawFile.sha256, sourceBytes: rawFile.bytes,
        now, savedAt: input.savedAt, lastTickAt: input.lastTickAt, offlineSeconds: oracle.loaded.appliedSeconds,
        clock: { constructorNow: now, sourceSavedAt: input.savedAt, sourceLastTickAt: input.lastTickAt,
          rawGapSeconds: gapMs / 1000, adoptedLastTickAt: now },
        oracleFile: expected.file, oracleSha256: expected.sha256,
        expectedStateFile: expectedState.file, expectedStateSha256: expectedState.sha256,
        expectedBackupRawSha256: rawFile.sha256, expectedChallenge: copy(DEFAULT_CHALLENGE),
        provenance: source.provenance, evidenceKind: 'domain-preparation-not-native-acceptance' });
    }
  }
  // A real serializer can record a later write time without claiming that time was
  // simulated. This extra source forces startup to use lastTickAt rather than savedAt.
  const separatedRaw = ctx.save.exportSave(continuation.result.state, lastTickAt + 1250, lastTickAt);
  const separatedFile = put('r14-public-serializer-separated-clock-source.json', separatedRaw);
  for (const [id, constructorNow] of [['savedAt-is-not-watermark', lastTickAt + 1250], ['capped-startup-consumes-raw-gap', lastTickAt + 36000000]]) {
    const oracle = await publicStartupOracle(ctx.source.root, separatedRaw, constructorNow);
    const expected = put(`r14-${id}-oracle.json`, json(oracle));
    const state = put(`r14-${id}-expected-state.json`, json({ energyChallenge: copy(DEFAULT_CHALLENGE), ...oracle.state }));
    cases.push({ id: `r14-${id}`, revision: 14, expectedMode: 'ready', sourceFile: separatedFile.file,
      sourceSha256: separatedFile.sha256, sourceBytes: separatedFile.bytes, now: constructorNow,
      savedAt: lastTickAt + 1250, lastTickAt, offlineSeconds: oracle.loaded.appliedSeconds,
      clock: { constructorNow, sourceSavedAt: lastTickAt + 1250, sourceLastTickAt: lastTickAt,
        rawGapSeconds: (constructorNow - lastTickAt) / 1000, adoptedLastTickAt: constructorNow },
      oracleFile: expected.file, oracleSha256: expected.sha256, expectedStateFile: state.file,
      expectedStateSha256: state.sha256, expectedBackupRawSha256: separatedFile.sha256,
      expectedChallenge: copy(DEFAULT_CHALLENGE), provenance: { ...provenance, savedAt: lastTickAt + 1250 },
      evidenceKind: 'domain-preparation-not-native-acceptance' });
  }
  const publicEnvelope = JSON.parse(r14);
  const currentProbe = () => ({ ...copy(publicEnvelope), revision: 16,
    state: { energyChallenge: copy(DEFAULT_CHALLENGE), ...copy(publicEnvelope.state) } });
  const rejectionProbes = [
    ['unknown-r15', { ...copy(publicEnvelope), revision: 15 }, 'unknown-revision',
      'Synthetic unsupported revision tag only; no historical r15 schema or compatibility claim'],
    ['malformed-r16-completion-receipt', (() => { const value = currentProbe(); value.state.energyChallenge.completion = true; return value; })(),
      'invalid-completion-receipt', 'Synthetic bare completion flag; no paid proof/receipt'],
    ['malformed-r16-misplaced-typed-marker', (() => { const value = currentProbe(); value.ignored = { nested: { model: 'energy-tightening-v1' } }; return value; })(),
      'misplaced-typed-marker', 'Synthetic misplaced typed model authority outside the only valid challenge field'],
    ['malformed-r16-misplaced-challenge-field', (() => { const value = currentProbe(); value.ignored = { energyChallenge: copy(DEFAULT_CHALLENGE) }; return value; })(),
      'misplaced-challenge-field', 'Synthetic misplaced named challenge authority'],
  ];
  for (const [id, envelope, rejectionKind, explanation] of rejectionProbes) {
    const raw = `  ${JSON.stringify(envelope, null, 3)}\n`, file = put(`${id}-source.json`, raw);
    cases.push({ id, revision: envelope.revision, expectedMode: 'protected', rejectionKind,
      sourceFile: file.file, sourceSha256: file.sha256, sourceBytes: file.bytes, now: lastTickAt + 61250,
      expectedProtectedRawSha256: file.sha256, expectedPrimaryWrites: 0, expectedBackupWrites: 0,
      expectedStateFile: null, expectedStateSha256: null,
      provenance: { kind: 'explicit-synthetic-rejection-probe', explanation,
        basePublicR14RawSha256: hash(r14), historicalSourceClaimed: false },
      evidenceKind: 'rejection-preparation-not-native-acceptance' });
  }
  const nativeInputs = [
    ...sources.map(source => {
      const row = cases.find(row => row.id === `${source.id}-positive-61_25-seconds`);
      return { id: `migrate-r${source.revision}`, revision: source.revision, expectedMode: 'ready',
        sourceFile: row.sourceFile, sourceSha256: row.sourceSha256, sourceBytes: row.sourceBytes,
        provenance: copy(source.provenance),
        clockPolicy: source.revision === 14 ? 'REALCLOCK-actual-constructor-and-native-RAF' : 'separately-labeled-compressed-clock',
        fixedPreparationCase: row.id };
    }),
    ...[['unknown-r15', 'unknown-r15'], ['malformed-r16-completion', 'malformed-r16-completion-receipt']].map(([id, sourceId]) => {
      const row = cases.find(row => row.id === sourceId);
      return { id, revision: row.revision, expectedMode: 'protected', sourceFile: row.sourceFile,
        sourceSha256: row.sourceSha256, sourceBytes: row.sourceBytes, provenance: copy(row.provenance),
        clockPolicy: 'separately-labeled-compressed-clock', fixedPreparationCase: row.id };
    }),
  ];
  assert.equal(nativeInputs.length, 15, 'Fixed native migration census: 13 supported and 2 refusal inputs');
  assert.equal(new Set(nativeInputs.map(row => row.id)).size, 15);
  assertPublicSource(ctx.source.root);
  const manifest = { schema: FIXTURE_SCHEMA, status: 'prepared', publicSource: ctx.source,
    dependencyIdentity: ctx.dependencies, historicalPool: history.binding,
    producer: { path: 'scripts/energy-challenge-migration-fixtures.mjs', sha256: hash(readFileSync(fileURLToPath(import.meta.url))), node: process.version },
    missingArchivedInputs: [], archivedRevisions: Array.from({ length: 12 }, (_, i) => i + 2),
    generatedPublicSerializerRevisions: [14], nativeInputs, nativeInputCount: 15, domainPreparationCaseCount: cases.length, allowedAddedStateFields: ['energyChallenge'], excludedPriorStateFields: [],
    notes: ['No candidate production code executes in this producer or oracle.',
      'r2–r13 originals retain exact checked-in serializer bytes; synthetic setup labels remain explicit.',
      'r14 uses the actual pinned public serializer after actual pinned reader/catchUp adoption.',
      'The 15 native inputs are a fixed census separate from the 32 deterministic domain preparations.',
      'Zero and positive intervals here are deterministic domain preparation only.',
      'Native runners must use untouched source bytes and recompute the oracle from their actual constructorNow; never fit time from candidate state.',
      'Protected startup placeholders are nondeterministic and must not be compared to fabricated expected initial states.',
      'Unknown r15 and malformed r16 receipt/typed markers are separate synthetic refusal probes; no r15 schema is invented.'], cases };
  put('manifest.json', json(manifest));
  return manifest;
}

/** Bounded, single-document REALCLOCK replay. All observed states are assertions.
 * The only economic input is a byte-exact real public serializer output reproduced
 * independently here. Clocks come only from source-read/startup/native frame/save
 * observations. No candidate production code, fitted duration, or retagged input.
 * The caller independently proves native V8/Storage provenance; this verifier
 * binds that audit's exact primary write strings and readbacks to the replay.
 */
export async function replayNativeMigration(root, input) {
  assert.equal(arguments.length, 2, 'Only the pinned public root and complete observations are accepted');
  exactKeys(input, ['epoch', 'startup', 'nativePrimaryWrites', 'finalPrimaryRaw', 'finalBackupRaw'], 'replay input');
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= REPLAY_LIMITS.inputBytes, 'Bounded replay input bytes');
  const { epoch, startup } = input;
  exactKeys(epoch, ['constructorNow', 'startupClock', 'sourceRaw', 'ready', 'events'], 'epoch');
  exactKeys(epoch.startupClock, ['wallAt', 'frameAt'], 'startupClock');
  exactKeys(epoch.ready, ['mode', 'lastTickAt', 'state'], 'ready');
  milliseconds(epoch.constructorNow, 'constructorNow');
  milliseconds(epoch.startupClock.wallAt, 'startupClock.wallAt');
  milliseconds(epoch.startupClock.frameAt, 'startupClock.frameAt');
  assert.equal(epoch.constructorNow, epoch.startupClock.wallAt, 'Original constructor uses paired native wall sample');
  assert.ok(Array.isArray(epoch.events) && epoch.events.length > 0 && epoch.events.length <= REPLAY_LIMITS.events,
    'One bounded complete native document through its first requested manual save');
  assert.ok(Array.isArray(input.nativePrimaryWrites) && input.nativePrimaryWrites.length > 0
    && input.nativePrimaryWrites.length <= REPLAY_LIMITS.primaryWrites, 'Bounded native primary writes required');
  for (const raw of input.nativePrimaryWrites) assert.equal(typeof raw, 'string', 'Exact native primary raw strings required');
  const ctx = await loadPublic(root), history = readHistoricalPool(ctx.source.root);
  const genuine = genuinePublicR14Source(ctx, history);
  assert.equal(epoch.sourceRaw, genuine.raw, 'REALCLOCK input must be exact independently reproduced public r14 serializer bytes');
  assert.equal(startup.sourceRaw, epoch.sourceRaw, 'Startup snapshot and source-read refer to the same original bytes');
  assert.equal(startup.constructorNow, epoch.constructorNow, 'Startup snapshot uses the actual observed constructor time');
  const oracle = await publicStartupOracle(ctx.source.root, epoch.sourceRaw, epoch.constructorNow);
  const startupVerification = verifyCandidateStartup(oracle, startup);
  assert.deepEqual(epoch.ready, { mode: startup.mode, lastTickAt: startup.lastTickAt, state: startup.state },
    'to_replay_epoch ready snapshot must be the same complete observed startup snapshot');
  const { save, offline, logic } = ctx;
  const read = save.importSave(genuine.raw);
  const start = adoptedSteps(save.deserializeState(read.state),
    state => offline.catchUp(state, (epoch.constructorNow - read.lastTickAt) / 1000), save.serializeState);
  let state = start.result.state;
  assert.deepEqual(save.serializeState(state), oracle.state, 'Independent startup reconstruction');
  let accountedFrameAt = epoch.startupClock.frameAt, durableRaw = startup.primaryRaw;
  const watermark = () => epoch.startupClock.wallAt + (accountedFrameAt - epoch.startupClock.frameAt);
  const expectedWrites = [startup.primaryRaw];
  const saves = [{ eventIndex: -1, reason: 'migration', savedAt: epoch.constructorNow,
    lastTickAt: epoch.constructorNow, rawSha256: hash(startup.primaryRaw), expectedEnvelope: expectedCandidateEnvelope(oracle) }];
  const adoptions = [{ eventIndex: -1, kind: 'catchUp', gapSeconds: (epoch.constructorNow - read.lastTickAt) / 1000,
    adoptedSegmentsSeconds: start.steps, loaded: loadedSummary(start.result) }];
  let pendingFrame = null, pendingSave = null, pendingManual = false, positiveFrames = 0, manualSaves = 0;
  for (const [eventIndex, event] of epoch.events.entries()) {
    const place = `events[${eventIndex}]`;
    assert.ok(event && typeof event === 'object' && !Array.isArray(event), `${place}: object required`);
    if (event.kind === 'frame') {
      exactKeys(event, ['kind', 'now', 'gapSeconds', 'mode', 'lastTickAtBefore'], place);
      assert.equal(pendingFrame, null, `${place}: no overlapping or missing-end frame`);
      assert.equal(pendingSave, null, `${place}: previous save must finish`);
      assert.equal(pendingManual, false, `${place}: manual action must finish`);
      milliseconds(event.now, `${place}.now`);
      assert.ok(event.now - epoch.startupClock.frameAt <= REPLAY_LIMITS.frameSpanMilliseconds, 'Bounded native observation window');
      assert.equal(event.mode, 'ready', `${place}: successful trajectory only`);
      assert.equal(event.lastTickAtBefore, watermark(), `${place}: exact independently accounted watermark`);
      const projectedWall = epoch.startupClock.wallAt + (event.now - epoch.startupClock.frameAt);
      const admissible = event.now >= accountedFrameAt && projectedWall >= 0 && projectedWall <= Number.MAX_SAFE_INTEGER;
      const gap = admissible ? (event.now - accountedFrameAt) / 1000 : 0;
      assert.equal(event.gapSeconds, gap, `${place}: native gap comes only from actual RAF timestamps`);
      if (gap > 0) {
        const kind = gap >= 5 ? 'catchUp' : 'tick';
        const adopted = adoptedSteps(state, before => kind === 'catchUp'
          ? offline.catchUp(before, gap) : { state: logic.tick(before, gap) }, save.serializeState);
        state = adopted.result.state;
        adoptions.push({ eventIndex, kind, gapSeconds: gap, adoptedSegmentsSeconds: adopted.steps,
          ...(kind === 'catchUp' ? { loaded: loadedSummary(adopted.result) } : {}) });
        accountedFrameAt = event.now; positiveFrames++;
      }
      pendingFrame = { now: event.now, catchUp: gap >= 5, saves: 0 };
    } else if (event.kind === 'frame-end') {
      exactKeys(event, ['kind', 'now', 'mode', 'lastTickAt'], place);
      assert.ok(pendingFrame, `${place}: prior actual frame required`);
      assert.equal(pendingSave, null, `${place}: catchUp persistence must finish`);
      assert.equal(event.now, pendingFrame.now, `${place}: same actual callback`);
      assert.equal(event.mode, 'ready', `${place}: successful original frame required`);
      assert.equal(event.lastTickAt, watermark(), `${place}: exact adopted watermark`);
      assert.equal(pendingFrame.saves, pendingFrame.catchUp ? 1 : 0, `${place}: original frame persistence count`);
      pendingFrame = null;
    } else if (event.kind === 'save-input') {
      exactKeys(event, ['kind', 'savedAt', 'lastTickAt', 'mode', 'state', 'expectedRaw'], place);
      assert.equal(pendingSave, null, `${place}: no overlapping save`);
      assert.equal(event.mode, 'ready', `${place}: ready save required`);
      if (pendingFrame) assert.ok(pendingFrame.catchUp && pendingFrame.saves === 0, `${place}: only one catchUp persist inside frame`);
      milliseconds(event.savedAt, `${place}.savedAt`);
      assert.equal(event.lastTickAt, watermark(), `${place}: exact actual accounted watermark`);
      assert.equal(event.expectedRaw, durableRaw, `${place}: previous verified durable write`);
      assertAdditiveState(event.state, save.serializeState(state), `${place}.state`);
      pendingSave = event;
    } else if (event.kind === 'save') {
      exactKeys(event, ['kind', 'savedAt', 'lastTickAt', 'raw', 'reason'], place);
      assert.ok(pendingSave, `${place}: original save input is mandatory`);
      assert.equal(event.savedAt, pendingSave.savedAt, `${place}: same actual save time`);
      assert.equal(event.lastTickAt, pendingSave.lastTickAt, `${place}: no repaired or fitted watermark`);
      assert.ok(['manual', 'autosave', 'catchUp', 'visibility-hidden', 'beforeunload'].includes(event.reason), `${place}: supported observed reason required`);
      assert.equal(event.reason === 'manual', pendingManual, `${place}: manual persist must match native action`);
      assert.equal(event.reason === 'catchUp', pendingFrame !== null, `${place}: catchUp persists in its original frame`);
      const publicEnvelope = JSON.parse(save.exportSave(state, event.savedAt, event.lastTickAt));
      assert.equal(publicEnvelope.revision, 14);
      const expectedEnvelope = { ...publicEnvelope, revision: 16,
        state: { energyChallenge: copy(DEFAULT_CHALLENGE), ...publicEnvelope.state } };
      assert.equal(typeof event.raw, 'string', `${place}: exact observed save bytes required`);
      assert.deepEqual(JSON.parse(event.raw), expectedEnvelope, `${place}: exact complete independently serialized envelope`);
      assert.equal(event.raw, json(expectedEnvelope), `${place}: exact serializer bytes, including both original timestamps`);
      if (event.raw !== durableRaw) expectedWrites.push(event.raw);
      durableRaw = event.raw;
      saves.push({ eventIndex, reason: event.reason, savedAt: event.savedAt, lastTickAt: event.lastTickAt,
        rawSha256: hash(event.raw), expectedEnvelope });
      if (pendingFrame) pendingFrame.saves++;
      if (event.reason === 'manual') manualSaves++;
      pendingSave = null; pendingManual = false;
    } else if (event.kind === 'action') {
      exactKeys(event, ['kind', 'actionType', 'mode'], place);
      assert.equal(pendingFrame, null, `${place}: no action inside synchronous frame`);
      assert.equal(pendingSave, null, `${place}: no action inside synchronous save`);
      assert.equal(pendingManual, false, `${place}: previous manual action must finish`);
      assert.equal(event.mode, 'ready', `${place}: ready native action required`);
      assert.ok(['save', 'dismiss-notice', 'dismiss-offline'].includes(event.actionType), `${place}: economic actions outside migration replay`);
      pendingManual = event.actionType === 'save';
    } else assert.fail(`${place}: unsupported event ${event.kind}`);
  }
  assert.equal(pendingFrame, null, 'No truncated native frame');
  assert.equal(pendingSave, null, 'No truncated native save');
  assert.equal(pendingManual, false, 'No truncated native manual action');
  assert.ok(positiveFrames > 0, 'REALCLOCK acceptance must observe actual positive native frames');
  assert.equal(manualSaves, 1, 'Bounded prefix must contain exactly one complete requested manual save');
  assert.equal(epoch.events.at(-1).kind, 'save');
  assert.equal(epoch.events.at(-1).reason, 'manual', 'Trace ends at its requested native manual save');
  assert.deepEqual(input.nativePrimaryWrites, expectedWrites, 'Every exact native primary write, including migration and no extras');
  assert.equal(input.finalPrimaryRaw, durableRaw, 'Final native durable primary readback equals exact independently verified save');
  assert.equal(input.finalBackupRaw, genuine.raw, 'Original historical backup remains byte exact after all frames and saves');
  assertPublicSource(ctx.source.root);
  const publicState = save.serializeState(state);
  return { schema: REPLAY_SCHEMA, status: 'passed', publicSource: ctx.source, dependencyIdentity: ctx.dependencies,
    producerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), sourceRevision: 14,
    inputRawSha256: hash(genuine.raw), inputProvenance: genuine.provenance, constructorNow: epoch.constructorNow,
    startupClock: copy(epoch.startupClock), startupVerification, startupState: oracle.state,
    adoptions, saves, positiveNativeFrames: positiveFrames, lastTickAt: watermark(),
    state: publicState, expectedState: { energyChallenge: copy(DEFAULT_CHALLENGE), ...publicState },
    primaryWriteRawSha256s: expectedWrites.map(hash), finalPrimaryRawSha256: hash(durableRaw),
    backupRawSha256: hash(input.finalBackupRaw), excludedPriorFields: [], allowedAddedStateFields: ['energyChallenge'],
    nativeProvenanceClaimed: false, boundary: 'Full independent public-r14 economic/time/write replay; actual native V8/Storage provenance verified separately' };
}


if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, arg1, arg2, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, 'No extra arguments');
  if (mode === 'generate') {
    assert.ok(arg1 && arg2, 'generate requires public root and output directory');
    const result = await generateFixtures(arg1, arg2);
    console.log(json({ schema: result.schema, status: result.status, cases: result.cases.length,
      manifest: resolve(arg2, 'manifest.json'), missingArchivedInputs: result.missingArchivedInputs }));
  } else if (mode === 'oracle') {
    assert.ok(arg1 && !arg2, 'oracle requires only public root');
    const input = JSON.parse(readFileSync(0, 'utf8'));
    exactKeys(input, ['originalRaw', 'constructorNow'], 'oracle input');
    console.log(json(await publicStartupOracle(arg1, input.originalRaw, input.constructorNow)));
  } else if (mode === 'replay') {
    assert.ok(arg1 && !arg2, 'replay requires only public root');
    const bytes = readFileSync(0);
    assert.ok(bytes.length <= REPLAY_LIMITS.inputBytes, 'Bounded replay input bytes');
    console.log(json(await replayNativeMigration(arg1, JSON.parse(bytes.toString('utf8')))));
  } else if (mode === 'verify-startup') {
    assert.ok(arg1 && arg2, 'verify-startup requires oracle and observation paths');
    console.log(json(verifyCandidateStartup(JSON.parse(readFileSync(arg1, 'utf8')), JSON.parse(readFileSync(arg2, 'utf8')))));
  } else assert.fail('Use generate, oracle, verify-startup, or replay');
}
