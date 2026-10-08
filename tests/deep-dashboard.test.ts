import { describe, expect, it } from "vitest";
import { chargeRows, merchantSummary, protectionSummary, reportMatches, validReportFilter } from "../src/ui/deep-dashboard-model";
import { createInitialState } from "../src/game/state";
import { activePlanet } from "../src/game/empire";
import { emptyCargo, sendFleet, recallFleet } from "../src/game/fleet";
import { tick } from "../src/game/logic";
import { big } from "../src/game/decimal";
import { createOffer } from "../src/game/merchant";
import { exportSave } from "../src/game/save";
import type { ChargeReport } from "../src/game/deep-state";

function launch() {
  const s = createInitialState(42), p = activePlanet(s);
  s.research.levels.astrophysics = 4; s.research.levels.combustion_drive = 4;
  p.units.small_cargo = 10; p.resources.deuterium = big(100000);
  const result = sendFleet(s, { mission: "charge", target: { ...p.coordinates, position: 16 }, ships: { small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100, holdSlots: 2 });
  expect(result.ok).toBe(true); return result.state;
}
function record(patch: Partial<ChargeReport> = {}): ChargeReport {
  return { id:"test", fleetId:1, originId:"homeworld",at:0,target:{galaxy:1,system:50,position:16}, slots:1,
    symbol:"merchant",rawSymbol:"merchant",protection:"",outcome:{main:{tile:22,big:false,u:.1,v:.1},lucky:null,forced:null},
    lines:[],returned:false,destroyed:false,battle:null,...patch };
}

describe("deep dashboard presentation", () => {
  it("new game has no invented fleet or trade", () => {
    const s=createInitialState(1);expect(chargeRows(s)).toEqual([]);expect(merchantSummary(s).usable).toBe(0);
  });
  it("shows departure, holding, and recall using actual fleet transitions", () => {
    const s=launch();expect(chargeRows(s)[0]?.phase).toBe("outbound");
    const holding=tick(s,s.fleets[0]!.duration+10);
    expect(chargeRows(holding)[0]?.stage).toBe("驻留充能");
    expect(chargeRows(holding)[0]?.progress).toBeCloseTo(100/12,7);
    const returning=recallFleet(holding,holding.fleets[0]!.id).state;
    expect(chargeRows(returning)[0]?.phase).toBe("return");expect(chargeRows(returning)[0]?.canRecall).toBe(false);
    expect(chargeRows(returning)[0]?.note).toContain("已召回");expect(chargeRows(returning)[0]?.reportId).toBe(null);
  });
  it("measures return progress against the actual leg, not an original outbound duration", () => {
    const s=launch();s.fleets[0]!.returning=true;s.fleets[0]!.remaining=5;s.fleets[0]!.elapsed=15;
    expect(chargeRows(s)[0]?.progress).toBe(75);
  });
  it("pre-event display is independent of RNG and future rolls", () => {
    const s=launch(),a=chargeRows(s);s.deepSpace.seed=999;s.arcade.seed=44;expect(chargeRows(s)).toEqual(a);
    expect(a[0]?.note).toContain("尚未生成结果");
  });
  it("does not mutate the saved state", () => {
    const s=launch(),before=exportSave(s,1);for(let i=0;i<10;i++){chargeRows(s);protectionSummary(s);merchantSummary(s);}
    expect(exportSave(s,1)).toBe(before);
  });
  it.each([[0,20],[19,1],[20,0]])("beginner boundary %i",(completed,left)=>{
    const s=createInitialState(1);s.deepSpace.completed=completed;
    expect(protectionSummary(s)).toContain(left?`剩余 ${left} 次`:"计次保护已结束");
  });
  it.each([[21,30],[50,1],[51,0]])("cooldown boundary %i",(completed,left)=>{
    const s=createInitialState(1);s.deepSpace.lastBlackhole=21;s.deepSpace.completed=completed;
    expect(protectionSummary(s)).toContain(left?`剩余 ${left} 次`:"计次保护已结束");
  });
  it("pending, depleted, and foreign quotes are not shown as tradable", () => {
    let s=createInitialState(1);s=createOffer(s,s.activePlanetId,7,false).state;
    expect(merchantSummary(s)).toMatchObject({usable:0,pending:1});
    s=createOffer(s,s.activePlanetId,8,true).state;expect(merchantSummary(s).usable).toBe(1);
    s.deepSpace.offers[1]!.remainingMe="0";expect(merchantSummary(s).usable).toBe(0);
    s.deepSpace.offers[1]!.remainingMe="20000";s.deepSpace.offers[1]!.planetId="elsewhere";
    expect(merchantSummary(s).usable).toBe(0);
  });
  it("an expired or future-started quote is not usable",()=>{
    let s=createInitialState(1);s=createOffer(s,s.activePlanetId,1,true).state;
    s.totalTime=big(s.deepSpace.offers[0]!.expiresAt);expect(merchantSummary(s).usable).toBe(0);
    s.totalTime=big(0);s.deepSpace.offers[0]!.startsAt=1;expect(merchantSummary(s).usable).toBe(0);
  });
  it.each(["bad", "", "<script>"])("invalid filter %s falls back to all",value=>expect(validReportFilter(value)).toBe("all"));
  it("distinguishes total loss and pending returns from ended tasks",()=>{
    const s=launch(),r=record();s.fleets[0]!.charge!.reportId=r.id;
    expect(reportMatches(s,r,"pending")).toBe(true);
    expect(reportMatches({...s,fleets:[]},r,"pending")).toBe(false);
    expect(reportMatches(s,{...r,destroyed:true},"loss")).toBe(true);
    expect(reportMatches(s,{...r,returned:true},"pending")).toBe(false);
    expect(reportMatches(s,r,"battle")).toBe(false);expect(reportMatches(s,r,"merchant")).toBe(true);
  });
});
