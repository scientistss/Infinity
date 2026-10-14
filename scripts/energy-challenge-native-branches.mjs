#!/usr/bin/env node
/** Explicit native-boundary preparations, never a fourth natural route or browser evidence.
 * node --import tsx scripts/energy-challenge-native-branches.mjs --natural DIR --out DIR [--allow-dirty]
 * All source checkpoints are strict-read; all economic effects use actual APIs.
 * Full states, source bytes, setup declarations and independent baseline evidence are retained.
 * No browser/disk save store, RNG patch, seed search, imported old fixture or fabricated paid ID.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSave, deserializeState, exportSave, serializeState } from '../src/game/save.ts';
import { SaveSession } from '../src/game/save-session.ts';
import { STORAGE_KEY } from '../src/game/content.ts';
import { createInitialState } from '../src/game/state.ts';
import { createPlanet } from '../src/game/planet.ts';
import { activePlanet, selectPlanet } from '../src/game/empire.ts';
import { enqueue, cancel, queueCapacity } from '../src/game/queue.ts';
import { speedUp, speedupQuote } from '../src/game/dark-matter.ts';
import { evaluatePrestige, prestige, warpGain } from '../src/game/logic.ts';
import { quoteEnergyChallenge, enterEnergyChallenge, abandonEnergyChallenge, finishEnergyChallenge } from '../src/game/energy-challenge.ts';
import { createEnergyChallengeState } from '../src/game/energy-challenge-state.ts';
import { toggleSlot, patchSlot, unlockedSlotCount } from '../src/automation/engine.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const plain = state => serializeState(state);
let natural, out, allowDirty = false;
const args = process.argv.slice(2);
while (args.length) {
  const key = args.shift();
  if (key === '--natural') { assert(!natural && args.length); natural = resolve(args.shift()); }
  else if (key === '--out') { assert(!out && args.length); out = resolve(args.shift()); }
  else if (key === '--allow-dirty') { assert(!allowDirty); allowDirty = true; }
  else throw Error(`Unsupported argument ${key}`);
}
assert(natural && out, '--natural DIR --out DIR are required');
const dirtyPaths = git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean);
assert(allowDirty || dirtyPaths.length === 0, 'Clean source required; --allow-dirty is diagnostic only');
function original(path) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink(), `Ordinary original required: ${path}`);
  return readFileSync(path);
}
function ref(path) { const raw = original(path); return { file: resolve(path), sha256: hash(raw), bytes: raw.length }; }
function verified(reference, base) {
  const path = resolve(base, reference.file), raw = original(path);
  assert.equal(hash(raw), reference.sha256, `Changed input original: ${path}`);
  if (reference.bytes !== undefined) assert.equal(raw.length, reference.bytes);
  return raw.toString('utf8');
}
function inventory(directory) {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink()); const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? inventory(path) : [{ path, sha256: hash(original(resolve(ROOT, path))) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function sourceManifest() {
  return [...inventory('src'), ...['package.json', 'package-lock.json',
    'scripts/energy-challenge-natural-fixture.mjs', 'scripts/energy-challenge-native-branches.mjs',
    'scripts/check-energy-challenge-native-branches.py'].map(path => ({ path, sha256: hash(original(resolve(ROOT, path))) }))];
}
const naturalReport = JSON.parse(original(resolve(natural, 'report.json')));
assert.equal(naturalReport.schema, 'energy-challenge-natural-v1'); assert.equal(naturalReport.status, 'passed');
assert.equal(naturalReport.sourceSha, git('rev-parse', 'HEAD'), 'Natural route must bind this source SHA');
assert.equal(naturalReport.nodeVersion, process.version, 'Natural and supplemental preparations must use the same exact runtime');
assert.deepEqual(naturalReport.routes.map(value => value.policy), ['solar', 'satellite', 'throttle'], 'Fixed natural policy census required');
for (const file of naturalReport.sourceFiles) assert.equal(hash(original(resolve(ROOT, file.path))), file.sha256, `Natural checkpoint source changed: ${file.path}; regenerate natural routes`);
assert(allowDirty || naturalReport.sourceClassification === 'clean-candidate-source');
assert.deepEqual(naturalReport.sourceInput, { kind: 'createInitialState', worldSeed: 20261013, arcadeSeed: 20261013,
  importedSaves: [], importedReports: [], stockGrants: [], directStatePatches: [] });
const route = naturalReport.routes.find(value => value.policy === 'solar'); assert(route && route.status === 'passed');
const sourceFiles = sourceManifest();
mkdirSync(out, { recursive: false });
const report = { schema: 'infinity-energy-challenge-native-supplements-v1', status: 'running',
  sourceSha: git('rev-parse', 'HEAD'), runtimeNode: process.version,
  classification: 'explicit-boundary-preparation-not-natural-route-not-browser-proof',
  sourceClassification: dirtyPaths.length ? 'diagnostic-working-tree' : 'clean-candidate-source', dirtyPaths,
  sourceFiles, naturalReport: ref(resolve(natural, 'report.json')), cases: [],
  caveats: ['Synthetic setup is explicitly declared per case; the resulting action is always the real domain API.',
    'Random native new-game reset is checked against a full pristine template with only independently derived seed fields substituted.',
    'No persistent browser or user save was written. In-memory stores are readback/protection probes only.'] };
function write(name, value, raw = false) {
  const path = resolve(out, name); writeFileSync(path, raw ? value : json(value), { flag: 'wx' }); return ref(path);
}
function memoryStore(raw) {
  const map = new Map([[STORAGE_KEY, raw]]), writes = [];
  return { map, writes, getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { writes.push({ key, value }); map.set(key, value); }, removeItem: key => { writes.push({ key, removed: true }); map.delete(key); } };
}
function strict(raw, epoch) {
  const imported = importSave(raw), state = deserializeState(imported.state), store = memoryStore(raw);
  const session = new SaveSession(store, epoch);
  assert.equal(session.mode, 'ready'); assert.equal(session.loaded.appliedSeconds, 0);
  assert.deepEqual(plain(session.loaded.state), plain(state)); assert.equal(store.writes.length, 0);
  return state;
}
function checkpoint(name) {
  const info = route.checkpoints[name]; assert(info, `Missing natural checkpoint ${name}`);
  const raw = verified(info, natural), envelope = JSON.parse(raw);
  assert.equal(envelope.version, 9); assert.equal(envelope.revision, 16); assert.equal(envelope.savedAt, envelope.lastTickAt);
  const state = strict(raw, envelope.lastTickAt);
  assert.deepEqual(plain(state), envelope.state, `Natural source not a fixed strict read: ${name}`);
  return { state, epoch: envelope.lastTickAt, reference: ref(resolve(natural, info.file)), checkpoint: name };
}
function makeCase(id, name, setups = [], classification = 'explicit-synthetic-boundary') {
  const source = checkpoint(name), serialized = clone(plain(source.state));
  for (const patch of setups) {
    let owner = serialized;
    for (const key of patch.path.slice(0, -1)) owner = owner[key];
    assert(owner && Object.hasOwn(owner, patch.path.at(-1)), `Setup must replace an existing declared path: ${patch.path.join('.')}`);
    assert.deepEqual(owner[patch.path.at(-1)], patch.before, `Setup previous value mismatch: ${patch.path.join('.')}`);
    owner[patch.path.at(-1)] = clone(patch.after);
  }
  const raw = exportSave(deserializeState(serialized), source.epoch, source.epoch);
  const state = strict(raw, source.epoch);
  // No silent reader repair may hide an undeclared fixture mutation.
  assert.deepEqual(plain(state), serialized, `${id}: declare every setup change; reader normalization is not a fixture editor`);
  const row = { id, epoch: source.epoch, classification, source: { policy: 'solar', checkpoint: name, original: source.reference },
    setup: setups, input: write(`${id}-input.json`, raw, true), initialExpected: write(`${id}-initial-state.json`, plain(state)),
    steps: [], domainActions: [], strictRead: { ready: true, appliedSeconds: 0, storageWrites: 0 } };
  report.cases.push(row);
  return { row, state, store: memoryStore(raw), session: null };
}
function saveExpected(branch, label, state) {
  const before = plain(state), raw = exportSave(state, branch.row.epoch, branch.row.epoch);
  importSave(raw); // Validate the candidate, preserving the actual API output, never patching it.
  if (!branch.session) branch.session = new SaveSession(branch.store, branch.row.epoch);
  const saved = branch.session.save(state, branch.row.epoch, branch.row.epoch); assert(saved.ok, saved.message);
  assert.equal(branch.store.getItem(STORAGE_KEY), raw);
  const read = strict(raw, branch.row.epoch);
  assert.deepEqual(plain(read), before, `${branch.row.id}/${label}: state changed on strict readback`);
  branch.state = state;
  return write(`${branch.row.id}-${label}-state.json`, before);
}
function action(branch, label, api, request, apply, step) {
  const before = plain(branch.state), beforeRef = write(`${branch.row.id}-${label}-before.json`, before);
  const result = apply(branch.state); assert(result.ok !== false, result.reason);
  assert.deepEqual(plain(branch.state), before, `${api}: input mutated`);
  const state = result.state ?? result, expected = saveExpected(branch, label, state);
  const audit = { api, request, before: beforeRef, after: expected };
  branch.row.domainActions.push(audit);
  if (step) branch.row.steps.push({ ...step, expected });
  branch.row.finalExpected = expected;
  return { state, expected, audit };
}
function challenge(branch, kind) {
  const source = branch.state, quote = quoteEnergyChallenge(source, kind); assert(quote.ok, quote.reason);
  const ordinary = kind === 'abandon' ? null : evaluatePrestige(kind === 'finish'
    ? { ...source, energyChallenge: { ...source.energyChallenge, active: null } } : source);
  const result = action(branch, kind, `${kind}EnergyChallenge`, { action: kind }, state =>
    ({ enter: enterEnergyChallenge, abandon: abandonEnergyChallenge, finish: finishEnergyChallenge })[kind](state, quote), { kind: 'challenge', action: kind });
  result.audit.quote = { gain: quote.gain, disabledPrestigeSlots: [...quote.disabledPrestigeSlots] };
  if (ordinary) result.audit.ordinaryBaseline = write(`${branch.row.id}-${kind}-ordinary-baseline.json`, plain(ordinary.next));
  return result;
}
function patch(source, path, after, reason) {
  let before = plain(source); for (const key of path) before = before[key];
  return { path, before: clone(before), after: clone(after), reason };
}
function protocolSetup(source, enabled) {
  const slots = clone(source.protocols.slots), make = (kind, index, on) => ({
    id: kind === 'prestige' ? 'auto_prestige' : 'auto_collect', enabled: on,
    trigger: { kind: 'interval', seconds: index === 11 ? 37 : 17 },
    conditions: kind === 'prestige' ? [{ kind: 'resourceGte', res: 'metal', value: String(123 + index) }] : [],
    action: kind === 'prestige' ? { kind, minGain: index === 11 ? 13 : 9 } : { kind },
  });
  for (const index of [0, 1, 11]) slots[index] = { card: make(index === 1 ? 'collect' : 'prestige', index, index === 1 || enabled), elapsed: index + 0.25, lamp: 'gray', reason: 'Synthetic native-boundary configuration' };
  return [patch(source, ['protocols', 'slots'], slots, 'Explicit synthetic enabled/disabled cards including a locked slot; no economy or challenge edit'),
    patch(source, ['unlockedCards'], [...new Set([...source.unlockedCards, 'auto_collect', 'auto_prestige'])], 'Explicit synthetic catalog availability for native card editing')];
}
try {
  // Real paid jobs branch from the actual post-entry 500/500 economy. No stock/DM grant.
  for (const kind of ['cancel', 'accelerate']) {
    const branch = makeCase(`paid-job-${kind}`, 'entered');
    const paid = action(branch, 'paid', 'enqueue', { id: 'solar_plant', source: 'manual' },
      state => enqueue(state, 'solar_plant', 'manual'), { kind: 'build', id: 'solar_plant' });
    const job = activePlanet(paid.state).buildQueue[0];
    assert.equal(job.jobId, JSON.parse(verified(paid.audit.before, out)).orders.nextJobId);
    assert.deepEqual(Object.fromEntries(Object.entries(job.paid).map(([key, value]) => [key, value.toString()])), { metal: '75', crystal: '30', deuterium: '0' });
    assert.equal(job.totalSeconds, 1); assert.equal(job.remainingSeconds, 1);
    branch.row.actualPaidJob = clone(plain(paid.state).planets[0].buildQueue[0]);
    if (kind === 'cancel') action(branch, 'cancelled', 'cancel', { index: 0 }, state => cancel(state, 0), { kind: 'cancel-build', index: 0 });
    else {
      const quote = speedupQuote(job.remainingSeconds, 'build', 'finish'); assert(quote.allowed); assert.equal(quote.dm, 750);
      branch.row.accelerationCost = { currency: 'darkMatter', amount: String(quote.dm) };
      action(branch, 'accelerated', 'speedUp', { target: 'build', mode: 'finish' }, state => speedUp(state, 'build', 'finish'), { kind: 'accelerate-build' });
    }
  }
  {
    const source = checkpoint('entry-ready').state, branch = makeCase('auto-card-disable-config', 'entry-ready', protocolSetup(source, true));
    branch.row.lockedAutoSlot = 11; branch.row.unlockedSlotCount = unlockedSlotCount(branch.state);
    assert(branch.row.unlockedSlotCount > 1 && branch.row.unlockedSlotCount <= 11);
    challenge(branch, 'enter'); challenge(branch, 'abandon');
  }
  {
    const source = checkpoint('finish-ready').state, branch = makeCase('active-auto-guard', 'finish-ready', protocolSetup(source, false));
    assert(unlockedSlotCount(branch.state) >= 2);
    action(branch, 'toggle-refused', 'toggleSlot', { slot: 0, enabled: true }, state => {
      const next = toggleSlot(state, 0, true); assert.equal(next, state); return next;
    }, { kind: 'auto-toggle', slot: 0 });
    action(branch, 'edit-refused', 'patchSlot', { slot: 1, path: 'action.kind', value: 'prestige' }, state => {
      const next = patchSlot(state, 1, 'action.kind', 'prestige'); assert.equal(next, state); return next;
    }, { kind: 'auto-edit', slot: 1, path: 'action.kind', value: 'prestige' });
    challenge(branch, 'finish');
  }
  for (const [kind, name] of [['enter', 'entry-ready'], ['abandon', 'active-progress'], ['finish', 'finish-ready']]) {
    const source = checkpoint(name).state, home = activePlanet(source);
    const colony = createPlanet('boundary-colony', { ...home.coordinates, position: home.coordinates.position + 1 });
    colony.name = 'Explicit synthetic ABA colony';
    const planets = [...plain(source).planets, plain({ ...source, planets: [...source.planets, colony] }).planets.at(-1)];
    const branch = makeCase(`${kind}-active-planet-aba`, name, [patch(source, ['planets'], planets,
      'Explicit synthetic second owned, empty planet solely for active identity ABA; no colony acquisition claimed')], 'explicit-adversarial-lifecycle');
    branch.row.action = kind; branch.row.planetIds = [home.id, colony.id]; branch.row.planetSelections = [];
    for (const id of [colony.id, home.id]) {
      const result = action(branch, `select-${id}`, 'selectPlanet', { id }, state => selectPlanet(state, id));
      branch.row.planetSelections.push({ id, expected: result.expected });
    }
    assert.deepEqual(plain(branch.state), JSON.parse(verified(branch.row.initialExpected, out)));
  }
  {
    const source = checkpoint('completed').state;
    const branch = makeCase('receipt-ordinary-curvature', 'completed', [patch(source, ['lifetime'],
      { metal: '100000000', crystal: '0', deuterium: '0' }, 'Explicit synthetic ordinary-curvature eligibility; not a third natural production route')]);
    const old = branch.state, gain = warpGain(old); assert(gain.gte(1));
    const ordinary = evaluatePrestige({ ...old, energyChallenge: createEnergyChallengeState() });
    const result = action(branch, 'ordinary-curvature', 'prestige', {}, state => prestige(state), { kind: 'ordinary-prestige' });
    result.audit.ordinaryBaseline = write('receipt-ordinary-curvature-baseline.json', plain(ordinary.next));
    result.audit.gain = gain.toString(); assert.deepEqual(result.state.energyChallenge, old.energyChallenge); assert.equal(queueCapacity(result.state), 3);
  }
  {
    const branch = makeCase('new-game-clear', 'completed');
    const pristine = createInitialState(20261013, 20261013);
    const raw = exportSave(pristine, branch.row.epoch, branch.row.epoch); assert.deepEqual(plain(strict(raw, branch.row.epoch)), plain(pristine));
    const pristineSource = checkpoint('initial');
    assert.deepEqual(plain(pristine), plain(pristineSource.state));
    const template = write('new-game-pristine-template.json', plain(pristine));
    branch.row.resetOracle = { kind: 'pristine-template-from-observed-seed-v1', template, pristineSource: pristineSource.reference, fixedTemplateSeed: 20261013,
      permittedSeedPaths: ['universe.seed', 'arcade.seed', 'deepSpace.seed', 'planets.0.coordinates'],
      implementation: 'scripts/check-energy-challenge-native-branches.py:pristine_reset_expected' };
    branch.row.steps = [{ kind: 'reset', resetOracle: branch.row.resetOracle }];
  }
  for (const id of ['external-storage-protection', 'external-r16-misplaced-authority']) {
    const branch = makeCase(id, 'entry-ready', [], 'explicit-adversarial-lifecycle'); branch.row.action = 'enter';
    const good = verified(branch.row.input, out), malformed = JSON.parse(good);
    malformed.state.protocols.energyChallenge = clone(malformed.state.energyChallenge);
    const bad = id === 'external-storage-protection' ? '{"schema":"infinity-original-p4","state":' : json(malformed);
    assert.throws(() => importSave(bad));
    const store = memoryStore(good), session = new SaveSession(store, branch.row.epoch), before = plain(session.loaded.state);
    store.map.set(STORAGE_KEY, bad); assert(session.handleStorageEvent(STORAGE_KEY)); assert.equal(session.mode, 'conflict');
    assert.deepEqual(plain(session.loaded.state), before); assert.equal(store.writes.length, 0);
    const blocked = session.save(session.loaded.state, branch.row.epoch, branch.row.epoch); assert.equal(blocked.ok, false);
    assert.equal(store.getItem(STORAGE_KEY), bad); assert.equal(session.export(session.loaded.state).raw, good); assert.equal(store.writes.length, 0);
    const startup = new SaveSession(store, branch.row.epoch); assert.equal(startup.mode, 'protected');
    assert.equal(startup.export(startup.loaded.state).raw, bad); assert.equal(store.writes.length, 0);
    branch.row.externalInput = write(`${id}-foreign-original.json`, bad, true); branch.row.finalExpected = branch.row.initialExpected;
    branch.row.protectionAudit = { currentSession: 'conflict', oldVisibleStateRetained: true, foreignBytesRetained: true,
      preConflictExportRetained: true, reloadMode: 'protected', startupOriginalRetained: true, storageWrites: 0 };
  }
  assert.deepEqual(sourceManifest(), sourceFiles, 'Source changed during boundary preparation');
  assert.equal(git('rev-parse', 'HEAD'), report.sourceSha, 'Source commit changed during boundary preparation');
  assert.deepEqual(git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean), dirtyPaths,
    'Source cleanliness changed during boundary preparation');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  write('manifest.json', report);
  process.stdout.write(JSON.stringify({ status: report.status, manifest: resolve(out, 'manifest.json'), cases: report.cases.map(row => row.id), error: report.error }) + '\n');
}
