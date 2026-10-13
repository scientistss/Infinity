import { describe, expect, it } from "vitest";
import { buildingTemplateBatchPanelHtml } from "../src/ui/building-template-batch-panel";
import { buildingTemplateBatchBudgetTotals, buildingTemplateBatchGapText, buildingTemplateBatchPlanetText } from "../src/ui/building-template-batch-present";
import { createInitialState } from "../src/game/state";
import source from "../src/ui/building-template-batch-panel.ts?raw";

const money = (metal = "0", crystal = "0", deuterium = "0") => ({metal, crystal, deuterium});
describe("multi-planet building-template presentation", () => {
  it("starts separately folded, without a preselected template or planet", () => {
    const html = buildingTemplateBatchPanelHtml();
    expect(html).toContain('<details id="building-template-batch" class="building-template-batch">');
    expect(html).toContain('<option value="">请明确选择模板</option>');
    expect(html).not.toMatch(/\bchecked\b|<details[^>]+\bopen\b/);
    expect(html).toContain("2–4"); expect(html).toContain("逐星、逐建筑、逐资源独立预算，默认 0");
    expect(html).toContain("固定上限，逐星实际入队时付款；登记不扣款");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length); expect(ids.every(id => id?.startsWith("building-template-batch"))).toBe(true);
  });
  it("adds exact decimal budgets without Number rounding", () => {
    const result = buildingTemplateBatchBudgetTotals([
      {budget:money("9007199254740993.000000000000000001", "0.1"), quote:money("9007199254740994", "0.3")},
      {budget:money("0.000000000000000001", "0.2"), quote:money("0", "0.2")},
    ]);
    expect(result.budget).toEqual(money("9007199254740993.000000000000000002", "0.3"));
    expect(result.shortfall).toEqual(money("0.999999999999999999", "0.2"));
  });
  it("never offsets one building's shortage with another building's surplus", () => {
    const result = buildingTemplateBatchBudgetTotals([{budget:money("100"), quote:money("5")}, {budget:money(), quote:money("20")}]);
    expect(result.budget).toEqual(money("100")); expect(result.shortfall).toEqual(money("20"));
    expect(buildingTemplateBatchGapText(result.shortfall)).toContain("不跨项调剂");
  });
  it("shows totals above a single-order money limit without making shared authority", () => {
    const cap = `1${"0".repeat(190)}`;
    const result = buildingTemplateBatchBudgetTotals([{budget:money(cap), quote:money("1")}, {budget:money(cap), quote:money("2")}]);
    expect(result.budget?.metal).toBe(`2${"0".repeat(190)}`); expect(result.shortfall).toEqual(money());
  });
  it("keeps unknown quotes and invalid budgets visibly unavailable", () => {
    expect(buildingTemplateBatchBudgetTotals([{budget:money("-1"), quote:money("2")}])).toEqual({budget:null, shortfall:null});
    expect(buildingTemplateBatchBudgetTotals([{budget:money("1"), quote:null}])).toEqual({budget:money("1"), shortfall:null});
    expect(buildingTemplateBatchGapText(null)).toContain("无法精确核对");
    expect(buildingTemplateBatchBudgetTotals([])).toEqual({budget:money(), shortfall:money()});
  });
  it("keeps untrusted names as text and uses explicit current identity", () => {
    const state = createInitialState(0x12345678, 0xabcdef12);
    state.planets[0]!.name = '<img src=x onerror="bad">';
    expect(buildingTemplateBatchPlanetText(state, "homeworld")).toContain('<img src=x onerror="bad">');
    expect(buildingTemplateBatchPlanetText(state, "missing")).toBe("missing（已不存在）");
    expect(source).not.toContain(".innerHTML");
    expect(source).toContain("caption.textContent = buildingTemplateBatchPlanetText");
    expect(source.match(/quoteBuildingTemplateBatch\(/g)).toHaveLength(1);
    expect(source).toContain("new WeakMap<HTMLButtonElement"); expect(source).toContain("token.action !== action");
  });
});
