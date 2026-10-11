import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  advanceNpcEconomy, createNpcEconomyState, isNpcEconomyState, npcEconomySnapshot,
  MAX_NPC_ECONOMY_SECONDS, NPC_ECONOMY_CAPACITY, NPC_ECONOMY_INITIAL_STOCK,
  NPC_ECONOMY_MODEL, NPC_ECONOMY_PRODUCTION_PER_SECOND,
} from '../experimental/npc-economy.ts';

// Run from any working directory; fixture arguments remain relative to this repository.
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: { fixture: { type: 'string', default: 'tests/fixtures/npc-economy-goldens.json' }, help: { type: 'boolean', default: false } },
  strict: true, allowPositionals: false,
});
if (values.help) {
  console.log('Usage: node --import tsx scripts/check-npc-economy-goldens.mjs [--fixture tests/fixtures/npc-economy-goldens.json]');
  process.exit(0);
}
assert.ok(!isAbsolute(values.fixture), 'The fixture argument must be repository-relative');
const fixtureAbsolute = resolve(root, values.fixture);
const fixturePath = relative(root, fixtureAbsolute);
assert.ok(fixturePath !== '..' && !fixturePath.startsWith('../') && !isAbsolute(fixturePath), 'The fixture must remain inside the repository');
const expectedFixtureSha = 'c0f8bdb61027c0629564ad1838d0fde8693083c1228e41ea23747763f542b0bb';
const bytes = readFileSync(fixtureAbsolute);
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(bytes), expectedFixtureSha, 'Independent fixture bytes must remain frozen');
const fixture = JSON.parse(bytes.toString('utf8'));
assert.equal(fixture.fixtureFormat, 'independent-npc-economy-goldens-v1');
const categories = ['specGoldens', 'capacityBoundaries', 'stepNoops', 'partitionGoldens', 'signedZeroGoldens', 'invalidStates'];
function decode(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  if (Object.hasOwn(value, '$runtimeNumber')) {
    assert.deepEqual(Object.keys(value), ['$runtimeNumber']);
    const values = { NaN: NaN, '+Infinity': Infinity, '-Infinity': -Infinity };
    assert.ok(Object.hasOwn(values, value.$runtimeNumber), 'Unknown runtime-number descriptor');
    return values[value.$runtimeNumber];
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}
function numeric(actual, expected, label) {
  assert.equal(typeof expected, 'string', `${label}: decimal-string oracle`);
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${label}: finite production value`);
  assert.ok(actual === Number(expected), `${label}: ${actual} must equal ${expected}`);
}
assert.equal(NPC_ECONOMY_MODEL, fixture.contract.model);
numeric(MAX_NPC_ECONOMY_SECONDS, fixture.contract.maximumElapsedSeconds, 'maximum age');
assert.deepEqual(createNpcEconomyState(), { model: fixture.contract.model, elapsedSeconds: 0 });
for (const [id, expected] of Object.entries(fixture.parameters)) {
  numeric(NPC_ECONOMY_INITIAL_STOCK[id], expected.initialStock, `${id}.initial`);
  numeric(NPC_ECONOMY_CAPACITY[id], expected.capacity, `${id}.capacity`);
  numeric(NPC_ECONOMY_PRODUCTION_PER_SECOND[id], expected.productionPerSecond, `${id}.rate`);
}
assert.equal(categories.reduce((sum, category) => sum + fixture[category].length, 0), 68, 'All frozen cases must be exercised');
const results = [];
for (const category of categories) for (const entry of fixture[category]) {
  try {
    const input = decode(entry.input), state = input.state, before = structuredClone(state);
    if (state !== null && typeof state === 'object') Object.freeze(state);
    if (category === 'invalidStates') {
      assert.equal(isNpcEconomyState(state), entry.expected.accepted);
      assert.throws(() => npcEconomySnapshot(state), TypeError);
      for (const step of [0, NaN, 60]) assert.throws(() => advanceNpcEconomy(state, step), TypeError);
    } else {
      assert.equal(isNpcEconomyState(state), true);
      let result = state;
      if (input.operation === 'advance') result = advanceNpcEconomy(state, input.stepSeconds);
      else if (input.operation === 'advanceSequence') {
        for (const step of input.stepsSeconds) result = advanceNpcEconomy(result, step);
      } else assert.equal(input.operation, 'query');
      const snapshot = npcEconomySnapshot(result);
      numeric(result.elapsedSeconds, entry.expected.elapsedSeconds, `${entry.id}.state.age`);
      numeric(snapshot.elapsedSeconds, entry.expected.elapsedSeconds, `${entry.id}.snapshot.age`);
      assert.equal(snapshot.model, fixture.contract.model);
      for (const [id, expected] of Object.entries(entry.expected.resources)) {
        numeric(snapshot.resources[id], expected.stock, `${entry.id}.${id}.stock`);
        numeric(snapshot.produced[id], expected.actualProduced, `${entry.id}.${id}.actualProduced`);
        assert.equal(snapshot.full[id], expected.full, `${entry.id}.${id}.full`);
        numeric(snapshot.capacity[id], fixture.parameters[id].capacity, `${entry.id}.${id}.capacity`);
        numeric(snapshot.productionPerSecond[id], fixture.parameters[id].productionPerSecond, `${entry.id}.${id}.rate`);
        assert.equal(expected.actualConsumed, '0');
        assert.equal(snapshot.resources[id], Number(fixture.parameters[id].initialStock) + snapshot.produced[id]);
      }
      if (entry.expectedSameInputStateForNoop === true || category === 'stepNoops') assert.equal(result, state);
      if (entry.expectedSameInputStateForNoop === false) assert.notEqual(result, state);
    }
    assert.deepEqual(state, before, `${entry.id}: original input remains unchanged, including negative zero`);
    results.push({ category, id: entry.id, passed: true });
  } catch (error) {
    results.push({ category, id: entry.id, passed: false, error: `${error.name ?? 'Error'}: ${String(error.message ?? error).replaceAll(root, '<repo>/')}` });
  }
}
const failures = results.filter(result => !result.passed);
const report = {
  status: failures.length ? 'failed' : 'passed',
  scope: 'Standalone domain candidate only; no tick, save, scout, UI, browser or deployment integration validated.',
  node: process.version,
  applicationBaseCommit: 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a',
  executedGitHead: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeStatus: execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).trim(),
  sourceSha256: hash(readFileSync(`${root}/experimental/npc-economy.ts`)),
  testSha256: hash(readFileSync(`${root}/tests/npc-economy.test.ts`)),
  fixturePath, fixtureSha256: hash(bytes), adapterSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  exactArithmeticComparison: 'Binary-exact production numbers equal independently supplied decimal-string values; no tolerance.',
  passed: results.length - failures.length, failed: failures.length, total: results.length,
  categories: Object.fromEntries(categories.map(category => [category, results.filter(result => result.category === category).length])),
  results,
};
// No local absolute paths or stack traces enter the shareable stdout report.
console.log(JSON.stringify(report, null, 2));
for (const failure of failures) console.error(failure.error);
process.exitCode = failures.length ? 1 : 0;
