import { describe, expect, it } from "vitest";
import { NAV_GROUPS, PAGE_META, matchesQuery, orbitalPoint, stageFor, slotStatus } from "../src/ui/command-model";
describe("command UI presentation policies",()=>{
  it("each existing page has exactly one navigation group and a title",()=>{
    const ids=NAV_GROUPS.flatMap(g=>[...g.tabs]);
    expect(ids).toHaveLength(15);expect(new Set(ids).size).toBe(15);
    expect(Object.keys(PAGE_META).sort()).toEqual([...ids].sort());
  });
  it.each(["trigger.kind","trigger.seconds"])("places %s in trigger",p=>expect(stageFor(p)).toBe("trigger"));
  it.each(["condition.0.value","condition.1.resource","condition.0.kind"])("places %s in condition",p=>expect(stageFor(p)).toBe("condition"));
  it.each(["action.building","action.kind","action.count"])("places %s in action",p=>expect(stageFor(p)).toBe("action"));
  it("search supports Chinese names, ids, case and whitespace",()=>{
    expect(matchesQuery("金属矿","metal_mine"," 金属 ")).toBe(true);
    expect(matchesQuery("金属矿","metal_mine","METAL")).toBe(true);
    expect(matchesQuery("金属矿","metal_mine"," ")).toBe(true);
    expect(matchesQuery("金属矿","metal_mine","晶体")).toBe(false);
  });
  it("all fifteen positions have unique inset coordinates",()=>{
    const points=Array.from({length:15},(_,i)=>orbitalPoint(i+1));
    expect(new Set(points.map(p=>`${p.x}:${p.y}`)).size).toBe(15);
    for(const p of points){expect(p.x).toBeGreaterThan(8);expect(p.x).toBeLessThan(92);expect(p.y).toBeGreaterThan(8);expect(p.y).toBeLessThan(92);}
  });
  it.each([NaN,Infinity,-5,0,16,100])("contains invalid schematic position %s",p=>{
    const a=orbitalPoint(p);expect(Number.isFinite(a.x)&&Number.isFinite(a.y)).toBe(true);
    expect(a.x).toBeGreaterThan(0);expect(a.y).toBeLessThan(100);
  });
  it("never shows a disabled or empty protocol as running",()=>{
    expect(slotStatus(true,"","green")).toBe("空槽位");
    expect(slotStatus(false,"已装入","green")).toBe("已停用");
    expect(slotStatus(true,"已装入","green")).toBe("已执行");
    expect(slotStatus(true,"已装入","red")).toBe("执行受阻");
    expect(slotStatus(true,"已装入","gray")).toBe("等待条件");
  });
});
