/** Focused synthetic trace goldens, not a native-browser acceptance claim.
 * node --import tsx --test scripts/test-r13-native-replay-oracle.mjs
 */
import assert from 'node:assert/strict';
import { expectedNpcEconomy, advanceExpectedNpcWallet, liftR11StateToR13, projectVerifiedNpcEconomy } from './r13-compatibility.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { replayNativeTrace, TRACE_SCHEMA, SOURCE_SHA, DEPENDENCIES } from './r13-native-replay-oracle.mjs';
import { assertPinnedSource, dependencyIdentity } from './r11-startup-oracle.mjs';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';

const root = resolve(process.env.R11_ORACLE_SOURCE || fileURLToPath(new URL('../../infinity-npc-r11-source', import.meta.url)));
const here = fileURLToPath(new URL('../', import.meta.url));
const r11 = JSON.parse(readFileSync(new URL('../tests/fixtures/npc-economy-r11.json', import.meta.url), 'utf8'));
const r9 = JSON.parse(readFileSync(new URL('../tests/fixtures/terraformer-r9.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
assertPinnedSource(root);
assert.deepEqual(dependencyIdentity(root), DEPENDENCIES);
const [save, offline, logic] = await Promise.all(['src/game/save.ts', 'src/core/offline.ts', 'src/game/logic.ts']
  .map(path => import(pathToFileURL(resolve(root, path)).href)));

// Generate explicit synthetic observations with only pinned historical modules.
// The producer is separate from the replay verifier; hard golden hashes below
// anchor every full saved state and exact per-segment age in the normal trace.
function syntheticTrace(raw, specs = [
  { delay: 381.5, frameAt: 100.125, deltas: [0, 16.625, 83.375, 5000.25, 500.125] },
  { delay: 181.25, frameAt: 71.5, deltas: [16.75, 17.125, 6173.25] },
  { delay: 731.75, frameAt: 53.625, deltas: [0.0000001, 16.625, 883.25] },
]) {
  let oldFile = save.importSave(raw), state, age = expectedNpcEconomy(), previousRaw = raw;
  const input = { schema: TRACE_SCHEMA, originalRaw: raw, epochs: [] };
  function step(seconds, offlineMode) {
    const observed = captureAdoptedSteps(state, current => offlineMode
      ? offline.catchUp(current, seconds) : { state: logic.tick(current, seconds) }, save.serializeState);
    state = observed.result.state;
    age = advanceExpectedNpcWallet(age, observed.adoptedSegmentsSeconds);
  }
  function withNpc() {
    return liftR11StateToR13(save.serializeState(state),age);
  }
  function write(savedAt, lastTickAt) {
    oldFile = JSON.parse(save.exportSave(state, savedAt, lastTickAt));
    previousRaw = JSON.stringify({ ...oldFile, revision: 13, state: withNpc() }, null, 2);
    return previousRaw;
  }
  for (const [index, spec] of specs.entries()) {
    const sourceRaw = previousRaw;
    // Use the independent old file, not the just-produced candidate projection.
    const read = index === 0 ? save.importSave(raw) : save.importSave(JSON.stringify(oldFile));
    const constructorNow = read.lastTickAt + spec.delay;
    state = save.deserializeState(read.state);
    step((constructorNow - read.lastTickAt) / 1000, true);
    const epoch = { constructorNow, startupClock: { wallAt: constructorNow, frameAt: spec.frameAt }, sourceRaw,
      ready: { mode: 'ready', lastTickAt: constructorNow, state: withNpc() }, events: [] };
    if (index === 0) epoch.migrationRaw = write(constructorNow, constructorNow);
    let now = spec.frameAt, accounted = now;
    const watermark = () => constructorNow + (accounted - spec.frameAt);
    function persisted(reason, savedAt) {
      const lastTickAt = watermark(), expectedRaw = previousRaw;
      epoch.events.push({ kind: 'save-input', savedAt, lastTickAt, mode: 'ready', state: withNpc(), expectedRaw });
      epoch.events.push({ kind: 'save', savedAt, lastTickAt, raw: write(savedAt, lastTickAt), reason });
    }
    for (const delta of spec.deltas) {
      now += delta;
      const gapSeconds = (now - accounted) / 1000;
      epoch.events.push({ kind: 'frame', now, gapSeconds, mode: 'ready', lastTickAtBefore: watermark() });
      if (gapSeconds > 0) { step(gapSeconds, gapSeconds >= 5); accounted = now; }
      if (gapSeconds >= 5) persisted('catchUp', watermark() + 10.25);
      epoch.events.push({ kind: 'frame-end', now, mode: 'ready', lastTickAt: watermark() });
    }
    epoch.events.push({ kind: 'action', actionType: 'dismiss-notice', mode: 'ready' });
    persisted('beforeunload', watermark() + 17.625);
    input.epochs.push(epoch);
  }
  return input;
}

const sample = syntheticTrace(r11.rows[0].raw);
function events(input, kind, epoch = 0) { return input.epochs[epoch].events.filter(event => event.kind === kind); }
function changeRaw(input, epoch, saveIndex, change) {
  const event = events(input, 'save', epoch)[saveIndex], file = JSON.parse(event.raw);
  change(file);
  event.raw = JSON.stringify(file);
}
async function rejects(change, pattern, input = sample) {
  const modified = structuredClone(input);
  change(modified);
  await assert.rejects(replayNativeTrace(root, modified), pattern);
}

test('full-state golden: first migration and nonzero NPC age survive actual-stage saves and two reloads', async () => {
  const result = await replayNativeTrace(root, sample);
  assert.equal(result.schema, 'infinity-fixed-r11-native-r13-replay-oracle-v1');
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.deepEqual(result.dependencyIdentity, DEPENDENCIES);
  assert.equal(result.inputRawSha256, r11.rows[0].rawSha256);
  assert.equal(result.sourceRevision, 11);
  assert.equal(result.epochs.length, 3);
  assert.equal(result.saves.length, 6);
  assert.equal(result.oldObservedAndUnobservedStateEqual, true);
  assert.ok(result.epochs.every(epoch => epoch.npcWallet.now > 0));
  assert.deepEqual(result.epochs.map(epoch => epoch.readerInput), [
    'untouched historical source bytes',
    'synthetic r11 compatibility bridge from independent expected state',
    'synthetic r11 compatibility bridge from independent expected state',
  ]);
  assert.equal(result.saves[0].reason, 'migration');
  assert.ok(result.adoptions.some(step => step.kind === 'tick'));
  assert.ok(result.adoptions.some(step => step.kind === 'catchUp' && step.eventIndex >= 0));
  assert.ok(result.adoptions.some(step => step.kind === 'tick' && step.gapSeconds > 0 && step.adoptedSegmentsSeconds.length === 0));
  let independentAge = expectedNpcEconomy();
  for (const step of result.adoptions) {
    assert.deepEqual(step.walletBefore, independentAge);
    independentAge = advanceExpectedNpcWallet(independentAge,step.adoptedSegmentsSeconds);
    assert.deepEqual(step.npcWallet, independentAge);
    assert.equal(step.oldObservedAndUnobservedStateEqual, true);
  }
  assert.deepEqual(result.npcWallet, independentAge);
  // Full state hashes, including all wallets, queues, orders, grants and timers.
  const golden = result.saves.map(row => {
    const {npcEconomy,npcBattles}=row.expectedEnvelope.state;
    const oldState=projectVerifiedNpcEconomy(row.expectedEnvelope.state,row.npcWallet,'pinned pre-remainder historical golden');
    assert.deepEqual(npcEconomy,expectedNpcEconomy([row.npcWallet.now]));
    assert.deepEqual(npcBattles,{model:'npc-battle-receipts-v1',reports:[]});
    return {age:npcEconomy.now,hash:hash({npcEconomy:{model:'fixed-production-v1',elapsedSeconds:npcEconomy.now},...oldState})};
  });
  if (process.env.PRINT_R12_REPLAY_GOLDENS) console.log(JSON.stringify({ golden, adoptionHash: hash(result.adoptions) }));
  assert.deepEqual(golden, GOLDEN_SAVES);
  const oldAdoptions=result.adoptions.map(({walletBefore,npcWallet,...row})=>({epochIndex:row.epochIndex,eventIndex:row.eventIndex,kind:row.kind,gapSeconds:row.gapSeconds,ageBefore:walletBefore.now,adoptedSegmentsSeconds:row.adoptedSegmentsSeconds,npcElapsedSeconds:npcWallet.now,oldObservedAndUnobservedStateEqual:row.oldObservedAndUnobservedStateEqual,adoptedTimeObservation:row.adoptedTimeObservation,...(row.kind==='catchUp'?{rawSeconds:row.rawSeconds,appliedSeconds:row.appliedSeconds,capSeconds:row.capSeconds,capped:row.capped}:{})}));
  assert.equal(hash(oldAdoptions), GOLDEN_ADOPTIONS_SHA256);
});

test('every genuine fixture can replay without a second legacy normalization', async () => {
  for (const row of [...r11.rows, ...r9.rows]) {
    assert.equal(hash(row.raw), row.rawSha256);
    const input = syntheticTrace(row.raw, [
      { delay: 381, frameAt: 31.125, deltas: [16.625, 5000.25, 250.125] },
      { delay: 619, frameAt: 57.75, deltas: [16.625, 7000.25] },
    ]);
    const result = await replayNativeTrace(root, input);
    const actual = JSON.parse(events(input, 'save', 1).at(-1).raw);
    assert.deepEqual(actual.state, liftR11StateToR13(result.state,result.npcWallet));
  }
});

test('r9 paid terraformer completion preserves evolving fields/grants and does not re-lift the original', async () => {
  const row = r9.rows.find(item => item.name === 'continuous_manual');
  const result = await replayNativeTrace(root, syntheticTrace(row.raw));
  const initial = result.saves[0].expectedEnvelope.state.planets[0];
  const final = result.state.planets[0];
  assert.ok(final.buildings.terraformer > initial.buildings.terraformer, 'real old paid job must finish in replay');
  assert.equal(final.terraformerFields.base, initial.terraformerFields.base);
  assert.equal(final.terraformerFields.grantedLevels, initial.terraformerFields.grantedLevels);
  assert.equal(final.fieldsMax, initial.fieldsMax, 'legacy paid work grants no new slots');
  assert.ok(final.buildQueue.length < initial.buildQueue.length);
  assert.equal(result.epochs[1].sourceSavedAt, result.saves.filter(save => save.epochIndex === 0).at(-1).savedAt);
  assert.notEqual(result.epochs[1].constructorNow, result.epochs[1].sourceSavedAt);
});

test('NPC fold uses adopted segments even if large old totalTime loses every numeric increment', async () => {
  const original = JSON.parse(r11.rows[0].raw); original.state.totalTime = '1e400';
  const result = await replayNativeTrace(root, syntheticTrace(JSON.stringify(original)));
  assert.equal(result.state.totalTime, '1e+400');
  assert.ok(result.npcWallet.now > 10);
  assert.deepEqual(result.npcWallet, (await replayNativeTrace(root, sample)).npcWallet);
});

test('capped startup and frame catchUp consume the complete real watermark and wallet rebases at actual H12000 segment endpoint', async () => {
  const input = syntheticTrace(r11.rows[0].raw, [
    { delay: 99999999, frameAt: 21.25, deltas: [7200000.5] },
    { delay: 0, frameAt: 100.5, deltas: [16.25] },
  ]);
  const result = await replayNativeTrace(root, input);
  assert.deepEqual(result.npcWallet,{model:'npc-wallet-garrison-v1',now:2400.01625,baseline:{stock:[50000,30000,10000],mark:0},sites:{}});
  assert.equal(result.epochs[1].startupAdoption.rawSeconds, 0);
  assert.equal(result.epochs[0].lastTickAt, input.epochs[0].constructorNow + 7200000.5);
  assert.equal(result.adoptions[0].capped, true);
  assert.equal(result.adoptions[1].capped, true);
});

test('actual fractional savedAt/watermark and backward constructor wall time stay unmodified', async () => {
  const input = syntheticTrace(r11.rows[0].raw, [
    { delay: 381.5, frameAt: 31.125, deltas: [16.375] },
    { delay: -125.25, frameAt: 7.25, deltas: [16.625] },
  ]);
  const result = await replayNativeTrace(root, input);
  assert.ok(result.saves.some(row => !Number.isInteger(row.savedAt) && !Number.isInteger(row.lastTickAt)));
  assert.equal(result.epochs[1].startupAdoption.rawSeconds, 0);
  assert.deepEqual(result.epochs[1].startupAdoption.walletBefore, result.epochs[0].npcWallet);
  assert.deepEqual(result.epochs[1].startupAdoption.npcWallet, result.epochs[0].npcWallet);
});

test('native visibility-hidden persistence may follow beforeunload and is the exact next source', async () => {
  const input = structuredClone(sample), epoch = input.epochs[0];
  const prior = events(input, 'save')[1], file = JSON.parse(prior.raw);
  file.savedAt += 6;
  const raw = JSON.stringify(file, null, 2);
  epoch.events.push({ kind: 'save-input', savedAt: file.savedAt, lastTickAt: file.lastTickAt,
    mode: 'ready', state: file.state, expectedRaw: prior.raw });
  epoch.events.push({ kind: 'save', savedAt: file.savedAt, lastTickAt: file.lastTickAt, raw, reason: 'visibility-hidden' });
  input.epochs[1].sourceRaw = raw;
  for (const event of events(input, 'save-input', 1)) if (event.expectedRaw === prior.raw) event.expectedRaw = raw;
  const result = await replayNativeTrace(root, input);
  assert.equal(result.epochs[1].sourceSavedAt, file.savedAt);
  assert.deepEqual(result.state, (await replayNativeTrace(root, sample)).state);
});

test('the native 5-second boundary chooses old live tick below it and old catchUp at it', async () => {
  const input = syntheticTrace(r11.rows[0].raw, [
    { delay: 0, frameAt: 100, deltas: [4999.75, 5000] },
  ]);
  const result = await replayNativeTrace(root, input);
  assert.deepEqual(result.adoptions.map(row => [row.kind, row.gapSeconds]), [
    ['catchUp', 0], ['tick', 4.99975], ['catchUp', 5],
  ]);
  assert.deepEqual(result.saves.map(row => row.reason), ['migration', 'catchUp', 'beforeunload']);
});

test('an unsaved frame after the durable boundary cannot leak age into reload', async () => {
  const input = structuredClone(sample), epoch = input.epochs[0];
  const saved = events(input, 'save')[1], lastFrame = events(input, 'frame-end').at(-1), now = lastFrame.now + 500;
  epoch.events.push({ kind: 'frame', now, gapSeconds: 0.5, mode: 'ready', lastTickAtBefore: saved.lastTickAt });
  epoch.events.push({ kind: 'frame-end', now, mode: 'ready', lastTickAt: saved.lastTickAt + 500 });
  const result = await replayNativeTrace(root, input), normal = await replayNativeTrace(root, sample);
  const savedAge = JSON.parse(saved.raw).state.npcEconomy.now;
  assert.ok(result.epochs[0].npcWallet.now > savedAge);
  assert.equal(result.epochs[1].startupAdoption.walletBefore.now, savedAge);
  assert.deepEqual(result.npcWallet, normal.npcWallet);
  assert.deepEqual(result.state, normal.state);
});

test('complete B is verified before any reload bridge, including ordinary non-NPC fields', async () => {
  await rejects(input => changeRaw(input, 0, 1, file => { file.state.npcEconomy.now = 0; }), /complete saved envelope/);
  await rejects(input => changeRaw(input, 0, 1, file => { file.state.planets[0].resources.metal = '999999'; }), /complete saved envelope/);
  await rejects(input => changeRaw(input, 0, 1, file => { file.state.terraformerGrantJobFloor++; }), /complete saved envelope/);
  await rejects(input => changeRaw(input, 0, 1, file => { file.state.extra = true; }), /complete saved envelope/);
  await rejects(input => changeRaw(input, 0, 1, file => { file.extra = true; }), /complete saved envelope/);
});

test('runtime saves reject whitespace-only and property-order-only byte changes', async () => {
  const reorder = object => Object.fromEntries(Object.entries(object).reverse());
  const formats = [
    raw => JSON.stringify(JSON.parse(raw)),
    raw => `${raw}\n`,
    raw => JSON.stringify(JSON.parse(raw), null, 4),
    raw => JSON.stringify(reorder(JSON.parse(raw)), null, 2),
    raw => { const file = JSON.parse(raw); file.state = reorder(file.state); return JSON.stringify(file, null, 2); },
    raw => { const file = JSON.parse(raw); file.state.npcEconomy = reorder(file.state.npcEconomy); return JSON.stringify(file, null, 2); },
  ];
  for (const transform of formats) {
    await rejects(input => { const event = events(input, 'save')[1]; event.raw = transform(event.raw); }, /exact canonical runtime save bytes/);
    await rejects(input => { input.epochs[0].migrationRaw = transform(input.epochs[0].migrationRaw); }, /exact canonical runtime save bytes/);
  }
});

test('historical source bytes remain untouched and may be noncanonical', async () => {
  const original = JSON.parse(r11.rows[0].raw);
  const raw = ` \n${JSON.stringify(Object.fromEntries(Object.entries(original).reverse()))}\n `;
  assert.notEqual(raw, r11.rows[0].raw);
  const input = syntheticTrace(raw), result = await replayNativeTrace(root, input);
  assert.equal(input.originalRaw, raw);
  assert.equal(input.epochs[0].sourceRaw, raw);
  assert.equal(result.inputRawSha256, hash(raw));
  assert.equal(result.epochs[0].sourceRawSha256, hash(raw));
  assert.deepEqual(result.saves.map(row => row.expectedEnvelope), (await replayNativeTrace(root, sample)).saves.map(row => row.expectedEnvelope));
});

test('candidate age cannot seed or reset any later startup or frame', async () => {
  await rejects(input => { input.epochs[1].ready.state.npcEconomy.now = 0; }, /complete current state/);
  await rejects(input => { events(input, 'save-input', 1)[0].state.npcEconomy.now += 0.01; }, /complete current state/);
  await rejects(input => { input.epochs[1].sourceRaw = input.epochs[0].migrationRaw; }, /exact bytes of the preceding/);
  await rejects(input => { input.originalRaw = input.epochs[0].migrationRaw; }, /historical r2-r11/);
});

test('actual constructor clock cannot be replaced with savedAt or a fitted age/gap', async () => {
  await rejects(input => { input.epochs[1].constructorNow = JSON.parse(input.epochs[1].sourceRaw).savedAt; }, /original paired wall sample/);
  await rejects(input => { input.epochs[1].startupClock.frameAt += 0.001; }, /observed gap/);
  await rejects(input => { input.epochs[0].fittedGapSeconds = 0.3815; }, /unexpected fittedGap/);
  await rejects(input => { input.candidateState = {}; }, /unexpected candidateState/);
  await rejects(input => { input.epochs[1].migrationRaw = input.epochs[1].sourceRaw; }, /current constructor does not save/);
});

test('frame tampering, changed threshold, missing stages, and fabricated save order fail closed', async () => {
  await rejects(input => { events(input, 'frame')[1].gapSeconds += 0.001; }, /observed gap/);
  await rejects(input => { events(input, 'frame')[1].now += 0.001; }, /observed gap/);
  await rejects(input => { events(input, 'frame')[1].lastTickAtBefore += 1; }, /pre-frame paired watermark/);
  await rejects(input => { events(input, 'frame-end')[1].lastTickAt += 1; }, /post-adoption paired watermark/);
  await rejects(input => { events(input, 'frame')[1].mode = 'protected'; }, /protected\/conflict/);
  await rejects(input => { input.epochs[0].events.splice(1, 1); }, /overlapping\/missing-end/);
  await rejects(input => { input.epochs[0].events = input.epochs[0].events.filter(event => event.kind !== 'save-input'); }, /original save-input/);
  await rejects(input => { events(input, 'save')[0].reason = 'beforeunload'; }, /catchUp persist/);
  await rejects(input => { events(input, 'save')[1].reason = 'manual'; }, /actual beforeunload/);
  await rejects(input => { events(input, 'action')[0].actionType = 'scrape'; }, /economic actions/);
});

test('save timestamps, exact baseline bytes, missing migration A, and incomplete traces fail closed', async () => {
  await rejects(input => { events(input, 'save-input')[0].lastTickAt += 0.25; }, /actual accounted watermark/);
  await rejects(input => { events(input, 'save-input')[0].expectedRaw = JSON.stringify(JSON.parse(events(input, 'save-input')[0].expectedRaw)); }, /baseline equals last verified/);
  await rejects(input => { events(input, 'save')[0].savedAt += 0.25; }, /original save call/);
  await rejects(input => { events(input, 'save')[0].lastTickAt = events(input, 'save')[0].savedAt; }, /repaired\/re-paired/);
  await rejects(input => { delete input.epochs[0].migrationRaw; }, /initial migration write A/);
  await rejects(input => { input.epochs.at(-1).events.pop(); }, /truncated persisted save/);
  for (const value of [-1, NaN, Infinity, '100']) await rejects(input => { input.epochs[0].constructorNow = value; }, /safe milliseconds/);
});

test('CLI rejects hidden fitted inputs and emits the same full replay result', async () => {
  const script = fileURLToPath(new URL('./r13-native-replay-oracle.mjs', import.meta.url));
  const actual = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script, root],
    { cwd: here, input: JSON.stringify(sample), encoding: 'utf8', stdio: 'pipe' }));
  assert.deepEqual(actual, await replayNativeTrace(root, sample));
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', script, root],
    { cwd: here, input: JSON.stringify({ ...sample, fittedAge: 123 }), encoding: 'utf8', stdio: 'pipe' }));
});

