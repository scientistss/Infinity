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
let afterPanel;
const historicalPresent = read(resolve(fixture, 'after-present.ts.txt'));
assert.equal(sha(historicalPresent), manifest.files.find(file => file.path === 'src/ui/building-templates-present.ts').after_sha256, 'Exact repaired historical presenter');
const reconstruction = mkdtempSync(resolve(tmpdir(), 'building-authority-'));
try {
  const destination = resolve(reconstruction, panelPath);
  mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, beforePanel);
  execFileSync('git', ['apply', '--include=' + panelPath, resolve(fixture, 'authority-hardening.patch')], {cwd: reconstruction});
  afterPanel = read(destination);
  assert.equal(sha(afterPanel), panelRow.after_sha256, 'Recorded patch transforms exact baseline into exact repair');
} finally { rmSync(reconstruction, {recursive: true, force: true}); }
// Preserve both recorded historical components and independently reconstruct the
// complete current delta. No old hash or old repair evidence is replaced.
const currentManifest = JSON.parse(read(resolve(fixture, 'current-manifest.json')));
const currentPatch = resolve(fixture, 'terraformer-current.patch');
assert.equal(sha(read(currentPatch)), currentManifest.patch_sha256, 'Exact current component delta');
const presentPath = 'src/ui/building-templates-present.ts';
const currentPanel = read(resolve(source, panelPath));
const currentPresent = read(resolve(source, presentPath));
const currentReconstruction = mkdtempSync(resolve(tmpdir(), 'building-current-authority-'));
try {
  for (const [path, before] of [[panelPath, afterPanel], [presentPath, historicalPresent]]) {
    const row = currentManifest.files.find(file => file.path === path);
    assert.equal(sha(before), row.before_sha256, 'Current delta begins at exact recorded repaired source');
    const destination = resolve(currentReconstruction, path);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, before);
  }
  execFileSync('git', ['apply', currentPatch], {cwd: currentReconstruction});
  for (const row of currentManifest.files) {
    assert.equal(sha(read(resolve(currentReconstruction, row.path))), row.after_sha256, 'Complete current patch reconstruction');
    assert.equal(sha(read(resolve(source, row.path))), row.after_sha256, 'Current runtime source matches complete audited delta');
  }
} finally { rmSync(currentReconstruction, {recursive: true, force: true}); }
assert.equal(sha(read(resolve(source, 'src/ui/building-templates.css'))), manifest.files.find(file => file.path === 'src/ui/building-templates.css').after_sha256, 'Historical CSS remains exact');
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
  currentDelta: currentManifest,
  observedSixFileHashes: manifest.files.map(file => ({path: file.path, sha256: sha(read(resolve(source, file.path)))})),
  lockSha256: sha(read(resolve(source, 'package-lock.json'))),
  runnerSha256: sha(read(resolve(root, 'scripts/browser-building-authority.py'))),
  prepareSha256: sha(read(fileURLToPath(import.meta.url))),
  variants: {},
};
mkdirSync(output, {recursive: true});
for (const variant of ['before', 'after', 'current']) {
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
        const panelReplacement = variant !== 'current' && arg.path === resolve(source, panelPath);
        const presentReplacement = variant !== 'current' && arg.path === resolve(source, presentPath);
        const raw = panelReplacement ? (variant === 'before' ? beforePanel : afterPanel) : presentReplacement ? historicalPresent : read(arg.path);
        const replacement = panelReplacement || presentReplacement;
        const label = arg.path === resolve(root, 'scripts/building-authority-harness.ts') ? 'scripts/building-authority-harness.ts' : relative(source, arg.path).replaceAll('\\', '/');
        inputs.set(label, {path: label, sha256: sha(raw), bytes: raw.length, ...(replacement ? {origin: 'pinned-historical-' + variant + '-component'} : {})});
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
  assert.equal(inputs.get(panelPath)?.sha256, variant === 'before' ? panelRow.before_sha256 : variant === 'after' ? panelRow.after_sha256 : sha(currentPanel));
  evidence.variants[variant] = {files, inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path))};
}
const beforeInputs = evidence.variants.before.inputs, afterInputs = evidence.variants.after.inputs;
assert.equal(beforeInputs.length, afterInputs.length);
assert.deepEqual(beforeInputs.filter(row => row.path !== panelPath).map(({origin, ...row}) => row), afterInputs.filter(row => row.path !== panelPath).map(({origin, ...row}) => row), 'Only the exact repaired panel differs between historical runtime variants');
const currentInputs = evidence.variants.current.inputs;
assert.equal(currentInputs.length, afterInputs.length);
const outsideDelta = rows => rows.filter(row => ![panelPath, presentPath].includes(row.path)).map(({origin, ...row}) => row);
assert.deepEqual(outsideDelta(currentInputs), outsideDelta(afterInputs), 'Current variant differs only at the two explicitly audited component files');
writeFileSync(resolve(output, 'provenance.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({prepared: true, output, beforePanelSha256: panelRow.before_sha256, afterPanelSha256: panelRow.after_sha256, currentPanelSha256: sha(currentPanel), inputs: beforeInputs.length, browserExecuted: false}));
