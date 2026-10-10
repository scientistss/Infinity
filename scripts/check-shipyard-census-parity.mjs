/** Exact archived-engine comparison for the segment-local fleet census.
 * Only anonymous prepared snapshots. All historical fields stay exact; only the asserted empty r9 library is added.
 * Usage: node --import tsx scripts/check-shipyard-census-parity.mjs BEFORE FIXTURE MODERATE
 */
import { assertR8StatePreserved } from './r8-compatibility.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import * as nextSave from '../src/game/save.ts';
import * as nextLogic from '../src/game/logic.ts';
import * as nextFleet from '../src/game/fleet.ts';

const [root,fixturePath,moderatePath]=process.argv.slice(2);
assert.ok(root&&fixturePath&&moderatePath,'Provide fixed old source and both anonymous fixture paths');
const baseline='8c19d044fb3c38c601223cd55272c6570c08525d';
const sha=value=>createHash('sha256').update(value).digest('hex');
const pinned={shipyard:'a1a1717163d6bd1e48667aaddc544bdee9c7fbfdfbd032d0154caada0ae11f16',logic:'b7cb40e92c774abc52af2c92211288f6ac0def187c8a66a08c5ffc7c201aa3ba',fleet:'e582f651e37131a13cfc970a5774b2729b1bfbf74828d38adce9f3830edf1b1e',save:'de4caa2c4e88ea94b8f9ce5b360e1a64e7aa7c30539dc653402a444cec8a9965'};
for(const [name,digest] of Object.entries(pinned))assert.equal(sha(readFileSync(resolve(root,`src/game/${name}.ts`))),digest,`exact ${baseline} ${name}`);
const load=path=>import(pathToFileURL(resolve(root,path)).href);
const [oldSave,oldLogic,oldFleet,oldState,oldFixture,oldYard]=await Promise.all(['src/game/save.ts','src/game/logic.ts','src/game/fleet.ts','src/game/state.ts','scripts/performance-fixture.ts','src/game/shipyard.ts'].map(load));
const pressure=JSON.parse(readFileSync(fixturePath,'utf8')),moderate=JSON.parse(readFileSync(moderatePath,'utf8'));
assert.equal(sha(pressure.save),pressure.manifest.sha256,'complete exported pressure bytes');
assert.equal(pressure.manifest.canonicalSha256,'684752ad25d9ad2eabba11552584694d19bf6a367a22abb143d274cbc832c5b5','same legal combined load as verified prior stage');
assert.equal(sha(JSON.stringify(pressure.ready)),pressure.manifest.canonicalSha256);
const smoke=await oldFixture.generatePerformanceFixture({profile:'smoke'});
const cases={initial:oldSave.serializeState(oldState.createInitialState(20261010,20261010)),smoke:smoke.ready.state,combined:pressure.ready.state};
for(const [name,value] of Object.entries(moderate))if(value?.schema==='infinity-original-p4'&&value.state)cases[`moderate-${name}`]=value.state;
// Explicit synthetic inventory boundary variants keep all existing real paid
// jobs/fleet identities. They test completion capacity, not natural progression.
const nearEmpire=oldSave.deserializeState(pressure.ready.state);
const fleetStock=nearEmpire.fleets.reduce((sum,f)=>sum+(f.ships.light_fighter??0),0);
let landed=Number.MAX_SAFE_INTEGER-fleetStock-1;
for(let i=0;i<nearEmpire.planets.length;i++){
 const count=i===nearEmpire.planets.length-1?landed:Math.floor(landed/(nearEmpire.planets.length-i));
 assert.ok(count<=oldYard.MAX_PLANET_UNITS);nearEmpire.planets[i].units.light_fighter=count;landed-=count;
}
assert.equal(landed,0);
cases['synthetic-one-empire-slot']=oldSave.serializeState(nearEmpire);
const nearPort=oldSave.deserializeState(pressure.ready.state);
const home=nearPort.planets.find(p=>p.id===nearPort.activePlanetId);
home.units.light_fighter+=oldYard.shipOutputCapacity(nearPort,'light_fighter',false)-1;
cases['synthetic-one-home-port-slot']=oldSave.serializeState(nearPort);
const [oldDecimal,oldQueue,oldResearch,oldProtocol]=await Promise.all(['src/game/decimal.ts','src/game/queue.ts','src/game/research.ts','src/automation/engine.ts'].map(load));
let satellites=oldState.createInitialState(20261010,20261010);
Object.assign(satellites.planets[0].buildings,{robotics_factory:2,shipyard:2,research_lab:2,metal_mine:10,crystal_mine:8,solar_plant:2});
for(const resource of ['metal','crystal','deuterium'])satellites.planets[0].resources[resource]=oldDecimal.big(1e7);
Object.assign(satellites.research.levels,{combustion_drive:2,energy_tech:1});
// Explicit synthetic starting defense permits the real idle-event card; all
// queued batches, build and research identities below are paid through old APIs.
satellites.planets[0].units.rocket_launcher=1;
satellites=oldLogic.tick(satellites,.01);
const equip=oldProtocol.equipCard(satellites,0,'defense_keeper');assert.ok(equip.status.startsWith('已装配'),equip.status);assert.equal(equip.state.protocols.slots[0].card.action.kind,'buildUnits');satellites=equip.state;
for(const [unit,count] of [['solar_satellite',3],['light_fighter',5]]){const r=oldYard.orderUnits(satellites,unit,count,'manual');assert.ok(r.ok,r.reason);satellites=r.state;}
const studying=oldResearch.enqueueResearch(satellites,'energy_tech','manual');assert.ok(studying.ok,studying.reason);satellites=studying.state;
cases['synthetic-satellites-research-idle-protocol']=oldSave.serializeState(satellites);
const upgrading=oldQueue.enqueue(satellites,'shipyard','manual');assert.ok(upgrading.ok,upgrading.reason);
cases['synthetic-yard-upgrade-pause']=oldSave.serializeState(upgrading.state);
const rows=[];
function run(name,raw,steps,mode='live',recall=false){
 let old=oldSave.deserializeState(raw),next=nextSave.deserializeState(nextSave.importSave(oldSave.exportSave(oldSave.deserializeState(raw),123456)).state),recalled=null,recallStock=null,returnVerified=false;
 assertR8StatePreserved(nextSave.serializeState(next),oldSave.serializeState(old),name+': initial complete state');
 if(recall){
  const oldInput=oldSave.serializeState(old),nextInput=nextSave.serializeState(next);
  const aLog=oldLogic.emptyTickLog(),bLog=nextLogic.emptyTickLog();
  old=oldLogic.tick(old,.5,'live',aLog);next=nextLogic.tick(next,.5,'live',bLog);
  assertR8StatePreserved(nextSave.serializeState(next),oldSave.serializeState(old),name+': actual outbound elapsed before recall');
  assert.deepEqual(aLog,bLog,name+': full pre-recall TickLog');
  assert.deepEqual(oldInput,raw,name+': original input canonical');
  assertR8StatePreserved(nextInput,raw,name+': candidate migrated input canonical');
  rows.push({name:name+'-pre-recall',mode:'live',seconds:.5,sha256:sha(JSON.stringify(nextSave.serializeState(next)))});
  const fleet=old.fleets.find(f=>!f.returning&&!f.orderTransport);
  assert.ok(fleet&&fleet.elapsed>0,name+': real ordinary fleet has actually spent outbound time');
  recalled={id:fleet.id,originId:fleet.originId,ships:{...fleet.ships}};
  recallStock={...old.planets.find(p=>p.id===fleet.originId).units};
  const a=oldFleet.recallFleet(old,fleet.id),b=nextFleet.recallFleet(next,fleet.id);
  assert.equal(a.ok,b.ok,name+': recall outcome');assert.equal(a.reason,b.reason,name+': recall reason');
  assert.ok(a.ok&&a.state.fleets.some(f=>f.id===fleet.id&&f.returning&&f.remaining>0),name+': recall leaves a genuine in-flight return');
  old=a.state;next=b.state;assertR8StatePreserved(nextSave.serializeState(next),oldSave.serializeState(old),name+': full recall state');
 }
 for(const seconds of steps){
  const oldInput=oldSave.serializeState(old),nextInput=nextSave.serializeState(next);
  const aLog=oldLogic.emptyTickLog(),bLog=nextLogic.emptyTickLog();
  const a=oldLogic.tick(old,seconds,mode,aLog),b=nextLogic.tick(next,seconds,mode,bLog);
  assert.deepEqual(oldSave.serializeState(old),oldInput,name+': archived input purity');
  assert.deepEqual(nextSave.serializeState(next),nextInput,name+': candidate input purity');
  const expected=oldSave.serializeState(a),actual=nextSave.serializeState(b);
  assertR8StatePreserved(actual,expected,`${name}: every serialized field after ${seconds}s/${mode}`);
  assert.deepEqual(bLog,aLog,`${name}: full ordered TickLog`);
  rows.push({name,mode,seconds,sha256:sha(JSON.stringify(actual)),completedBuilds:bLog.completedBuilds.length,completedResearch:bLog.completedResearch.length,completedUnits:bLog.completedUnits.length});
  if(recalled&&!returnVerified&&!b.fleets.some(f=>f.id===recalled.id)){
   const port=b.planets.find(p=>p.id===recalled.originId);
   for(const [id,count] of Object.entries(recalled.ships))assert.ok(port.units[id]>=recallStock[id]+count,name+': actual return credits the origin ships');
   returnVerified=true;
  }
  old=a;next=b;
 }
 if(recall)assert.ok(returnVerified,name+': timed tick crossed the real return and rebuilt later segment capacity');
 const restored=nextSave.deserializeState(nextSave.importSave(nextSave.exportSave(next,123456)).state);
 assert.deepEqual(nextSave.serializeState(restored),nextSave.serializeState(next),name+': strict whole-state save roundtrip');
 return next;
}
for(const [name,raw] of Object.entries(cases)){
 const live=run(name+'-live',raw,[0,1/60,.125,.5,1,9,20]);
 if(name==='synthetic-satellites-research-idle-protocol')assert.ok(live.planets[0].units.rocket_launcher>1,'real idle-event protocol has completed defense work');
 if(name==='synthetic-yard-upgrade-pause')assert.equal(live.planets[0].buildings.shipyard,3,'real paid upgrade has finished and resumed ship production');
 run(name+'-offline',raw,[.25,10,60],'offline');
}
run('combined-recall-next-boundaries',cases.combined,[.1,1,10,60],'live',true);
// A real arrival boundary rebuilds the next segment census; input remains the
// legal API-built fixture, not fabricated fleet receipts or paused clocks.
for(const name of ['smoke','combined']){
 const state=oldSave.deserializeState(cases[name]);
 const first=state.fleets.reduce((a,b)=>a.remaining<=b.remaining?a:b);
 const arrival=Math.max(0,first.remaining);
 assert.ok(Number.isFinite(arrival)&&arrival>=0);
 const arrived=run(name+'-actual-fleet-boundary',cases[name],[Math.max(0,arrival-.001),.002,1]);
 const remaining=arrived.fleets.find(f=>f.id===first.id);
 assert.ok(!remaining||remaining.returning!==first.returning||remaining.charge?.phase!==first.charge?.phase,name+': genuine original arrival changes phase or lands, rather than only moving the clock');
}
const saturated=oldLogic.tick(oldSave.deserializeState(cases['synthetic-one-empire-slot']),2);
assert.equal(saturated.planets.reduce((sum,p)=>sum+p.units.light_fighter,0)+saturated.fleets.reduce((sum,f)=>sum+(f.ships.light_fighter??0),0),Number.MAX_SAFE_INTEGER,'explicit simultaneous world completions consume only the one safe empire slot');
function stats(values){const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],min:sorted[0],max:sorted.at(-1)};}
const timings=[];
for(const [name,raw] of [['moderate',moderate.ready.state],['combined',pressure.ready.state]]){
 const a=oldSave.deserializeState(raw),b=nextSave.deserializeState(nextSave.importSave(oldSave.exportSave(oldSave.deserializeState(raw),123456)).state),samples={before:[],after:[]};
 const input=JSON.stringify(nextSave.serializeState(b));
 for(let n=0;n<26;n++)for(const label of n%2?['after','before']:['before','after']){
  const start=performance.now();const state=label==='before'?oldLogic.tick(a,1/60):nextLogic.tick(b,1/60);const elapsed=performance.now()-start;
  if(n>=6)samples[label].push(elapsed);
  // Complete-output equality is checked outside the measured interval.
  if(n===25)assertR8StatePreserved(nextSave.serializeState(label==='after'?state:nextLogic.tick(b,1/60)),oldSave.serializeState(label==='before'?state:oldLogic.tick(a,1/60)),'timed whole-state output');
 }
 assert.equal(JSON.stringify(nextSave.serializeState(b)),input,'benchmark candidate input unchanged');
 assert.deepEqual(oldSave.serializeState(a),raw,'benchmark archived input unchanged');
 timings.push({profile:name,stepSeconds:1/60,mode:'live',warmupPairs:6,order:'AB/BA alternating',samplesMs:samples,summary:{before:stats(samples.before),after:stats(samples.after)}});
}
console.log(JSON.stringify({baseline,result:'passed',comparisons:rows.length,scope:'Complete serialized state and ordered TickLog against independently pinned source; actual recall/arrival boundaries, sole independently asserted empty r9 buildingTemplates addition, no economic or clock normalization',fixtureSha:pressure.manifest.canonicalSha256,environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model},rows,timings,limitations:['Synthetic initial assets are not natural progression','Node wall-clock samples are not browser CPU or a frame-rate claim','No elapsed-time CI pass threshold; correctness is exact']},null,2));
