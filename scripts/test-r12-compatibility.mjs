/** No production imports: frozen historical adapters, exact age, bytes, and adversarial projections. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertNpcEconomy, projectVerifiedNpcEconomy, liftR11StateToR12, liftR10StateToR12,
  liftR8StateToR12, assertR8StatePreserved, advanceExpectedNpcAge } from './r12-compatibility.mjs';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';
const evidence = JSON.parse(readFileSync(new URL('../tests/fixtures/demolition-r10.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);
test('historical JS adapters remain byte-identical', () => {
  for (const [file, hash] of [['r8-compatibility.mjs', 'd5bed35437c3549f70fe19827e292d174cb38b85534f6cf16b6ad98868664645'],
    ['r11-compatibility.mjs', '467c89f474be57446addcb89079701c8c4504cd28cc9358bc702d27ce7d7066e']])
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'), hash);
});
test('pure historical lift starts at zero regardless of old totalTime and preserves native property order', () => {
  for (const totalTime of ['0', '123456', '1e400']) {
    const historical = { totalTime, preserved: [1, '1', { unknownOldField: true }] }, copy = clone(historical);
    const current = liftR11StateToR12(historical, 0);
    assert.deepEqual(Object.keys(current), ['npcEconomy', ...Object.keys(historical)]);
    assert.equal(JSON.stringify(current), `{"npcEconomy":{"model":"fixed-production-v1","elapsedSeconds":0},${JSON.stringify(historical).slice(1)}`);
    assert.deepEqual(projectVerifiedNpcEconomy(current, 0, 'pure import'), historical);
    assert.deepEqual(historical, copy);
  }
});
test('explicit nonzero ages, adopted fractional segments and cap are independent exact values', () => {
  assert.equal(advanceExpectedNpcAge(0, [.125, .25, .5]), .875);
  assert.equal(advanceExpectedNpcAge(11899.5, [.25, .5]), 11900);
  for (const age of [0, .875, 11900]) assertNpcEconomy(liftR11StateToR12({ totalTime: '1e400' }, age), age, 'exact age');
  for (const age of [undefined, null, NaN, Infinity, -1, 11900.01, '0']) assert.throws(() => liftR11StateToR12({}, age));
  for (const step of [-1, NaN, Infinity, '1']) assert.throws(() => advanceExpectedNpcAge(0, [step]));
});
test('wrong age, model, missing keys, extra keys, descriptors and inherited slots fail before projection', () => {
  const mutations = [s => { s.npcEconomy.elapsedSeconds = 0; }, s => { s.npcEconomy.model = 'future'; },
    s => { delete s.npcEconomy.elapsedSeconds; }, s => { s.npcEconomy.extra = null; }, s => { s.npcEconomy[Symbol('x')] = 1; },
    s => { delete s.npcEconomy; }, s => { s.npcEconomy = null; }, s => { s.npcEconomy = []; },
    s => { Object.defineProperty(s.npcEconomy, 'elapsedSeconds', { get() { throw Error('must not invoke'); } }); },
    s => { Object.defineProperty(s, 'npcEconomy', { get() { throw Error('must not invoke'); } }); }];
  for (const mutate of mutations) { const state = liftR11StateToR12({}, 3); mutate(state); assert.throws(() => projectVerifiedNpcEconomy(state, 3, 'attack')); }
  assert.throws(() => assertNpcEconomy(Object.create(liftR11StateToR12({}, 3)), 3, 'inherited'));
  assert.throws(() => liftR11StateToR12({ npcEconomy: null }, 0));
});
test('all genuine r10 rows retain every old field through exact composed r12 lift', () => {
  assert.equal(evidence.sourceSha, 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a');
  for (const row of evidence.rows) {
    const historical = row.oldReaderOutput.state, saved = clone(historical), current = liftR10StateToR12(historical, 0);
    const prior = projectVerifiedNpcEconomy(current, 0, row.id);
    for (const p of prior.planets) { assert.equal(p.demolition, null); delete p.demolition; }
    assert.deepEqual(prior, historical); assert.deepEqual(historical, saved);
  }
});
test('whole r8 preservation rejects every unrelated delta after verifying metadata', () => {
  const historical = JSON.parse(evidence.legacyInputs[0].raw).state; delete historical.buildingTemplates;
  const floor = historical.orders.nextJobId, good = liftR8StateToR12(historical, floor, 1.25);
  assertR8StatePreserved(good, historical, 'good', floor, 1.25);
  for (const mutate of [s => { s.totalTime = '123'; }, s => { s.extra = 'retained'; }, s => { s.planets[0].resources.metal = '1'; },
    s => { s.planets[0].demolition = {}; }, s => { s.terraformerGrantJobFloor++; }, s => { s.npcEconomy.elapsedSeconds = 0; }]) {
    const actual = clone(good); mutate(actual); assert.throws(() => assertR8StatePreserved(actual, historical, 'attack', floor, 1.25));
  }
  const extra = clone(good); extra.unrelated = { retained: true };
  assert.deepEqual(projectVerifiedNpcEconomy(extra, 1.25, 'keep unknown').unrelated, { retained: true });
});
// Minimal number carrier exposes the observer contract independently of game code.
class Clock { constructor(value) { this.value = value; } add(step) { return new Clock(this.value + step); } }
const serialize = s => ({ totalTime: s.totalTime.value, preserved: s.preserved });
const state = () => ({ totalTime: new Clock(1e20), preserved: 'exact' });
test('old adopted-step observer measures additions swallowed by old large historical clock', () => {
  const result = captureAdoptedSteps(state(), s => ({ state: { ...s, totalTime: s.totalTime.add(.125).add(.25) } }), serialize);
  assert.deepEqual(result.adoptedSegmentsSeconds, [.125, .25]); assert.equal(result.npcElapsedSeconds, .375);
  assert.equal(result.result.state.totalTime.value, 1e20);
});
test('old observer fails closed if time carrier retires, step is invalid, or observed result differs', () => {
  assert.throws(() => captureAdoptedSteps(state(), s => ({ state: { ...s, totalTime: new Clock(s.totalTime.value) } }), serialize));
  for (const step of [NaN, Infinity, -1, '1']) assert.throws(() => captureAdoptedSteps(state(), s => ({ state: { ...s, totalTime: s.totalTime.add(step) } }), serialize));
  let calls = 0;
  assert.throws(() => captureAdoptedSteps(state(), s => ({ state: { ...s, totalTime: s.totalTime.add(1), preserved: ++calls } }), serialize));
});
