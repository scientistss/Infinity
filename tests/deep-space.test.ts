import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { tick, prestige } from "../src/game/logic";
import { catchUp } from "../src/core/offline";
import { sendFleet, quoteFlight, recallFleet, resolveFleetArrivals, emptyCargo, type FleetRequest, type Fleet } from "../src/game/fleet";
import { SHIP_IDS } from "../src/data/units";
import { DEEP, chargeChances } from "../src/data/deep-space";
import { type ArcadeSymbol } from "../src/data/arcade";
import { blackholeProtection, rollCharge, finishCharge, finishChargeReturn, addDebris, recycleDebris, fleetValue } from "../src/game/deep-space";
import { expeditionSlots, storedRunLimit, chargeReservations } from "../src/game/deep-state";
import { grantRun, revealAll, topUp, setBet } from "../src/game/arcade";
import { summonMerchant, createOffer, trade, tradeQuote } from "../src/game/merchant";
import { fightEncounter } from "../src/game/encounter-combat";
import { exportSave, importSave, deserializeState, serializeState, loadGame, type KeyValueStore } from "../src/game/save";
import { STORAGE_KEY } from "../src/game/content";
import type { GameState } from "../src/game/types";

function ready():GameState {
 let s=createInitialState(42);const p=activePlanet(s);
 Object.assign(p.buildings,{metal_mine:15,crystal_mine:12,deuterium_synth:10,solar_plant:20,metal_storage:10,crystal_storage:10,deuterium_tank:10,shipyard:6,research_lab:6});
 p.resources={metal:big(100000),crystal:big(100000),deuterium:big(1000000)};
 Object.assign(p.units,{small_cargo:200,large_cargo:100,light_fighter:300,cruiser:100,recycler:20,espionage_probe:10,colony_ship:4});
 Object.assign(s.research.levels,{astrophysics:4,computer_tech:8,combustion_drive:6,impulse_drive:4,hyperspace_tech:2,weapons_tech:4,shielding_tech:4,armour_tech:4});
 s.darkMatter=big(20000);s=tick(s,.01);s.arcade.runs=[];s.arcade.seed=771;s.deepSpace.seed=822;return s;
}
function request(s:GameState,slots=1):FleetRequest{return {mission:"charge",target:{...activePlanet(s).coordinates,position:16},ships:{small_cargo:5,light_fighter:30,cruiser:8},cargo:emptyCargo(),speedPercent:100,holdSlots:slots};}
function depart(s=ready(),slots=1){const r=sendFleet(s,request(s,slots));if(!r.ok)throw Error(r.reason);return r.state;}
function hold(s=depart()){return tick(s,s.fleets[0]!.remaining);}
function seedFor(s:GameState,symbol:ArcadeSymbol){for(let seed=1;seed<20000;seed++){if(rollCharge({...s,deepSpace:{...s.deepSpace,seed}},s.fleets[0]!).rawSymbol===symbol)return {...s,deepSpace:{...s.deepSpace,seed}};}throw Error(`seed ${symbol}`);}
function settle(s:GameState){return tick(s,s.fleets[0]!.remaining);}
function clone(s:GameState){return deserializeState(importSave(exportSave(s,1)).state);}
function freeze(s:GameState):GameState{const visit=(o:object)=>{for(const v of Object.values(o))if(v&&typeof v==="object"&&!Object.isFrozen(v))visit(v);Object.freeze(o);};visit(s);return s;}
function mem(raw:string):KeyValueStore&{data:Record<string,string>}{const data:Record<string,string>={[STORAGE_KEY]:raw,'infinity.save.v1':'EXISTING LIVE'};return {data,getItem:k=>data[k]??null,setItem:(k,v)=>{data[k]=v;},removeItem:k=>{delete data[k];}};}

