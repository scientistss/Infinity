/** Independent exact r14 message-slot additions. No production imports.
 * Frozen r13 wallet/remainder helpers retain their historical meaning.
 * A projection must prove every new slot before removing only that slot.
 */
import assert from 'node:assert/strict';
import * as r13 from './r13-compatibility.mjs';
export { expectedNpcEconomy, advanceExpectedNpcWallet, expectedNpcFromR12Snapshot,
  expectedNpcBattles, assertNpcEconomy, expectedNpcResourceRemainder,
  assertZeroNpcResourceRemainders, assertHistoricalSource, NPC_MODEL, NPC_HORIZON } from './r13-compatibility.mjs';
export const CURRENT_REVISION = 14;
function messages(state, current, label) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), `${label}: complete state required`);
  const descriptor = Object.getOwnPropertyDescriptor(state, 'messages');
  assert.ok(descriptor && 'value' in descriptor && descriptor.enumerable, `${label}: own message data required`);
  const list = descriptor.value;
  assert.ok(Array.isArray(list) && list.length <= 150, `${label}: bounded message array required`);
  assert.deepEqual(Reflect.ownKeys(list), [...Array.from({ length: list.length }, (_, i) => String(i)), 'length'], `${label}: dense ordinary message array`);
  for (let index = 0; index < list.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(list, String(index));
    assert.ok(entry && 'value' in entry && entry.enumerable, `${label}: own message entry required`);
    const message = entry.value;
    assert.ok(message && typeof message === 'object' && !Array.isArray(message)
      && [Object.prototype, null].includes(Object.getPrototypeOf(message)), `${label}: plain message required`);
    const keys = ['id', 'at', 'text', ...(current ? ['npcScoutSnapshot'] : [])];
    assert.deepEqual(Reflect.ownKeys(message).sort(), keys.sort(), `${label}: exact ${current ? 'r14' : 'historical'} message fields`);
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(message, key);
      assert.ok(field && 'value' in field && field.enumerable, `${label}: enumerable data field ${key}`);
    }
  }
  return list;
}
export function liftR13StateToR14(state) {
  messages(state, false, 'historical null-slot lift');
  const current = structuredClone(state);
  current.messages = current.messages.map(message => ({ id: message.id, at: message.at, text: message.text, npcScoutSnapshot: null }));
  return current;
}
export function projectVerifiedScoutSnapshots(state, expectedSnapshots, label) {
  assert.ok(expectedSnapshots instanceof Map, `${label}: independent expected snapshot map required`);
  const list = messages(state, true, label), seen = new Set();
  for (const message of list) {
    if (expectedSnapshots.has(message.id)) assert.equal(seen.has(message.id), false, `${label}: unique typed observation identity`);
    seen.add(message.id);
    assert.deepEqual(message.npcScoutSnapshot, expectedSnapshots.get(message.id) ?? null,
      `${label}: exact independently expected snapshot for ${message.id}`);
  }
  for (const [id, snapshot] of expectedSnapshots) {
    assert.ok(snapshot !== null && snapshot !== undefined, `${label}: nonnull independent typed expectation`);
    assert.ok(seen.has(id), `${label}: independently expected report ${id} retained`);
  }
  const prior = structuredClone(state);
  for (const message of prior.messages) delete message.npcScoutSnapshot;
  return prior;
}
export function projectVerifiedNullScoutSnapshots(state, label) {
  return projectVerifiedScoutSnapshots(state, new Map(), label);
}
export function projectVerifiedNpcEconomy(state, wallet, label) {
  return r13.projectVerifiedNpcEconomy(projectVerifiedNullScoutSnapshots(state, label), wallet, label);
}
export function liftR12StateToR14(state) { return liftR13StateToR14(r13.liftR12StateToR13(state)); }
export function liftR11StateToR14(state, wallet = r13.expectedNpcEconomy()) { return liftR13StateToR14(r13.liftR11StateToR13(state, wallet)); }
export function liftR10StateToR14(state, wallet = r13.expectedNpcEconomy()) { return liftR13StateToR14(r13.liftR10StateToR13(state, wallet)); }
export function liftR8StateToR14(state, floor, wallet = r13.expectedNpcEconomy()) { return liftR13StateToR14(r13.liftR8StateToR13(state, floor, wallet)); }
export function assertTerraformerMetadata(actual, historical, floor, label, wallet = r13.expectedNpcEconomy()) {
  return r13.assertTerraformerMetadata(projectVerifiedNullScoutSnapshots(actual, label), historical, floor, label, wallet);
}
export function assertR8StatePreserved(actual, historical, label, floor, wallet = r13.expectedNpcEconomy()) {
  r13.assertR8StatePreserved(projectVerifiedNullScoutSnapshots(actual, label), historical, label, floor, wallet);
  assert.deepEqual(actual, liftR8StateToR14(historical, floor, wallet), `${label}: complete old state plus exact r14 additions`);
}
