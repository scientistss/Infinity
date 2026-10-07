import { describe, expect, it } from "vitest";
import { activePlanet, empireResources, onPlanet, selectPlanet, withPlanet } from "../src/game/empire";
import { createPlanet, HOMEWORLD_ID } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import { big } from "../src/game/decimal";
import { economy } from "../src/game/economy";
import { emptyTickLog, prestige, tick, expansionScore } from "../src/game/logic";
import { enqueue, cancel } from "../src/game/queue";
import { cancelResearch, enqueueResearch } from "../src/game/research";
import { orderUnits } from "../src/game/shipyard";
import { equipCard, setProductionPct } from "../src/automation/engine";
import { accrueBeacons, grantRun, productionMe, revealRun, setBet, topUp } from "../src/game/arcade";
import { ARCADE_PHASE } from "../src/data/arcade";
import { catchUp } from "../src/core/offline";
import { deserializeState, exportSave, importSave, loadGame, serializeState, writeSave, type KeyValueStore } from "../src/game/save";
import { SAVE_SCHEMA, STORAGE_KEY } from "../src/game/content";
import { present } from "../src/ui/present";
import { rich, stateWith, withResearch } from "./helpers";
import type { GameState } from "../src/game/types";

const input = { status: "", banner: null, notice: null, catchup: null };
function twins(): GameState {
  const state = withResearch(rich(stateWith({ metal_mine: 10, crystal_mine: 8, deuterium_synth: 6, solar_plant: 20, robotics_factory: 3, research_lab: 4, shipyard: 4 }), 1e7), { combustion_drive: 6, energy_tech: 4 });
  const home = activePlanet(state);
  const other = createPlanet("colony-test");
  other.name = "冰海试验站";
  other.buildings = { ...home.buildings, metal_mine: 6, research_lab: 2 };
  other.resources = { metal: big(7e6), crystal: big(6e6), deuterium: big(5e6) };
  state.planets.push(other);
  state.arcade.seed = 12345;
  return state;
}
function frozen(state: GameState): GameState {
  function freeze(o: object): void {
    for (const v of Object.values(o)) if (v && typeof v === "object" && !Object.isFrozen(v)) freeze(v);
    Object.freeze(o);
  }
  freeze(state); return state;
}
function memory(initial: Record<string,string> = {}): KeyValueStore & { data: Record<string,string> } {
  const data = { ...initial };
  return { data, getItem:k=>data[k]??null, setItem:(k,v)=>{data[k]=v;}, removeItem:k=>{delete data[k];} };
}

