#!/usr/bin/env node
/** Independent fresh-start domain progression. No input-save/report argument exists.
 * node --import tsx scripts/building-batch-natural-fixture.mjs --out DIR [--allow-dirty]
 * The clock below is compressed logical live-engine time, never native browser evidence.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState, createPlanet } from '../src/game/state.ts';
import { activePlanet, selectPlanet } from '../src/game/empire.ts';
import { canEnqueue, enqueue } from '../src/game/queue.ts';
import { canEnqueueResearch, enqueueResearch } from '../src/game/research.ts';
import { canBuildUnits, orderUnits } from '../src/game/shipyard.ts';
import { quoteFlight, sendFleet } from '../src/game/fleet.ts';
import { distance, npcAt, sameCoordinates } from '../src/game/galaxy.ts';
import { tick } from '../src/game/logic.ts';
import { economy } from '../src/game/economy.ts';
import { big } from '../src/game/decimal.ts';
import { createBuildingTemplate, editBuildingTemplate, deleteBuildingTemplate } from '../src/game/building-templates.ts';
import { quoteBuildingTemplateBatch, applyBuildingTemplateBatch } from '../src/game/building-template-batch.ts';
import { deserializeState, serializeState, exportSave, importSave } from '../src/game/save.ts';
import { createOrderTask, pauseOrderTask } from '../src/game/orders.ts';
import { SAVE_VERSION, SAVE_REVISION, STORAGE_KEY } from '../src/game/content.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_SEED = 20261013, ARCADE_SEED = 31415926;
const MAX_SECONDS = 14400, SAVE_EPOCH = Date.UTC(2026, 9, 13, 12);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const json = value => JSON.stringify(value);
const plain = value => JSON.parse(json(value));
const args = process.argv.slice(2);
let destination, allowDirty = false;
while (args.length) {
  const key = args.shift();
  if (key === '--out') { assert(!destination && args.length, 'Duplicate/missing --out'); destination = resolve(args.shift()); }
  else if (key === '--allow-dirty') { assert(!allowDirty); allowDirty = true; }
  else throw new Error(`Unknown argument ${key}; this producer accepts no save/report input`);
}
assert(destination, '--out DIR is required');
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
function fileInventory(directory) {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap(entry => {
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${directory}/${entry.name}`);
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? fileInventory(path) : [{ path, sha256: hash(readFileSync(resolve(ROOT, path))) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
const dirty = git('status', '--porcelain=v1', '--untracked-files=all');
assert(allowDirty || !dirty, 'Acceptance fixture requires a clean source tree; --allow-dirty is diagnostic only');
const sourceFiles = [...fileInventory('src'), ...['package.json', 'package-lock.json', 'scripts/building-batch-natural-fixture.mjs'].map(path => ({ path, sha256: hash(readFileSync(resolve(ROOT, path))) }))];
const provenance = {
  sourceSha: git('rev-parse', 'HEAD'), fullTree: git('rev-parse', 'HEAD^{tree}'),
  classification: allowDirty ? 'diagnostic-working-tree' : 'clean-candidate-source', dirtyPaths: dirty.split('\n').filter(Boolean),
  runtimeNode: process.version, sourceFiles, sourceManifestSha256: hash(json(sourceFiles)),
  sourceInput: { kind: 'createInitialState', worldSeed: WORLD_SEED, arcadeSeed: ARCADE_SEED, importedReports: [], importedSaves: [], stockGrants: [], directStatePatches: [] },
};
let state = createInitialState(WORLD_SEED, ARCADE_SEED), logicalSeconds = 0, paid = null;
const receipts = [], jobs = new Map(), checkpoints = {};
const stateHash = () => hash(json(serializeState(state)));
const money = resources => Object.fromEntries(['metal', 'crystal', 'deuterium'].map(id => [id, resources[id].toString()]));
const wallets = () => Object.fromEntries(state.planets.map(planet => [planet.id, money(planet.resources)]));
const summary = () => ({ stateSha256: stateHash(), logicalSeconds, totalTime: state.totalTime.toString(), wallets: wallets(),
  nextTaskId: state.orders.nextTaskId, nextJobId: state.orders.nextJobId, nextWorkId: state.orders.nextWorkId,
  nextFleetId: state.nextFleetId, activePlanetId: state.activePlanetId });
function observeJobs() {
  const queues = state.planets.flatMap(planet => [
    ...planet.buildQueue.map(job => ({ kind: 'building', planetId: planet.id, ...plain(job) })),
    ...planet.shipyardQueue.map(job => ({ kind: 'shipyard', planetId: planet.id, ...plain(job) })),
  ]).concat(state.research.queue.map(job => ({ kind: 'research', ...plain(job) })));
  for (const job of queues) if (!jobs.has(job.jobId)) jobs.set(job.jobId, { observedAt: logicalSeconds, ...job });
  if (paid === null && queues.some(job => job.taskId !== null)) {
    const batch = queues.filter(job => job.taskId !== null);
    assert.equal(batch.length, 4, 'All four independently paid jobs must coexist at their first real pass');
    for (const job of batch) {
      const task = state.orders.tasks.find(task => task.id === job.taskId);
      const price = job.building === 'metal_storage' ? { metal: '1000', crystal: '0', deuterium: '0' } : { metal: '1000', crystal: '1000', deuterium: '0' };
      assert.equal(task.kind, 'building'); assert.equal(task.planetId, job.planetId); assert.equal(task.building, job.building);
      assert.equal(task.targetLevel, 1); assert.equal(task.status, 'running'); assert.equal(task.completedUnits, 0);
      assert.deepEqual(task.activeJob, { jobId: job.jobId, quantity: 1, credited: 0 });
      assert.deepEqual(task.budget, price); assert.deepEqual(task.charged, price);
      assert.deepEqual(task.refunded, { metal: '0', crystal: '0', deuterium: '0' });
      assert.equal(task.transport, null); assert.equal(task.formationOrigin, null);
    }
    paid = save('paid');
  }
}
function receipt(api, request, before, result = {}) {
  receipts.push({ index: receipts.length + 1, api, request: plain(request), before, after: summary(), ...plain(result) });
}
function act(api, request, run) {
  const before = summary(), result = run();
  assert(result.ok, `${api} failed: ${result.reason}`);
  state = result.state; observeJobs();
  receipt(api, request, before, { ok: result.ok, reason: result.reason, jobId: result.jobId ?? null, createdTaskIds: result.createdTaskIds ?? [] });
  return result;
}
function advanceUntil(reason, predicate, max = MAX_SECONDS) {
  const before = summary(); let count = 0;
  while (!predicate()) {
    assert(logicalSeconds < MAX_SECONDS && count < max, `Natural route stalled: ${reason}`);
    state = tick(state, 1, 'live'); logicalSeconds += 1; count += 1; observeJobs();
  }
  if (count) receipt('tick', { secondsPerCall: 1, calls: count, mode: 'live', reason }, before, { ok: true });
}
function build(building, level) {
  while (activePlanet(state).buildings[building] < level) {
    advanceUntil(`resources for ${building}`, () => {
      const check = canEnqueue(state, building);
      assert(check.ok || check.onlyResources || activePlanet(state).buildQueue.length, `${building}: ${check.reason}`);
      return check.ok;
    });
    act('enqueue', { building, source: 'manual', planetId: state.activePlanetId }, () => enqueue(state, building, 'manual'));
    advanceUntil(`finish ${building}`, () => activePlanet(state).buildQueue.length === 0);
  }
}
function research(tech, level) {
  while (state.research.levels[tech] < level) {
    advanceUntil(`resources for ${tech}`, () => {
      const check = canEnqueueResearch(state, tech);
      assert(check.ok || check.onlyResources, `${tech}: ${check.reason}`);
      return check.ok;
    });
    act('enqueueResearch', { tech, source: 'manual', planetId: state.activePlanetId }, () => enqueueResearch(state, tech, 'manual'));
    advanceUntil(`finish ${tech}`, () => state.research.queue.length === 0);
  }
}
function save(name) {
  const raw = exportSave(state, SAVE_EPOCH + logicalSeconds * 1000);
  const restored = deserializeState(importSave(raw).state);
  assert.equal(json(serializeState(restored)), json(serializeState(state)), `${name}: strict round-trip drift`);
  assert.equal(json(serializeState(tick(restored, 0))), json(serializeState(restored)), `${name}: startup mutation`);
  checkpoints[name] = { ...summary(), file: `${name}.json`, sha256: hash(raw), schema: { version: SAVE_VERSION, revision: SAVE_REVISION },
    planets: state.planets.map(planet => ({ id: planet.id, coordinates: planet.coordinates, buildings: { ...planet.buildings }, resources: money(planet.resources) })) };
  writeFileSync(resolve(destination, `${name}.json`), raw, { flag: 'wx' });
  return JSON.parse(raw);
}
mkdirSync(destination, { recursive: true });
receipt('createInitialState', { worldSeed: WORLD_SEED, arcadeSeed: ARCADE_SEED }, null, { ok: true });
assert.deepEqual(wallets(), { homeworld: { metal: '500', crystal: '500', deuterium: '0' } });
const initialStateSha256 = stateHash();

// A short economy ramp built through the same paid building API as ordinary play.
// None of these route levels are the two goals used by the batch acceptance.
for (let level = 1; level <= 7; level += 1) {
  build('solar_plant', level + 1);
  build('metal_mine', level);
  build('crystal_mine', level);
  build('deuterium_synth', Math.min(level, 6));
}
build('robotics_factory', 2);
build('research_lab', 3);
build('crystal_storage', 2);
research('energy_tech', 1);
research('impulse_drive', 3);
research('espionage_tech', 4);
research('astrophysics', 1);
build('shipyard', 4);
advanceUntil('pay a real colony ship', () => {
  const check = canBuildUnits(state, 'colony_ship', 1);
  assert(check.ok || check.onlyResources, check.reason);
  return check.ok;
});
act('orderUnits', { unit: 'colony_ship', count: 1, source: 'manual', planetId: state.activePlanetId }, () => orderUnits(state, 'colony_ship', 1, 'manual'));
advanceUntil('finish a real colony ship', () => activePlanet(state).units.colony_ship === 1);
const homeId = state.activePlanetId, home = activePlanet(state).coordinates;
const candidates = Array.from({ length: 15 }, (_, index) => ({ ...home, position: index + 1 }))
  .filter(target => !sameCoordinates(home, target) && !npcAt(state, target))
  .sort((left, right) => distance(home, left) - distance(home, right) || left.position - right.position);
assert(candidates.length, 'No unoccupied nearby colony target');
const fleetRequest = { mission: 'colonize', target: candidates[0], ships: { colony_ship: 1 },
  cargo: { metal: big(2300), crystal: big(1300), deuterium: big(0) }, speedPercent: 100 };
advanceUntil('natural colony seed cargo and flight fuel', () => quoteFlight(state, fleetRequest).ok);
const flightQuote = plain(quoteFlight(state, fleetRequest));
act('sendFleet', fleetRequest, () => sendFleet(state, fleetRequest));
advanceUntil('real colonization arrival and return', () => state.planets.length === 2 && state.fleets.length === 0);
const colonyId = state.planets.find(planet => planet.id !== homeId).id;
assert.equal(state.research.levels.astrophysics, 1);
assert.equal(state.planets.length, 2);
assert.equal(state.stats.launches, 0, 'No prestige replacement route');
assert.equal(state.manualClicks, 0, 'No manual resource collection');
for (const planet of state.planets) {
  assert.equal(planet.buildings.metal_storage, 0);
  assert.equal(planet.buildings.deuterium_tank, 0);
}
advanceUntil('both actual payers can fund the fixed four-job golden', () => state.planets.every(planet => planet.resources.metal.gte(2000) && planet.resources.crystal.gte(1000)));
const templateDraft = { name: '双星仓储验收', goals: [{ building: 'metal_storage', targetLevel: 1 }, { building: 'deuterium_tank', targetLevel: 1 }] };
act('createBuildingTemplate', { draft: templateDraft, expectedNextTemplateId: state.buildingTemplates.nextTemplateId }, () => createBuildingTemplate(state, templateDraft, state.buildingTemplates.nextTemplateId));
const templateId = state.buildingTemplates.templates[0].id;
const ready = save('ready');
const readyEconomies = state.planets.map(planet => ({ planetId: planet.id, economy: economy(selectPlanet(state, planet.id)) }));

// The literal goldens are independent of all template/order cost and quote helpers.
const goldens = {
  rows: [{ building: 'metal_storage', targetLevel: 1, paid: { metal: '1000', crystal: '0', deuterium: '0' } },
    { building: 'deuterium_tank', targetLevel: 1, paid: { metal: '1000', crystal: '1000', deuterium: '0' } }],
  perPlanet: { metal: '2000', crystal: '1000', deuterium: '0' }, total: { metal: '4000', crystal: '2000', deuterium: '0' },
  taskCount: 4, paidJobCount: 4, newSchemaFields: [],
};
const batchQuote = quoteBuildingTemplateBatch(state, templateId, [homeId, colonyId]);
assert(batchQuote.ok, batchQuote.reason);
assert.deepEqual(batchQuote.totalQuote, goldens.total);
assert.equal(batchQuote.newCount, goldens.taskCount);
for (const { quote } of batchQuote.planets) {
  assert.deepEqual(quote.totalQuote, goldens.perPlanet);
  for (const row of quote.rows) assert.deepEqual(row.quote, goldens.rows.find(expected => expected.building === row.building).paid);
}
const request = { templateId, expectedTemplateRevision: batchQuote.templateRevision, expectedNextTaskId: batchQuote.nextTaskId,
  expectedReviewKey: batchQuote.reviewKey, planets: [homeId, colonyId].map(planetId => ({ planetId,
    budgets: goldens.rows.map(row => ({ building: row.building, budget: { ...row.paid } })) })) };
const negativeResults = [];
for (const [name, change] of [
  ['missing-later-planet-budget', request => request.planets[1].budgets.pop()],
  ['duplicate-payer', request => { request.planets[1].planetId = homeId; }],
  ['unknown-later-payer', request => { request.planets[1].planetId = 'does-not-exist'; }],
  ['extra-later-budget-resource', request => { request.planets[1].budgets[1].budget.darkMatter = '1'; }],
  ['stale-task-counter', request => { request.expectedNextTaskId += 1; }],
  ['stale-template-revision', request => { request.expectedTemplateRevision += 1; }],
  ['stale-review', request => { request.expectedReviewKey += 'stale'; }],
  ['single-payer-is-not-a-batch', request => { request.planets.pop(); }],
]) {
  const changed = plain(request); change(changed);
  const before = summary(), result = applyBuildingTemplateBatch(state, changed);
  assert.equal(result.ok, false, name); assert.equal(result.state, state, `${name}: published partial state`);
  assert.deepEqual(result.createdTaskIds, [], name); assert.deepEqual(summary(), before, `${name}: mutated original state`);
  receipt('applyBuildingTemplateBatch', changed, before, { ok: false, reason: result.reason, createdTaskIds: [], case: name });
  negativeResults.push({ name, stateUnchanged: true, returnedOriginalIdentity: true, reason: result.reason });
}
const applicationBefore = summary(), nextJobBefore = state.orders.nextJobId;
const applied = act('applyBuildingTemplateBatch', request, () => applyBuildingTemplateBatch(state, request));
assert.deepEqual(wallets(), applicationBefore.wallets, 'Authorization paid immediately');
assert.equal(state.orders.nextJobId, nextJobBefore, 'Authorization allocated a paid job');
assert.equal(state.activePlanetId, homeId);
assert.deepEqual(applied.createdTaskIds, [1, 2, 3, 4]);
const authorized = save('authorized');
const duplicateBefore = summary(), duplicate = applyBuildingTemplateBatch(state, request);
assert.equal(duplicate.ok, false); assert.equal(duplicate.state, state); assert.deepEqual(summary(), duplicateBefore);
receipt('applyBuildingTemplateBatch', request, duplicateBefore, { ok: false, reason: duplicate.reason, createdTaskIds: [], case: 'duplicate-confirmation' });
const coveredQuote = quoteBuildingTemplateBatch(state, templateId, [homeId, colonyId]);
assert(coveredQuote.ok); assert.equal(coveredQuote.newCount, 0);
const noopRequest = { ...request, expectedNextTaskId: coveredQuote.nextTaskId, expectedReviewKey: coveredQuote.reviewKey,
  planets: [homeId, colonyId].map(planetId => ({ planetId, budgets: [] })) };
const noopBefore = summary();
act('applyBuildingTemplateBatch', noopRequest, () => applyBuildingTemplateBatch(state, noopRequest));
assert.deepEqual(summary(), noopBefore, 'Covered-only batch must be an exact no-op');
advanceUntil('four ordinary finite orders complete', () => state.orders.tasks.length === 4 && state.orders.tasks.every(task => task.status === 'completed'), 120);
for (const task of state.orders.tasks) {
  const expected = goldens.rows.find(row => row.building === task.building);
  assert(expected && [homeId, colonyId].includes(task.planetId));
  assert.equal(task.kind, 'building'); assert.equal(task.targetLevel, 1);
  assert.deepEqual(task.budget, expected.paid); assert.deepEqual(task.charged, expected.paid);
  assert.deepEqual(task.refunded, { metal: '0', crystal: '0', deuterium: '0' });
  assert.equal(task.transport, null); assert.equal(task.formationOrigin, null);
  assert.equal(state.planets.find(planet => planet.id === task.planetId).buildings[task.building], 1);
}
const batchPaidJobs = [...jobs.values()].filter(job => job.taskId !== null);
assert.equal(batchPaidJobs.length, goldens.paidJobCount);
assert.equal(state.orders.nextJobId - nextJobBefore, goldens.paidJobCount);
for (const job of batchPaidJobs) {
  const task = state.orders.tasks.find(task => task.id === job.taskId);
  assert.equal(job.kind, 'building'); assert.equal(job.source, 'plan'); assert.equal(job.planetId, task.planetId);
  assert.deepEqual(job.paid, goldens.rows.find(row => row.building === job.building).paid);
}
const completed = save('completed');
const finishedTasks = plain(state.orders.tasks), nextJobAfter = state.orders.nextJobId, nextTaskAfter = state.orders.nextTaskId;
const reloadBefore = summary();
state = deserializeState(importSave(exportSave(state, SAVE_EPOCH + logicalSeconds * 1000)).state);
receipt('strictExportImport', { savedAt: SAVE_EPOCH + logicalSeconds * 1000 }, reloadBefore, { ok: true });
const stopAt = logicalSeconds + 30;
advanceUntil('three further order passes cannot renew finite authorization', () => logicalSeconds === stopAt, 30);
assert.deepEqual(plain(state.orders.tasks), finishedTasks); assert.equal(state.orders.nextJobId, nextJobAfter); assert.equal(state.orders.nextTaskId, nextTaskAfter);
const noReplay = save('no-replay');
// Explicitly separate synthetic boundary states. These are not natural colonies.
// No stock is granted: extra planets begin at the public createPlanet zero stock.
// Astrophysics is set to its legal three/four-world capacity only in these branches.
const syntheticBoundaries = [];
for (const count of [3, 4]) {
  let branch = deserializeState(ready.state);
  const extras = [];
  for (let index = 2; index < count; index += 1) {
    const target = candidates.find(candidate => !branch.planets.some(planet => sameCoordinates(planet.coordinates, candidate)) && !npcAt(branch, candidate));
    assert(target, 'No valid synthetic boundary coordinate');
    const planet = createPlanet(`synthetic-boundary-${index + 1}`, target);
    extras.push({ id: planet.id, coordinates: planet.coordinates });
    branch = { ...branch, planets: [...branch.planets, planet] };
  }
  branch = { ...branch, research: { ...branch.research, levels: { ...branch.research.levels, astrophysics: 2 * count - 3 } } };
  const ids = branch.planets.map(planet => planet.id);
  const quote = quoteBuildingTemplateBatch(branch, templateId, ids);
  assert(quote.ok && quote.newCount === count * 2);
  const request = { templateId, expectedTemplateRevision: quote.templateRevision, expectedNextTaskId: quote.nextTaskId,
    expectedReviewKey: quote.reviewKey, planets: ids.map(planetId => ({ planetId,
      budgets: goldens.rows.map(row => ({ building: row.building, budget: { metal: '0', crystal: '0', deuterium: '0' } })) })) };
  const result = applyBuildingTemplateBatch(branch, request);
  assert(result.ok && result.createdTaskIds.length === count * 2);
  assert.deepEqual(result.state.planets, branch.planets);
  const raw = exportSave(branch, ready.savedAt), after = exportSave(result.state, ready.savedAt);
  assert.deepEqual(serializeState(deserializeState(importSave(raw).state)), serializeState(branch));
  assert.deepEqual(serializeState(deserializeState(importSave(after).state)), serializeState(result.state));
  const file = `synthetic-${count}-ready.json`, expectedFile = `synthetic-${count}-authorized.json`;
  writeFileSync(resolve(destination, file), raw, { flag: 'wx' });
  writeFileSync(resolve(destination, expectedFile), after, { flag: 'wx' });
  syntheticBoundaries.push({ count, classification: 'synthetic-legal-capacity-boundary; not-natural-colonization',
    provenance: { base: 'ready', addedPlanetsVia: 'createPlanet', extraPlanets: extras, stockGrants: [],
      directStatePatches: ['append public createPlanet results', `research.levels.astrophysics=${2 * count - 3}`] },
    planetIds: ids, request, file, sha256: hash(raw), expectedFile, expectedSha256: hash(after),
    ready: JSON.parse(raw), authorized: JSON.parse(after), expectedTaskCount: count * 2 });
}
const lifecycleVariants = {};
function branchSave(name, branch, actions) {
  const raw = exportSave(branch, ready.savedAt);
  assert.deepEqual(serializeState(deserializeState(importSave(raw).state)), serializeState(branch));
  const file = `${name}.json`; writeFileSync(resolve(destination, file), raw, { flag: 'wx' });
  lifecycleVariants[name] = { file, sha256: hash(raw), envelope: JSON.parse(raw), actions,
    classification: 'public-API-branch-from-independent-natural-ready-source; not-browser-evidence' };
}
const readyState = deserializeState(ready.state);
const renamedDraft = { ...templateDraft, name: '已改名双星仓储验收' };
const renamed = editBuildingTemplate(readyState, templateId, 1, renamedDraft);
assert(renamed.ok);
branchSave('renamed', renamed.state, [{ api: 'editBuildingTemplate', templateId, expectedTemplateRevision: 1, draft: renamedDraft }]);
const deleted = deleteBuildingTemplate(readyState, templateId, 1);
assert(deleted.ok);
branchSave('deleted', deleted.state, [{ api: 'deleteBuildingTemplate', templateId, expectedTemplateRevision: 1 }]);
let capacity = readyState;
const capacityActions = [];
outer: for (const planet of readyState.planets) for (const building of Object.keys(planet.buildings)) {
  if (building === 'metal_storage' || building === 'deuterium_tank') continue;
  const request = { kind: 'building', planetId: planet.id, building, targetLevel: planet.buildings[building] + 1,
    expectedNextTaskId: capacity.orders.nextTaskId, budget: { metal: '0', crystal: '0', deuterium: '0' }, transport: null };
  const beforeSha256 = hash(json(serializeState(capacity))), result = createOrderTask(capacity, request);
  assert(result.ok, result.reason); capacity = result.state;
  capacityActions.push({ api: 'createOrderTask', request, beforeSha256, afterSha256: hash(json(serializeState(capacity))) });
  const paused = pauseOrderTask(capacity, request.expectedNextTaskId); assert(paused.ok); capacity = paused.state;
  capacityActions.push({ api: 'pauseOrderTask', taskId: request.expectedNextTaskId, afterSha256: hash(json(serializeState(capacity))) });
  if (capacity.orders.tasks.length === 29) break outer;
}
assert.equal(capacity.orders.tasks.length, 29);
assert(!quoteBuildingTemplateBatch(capacity, templateId, [homeId, colonyId]).ok);
branchSave('capacity-blocked', capacity, capacityActions);
const selected = selectPlanet(readyState, colonyId);
const selectedResult = applyBuildingTemplateBatch(selected, request); assert(selectedResult.ok);
branchSave('selected-colony-authorized', selectedResult.state, [{ api: 'selectPlanet', planetId: colonyId }, { api: 'applyBuildingTemplateBatch', request }]);
const report = {
  schema: 'infinity-building-batch-natural-fixture-v1', status: 'passed',
  classification: 'independent-natural-domain-route-with-compressed-logical-seconds; not-native-browser-evidence',
  provenance, initialStateSha256, logicalSeconds, key: STORAGE_KEY, homeId, colonyId, planetIds: [homeId, colonyId], templateId,
  templateDraft, goldens, flightQuote, ready, authorized, paid, completed, noReplay, syntheticBoundaries, lifecycleVariants, request, batchQuote, negativeResults, batchPaidJobs, checkpoints, receipts, paidJobs: [...jobs.values()],
  readyEconomies,
};
assert.equal(jobs.size, state.orders.nextJobId - 1, 'Every naturally paid route job must have a receipt');
writeFileSync(resolve(destination, 'fixture.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ status: report.status, out: destination, logicalSeconds, planets: report.planetIds, actions: receipts.length, paidJobs: jobs.size, initialStateSha256, fixtureSha256: hash(readFileSync(resolve(destination, 'fixture.json'))) }) + '\n');
