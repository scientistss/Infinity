import { describe, expect, it } from "vitest";
import { catchUp } from "../src/core/offline";
import { big } from "../src/game/decimal";
import { commitDemolition, quoteDemolition } from "../src/game/demolition";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { evaluatePrestige } from "../src/game/logic";
import { createInitialState, createPlanet } from "../src/game/state";
import { demolitionLosses, demolitionOfflineRows, demolitionPreview } from "../src/ui/demolition-present";
import { DemolitionReview } from "../src/ui/demolition-review-model";
import { prestigeConfirmation, prestigePreview } from "../src/ui/prestige-preview-model";
import { protocolSlotPermissions } from "../src/ui/protocol-safety";

/** Explicit synthetic unit fixture; natural paid progression is tested separately. */
function ready() {
  const state = createInitialState(321, 654), planet = activePlanet(state);
  planet.buildings.metal_storage = 9;
  planet.buildings.robotics_factory = 10;
  planet.buildings.nanite_factory = 1;
  planet.resources = { metal: big(2920000), crystal: big(1e6), deuterium: big(1e6) };
  return state;
}

describe("manual demolition review and losses", () => {
  it("shows exact fee, retained overstock, real fractional time and one-field loss without mutation", () => {
    const state = ready(), snapshot = JSON.stringify(state);
    const result = quoteDemolition(state, "metal_storage");
    expect(result.ok, result.reason).toBe(true);
    const model = demolitionPreview(state, result.quote!);
    expect(model.title).toContain("9 → 8");
    expect(model.fee).toBe("拆除费：金属 128000 / 晶体 0 / 重氢 0");
    expect(model.time).toContain("14");
    expect(model.totalSeconds).toBeCloseTo(768 / 55, 12);
    expect(model.losses.join("\n")).toContain("2920000 → 1590000");
    expect(model.losses.join("\n")).toContain("现有超仓资源保留");
    expect(model.losses.join("\n")).toContain("对应自然生产暂停");
    expect(model.losses.join("\n")).toContain("不返还历史建造投入");
    expect(model.losses.join("\n")).toContain("实际拆除费 100%");
    expect(model.losses.join("\n")).toContain("其他已授权自动建造仍可运行");
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("dismissal is read-only and retired consent cannot be reused on the next identical review", () => {
    const state = ready(), review = new DemolitionReview(), snapshot = JSON.stringify(state);
    review.open(state, "metal_storage", true);
    const old = review.token;
    review.invalidate();
    expect(review.consume(state, old)).toBeNull();
    review.open(state, "metal_storage", true);
    expect(review.consume(state, old)).toBeNull();
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("resource growth keeps consent, while confirmation makes a fresh quote and is single-use", () => {
    const state = ready(), review = new DemolitionReview();
    const original = review.open(state, "metal_storage", true)!;
    const token = review.token;
    activePlanet(state).resources.metal = big(3000000);
    review.observe(state, true);
    expect(review.quote).toBe(original);
    const fresh = review.consume(state, token)!;
    expect(fresh).not.toBe(original);
    expect(fresh.fingerprint).toBe(original.fingerprint);
    expect(review.consume(state, token)).toBeNull();
    expect(commitDemolition(state, fresh).ok).toBe(true);
  });

  it("fresh affordability refuses payment and consumes review without changing resources", () => {
    const state = ready(), review = new DemolitionReview();
    review.open(state, "metal_storage", true); const token = review.token;
    activePlanet(state).resources.metal = big(1);
    const snapshot = JSON.stringify(state);
    expect(review.consume(state, token)).toBeNull();
    expect(review.reason).toContain("资源不足");
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("live wallet preflight disables an unaffordable review and recovers from fresh resources only", () => {
    const state = ready(), review = new DemolitionReview();
    activePlanet(state).resources.metal = big(1);
    review.open(state, "metal_storage", true);
    expect(review.quote).not.toBeNull();
    expect(review.paymentProblem(state)).toContain("资源不足");
    activePlanet(state).resources.metal = big(200000);
    review.observe(state, true);
    expect(review.paymentProblem(state)).toBe("");
    review.observe(state, false); review.observe(state, true);
    expect(review.paymentProblem(state)).not.toBe("");
  });

  it("planet A→B→A observed without a paint permanently retires the old review", () => {
    const state = ready(), review = new DemolitionReview();
    state.planets.push(createPlanet("other"));
    review.open(state, "metal_storage", true); const token = review.token;
    review.observe(selectPlanet(state, "other"), true);
    review.observe(state, true);
    expect(review.consume(state, token)).toBeNull();
    expect(activePlanet(state).demolition).toBeNull();
  });

  it("input/capability invalidation cannot revive on matching values", () => {
    const state = ready(), review = new DemolitionReview();
    review.open(state, "metal_storage", true); const token = review.token;
    review.invalidate("输入已改变");
    review.observe(state, true);
    expect(review.consume(state, token)).toBeNull();
  });

  it.each(["ion", "level", "protocol", "world"])("observed %s A→B→A retires confirmation", kind => {
    const state = ready(), review = new DemolitionReview();
    review.open(state, "metal_storage", true); const token = review.token;
    if (kind === "ion") state.research.levels.ion_tech = 1;
    if (kind === "level") activePlanet(state).buildings.robotics_factory = 9;
    if (kind === "world") state.stats.launches++;
    if (kind === "protocol") state.protocols.slots[0]!.card = { id: "auto_collect", enabled: true, trigger: { kind: "interval", seconds: 5 }, conditions: [], action: { kind: "collect" } };
    review.observe(state, true);
    if (kind === "ion") state.research.levels.ion_tech = 0;
    if (kind === "level") activePlanet(state).buildings.robotics_factory = 10;
    if (kind === "world") state.stats.launches--;
    if (kind === "protocol") state.protocols.slots[0]!.card = null;
    review.observe(state, true);
    expect(review.consume(state, token)).toBeNull();
  });

  it("protection and same-ID imported-world invalidation never revive an old review", () => {
    const state = ready(), review = new DemolitionReview();
    review.open(state, "metal_storage", true); const old = review.token;
    review.observe(state, false); review.observe(state, true);
    expect(review.consume(state, old)).toBeNull();
    review.open(state, "metal_storage", true); const imported = review.token;
    review.invalidate("存档已替换"); review.observe(state, true);
    expect(review.consume(state, imported)).toBeNull();
    expect(review.open(state, "metal_storage", false)).toBeNull();
  });

  it("shows actual robot slot relocking and retained-config warning", () => {
    const state = ready(); activePlanet(state).buildings.robotics_factory = 2;
    state.protocols.slots[1]!.card = { id: "auto_collect", enabled: true, trigger: { kind: "interval", seconds: 5 }, conditions: [], action: { kind: "collect" } };
    const quote = quoteDemolition(state, "robotics_factory").quote!;
    const text = demolitionLosses(state, quote).join("\n");
    expect(text).toContain("可用协议槽 2 → 1");
    expect(text).toContain("槽2将锁定：自动采集（已启用）");
    expect(text).toContain("锁槽保留配置与启用状态但不执行");
    expect(text).toContain("解锁后仍启用的卡可能重建");
  });

  it.each(["research_lab", "shipyard", "nanite_factory", "missile_silo"] as const)("shows %s consequential domain losses", building => {
    const state = ready(); activePlanet(state).buildings[building] = 2;
    const quote = quoteDemolition(state, building).quote!;
    const text = demolitionLosses(state, quote).join("\n");
    expect(text).toContain(building === "research_lab" ? "本站不参与研究网络" : building === "missile_silo" ? "导弹槽 20 → 10" : "禁止本星新增造船与防御付款");
  });
});

describe("locked protocol controls", () => {
  it("allows only explicit off or clear for an enabled locked card; recovery is freshly derived", () => {
    const state = createInitialState(123, 456);
    state.protocols.slots[1]!.card = { id: "auto_collect", enabled: true, trigger: { kind: "interval", seconds: 5 }, conditions: [], action: { kind: "collect" } };
    expect(protocolSlotPermissions(state, 1, true)).toMatchObject({ unlocked: false, canToggle: true, canClear: true, canEdit: false, canMoveUp: false, canMoveDown: false });
    expect(protocolSlotPermissions(state, 1, false)).toMatchObject({ canToggle: false, canClear: false, canEdit: false });
    state.protocols.slots[1]!.card!.enabled = false;
    expect(protocolSlotPermissions(state, 1, true)).toMatchObject({ canToggle: false, canClear: true, canEdit: false });
    state.research.levels.computer_tech = 2;
    expect(protocolSlotPermissions(state, 1, true)).toMatchObject({ unlocked: true, canToggle: true, canClear: true, canEdit: true });
    expect(state.protocols.slots[1]!.card!.enabled).toBe(false);
  });
});

describe("prestige demolition loss", () => {
  it("counts only this paid demolition fee, explicitly lost without refund on launch", () => {
    let state = ready(); state.lifetime.metal = big(1e8);
    state = commitDemolition(state, quoteDemolition(state, "metal_storage").quote!).state;
    const evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.eligible).toBe(true);
    expect(model.paid.demolitions).toBe(1);
    expect(model.paid.demolitionPaid).toEqual({ metal: "128000", crystal: "0", deuterium: "0" });
    expect(model.paid.buildings).toBe(0);
    expect(model.rows.some(row => row.text.includes("拆除 #") && row.text.includes("取消不退款"))).toBe(true);
    expect(prestigeConfirmation(state, evaluation)).toContain("拆除 1 项");
    expect(activePlanet(evaluation.next).demolition).toBeNull();
  });

  it("accounts for all planets' demolition jobs separately and retires each in the candidate", () => {
    let state = ready(); state.lifetime.metal = big(1e8);
    const colony = createPlanet("loss-colony");
    colony.buildings.metal_storage = 1;
    colony.resources.metal = big(1000);
    state.planets.push(colony);
    state = commitDemolition(state, quoteDemolition(state, "metal_storage").quote!).state;
    state = selectPlanet(state, colony.id);
    const second = commitDemolition(state, quoteDemolition(state, "metal_storage").quote!);
    expect(second.ok, second.reason).toBe(true);
    state = second.state;
    const evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.paid.demolitions).toBe(2);
    expect(model.paid.demolitionPaid).toEqual({ metal: "128500", crystal: "0", deuterium: "0" });
    expect(model.rows.filter(row => row.text.includes("拆除 #"))).toHaveLength(2);
    expect(evaluation.next.planets.every(planet => planet.demolition === null)).toBe(true);
  });
});

describe("offline demolition receipt", () => {
  it("shows the actual lowering once without counting it as construction or returning the fee", () => {
    let state = ready();
    state = commitDemolition(state, quoteDemolition(state, "metal_storage").quote!).state;
    const jobId = activePlanet(state).demolition!.jobId;
    const result = catchUp(state, 30);
    expect(result.completedBuilds).toEqual([]);
    expect(demolitionOfflineRows(result)).toHaveLength(1);
    expect(demolitionOfflineRows(result)[0]).toContain(`9 → 8 · #${jobId}`);
    expect(demolitionOfflineRows(result)[0]).toContain("无资源返还");
    expect(demolitionOfflineRows(catchUp(result.state, 30))).toEqual([]);
    expect(demolitionOfflineRows(null)).toEqual([]);
  });
});
