/** Independent r16 inactive-state extension; no production imports.
 * Frozen r2–r14 adapters keep their historical semantics. Historical projections
 * first prove the complete new field is exactly the fresh inactive default.
 */
import assert from 'node:assert/strict';
import * as r14 from './r14-compatibility.mjs';
export { expectedNpcEconomy, advanceExpectedNpcWallet, expectedNpcFromR12Snapshot,
  expectedNpcBattles, assertNpcEconomy, expectedNpcResourceRemainder,
  assertZeroNpcResourceRemainders, assertHistoricalSource, NPC_MODEL, NPC_HORIZON } from './r14-compatibility.mjs';
export const CURRENT_REVISION = 16;
export function expectedInactiveEnergyChallenge() {
  return { model: 'energy-tightening-v1', nextAttemptId: 1, active: null, completion: null };
}
export function assertInactiveEnergyChallenge(state, label) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), `${label}: complete state required`);
  const field = Object.getOwnPropertyDescriptor(state, 'energyChallenge');
  assert.ok(field && 'value' in field && field.enumerable, `${label}: explicit own challenge data required`);
  const value = field.value, expected = expectedInactiveEnergyChallenge();
  assert.ok(value && Object.getPrototypeOf(value) === Object.prototype, `${label}: ordinary challenge object required`);
  assert.deepEqual(Reflect.ownKeys(value).sort(), Object.keys(expected).sort(), `${label}: exact challenge keys required`);
  for (const key of Object.keys(expected)) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(item && 'value' in item && item.enumerable, `${label}: explicit challenge data ${key}`);
    assert.equal(item.value, expected[key], `${label}: exact inactive challenge ${key}`);
  }
  return true;
}
function assertCompleteJsonData(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value), `${label}: finite number required`); return; }
  assert.ok(value && typeof value === 'object' && !seen.has(value), `${label}: complete acyclic JSON data required`);
  seen.add(value);
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype, `${label}: ordinary JSON object required`);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) assert.deepEqual(keys, [...Array.from({ length: value.length }, (_, i) => String(i)), 'length'], `${label}: dense ordinary array required`);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    assert.equal(typeof key, 'string', `${label}: symbol must not be silently dropped`);
    const field = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(field && 'value' in field && field.enumerable, `${label}: every field must survive a JSON-data copy`);
    assertCompleteJsonData(field.value, `${label}.${key}`, seen);
  }
  seen.delete(value);
}
export function projectVerifiedInactiveEnergyChallenge(state, label) {
  assertInactiveEnergyChallenge(state, label);
  assertCompleteJsonData(state, label);
  const prior = structuredClone(state);
  assert.deepEqual(prior, state, `${label}: projection copy must retain all existing fields`);
  delete prior.energyChallenge;
  return prior;
}
export function liftR14StateToR16(state) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state));
  assert.equal('energyChallenge' in state, false, 'Historical state must not contain a challenge marker');
  assertCompleteJsonData(state, 'Historical source');
  const prior = structuredClone(state);
  assert.deepEqual(prior, state, 'Historical lift must preserve every old field');
  return { energyChallenge: expectedInactiveEnergyChallenge(), ...prior };
}
export function liftR14EnvelopeToR16(envelope) {
  assertCompleteJsonData(envelope, 'Historical envelope');
  assert.equal(envelope.schema, 'infinity-original-p4');
  assert.equal(envelope.version, 9);
  assert.equal(envelope.revision, 14, 'Only genuine r14 envelope may use this exact adapter');
  return { ...structuredClone(envelope), revision: CURRENT_REVISION, state: liftR14StateToR16(envelope.state) };
}
export function projectVerifiedScoutSnapshots(state, snapshots, label) {
  return r14.projectVerifiedScoutSnapshots(projectVerifiedInactiveEnergyChallenge(state, label), snapshots, label);
}
export function projectVerifiedNullScoutSnapshots(state, label) {
  return r14.projectVerifiedNullScoutSnapshots(projectVerifiedInactiveEnergyChallenge(state, label), label);
}
export function projectVerifiedNpcEconomy(state, wallet, label) {
  return r14.projectVerifiedNpcEconomy(projectVerifiedInactiveEnergyChallenge(state, label), wallet, label);
}
export function liftR13StateToR16(state) { return liftR14StateToR16(r14.liftR13StateToR14(state)); }
export function liftR12StateToR16(state) { return liftR14StateToR16(r14.liftR12StateToR14(state)); }
export function liftR11StateToR16(state, wallet = r14.expectedNpcEconomy()) { return liftR14StateToR16(r14.liftR11StateToR14(state, wallet)); }
export function liftR10StateToR16(state, wallet = r14.expectedNpcEconomy()) { return liftR14StateToR16(r14.liftR10StateToR14(state, wallet)); }
export function liftR8StateToR16(state, floor, wallet = r14.expectedNpcEconomy()) { return liftR14StateToR16(r14.liftR8StateToR14(state, floor, wallet)); }
export function assertTerraformerMetadata(actual, historical, floor, label, wallet = r14.expectedNpcEconomy()) {
  return r14.assertTerraformerMetadata(projectVerifiedInactiveEnergyChallenge(actual, label), historical, floor, label, wallet);
}
export function assertR8StatePreserved(actual, historical, label, floor, wallet = r14.expectedNpcEconomy()) {
  r14.assertR8StatePreserved(projectVerifiedInactiveEnergyChallenge(actual, label), historical, label, floor, wallet);
  assert.deepEqual(actual, liftR8StateToR16(historical, floor, wallet), `${label}: complete old state plus exact r16 additions`);
}
