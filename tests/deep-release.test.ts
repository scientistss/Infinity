import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { big } from "../src/game/decimal";
import { tick, prestige } from "../src/game/logic";
import { emptyCargo, sendFleet, type FleetRequest } from "../src/game/fleet";
import { finishCharge, rollCharge } from "../src/game/deep-space";
import { setBet, revealAll } from "../src/game/arcade";
import { createOffer, summonMerchant, tradeQuote } from "../src/game/merchant";
import { fightEncounter } from "../src/game/encounter-combat";
import { exportSave, importSave, deserializeState, serializeState } from "../src/game/save";
import { chargeDeliveryStatus, retainChargeReports } from "../src/game/deep-state";
import { chargePreview, deepFlightDetails } from "../src/ui/deep-present";
import { DEEP } from "../src/data/deep-space";
import type { ArcadeSymbol } from "../src/data/arcade";
import type { GameState } from "../src/game/types";

function ready(): GameState {
  let s = createInitialState(42); const p = activePlanet(s);
  Object.assign(p.buildings, {metal_mine:20,crystal_mine:18,deuterium_synth:15,solar_plant:30,
    metal_storage:12,crystal_storage:12,deuterium_tank:12,shipyard:12,research_lab:12});
  p.resources = {metal:big(1e7),crystal:big(1e7),deuterium:big(1e8)};
  Object.assign(p.units,{large_cargo:500,light_fighter:1000,cruiser:500,recycler:50});
  Object.assign(s.research.levels,{astrophysics:16,computer_tech:10,combustion_drive:6,impulse_drive:6,
    hyperspace_drive:8,hyperspace_tech:8,weapons_tech:8,shielding_tech:8,armour_tech:8,laser_tech:12,ion_tech:6,plasma_tech:7});
  const colony = createPlanet("test-colony"); colony.coordinates={galaxy:2,system:1,position:1};
  s.planets.push(colony); s.darkMatter=big(1e6); s=tick(s,.01); s.arcade.runs=[]; return s;
}
function request(s:GameState,withBets=false):FleetRequest {
  return {mission:"charge",target:{...activePlanet(s).coordinates,position:16},
    ships:{large_cargo:20,light_fighter:30,cruiser:8},cargo:emptyCargo(),speedPercent:100,holdSlots:1,chargeWithBets:withBets};
}
function due(symbol:ArcadeSymbol,initial=ready(),withBets=false):GameState {
  const departure=sendFleet(initial,request(initial,withBets)); if(!departure.ok)throw Error(departure.reason);
  let s=tick(departure.state,departure.state.fleets[0]!.duration+59);
  for(let seed=1;seed<20000;seed++) {
    s={...s,deepSpace:{...s.deepSpace,seed}};
    if(rollCharge(s,s.fleets[0]!).rawSymbol===symbol)return {...s,fleets:s.fleets.map(f=>({...f,remaining:0,elapsed:60}))};
  }
  throw Error(`No deterministic seed for ${symbol}`);
}
function restore(s:GameState):GameState { return deserializeState(importSave(exportSave(s,1)).state); }

describe("deep-space release regressions",()=>{
  it("drifter loot depends on the origin shipyard, not the selected screen",()=>{
    const s=due("drifter",setBet(ready(),"drifter",12).state,true),other=selectPlanet(s,"test-colony");
    const a=finishCharge(s,s.fleets[0]!).state,b=finishCharge(other,other.fleets[0]!).state;
    expect(b.fleets).toEqual(a.fleets); expect(b.deepSpace).toEqual(a.deepSpace); expect(b.activePlanetId).toBe("test-colony");
  });
  it("JACKPOT honours paid departure bets rather than awarding metal",()=>{
    let s=due("jackpot",setBet(ready(),"deuterium",2).state,true); s=setBet(s,"metal",5).state;
    const r=finishCharge(s,s.fleets[0]!); expect(r.fleet!.cargo.deuterium.gt(0)).toBe(true);
    expect(r.fleet!.cargo.metal.eq(0)).toBe(true); expect(restore(r.state).fleets).toEqual(r.state.fleets);
  });
  it("a future merchant activation cannot trade early",()=>{
    let s=summonMerchant(ready()).state;const o=s.deepSpace.offers[0]!;
    s={...s,deepSpace:{...s.deepSpace,offers:[{...o,startsAt:s.totalTime.toNumber()+5}]}};
    expect(tradeQuote(s,o.id,"metal","crystal","1000").ok).toBe(false);
  });
  it("merchant creation refuses a nonexistent planet",()=>{expect(()=>createOffer(ready(),"missing-port",1,true)).toThrow();});
  it("merchant ID boundary refuses safely without charging DM",()=>{
    const s=ready();s.deepSpace.nextOfferId=Number.MAX_SAFE_INTEGER-1;const r=summonMerchant(s);
    expect(r.ok).toBe(false);expect(r.state).toBe(s);
  });
  it.each([{}, {weapons:NaN,shields:0,armour:0},{weapons:.5,shields:0,armour:0}])("combat refuses malformed tech",tech=>{
    expect(()=>fightEncounter({cruiser:3},{light_fighter:3},tech as any,{weapons:0,shields:0,armour:0},1)).toThrow();
  });
  it("replay cannot deliver cargo or mutate the input",()=>{
    const s=due("metal"),done=finishCharge(s,s.fleets[0]!).state,before=serializeState(done),replay=revealAll(done,"manual").state;
    expect(replay.planets).toEqual(done.planets);expect(replay.fleets).toEqual(done.fleets);expect(serializeState(done)).toEqual(before);
  });
  it("reset never reuses a retained receipt identity",()=>{
    const s=due("dark_matter"),done=finishCharge(s,s.fleets[0]!).state;done.lifetime.metal=big(1e10);
    const reset=prestige(done);expect(reset.nextFleetId).toBe(done.nextFleetId);expect(reset.deepSpace.completed).toBe(done.deepSpace.completed);
    expect(restore(reset).arcade.runs).toEqual(reset.arcade.runs);
  });
});

