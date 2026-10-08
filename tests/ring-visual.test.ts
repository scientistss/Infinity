import { describe, it, expect } from "vitest";
import { ARCADE_SYMBOLS, BOARD } from "../src/data/arcade";
import { chargeChances } from "../src/data/deep-space";
import { ringArt, ringArtUrl, ringOdds, ringQueue, validOddsSource, historyKey, historySource } from "../src/ui/ring-model";
import { createInitialState } from "../src/game/state";
import { grantRun, revealRun, SYMBOL_CHANCE } from "../src/game/arcade";
import { serializeState } from "../src/game/save";
import type { ArcadeHistoryEntry } from "../src/game/arcade";

describe("ring visual model, no simulation side effects", () => {
  it("covers all 15 symbols and every tile with separate local images", () => {
    const files = ARCADE_SYMBOLS.map(s => ringArt(s).file);
    expect(files).toHaveLength(15); expect(new Set(files).size).toBe(15);
    for (const s of BOARD) {
      expect(ringArt(s).alt).not.toBe("");
      expect(ringArt(s).sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(ringArt(s).file).toMatch(/^icons\/ring-v1\/[a-z_]+\.[a-f0-9]{10}\.svg$/);
    }
  });
  it.each(["/Infinity/", "/Infinity", "/other/base/"])("respects base path %s", base => {
    expect(ringArtUrl("metal",base)).toBe(`${base.replace(/\/$/, "")}/${ringArt("metal").file}`);
  });
  it.each(["beacon", "charge-1", "charge-2", "charge-3"] as const)("%s probabilities come from actual rule tables and total 100", source => {
    const rows = ringOdds(source); expect(rows).toHaveLength(15);
    expect(rows.reduce((s,r) => s+r.percent,0)).toBeCloseTo(100,10);
    for (const row of rows) expect(row.percent).toBeCloseTo(source === "beacon" ? SYMBOL_CHANCE[row.symbol]*100 : chargeChances(Number(source.at(-1)))[row.symbol],10);
  });
  it("does not mix beacon and deep-space probabilities", () => {
    expect(ringOdds("beacon").find(r=>r.symbol==="blackhole")?.percent).toBe(0);
    expect(ringOdds("charge-1").find(r=>r.symbol==="blackhole")?.percent).toBe(1);
    expect(ringOdds("charge-3").find(r=>r.symbol==="empty")?.percent).toBe(12);
  });
  it.each(["charge-4", "charge-0", "charge-nan", "<script>", ""])("invalid source %s safely falls back to beacon", value => {
    expect(validOddsSource(value)).toBe("beacon");
  });
  it("empty queue does not expose a phantom result", () => {
    const q=ringQueue(createInitialState()); expect(q.count).toBe(0); expect(q.next).toBe("暂无待揭晓结果");
  });
  it("queue presentation never reveals the pre-rolled tile or mutates a save", () => {
    let s=createInitialState(22); s.research.levels.astrophysics=1; s=grantRun(s,"beacon").state;
    const before=serializeState(s); const first=ringQueue(s); const next={...s,arcade:{...s.arcade,runs:s.arcade.runs.map(r=>({...r,outcome:{...r.outcome,main:{...r.outcome.main,tile:(r.outcome.main.tile+1)%24}}}))}};
    expect(ringQueue(next)).toEqual(first); expect(serializeState(s)).toEqual(before);
    expect(first.action).toBe("开始跑灯"); expect(first.direct).toBe(1); expect(first.charge).toBe(0);
  });
  it("a charge receipt is visibly a replay, not a second reward", () => {
    let s=createInitialState(22); s.research.levels.astrophysics=1; s=grantRun(s,"beacon").state;
    s.arcade.runs[0]!.source="charge";
    const q=ringQueue(s); expect(q.action).toBe("回放下一次");expect(q.next).toContain("不再次发奖"); expect(q.charge).toBe(1);expect(q.direct).toBe(0);
  });
  it("history keys distinguish same-time outcomes with different details", () => {
    const a:ArcadeHistoryEntry={symbol:"metal",big:false,at:1,auto:false,summary:"金属+100"};
    expect(historyKey(a)).not.toBe(historyKey({...a,summary:"金属+200"}));
    expect(historySource(a)).toBe("信标／加注／奖励");
    expect(historySource({...a,summary:"深空事件回放：测试；金属+100"})).toBe("舰队充能回放");
  });
  it("history inspection after actual reveal never grants another prize", () => {
    let s=createInitialState(17);s.research.levels.astrophysics=1;s=grantRun(s,"beacon").state;s=revealRun(s,"manual").state;
    const before=serializeState(s);for(let i=0;i<20;i++){historyKey(s.arcade.history[0]!);historySource(s.arcade.history[0]!);ringQueue(s);}
    expect(serializeState(s)).toEqual(before);
  });
});
