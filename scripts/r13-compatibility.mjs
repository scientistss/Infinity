/** Independent exact r13 no-attack expectations. No production imports.
 * Wallet clocks replay ordered witnessed Number segments, never r12's capped age.
 * Historical r12 helpers and source artifacts retain their original meaning.
 * Every no-attack planet independently owns exactly zero M/C/D remainder rights.
 */
import assert from 'node:assert/strict';
import { liftR10StateToR11, liftR8StateToR11, assertTerraformerMetadata as assertR11TerraformerMetadata,
  assertR8StatePreserved as assertR11StatePreserved } from './r11-compatibility.mjs';
export { assertHistoricalSource } from './r12-compatibility.mjs';
export const CURRENT_REVISION = 13;
export const NPC_MODEL = 'npc-wallet-garrison-v1';
export const NPC_HORIZON = 12000;
const INITIAL = [500, 250, 0], CAPS = [50000, 30000, 10000], RATES = [5, 2.5, 1];
const clone = value => structuredClone(value);
function exactFields(value, names, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label}: plain object required`);
  assert.ok([Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label}: plain prototype required`);
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...names].sort(), `${label}: exact own fields`);
  for (const key of names) { const d = Object.getOwnPropertyDescriptor(value, key); assert.ok(d && 'value' in d && d.enumerable, `${label}: enumerable data field ${key}`); }
}
function validateExpected(wallet) {
  exactFields(wallet, ['model', 'now', 'baseline', 'sites'], 'independent wallet');
  assert.equal(wallet.model, NPC_MODEL);
  assert.ok(typeof wallet.now === 'number' && Number.isFinite(wallet.now) && wallet.now >= 0 && wallet.now < NPC_HORIZON);
  exactFields(wallet.baseline, ['stock', 'mark'], 'independent baseline');
  assert.equal(wallet.baseline.mark, 0, 'no-attack independent baseline mark is zero');
  assert.ok(Array.isArray(wallet.baseline.stock) && wallet.baseline.stock.length === 3);
  assert.deepEqual(Reflect.ownKeys(wallet.baseline.stock), ['0', '1', '2', 'length']);
  wallet.baseline.stock.forEach((v, i) => assert.ok(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= CAPS[i]));
  exactFields(wallet.sites, [], 'no-attack sites');
  return wallet;
}
export function expectedNpcEconomy(adoptedSegmentsSeconds = []) {
  return advanceExpectedNpcWallet({ model: NPC_MODEL, now: 0, baseline: { stock: [...INITIAL], mark: 0 }, sites: {} }, adoptedSegmentsSeconds);
}
export function advanceExpectedNpcWallet(prior, adoptedSegmentsSeconds) {
  let wallet = clone(validateExpected(prior));
  assert.ok(Array.isArray(adoptedSegmentsSeconds), 'complete ordered independent segment witness required; capped age is not a wallet clock');
  for (const step of adoptedSegmentsSeconds) {
    assert.ok(typeof step === 'number' && Number.isFinite(step) && step >= 0, 'finite nonnegative Number segment required');
    if (step === 0) continue;
    const full = step >= NPC_HORIZON, endpoint = full ? 0 : wallet.now + step;
    if (!full && endpoint < NPC_HORIZON) wallet.now = endpoint;
    else wallet = { model: NPC_MODEL, now: 0, baseline: { stock: full ? [...CAPS] : wallet.baseline.stock.map((stock, i) => Math.min(CAPS[i], stock + RATES[i] * (endpoint - wallet.baseline.mark))), mark: 0 }, sites: {} };
  }
  return wallet;
}
export function expectedNpcFromR12Snapshot(oldNpc) {
  exactFields(oldNpc, ['model', 'elapsedSeconds'], 'historical r12 NPC');
  assert.equal(oldNpc.model, 'fixed-production-v1');
  const age = oldNpc.elapsedSeconds;
  assert.ok(typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 11900);
  return { model: NPC_MODEL, now: 0, baseline: { stock: INITIAL.map((stock, i) => Math.min(CAPS[i], stock + RATES[i] * age)), mark: 0 }, sites: {} };
}
export function expectedNpcResourceRemainder() { return { metal: '0', crystal: '0', deuterium: '0' }; }
export function assertZeroNpcResourceRemainders(state, label) {
  assert.ok(Array.isArray(state.planets), `${label}: complete planet list required`);
  for (const [index, planet] of state.planets.entries()) {
    const descriptor = Object.getOwnPropertyDescriptor(planet, 'npcResourceRemainder');
    assert.ok(descriptor && 'value' in descriptor && descriptor.enumerable, `${label}: planet ${index} owns enumerable rights`);
    exactFields(descriptor.value, ['metal', 'crystal', 'deuterium'], `${label}: planet ${index} rights`);
    assert.deepEqual(descriptor.value, expectedNpcResourceRemainder(), `${label}: independently zero no-attack rights, never delete a positive claim`);
  }
  return true;
}
function liftZeroNpcResourceRemainders(state) {
  assert.ok(Array.isArray(state.planets), 'historical complete planet list required');
  for (const planet of state.planets) assert.equal('npcResourceRemainder' in planet, false, 'legacy source cannot smuggle current rights');
  const prior = clone(state);
  for (const planet of prior.planets) planet.npcResourceRemainder = expectedNpcResourceRemainder();
  return prior;
}
export function expectedNpcBattles() { return { model: 'npc-battle-receipts-v1', reports: [] }; }
export function assertNpcEconomy(actual, wallet, label) {
  validateExpected(wallet);
  assertZeroNpcResourceRemainders(actual, label);
  for (const key of ['npcEconomy', 'npcBattles']) {
    const d = Object.getOwnPropertyDescriptor(actual, key);
    assert.ok(d && 'value' in d && d.enumerable, `${label}: explicit own enumerable ${key}`);
  }
  validateExpected(actual.npcEconomy);
  exactFields(actual.npcEconomy, ['model', 'now', 'baseline', 'sites'], `${label}: NPC`);
  exactFields(actual.npcEconomy.baseline, ['stock', 'mark'], `${label}: baseline`);
  exactFields(actual.npcEconomy.sites, [], `${label}: sites`);
  assert.deepEqual(actual.npcEconomy, wallet, `${label}: exact independently replayed wallet`);
  exactFields(actual.npcBattles, ['model', 'reports'], `${label}: battle receipts`);
  assert.deepEqual(actual.npcBattles, expectedNpcBattles(), `${label}: exactly empty no-attack receipts`);
  return true;
}
export function projectVerifiedNpcEconomy(actual, wallet, label) {
  assertNpcEconomy(actual, wallet, label);
  const prior = clone(actual); delete prior.npcEconomy; delete prior.npcBattles;
  for (const planet of prior.planets) delete planet.npcResourceRemainder;
  return prior;
}
export function liftR11StateToR13(state, wallet = expectedNpcEconomy()) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state));
  assert.equal(Object.hasOwn(state, 'npcEconomy'), false); assert.equal(Object.hasOwn(state, 'npcBattles'), false);
  return { npcEconomy: clone(validateExpected(wallet)), npcBattles: expectedNpcBattles(), ...liftZeroNpcResourceRemainders(state) };
}
export function liftR12StateToR13(state) {
  assert.equal(Object.hasOwn(state, 'npcBattles'), false);
  const wallet = expectedNpcFromR12Snapshot(state.npcEconomy), prior = clone(state); delete prior.npcEconomy;
  return liftR11StateToR13(prior, wallet);
}
export function liftR10StateToR13(state, wallet = expectedNpcEconomy()) { return liftR11StateToR13(liftR10StateToR11(state), wallet); }
export function liftR8StateToR13(state, floor, wallet = expectedNpcEconomy()) { return liftR11StateToR13(liftR8StateToR11(state, floor), wallet); }
export function assertTerraformerMetadata(actual, historical, floor, label, wallet = expectedNpcEconomy()) {
  return assertR11TerraformerMetadata(projectVerifiedNpcEconomy(actual, wallet, label), historical, floor, label);
}
export function assertR8StatePreserved(actual, historical, label, floor, wallet = expectedNpcEconomy()) {
  const prior = projectVerifiedNpcEconomy(actual, wallet, label);
  assertR11StatePreserved(prior, historical, label, floor);
  assert.deepEqual(actual, liftR8StateToR13(historical, floor, wallet), `${label}: complete old state plus exact r13 metadata`);
}
