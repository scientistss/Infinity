/** Add an independent adopted-clock witness beside, never inside, immutable r8 fixture states.
 * CLI: node --import tsx scripts/prepare-r13-render-clock.mjs OLD_R8_ROOT FIXTURE
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';
import { expectedNpcEconomy, advanceExpectedNpcWallet, assertHistoricalSource } from './r13-compatibility.mjs';
export async function prepareRenderClock(root, fixture) {
  const sourceSha = '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b';
  assertHistoricalSource(root, sourceSha);
  assert.equal(createHash('sha256').update(readFileSync(resolve(root,'scripts/render-scheduling-fixture.ts'))).digest('hex'),
    'ad2c22df8745048bad9042dd36d5903710afab7035b952663e1c4efc13c5d6c3', 'unchanged exact historical trace generator');
  const load = p => import(pathToFileURL(resolve(root,`src/${p}.ts`)).href);
  const [save, logic, offline, arcade] = await Promise.all(['game/save','game/logic','core/offline','game/arcade'].map(load));
  const traces = {}, before = JSON.stringify(fixture);
  const state = variant => {
    assert.equal(fixture[variant].revision, 8, 'genuine old source variant');
    const raw = JSON.stringify(fixture[variant]), parsed = save.importSave(raw);
    assert.deepEqual(parsed, fixture[variant], `${variant}: actual archived strict reader preserves complete envelope`);
    return save.deserializeState(parsed.state);
  };
  const record = (name, actual, segments) => {
    assert.deepEqual(save.serializeState(actual), fixture.expected[name], `${name}: all observed/unobserved archived fields equal immutable original expected result`);
    assert.equal(Object.hasOwn(traces,name), false, 'one exact witness per expected name');
    traces[name] = { adoptedSegmentsSeconds: segments, npcWallet: expectedNpcEconomy(segments), oldObservedAndUnobservedStateEqual: true };
  };
  const advance = (current, seconds, segments, mode='live') => {
    const witnessed = captureAdoptedSteps(current,
      value => mode==='offline' ? offline.catchUp(value,seconds) : { state:logic.tick(value,seconds) }, save.serializeState);
    segments.push(...witnessed.adoptedSegmentsSeconds); return witnessed.result.state;
  };
  for (const variant of ['base','incoming','automatic','fresh','rollover','ring','locked']) record(`${variant}.initial`,state(variant),[]);
  for (const name of ['steady60','steady120','actions']) {
    let current=state('base'),last=0; const segments=[];
    for (const step of fixture.traces[name]) {
      const seconds=(step.atMs-last)/1000;
      current=advance(current,seconds,segments,name==='actions'&&seconds>=5?'offline':'live');last=step.atMs;
      if (step.action==='scrape') current=logic.scrape(current); else assert.equal(step.action,undefined);
    }
    record(name,current,segments);
  }
  for (const [name,variant,steps] of [['hidden','base',[.04,.04]],['fresh60','fresh',[.06]],['rollover60','rollover',[.06]],
    ['automatic.skipped','automatic',[...Array(9).fill(1),.95,.05]]]) {
    let current=state(variant); const segments=[];
    for (const seconds of steps) current=advance(current,seconds,segments);
    record(name,current,segments);
  }
  const accepted=result=>{assert.ok(result.ok,result.reason);return result.state;};
  record('ring.single',accepted(arcade.revealRun(state('ring'),'manual')),[]);
  record('ring.all',accepted(arcade.revealAll(state('ring'),'manual')),[]);
  record('ring.singleAll',accepted(arcade.revealAll(accepted(arcade.revealRun(state('ring'),'manual')),'manual')),[]);
  assert.deepEqual(Object.keys(traces).sort(),Object.keys(fixture.expected).sort(),'every exact original expected trace accounted once');
  assert.equal(JSON.stringify(fixture),before,'all original fixture fields/byte ordering unchanged');
  return { sourceSha, observation:'old-totalTime-add; full unobserved old-state equivalence verified', traces };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [root,path]=process.argv.slice(2);assert.ok(root&&path,'Provide pinned old r8 source and original/paired fixture');
  const fixture=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(Object.hasOwn(fixture,'npcAdoptedTime'),false,'prepare only a fresh independent clock witness');
  console.log(JSON.stringify({...fixture,npcAdoptedTime:await prepareRenderClock(root,fixture)},null,2));
}