describe("P4-1 canonical planets", () => {
  it("stores inventory in planets only and grants starting stock exactly once", () => {
    const s = createInitialState();
    expect(s).not.toHaveProperty("planet"); expect(s).not.toHaveProperty("resources");
    expect(s.planets).toHaveLength(1); expect(s.activePlanetId).toBe(HOMEWORLD_ID);
    expect(activePlanet(s).resources.metal.toNumber()).toBe(500);
    expect(createPlanet("new").resources.metal.toNumber()).toBe(0);
  });
  it("selecting changes no world data, invalid selection is a no-op", () => {
    const s = frozen(twins()); const selected = selectPlanet(s, "colony-test");
    expect(selected.planets).toBe(s.planets); expect(selected.research).toBe(s.research);
    expect(selectPlanet(s, "missing")).toBe(s); expect(s.activePlanetId).toBe(HOMEWORLD_ID);
  });
  it("rejects a missing canonical active world and a foreign replacement", () => {
    const s=twins(); expect(()=>activePlanet({...s,activePlanetId:"absent"})).toThrow("当前星球");
    expect(()=>withPlanet(s,{planet:s.planets[1]!})).toThrow("目标不一致");
    expect(()=>onPlanet(s,"absent",x=>x)).toThrow("星球不存在");
  });
  it("applies build cost and refunds only to the chosen world", () => {
    const s=frozen(twins()); const before=exportSave(s,1);
    const r=enqueue(selectPlanet(s,"colony-test"),"metal_mine","manual"); expect(r.ok).toBe(true);
    expect(r.state.planets[0]).toBe(s.planets[0]); expect(activePlanet(r.state).buildQueue).toHaveLength(1);
    const cancelled=cancel(r.state,0);expect(cancelled.ok).toBe(true);
    expect(activePlanet(cancelled.state).resources).toEqual(s.planets[1]!.resources);
    expect(exportSave(s,1)).toBe(before);
  });
  it("keeps energy settings, warehouses and shipyards independent", () => {
    let s=twins();const original=s.planets[1];
    s=setProductionPct(s,"metal_mine",0);s=orderUnits(s,"small_cargo",3,"manual").state;
    expect(s.planets[1]).toBe(original);expect(activePlanet(s).shipyardQueue).toHaveLength(1);
    expect(selectPlanet(s,"colony-test").planets[1]!.shipyardQueue).toHaveLength(0);
  });
  it("binds research cost, time and cancellation to its paying world", () => {
    const s=frozen(twins());const issued=enqueueResearch(s,"computer_tech","manual");expect(issued.ok).toBe(true);
    expect(issued.state.research.queue[0]?.planetId).toBe(HOMEWORLD_ID);
    const other=selectPlanet(issued.state,"colony-test");
    expect(other.research.queue[0]?.remainingSeconds).toBe(issued.state.research.queue[0]?.remainingSeconds);
    const result=cancelResearch(other,0).state;
    expect(result.activePlanetId).toBe("colony-test");
    expect(result.planets.map(p=>p.resources)).toEqual(s.planets.map(p=>p.resources));
  });
  it("reprices a queued research with each price difference returned to its original payer", () => {
    const start=twins();let s=enqueueResearch(start,"computer_tech","manual").state;
    s=enqueueResearch(selectPlanet(s,"colony-test"),"computer_tech","manual").state;
    const second=s.research.queue[1]!;const first=start.planets[0]!.resources;
    const result=cancelResearch(s,0).state;
    expect(result.research.queue[0]?.planetId).toBe("colony-test");
    expect(result.research.queue[0]?.targetLevel).toBe(1);
    expect(result.planets[0]!.resources).toEqual(first);
    const oldPaid=second.paid.metal;const newPaid=result.research.queue[0]!.paid.metal;
    expect(result.planets[1]!.resources.metal.eq(s.planets[1]!.resources.metal.add(oldPaid.sub(newPaid)))).toBe(true);
    expect(present(result,input).research.queue.items[0]?.label).toContain("冰海试验站");
  });
  it("enforces lab upgrade/research exclusion symmetrically across planets", () => {
    let s=twins();s=enqueue(s,"research_lab","manual").state;
    expect(enqueueResearch(selectPlanet(s,"colony-test"),"computer_tech","manual").ok).toBe(false);
    s=enqueueResearch(twins(),"computer_tech","manual").state;
    expect(enqueue(selectPlanet(s,"colony-test"),"research_lab","manual").ok).toBe(false);
  });
});