describe("release save consistency and clear status",()=>{
  it.each([
    ["replay landing",(f:any)=>{f.state.arcade.runs[0].outcome.main.tile=2;}],
    ["report target",(f:any)=>{f.state.deepSpace.reports[0].target.position=1;}],
    ["receipt ownership",(f:any)=>{f.state.arcade.runs[0].receipt.originId="test-colony";}],
    ["fake return",(f:any)=>{f.state.deepSpace.reports[0].returned=true;}],
    ["cross-fleet loot",(f:any)=>{f.state.fleets[0].charge.reportId="charge-999";}],
    ["invented cargo tech",(f:any)=>{f.state.fleets[0].charge.cargoFactor=51;}],
    ["fake protection",(f:any)=>{f.state.deepSpace.reports[0].protection="invented";}],
  ])("rejects inconsistent %s without changing source",(_label,corrupt)=>{
    const s=due("metal"),done=finishCharge(s,s.fleets[0]!).state,raw=exportSave(done,1),file=JSON.parse(raw);corrupt(file);
    expect(()=>importSave(JSON.stringify(file))).toThrow();expect(exportSave(done,1)).toBe(raw);
  });
  it.each([
    ["missing battle",(f:any)=>{f.state.deepSpace.reports[0].battle=null;}],
    ["increasing survivors",(f:any)=>{f.state.deepSpace.reports[0].battle.rounds[0].attacker=1e9;}],
    ["wrong winner",(f:any)=>{const b=f.state.deepSpace.reports[0].battle;b.winner=b.winner==="attacker"?"defender":"attacker";}],
  ])("rejects corrupted battle: %s",(_label,corrupt)=>{
    const s=due("pirate"),done=finishCharge(s,s.fleets[0]!).state,file=JSON.parse(exportSave(done,1));corrupt(file);
    expect(()=>importSave(JSON.stringify(file))).toThrow();
  });
  it("orphaned pending merchant cannot be imported",()=>{
    const s=due("merchant"),done=finishCharge(s,s.fleets[0]!).state,file=JSON.parse(exportSave(done,1));file.state.fleets=[];
    expect(()=>importSave(JSON.stringify(file))).toThrow("返航舰队");
  });
  it("a report retained across prestige is not displayed as forever returning",()=>{
    const s=due("metal");let done=finishCharge(s,s.fleets[0]!).state;
    expect(chargeDeliveryStatus(done,done.deepSpace.reports[0]!)).toBe("返航中");done.lifetime.metal=big(1e10);done=prestige(done);
    expect(chargeDeliveryStatus(done,done.deepSpace.reports[0]!)).toContain("任务已结束");expect(restore(done).deepSpace).toEqual(done.deepSpace);
  });
  it("report archive pins a slow active return",()=>{
    const s=due("metal"),done=finishCharge(s,s.fleets[0]!).state,first=done.deepSpace.reports[0]!;
    const reports=[first,...Array.from({length:80},(_,i)=>({...first,id:`charge-${i+2}`,fleetId:i+2,returned:true}))];
    const kept=retainChargeReports(reports,done.fleets);expect(kept).toHaveLength(DEEP.reportLimit);
    expect(kept[0]!.id).toBe(first.id);expect(kept.at(-1)!.id).toBe("charge-81");expect(reports).toHaveLength(81);
  });
  it("protection preview states remaining risk without mutating state",()=>{
    const s=ready(),before=exportSave(s,1),p=chargePreview(s,request(s));
    expect(p.risk).toContain("前 20 次");expect(p.risk).toContain("海盗与异星仍可造成战损");expect(p.capacity).toContain("余舱");
    expect(exportSave(s,1)).toBe(before);expect(chargePreview(s,{...request(s),ships:{}}).risk).toContain("有效编队");
  });
  it("flight details show actual ships and cargo",()=>{
    const s=due("metal"),done=finishCharge(s,s.fleets[0]!).state,detail=deepFlightDetails(done)[0]!;
    expect(detail.id).toBe(done.fleets[0]!.id);expect(detail.text).toContain("大型运输舰");expect(detail.text).toContain("舰载");
  });
  it("120 consecutive missions round-trip every phase with bounded history",()=>{
    let s=ready();s.deepSpace.seed=18227;
    for(let i=0;i<120;i++){
      s=revealAll(s,"manual").state;const r=sendFleet(s,{...request(s),holdSlots:1+i%3});expect(r.ok,r.reason).toBe(true);
      s=restore(r.state);s=tick(s,s.fleets[0]!.remaining);expect(restore(s).fleets).toEqual(s.fleets);
      s=tick(s,s.fleets[0]!.remaining);expect(restore(s).deepSpace).toEqual(s.deepSpace);
      while(s.fleets.length)s=tick(s,s.fleets[0]!.remaining);
      s=restore(s);expect(s.deepSpace.completed).toBe(i+1);expect(s.deepSpace.reports.length).toBeLessThanOrEqual(DEEP.reportLimit);
    }
  },15000);
});
