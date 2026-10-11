/** Genuine fixed-ca5 r11 serializer evidence. No current game modules are imported. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b';
const SOURCE_TREE = '3dd991030aa0d2448dc854f7f90de4fd1d18b7a4';
const ORIGIN_SHA = 'd456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a';
const PROVENANCE_SHA = 'a1a8ce7985030f6a8e500755eda4d908c8834b3ecfa888197d5ef5ed8ef27f69';
const hash = value => createHash('sha256').update(value).digest('hex');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert.ok(['--source-root', '--out'].includes(key) && value && !args.has(key), 'Exact source root and new output required');
  args.set(key, value);
}
assert.equal(args.size, 2);
assert.ok(isAbsolute(args.get('--source-root')) && isAbsolute(args.get('--out')));
const root = realpathSync(args.get('--source-root'));
const output = resolve(args.get('--out'));
assert.ok(!existsSync(output), 'Never overwrite prior evidence');
const destinationParent = realpathSync(dirname(output));
assert.ok(destinationParent.startsWith('/tmp/'), 'Generate under a new temporary evidence directory');
const git = (...parts) => execFileSync('git', ['-C', root, ...parts], { encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', '--show-toplevel'), root);
assert.equal(git('rev-parse', 'HEAD'), SOURCE);
assert.equal(git('rev-parse', 'HEAD:src'), SOURCE_TREE);
git('diff', '--exit-code', SOURCE, '--', 'src', 'scripts', 'tests/fixtures', 'package.json', 'package-lock.json');
assert.equal(git('ls-files', '--others', '--', 'src'), '');
const loader = join(root, 'node_modules/tsx/dist/loader.mjs');
const load = name => import(pathToFileURL(join(root, `src/game/${name}.ts`)).href);
const [save, state, content] = await Promise.all(['save', 'state', 'content'].map(load));
assert.equal(content.SAVE_REVISION, 11);
assert.equal(content.SAVE_VERSION, 9);
const provenance = join(root, 'tests/fixtures/demolition-origin-provenance.json');
const origin = readFileSync(join(root, 'tests/fixtures/demolition-origin-r10-save.json'), 'utf8');
assert.equal(hash(origin), ORIGIN_SHA);
assert.equal(hash(readFileSync(provenance)), PROVENANCE_SHA);
const run = (script, flags = []) => JSON.parse(execFileSync(process.execPath,
  ['--import', loader, join(root, script), ...flags],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'GITHUB_SHA')) }));
const natural = run('scripts/demolition-natural-growth.ts', ['--origin', provenance, '--expected-origin-sha256', PROVENANCE_SHA]);
assert.equal(natural.outcome.status, 'passed');
assert.equal(natural.source.sourceSha, SOURCE);
assert.equal(natural.source.sourceScopeStatusPorcelain, '');
const partial = natural.milestones.filter(row => row.name === 'partialFiveSeconds');
assert.equal(partial.length, 1);
assert.equal(partial[0].save.state.planets.find(p => p.id === 'homeworld').demolition.jobId, 203);
const rich = run('scripts/render-scheduling-fixture.ts');
const rows = [];
function add(id, input, synthetic, naturalProgression, generationDescription) {
  const source = typeof input === 'string' ? save.importSave(input) : input;
  assert.equal(source.revision, 11);
  const raw = save.exportSave(save.deserializeState(source.state), source.savedAt, source.lastTickAt);
  const oldReaderOutput = save.importSave(raw);
  const oldReaderRaw = JSON.stringify(oldReaderOutput);
  assert.equal(save.exportSave(save.deserializeState(oldReaderOutput.state), source.savedAt, source.lastTickAt), raw);
  assert.equal(Object.hasOwn(oldReaderOutput.state, 'npcEconomy'), false);
  rows.push({ id, synthetic, naturalProgression, generationMode: 'unmodified-r11-serializer-output',
    generationDescription, raw, rawBytes: Buffer.byteLength(raw), rawSha256: hash(raw),
    oldReaderRaw, oldReaderSha256: hash(oldReaderRaw), oldReaderOutput });
}
add('fresh', save.importSave(save.exportSave(state.createInitialState(20261010, 20261010), 1791590400000)),
  true, false, 'Deterministic ordinary new-game constructor; no resource or technology edits.');
add('partial-demolition-earned-grants', partial[0].save, false, true,
  'Actual fixed-ca5 natural demolition route, paid job203 after five seconds; original r10 earned grants retained.');
add('rich-paid-authorized', rich.save, true, false,
  'Existing fixed-ca5 moderate synthetic setup with actual paid queue/plan/fleet/template/formation/ticket APIs.');
add('natural-r11-adoption', save.importSave(origin), false, true,
  'Unchanged original ac3 r10 raw bytes adopted only through actual ca5 reader and serializer; no tick or injected state.');
const sourceFiles = ['src/game/save.ts', 'src/game/state.ts', 'scripts/demolition-natural-growth.ts',
  'scripts/render-scheduling-fixture.ts', 'package.json', 'package-lock.json'];
const result = { schema: 'infinity-npc-r11-source-fixtures-v1', sourceSha: SOURCE,
  sourceTree: SOURCE_TREE, sourceVersion: '0.6.18-alpha.1', sourceRevision: 11,
  sourceFiles: sourceFiles.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) })),
  producer: { path: 'scripts/npc-economy-r11-fixture.mjs', sha256: hash(readFileSync(fileURLToPath(import.meta.url))) },
  originalNaturalSaveSha256: ORIGIN_SHA, originalNaturalProvenanceSha256: PROVENANCE_SHA,
  boundary: 'Anonymous engineering inputs generated by the exact historical source, not user saves or a native/browser acceptance claim.', rows };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ sourceSha: SOURCE, rows: rows.length, sha256: hash(readFileSync(output)),
  bytes: readFileSync(output).length, result: 'passed' }) + '\n');
