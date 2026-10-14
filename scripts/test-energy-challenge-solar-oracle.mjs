/** A real fixed natural report is mandatory, not a substituted save fixture.
 * ENERGY_SOLAR_NATURAL=/absolute/energy-natural/report.json node --import tsx --test scripts/test-energy-challenge-solar-oracle.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadNatural, replaySolar, validateFixedReceipts, ROW_COUNT, FIXED } from './energy-challenge-solar-oracle.mjs';
const report = process.env.ENERGY_SOLAR_NATURAL;
assert(report, 'ENERGY_SOLAR_NATURAL must identify the actual clean-source natural report');
const input = loadNatural(resolve(report));
const clone = value => JSON.parse(JSON.stringify(value));

test('replays all 4383 fixed receipts from fresh construction with exact complete checkpoint originals', () => {
  let count = 0, candidates = 0, checkpoints = 0;
  const result = replaySolar(input, row => {
    const event = input.events[count++];
    assert.equal(row.index, count);
    assert.deepEqual(Object.keys(row).sort(), ['index', 'state', ...(event.api === 'challengeCandidate' ? ['candidate'] : []), ...(event.api === 'checkpoint' ? ['raw'] : [])].sort());
    assert.deepEqual(Object.keys(row.state).sort(), Object.keys(JSON.parse(input.initial.raw).state).sort());
    if (row.candidate) { candidates++; assert.notDeepEqual(row.candidate, row.state); }
    if (row.raw) { checkpoints++; assert.deepEqual(JSON.parse(row.raw).state, row.state); }
  });
  assert.deepEqual(result, { rows: ROW_COUNT, logicalSeconds: 4201, finalStateSha256: input.route.replay.finalStateSha256 });
  assert.deepEqual([count, candidates, checkpoints], [4383, 2, 22]);
});

const mutations = {
  truncated: events => events.pop(),
  additional: events => events.push(events.at(-1)),
  reordered: events => { [events[10], events[11]] = [events[11], events[10]]; },
  unsupported: events => { events[10].api = 'importSave'; },
  batchedTick: events => { events.find(e => e.api === 'tick').request.dt = 2; },
  offlineTick: events => { events.find(e => e.api === 'tick').request.mode = 'offline'; },
  otherSeed: events => { events[0].request.worldSeed++; },
  autoPurchase: events => { events.find(e => e.api === 'enqueue').request.source = 'automation'; },
  multiplePurchase: events => { events.find(e => e.api === 'enqueue').request.count = 3; },
  swappedChallenge: events => { events.find(e => e.api === 'challengeCandidate').request.action = 'finish'; },
  undeclaredAbandon: events => { events.find(e => e.api === 'checkpoint').request.name = 'abandoned'; },
  offlineCheckpoint: events => { events.find(e => e.api === 'checkpoint').request.appliedSeconds = 1; },
  noReader: events => { events.find(e => e.api === 'checkpoint').request.adoptsReader = false; },
  repeatedCheckpoint: events => { events.filter(e => e.api === 'checkpoint')[1].request.name = 'initial'; },
  changedRejection: events => { events.find(e => e.api === 'reject').request.api = 'enqueue'; },
  missingFinal: events => { events.at(-1).request.name = 'invented-final'; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`rejects changed fixed transcript: ${name}`, () => {
  const events = clone(input.events); mutate(events); assert.throws(() => validateFixedReceipts(events));
});
test('fixed census is complete and immutable', () => {
  assert(Object.isFrozen(FIXED)); assert.equal(Object.values(FIXED).reduce((a, b) => a + b), ROW_COUNT);
});
test('refuses altered supplied initial bytes even when the declared hash is changed with them', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'solar-oracle-test-'));
  try {
    mkdirSync(resolve(dir, 'solar'));
    const report = clone(input.report), route = report.routes.find(r => r.policy === 'solar');
    copyFileSync(input.receipts.path, resolve(dir, route.receipts.file));
    const envelope = JSON.parse(input.initial.raw); envelope.state.planets[0].resources.metal = '501';
    const raw = JSON.stringify(envelope);
    writeFileSync(resolve(dir, route.checkpoints.initial.file), raw);
    route.checkpoints.initial.sha256 = createHash('sha256').update(raw).digest('hex');
    if (route.checkpoints.initial.bytes !== undefined) route.checkpoints.initial.bytes = Buffer.byteLength(raw);
    writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report));
    assert.throws(() => loadNatural(resolve(dir, 'report.json')), /byte-exact newly constructed initial/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('refuses source and runtime relabeling before considering input states', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'solar-oracle-identity-test-'));
  try {
    for (const patch of [{ nodeVersion: 'v0.0.0' }, { sourceSha: '0'.repeat(40) }, { sourceTree: '0'.repeat(40) }, { dirtyPaths: ['M src/game/state.ts'] }, { sourceClassification: 'diagnostic-working-tree' }]) {
      writeFileSync(resolve(dir, 'report.json'), JSON.stringify({ ...input.report, ...patch }));
      assert.throws(() => loadNatural(resolve(dir, 'report.json')));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