describe("deep-space quote and phase machine",()=>{
 it.each([1,2,3])("%i segments: outbound, hold, roll once, return to origin",slots=>{
  const s=ready(),req=request(s,slots),q=quoteFlight(s,req);expect(q.ok).toBe(true);expect(q.holdSeconds).toBe(slots*60);
  const start=depart(freeze(s),slots);expect(s.fleets).toHaveLength(0);expect(start.arcade.runs).toHaveLength(0);
  const waiting=hold(start);expect(waiting.fleets[0]?.charge?.phase).toBe('holding');expect(waiting.fleets[0]?.remaining).toBe(slots*60);
  const near=tick(waiting,slots*60-.1);expect(near.deepSpace.completed).toBe(0);expect(near.arcade.runs).toHaveLength(0);
  const finish=settle(seedFor(near,'dark_matter'));expect(finish.deepSpace.completed).toBe(1);expect(finish.fleets[0]?.charge?.phase).toBe('return');
  expect(finish.arcade.runs[0]?.source).toBe('charge');expect(finish.deepSpace.reports[0]?.returned).toBe(false);expect(finish.darkMatter.eq(waiting.darkMatter)).toBe(true);
  const arrived=settle(finish);expect(arrived.fleets).toHaveLength(0);expect(arrived.deepSpace.reports[0]?.returned).toBe(true);expect(arrived.darkMatter.gt(finish.darkMatter)).toBe(true);
  expect(activePlanet(arrived).units.cruiser).toBe(activePlanet(s).units.cruiser);expect(clone(arrived).deepSpace).toEqual(arrived.deepSpace);
 });
 it.each([0,4,-1,1.5,NaN,Infinity])("rejects invalid hold %s atomically",holdSlots=>{const s=ready();const r=sendFleet(s,{...request(s),holdSlots});expect(r.ok).toBe(false);expect(r.state).toBe(s);});
 it("requires a deep position and astrophysics",()=>{const s=ready();expect(quoteFlight(s,{...request(s),target:{...request(s).target,position:15}}).ok).toBe(false);s.research.levels.astrophysics=0;expect(quoteFlight(s,request(s)).ok).toBe(false);});
 it("outbound and return both occupy expedition slots",()=>{let s=ready();s.research.levels.astrophysics=1;s=depart(s);expect(expeditionSlots(s)).toBe(1);expect(quoteFlight(s,request(s)).ok).toBe(false);s=settle(seedFor(hold(s),'empty'));expect(chargeReservations(s)).toBe(0);expect(quoteFlight(s,request(s)).ok).toBe(false);});
 it("reserves result capacity against topup/beacon races",()=>{let s=ready();while(s.arcade.runs.length<storedRunLimit(s)-1)s=grantRun(s,'bonus').state;s=depart(s);expect(chargeReservations(s)).toBe(1);expect(grantRun(s,'bonus').granted).toBe(false);expect(topUp(s).ok).toBe(false);s=settle(seedFor(hold(s),'empty'));expect(s.arcade.runs.length).toBe(storedRunLimit(s));});
 it("cannot invent a charge receipt with the generic grant API",()=>{const s=ready();expect(grantRun(s,'charge').state).toBe(s);});
 it("pre-rolled results survive saving and do not touch beacon RNG",()=>{const s=seedFor(hold(),'metal'),seed=s.arcade.seed;const a=settle(s),b=settle(clone(s));expect(a.deepSpace).toEqual(b.deepSpace);expect(a.arcade.seed).toBe(seed);expect(a.arcade.runs).toEqual(b.arcade.runs);});
 it("repeating the completion callback cannot create another roll",()=>{const waiting=seedFor(hold(),'empty');const due={...waiting,fleets:waiting.fleets.map(f=>({...f,remaining:0,elapsed:60}))};const once=finishCharge(due,due.fleets[0]!);const twice=finishCharge(once.state,due.fleets[0]!);expect(twice.state).toBe(once.state);expect(twice.state.deepSpace.completed).toBe(1);});
 it("switching planet does not redirect cargo, items or merchant ownership",()=>{let s=ready();const p=createPlanet('other');p.coordinates={galaxy:2,system:1,position:1};s.planets.push(p);s=depart(s);s=seedFor(hold(s),'supply');s=selectPlanet(s,'other');const result=settle(s);expect(result.fleets[0]?.originId).toBe('homeworld');expect(result.deepSpace.reports[0]?.originId).toBe('homeworld');const done=settle(result);expect(done.activePlanetId).toBe('other');expect(done.planets[1]!.units).toEqual(p.units);expect(Object.values(done.items).reduce((a,b)=>a+b,0)).toBeGreaterThan(Object.values(s.items).reduce((a,b)=>a+b,0));});
 it("replaying the ring receipt cannot pay twice or spend current bets",()=>{let s=settle(seedFor(hold(),'dark_matter'));s=setBet(s,'metal',12).state;const before=serializeState(s);const replay=revealAll(s,'manual').state;expect(replay.planets).toEqual(s.planets);expect(replay.fleets).toEqual(s.fleets);expect(replay.darkMatter).toEqual(s.darkMatter);expect(replay.deepSpace).toEqual(s.deepSpace);expect(replay.arcade.runs).toHaveLength(0);expect(serializeState(s)).toEqual(before);});
 it("recall during flight refunds stake at port, not fuel",()=>{let s=setBet(ready(),'metal',1).state;const req={...request(s),chargeWithBets:true};const q=quoteFlight(s,req),stock=activePlanet(s).resources.deuterium;s=sendFleet(s,req).state;const half=s.fleets[0]!.duration/2;s=tick(s,half);const before=activePlanet(s).resources.deuterium;const recalled=recallFleet(s,s.fleets[0]!.id);expect(recalled.ok).toBe(true);expect(activePlanet(recalled.state).resources.deuterium).toEqual(before);expect(recalled.state.fleets[0]?.remaining).toBeCloseTo(half);const done=settle(recalled.state);expect(done.deepSpace.completed).toBe(0);expect(activePlanet(done).resources.deuterium.gte(stock.sub(q.fuel))).toBe(true);expect(done.arcade.runs).toHaveLength(0);});
 it("recall while holding cancels the result and uses a full return journey",()=>{const s=hold();const r=recallFleet(s,s.fleets[0]!.id);expect(r.ok).toBe(true);expect(r.state.fleets[0]?.remaining).toBe(s.fleets[0]?.duration);expect(recallFleet(r.state,s.fleets[0]!.id).ok).toBe(false);expect(settle(r.state).deepSpace.completed).toBe(0);});
 it("charge bets are frozen and deducted once on dispatch",()=>{let s=setBet(ready(),'metal',2).state;const req={...request(s),chargeWithBets:true},q=quoteFlight(s,req),before=activePlanet(s).resources.deuterium;s=sendFleet(s,req).state;expect(before.sub(activePlanet(s).resources.deuterium).toNumber()).toBeCloseTo(q.fuel.toNumber()+q.stake!,5);s=setBet(s,'metal',0).state;s=settle(seedFor(hold(s),'metal'));expect(s.fleets[0]?.charge?.bets.metal).toBe(2);expect(s.deepSpace.reports[0]?.lines.some(l=>l.includes('充能押中'))).toBe(true);});
 it("one long offline tick matches many segments across hold and return",()=>{const s=seedFor(hold(),'pirate'),long=tick(s,300,'offline');let short=s;for(let i=0;i<300;i++)short=tick(short,1,'offline');expect(short.deepSpace).toEqual(long.deepSpace);expect(short.fleets).toEqual(long.fleets);for(let i=0;i<long.planets.length;i++)for(const r of ['metal','crystal','deuterium'] as const)expect(long.planets[i]!.resources[r].toNumber()).toBeCloseTo(short.planets[i]!.resources[r].toNumber(),5);});
 it("offline cap is shared by production and charging",()=>{const s=depart();const done=catchUp(s,1e5);expect(done.appliedSeconds).toBe(7200);expect(done.state.totalTime.sub(s.totalTime).toNumber()).toBeCloseTo(7200,6);expect(done.state.deepSpace.completed).toBe(1);expect(done.state.fleets).toHaveLength(0);});
});

