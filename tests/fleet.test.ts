import { refreshUnlocks } from "../src/automation/engine";
import { describe, expect, it } from "vitest";
import { sendFleet, quoteFlight, flightSeconds, recallFleet, emptyCargo, abandonColony, type FleetRequest } from "../src/game/fleet";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { activePlanet } from "../src/game/empire";
import { coordinateKey, distance, npcAt, coordinateRandom } from "../src/game/galaxy";
import { big } from "../src/game/decimal";
import { tick, prestige } from "../src/game/logic";
import { catchUp } from "../src/core/offline";
import { exportSave, importSave, serializeState, deserializeState } from "../src/game/save";
import { rich, withResearch } from "./helpers";

function ready() {
  const s = withResearch(rich(createInitialState()), { computer_tech: 5, astrophysics: 3, impulse_drive: 3, combustion_drive: 2 });
  activePlanet(s).units.small_cargo = 20;
  activePlanet(s).units.colony_ship = 5;
  activePlanet(s).units.espionage_probe = 20;
  return refreshUnlocks(tick(s, 0));
}
function emptyPosition(state = ready(), start = 1) {
  for(let position = start; position <= 15; position++) {
    const c = { galaxy: 1, system: 51, position };
    if (!npcAt(state,c)) return c;
  }
  throw new Error("fixture has no empty slot");
}
function colonyRequest(s = ready()): FleetRequest {
  return { mission: "colonize", target: emptyPosition(s), ships: { colony_ship: 1, small_cargo: 1 }, cargo: { ...emptyCargo(), metal: big(2000), crystal: big(1200), deuterium: big(800) }, speedPercent: 100 };
}
function transportFixture() {
  const s = ready();
  s.planets.push({ ...createPlanet(), id: "second", name: "港口", homeworld:false, coordinates: { galaxy: 1, system: 51, position: 8 }, resources: { metal:big(10000), crystal:big(10000), deuterium:big(10000) } });
  const request: FleetRequest = { mission: "transport", target: {...s.planets[1]!.coordinates}, ships:{ small_cargo: 2 }, cargo: { metal:big(1000), crystal:big(200), deuterium:big(300) }, speedPercent:100 };
  return { s, request };
}

