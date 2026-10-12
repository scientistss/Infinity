/** Test-only pinned7554 r13 startup oracle. Inputs are untouched old save bytes and the actual
 * constructor timestamp, never candidate state, a fitted gap, or current game code.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';

export const SOURCE_SHA = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52';
export const DEPENDENCIES = Object.freeze({
  breakInfinity: Object.freeze({ version: '2.2.0', commonSha256: 'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06', esmSha256: '1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a' }),
  padEnd: Object.freeze({ version: '1.0.2', entrySha256: '063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330' }),
});
const RUNNER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PINNED_PATHS = ['src', 'package.json', 'package-lock.json', 'tsconfig.json'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Inspect the actual tree, not Git status: ignored or assume-unchanged files can
 * otherwise shadow extensionless imports without appearing in ordinary diffs.
 */
export function assertPinnedSource(root) {
  root = realpathSync(root);
  const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(git('rev-parse', '--show-toplevel').trim(), root, 'exact archived checkout root required');
  assert.equal(git('rev-parse', 'HEAD').trim(), SOURCE_SHA, 'exact archived r13 source SHA');
  const entries = git('ls-tree', '-r', '-z', SOURCE_SHA, '--', ...PINNED_PATHS).split('\0').filter(Boolean);
  const expected = [];
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    assert.ok(match, 'only ordinary source/configuration files are admitted');
    const [, mode, blob, name] = match, path = resolve(root, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `ordinary archived file required: ${name}`);
    assert.equal(Boolean(stat.mode & 0o111), mode === '100755', `exact archived file mode: ${name}`);
    const bytes = readFileSync(path);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), blob,
      `exact archived file bytes: ${name}`);
    expected.push(name);
  }
  assert.ok(expected.some(name => name.startsWith('src/')), 'complete pinned source tree required');
  for (const name of PINNED_PATHS.slice(1)) assert.ok(expected.includes(name), `pinned configuration required: ${name}`);
  const actual = [];
  function scan(relative) {
    const stat = lstatSync(resolve(root, relative));
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `ordinary archived source directory required: ${relative}`);
    for (const entry of readdirSync(resolve(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) scan(name); else actual.push(name);
    }
  }
  scan('src');
  assert.deepEqual(actual.sort(), expected.filter(name => name.startsWith('src/')).sort(),
    'complete actual archived source tree: no missing, extra, ignored, or shadow source paths');
  return root;
}

export function dependencyIdentity(root) {
  // Resolve at the actual old numerical import, including any nested dependency.
  const require = createRequire(pathToFileURL(resolve(root, 'src/game/decimal.ts')));
  const infinityEntry = require.resolve('break_infinity.js');
  const infinityRequire = createRequire(infinityEntry);
  const infinityPath = require.resolve('break_infinity.js/package.json');
  const padPath = infinityRequire.resolve('pad-end/package.json');
  const infinityBytes = readFileSync(infinityPath), padBytes = readFileSync(padPath);
  // Package metadata controls import/require resolution, so pin it as well as the
  // actual entries. The public identity stays identical to the fixed r10 oracle.
  assert.equal(digest(infinityBytes), '28c409896f3b0c9de03b55dade1c5ba9555ca236a2268328df0bc4285926990f', 'fixed break_infinity.js package metadata');
  assert.equal(digest(padBytes), '428212d66fdffecb142ef13ba9b91e67fe3b0ffaa48d4c04961ff0dae177d0a4', 'fixed pad-end package metadata');
  const infinity = JSON.parse(infinityBytes), pad = JSON.parse(padBytes);
  return {
    breakInfinity: { version: infinity.version, commonSha256: digest(readFileSync(infinityEntry)),
      esmSha256: digest(readFileSync(resolve(dirname(infinityPath), infinity.module))) },
    padEnd: { version: pad.version, entrySha256: digest(readFileSync(infinityRequire.resolve('pad-end'))) },
  };
}

export async function oracle(root, originalRaw, constructorNow) {
  assert.equal(arguments.length, 3, 'only archived root, original raw save and actual constructor timestamp are accepted');
  assert.equal(typeof originalRaw, 'string', 'original raw save bytes required');
  assert.ok(Number.isSafeInteger(constructorNow) && constructorNow >= 0, 'independent constructor wall timestamp required');
  root = assertPinnedSource(root);
  const dependencyBytes = dependencyIdentity(root);
  assert.deepEqual(dependencyBytes, DEPENDENCIES, 'old resolved numerical dependency versions/bytes match fixed oracle');
  assert.deepEqual(dependencyIdentity(RUNNER_ROOT), dependencyBytes, 'current npm-ci numerical dependencies equal old resolved dependency bytes');
  const [save, offline, content] = await Promise.all(['src/game/save.ts', 'src/core/offline.ts', 'src/game/content.ts']
    .map(path => import(pathToFileURL(resolve(root, path)).href)));
  assert.equal(content.SAVE_REVISION, 13);
  assert.equal(content.SAVE_VERSION, 9);
  assert.deepEqual(content.SUPPORTED_SAVE_REVISIONS, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  // The pinned reader alone validates and migrates genuine historical subformats.
  // Preserve the original envelope separately; do not relabel or rewrite input.
  const source = JSON.parse(originalRaw);
  assert.ok(source && typeof source === 'object' && !Array.isArray(source), 'complete genuine r13 envelope required');
  assert.equal(source.revision, 13, 'only genuine r13 source input; older revisions use their own fixed oracles');
  const read = save.importSave(originalRaw);
  const sourceEnvelope = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'state'));
  const gapMilliseconds = constructorNow - read.lastTickAt;
  const adopted = captureAdoptedSteps(save.deserializeState(read.state),
    state => offline.catchUp(state, gapMilliseconds / 1000), save.serializeState);
  const result = adopted.result;
  // Return the actual old wallet/garrison/receipts/rights after its actual catchUp.
  // No zero-age lift, r12 capped-age fold, or candidate value supplies this state.
  return {
    schema: 'infinity-fixed-r13-startup-oracle-v1', sourceSha: SOURCE_SHA, dependencyIdentity: dependencyBytes,
    inputRawSha256: digest(originalRaw), sourceRevision: source.revision, sourceEnvelope,
    sourceState: read.state, sourceNpc: read.state.npcEconomy, sourceSavedAt: source.savedAt, sourceLastTickAt: read.lastTickAt, constructorNow, gapMilliseconds,
    rawSeconds: result.rawSeconds, appliedSeconds: result.appliedSeconds, capSeconds: result.capSeconds, capped: result.capped,
    adoptedSegmentsSeconds: adopted.adoptedSegmentsSeconds,
    adoptedTimeObservation: adopted.observation, oldObservedAndUnobservedStateEqual: true,
    state: save.serializeState(result.state),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'provide exactly one archived r13 source root');
  const input = JSON.parse(readFileSync(0, 'utf8'));
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'raw-save/constructor envelope required');
  assert.deepEqual(Object.keys(input).sort(), ['constructorNow', 'originalRaw']);
  console.log(JSON.stringify(await oracle(process.argv[2], input.originalRaw, input.constructorNow)));
}
