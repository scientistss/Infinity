/** Independent strict inactive projection tests; no candidate game imports. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInactiveEnergyChallenge, expectedInactiveEnergyChallenge, liftR14StateToR16,
  liftR14EnvelopeToR16, projectVerifiedInactiveEnergyChallenge } from './r16-compatibility.mjs';
const original = () => ({ wallet: { metal: '1', nested: { retained: true } }, queue: [{ jobId: 7 }], messages: [] });
test('exact independent inactive addition, complete old projection, and input purity', () => {
  const old = original(), before = structuredClone(old), current = liftR14StateToR16(old);
  assert.deepEqual(current, { energyChallenge: expectedInactiveEnergyChallenge(), ...old });
  assert.equal(assertInactiveEnergyChallenge(current, 'fresh'), true);
  assert.deepEqual(projectVerifiedInactiveEnergyChallenge(current, 'fresh'), old);
  assert.deepEqual(old, before);
  assert.ok(Object.hasOwn(current, 'energyChallenge'));
});
test('unknown old fields survive instead of being silently omitted', () => {
  const old = { ...original(), unknown: { witness: [1, 2, 3] } };
  assert.deepEqual(projectVerifiedInactiveEnergyChallenge(liftR14StateToR16(old), 'unknown'), old);
  const current = liftR14StateToR16(original()); current.another = 19;
  assert.deepEqual(projectVerifiedInactiveEnergyChallenge(current, 'current unknown'), { ...original(), another: 19 });
});
test('active, completed, incremented, malformed and extra challenge fields cannot be stripped', () => {
  const mutations = [s => delete s.energyChallenge, s => s.energyChallenge = null,
    s => s.energyChallenge.active = {}, s => s.energyChallenge.completion = {},
    s => s.energyChallenge.nextAttemptId = 2, s => s.energyChallenge.nextAttemptId = true,
    s => s.energyChallenge.model = 'other', s => s.energyChallenge.extra = null,
    s => delete s.energyChallenge.active,
    s => Object.defineProperty(s.energyChallenge, 'secret', { value: 1 }),
    s => s.energyChallenge[Symbol('extra')] = 1,
    s => Object.defineProperty(s.energyChallenge, 'active', { get: () => null }),
    s => Object.defineProperty(s, 'energyChallenge', { get: () => expectedInactiveEnergyChallenge() }),
    s => Object.setPrototypeOf(s.energyChallenge, { hidden: true })];
  for (const mutate of mutations) {
    const current = liftR14StateToR16(original()); mutate(current);
    assert.throws(() => projectVerifiedInactiveEnergyChallenge(current, 'hostile'));
  }
});
test('copying must never erase unknown symbol or nonenumerable fields', () => {
  for (const make of [s => Object.defineProperty(s.wallet, 'hidden', { value: 4 }), s => s.wallet[Symbol('hidden')] = 4]) {
    const current = liftR14StateToR16(original()); make(current);
    assert.throws(() => projectVerifiedInactiveEnergyChallenge(current, 'lossy clone'));
  }
});
test('only exact original r14 envelopes can receive the envelope adapter', () => {
  const old = { schema: 'infinity-original-p4', version: 9, revision: 14, state: original(), savedAt: 7, lastTickAt: 3, other: 'retained' };
  assert.deepEqual(liftR14EnvelopeToR16(old), { ...old, revision: 16, state: liftR14StateToR16(old.state) });
  for (const revision of [2, 13, 15, 16, 999]) assert.throws(() => liftR14EnvelopeToR16({ ...old, revision }));
  assert.throws(() => liftR14StateToR16({ ...original(), energyChallenge: expectedInactiveEnergyChallenge() }));
  assert.throws(() => liftR14StateToR16(Object.assign(Object.create({ energyChallenge: null }), original())));
});
