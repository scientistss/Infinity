/** Domain/mutation tests only. Synthetic traces never claim native acceptance.
 * Run only under the shared Node execution lease:
 *   node --import tsx --test scripts/test-energy-challenge-migration-oracle.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { DEFAULT_CHALLENGE, PUBLIC_SHA, generateFixtures, publicStartupOracle, expectedCandidateEnvelope,
  verifyCandidateStartup, replayNativeMigration, REPLAY_LIMITS } from './energy-challenge-migration-fixtures.mjs';

const root = resolve(process.env.ENERGY_PUBLIC_R14_SOURCE || fileURLToPath(new URL('../../baseline-641', import.meta.url)));
const output = mkdtempSync(resolve(tmpdir(), 'infinity-energy-migration-oracle-'));
const manifest = await generateFixtures(root, output);
const [publicSave, publicOffline, publicLogic] = await Promise.all(['src/game/save.ts', 'src/core/offline.ts', 'src/game/logic.ts']
  .map(name => import(pathToFileURL(resolve(root, name)).href)));
// Candidate executes only in this test driver, never the producer or oracle.
const { SaveSession } = await import('../src/game/save-session.ts');
const { STORAGE_KEY } = await import('../src/game/content.ts');
const copy = value => structuredClone(value);
const json = value => JSON.stringify(value, null, 2);
const load = file => JSON.parse(readFileSync(file, 'utf8'));
const summary = ({ state, gains, ...rest }) => ({ ...JSON.parse(JSON.stringify(rest)),
  gains: Object.fromEntries(Object.entries(gains).map(([key, value]) => [key, value.toString()])) });

function storage(raw) {
  const values = new Map([[STORAGE_KEY, raw]]), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); writes.push({ key, raw: value }); },
    removeItem(key) { values.delete(key); } };
}

test('exact public identities and fixed 15 native inputs remain separate from 32 domain clock/refusal preparations', () => {
  assert.equal(manifest.publicSource.commit, PUBLIC_SHA);
  assert.equal(manifest.nativeInputCount, 15);
  assert.equal(manifest.cases.length, 32);
  assert.deepEqual(manifest.nativeInputs.map(row => row.id), [...Array.from({ length: 13 }, (_, i) => `migrate-r${i + 2}`),
    'unknown-r15', 'malformed-r16-completion']);
  assert.deepEqual(manifest.archivedRevisions, Array.from({ length: 12 }, (_, i) => i + 2));
  assert.deepEqual(manifest.generatedPublicSerializerRevisions, [14]);
  assert.equal(manifest.nativeInputs.filter(row => row.clockPolicy.startsWith('REALCLOCK')).length, 1);
  assert.equal(manifest.nativeInputs.find(row => row.id === 'migrate-r14').provenance.kind,
    'new-unmodified-public-r14-serializer-output');
});

test('all supported source bytes migrate with full old-state equality, literal inactive defaults and exact backup/write bytes', () => {
  for (const row of manifest.cases.filter(row => row.expectedMode === 'ready')) {
    const sourceRaw = readFileSync(row.sourceFile, 'utf8'), store = storage(sourceRaw);
    const session = new SaveSession(store, row.now), oracle = load(row.oracleFile);
    assert.equal(session.mode, 'ready', row.id);
    const actual = { sourceRaw, constructorNow: row.now, mode: session.mode,
      state: JSON.parse(store.getItem(STORAGE_KEY)).state, loaded: summary(session.loaded),
      primaryRaw: store.getItem(STORAGE_KEY), backupRaw: store.getItem(`${STORAGE_KEY}.backup`), lastTickAt: row.now };
    // Also compare the complete live adopted state; the durable write alone is insufficient.
    assert.deepEqual(actual.state, JSON.parse(session.export(session.loaded.state, row.now).raw).state, row.id);
    assert.equal(verifyCandidateStartup(oracle, actual).status, 'passed', row.id);
    assert.deepEqual(store.writes, [{ key: `${STORAGE_KEY}.backup`, raw: sourceRaw },
      { key: STORAGE_KEY, raw: json(expectedCandidateEnvelope(oracle)) }], row.id);
  }
});

test('unknown r15 and malformed r16 markers/receipt protect original bytes without primary or backup writes', () => {
  for (const row of manifest.cases.filter(row => row.expectedMode === 'protected')) {
    const raw = readFileSync(row.sourceFile, 'utf8'), store = storage(raw), session = new SaveSession(store, row.now);
    assert.equal(session.mode, 'protected', row.id);
    assert.equal(store.getItem(STORAGE_KEY), raw, row.id);
    assert.equal(store.getItem(`${STORAGE_KEY}.backup`), null, row.id);
    assert.deepEqual(store.writes, [], row.id);
    assert.deepEqual(session.export(session.loaded.state, row.now), { raw, protected: true }, row.id);
  }
});

async function syntheticTrace(capped = false) {
  const row = manifest.cases.find(row => row.id === 'r14-public-serializer-continuation-positive-61_25-seconds');
  const raw = readFileSync(row.sourceFile, 'utf8'), read = publicSave.importSave(raw);
  const now = read.lastTickAt + (capped ? 36_000_000 : 61_250), frameAt = 120.125;
  const oracle = await publicStartupOracle(root, raw, now);
  const migrated = json(expectedCandidateEnvelope(oracle));
  const startup = { sourceRaw: raw, constructorNow: now, mode: 'ready',
    state: { energyChallenge: copy(DEFAULT_CHALLENGE), ...oracle.state }, loaded: copy(oracle.loaded),
    primaryRaw: migrated, backupRaw: raw, lastTickAt: now };
  const epoch = { sourceRaw: raw, constructorNow: now, startupClock: { wallAt: now, frameAt },
    ready: { mode: 'ready', state: copy(startup.state), lastTickAt: now }, events: [] };
  let state = publicOffline.catchUp(publicSave.deserializeState(read.state), (now - read.lastTickAt) / 1000).state;
  let accounted = frameAt, durable = migrated;
  const nativePrimaryWrites = [migrated], watermark = () => now + (accounted - frameAt);
  const candidate = () => ({ energyChallenge: copy(DEFAULT_CHALLENGE), ...publicSave.serializeState(state) });
  function persist(reason, savedAt) {
    if (reason === 'manual') epoch.events.push({ kind: 'action', actionType: 'save', mode: 'ready' });
    epoch.events.push({ kind: 'save-input', savedAt, lastTickAt: watermark(), mode: 'ready', state: candidate(), expectedRaw: durable });
    const envelope = JSON.parse(publicSave.exportSave(state, savedAt, watermark()));
    const raw = json({ ...envelope, revision: 16, state: { energyChallenge: copy(DEFAULT_CHALLENGE), ...envelope.state } });
    epoch.events.push({ kind: 'save', savedAt, lastTickAt: watermark(), raw, reason });
    if (raw !== durable) nativePrimaryWrites.push(raw);
    durable = raw;
  }
  for (const delta of [0, .125, 125.125, 5001]) {
    const next = accounted + delta, gap = (next - accounted) / 1000;
    epoch.events.push({ kind: 'frame', now: next, gapSeconds: gap, mode: 'ready', lastTickAtBefore: watermark() });
    if (gap > 0) { state = gap >= 5 ? publicOffline.catchUp(state, gap).state : publicLogic.tick(state, gap); accounted = next; }
    if (gap >= 5) persist('catchUp', watermark() + 12.25);
    epoch.events.push({ kind: 'frame-end', now: next, mode: 'ready', lastTickAt: watermark() });
  }
  persist('manual', watermark() + 17.5);
  return { epoch, startup, nativePrimaryWrites, finalPrimaryRaw: durable, finalBackupRaw: raw };
}

test('public oracle refuses unknown/current candidate revisions, wrong source checkout and injected expected-state arguments', async () => {
  const row = manifest.cases.find(row => row.revision === 14 && row.expectedMode === 'ready');
  const raw = readFileSync(row.sourceFile, 'utf8');
  for (const revision of [1, 15, 16, 999]) {
    const envelope = JSON.parse(raw); envelope.revision = revision;
    await assert.rejects(publicStartupOracle(root, JSON.stringify(envelope), row.now));
  }
  await assert.rejects(publicStartupOracle(root, raw, row.now, { candidateState: {} }));
  await assert.rejects(publicStartupOracle(fileURLToPath(new URL('../', import.meta.url)), raw, row.now));
});

test('single-document replay independently adopts zero/fractional/live/catchUp frames and exact native write/readback assertions', async () => {
  for (const capped of [false, true]) {
    const trace = await syntheticTrace(capped), replay = await replayNativeMigration(root, trace);
    assert.equal(replay.status, 'passed');
    assert.equal(replay.nativeProvenanceClaimed, false);
    assert.equal(replay.positiveNativeFrames, 3);
    assert.deepEqual(replay.saves.map(row => row.reason), ['migration', 'catchUp', 'manual']);
    assert.equal(replay.adoptions[0].loaded.capped, capped);
    assert.deepEqual(replay.expectedState, JSON.parse(trace.finalPrimaryRaw).state);
    assert.deepEqual(replay.excludedPriorFields, []);
    assert.notEqual(replay.saves.at(-1).savedAt, replay.saves.at(-1).lastTickAt);
  }
});

test('clock fits, altered source/prior/default state, missing/extra native writes, readback changes and truncated/economic events fail closed', async () => {
  const original = await syntheticTrace();
  const mutations = [
    trace => { trace.epoch.sourceRaw += '\n'; },
    trace => { trace.epoch.constructorNow += .25; },
    trace => { trace.startup.state.darkMatter = '123456'; },
    trace => { trace.startup.state.energyChallenge.nextAttemptId = 2; },
    trace => { trace.startup.backupRaw += ' '; },
    trace => { trace.epoch.events[2].gapSeconds += .01; },
    trace => { trace.epoch.events[2].now += .01; },
    trace => { trace.epoch.events.find(row => row.kind === 'save-input').state.totalTime = '0'; },
    trace => { trace.epoch.events.find(row => row.kind === 'save-input').expectedRaw += ' '; },
    trace => { trace.epoch.events.find(row => row.kind === 'save').savedAt += 1; },
    trace => { trace.epoch.events.find(row => row.kind === 'save').raw += '\n'; },
    trace => { trace.epoch.events.find(row => row.kind === 'action').actionType = 'energy-challenge-enter'; },
    trace => { trace.epoch.events.pop(); },
    trace => { trace.nativePrimaryWrites.pop(); },
    trace => { trace.nativePrimaryWrites.push(trace.finalPrimaryRaw); },
    trace => { trace.nativePrimaryWrites.reverse(); },
    trace => { trace.finalPrimaryRaw += '\n'; },
    trace => { trace.finalBackupRaw += '\n'; },
    trace => { trace.epoch.events[0].now += REPLAY_LIMITS.frameSpanMilliseconds + 1; },
    trace => { trace.fittedSeconds = 0; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = copy(original); mutate(changed);
    await assert.rejects(replayNativeMigration(root, changed), `mutation ${index} must fail`);
  }
  await assert.rejects(replayNativeMigration(root, original, {}));
});
