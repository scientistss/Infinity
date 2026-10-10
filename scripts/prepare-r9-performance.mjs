/** Prepare current-version native pairs from the actual pinned r8 fixture.
 * Usage: node --import tsx scripts/prepare-r9-performance.mjs --r8-source ROOT --fixture INPUT > OUTPUT
 * Keep original r8 fixture fields intact for historical parity. No timing here.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as current from '../src/game/save.ts';
import {assertR8StatePreserved, liftR8State} from './r8-compatibility.mjs';
const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf(name);assert.ok(index>=0&&args[index+1],`Provide ${name}`);return args[index+1];};
const root=resolve(option('--r8-source')),path=resolve(option('--fixture'));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const sourceSha='4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b';
for(const [name,digest] of Object.entries({state:'ac6960a0b337a53a78e946bb158146c1505b4fda539d6b7497ae2a1f0292d83e',save:'de4caa2c4e88ea94b8f9ce5b360e1a64e7aa7c30539dc653402a444cec8a9965'})) {
  assert.equal(sha(readFileSync(resolve(root,`src/game/${name}.ts`))),digest,`actual ${sourceSha} ${name} source`);
}
const old=await import(pathToFileURL(resolve(root,'src/game/save.ts')).href);
const fixture=JSON.parse(readFileSync(path,'utf8'));
assert.equal(Object.hasOwn(fixture,'pairedNative'),false,'prepare a fresh original fixture, not a previous adapter result');
const ready=fixture.ready??fixture.base,sourceRaw=fixture.save??JSON.stringify(ready,null,2);
assert.equal(ready.revision,8);assert.equal(ready.version,9);
assert.deepEqual(JSON.parse(sourceRaw),ready,'source fixture save contract');
const oldState=old.deserializeState(old.importSave(sourceRaw).state);
assert.deepEqual(old.serializeState(oldState),ready.state,'archived reader preserves every source-fixture value');
// The moderate trace fixture uses compact JSON. Obtain its real native pretty
// bytes from the archived serializer, without changing any payload field.
const raw=old.exportSave(oldState,ready.savedAt,ready.lastTickAt);
assert.deepEqual(JSON.parse(raw),ready,'actual archived native export preserves the whole envelope');
const migrated=current.importSave(raw);
assert.equal(migrated.revision,9);
assertR8StatePreserved(migrated.state,ready.state,'real fixture migration');
const afterSave=current.exportSave(current.deserializeState(migrated.state),ready.savedAt,ready.lastTickAt);
assert.equal(afterSave,JSON.stringify({...ready,revision:9,state:liftR8State(ready.state)},null,2),'native r9 export differs only by revision and exact empty library');
assert.deepEqual(current.importSave(afterSave),migrated,'current native input is strict-reader stable');
process.stdout.write(JSON.stringify({...fixture,pairedNative:{
  sourceSha,sourceRevision:8,currentRevision:9,
  generatedBy:'actual archived r8 strict reader/exportSave, then actual current importSave/exportSave',
  sourceFixtureSha256:sha(sourceRaw),beforeSave:raw,beforeSha256:sha(raw),afterSha256:sha(afterSave),commonR8StateSha256:sha(JSON.stringify(ready.state)),afterSave,
  stateRule:'Every source-r8 value, scalar type and array position is preserved. The current input adds only empty buildingTemplates and uses envelope revision 9.',
  capacityScope:'Fresh isolated current-version origins, two native copies for replacement. Does not establish capacity for a previously migrated origin with an additional historical backup.',
}},null,2)+'\n');
