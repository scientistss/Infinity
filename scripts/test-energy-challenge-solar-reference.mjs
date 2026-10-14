/** Focused package/replay preparation tests, never native-browser proof.
 * ENERGY_SOLAR_NATURAL=/absolute/energy-natural/report.json node --import tsx --test scripts/test-energy-challenge-solar-reference.mjs
 * Uses only the original action tape; natural expected outcomes never feed replay.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { runInNewContext, runInThisContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { projectActionTape, buildReference, canonical, sha, ACTION_TAPE_SHA256, OPTIONS, FIXED, ROOT } from './energy-challenge-solar-browser-reference.mjs';
import { validateActionTape, replay, EPOCH, SEED } from './energy-challenge-solar-browser-reference.ts';
const reportPath = process.env.ENERGY_SOLAR_NATURAL;
assert(reportPath, 'ENERGY_SOLAR_NATURAL must identify an original natural report; no invented tape');
const report = JSON.parse(readFileSync(reportPath)), natural = report.routes.find(route => route.policy === 'solar');
assert.equal(report.schema, 'energy-challenge-natural-v1'); assert.equal(report.status, 'passed'); assert.equal(natural.status, 'passed');
const receiptRaw = readFileSync(resolve(dirname(reportPath), natural.receipts.file)); assert.equal(sha(receiptRaw), natural.receipts.sha256);
const originalEvents = JSON.parse(receiptRaw), tape = projectActionTape(originalEvents), clone = value => JSON.parse(JSON.stringify(value));

// The original expected summaries/quotes/payments/checkpoint bytes are deliberately
// not sent into either replay invocation. Their only role is source input identity.
test('projects all and only original action fields into a uniquely frozen tape', async () => {
  assert.equal(sha(canonical(tape)), ACTION_TAPE_SHA256); assert.equal(tape.length, 4383);
  assert.deepEqual(await validateActionTape(tape), tape);
  for (const row of tape) assert.deepEqual(Object.keys(row), ['index', 'stage', 'api', 'request']);
  const outcomesPoisoned = originalEvents.map(event => {
    const row = { ...event }; for (const key of Object.keys(event)) if (!['index', 'stage', 'api', 'request'].includes(key)) Object.defineProperty(row, key, { get() { throw new Error('Expected outcome read is forbidden'); }, enumerable: true }); return row;
  });
  assert.deepEqual(projectActionTape(outcomesPoisoned), tape);
  assert.deepEqual(Object.fromEntries(Object.keys(FIXED).map(api => [api, tape.filter(row => row.api === api).length])), FIXED);
});
const changes = {
  truncation: rows => rows.pop(), extraAction: rows => rows.push(rows.at(-1)), reorder: rows => { [rows[10], rows[11]] = [rows[11], rows[10]]; },
  stateInput: rows => { rows[0].request.state = {}; }, quoteInput: rows => { rows.find(row => row.api === 'challengeCandidate').request.quote = {}; },
  paymentInput: rows => { rows.find(row => row.api === 'enqueue').request.payment = {}; }, checkpointBytes: rows => { rows.find(row => row.api === 'checkpoint').request.raw = '{}'; },
  otherSeed: rows => { rows[0].request.worldSeed++; }, bigTick: rows => { rows.find(row => row.api === 'tick').request.dt = 2; },
  offlineTick: rows => { rows.find(row => row.api === 'tick').request.mode = 'offline'; }, unknownApi: rows => { rows[10].api = 'importSave'; },
  automatedPayment: rows => { rows.find(row => row.api === 'enqueue').request.source = 'automation'; }, multiplePayment: rows => { rows.find(row => row.api === 'enqueue').request.count = 3; },
  sameCensusWrongTarget: rows => { rows.find(row => row.api === 'enqueue').request.target = 'solar_plant'; },
  sameCensusWrongReason: rows => { rows.find(row => row.api === 'tick').request.reason += '!'; },
  sameCensusWrongStage: rows => { rows[10].stage = 'reward-building'; },
  swapCurve: rows => { rows.find(row => row.api === 'challengeCandidate').request.action = 'finish'; },
  abandon: rows => { rows.find(row => row.api === 'checkpoint').request.name = 'abandoned'; },
  offlineCheckpoint: rows => { rows.find(row => row.api === 'checkpoint').request.appliedSeconds = 1; },
  noAdoption: rows => { rows.find(row => row.api === 'checkpoint').request.adoptsReader = false; },
  checkpointPath: rows => { rows.find(row => row.api === 'checkpoint').request.file = '../initial.json'; },
  rejectionChange: rows => { rows.find(row => row.api === 'reject').request.api = 'enqueue'; },
};
for (const [name, mutate] of Object.entries(changes)) test(`producer and browser reject altered action tape: ${name}`, async () => {
  const changed = clone(tape); mutate(changed); assert.throws(() => projectActionTape(changed)); await assert.rejects(validateActionTape(changed));
});
test('browser rejects expected-state fields even when outside the request', async () => {
  const changed = clone(tape); changed[0].state = {}; await assert.rejects(validateActionTape(changed));
});
test('browser snapshots validated data before asynchronous digest and rejects array side payloads', async () => {
  const changed = clone(tape), promise = validateActionTape(changed); changed[2].request.target = 'solar_plant';
  assert.deepEqual(await promise, tape);
  const extra = clone(tape); extra.state = {}; await assert.rejects(validateActionTape(extra));
});
test('browser rejects an action accessor without invoking it', async () => {
  const changed = clone(tape); let calls = 0; Object.defineProperty(changed[0], 'request', { get() { calls++; return {}; }, enumerable: true });
  await assert.rejects(validateActionTape(changed)); assert.equal(calls, 0); assert.throws(() => projectActionTape(changed)); assert.equal(calls, 0);
});

let directReplayFinal;
test('fresh complete replay produces full own states, receipts, all payments, and 22 save/readbacks', async () => {
  const output = await replay(tape); directReplayFinal = output.finalState;
  assert.equal(output.schema, 'infinity-energy-challenge-solar-browser-replay-v1'); assert.equal(output.rows, 4383); assert.equal(output.logicalSeconds, 4201);
  assert.equal(output.receipts.length, 4383); assert.equal(output.expectedStates.length, 4383); assert.equal(Object.keys(output.checkpoints).length, 22);
  const initial = JSON.parse(output.initial); assert.equal(initial.savedAt, EPOCH); assert.equal(initial.lastTickAt, EPOCH); assert.equal(initial.state.universe.seed, SEED);
  assert.deepEqual(initial.state.planets[0].resources, { metal: '500', crystal: '500', deuterium: '0' });
  assert.deepEqual(initial.state, output.expectedStates[0].state);
  const buildPrices = { metal_mine: [60, 15, 0, 1.5], crystal_mine: [48, 24, 0, 1.6], deuterium_synth: [225, 75, 0, 1.5], solar_plant: [75, 30, 0, 1.5], robotics_factory: [400, 120, 200, 2], research_lab: [200, 400, 200, 2], metal_storage: [1000, 0, 0, 2], crystal_storage: [1000, 500, 0, 2] };
  const researchPrices = { energy_tech: [0, 800, 400, 2], computer_tech: [0, 400, 600, 2], combustion_drive: [400, 0, 600, 2] };
  let candidates = 0, checkpoints = 0, payments = 0, rejected = 0;
  for (let i = 0; i < output.rows; i++) {
    const row = output.expectedStates[i], receipt = output.receipts[i], action = tape[i]; assert.deepEqual(projectFields(receipt), action);
    assert.deepEqual(Object.keys(row).sort(), ['index', 'state', ...(action.api === 'challengeCandidate' ? ['candidate'] : []), ...(action.api === 'checkpoint' ? ['raw'] : [])].sort());
    assert.deepEqual(Object.keys(row.state).sort(), Object.keys(initial.state).sort()); assert.equal(row.index, i + 1);
    assert.deepEqual(receipt.after.wallets.homeworld, row.state.planets[0].resources); assert.deepEqual(receipt.after.challenge, row.state.energyChallenge);
    if (i) assert.deepEqual(receipt.before, output.receipts[i - 1].after);
    if (row.candidate) { candidates++; assert.notDeepEqual(row.candidate, row.state); assert.deepEqual(row.state, output.expectedStates[i - 1].state); assert.equal(receipt.replayRejected, true); }
    if (row.raw) {
      checkpoints++; const cp = output.checkpoints[action.request.name]; assert.equal(cp.raw, row.raw); assert.equal(cp.sha256, sha(row.raw));
      assert.equal(cp.stateSha256, sha(canonical(row.state))); assert.equal(receipt.stateSha256, cp.stateSha256);
      const save = JSON.parse(row.raw); assert.deepEqual(save.state, row.state); assert.equal(save.savedAt, EPOCH + receipt.after.logicalSeconds * 1000); assert.equal(save.lastTickAt, save.savedAt);
      assert.deepEqual(row.state, output.expectedStates[i - 1].candidate ?? output.expectedStates[i - 1].state);
    }
    if (receipt.payment) {
      const p = receipt.payment; assert.equal(p.jobId, ++payments); assert.equal(p.actualJob.jobId, p.jobId); assert.equal(p.actualJob.source, 'manual'); assert.equal(p.actualJob.taskId, null);
      const base = (p.kind === 'building' ? buildPrices : researchPrices)[p.target];
      const golden = Object.fromEntries(['metal', 'crystal', 'deuterium'].map((id, j) => [id, String(Math.floor(base[j] * base[3] ** (p.targetLevel - 1) + 1e-8))]));
      assert.deepEqual(p.cost, golden); assert.deepEqual(p.actualJob.paid, golden); assert.deepEqual(p.beforeWallet, receipt.before.wallets.homeworld); assert.deepEqual(p.afterWallet, receipt.after.wallets.homeworld);
    }
    if (action.api === 'reject') { rejected++; assert.deepEqual(row.state, output.expectedStates[i - 1].state); assert.equal(typeof receipt.reason, 'string'); }
  }
  assert.deepEqual([candidates, checkpoints, payments, rejected], [2, 22, 153, 4]);
  assert.deepEqual(output.finalState, output.expectedStates.at(-1).state); assert.equal(output.finalStateSha256, sha(canonical(output.finalState)));
});
function projectFields(row) { return Object.fromEntries(['index', 'stage', 'api', 'request'].map(key => [key, row[key]])); }

test('esbuild package captures every actual source/dependency input and executes as isolated self-contained script', async () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'solar-reference-test-')), out = resolve(temp, 'package');
  try {
    const manifest = await buildReference(out); assert.equal(manifest.optionsSha256, sha(canonical(OPTIONS))); assert.equal(manifest.inputManifestSha256, sha(canonical(manifest.inputs)));
    const bundle = readFileSync(resolve(out, manifest.bundle.file)); assert.equal(sha(bundle), manifest.bundle.sha256);
    const meta = JSON.parse(readFileSync(resolve(out, manifest.metafile.file))); assert.deepEqual(manifest.inputs.map(x => x.path), Object.keys(meta.inputs).sort());
    for (const input of manifest.inputs) { const raw = readFileSync(resolve(ROOT, input.path)); assert.equal(input.sha256, sha(raw)); assert.equal(input.bytes, raw.length); }
    assert(manifest.inputs.some(input => input.path.startsWith('node_modules/'))); assert(manifest.inputs.some(input => input.path === 'src/game/logic.ts'));
    assert.equal(manifest.toolchain.node, process.version); assert.equal(manifest.toolchain.esbuild, manifest.toolchain.lockedPackages['node_modules/esbuild'].version);
    const context = { crypto: webcrypto, TextEncoder, tapeText: JSON.stringify(tape) };
    const validated = await runInNewContext(bundle.toString() + '\nInfinitySolarReference.validateActionTape(JSON.parse(tapeText)).then(x => x.length)', context, { timeout: 5000 }); assert.equal(validated, 4383);
    // Full replay uses Node's genuine same-realm structuredClone. Passing that
    // intrinsic into another vm realm would invent foreign object prototypes.
    const bundleApi = runInThisContext('(() => {' + bundle.toString() + '; return InfinitySolarReference; })()', { timeout: 5000 });
    const bundled = await bundleApi.replay(clone(tape));
    assert.equal(bundled.rows, 4383); assert.equal(bundled.logicalSeconds, 4201);
    assert.deepEqual(clone(bundled.finalState), directReplayFinal); assert.equal(bundled.finalStateSha256, sha(canonical(directReplayFinal)));
    assert.equal(bundled.receipts.length, 4383); assert.equal(bundled.expectedStates.length, 4383); assert.equal(Object.keys(bundled.checkpoints).length, 22);
    assert(!Object.hasOwn(context, 'localStorage')); assert(!Object.hasOwn(context, 'document')); assert(!Object.hasOwn(context, 'fetch'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