describe("P4-1 shared event clock", () => {
  it("advances time only once while summing the real output of both worlds", () => {
    let s=createInitialState();s.planets.push(createPlanet("colony-test"));s=tick(s,0);
    const rates=s.planets.map(p=>economy(selectPlanet(s,p.id)).gross);
    const next=tick(frozen(s),10);
    expect(next.totalTime.sub(s.totalTime).toNumber()).toBe(10);
    expect(next.lifetime.metal.sub(s.lifetime.metal).toNumber()).toBeCloseTo((rates[0]!.metal+rates[1]!.metal)*10,8);
    expect(expansionScore(next).gt(0)).toBe(true);
  });
  it("completes concurrent build and shipyard queues on nonselected planets", () => {
    let s=twins();for(const p of s.planets){s=onPlanet(s,p.id,x=>enqueue(x,"metal_mine","manual").state);s=onPlanet(s,p.id,x=>orderUnits(x,"small_cargo",2,"manual").state);}
    const before=exportSave(s,1),log=emptyTickLog();const n=tick(frozen(s),600,"offline",log);
    expect(n.activePlanetId).toBe(s.activePlanetId);
    for(const p of n.planets){expect(p.buildQueue).toHaveLength(0);expect(p.units.small_cargo).toBe(2);}
    expect(new Set(log.completedBuilds.map(b=>b.planetId)).size).toBe(2);
    expect(new Set(log.completedUnits.map(b=>b.planetId)).size).toBe(2);
    expect(exportSave(s,1)).toBe(before);
  });
  it("one long tick matches small ticks across all local and shared completion events", () => {
    let s=twins();s=onPlanet(s,"colony-test",x=>enqueue(x,"solar_plant","manual").state);
    s=orderUnits(s,"solar_satellite",20,"manual").state;s=enqueueResearch(s,"computer_tech","manual").state;
    const long=tick(s,180,"offline");let small=s;for(let i=0;i<1800;i++)small=tick(small,0.1,"offline");
    for(let i=0;i<2;i++){
      expect(long.planets[i]!.buildings).toEqual(small.planets[i]!.buildings);
      expect(long.planets[i]!.units).toEqual(small.planets[i]!.units);
      for(const res of ["metal","crystal","deuterium"] as const)expect(long.planets[i]!.resources[res].toNumber()).toBeCloseTo(small.planets[i]!.resources[res].toNumber(),5);
    }
    expect(long.research).toEqual(small.research);expect(long.arcade).toEqual(small.arcade);
  });
  it("keeps outcome independent of selected planet when no protocols act", () => {
    const s=twins();const a=tick(s,90);const b=tick(selectPlanet(s,"colony-test"),90);
    expect(serializeState({...b,activePlanetId:a.activePlanetId})).toEqual(serializeState(a));
  });
  it("does not run the single protocol rack once per planet", () => {
    let s=twins();s.manualClicks=100;s.unlockedCards=["auto_collect"];
    s=equipCard(s,0,"auto_collect").state;
    const before=s.planets[1]!.resources.metal;
    const next=tick(s,10);expect(next.planets[1]!.resources.metal.eq(before)).toBe(true);
    expect(next.planets[0]!.resources.metal.gt(s.planets[0]!.resources.metal)).toBe(true);
  });
  it("applies one shared offline cap, including beacon time, to all planets", () => {
    let s=twins();s.research.levels.astrophysics=1;s=tick(s,0);
    const offline=catchUp(s,100000);const exact=tick(s,7200,"offline");
    expect(offline.appliedSeconds).toBe(7200);expect(serializeState(offline.state)).toEqual(serializeState(exact));
    expect(offline.state.totalTime.sub(s.totalTime).toNumber()).toBe(7200);
  });
  it("keeps the resource capacity regimes independent", () => {
    const s=createInitialState();const p=createPlanet("colony-test");p.resources.metal=big(12500);s.planets.push(p);
    const next=tick(s,10);expect(next.planets[1]!.resources.metal.toNumber()).toBe(12500);
    expect(next.planets[0]!.resources.metal.gt(500)).toBe(true);
    expect(next.lifetime.metal.toNumber()).toBeLessThan(100);
  });
  it("does not leak a satellite completion boost into another world's preceding interval", () => {
    let s=twins();s=orderUnits(s,"solar_satellite",1,"manual").state;
    s=onPlanet(s,"colony-test",x=>withPlanet(x,{resources:{metal:big(0),crystal:big(0),deuterium:big(0)}}));
    const long=tick(s,20);let small=s;for(let i=0;i<200;i++)small=tick(small,0.1);
    expect(long.planets[1]!.resources.metal.toNumber()).toBeCloseTo(small.planets[1]!.resources.metal.toNumber(),7);
  });
});

describe("P4-1 ring machine preserved", () => {
  it("retains P3 phase and empire production is the sum of local production", () => {
    const s=twins();expect(ARCADE_PHASE).toBe(3);
    const total=s.planets.reduce((n,p)=>{const e=economy(selectPlanet(s,p.id)).gross;return n+e.metal+2*e.crystal+3*e.deuterium;},0);
    expect(productionMe(s)).toBeCloseTo(total,10);
  });
  it("switching, exporting and importing cannot reroll pending results", () => {
    const s=withResearch(twins(),{astrophysics:1});const issued=grantRun(s,"beacon").state;
    const selected=selectPlanet(issued,"colony-test");const restored=deserializeState(importSave(exportSave(selected,1)).state);
    expect(restored.arcade.runs).toEqual(issued.arcade.runs);expect(restored.arcade.seed).toBe(issued.arcade.seed);
  });
  it("deducts deuterium top-up only from the selected planet", () => {
    const s=withResearch(twins(),{astrophysics:1});const selected=selectPlanet(s,"colony-test");
    const next=topUp(selected);expect(next.ok).toBe(true);expect(next.state.planets[0]).toBe(s.planets[0]);
    expect(next.state.planets[1]!.resources.deuterium.lt(s.planets[1]!.resources.deuterium)).toBe(true);
  });
  it("pays a deterministic resource prize to the selected planet once", () => {
    let s=withResearch(twins(),{astrophysics:1});s=onPlanet(s,"colony-test",x=>withPlanet(x,{resources:{metal:big(0),crystal:big(0),deuterium:big(5e6)}}));
    s=grantRun(s,"beacon").state;
    s.arcade.runs[0]!.outcome={main:{tile:0,big:false,u:0.5,v:0.5},lucky:null,forced:null};
    s=setBet(s,"metal",0).state;
    const next=revealRun(selectPlanet(frozen(s),"colony-test"),"manual");expect(next.ok).toBe(true);
    expect(next.state.planets[0]).toBe(s.planets[0]);expect(next.state.planets[1]!.resources.metal.gt(0)).toBe(true);
    expect(revealRun(next.state,"manual").ok).toBe(false);
  });
  it("grants one periodic beacon, not one per world", () => {
    const s=withResearch(twins(),{astrophysics:1});const n=accrueBeacons(s,1800);expect(n.granted).toBe(1);
  });
  it("first-layer reset removes colonies but keeps ring results and shared research", () => {
    let s=withResearch(twins(),{astrophysics:1});s.lifetime.metal=big(1e8);s=tick(s,0);s=grantRun(s,"beacon").state;
    const next=prestige(selectPlanet(frozen(s),"colony-test"));expect(next.planets).toHaveLength(1);expect(next.activePlanetId).toBe(HOMEWORLD_ID);
    expect(next.research.levels).toEqual(s.research.levels);expect(next.arcade).toEqual(s.arcade);
  });
});