function copiedCheckout() {
  const base = mkdtempSync(join(tmpdir(), 'r12-replay-negative-')), copy = join(base, 'source');
  execFileSync('git', ['clone', '--shared', '--no-checkout', root, copy], { stdio: 'pipe' });
  execFileSync('git', ['checkout', SOURCE_SHA, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: copy, stdio: 'pipe' });
  for (const name of ['break_infinity.js', 'pad-end']) {
    const target = join(copy, 'node_modules', name); mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, 'node_modules', name), target, { recursive: true, dereference: true });
  }
  return { base, copy };
}

test('the replay entry point retains full source and dependency anti-tamper guards', async () => {
  const { base, copy } = copiedCheckout();
  try {
    const source = join(copy, 'src/game/logic.ts'), originalBytes = readFileSync(source);
    execFileSync('git', ['update-index', '--assume-unchanged', 'src/game/logic.ts'], { cwd: copy });
    writeFileSync(source, Buffer.concat([originalBytes, Buffer.from('\n// hidden mutation\n')]));
    await assert.rejects(replayNativeTrace(copy, sample), /exact archived file bytes/);
    writeFileSync(source, originalBytes);
    const shadow = join(copy, 'src/game/logic.js');
    writeFileSync(join(copy, '.git/info/exclude'), 'src/game/logic.js\n');
    writeFileSync(shadow, 'throw Error("must not execute");');
    await assert.rejects(replayNativeTrace(copy, sample), /no missing, extra, ignored, or shadow/);
    rmSync(shadow);
    const entry = join(copy, 'node_modules/break_infinity.js/dist/break_infinity.common.js');
    writeFileSync(entry, Buffer.concat([readFileSync(entry), Buffer.from('\n// changed implementation\n')]));
    await assert.rejects(replayNativeTrace(copy, sample), /old resolved numerical dependency bytes/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// Fixed output of the synthetic ca5-only producer above; never candidate output.
const GOLDEN_SAVES = [
  { age: 0.3815, hash: '8cdcc6fdea94a604198b674da04397a9858830e9aa5856c7b3a2637d5b210de6' },
  { age: 5.48175, hash: '7e3573bbcbe41f448d3fc045df1d57d590c664f3ca93ecacdc3877efbcb80850' },
  { age: 5.981875, hash: '852cd25e71fd377889ce6dc5294babe3b0644425c66fbb3ccf7cdfe9f4fe1aa4' },
  { age: 12.37025, hash: 'a865c0087f4138ea3d9f3a696133a5976b9cdd4e6ea06fb0abb88321b69e5f79' },
  { age: 12.37025, hash: 'a865c0087f4138ea3d9f3a696133a5976b9cdd4e6ea06fb0abb88321b69e5f79' },
  { age: 14.001875, hash: '8a9359d3fd277a9d99d1a68c6679623fd1011b7285308982381cf8aef5c672e7' },
];
const GOLDEN_ADOPTIONS_SHA256 = 'c151c7a244c5dcf268fd02bcdfae83c9c8c855c06db582a69c0c2beaba6047fb';