describe("probabilities, black-hole protection and six-round encounters",()=>{
 it.each([1,2,3])("%i-slot base probabilities total exactly 100",n=>{expect(Object.values(chargeChances(n)).reduce((a,b)=>a+b,0)).toBe(100);expect(chargeChances(n).empty).toBe(20-4*(n-1));});
 it.each([0,19])("protects completion after %i earlier runs",n=>{let s=hold();s.deepSpace.completed=n;s=seedFor(s,'blackhole');const done=settle(s);expect(done.deepSpace.reports[0]?.symbol).toBe('turbulence');expect(done.deepSpace.lastBlackhole).toBe(0);expect(done.fleets).toHaveLength(1);});
 it("21st completion can lose only this fleet and creates no debris",()=>{let s=hold();s.deepSpace.completed=20;s=seedFor(s,'blackhole');const units=activePlanet(s).units;const done=settle(s);expect(done.deepSpace.reports[0]?.destroyed).toBe(true);expect(done.deepSpace.lastBlackhole).toBe(21);expect(done.fleets).toHaveLength(0);expect(done.deepSpace.debris).toHaveLength(0);expect(activePlanet(done).units).toEqual(units);});
 it("cooldown protects exactly the next 30 completion indices",()=>{const s=hold();s.deepSpace.lastBlackhole=21;s.deepSpace.completed=50;expect(blackholeProtection(s,s.fleets[0]!)).toContain('30');s.deepSpace.completed=51;expect(blackholeProtection(s,s.fleets[0]!)).toBe('');});
 it("fleet share above 50%, but not equal to 50%, is protected",()=>{const s=hold();s.deepSpace.completed=30;for(const id of SHIP_IDS)activePlanet(s).units[id]=0;
    const f=s.fleets[0]!;for(const id of SHIP_IDS)activePlanet(s).units[id]=f.ships[id]??0;
    expect(fleetValue(f.ships)).toBeGreaterThan(0);expect(blackholeProtection(s,f)).toBe('');
    activePlanet(s).units.cruiser-=1;expect(blackholeProtection(s,f)).toContain('50%');});
 it.each(['pirate','alien'] as const)("%s produces real losses, <=6 rounds and salvage",symbol=>{const s=seedFor(hold(),symbol),before=serializeState(s);const done=settle(freeze(s)),r=done.deepSpace.reports[0]!;expect(r.battle).not.toBeNull();expect(r.battle!.rounds.length).toBeGreaterThan(0);expect(r.battle!.rounds.length).toBeLessThanOrEqual(6);expect(r.battle!.mode).toBe('squadron-v1');expect(done.deepSpace.debris.length).toBeGreaterThan(0);expect(serializeState(s)).toEqual(before);expect(clone(done).deepSpace).toEqual(done.deepSpace);});
 it("combat is deterministic, simultaneous and scales by types",()=>{const a={light_fighter:1e12,cruiser:1e10},b={light_fighter:1e12,cruiser:2e10},tech={weapons:2,shields:2,armour:2};const t=performance.now();const r=fightEncounter(a,b,tech,tech,12);expect(performance.now()-t).toBeLessThan(1000);expect(r).toEqual(fightEncounter(a,b,tech,tech,12));expect(a.light_fighter).toBe(1e12);expect(r.rounds).toHaveLength(6);for(const n of r.rounds){expect(Number.isFinite(n.attackDamage)).toBe(true);expect(n.attacker).toBeGreaterThanOrEqual(0);}});
 it("combat rejects noninteger counts instead of allocating ships",()=>{const t={weapons:0,shields:0,armour:0};expect(()=>fightEncounter({light_fighter:1.5},{cruiser:1},t,t,1)).toThrow();expect(()=>fightEncounter({light_fighter:1e13},{cruiser:1},t,t,1)).toThrow();});
 it("first-layer reset does not reset black-hole protection counters",()=>{let s=ready();s.deepSpace.completed=60;s.deepSpace.lastBlackhole=55;s.lifetime.metal=big(1e10);s=prestige(s);expect(s.deepSpace.completed).toBe(60);expect(s.deepSpace.lastBlackhole).toBe(55);expect(s.deepSpace.offers).toHaveLength(0);expect(s.deepSpace.debris).toHaveLength(0);});
});

