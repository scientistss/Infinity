#!/usr/bin/env node
/** Fixed solar transcript replay. Domain expected states only, never native evidence.
 * node --import tsx scripts/energy-challenge-solar-oracle.mjs --natural REPORT --out DIR
 * Starts with createInitialState(20261013, 20261013). No supplied state is adopted;
 * only locally generated SaveSession write/readbacks replace the replay state.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInitialState } from '../src/game/state.ts';
import { activePlanet } from '../src/game/empire.ts';
import { economy, energyDemand } from '../src/game/economy.ts';
import { enqueue, queueCapacity } from '../src/game/queue.ts';
import { enqueueResearch, researchCapacity } from '../src/game/research.ts';
import { tick, expansionScore, warpGain } from '../src/game/logic.ts';
import { quoteEnergyChallenge, enterEnergyChallenge, finishEnergyChallenge } from '../src/game/energy-challenge.ts';
import { serializeState, exportSave } from '../src/game/save.ts';
import { SaveSession } from '../src/game/save-session.ts';
import { STORAGE_KEY } from '../src/game/content.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SEED = 20261013, EPOCH = Date.UTC(2026, 9, 13);
export const FIXED = Object.freeze({ createInitialState: 1, tick: 4201, enqueue: 149, enqueueResearch: 4, challengeCandidate: 2, checkpoint: 22, reject: 4 });
export const ROW_COUNT = 4383;
const RES = ['metal', 'crystal', 'deuterium'];
const plain = x => JSON.parse(JSON.stringify(x));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const canonical = value => JSON.stringify(sort(value));
const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
function original(path, maximum = 64 * 1024 * 1024) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink(), `Ordinary original required: ${path}`);
  assert(stat.size <= maximum, `Original exceeds bounded bytes: ${path}`); return readFileSync(path);
}
function ref(path, maximum) { const raw = original(path, maximum); return { file: resolve(path), sha256: sha(raw), bytes: raw.length }; }
function readRef(root, value) {
  assert(value && typeof value.file === 'string' && !isAbsolute(value.file) && !value.file.split(/[\\/]/).includes('..'));
  const path = resolve(root, value.file); assert(!relative(root, path).startsWith('..' + sep));
  const raw = original(path); assert.equal(sha(raw), value.sha256, `Changed natural original: ${value.file}`);
  if (value.bytes !== undefined) assert.equal(raw.length, value.bytes); return { path, raw };
}
function summary(state, seconds) {
  const p = activePlanet(state), e = economy(state), money = x => Object.fromEntries(RES.map(key => [key, x[key].toString()]));
  return { logicalSeconds: seconds, totalTime: state.totalTime.toString(), wallets: { [p.id]: money(p.resources) },
    lifetime: money(state.lifetime), launches: state.stats.launches, warpCores: state.warpCores.toString(), expansionScore: expansionScore(state).toString(), warpGain: warpGain(state).toString(),
    nextJobId: state.orders.nextJobId, buildingCapacity: queueCapacity(state), researchCapacity: researchCapacity(state),
    challenge: plain(state.energyChallenge), buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, satellites: p.units.solar_satellite,
    researchLevels: { ...state.research.levels }, buildingQueue: plain(p.buildQueue), researchQueue: plain(state.research.queue), shipyardQueue: plain(p.shipyardQueue),
    energy: { supply: e.supply, demand: e.demand, ordinaryDemand: energyDemand(p), efficiency: e.efficiency } };
}
export function validateFixedReceipts(events) {
  assert(Array.isArray(events) && events.length === ROW_COUNT, 'Exact fixed 4383-event solar transcript required');
  const counts = {};
  for (const [i, event] of events.entries()) {
    assert(event && event.index === i + 1 && Object.hasOwn(FIXED, event.api), 'Missing, reordered or unsupported event');
    counts[event.api] = (counts[event.api] ?? 0) + 1;
    const r = event.request; assert(r && typeof r === 'object');
    if (event.api === 'tick') assert.deepEqual(r, { dt: 1, mode: 'live', reason: r.reason });
    else if (event.api === 'createInitialState') { assert.equal(i, 0); assert.deepEqual(r, { worldSeed: SEED, arcadeSeed: SEED }); assert.equal(event.before, null); }
    else if (event.api === 'enqueue' || event.api === 'enqueueResearch') { assert.equal(r.source, 'manual'); assert.equal(r.count, null); assert.equal(typeof r.target, 'string'); }
    else if (event.api === 'checkpoint') { assert.equal(r.appliedSeconds, 0); assert.equal(r.adoptsReader, true); assert.notEqual(r.name, 'abandoned'); }
    else if (event.api === 'reject') assert(['enterEnergyChallenge', 'finishEnergyChallenge', 'enqueue', 'enqueueResearch'].includes(r.api));
  }
  assert.deepEqual(counts, FIXED, 'Fixed action census cannot be replaced by another route');
  assert.deepEqual(events.filter(e => e.api === 'challengeCandidate').map(e => e.request), [{ action: 'enter' }, { action: 'finish' }]);
  assert.deepEqual(events.filter(e => e.api === 'reject').map(e => e.request.api), ['enterEnergyChallenge', 'finishEnergyChallenge', 'enqueue', 'enqueueResearch']);
  assert.equal(new Set(events.filter(e => e.api === 'checkpoint').map(e => e.request.name)).size, 22);
  assert.equal(events.at(-1).api, 'checkpoint'); assert.equal(events.at(-1).request.name, 'third-research-completed');
  return counts;
}
export function loadNatural(naturalPath) {
  naturalPath = resolve(naturalPath); const directory = dirname(naturalPath), raw = original(naturalPath, 16 * 1024 * 1024), report = JSON.parse(raw);
  assert.equal(report.schema, 'energy-challenge-natural-v1'); assert.equal(report.status, 'passed');
  assert.equal(report.sourceClassification, 'clean-candidate-source'); assert.deepEqual(report.dirtyPaths, []);
  assert.equal(report.sourceSha, git('rev-parse', 'HEAD')); assert.equal(report.sourceTree, git('rev-parse', 'HEAD^{tree}'));
  assert.equal(report.nodeVersion, process.version, 'Actual natural/oracle runtimes must match; no relabeling');
  assert.deepEqual(report.sourceInput, { kind: 'createInitialState', worldSeed: SEED, arcadeSeed: SEED, importedSaves: [], importedReports: [], stockGrants: [], directStatePatches: [] });
  assert.equal(sha(canonical(report.sourceFiles)), report.sourceManifestSha256);
  for (const file of report.sourceFiles) { assert(!isAbsolute(file.path) && !file.path.split('/').includes('..')); assert.equal(sha(original(resolve(ROOT, file.path))), file.sha256, `Source changed: ${file.path}`); }
  const solar = report.routes.filter(row => row.policy === 'solar'); assert.equal(solar.length, 1);
  const route = solar[0]; assert.equal(route.status, 'passed'); assert.equal(route.totalLogicalSeconds, 4201);
  assert.equal(route.replay.status, 'passed'); assert.equal(route.replay.eventCount, ROW_COUNT);
  const receipts = readRef(directory, route.receipts), initial = readRef(directory, route.checkpoints.initial), events = JSON.parse(receipts.raw);
  validateFixedReceipts(events);
  assert.equal(initial.raw.toString('utf8'), exportSave(createInitialState(SEED, SEED), EPOCH, EPOCH), 'Only byte-exact newly constructed initial save is allowed');
  return { naturalPath, directory, report, route, events, receipts, initial };
}
/** Sink receives complete serialized states. Expected input bytes never feed state. */
export function replaySolar(input, sink) {
  validateFixedReceipts(input.events);
  let state = createInitialState(SEED, SEED), seconds = 0, candidate = null;
  const map = new Map(), store = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
  let session = new SaveSession(store, EPOCH), rows = 0;
  for (const event of input.events) {
    if (event.before !== null) assert.deepEqual(summary(state, seconds), event.before, `Complete recorded before summary ${event.index}`);
    const r = event.request, row = { index: event.index };
    assert(!candidate || event.api === 'checkpoint', 'A challenge candidate must be adopted only by its next real checkpoint');
    if (event.api === 'tick') { state = tick(state, 1, 'live'); seconds++; }
    else if (event.api === 'enqueue' || event.api === 'enqueueResearch') {
      const result = event.api === 'enqueue' ? enqueue(state, r.target, 'manual') : enqueueResearch(state, r.target, 'manual');
      assert(result.ok, result.reason); assert.equal(result.jobId, event.payment.jobId); state = result.state;
      assert.equal(state.orders.nextJobId, result.jobId + 1);
    } else if (event.api === 'challengeCandidate') {
      const quote = quoteEnergyChallenge(state, r.action); assert.deepEqual(plain(quote), event.quote);
      const operation = r.action === 'enter' ? enterEnergyChallenge : finishEnergyChallenge;
      const result = operation(state, quote); assert(result.ok, result.reason); candidate = result.state;
      assert.deepEqual(summary(candidate, seconds), event.candidate);
      row.candidate = serializeState(candidate);
      const duplicate = operation(state, quote); assert(!duplicate.ok && duplicate.state === state, 'One-use quote must reject a duplicate');
    } else if (event.api === 'checkpoint') {
      const now = EPOCH + seconds * 1000, cp = input.route.checkpoints[r.name]; assert(cp && cp.eventIndex === event.index);
      assert.equal(r.file, cp.file); assert(session.save(candidate ?? state, now, now).ok);
      session = new SaveSession(store, now); assert.equal(session.mode, 'ready'); assert.equal(session.loaded.appliedSeconds, 0);
      state = session.loaded.state; candidate = null;
      const raw = store.getItem(STORAGE_KEY); assert.equal(typeof raw, 'string');
      assert.equal(raw, readRef(input.directory, cp).raw.toString('utf8'), `Exact independently reproduced checkpoint ${r.name}`);
      assert.equal(sha(canonical(serializeState(state))), cp.stateSha256); assert.equal(cp.stateSha256, event.stateSha256);
      row.raw = raw;
    } else if (event.api === 'reject') {
      let result;
      if (r.api === 'enqueue') result = enqueue(state, r.building, 'manual');
      else if (r.api === 'enqueueResearch') result = enqueueResearch(state, r.tech, 'manual');
      else { const action = r.api === 'enterEnergyChallenge' ? 'enter' : 'finish', quote = quoteEnergyChallenge(state, action); result = action === 'enter' ? enterEnergyChallenge(state, quote) : finishEnergyChallenge(state, quote); }
      assert(!result.ok && result.state === state); assert.equal(result.reason, event.reason);
    } else { assert.equal(event.api, 'createInitialState'); assert.equal(event.index, 1); }
    assert.deepEqual(summary(state, seconds), event.after, `Complete recorded after summary ${event.index}`);
    row.state = serializeState(state); sink(row); rows++;
  }
  assert.equal(candidate, null); assert.equal(seconds, 4201); assert.equal(rows, ROW_COUNT);
  assert.equal(state.manualClicks, 0); assert.equal(state.stats.automatedLaunches, 0);
  assert.equal(sha(canonical(serializeState(state))), input.route.replay.finalStateSha256);
  return { rows, logicalSeconds: seconds, finalStateSha256: input.route.replay.finalStateSha256 };
}
export function produce(naturalPath, out) {
  out = resolve(out); assert(!existsSync(out), 'New output directory required; no overwrite');
  assert(!out.startsWith(ROOT + sep), 'Evidence output must stay outside the clean source checkout');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'Clean exact source is mandatory');
  const input = loadNatural(naturalPath), producerBefore = sha(original(fileURLToPath(import.meta.url)));
  execFileSync('python', [resolve(ROOT, 'scripts/check-energy-challenge-natural.py'), '--fixture', input.directory, '--require-clean'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  mkdirSync(out); const statesPath = resolve(out, 'expected-states.jsonl'), fd = openSync(statesPath, 'wx');
  let result; try { result = replaySolar(input, row => writeSync(fd, JSON.stringify(row) + '\n')); } finally { closeSync(fd); }
  assert.equal(sha(original(fileURLToPath(import.meta.url))), producerBefore);
  assert.equal(git('rev-parse', 'HEAD'), input.report.sourceSha); assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
  loadNatural(naturalPath); // Reopen source and all primary input identities after execution.
  const manifest = { schema: 'infinity-energy-challenge-solar-oracle-v1', status: 'prepared',
    classification: 'fixed-fresh-seed-domain-replay-expected-states-not-native-evidence',
    sourceSha: input.report.sourceSha, sourceTree: input.report.sourceTree, runtimeNode: process.version,
    sourceClassification: 'clean-candidate-source', dirtyPaths: [],
    producer: { path: 'scripts/energy-challenge-solar-oracle.mjs', sha256: producerBefore },
    naturalReport: ref(input.naturalPath), receipts: ref(input.receipts.path), initial: ref(input.initial.path), expectedStates: ref(statesPath, 256 * 1024 * 1024),
    census: FIXED, ...result, provenance: { inputStateAdoptions: 0, initialStateConstructor: 'createInitialState(20261013,20261013)',
      onlyAdoptions: 'locally generated SaveSession write/readback at the original 22 checkpoints', expectedStatesNeverSuppliedToCandidate: true, importedPlayerSaves: [], injectedState: [] } };
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); assert.deepEqual([args[0], args[2]], ['--natural', '--out']); assert.equal(args.length, 4);
  const manifest = produce(args[1], args[3]); console.log(JSON.stringify({ status: manifest.status, rows: manifest.rows, manifest: resolve(args[3], 'manifest.json') }));
}
