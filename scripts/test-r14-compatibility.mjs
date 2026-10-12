/** Synthetic exact projection attacks only; no production reader supplies expected state. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { liftR13StateToR14, projectVerifiedNullScoutSnapshots, projectVerifiedScoutSnapshots, liftR10StateToR14 } from './r14-compatibility.mjs';
import { liftR10StateToR13 } from './r13-compatibility.mjs';
const historical = () => ({ messages: [{ id: 'old-1', at: 1.25, text: 'old rounded text' }], planets: [{ id: 'old', value: '1e1000', buildQueue: [] }], other: [0, false, 'kept'] });
test('adds precisely one null to every message and retains the complete r13 projection', () => {
  const old = historical(), original = structuredClone(old), current = liftR13StateToR14(old);
  assert.deepEqual(current, { ...old, messages: [{ ...old.messages[0], npcScoutSnapshot: null }] });
  assert.deepEqual(projectVerifiedNullScoutSnapshots(current, 'roundtrip'), old);
  assert.deepEqual(old, original);
  assert.deepEqual(liftR10StateToR14(old), liftR13StateToR14(liftR10StateToR13(old)));
});
test('never drops missing, nonnull, accessor, inherited, extra, sparse or named message data', () => {
  for (const mutate of [
    state => { delete state.messages[0].npcScoutSnapshot; },
    state => { state.messages[0].npcScoutSnapshot = {}; },
    state => { state.messages[0].npcScoutSnapshot = undefined; },
    state => { state.messages[0].extra = 1; },
    state => { Object.setPrototypeOf(state.messages[0], { npcScoutSnapshot: null }); },
    state => { Object.defineProperty(state.messages[0], 'npcScoutSnapshot', { get() { throw Error('getter must not execute'); }, enumerable: true }); },
    state => { delete state.messages[0]; },
    state => { state.messages.named = 1; },
    state => { state.messages[0][Symbol('hidden')] = 1; },
  ]) { const value = liftR13StateToR14(historical()); mutate(value); assert.throws(() => projectVerifiedNullScoutSnapshots(value, 'negative')); }
  assert.throws(() => liftR13StateToR14(liftR13StateToR14(historical())));
});
test('typed projection requires independent complete payload and proves every retained expected identity', () => {
  const current = liftR13StateToR14(historical()), snapshot = { model: 'npc-scout-snapshot-v1', observedAt: '1.25', stock: [5, 2.5, 1] };
  current.messages[0].npcScoutSnapshot = structuredClone(snapshot);
  assert.deepEqual(projectVerifiedScoutSnapshots(current, new Map([['old-1', snapshot]]), 'typed'), historical());
  assert.throws(() => projectVerifiedScoutSnapshots(current, new Map([['old-1', { ...snapshot, stock: [5, 2.5, 2] }]]), 'changed'));
  assert.throws(() => projectVerifiedScoutSnapshots(current, new Map([['old-1', snapshot], ['missing', snapshot]]), 'lost'));
  assert.throws(() => projectVerifiedScoutSnapshots(current, new Map(), 'unproved'));
});

test('ordinary duplicate historical IDs remain permitted; typed observation IDs stay unique', () => {
  const old = historical(); old.messages.push({ ...old.messages[0] });
  const current = liftR13StateToR14(old);
  assert.deepEqual(projectVerifiedNullScoutSnapshots(current, 'ordinary duplicate'), old);
  const snapshot = { model: 'npc-scout-snapshot-v1' };
  for (const message of current.messages) message.npcScoutSnapshot = snapshot;
  assert.throws(() => projectVerifiedScoutSnapshots(current, new Map([['old-1', snapshot]]), 'typed duplicate'));
});