describe("procedural galaxy and OGame-scale flight math", () => {
  it("matches the documented 2,795 distance / 10% speed example", () => {
    expect(flightSeconds(2795,5000,10)).toBeCloseTo(69.04261076896519,4);
  });
  it("wraps galaxies and systems on a circular universe", () => {
    expect(distance({galaxy:1,system:1,position:1},{galaxy:5,system:1,position:1})).toBe(20000);
    expect(distance({galaxy:1,system:1,position:1},{galaxy:1,system:100,position:1})).toBe(2795);
    expect(distance({galaxy:1,system:1,position:1},{galaxy:1,system:1,position:15})).toBe(1070);
  });
  it("is deterministic without mutating the global random seed", () => {
    const s=ready(); const before=exportSave(s,1), c=emptyPosition(s);
    expect(coordinateRandom(s.universe.seed,c)).toBe(coordinateRandom(s.universe.seed,c));
    expect(npcAt(s,c)).toEqual(npcAt(deserializeState(importSave(before).state),c));
    expect(exportSave(s,1)).toBe(before);
  });
  it("rejects invalid coordinates and percentages", () => {
    expect(() => distance({galaxy:1,system:0,position:1},{galaxy:1,system:1,position:1})).toThrow();
    expect(() => flightSeconds(1,10,0)).toThrow();
  });
});
describe("fleet dispatch and transaction safety", () => {
  it("quotes without mutation, locks duration, and deducts ships, cargo and fuel once", () => {
    const s=ready(), request=colonyRequest(s), before=exportSave(s,1);
    const quote=quoteFlight(s,request);
    expect(quote.ok).toBe(true); expect(exportSave(s,1)).toBe(before);
    const sent=sendFleet(s,request);
    expect(sent.ok).toBe(true); expect(sent.state.fleets).toHaveLength(1);
    expect(activePlanet(sent.state).units.colony_ship).toBe(4);
    expect(activePlanet(sent.state).resources.deuterium.eq(activePlanet(s).resources.deuterium.sub(quote.fuel).sub(800))).toBe(true);
    expect(exportSave(s,1)).toBe(before);
  });
  it.each(["negative-ships","fractional-ships","too-many-ships","satellite","negative-cargo","nan-cargo","too-much-cargo","occupied","same-planet","zero-speed"])("rejects invalid requests atomically: %s",(kind)=>{
    const s=ready(), r=colonyRequest(s), before=exportSave(s,1);
    if(kind==="negative-ships") r.ships.colony_ship=-1;
    if(kind==="fractional-ships") r.ships.colony_ship=1.5;
    if(kind==="too-many-ships") r.ships.colony_ship=6;
    if(kind==="satellite") r.ships.solar_satellite=1;
    if(kind==="negative-cargo") r.cargo.metal=big(-1);
    if(kind==="nan-cargo") r.cargo.metal=big(NaN);
    if(kind==="too-much-cargo") r.cargo.metal=big("1e1000");
    if(kind==="same-planet") r.target={...activePlanet(s).coordinates};
    if(kind==="occupied") { r.mission="transport"; }
    if(kind==="zero-speed") r.speedPercent=0;
    const result=sendFleet(s,r);
    expect(result.ok).toBe(false); expect(result.state).toBe(s); expect(exportSave(s,1)).toBe(before);
  });
  it("applies the hyperspace technology cargo bonus",()=>{
    const s=ready(),r=colonyRequest(s),q=quoteFlight(s,r);
    expect(quoteFlight(withResearch(s,{hyperspace_tech:10}),r).capacity.div(q.capacity).toNumber()).toBe(1.5);
  });
  it("reserves colony slots and prevents duplicate target launches",()=>{
    let s=withResearch(ready(),{astrophysics:1}); const r=colonyRequest(s);
    s=sendFleet(s,r).state;
    expect(sendFleet(s,r).reason).toContain("在途");
    const other=colonyRequest(s); other.target=emptyPosition(s,r.target.position+1);
    expect(sendFleet(s,other).reason).toContain("名额不足");
  });
  it("enforces fleet slots including returning fleets",()=>{
    const {s,request}=transportFixture(); s.research.levels.computer_tech=0;
    const t=sendFleet(s,request).state;
    expect(sendFleet(t,request).reason).toContain("槽位已满");
  });
});
describe("fleet arrivals, offline boundaries and recalls",()=>{
  it("colonizes, consumes one colony ship, unloads cargo and returns escorts",()=>{
    const s=ready(), r=colonyRequest(s), sent=sendFleet(s,r).state, time=sent.fleets[0]!.duration;
    const arrived=tick(sent,time);
    expect(arrived.planets).toHaveLength(2);
    expect(arrived.planets[1]!.resources.metal.eq(2000)).toBe(true);
    expect(arrived.fleets[0]!.returning).toBe(true);
    expect(arrived.fleets[0]!.ships.colony_ship).toBe(0);
    const returned=tick(arrived,time);
    expect(returned.fleets).toHaveLength(0);
    expect(activePlanet(returned).units.colony_ship).toBe(4);
    expect(activePlanet(returned).units.small_cargo).toBe(20);
    expect(returned.planets[1]!.resources.metal.gt(2000)).toBe(true);
    expect(returned.totalTime.toNumber()).toBeCloseTo(time*2,9);
  });
  it("transport unloads above storage caps without counting it as new production",()=>{
    const {s,request}=transportFixture(); const sent=sendFleet(s,request).state;
    const end=tick(sent,sent.fleets[0]!.duration*2);
    expect(end.planets[1]!.resources.metal.eq(11000)).toBe(true);
    expect(end.planets[1]!.resources.deuterium.eq(10300)).toBe(true);
    expect(end.lifetime.metal.eq(s.lifetime.metal)).toBe(true);
    expect(end.fleets).toHaveLength(0);
    expect(activePlanet(end).units.small_cargo).toBe(20);
  });
  it("deployment settles ships and cargo at destination and does not return",()=>{
    const {s,request}=transportFixture(); request.mission="deploy";
    const sent=sendFleet(s,request).state;
    const end=tick(sent,sent.fleets[0]!.duration);
    expect(end.fleets).toHaveLength(0);
    expect(end.planets[1]!.units.small_cargo).toBe(2);
    expect(activePlanet(end).units.small_cargo).toBe(18);
  });
  it("recall returns only after elapsed travel time, with original cargo but no fuel refund",()=>{
    const {s,request}=transportFixture(); const quote=quoteFlight(s,request);
    const sent=sendFleet(s,request).state;
    const midway=tick(sent,sent.fleets[0]!.duration/2), elapsed=midway.fleets[0]!.elapsed;
    const recalled=recallFleet(midway,midway.fleets[0]!.id);
    expect(recalled.state.fleets[0]!.remaining).toBeCloseTo(elapsed,9);
    const end=tick(recalled.state,elapsed);
    expect(end.fleets).toHaveLength(0);
    expect(activePlanet(end).resources.deuterium.eq(activePlanet(s).resources.deuterium.sub(quote.fuel))).toBe(true);
    expect(end.planets[1]!.resources.metal.eq(10000)).toBe(true);
    expect(recallFleet(end,1).ok).toBe(false);
  });
  it("instant recall settles immediately and cannot duplicate ships",()=>{
    const {s,request}=transportFixture(); const sent=sendFleet(s,request).state;
    const recalled=recallFleet(sent,sent.fleets[0]!.id);
    expect(recalled.state.fleets).toHaveLength(0);
    expect(activePlanet(recalled.state).units.small_cargo).toBe(20);
    expect(recallFleet(recalled.state,sent.fleets[0]!.id).state).toBe(recalled.state);
  });
  it("single large tick equals small ticks with colony creation in the middle",()=>{
    const s=ready(),r=colonyRequest(s),sent=sendFleet(s,r).state;
    const dt=sent.fleets[0]!.duration*2+10;
    const long=tick(sent,dt);
    let short=sent; const n=300;
    for(let i=0;i<n;i++) short=tick(short,dt/n);
    expect(long.fleets).toEqual(short.fleets);
    expect(long.planets.length).toBe(short.planets.length);
    expect(long.planets[1]!.resources.metal.div(short.planets[1]!.resources.metal).toNumber()).toBeCloseTo(1,9);
    expect(long.messages.map(m=>m.text)).toEqual(short.messages.map(m=>m.text));
  });
  it("offline catch-up settles arrivals exactly once and retains the same simulation rules",()=>{
    const s=ready(),sent=sendFleet(s,colonyRequest(s)).state;
    const dt=sent.fleets[0]!.duration*2+60;
    const offline=catchUp(sent,dt).state,live=tick(sent,dt);
    expect(offline.fleets).toHaveLength(0); expect(offline.planets.length).toBe(2);
    expect(offline.planets[1]!.resources.metal.div(live.planets[1]!.resources.metal).toNumber()).toBeCloseTo(1,9);
    expect(tick(offline,1).planets.length).toBe(2);
  });
  it("pauses fleets together with the rest of the game beyond the offline cap",()=>{
    const s=ready(),sent=sendFleet(s,colonyRequest(s)).state;
    sent.fleets[0]!.duration=20000; sent.fleets[0]!.remaining=20000;
    const result=catchUp(sent,50000);
    expect(result.appliedSeconds).toBe(7200);
    expect(result.state.fleets[0]!.remaining).toBeCloseTo(12800,7);
    expect(result.state.planets).toHaveLength(1);
  });
  it("scouting creates a report and returns without a combat or reward side effect",()=>{
    const s=ready(),r=colonyRequest(s); r.mission="scout"; r.ships={espionage_probe:10,small_cargo:1}; r.cargo=emptyCargo();
    const sent=sendFleet(s,r).state, end=tick(sent,sent.fleets[0]!.duration*2);
    expect(end.messages.some(m=>m.text.includes(`侦察报告 [${coordinateKey(r.target)}]`))).toBe(true);
    expect(activePlanet(end).units.espionage_probe).toBe(20);
  });
  it("guards abandoning a mother world or a planet with related fleets",()=>{
    const {s,request}=transportFixture(); const sent=sendFleet(s,request).state;
    expect(abandonColony(s,"home").ok).toBe(false);
    expect(abandonColony(sent,"second").ok).toBe(false);
    expect(abandonColony(s,"second").state.planets).toHaveLength(1);
  });
  it("first-layer prestige clears all local planets and fleets but preserves the universe seed",()=>{
    const {s,request}=transportFixture(); const sent=sendFleet(s,request).state; sent.lifetime.metal=big(1e8);
    const end=prestige(sent);
    expect(end.planets).toHaveLength(1); expect(end.fleets).toHaveLength(0);
    expect(end.universe).toEqual(sent.universe);
  });
});
describe("fleet save validation",()=>{
  it("round-trips in-flight and returning states",()=>{
    const s=ready(), sent=sendFleet(s,colonyRequest(s)).state;
    for (const t of [sent,tick(sent,sent.fleets[0]!.duration)]) {
      const back=deserializeState(importSave(exportSave(t)).state);
      expect(serializeState(back)).toEqual(serializeState(t));
    }
  });
  it.each(["missing-origin","negative-time","bad-ship","duplicate-id","bad-next-id","bad-research-origin"])("rejects corrupted fleet linkage: %s",(kind)=>{
    const s=ready(),sent=sendFleet(s,colonyRequest(s)).state,raw=JSON.parse(exportSave(sent));
    if(kind==="missing-origin") raw.state.fleets[0].originId="gone";
    if(kind==="negative-time") raw.state.fleets[0].remaining=-1;
    if(kind==="bad-ship") raw.state.fleets[0].ships.rocket_launcher=1;
    if(kind==="duplicate-id") raw.state.fleets.push(raw.state.fleets[0]);
    if(kind==="bad-next-id") raw.state.nextFleetId=1;
    if(kind==="bad-research-origin") raw.state.research.queue=[{planetId:"gone",tech:"energy_tech",targetLevel:1,paid:{metal:"0",crystal:"800",deuterium:"400"},source:"manual",totalSeconds:1,remainingSeconds:1}];
    expect(()=>importSave(JSON.stringify(raw))).toThrow();
  });
});
