/** No current production imports. Historical adapters and full-state proofs remain exact. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expectedNpcEconomy, expectedNpcFromR12Snapshot, advanceExpectedNpcWallet, liftR11StateToR13,
 liftR12StateToR13, projectVerifiedNpcEconomy, assertR8StatePreserved, liftR8StateToR13 } from './r13-compatibility.mjs';
import { advanceExpectedNpcAge } from './r12-compatibility.mjs';
const clone = structuredClone;
test('old capped age cannot determine a current wallet or horizon reset',()=>{
 assert.equal(advanceExpectedNpcAge(0,[11900]),advanceExpectedNpcAge(0,[11900,100]));
 assert.notDeepEqual(expectedNpcEconomy([11900]),expectedNpcEconomy([11900,100]));
 assert.deepEqual(expectedNpcEconomy([11999,.5,.5,1]),{model:'npc-wallet-garrison-v1',now:1,baseline:{stock:[50000,30000,10000],mark:0},sites:{}});
 assert.deepEqual(expectedNpcEconomy([12000,1]),expectedNpcEconomy([11999,.5,.5,1]));
 assert.equal(expectedNpcEconomy([.1,.2]).now,.1+.2); assert.notEqual(expectedNpcEconomy([.1,.2]).now,.3);
 for(const bad of [11900,null,true,'1',{},NaN])assert.throws(()=>expectedNpcEconomy(bad));
 for(const bad of [-1,NaN,Infinity,'1',true])assert.throws(()=>expectedNpcEconomy([bad]));
});
test('actual finite r12 snapshot copies into new zero-mark baseline with no historical clock backfill',()=>{
 const age=.1+.2,old={npcEconomy:{model:'fixed-production-v1',elapsedSeconds:age},totalTime:'1e400',ordinary:[1,'1',false],planets:[{id:'old-world',resources:{metal:'123'}}]},before=clone(old);
 const current=liftR12StateToR13(old);
 assert.deepEqual(current.npcEconomy,{model:'npc-wallet-garrison-v1',now:0,baseline:{stock:[500+5*age,250+2.5*age,age],mark:0},sites:{}});
 assert.deepEqual(current.npcBattles,{model:'npc-battle-receipts-v1',reports:[]});assert.deepEqual(old,before);
 assert.deepEqual(Object.keys(current),['npcEconomy','npcBattles','totalTime','ordinary','planets']);
 for(const bad of [{model:'fixed-production-v1',elapsedSeconds:11901},{model:'fixed-production-v1',elapsedSeconds:'0'},{model:'fixed-production-v1',elapsedSeconds:0,extra:false}])assert.throws(()=>expectedNpcFromR12Snapshot(bad));
});
test('strict no-attack delta rejects every wallet/report shape and preserves every old field',()=>{
 const wallet=expectedNpcEconomy([1]),old={totalTime:'1e400',ordinary:[1,'1',false],planets:[{id:'old-world',resources:{metal:'123'}}]},good=liftR11StateToR13(old,wallet);
 assert.deepEqual(projectVerifiedNpcEconomy(good,wallet,'good'),old);
 for(const mutate of [s=>s.npcEconomy.now=0,s=>s.npcEconomy.extra=false,s=>s.npcEconomy.baseline.mark=1,s=>s.npcEconomy.sites['1:1:1']={},s=>s.npcBattles.reports.push({}),s=>s.npcBattles.extra=0,s=>delete s.npcBattles,s=>Object.defineProperty(s,'npcEconomy',{get(){throw Error('no getters');}}),s=>s.npcEconomy[Symbol('x')]=1]){
 const bad=clone(good);mutate(bad);assert.throws(()=>projectVerifiedNpcEconomy(bad,wallet,'mutant'));
 }
 assert.throws(()=>projectVerifiedNpcEconomy(Object.create(good),wallet,'inherited'));
});
test('genuine complete r8 projection admits exact metadata only',()=>{
 const evidence=JSON.parse(readFileSync(new URL('../tests/fixtures/demolition-r10.json',import.meta.url),'utf8'));
 const old=JSON.parse(evidence.legacyInputs[0].raw).state;delete old.buildingTemplates;
 const floor=old.orders.nextJobId,wallet=expectedNpcEconomy([.5,.75]),good=liftR8StateToR13(old,floor,wallet);
 assertR8StatePreserved(good,old,'good',floor,wallet);
 for(const change of [s=>s.totalTime='999',s=>s.extra=true,s=>s.planets[0].resources.metal='1',s=>s.terraformerGrantJobFloor++]){
 const bad=clone(good);change(bad);assert.throws(()=>assertR8StatePreserved(bad,old,'mutant',floor,wallet));}
});

test('zero-rights migration and projection are exact per planet and never erase positive claims',()=>{
 const old={planets:[{id:'home',resources:{metal:'123'}},{id:'colony',resources:{metal:'456'}}]},wallet=expectedNpcEconomy();
 const good=liftR11StateToR13(old,wallet);
 assert.deepEqual(good.planets.map(p=>p.npcResourceRemainder),[{metal:'0',crystal:'0',deuterium:'0'},{metal:'0',crystal:'0',deuterium:'0'}]);
 assert.deepEqual(projectVerifiedNpcEconomy(good,wallet,'zero rights'),old);
 for(const mutate of [s=>delete s.planets[0].npcResourceRemainder,s=>s.planets[0].npcResourceRemainder.metal='0.1',s=>s.planets[1].npcResourceRemainder.crystal=0,s=>s.planets[0].npcResourceRemainder.extra='0',s=>s.planets[0].npcResourceRemainder=Object.create({metal:'0',crystal:'0',deuterium:'0'}),s=>Object.defineProperty(s.planets[0],'npcResourceRemainder',{get(){throw Error('no getter');}}),s=>Object.defineProperty(s.planets[0].npcResourceRemainder,'metal',{get(){throw Error('no getter');}}),s=>s.planets[0].npcResourceRemainder[Symbol('extra')]='0']){
  const bad=clone(good);mutate(bad);assert.throws(()=>projectVerifiedNpcEconomy(bad,wallet,'must retain claim'));
 }
 const smuggled=clone(old);smuggled.planets[0].npcResourceRemainder={metal:'0',crystal:'0',deuterium:'0'};
 assert.throws(()=>liftR11StateToR13(smuggled));
});
