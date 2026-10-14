#!/usr/bin/env node
/** Package a test-only browser domain reference; never execute the game in Node.
 * node scripts/energy-challenge-solar-browser-reference.mjs --natural REPORT --out DIR
 * The browser receives only action-tape.json. All natural outcomes stay outside it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build, version as esbuildVersion } from 'esbuild';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRY = 'scripts/energy-challenge-solar-browser-reference.ts';
export const PRODUCER = 'scripts/energy-challenge-solar-browser-reference.mjs';
export const FIXED = Object.freeze({ createInitialState: 1, tick: 4201, enqueue: 149, enqueueResearch: 4, challengeCandidate: 2, checkpoint: 22, reject: 4 });
export const ROW_COUNT = 4383, SEED = 20261013, EPOCH = 1791849600000;
export const ACTION_TAPE_SHA256 = '8aa4f1042249670115af3c9de4436e147a32c94e2670bcd80ba68a2aec6a9f2f';
export const OPTIONS = Object.freeze({ entryPoints: [ENTRY], outfile: 'browser-reference.js', bundle: true, platform: 'browser', format: 'iife', globalName: 'InfinitySolarReference', target: 'es2022', minify: false, sourcemap: false, sourcesContent: false, legalComments: 'none', charset: 'utf8', treeShaking: true, preserveSymlinks: true, tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } }, metafile: true, write: false, logLevel: 'silent' });
const STAGES = ['first-curvature', 'challenge-proof', 'challenge-growth', 'reward-building', 'reward-research'];
const BUILDINGS = ['metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant', 'robotics_factory', 'research_lab', 'metal_storage', 'crystal_storage'];
const TECHS = ['energy_tech', 'computer_tech', 'combustion_drive'];
const CHECKPOINTS = ['initial', 'entry-ready', 'entered', 'proof-metal_mine-paid', 'proof-solar_plant-paid', 'proof-metal_mine-completed', 'proof-solar_plant-completed', 'proof-crystal_mine-paid', 'proof-deuterium_synth-paid', 'proof-crystal_mine-completed', 'proof-deuterium_synth-completed', 'active-progress', 'finish-ready', 'completed', 'before-third-build-paid', 'third-build-paid', 'third-build-paid-reloaded', 'third-build-completed', 'before-third-research-paid', 'third-research-paid', 'third-research-paid-reloaded', 'third-research-completed'];
export const sha = value => createHash('sha256').update(value).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const canonical = value => JSON.stringify(sorted(value));
const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
function original(path, maximum = 256 * 1024 * 1024) {
  const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink(), `Ordinary original required: ${path}`);
  assert(stat.size <= maximum, `Original exceeds bounded bytes: ${path}`); return readFileSync(path);
}
function reference(path, file = resolve(path)) { const raw = original(path); return { file, sha256: sha(raw), bytes: raw.length }; }
function safePath(root, name) {
  assert(typeof name === 'string' && name && !isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'Safe relative input required');
  const path = resolve(root, name); assert(!relative(root, path).startsWith('..' + sep)); return path;
}
function readRef(root, value) {
  const path = safePath(root, value.file), raw = original(path); assert.equal(sha(raw), value.sha256, `Changed natural original: ${value.file}`);
  if (value.bytes !== undefined) assert.equal(raw.length, value.bytes); return { path, raw };
}
function object(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, 'Plain object required');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort(), 'Exact action request field whitelist required');
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); assert(d.enumerable && Object.hasOwn(d, 'value'), 'Only own enumerable data fields allowed'); }
}
/** Expectations in natural receipts are deliberately neither copied nor consulted. */
export function projectActionTape(events) {
  assert(Array.isArray(events) && events.length === ROW_COUNT, 'Exact fixed 4383 events required');
  const counts = {}, checkpoints = [], challenges = [], rejections = [];
  const tape = events.map((event, i) => {
    assert(event && typeof event === 'object' && !Array.isArray(event));
    for (const key of ['index', 'stage', 'api', 'request']) { const d = Object.getOwnPropertyDescriptor(event, key); assert(d && d.enumerable && Object.hasOwn(d, 'value'), 'Own action data fields required'); }
    const { index, stage, api, request: r } = event;
    assert.equal(index, i + 1); assert(STAGES.includes(stage)); assert(Object.hasOwn(FIXED, api)); counts[api] = (counts[api] ?? 0) + 1;
    if (api === 'createInitialState') { object(r, ['worldSeed', 'arcadeSeed']); assert.equal(i, 0); assert.deepEqual(r, { worldSeed: SEED, arcadeSeed: SEED }); }
    else if (api === 'tick') { object(r, ['dt', 'mode', 'reason']); assert.equal(r.dt, 1); assert.equal(r.mode, 'live'); assert.equal(typeof r.reason, 'string'); }
    else if (api === 'enqueue' || api === 'enqueueResearch') {
      object(r, ['target', 'source', 'count', 'label']); assert.equal(r.source, 'manual'); assert.equal(r.count, null);
      assert((api === 'enqueue' ? BUILDINGS : TECHS).includes(r.target)); assert(r.label === null || r.label === (api === 'enqueue' ? 'third-building-proof' : 'third-research-proof'));
    } else if (api === 'challengeCandidate') { object(r, ['action']); challenges.push(r.action); }
    else if (api === 'checkpoint') {
      object(r, ['name', 'file', 'appliedSeconds', 'adoptsReader']); assert.equal(typeof r.name, 'string'); assert.equal(r.file, `solar/${r.name}.json`);
      assert.equal(r.appliedSeconds, 0); assert.equal(r.adoptsReader, true); checkpoints.push(r.name);
    } else {
      assert(r && typeof r === 'object');
      if (r.api === 'enterEnergyChallenge' || r.api === 'finishEnergyChallenge') { object(r, ['api', 'freshQuote']); assert.equal(r.freshQuote, true); }
      else if (r.api === 'enqueue') { object(r, ['api', 'building', 'fourth']); assert.equal(r.building, 'deuterium_synth'); assert.equal(r.fourth, true); }
      else { object(r, ['api', 'tech', 'fourth']); assert.equal(r.api, 'enqueueResearch'); assert.equal(r.tech, 'computer_tech'); assert.equal(r.fourth, true); }
      rejections.push(r.api);
    }
    return { index, stage, api, request: JSON.parse(JSON.stringify(r)) };
  });
  assert.deepEqual(counts, FIXED); assert.deepEqual(checkpoints, CHECKPOINTS); assert.deepEqual(challenges, ['enter', 'finish']);
  assert.deepEqual(rejections, ['enterEnergyChallenge', 'finishEnergyChallenge', 'enqueue', 'enqueueResearch']);
  assert.equal(sha(canonical(tape)), ACTION_TAPE_SHA256, 'Frozen original action chronology required'); return tape;
}
export function loadNatural(naturalPath) {
  naturalPath = resolve(naturalPath); const directory = dirname(naturalPath), raw = original(naturalPath, 16 * 1024 * 1024), report = JSON.parse(raw);
  assert.equal(report.schema, 'energy-challenge-natural-v1'); assert.equal(report.status, 'passed');
  assert.equal(report.sourceClassification, 'clean-candidate-source'); assert.deepEqual(report.dirtyPaths, []);
  assert.equal(report.sourceSha, git('rev-parse', 'HEAD')); assert.equal(report.sourceTree, git('rev-parse', 'HEAD^{tree}'));
  assert.equal(report.nodeVersion, process.version, 'Actual natural/packaging Node runtimes must match');
  assert.deepEqual(report.sourceInput, { kind: 'createInitialState', worldSeed: SEED, arcadeSeed: SEED, importedSaves: [], importedReports: [], stockGrants: [], directStatePatches: [] });
  assert.equal(sha(canonical(report.sourceFiles)), report.sourceManifestSha256);
  for (const file of report.sourceFiles) assert.equal(sha(original(safePath(ROOT, file.path))), file.sha256, `Source changed: ${file.path}`);
  const solar = report.routes.filter(row => row.policy === 'solar'); assert.equal(solar.length, 1);
  const route = solar[0]; assert.equal(route.status, 'passed'); assert.equal(route.totalLogicalSeconds, 4201); assert.equal(route.replay.status, 'passed'); assert.equal(route.replay.eventCount, ROW_COUNT);
  const receipts = readRef(directory, route.receipts), initial = readRef(directory, route.checkpoints.initial), tape = projectActionTape(JSON.parse(receipts.raw));
  return { naturalPath, directory, report, receipts, initial, tape };
}
/** All bundled source/dependency bytes and toolchain identity are carried, not guessed. */
export async function buildReference(out) {
  assert(!process.env.ESBUILD_BINARY_PATH, 'External esbuild binary override is forbidden');
  assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64', 'Fixed Linux x64 packaging toolchain required');
  const lockRaw = original(resolve(ROOT, 'package-lock.json')), lock = JSON.parse(lockRaw), require = createRequire(import.meta.url);
  const toolFiles = ['node_modules/esbuild/package.json', 'node_modules/esbuild/lib/main.js', 'node_modules/@esbuild/linux-x64/package.json', 'node_modules/@esbuild/linux-x64/bin/esbuild'];
  const toolchainFiles = toolFiles.map(path => ({ path, ...reference(resolve(ROOT, path), path) }));
  const esbuildPackage = JSON.parse(original(require.resolve('esbuild/package.json'))), platformPackage = JSON.parse(original(resolve(ROOT, toolFiles[2])));
  assert.equal(esbuildPackage.version, esbuildVersion); assert.equal(lock.packages['node_modules/esbuild'].version, esbuildVersion); assert.equal(platformPackage.version, esbuildVersion); assert.equal(lock.packages['node_modules/@esbuild/linux-x64'].version, esbuildVersion);
  const dependencyPackages = ['node_modules/break_infinity.js', 'node_modules/pad-end'].map(name => {
    const path = `${name}/package.json`, pkg = JSON.parse(original(resolve(ROOT, path)));
    assert.equal(pkg.version, lock.packages[name].version); return { path, ...reference(resolve(ROOT, path), path) };
  });
  const before = new Map();
  // Snapshot all allowed imports before bundling; the metafile later selects exact inputs.
  // Git's tracked inventory excludes node_modules, so dependency files are captured directly.
  const tracked = git('ls-files', 'src', ENTRY).split('\n').filter(Boolean);
  if (!tracked.includes(ENTRY)) tracked.push(ENTRY);
  for (const name of tracked) before.set(name, reference(resolve(ROOT, name), name));
  const decimalPath = 'node_modules/break_infinity.js/dist/break_infinity.esm.js', dependencyInputs = [decimalPath, 'node_modules/pad-end/index.js'];
  for (const path of dependencyInputs) before.set(path, reference(resolve(ROOT, path), path));
  const result = await build({ ...OPTIONS, absWorkingDir: ROOT });
  assert.equal(result.outputFiles.length, 1); assert.equal(result.outputFiles[0].path, resolve(ROOT, OPTIONS.outfile));
  const inputNames = Object.keys(result.metafile.inputs).sort(); assert(inputNames.includes(ENTRY) && inputNames.some(name => name.startsWith('src/game/')) && inputNames.includes(decimalPath));
  const inputs = inputNames.map(path => {
    assert(path === ENTRY || path.startsWith('src/') || dependencyInputs.includes(path), `Unexpected bundled input: ${path}`);
    const identity = reference(safePath(ROOT, path), path); assert.deepEqual(identity, before.get(path), `Input changed during bundle: ${path}`);
    assert.equal(identity.bytes, result.metafile.inputs[path].bytes); return { path, sha256: identity.sha256, bytes: identity.bytes, kind: path.startsWith('node_modules/') ? 'dependency' : 'source' };
  });
  for (const [name, input] of Object.entries(result.metafile.inputs)) for (const dependency of input.imports) {
    // esbuild records a value import used solely by `typeof` as external even
    // though it is erased. Its source must still be in the complete input set.
    const erasedLocal = dependency.external && dependency.kind === 'import-statement' && dependency.path.startsWith('.')
      && inputNames.includes(relative(ROOT, resolve(ROOT, dirname(name), dependency.path + '.ts')));
    assert(erasedLocal || (!dependency.external && inputNames.includes(dependency.path)), `No unresolved input: ${name}`);
  }
  for (const output of Object.values(result.metafile.outputs)) assert.equal(output.imports.length, 0, 'Browser bundle must be self-contained');
  for (const item of dependencyPackages) assert.equal(sha(original(resolve(ROOT, item.path))), item.sha256, 'Dependency manifest changed during packaging');
  const bundleRaw = Buffer.from(result.outputFiles[0].contents), metafileRaw = Buffer.from(JSON.stringify(result.metafile, null, 2) + '\n');
  assert(!existsSync(out)); mkdirSync(out);
  writeFileSync(resolve(out, 'browser-reference.js'), bundleRaw, { flag: 'wx' }); writeFileSync(resolve(out, 'metafile.json'), metafileRaw, { flag: 'wx' });
  assert.equal(sha(original(resolve(ROOT, 'package-lock.json'))), sha(lockRaw));
  for (const item of toolchainFiles) assert.equal(sha(original(resolve(ROOT, item.path))), item.sha256, 'Toolchain changed during packaging');
  return { bundle: reference(resolve(out, 'browser-reference.js'), 'browser-reference.js'), metafile: reference(resolve(out, 'metafile.json'), 'metafile.json'), inputs,
    inputManifestSha256: sha(canonical(inputs)), options: OPTIONS, optionsSha256: sha(canonical(OPTIONS)),
    toolchain: { node: process.version, platform: process.platform, arch: process.arch, esbuild: esbuildVersion,
      packageLock: reference(resolve(ROOT, 'package-lock.json'), 'package-lock.json'), files: toolchainFiles,
      lockedPackages: Object.fromEntries(['node_modules/esbuild', 'node_modules/@esbuild/linux-x64', 'node_modules/break_infinity.js', 'node_modules/pad-end'].map(key => [key, lock.packages[key]])),
      dependencyPackages } };
}
export async function produce(naturalPath, out) {
  out = resolve(out); assert(!existsSync(out), 'New output directory required'); assert(!out.startsWith(ROOT + sep), 'Evidence must remain outside source checkout');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'Exact clean source is mandatory');
  const input = loadNatural(naturalPath), producer = reference(resolve(ROOT, PRODUCER), PRODUCER), entry = reference(resolve(ROOT, ENTRY), ENTRY);
  execFileSync('python', [resolve(ROOT, 'scripts/check-energy-challenge-natural.py'), '--fixture', input.directory, '--require-clean'], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const packed = await buildReference(out), tapeRaw = canonical(input.tape);
  writeFileSync(resolve(out, 'action-tape.json'), tapeRaw, { flag: 'wx' });
  assert.deepEqual(reference(resolve(ROOT, PRODUCER), PRODUCER), producer); assert.deepEqual(reference(resolve(ROOT, ENTRY), ENTRY), entry);
  assert.equal(git('rev-parse', 'HEAD'), input.report.sourceSha); assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), ''); loadNatural(naturalPath);
  const manifest = { schema: 'infinity-energy-challenge-solar-browser-reference-package-v1', status: 'prepared',
    classification: 'test-only-same-browser-domain-reference-not-native-evidence', sourceSha: input.report.sourceSha, sourceTree: input.report.sourceTree,
    sourceClassification: 'clean-candidate-source', dirtyPaths: [], producer, entry,
    naturalReport: reference(input.naturalPath), naturalReceipts: reference(input.receipts.path), naturalInitial: reference(input.initial.path),
    actionTape: reference(resolve(out, 'action-tape.json'), 'action-tape.json'), actionTapeSha256: ACTION_TAPE_SHA256,
    census: FIXED, rows: ROW_COUNT, logicalSeconds: 4201, seed: SEED, epoch: EPOCH, ...packed,
    provenance: { browserInput: 'only strict original index/stage/api/request action projection', expectedStateInputs: 0, quoteInputs: 0, paymentInputs: 0, checkpointInputs: 0,
      initialStateConstructor: 'createInitialState(20261013,20261013)', onlyAdoptions: '22 own Map-backed SaveSession write/readbacks',
      productionImportsReference: false, sourceMathUnchanged: true, runtimeExecution: 'required later in a separate context of the exact native browser before native UI starts' } };
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); assert.deepEqual([args[0], args[2]], ['--natural', '--out']); assert.equal(args.length, 4);
  const manifest = await produce(args[1], args[3]); console.log(JSON.stringify({ status: manifest.status, rows: manifest.rows, manifest: resolve(args[3], 'manifest.json') }));
}
