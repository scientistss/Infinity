/** Test-only oracle: archived r10 implementation; input is raw source + constructor timestamp, never current state. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {captureAdoptedSteps} from './capture-adopted-steps.mjs';
export const DEPENDENCIES={
  breakInfinity:{version:'2.2.0',commonSha256:'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06',esmSha256:'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},
  padEnd:{version:'1.0.2',entrySha256:'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'},
};
function dependencyIdentity(root){
  const require=createRequire(pathToFileURL(resolve(root,'package.json')));
  const infinityEntry=require.resolve('break_infinity.js');
  // Follow the dependency edge the numerical library actually executes, including nested installs.
  const infinityRequire=createRequire(infinityEntry);
  const infinityPath=require.resolve('break_infinity.js/package.json'),padPath=infinityRequire.resolve('pad-end/package.json');
  const infinity=JSON.parse(readFileSync(infinityPath,'utf8')),pad=JSON.parse(readFileSync(padPath,'utf8'));
  const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  return {breakInfinity:{version:infinity.version,commonSha256:digest(infinityEntry),esmSha256:digest(resolve(dirname(infinityPath),infinity.module))},
    padEnd:{version:pad.version,entrySha256:digest(infinityRequire.resolve('pad-end'))}};
}
export const SOURCE_SHA='ac3cce98403bea1e7162bcb4092e4cfeeb448a9a';
export async function oracle(root, raw, constructorNow) {
  assert.equal(typeof raw,'string');
  assert.ok(Number.isSafeInteger(constructorNow) && constructorNow >= 0,'independent constructor wall timestamp required');
  root=resolve(root);
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),SOURCE_SHA,'exact archived r10 source SHA');
  execFileSync('git',['diff','--exit-code',SOURCE_SHA,'--','src','package.json','package-lock.json','tsconfig.json'],{cwd:root});
  assert.equal(execFileSync('git',['ls-files','--others','--','src'],{cwd:root,encoding:'utf8'}).trim(),'','no untracked old implementation');
  const dependencyBytes=dependencyIdentity(root);
  assert.deepEqual(dependencyBytes,DEPENDENCIES,'old resolved numerical dependency versions/bytes match fixed oracle');
  assert.deepEqual(dependencyIdentity(process.cwd()),dependencyBytes,'current npm-ci numerical dependencies equal old resolved dependency bytes');
  const [save,offline,content]=await Promise.all(['src/game/save.ts','src/core/offline.ts','src/game/content.ts'].map(p=>import(pathToFileURL(resolve(root,p)).href)));
  assert.equal(content.SAVE_REVISION,10);assert.equal(content.SAVE_VERSION,9);
  const source=JSON.parse(raw);assert.equal(source.revision,10);assert.equal(source.savedAt,source.lastTickAt);
  const read=save.importSave(raw);
  const gapMilliseconds=constructorNow-source.lastTickAt;
  const adopted=captureAdoptedSteps(save.deserializeState(read.state),
    state=>offline.catchUp(state,gapMilliseconds/1000), save.serializeState);
  const result=adopted.result;
  return {schema:'infinity-fixed-r10-startup-oracle-v1',sourceSha:SOURCE_SHA,dependencyIdentity:dependencyBytes,
    inputRawSha256:createHash('sha256').update(raw).digest('hex'),sourceSavedAt:source.savedAt,
    sourceLastTickAt:source.lastTickAt,constructorNow,gapMilliseconds,
    appliedSeconds:result.appliedSeconds,capSeconds:result.capSeconds,capped:result.capped,
    adoptedSegmentsSeconds:adopted.adoptedSegmentsSeconds,npcElapsedSeconds:adopted.npcElapsedSeconds,
    adoptedTimeObservation:adopted.observation,
    state:save.serializeState(result.state)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const input=JSON.parse(readFileSync(0,'utf8'));
  assert.deepEqual(Object.keys(input).sort(),['constructorNow','originalRaw']);
  console.log(JSON.stringify(await oracle(process.argv[2],input.originalRaw,input.constructorNow)));
}
