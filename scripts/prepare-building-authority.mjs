/** Build isolated real-browser before/after component fixtures with locked esbuild.
 * node scripts/prepare-building-authority.mjs [--source ROOT] [--output DIRECTORY]
 * Production source is read-only. No hooks are inserted into the app bundle.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
for (let i = 0; i < args.length; i += 2) assert.ok(['--source', '--output'].includes(args[i]) && args[i + 1], 'Unknown or incomplete argument');
const source = resolve(option('--source', root));
const output = resolve(option('--output', resolve(root, 'building-authority-build')));
assert.ok(output !== source && !source.startsWith(output + '/'), 'Output must not contain source');
for (const production of [resolve(root, 'dist'), resolve(source, 'dist')]) {
  assert.ok(output !== production && !output.startsWith(production + '/'), 'Component harness must remain outside production dist');
}
const fixture = resolve(root, 'tests/fixtures/building-template-authority');
const read = file => readFileSync(file);
const sha = raw => createHash('sha256').update(raw).digest('hex');
const manifest = JSON.parse(read(resolve(fixture, 'manifest.json')));
const panelPath = 'src/ui/building-templates-panel.ts';
const beforePanel = read(resolve(fixture, 'before-panel.ts.txt'));
const panelRow = manifest.files.find(file => file.path === panelPath);
assert.equal(sha(beforePanel), panelRow.before_sha256, 'Exact reconstructed vulnerable panel');
assert.equal(sha(read(resolve(fixture, 'authority-hardening.patch'))), manifest.patch_sha256, 'Exact recorded repair');
const reconstruction = mkdtempSync(resolve(tmpdir(), 'building-authority-'));
try {
  const destination = resolve(reconstruction, panelPath);
  mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, beforePanel);
  execFileSync('git', ['apply', '--include=' + panelPath, resolve(fixture, 'authority-hardening.patch')], {cwd: reconstruction});
  assert.equal(sha(read(destination)), panelRow.after_sha256, 'Recorded patch transforms exact baseline into exact repair');
} finally { rmSync(reconstruction, {recursive: true, force: true}); }
// These three files are the runtime panel boundary. Integration-only files are
// recorded below too, but need not match when unrelated integration develops.
for (const path of [panelPath, 'src/ui/building-templates-present.ts', 'src/ui/building-templates.css']) {
  assert.equal(sha(read(resolve(source, path))), manifest.files.find(file => file.path === path).after_sha256, 'Pinned repaired runtime source: ' + path);
}
const require = createRequire(resolve(source, 'package.json'));
const esbuild = require('esbuild');
const lock = JSON.parse(read(resolve(source, 'package-lock.json')));
assert.equal(esbuild.version, lock.packages['node_modules/esbuild'].version, 'Use already-locked esbuild');
let sourceCommit = null;
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8'}).trim(); } catch { /* File hashes remain authoritative. */ }
const evidence = {
  classification: 'Isolated synthetic component test; real browser DOM, real panel and domain reducers. Not whole-app or SaveSession acceptance.',
  baseline: 'Reconstructed actual pre-repair candidate, expected vulnerable. Not a released Git version or historical runtime result.',
  sourceCommit, esbuildVersion: esbuild.version, provenance: manifest,
  observedSixFileHashes: manifest.files.map(file => ({path: file.path, sha256: sha(read(resolve(source, file.path)))})),
  lockSha256: sha(read(resolve(source, 'package-lock.json'))),
  runnerSha256: sha(read(resolve(root, 'scripts/browser-building-authority.py'))),
  prepareSha256: sha(read(fileURLToPath(import.meta.url))),
  variants: {},
};
mkdirSync(output, {recursive: true});
for (const variant of ['before', 'after']) {
  const destination = resolve(output, variant);
  mkdirSync(destination, {recursive: true});
  const inputs = new Map();
  const result = await esbuild.build({
    absWorkingDir: source, entryPoints: [resolve(root, 'scripts/building-authority-harness.ts')],
    outfile: resolve(destination, 'component.js'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    metafile: true, sourcemap: false, write: false,
    plugins: [{name: 'exact-component-sources', setup(build) {
      build.onResolve({filter: /^\.\.\/src\//}, arg => {
        if (arg.importer === resolve(root, 'scripts/building-authority-harness.ts')) return {path: resolve(source, arg.path.replace('../', '')) + '.ts'};
      });
      build.onLoad({filter: /\.(ts|js|json|css)$/}, arg => {
        const replacement = variant === 'before' && arg.path === resolve(source, panelPath);
        const raw = replacement ? beforePanel : read(arg.path);
        const label = arg.path === resolve(root, 'scripts/building-authority-harness.ts') ? 'scripts/building-authority-harness.ts' : relative(source, arg.path).replaceAll('\\', '/');
        inputs.set(label, {path: label, sha256: sha(raw), bytes: raw.length, ...(replacement ? {origin: 'pinned-before-panel'} : {})});
        return {contents: raw, loader: arg.path.endsWith('.ts') ? 'ts' : arg.path.endsWith('.css') ? 'css' : arg.path.endsWith('.json') ? 'json' : 'js', resolveDir: dirname(arg.path)};
      });
    }}],
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    const full = resolve(source, input);
    const label = full === resolve(root, 'scripts/building-authority-harness.ts') ? 'scripts/building-authority-harness.ts' : relative(source, full).replaceAll('\\', '/');
    assert.ok(inputs.has(label), 'Every bundled input has a source hash: ' + label);
  }
  const files = result.outputFiles.map(file => {
    writeFileSync(file.path, file.contents);
    return {path: relative(destination, file.path), sha256: sha(file.contents), bytes: file.contents.length};
  });
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Building authority component regression</title><link rel="stylesheet" href="component.css"><h1>Isolated synthetic component regression</h1><p>Real panel and domain reducers. No whole-app or SaveSession recovery claim.</p><main id="component"></main><script type="module" src="component.js"></script></html>\n';
  writeFileSync(resolve(destination, 'index.html'), html);
  files.push({path: 'index.html', sha256: sha(html), bytes: Buffer.byteLength(html)});
  assert.equal(inputs.get(panelPath)?.sha256, variant === 'before' ? panelRow.before_sha256 : panelRow.after_sha256);
  evidence.variants[variant] = {files, inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path))};
}
const beforeInputs = evidence.variants.before.inputs, afterInputs = evidence.variants.after.inputs;
assert.equal(beforeInputs.length, afterInputs.length);
assert.deepEqual(beforeInputs.filter(row => row.path !== panelPath), afterInputs.filter(row => row.path !== panelPath), 'Only the exact repaired panel differs between runtime variants');
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({prepared: true, output, beforePanelSha256: panelRow.before_sha256, afterPanelSha256: panelRow.after_sha256, inputs: beforeInputs.length, browserExecuted: false}));