describe("P4-1 isolated save and display", () => {
  it("round-trips two planets, timers, production percentages and payer identity", () => {
    let s=twins();s=enqueue(s,"metal_mine","manual").state;
    s=enqueueResearch(selectPlanet(s,"colony-test"),"computer_tech","manual").state;
    s=orderUnits(s,"small_cargo",5,"manual").state;s=setProductionPct(s,"metal_mine",70);s=tick(s,0.25);
    expect(serializeState(deserializeState(importSave(exportSave(s,1)).state))).toEqual(serializeState(s));
  });
  it.each([
    ["empty planets",(r:any)=>{r.state.planets=[];}],
    ["duplicate IDs",(r:any)=>{r.state.planets.push(r.state.planets[0]);}],
    ["missing homeworld",(r:any)=>{r.state.planets[0].id="other";}],
    ["invalid active",(r:any)=>{r.state.activePlanetId="absent";}],
    ["foreign schema",(r:any)=>{r.schema="infinity-other";}],
    ["duplicate state",(r:any)=>{r.state.resources={metal:"1",crystal:"1",deuterium:"0"};}],
    ["infinite resources",(r:any)=>{r.state.planets[0].resources.metal="Infinity";}],
    ["negative resources",(r:any)=>{r.state.planets[0].resources.metal="-1";}],
    ["invalid temperature",(r:any)=>{r.state.planets[0].tempMax="nan";}],
    ["too many worlds",(r:any)=>{r.state.planets=Array(101).fill(r.state.planets[0]);}],
  ])("refuses %s without touching the source",(_name,corrupt)=>{
    const state=twins(),before=exportSave(state,1);const raw=JSON.parse(before);corrupt(raw);
    expect(()=>importSave(JSON.stringify(raw))).toThrow();expect(exportSave(state,1)).toBe(before);
  });
  it("rejects research whose paying planet no longer exists", () => {
    const s=enqueueResearch(twins(),"computer_tech","manual").state;const r=JSON.parse(exportSave(s,1));r.state.research.queue[0].planetId="missing";
    expect(()=>importSave(JSON.stringify(r))).toThrow("出资星球");
  });
  it("never reads or overwrites the old deployed save key", () => {
    const sentinel='existing live v9 bytes';const store=memory({"infinity.save.v1":sentinel});
    expect(loadGame(store,1).state.planets).toHaveLength(1);writeSave(store,twins(),1);
    expect(store.data['infinity.save.v1']).toBe(sentinel);expect(JSON.parse(store.data[STORAGE_KEY]!).schema).toBe(SAVE_SCHEMA);
  });
  it("backs up an old development save before its no-migration reset", () => {
    const old=JSON.stringify({version:8,state:{marker:"preserve original bytes"}});const store=memory({[STORAGE_KEY]:old});
    const result=loadGame(store,1);expect(result.notice).toContain("v8 → v9");expect(store.data[`${STORAGE_KEY}.backup`]).toBe(old);
    expect(store.data[STORAGE_KEY]).toBe(old);
  });
  it("stops old-save replacement if backup cannot be read back", () => {
    const old='{"version":8}';const store:KeyValueStore={getItem:k=>k===STORAGE_KEY?old:null,setItem:()=>{},removeItem:()=>{}};
    expect(()=>loadGame(store,1)).toThrow("备份失败");
  });
  it("presenter exposes selection and only the current world's resource values", () => {
    const s=twins();const a=present(s,input),b=present(selectPlanet(s,"colony-test"),input);
    expect(a.planets).toHaveLength(2);expect(a.resources[0]?.amount).not.toBe(b.resources[0]?.amount);
    expect(b.activePlanetId).toBe("colony-test");expect(a.queue.signature).toBe(b.queue.signature);
  });
  it("empire resource totals do not depend on current selection", () => {
    const s=twins();expect(empireResources(s)).toEqual(empireResources(selectPlanet(s,"colony-test")));
    expect(empireResources(s).metal.toNumber()).toBe(17e6);
  });
});
