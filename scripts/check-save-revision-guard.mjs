/** Actual pinned r12 AND r11 readers reject native r13 wallets/receipts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportSave, importSave, deserializeState } from '../src/game/save.ts';
import { createInitialState } from '../src/game/state.ts';
import { SAVE_REVISION } from '../src/game/content.ts';
import { tick } from '../src/game/logic.ts';
import { expectedNpcEconomy, liftR11StateToR13, liftR12StateToR13, assertHistoricalSource } from './r13-compatibility.mjs';
const [r12Root, r11Root] = process.argv.slice(2);
assert.ok(r12Root && r11Root, 'Provide verified eef r12 and ca5 r11 source roots');
const pins = ['eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81','ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'];
const old = [];
for (const [index, root] of [r12Root,r11Root].entries()) {
  assertHistoricalSource(root,pins[index]);
  const load = p => import(pathToFileURL(resolve(root,`src/game/${p}.ts`)).href);
  const [save,logic,content] = await Promise.all(['save','logic','content'].map(load));
  assert.equal(content.SAVE_REVISION,12-index); old.push({save,logic});
}
assert.equal(SAVE_REVISION,13);
const cases = [[createInitialState(42,43),[]],[tick(createInitialState(42,43),.25),[.25]]];
for (const [state,segments] of cases) {
  const raw=exportSave(state,1000000);
  assert.deepEqual(JSON.parse(raw).state.npcEconomy,expectedNpcEconomy(segments));
  for (const reader of old) assert.throws(()=>reader.save.importSave(raw),/修订不兼容/);
}
const fixture=JSON.parse(readFileSync(new URL('../tests/fixtures/npc-economy-r11.json',import.meta.url),'utf8'));
for (const row of fixture.rows) {
  const prior=old[1].save.importSave(row.raw);
  assert.deepEqual(prior,row.oldReaderOutput);
  assert.deepEqual(importSave(row.raw).state,liftR11StateToR13(prior.state));
  for (const seconds of [0,.1+.2,11900]) {
    const r12State=old[0].logic.tick(old[0].save.deserializeState(old[0].save.importSave(row.raw).state),seconds);
    const r12Raw=old[0].save.exportSave(r12State,prior.savedAt,prior.lastTickAt);
    const source=old[0].save.importSave(r12Raw),current=importSave(r12Raw);
    assert.deepEqual(current,{...source,revision:13,state:liftR12StateToR13(source.state)});
    const rewritten=exportSave(deserializeState(current.state),current.savedAt,current.lastTickAt);
    for (const reader of old) assert.throws(()=>reader.save.importSave(rewritten),/修订不兼容/);
  }
}
console.log(JSON.stringify({currentRevision:13,previousSources:pins,nativeCases:cases.length,r12ActualSnapshotMigrations:fixture.rows.length*3,result:'passed'}));
