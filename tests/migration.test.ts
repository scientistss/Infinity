import {describe,expect,it} from 'vitest';
import fixture from './fixtures/v8-p3.json';
import {BACKUP_KEY,LATEST_BACKUP_KEY,deserializeState,exportSave,importSave,loadGame,preserveSave,readBackup,serializeState,writeSave,type KeyValueStore} from '../src/game/save';
import {STORAGE_KEY} from '../src/game/content';
import {activePlanet} from '../src/game/empire';
import {createInitialState} from '../src/game/state';
import {cancelResearch} from '../src/game/research';
import {tick} from '../src/game/logic';
const raw=JSON.stringify(fixture);
function memory(initial:Record<string,string>={}):KeyValueStore{const d={...initial};return{getItem:k=>d[k]??null,setItem:(k,v)=>{d[k]=v;},removeItem:k=>{delete d[k];}};}
describe('v8 to v9 safe upgrade',()=>{
 it('preserves a real P3 export, all stock, queues and account values',()=>{
  const f=importSave(raw),p=f.state.planets[0]!;
  expect(f.version).toBe(9);expect(f.savedAt).toBe(fixture.savedAt);expect(f.lastTickAt).toBe(fixture.lastTickAt);
  expect(f.state.planets).toHaveLength(1);expect(f.state.activePlanetId).toBe('home');expect(p.resources).toEqual(fixture.state.resources);
  for(const key of ['buildings','units','buildQueue','shipyardQueue','productionPct','name'] as const)expect(p[key]).toEqual(fixture.state.planet[key]);
  for(const key of ['darkMatter','items','boosters','arcade','lifetime','warpCores','curvature','totalTime','protocols','stats'] as const)expect(f.state[key]).toEqual(fixture.state[key]);
  expect(f.state.research.queue).toEqual(fixture.state.research.queue.map(q=>({...q,planetId:'home'})));
  expect(f.state.research.levels).toEqual(fixture.state.research.levels);expect(f.state.fleets).toEqual([]);expect(f.state.messages).toEqual([]);
  expect('resources' in f.state).toBe(false);expect('planet' in f.state).toBe(false);
 });
 it('does not mutate input and round-trips the conversion',()=>{const before=JSON.stringify(fixture),f=importSave(raw);expect(importSave(exportSave(deserializeState(f.state),f.savedAt))).toEqual(f);expect(JSON.stringify(fixture)).toBe(before);});
 it('backs up exact bytes before returning a migrated game',()=>{
  const store=memory({[STORAGE_KEY]:raw}),r=loadGame(store,fixture.savedAt);
  expect(r.saveBlocked).not.toBe(true);expect(r.notice).toContain('v8 → v9');expect(store.getItem(BACKUP_KEY)).toBe(raw);expect(store.getItem(STORAGE_KEY)).toBe(raw);
  writeSave(store,r.state,fixture.savedAt);expect(loadGame(store,fixture.savedAt).notice).toBeNull();expect(readBackup(store)).toBe(raw);
 });
 it('keeps the first original and one newer replacement snapshot',()=>{const s=memory();preserveSave(s,raw);preserveSave(s,raw);const replacement=exportSave(createInitialState(),7);preserveSave(s,replacement);expect(s.getItem(BACKUP_KEY)).toBe(raw);expect(s.getItem(LATEST_BACKUP_KEY)).toBe(replacement);expect(readBackup(s)).toBe(replacement);});
 it.each(['throws','drops'])('blocks upgrade when backup %s',kind=>{const s:KeyValueStore={getItem:k=>k===STORAGE_KEY?raw:null,removeItem:()=>{},setItem:()=>{if(kind==='throws')throw Error('quota');}};const r=loadGame(s,fixture.savedAt);expect(r.saveBlocked).toBe(true);expect(r.notice).toContain('原存档未覆盖');expect(s.getItem(STORAGE_KEY)).toBe(raw);});
 it('refunds migrated research to the correct planet',()=>{const s=deserializeState(importSave(raw).state),before=activePlanet(s).resources,q=s.research.queue[0]!,n=cancelResearch(s,0).state;expect(activePlanet(n).resources.metal.eq(before.metal.add(q.paid.metal))).toBe(true);expect(activePlanet(n).resources.crystal.eq(before.crystal.add(q.paid.crystal))).toBe(true);});
 it('applies offline progress exactly once and preserves the original timestamp',()=>{const s=memory({[STORAGE_KEY]:raw}),r=loadGame(s,fixture.savedAt+60000);expect(r.appliedSeconds).toBe(60);expect(r.state.totalTime.sub(fixture.state.totalTime).toNumber()).toBeCloseTo(60);expect(s.getItem(BACKUP_KEY)).toBe(raw);writeSave(s,r.state,fixture.savedAt+60000);expect(loadGame(s,fixture.savedAt+60000).appliedSeconds).toBe(0);});
 it('does not produce negative time when the clock reverses',()=>{expect(loadGame(memory({[STORAGE_KEY]:raw}),fixture.savedAt-5000).appliedSeconds).toBe(0);});
 it('continues migrated research and ship queues with ordinary ticks',()=>{const s=deserializeState(importSave(raw).state),n=tick(s,300);expect(n.research.levels.computer_tech).toBeGreaterThan(s.research.levels.computer_tech);expect(activePlanet(n).units.small_cargo).toBeGreaterThan(activePlanet(s).units.small_cargo);expect(serializeState(deserializeState(importSave(exportSave(n)).state))).toEqual(serializeState(n));});
 it.each(['broken-json','future-version','invalid-v8','missing-resources'])('protects %s without replacing it',kind=>{const f=JSON.parse(raw);if(kind==='future-version')f.version=10;if(kind==='invalid-v8')f.state.planet.buildings.metal_mine=-1;if(kind==='missing-resources')delete f.state.resources;const text=kind==='broken-json'?'{broken':JSON.stringify(f),s=memory({[STORAGE_KEY]:text}),r=loadGame(s,fixture.savedAt);expect(r.saveBlocked).toBe(true);expect(s.getItem(STORAGE_KEY)).toBe(text);expect(()=>importSave(text)).toThrow();});
 it('rejects v9-shaped data relabeled as v8',()=>{const f=JSON.parse(exportSave(createInitialState()));f.version=8;expect(()=>importSave(JSON.stringify(f))).toThrow('v8 单星球存档结构不完整');});
});