describe("merchant and physical salvage",()=>{
 it("calling charges DM once and preserves fixed quote through save",()=>{const s=ready(),r=summonMerchant(s);expect(r.ok).toBe(true);expect(r.state.darkMatter.toNumber()).toBe(s.darkMatter.toNumber()-DEEP.merchantCallDm);expect(summonMerchant(r.state).ok).toBe(false);expect(clone(r.state).deepSpace.offers).toEqual(r.state.deepSpace.offers);});
 it("merchant signal is unusable until its actual fleet returns",()=>{let s=settle(seedFor(hold(),'merchant'));const o=s.deepSpace.offers[0]!;expect(o.startsAt).toBe(-1);expect(tradeQuote(s,o.id,'metal','crystal','1000').ok).toBe(false);s=settle(s);expect(s.deepSpace.offers[0]?.expiresAt).toBeCloseTo(s.totalTime.toNumber()+600,7);expect(tradeQuote(s,o.id,'metal','crystal','1000').ok).toBe(true);});
 it("trade consumes stock and quota without incrementing lifetime",()=>{const s=summonMerchant(ready()).state,id=s.deepSpace.offers[0]!.id,q=tradeQuote(s,id,'metal','crystal','1000');expect(q.ok).toBe(true);const r=trade(freeze(s),id,'metal','crystal','1000');expect(r.ok).toBe(true);expect(activePlanet(s).resources.metal.sub(activePlanet(r.state).resources.metal).toNumber()).toBe(1000);expect(activePlanet(r.state).resources.crystal.sub(activePlanet(s).resources.crystal).toNumber()).toBe(q.received.toNumber());expect(r.state.lifetime).toEqual(s.lifetime);expect(big(r.state.deepSpace.offers[0]!.remainingMe).lt(s.deepSpace.offers[0]!.remainingMe)).toBe(true);});
 it("fixed quote reverse trade cannot generate resources",()=>{const s=summonMerchant(ready()).state,id=s.deepSpace.offers[0]!.id,a=tradeQuote(s,id,'metal','crystal','1000');const b=tradeQuote(trade(s,id,'metal','crystal','1000').state,id,'crystal','metal',a.received.toString());expect(b.received.lt(1000)).toBe(true);});
 it.each(['-1','0','NaN','Infinity','1.5','1e400','', '<script>'])('rejects bad trade amount %s',amount=>{const s=summonMerchant(ready()).state,r=trade(s,s.deepSpace.offers[0]!.id,'metal','crystal',amount);expect(r.ok).toBe(false);expect(r.state).toBe(s);});
 it("wrong planet, expired or full warehouse cannot trade",()=>{let s=summonMerchant(ready()).state;const id=s.deepSpace.offers[0]!.id,p=createPlanet('other');p.coordinates={galaxy:2,system:1,position:1};s.planets.push(p);expect(tradeQuote(selectPlanet(s,p.id),id,'metal','crystal','1000').ok).toBe(false);activePlanet(s).resources.crystal=big(1e100);expect(tradeQuote(s,id,'metal','crystal','1000').ok).toBe(false);s={...s,totalTime:big(s.deepSpace.offers[0]!.expiresAt)};expect(tradeQuote(s,id,'metal','deuterium','1000').ok).toBe(false);});
 it("recycle pickups subtract exactly once and return to the origin",()=>{let s=ready(),target=request(s).target;s=addDebris(s,target,big(40000),big(20000));const req:FleetRequest={mission:'recycle',target,ships:{recycler:1},cargo:emptyCargo(),speedPercent:100};expect(quoteFlight(s,req).ok).toBe(true);s=sendFleet(s,req).state;const life=s.lifetime;const near=settle(s),f=near.fleets[0]!,got=f.cargo.metal.add(f.cargo.crystal);expect(got.toNumber()).toBe(22000);expect(big(near.deepSpace.debris[0]!.metal).add(near.deepSpace.debris[0]!.crystal).add(got).toNumber()).toBe(60000);expect(resolveFleetArrivals(near)).toBe(near);const done=settle(near);expect(done.fleets).toHaveLength(0);expect(done.lifetime.metal.gte(life.metal)).toBe(true);expect(clone(done).deepSpace).toEqual(done.deepSpace);});
 it("two recyclers racing cannot duplicate a depleted field",()=>{const s=ready(),target=request(s).target;const withField=addDebris(s,target,big(2),big(1));const f:Fleet={id:1,originId:s.activePlanetId,target,mission:'recycle',ships:{recycler:1},cargo:emptyCargo(),duration:1,remaining:0,elapsed:1,returning:false,orderTransport:null};const a=recycleDebris(withField,f),b=recycleDebris(a.state,{...f,id:2});expect(a.fleet.cargo.metal.toNumber()).toBe(2);expect(b.fleet.cargo.metal.toNumber()).toBe(0);expect(a.state.deepSpace.debris).toHaveLength(0);});
 it("rejects salvage without collectors or debris",()=>{const s=ready(),target=request(s).target;expect(quoteFlight(s,{...request(s),mission:'recycle'}).ok).toBe(false);expect(quoteFlight(s,{...request(s),mission:'recycle',ships:{recycler:1}}).ok).toBe(false);s.deepSpace.debris.push({target,metal:'1',crystal:'0'});expect(quoteFlight(s,{...request(s),mission:'recycle',ships:{recycler:1}}).ok).toBe(true);});
});

