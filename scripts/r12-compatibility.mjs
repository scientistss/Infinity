/** Independent exact r12 expectations. Historical adapters and all old fields stay intact.
 * No production imports. Expected age is mandatory and must come from the adopted trajectory.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { liftR10StateToR11, liftR8StateToR11, assertTerraformerMetadata as assertR11TerraformerMetadata,
  assertR8StatePreserved as assertR11StatePreserved } from './r11-compatibility.mjs';

export const CURRENT_REVISION = 12;
export const NPC_MODEL = 'fixed-production-v1';
export const NPC_MAX_SECONDS = 11900;
function checkedAge(value) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= NPC_MAX_SECONDS,
    'independently expected NPC age must be an explicit finite number in [0,11900]');
  return value;
}
export function expectedNpcEconomy(elapsedSeconds) {
  return { model: NPC_MODEL, elapsedSeconds: checkedAge(elapsedSeconds) };
}
export function advanceExpectedNpcAge(priorAge, adoptedSegmentsSeconds) {
  let age = checkedAge(priorAge);
  assert.ok(Array.isArray(adoptedSegmentsSeconds), 'independent adopted-segment witness required');
  for (const step of adoptedSegmentsSeconds) {
    assert.ok(typeof step === 'number' && Number.isFinite(step) && step >= 0, 'adopted segments must be nonnegative finite numbers');
    age = Math.min(NPC_MAX_SECONDS, age + step);
  }
  return age;
}
export function assertNpcEconomy(actual, elapsedSeconds, label) {
  const expected = expectedNpcEconomy(elapsedSeconds);
  assert.ok(actual && typeof actual === 'object' && Object.hasOwn(actual, 'npcEconomy'), `${label}: explicit own NPC state`);
  const descriptor = Object.getOwnPropertyDescriptor(actual, 'npcEconomy');
  assert.ok(descriptor && 'value' in descriptor && descriptor.enumerable, `${label}: NPC slot must be an enumerable data field`);
  const npc = descriptor.value;
  assert.ok(npc && typeof npc === 'object' && !Array.isArray(npc), `${label}: exact NPC object`);
  assert.ok(Object.getPrototypeOf(npc) === Object.prototype || Object.getPrototypeOf(npc) === null, `${label}: plain NPC object`);
  assert.deepEqual(Reflect.ownKeys(npc).sort(), ['elapsedSeconds', 'model'], `${label}: exactly the two admitted NPC keys`);
  for (const key of ['model', 'elapsedSeconds']) {
    const field = Object.getOwnPropertyDescriptor(npc, key);
    assert.ok(field && 'value' in field && field.enumerable, `${label}: own enumerable NPC data field ${key}`);
    assert.equal(field.value, expected[key], `${label}: independently expected NPC ${key}`);
  }
  return true;
}
export function projectVerifiedNpcEconomy(actual, elapsedSeconds, label) {
  assertNpcEconomy(actual, elapsedSeconds, label);
  const prior = structuredClone(actual);
  delete prior.npcEconomy;
  return prior;
}
export function liftR11StateToR12(state, elapsedSeconds) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'complete historical state required');
  assert.equal(Object.hasOwn(state, 'npcEconomy'), false, 'historical state cannot already have NPC metadata');
  // First-property placement is part of the actual native serializer byte contract.
  return { npcEconomy: expectedNpcEconomy(elapsedSeconds), ...state };
}
export function liftR10StateToR12(state, elapsedSeconds) {
  return liftR11StateToR12(liftR10StateToR11(state), elapsedSeconds);
}
export function liftR8StateToR12(state, floor, elapsedSeconds) {
  return liftR11StateToR12(liftR8StateToR11(state, floor), elapsedSeconds);
}
export function assertTerraformerMetadata(actual, historical, floor, label, elapsedSeconds) {
  return assertR11TerraformerMetadata(projectVerifiedNpcEconomy(actual, elapsedSeconds, label), historical, floor, label);
}
export function assertR8StatePreserved(actual, historical, label, floor, elapsedSeconds) {
  const prior = projectVerifiedNpcEconomy(actual, elapsedSeconds, label);
  assertR11StatePreserved(prior, historical, label, floor);
  assert.deepEqual(actual, liftR8StateToR12(historical, floor, elapsedSeconds), `${label}: complete old state plus independently verified exact r12 metadata`);
}

/** Bind archived inputs to every immutable source blob and path, including archives without .git. */
export function assertHistoricalSource(root, sourceSha) {
  assert.match(sourceSha, /^[0-9a-f]{40}$/);
  const entries = execFileSync('git', ['ls-tree', '-r', '-z', sourceSha, '--', 'src'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(entries.length > 0, 'pinned historical source tree exists');
  const expected = [];
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    assert.ok(match, 'only regular historical source files are admitted');
    const [, mode, digest, name] = match, path = resolve(root, name), stat = lstatSync(path), bytes = readFileSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${sourceSha}: ordinary source file ${name}`);
    assert.equal(Boolean(stat.mode & 0o111), mode === '100755', `${sourceSha}: source mode ${name}`);
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, digest, `${sourceSha}: exact historical source blob ${name}`); expected.push(name);
  }
  const actual = [];
  function scan(relative) {
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) scan(name); else actual.push(name);
    }
  }
  scan('src'); assert.deepEqual(actual.sort(), expected.sort(), `${sourceSha}: no missing or extra source files`);
  return sourceSha;
}
