import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHIP_IDS, UNIT_IDS, type UnitId } from "../src/data/units";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { orderUnits, SHIPYARD } from "../src/game/shipyard";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { installManualUnitControls, type ManualUnitUiAction } from "../src/ui/manual-unit-controls";
import * as quotes from "../src/ui/manual-unit-quote";
import { shipyardPanelsHtml, updateShipyardCards } from "../src/ui/shipyard-panel";
import { shipyardView } from "../src/ui/shipyard-present";

/** Deterministic controller doubles; real layout and trusted input need native browser evidence. */
class TestElement {
  parentElement: TestElement | null = null;
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<() => void>>();
  style = { display: "", visibility: "", opacity: "", contentVisibility: "" };
  rects = [{ width: 100, height: 20 }];
  computed = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible" };
  getClientRects() { return this.rects; }
  classList = { toggle: (_name: string, _force?: boolean) => false };
  disabled = false; value = ""; textContent = ""; connectedRoot = false;
  constructor(public id = "") {}
  get parentNode(): TestElement | null { return this.parentElement; }
  get childElementCount(): number { return this.children.length; }
  get isConnected(): boolean { return this.connectedRoot || !!this.parentElement?.isConnected; }
  get hidden(): boolean { return this.attributes.has("hidden"); }
  set hidden(value: boolean) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) {
    const oldValue = this.getAttribute(name); this.attributes.set(name, value);
    TestObserver.attribute(this, name, oldValue);
  }
  removeAttribute(name: string) {
    const oldValue = this.getAttribute(name);
    if (!this.attributes.delete(name)) return;
    TestObserver.attribute(this, name, oldValue);
  }
  contains(node: TestElement): boolean { return this === node || this.children.some(child => child.contains(node)); }
  append(node: TestElement) { node.parentElement?.remove(node); node.parentElement = this; this.children.push(node); }
  remove(node: TestElement) {
    this.children = this.children.filter(child => child !== node); node.parentElement = null;
    for (const observer of TestObserver.instances) if (observer.parents.get(this)?.childList) observer.records.push({ type: "childList", target: this, removedNodes: [node] } as unknown as MutationRecord);
  }
  matches(selector: string): boolean {
    const match = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
    return !!match && this.dataset[match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] === match[2];
  }
  querySelectorAll(selector: string): TestElement[] {
    const found: TestElement[] = [];
    const visit = (node: TestElement) => { for (const child of node.children) { if (child.matches(selector)) found.push(child); visit(child); } };
    visit(this); return found;
  }
  querySelector(selector: string): TestElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type: string, callback: () => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); }
  emit(type: string) { for (const callback of this.listeners.get(type) ?? []) callback(); }
}
class TestObserver {
  static instances: TestObserver[] = [];
  parents = new Map<TestElement, MutationObserverInit>(); records: MutationRecord[] = [];
  constructor(_callback: MutationCallback) { TestObserver.instances.push(this); }
  observe(parent: TestElement, options: MutationObserverInit) { this.parents.set(parent, options); }
  takeRecords() { const records = this.records; this.records = []; return records; }
  disconnect() { this.parents.clear(); }
  static attribute(node: TestElement, name: string, oldValue: string | null) {
    for (const observer of this.instances) {
      const options = observer.parents.get(node);
      if (options?.attributes && (!options.attributeFilter || options.attributeFilter.includes(name))) observer.records.push({ type: "attributes", target: node, attributeName: name, oldValue, removedNodes: [] } as unknown as MutationRecord);
    }
  }
}
function readyState(): GameState {
  const state = createInitialState(20261012, 55), planet = activePlanet(state);
  planet.resources = { metal: big(1e14), crystal: big(1e14), deuterium: big(1e14) };
  planet.buildings.shipyard = 20; planet.buildings.missile_silo = 20;
  for (const key of Object.keys(state.research.levels) as Array<keyof typeof state.research.levels>) state.research.levels[key] = 100;
  return state;
}
function fixture(id: UnitId = "small_cargo") {
  const documentRoot = new TestElement(); documentRoot.connectedRoot = true;
  const body = new TestElement(), root = new TestElement(); documentRoot.append(body); body.append(root);
  vi.stubGlobal("document", documentRoot);
  const panels = ["shipyard", "defense"].map(tab => { const node = new TestElement(); node.dataset.tabPanel = tab; root.append(node); return node; });
  panels[0]!.hidden = !(SHIP_IDS as readonly UnitId[]).includes(id); panels[1]!.hidden = !panels[0]!.hidden;
  const nodes = new Map<string, TestElement>();
  const make = (bind: string, parent: TestElement) => { const node = new TestElement(); node.dataset.bind = bind; nodes.set(bind, node); parent.append(node); return node; };
  for (const unit of UNIT_IDS) {
    const panel = panels[(SHIP_IDS as readonly UnitId[]).includes(unit) ? 0 : 1]!, card = make(`ucard-${unit}`, panel);
    for (const prefix of ["uqty", "upay", "uquote", "utotal", "umode-hint", "umanual-reason", "uowned", "uqueued", "ustats", "umob", "ucost", "utime", "ureason"]) make(`${prefix}-${unit}`, card);
    nodes.get(`uqty-${unit}`)!.value = "1";
    const pay = nodes.get(`upay-${unit}`)!; pay.dataset.action = "manual-unit-pay"; pay.dataset.id = unit;
    for (const [prefix, mode] of [["ubuild", "count"], ["ufill", "fill"], ["umax", "max"]]) {
      const button = make(`${prefix}-${unit}`, card); Object.assign(button.dataset, { action: "manual-unit-mode", id: unit, mode });
    }
  }
  let state = readyState();
  const actions: ManualUnitUiAction[] = [], accepted: Array<{ id: UnitId; count: number }> = [];
  const hooks: { beforeConsume?: (action: ManualUnitUiAction) => void; skipConsume?: boolean; allowOrderFailure?: boolean } = {};
  const controls = installManualUnitControls(root as unknown as HTMLElement, action => {
    actions.push(action); hooks.beforeConsume?.(action);
    if (hooks.skipConsume) return;
    const decision = controls.consume(action, state);
    if (!decision) return;
    accepted.push(decision);
    const result = orderUnits(state, decision.id, decision.count, "manual");
    if (!hooks.allowOrderFailure) expect(result.ok, result.reason).toBe(true); state = result.state;
    controls.observe(state, true, ""); paint();
  });
  const find = (prefix: string, unit = id) => nodes.get(`${prefix}-${unit}`)!;
  const mode = (value: "count" | "fill" | "max", unit = id) => find(value === "count" ? "ubuild" : value === "fill" ? "ufill" : "umax", unit).emit("click");
  const edit = (raw: string, unit = id) => { find("uqty", unit).value = raw; find("uqty", unit).emit("input"); };
  function paint() { controls.update(shipyardView(state, "both")); }
  controls.observe(state, true, ""); paint();
  return { root, body, documentRoot, panels, controls, hooks, actions, accepted, find, mode, edit, paint,
    get state() { return state; }, set state(next: GameState) { state = next; },
    pay: () => find("upay").emit("click"), input: find("uqty"), button: find("upay"), card: find("ucard"), reason: find("umanual-reason") };
}
beforeEach(() => { TestObserver.instances = []; vi.stubGlobal("Element", TestElement); vi.stubGlobal("MutationObserver", TestObserver); vi.stubGlobal("getComputedStyle", (node: TestElement) => node.computed); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("manual unit confirmation markup", () => {
  it("has all 24 preserved text drafts, mode-only selectors and one payment per card", () => {
    const html = shipyardPanelsHtml(() => "");
    expect((html.match(/type="text"/g) ?? [])).toHaveLength(24);
    expect((html.match(/inputmode="numeric"/g) ?? [])).toHaveLength(24);
    expect((html.match(/data-action="manual-unit-mode"/g) ?? [])).toHaveLength(72);
    expect((html.match(/data-action="manual-unit-pay"/g) ?? [])).toHaveLength(24);
    expect(html).not.toContain('data-action="build-units"'); expect(html).not.toContain('type="number"');
    for (const id of UNIT_IDS) expect(html).toContain(`data-bind="upay-${id}" disabled`);
  });
});

describe("manual unit thin confirmation controller", () => {
  it.each(UNIT_IDS)("quotes and pays exactly one default %s through the shared entry", id => {
    const f = fixture(id), before = JSON.stringify(f.state);
    expect(f.input.value).toBe("1"); expect(f.button.disabled).toBe(false);
    expect(f.find("uquote").textContent).toContain("当前星球"); expect(f.find("uquote").textContent).toContain("本次新增 1");
    for (const resource of ["金属", "晶体", "重氢"]) expect(f.find("utotal").textContent).toContain(resource);
    f.mode("count"); expect(f.actions).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before);
    f.pay(); expect(f.accepted).toEqual([{ id, count: 1 }]); expect(activePlanet(f.state).shipyardQueue.at(-1)!.unit).toBe(id);
    expect(f.button.disabled).toBe(true); expect(f.reason.textContent).toContain("本次报价已使用");
  });
  it.each(["", " ", "0", "-1", "1.5", "1e3", "abc", "+2", "1 2", "9007199254740992", "1".repeat(129)])("keeps invalid raw %j and every economic field unchanged", raw => {
    const f = fixture(), before = JSON.stringify(f.state);
    for (const mode of ["count", "fill"] as const) {
      f.edit(raw); f.mode(mode); f.paint(); expect(f.input.value).toBe(raw); expect(f.button.disabled).toBe(true);
      expect(f.find("utotal").textContent).toBe("金属 0 · 晶体 0 · 重氢 0");
      f.button.disabled = false; f.pay(); expect(f.actions).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before);
    }
  });
  it("preserves trimmed leading-zero text and pays its actual positive integer", () => {
    const f = fixture(); f.edit(" 00012 "); f.paint(); expect(f.input.value).toBe(" 00012 ");
    expect(f.find("utotal").textContent).toBe("金属 24,000 · 晶体 24,000 · 重氢 0");
    f.pay(); expect(f.accepted[0]!.count).toBe(12); expect(f.input.value).toBe(" 00012 ");
  });
  it("max ignores retained invalid text, disables it, and switching back rejects it", () => {
    const f = fixture(); f.edit("nonsense"); const before = JSON.stringify(f.state); f.mode("max");
    expect(f.input.disabled).toBe(true); expect(f.input.value).toBe("nonsense"); expect(f.button.disabled).toBe(false);
    expect(f.find("umode-hint").textContent).toContain("不使用输入数量"); expect(JSON.stringify(f.state)).toBe(before);
    f.mode("fill"); expect(f.input.disabled).toBe(false); expect(f.button.disabled).toBe(true); expect(f.input.value).toBe("nonsense");
    f.mode("max"); f.pay(); expect(f.accepted[0]!.count).toBe(SHIPYARD.maxBatch);
  });
  it("uses local owned plus paid remaining queue for fill, including zero-addition denial", () => {
    const f = fixture(); activePlanet(f.state).units.small_cargo = 3;
    f.state = orderUnits(f.state, "small_cargo", 4, "manual").state;
    activePlanet(f.state).shipyardQueue[0]!.count = 3; activePlanet(f.state).shipyardQueue[0]!.progress = 0.7;
    f.controls.observe(f.state, true, ""); f.edit("10"); f.mode("fill"); expect(f.find("uquote").textContent).toContain("本次新增 4");
    f.pay(); expect(f.accepted[0]!.count).toBe(4); f.mode("fill"); expect(f.button.disabled).toBe(true);
    expect(f.find("utotal").textContent).toBe("金属 0 · 晶体 0 · 重氢 0");
  });
  it("cannot pay twice by double click, keyboard click, paint, original-card update or tick", () => {
    const f = fixture(); f.pay();
    for (let index = 0; index < 5; index++) {
      f.state = { ...f.state }; f.controls.observe(f.state, true, "");
      updateShipyardCards(f.root as unknown as HTMLElement, shipyardView(f.state)); f.paint();
      f.button.disabled = false; f.pay();
    }
    expect(f.accepted).toHaveLength(1); expect(f.actions).toHaveLength(1);
    f.input.emit("input"); f.paint(); f.pay(); expect(f.accepted).toHaveLength(1);
    f.mode("count"); f.pay(); expect(f.accepted).toHaveLength(2);
  });
  it("rearms a consumed quote only on changed raw input or explicit mode selection", () => {
    const f = fixture(); f.pay(); f.edit("2"); expect(f.button.disabled).toBe(false); f.pay();
    expect(f.accepted.map(order => order.count)).toEqual([1, 2]);
  });
  it("requires the exact frozen synchronous action, rejects copies and replay", () => {
    const f = fixture();
    f.hooks.beforeConsume = action => {
      expect(f.controls.consume({ ...action }, f.state)).toBeNull();
      expect(f.controls.consume({ ...action, authority: {} as typeof action.authority }, f.state)).toBeNull();
      expect(Reflect.set(action, "type", "build-units")).toBe(false);
    };
    f.pay(); expect(f.accepted).toHaveLength(1); expect(f.controls.consume(f.actions[0]!, f.state)).toBeNull();
    f.mode("count"); f.hooks.skipConsume = true; f.pay(); expect(f.controls.consume(f.actions[1]!, f.state)).toBeNull();
  });
  it("rechecks latest resources at consume even after callback issuance", () => {
    const f = fixture(), before = JSON.stringify(f.state);
    f.hooks.beforeConsume = () => { activePlanet(f.state).resources.metal = big(0); };
    f.pay(); expect(f.accepted).toHaveLength(0); expect(activePlanet(f.state).shipyardQueue).toHaveLength(0);
    expect(f.state.orders.nextJobId).toBe(JSON.parse(before).orders.nextJobId); expect(f.reason.textContent).toContain("本次未支付");
  });
  it.each(["max", "fill"] as const)("rejects changed %s count on click, shows new price, and requires renewed selection", mode => {
    const f = fixture(); activePlanet(f.state).resources = { metal: big(20000), crystal: big(20000), deuterium: big(0) };
    f.controls.observe(f.state, true, ""); f.edit("10"); f.mode(mode);
    if (mode === "max") activePlanet(f.state).resources.metal = big(16000); else activePlanet(f.state).units.small_cargo = 2;
    const before = JSON.stringify(f.state); f.pay(); expect(f.accepted).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before);
    expect(f.find("uquote").textContent).toContain("本次新增 8"); expect(f.reason.textContent).toContain("报价已改变");
    f.paint(); expect(f.button.disabled).toBe(true); f.mode(mode); f.pay(); expect(f.accepted[0]!.count).toBe(8);
  });
  it("allows resource recovery to improve a still-unconsumed quote without an extra mode click", () => {
    const f = fixture(); activePlanet(f.state).resources.metal = big(0); f.paint(); expect(f.button.disabled).toBe(true);
    activePlanet(f.state).resources.metal = big(4000); f.controls.observe({ ...f.state }, true, ""); f.paint();
    expect(f.button.disabled).toBe(false); f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it("protects without painting and never treats protected edits as recovered authorization", () => {
    const f = fixture(), quote = vi.spyOn(quotes, "quoteManualUnits"); quote.mockClear();
    f.controls.observe(f.state, false, "存档写入失败"); expect(quote).not.toHaveBeenCalled(); expect(f.button.disabled).toBe(true);
    expect(f.reason.textContent).toContain("存档写入失败"); f.edit("2"); f.mode("count");
    f.controls.observe(f.state, true, ""); f.paint(); f.input.emit("input"); expect(f.button.disabled).toBe(true);
    f.mode("count"); f.pay(); expect(f.accepted[0]!.count).toBe(2);
  });
  it.each(["import", "world", "planet-round-trip"])("retires %s and blocks reentrant old actions even after a new quote", change => {
    const f = fixture(); f.hooks.beforeConsume = () => {
      if (change === "import") { f.controls.invalidate(); f.state = { ...f.state }; }
      else if (change === "world") f.state.universe.seed++;
      else {
        const colony = createPlanet("colony", { galaxy: 1, system: 50, position: 4 }); f.state.planets.push(colony);
        f.state.activePlanetId = "colony"; f.controls.observe(f.state, true, ""); f.state.activePlanetId = "homeworld";
      }
      f.controls.observe(f.state, true, ""); f.paint(); expect(f.button.disabled).toBe(true); f.mode("count");
    };
    f.pay(); expect(f.accepted).toHaveLength(0); f.hooks.beforeConsume = undefined; f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it("retires leave/return even if both happen before the next paint, but permits a first hidden tab visit", () => {
    const f = fixture(); f.panels[0]!.hidden = true; f.panels[0]!.hidden = false; f.paint(); expect(f.button.disabled).toBe(true);
    f.mode("count"); expect(f.button.disabled).toBe(false);
    f.panels[0]!.hidden = true; f.panels[1]!.hidden = false; f.paint(); expect(f.find("upay", "rocket_launcher").disabled).toBe(false);
    f.documentRoot.hidden = true; f.documentRoot.emit("visibilitychange"); f.documentRoot.hidden = false; f.paint();
    expect(f.find("upay", "rocket_launcher").disabled).toBe(true);
  });
  it.each(["pay", "input", "mode", "card", "panel", "body", "root"])("permanently rejects original %s after remove and reinsert", kind => {
    const f = fixture(); const node = kind === "pay" ? f.button : kind === "input" ? f.input : kind === "mode" ? f.find("ubuild") : kind === "card" ? f.card : kind === "panel" ? f.panels[0]! : kind === "body" ? f.body : f.root;
    const parent = node.parentElement!; parent.remove(node); parent.append(node);
    f.button.disabled = false; f.pay(); f.mode("count"); f.edit("2"); f.paint(); expect(f.accepted).toHaveLength(0); expect(f.button.disabled).toBe(true);
    expect(f.reason.textContent).toContain("控件已更换");
  });
  it("rejects same-bind clones, cross-labeled modes and hidden ancestor payment", () => {
    const f = fixture(), clone = new TestElement(); clone.dataset = { ...f.button.dataset }; f.card.append(clone); clone.emit("click");
    expect(f.actions).toHaveLength(0); f.find("ubuild").dataset.id = "deathstar"; f.mode("count"); f.button.disabled = false; f.pay();
    expect(f.accepted).toHaveLength(0); expect(f.button.disabled).toBe(true);
    const g = fixture(); g.body.hidden = true; g.button.disabled = false; g.pay(); expect(g.accepted).toHaveLength(0);
  });
  it("does not authorize changed values inserted without an input event", () => {
    const f = fixture(); f.input.value = "9"; f.pay(); expect(f.accepted).toHaveLength(0); f.paint(); expect(f.button.disabled).toBe(true);
    f.mode("count"); f.pay(); expect(f.accepted[0]!.count).toBe(9);
  });
  it("does no quotes on observe or hidden surfaces and only one selected quote per visible card", () => {
    const f = fixture(), quote = vi.spyOn(quotes, "quoteManualUnits"); quote.mockClear();
    for (let index = 0; index < 8; index++) f.controls.observe({ ...f.state }, true, "");
    expect(quote).not.toHaveBeenCalled(); f.paint(); expect(quote).toHaveBeenCalledTimes(SHIP_IDS.length);
    expect(quote.mock.calls.every(([, request]) => request.mode === "count")).toBe(true);
    quote.mockClear(); f.panels[0]!.hidden = true;
    for (let index = 0; index < 8; index++) { f.controls.observe(f.state, true, ""); f.paint(); }
    expect(quote).not.toHaveBeenCalled();
    for (const observer of TestObserver.instances) for (const options of observer.parents.values()) expect(options.subtree).not.toBe(true);
  });
  it("does not retire original controls for its own text-node removals", () => {
    const f = fixture(); const observer = TestObserver.instances[0]!;
    observer.records.push({ type: "childList", target: f.find("utotal"), removedNodes: [{ nodeType: 3 }] } as unknown as MutationRecord);
    f.paint(); expect(f.button.disabled).toBe(false); f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it.each(["max", "fill"] as const)("retires changed %s price during paint before an old payment can fire", mode => {
    const f = fixture(); activePlanet(f.state).resources = { metal: big(20000), crystal: big(20000), deuterium: big(0) };
    f.controls.observe(f.state, true, ""); f.edit("10"); f.mode(mode);
    if (mode === "max") activePlanet(f.state).resources.metal = big(16000); else activePlanet(f.state).units.small_cargo = 2;
    f.paint(); const before = JSON.stringify(f.state); expect(f.find("uquote").textContent).toContain("本次新增 8");
    expect(f.button.disabled).toBe(true); expect(f.reason.textContent).toContain("报价已改变");
    f.button.disabled = false; f.pay(); expect(JSON.stringify(f.state)).toBe(before); expect(f.accepted).toHaveLength(0);
    f.mode(mode); f.pay(); expect(f.accepted[0]!.count).toBe(8);
  });
  it.each(["uquote", "utotal"])("requires the original visible %s at both selection and payment", prefix => {
    const f = fixture(), field = f.find(prefix), before = JSON.stringify(f.state);
    field.hidden = true; f.button.disabled = false; f.pay(); expect(f.accepted).toHaveLength(0);
    field.hidden = false; f.paint(); expect(f.button.disabled).toBe(true);
    field.computed.display = "none"; f.mode("count"); expect(f.button.disabled).toBe(true);
    field.computed.display = "block"; field.computed.visibility = "hidden"; f.mode("count"); expect(f.button.disabled).toBe(true);
    field.computed.visibility = "visible"; field.rects = []; f.mode("count"); expect(f.button.disabled).toBe(true);
    expect(JSON.stringify(f.state)).toBe(before); field.rects = [{ width: 100, height: 20 }]; f.mode("count"); f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it.each(["card", "root", "body", "uquote", "utotal"])("retires %s hide/show history before observer callback", target => {
    const f = fixture(), node = target === "card" ? f.card : target === "root" ? f.root : target === "body" ? f.body : f.find(target);
    node.hidden = true; node.hidden = false; f.button.disabled = false; f.pay(); f.paint(); expect(f.accepted).toHaveLength(0); expect(f.button.disabled).toBe(true);
    f.mode("count"); f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it.each(["style", "aria-hidden", "class"])("retires synchronous quote %s conceal/reveal changes", attribute => {
    const f = fixture(), total = f.find("utotal");
    total.setAttribute(attribute, attribute === "style" ? "display: none" : attribute === "aria-hidden" ? "true" : "hidden-quote"); total.removeAttribute(attribute);
    f.pay(); f.paint(); expect(f.accepted).toHaveLength(0); expect(f.button.disabled).toBe(true);
  });
  it("keeps harmless style color and screenshot caret changes from retiring a quote", () => {
    const f = fixture(); f.find("utotal").setAttribute("style", "color: red; caret-color: transparent"); f.root.setAttribute("style", "caret-color: auto");
    f.paint(); expect(f.button.disabled).toBe(false); f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it("does not perform layout reads during observe/paint but rejects hidden quote CSS at consume", () => {
    const f = fixture(), computed = vi.mocked(getComputedStyle), spy = vi.fn(computed); vi.stubGlobal("getComputedStyle", spy);
    f.controls.observe(f.state, true, ""); f.paint(); expect(spy).not.toHaveBeenCalled();
    f.hooks.beforeConsume = () => { f.find("utotal").computed.visibility = "hidden"; };
    f.pay(); expect(spy).toHaveBeenCalled(); expect(f.accepted).toHaveLength(0); expect(f.button.disabled).toBe(true);
  });
  it("rejects forged throwing getters without reading them", () => {
    const f = fixture(), fake = { get type() { throw Error("must not read type"); }, get authority() { throw Error("must not read authority"); } };
    expect(f.controls.consume(fake as unknown as ManualUnitUiAction, f.state)).toBeNull();
    f.hooks.beforeConsume = () => { expect(f.controls.consume(fake as unknown as ManualUnitUiAction, f.state)).toBeNull(); }; f.pay(); expect(f.accepted).toHaveLength(1);
  });
  it("consumes even a failed paid-job allocation without changing economics or reviving on paint", () => {
    const f = fixture(); f.state.orders.nextJobId = Number.MAX_SAFE_INTEGER; f.controls.observe(f.state, true, ""); f.paint();
    const before = JSON.stringify(f.state); f.hooks.allowOrderFailure = true; f.pay(); expect(f.accepted).toHaveLength(1);
    expect(JSON.stringify(f.state)).toBe(before); f.controls.observe({ ...f.state }, true, ""); f.paint(); expect(f.button.disabled).toBe(true);
    f.button.disabled = false; f.pay(); expect(f.actions).toHaveLength(1); expect(JSON.stringify(f.state)).toBe(before);
  });

  it.each(["uquote", "utotal"])("rejects altered %s text without paying an undisplayed price", prefix => {
    const f = fixture(), before = JSON.stringify(f.state); f.find(prefix).textContent = "伪造报价 0";
    f.pay(); expect(f.accepted).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before); expect(f.button.disabled).toBe(true);
    f.paint(); expect(f.button.disabled).toBe(true); f.mode("count"); f.pay(); expect(f.accepted).toHaveLength(1);
  });

  it.each(["body", "card", "document"])("does not rearm a raw edit made while %s is hidden", target => {
    const f = fixture(), node = target === "body" ? f.body : target === "card" ? f.card : f.documentRoot;
    const before = JSON.stringify(f.state); node.hidden = true; f.edit("2"); node.hidden = false;
    f.controls.observe(f.state, true, ""); f.paint(); expect(f.input.value).toBe("2"); expect(f.button.disabled).toBe(true);
    f.button.disabled = false; f.pay(); expect(f.accepted).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before);
    f.mode("count"); f.pay(); expect(f.accepted).toEqual([{ id: "small_cargo", count: 2 }]);
  });
  it.each(["uquote", "utotal"])("rejects a same-text hidden descendant inside %s", prefix => {
    const f = fixture(), field = f.find(prefix), before = JSON.stringify(f.state), displayed = field.textContent;
    const hidden = new TestElement(); hidden.textContent = displayed; hidden.computed.visibility = "hidden"; field.append(hidden);
    // The parent still has matching textContent and positive geometry, exactly
    // the structure that previously bypassed parent-only visibility checks.
    expect(field.textContent).toBe(displayed); expect(field.getClientRects()[0]!.height).toBeGreaterThan(0);
    f.pay(); expect(f.accepted).toHaveLength(0); expect(JSON.stringify(f.state)).toBe(before); expect(f.button.disabled).toBe(true);
    f.paint(); expect(f.button.disabled).toBe(true); expect(f.input.value).toBe("1");
  });

});