describe("deep save validation and compatibility",()=>{
 it.each(['outbound','holding','return'])("round-trips %s exactly",phase=>{let s=depart();if(phase!=='outbound')s=hold(s);if(phase==='return')s=settle(seedFor(s,'metal'));expect(serializeState(clone(s))).toEqual(serializeState(s));});
 it("backed-up r2 migration preserves old fleet and pending beacons",()=>{
  const s=ready(),file=JSON.parse(exportSave(s,1000));
  file.revision=2;delete file.state.orders;delete file.state.deepSpace;delete file.state.arcade.nextRunId;delete file.state.arcade.autoBatch;
  for(const run of file.state.arcade.runs)delete run.id;
  const raw=JSON.stringify(file),store=mem(raw),loaded=loadGame(store,1000);
  expect(loaded.state.planets).toEqual(s.planets);
  const {nextRunId,autoBatch,...arcade}=loaded.state.arcade;
  expect({...arcade,runs:arcade.runs.map(({id:_id,...run})=>run)}).toEqual(file.state.arcade);
  expect(arcade.runs.map(run=>run.id)).toEqual(arcade.runs.map((_,index)=>index+1));
  expect(nextRunId).toBe(arcade.runs.length+1);expect(autoBatch).toBeNull();
  expect(store.data[STORAGE_KEY+'.backup']).toBe(raw);expect(store.data['infinity.save.v1']).toBe('EXISTING LIVE');
  expect(store.data[STORAGE_KEY]).toBe(raw);expect(loaded.state.deepSpace.completed).toBe(0);
 });
 it("r3 migration preserves deep charge outcomes, receipts, RNG and economy",()=>{const s=settle(seedFor(hold(),'metal')),file=JSON.parse(exportSave(s,1000));file.revision=3;delete file.state.orders;for(const fleet of file.state.fleets)delete fleet.orderTransport;delete file.state.arcade.nextRunId;delete file.state.arcade.autoBatch;for(const run of file.state.arcade.runs)delete run.id;const raw=JSON.stringify(file),loaded=importSave(raw).state;expect(loaded.deepSpace).toEqual(file.state.deepSpace);expect(loaded.fleets.map(({orderTransport:_tag,...fleet})=>fleet)).toEqual(file.state.fleets);expect(loaded.planets).toEqual(file.state.planets);expect(loaded.arcade.seed).toBe(file.state.arcade.seed);expect(loaded.arcade.runs.map(({id:_id,...run})=>run)).toEqual(file.state.arcade.runs);expect(loaded.arcade.runs.map(run=>run.id)).toEqual([1]);expect(loaded.arcade.nextRunId).toBe(2);expect(loaded.arcade.autoBatch).toBeNull();});
 it("r2 upgrade refuses to proceed when backup cannot be read",()=>{const r=JSON.parse(exportSave(ready(),1));r.revision=2;delete r.state.orders;delete r.state.deepSpace;delete r.state.arcade.nextRunId;delete r.state.arcade.autoBatch;for(const run of r.state.arcade.runs)delete run.id;const raw=JSON.stringify(r),store:KeyValueStore={getItem:k=>k===STORAGE_KEY?raw:null,setItem:()=>{},removeItem:()=>{}};expect(()=>loadGame(store,1)).toThrow('备份');});
 it.each([
  ['absent deep state',(f:any)=>{delete f.state.deepSpace;}],['negative count',(f:any)=>{f.state.deepSpace.completed=-1;}],
  ['future revision',(f:any)=>{f.revision=999;}],['r2 smuggled state',(f:any)=>{f.revision=2;}],
  ['invalid hold',(f:any)=>{f.state.fleets[0].charge.slots=5;}],['invalid timer',(f:any)=>{f.state.fleets[0].remaining=1e5;}],
  ['invalid phase',(f:any)=>{f.state.fleets[0].charge.phase='return';}],['premature loot',(f:any)=>{f.state.fleets[0].charge.dm=50;}],
  ['invalid bet',(f:any)=>{f.state.fleets[0].charge.stake=5;}],['invalid target',(f:any)=>{f.state.fleets[0].target.position=3;}],
  ['unsupported items',(f:any)=>{f.state.fleets[0].charge.items.other=1;}],['no receipt',(f:any)=>{f.state.arcade.runs=[{source:'charge',outcome:{main:{tile:0,big:false,u:.2,v:.2},lucky:null,forced:null}}];}],
 ])('rejects %s',(_name,mutate)=>{const s=depart(),file=JSON.parse(exportSave(s,1));mutate(file);expect(()=>importSave(JSON.stringify(file))).toThrow();});
 it("reserves a safe ticket ID for each in-flight charge when importing",()=>{const file=JSON.parse(exportSave(depart(),1));file.state.arcade.nextRunId=Number.MAX_SAFE_INTEGER;expect(()=>importSave(JSON.stringify(file))).toThrow('安全票号');file.state.arcade.nextRunId=Number.MAX_SAFE_INTEGER-1;expect(importSave(JSON.stringify(file)).state.arcade.nextRunId).toBe(Number.MAX_SAFE_INTEGER-1);});
 it("finished charge receipts cannot duplicate IDs on import",()=>{const s=settle(seedFor(hold(),'metal'));const file=JSON.parse(exportSave(s,1));file.state.arcade.runs.push(file.state.arcade.runs[0]);expect(()=>importSave(JSON.stringify(file))).toThrow();});
 it("non-cargo return callback is idempotent",()=>{const s=settle(seedFor(hold(),'dark_matter')),f=s.fleets[0]!;const due={...s,fleets:[{...f,remaining:0,elapsed:f.remaining}]};const a=finishChargeReturn(due,due.fleets[0]!);expect(finishChargeReturn(a,due.fleets[0]!)).toBe(a);});
 it("merchant offers have bounded independent ratios",()=>{const s=ready();for(let seed=0;seed<50;seed++){const {state}=createOffer(s,s.activePlanetId,seed,true);const o=state.deepSpace.offers[0]!;expect(o.ratios.metal).toBeGreaterThanOrEqual(2.55);expect(o.ratios.metal).toBeLessThanOrEqual(3.45);expect(clone(state).deepSpace.offers).toEqual(state.deepSpace.offers);}});
});
