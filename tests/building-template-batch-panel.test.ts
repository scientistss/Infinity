import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuildingTemplate } from "../src/game/building-templates";
import { createPlanet } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import type { BuildingTemplateBatchAction } from "../src/game/building-template-batch-state";
import type { GameState } from "../src/game/types";
import * as pricing from "../src/game/queue";
import { installBuildingTemplateBatchPanel } from "../src/ui/building-template-batch-panel";

/** Behavioral DOM double only: native layout, keyboard and rendering remain browser gates. */
class NodeDouble {
  id = ""; className = ""; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  children: NodeDouble[] = []; parentElement: NodeDouble | null = null; connectedRoot = false;
  value = ""; disabled = false; checked = false; type = ""; inputMode = ""; maxLength = 0; autocomplete = "";
  style = {display:"", visibility:""}; ownText = ""; private hiddenValue = false; private openValue = false;
  listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(readonly tagName = "div") {}
  get parentNode() { return this.parentElement; }
  get isConnected(): boolean { return this.connectedRoot || !!this.parentElement?.isConnected; }
  get hidden() { return this.hiddenValue; }
  set hidden(value: boolean) { const old = this.getAttribute("hidden"); this.hiddenValue = value; if (old !== this.getAttribute("hidden")) this.changed("hidden", old); }
  get open() { return this.openValue; }
  set open(value: boolean) { const old = this.getAttribute("open"); this.openValue = value; if (old !== this.getAttribute("open")) this.changed("open", old); }
  get options() { return this.children.filter(child => child.tagName === "option"); }
  get selectedIndex() { return this.options.findIndex(option => option.value === this.value); }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
  contains(node: NodeDouble): boolean { return node === this || this.children.some(child => child.contains(node)); }
  append(...nodes: NodeDouble[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() {
    const parent = this.parentElement; if (!parent) return;
    parent.children = parent.children.filter(child => child !== this); this.parentElement = null;
    ObserverDouble.record(parent, {type:"childList", target:parent, removedNodes:[this]});
  }
  replaceChildren(...nodes: NodeDouble[]) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  replaceWith(node: NodeDouble) {
    const parent = this.parentElement; if (!parent) return;
    const index = parent.children.indexOf(this); this.remove(); node.remove(); parent.children.splice(index, 0, node); node.parentElement = parent;
  }
  cloneNode() { const node = new NodeDouble(this.tagName); Object.assign(node, {id:this.id, className:this.className, dataset:{...this.dataset}, attributes:{...this.attributes}, ownText:this.ownText, disabled:this.disabled}); return node; }
  getAttribute(name: string): string | null {
    if (name === "hidden") return this.hidden ? "" : null;
    if (name === "open") return this.open ? "" : null;
    if (name === "class") return this.className || null;
    return this.attributes[name] ?? null;
  }
  setAttribute(name: string, value: string) { const old = this.getAttribute(name); this.attributes[name] = value; this.changed(name, old); }
  changed(attributeName: string, oldValue: string | null) { ObserverDouble.record(this, {type:"attributes", target:this, attributeName, oldValue, removedNodes:[]}); }
  matches(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector === "button[data-building-template-batch-action]") return this.tagName === "button" && !!this.dataset.buildingTemplateBatchAction;
    return selector === this.tagName;
  }
  querySelector(selector: string): NodeDouble | null {
    for (const child of this.children) { if (child.matches(selector)) return child; const result = child.querySelector(selector); if (result) return result; } return null;
  }
  closest(selector: string): NodeDouble | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  addEventListener(type: string, listener: (event: Event) => void) { this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]); }
  removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener)); }
  emit(type: string, target = this) { const event = {target} as unknown as Event; for (let node: NodeDouble | null = this; node; node = node.parentElement) for (const listener of node.listeners.get(type) ?? []) listener(event); }
  all(): NodeDouble[] { return [this, ...this.children.flatMap(child => child.all())]; }
}
class ObserverDouble {
  static all: ObserverDouble[] = [];
  watched = new Map<NodeDouble, MutationObserverInit>(); records: MutationRecord[] = [];
  constructor(_callback: MutationCallback) { ObserverDouble.all.push(this); }
  observe(node: NodeDouble, options: MutationObserverInit) { this.watched.set(node, options); }
  disconnect() { this.watched.clear(); }
  takeRecords() { const records = this.records; this.records = []; return records; }
  static record(target: NodeDouble, record: {type:string; target:NodeDouble; removedNodes:NodeDouble[]; attributeName?:string; oldValue?:string | null}) {
    for (const observer of this.all) for (const [node, options] of observer.watched) {
      if (target !== node && !(options.subtree && node.contains(target))) continue;
      if (record.type === "attributes" && (!options.attributes || !options.attributeFilter?.includes(record.attributeName!))) continue;
      observer.records.push(record as unknown as MutationRecord); break;
    }
  }
}
beforeEach(() => {
  ObserverDouble.all = [];
  const document = new NodeDouble(); document.connectedRoot = true;
  Object.assign(document, {createElement:(tag: string) => new NodeDouble(tag)});
  vi.stubGlobal("document", document); vi.stubGlobal("Element", NodeDouble); vi.stubGlobal("MutationObserver", ObserverDouble);
  vi.stubGlobal("window", {getComputedStyle:(node: NodeDouble) => node.style});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const doc = document as unknown as NodeDouble, body = new NodeDouble(), root = new NodeDouble(), host = new NodeDouble(), panel = new NodeDouble("details");
  doc.append(body); body.append(root); root.append(host); host.append(panel); panel.id = "building-template-batch"; panel.open = true;
  function make(id: string, tag = "div", parent = panel) { const node = new NodeDouble(tag); node.id = `building-template-batch-${id}`; parent.append(node); return node; }
  const select = make("template", "select");
  for (const id of ["status", "selection", "planets", "budgets"]) make(id);
  const review = make("review-panel", "section"); review.hidden = true;
  for (const id of ["review-summary", "total-budget", "review-planets"]) make(id, "div", review);
  for (const name of ["fill-quotes", "review", "clear", "apply", "cancel-review"]) { const node = make(name, "button", ["apply", "cancel-review"].includes(name) ? review : panel); node.dataset.buildingTemplateBatchAction = name; }
  let state = createInitialState(0x12345678, 0xabcdef12);
  state = {...state, planets:[...state.planets, ...[2, 3, 4, 5].map(position => createPlanet(`colony-${position}`, {galaxy:1, system:50, position}))]};
  state = createBuildingTemplate(state, {name:"批量目标", goals:[{building:"metal_mine", targetLevel:2}]}, 1).state;
  const actions: BuildingTemplateBatchAction[] = [], accepted: boolean[] = [];
  let beforeConsume: ((action: BuildingTemplateBatchAction) => void) | null = null;
  const controller = installBuildingTemplateBatchPanel(root as unknown as HTMLElement, action => {
    actions.push(action); beforeConsume?.(action); accepted.push(controller.consume(action, state));
  });
  const node = (id: string) => root.querySelector(`#building-template-batch-${id}`)!;
  const planet = (id: string) => node("planets").all().find(value => value.dataset.batchPlanet === id)!;
  const choose = () => { select.value = "1"; select.emit("change"); };
  const check = (id: string, checked = true) => { const input = planet(id); input.checked = checked; input.emit("change"); };
  const setup = () => { choose(); check("homeworld"); check("colony-2"); };
  const reviewNow = () => node("review").emit("click");
  controller.update(state, true);
  return {root, body, host, panel, select, review, controller, actions, accepted, node, planet, choose, check, setup, reviewNow,
    state:() => state, setState:(next: GameState) => { state = next; }, before:(run: (action: BuildingTemplateBatchAction) => void) => { beforeConsume = run; }};
}
describe("multi-planet building-template one-shot panel", () => {
  it("has no default selections, independent zero budgets and no observation pricing", () => {
    const f = fixture(), price = vi.spyOn(pricing, "costFor");
    expect(f.select.value).toBe(""); expect(f.node("review").disabled).toBe(true); f.setup();
    expect(f.node("budgets").all().filter(node => node.tagName === "input").map(node => node.value)).toEqual(["0", "0", "0", "0", "0", "0"]);
    for (let index = 0; index < 10; index++) f.controller.observe(f.state(), true);
    expect(price).not.toHaveBeenCalled(); f.reviewNow(); expect(price).toHaveBeenCalled();
    expect(f.node("total-budget").textContent).toContain("金属 0"); expect(f.node("review-planets").textContent).toContain("逐项预算缺口合计");
    const reviewed = price.mock.calls.length;
    for (let index = 0; index < 10; index++) f.controller.update(f.state(), true);
    expect(price).toHaveBeenCalledTimes(reviewed); expect(f.node("apply").disabled).toBe(false);
  });
  it("consumes the exact action once and never revives the old confirmation button", () => {
    const f = fixture(); f.setup(); f.reviewNow(); const old = f.node("apply"); old.emit("click");
    expect(f.actions).toHaveLength(1); expect(f.accepted).toEqual([true]); expect(f.controller.consume(f.actions[0]!, f.state())).toBe(false);
    old.emit("click"); f.node("apply").emit("click"); expect(f.actions).toHaveLength(1);
    f.reviewNow(); const clone = f.node("apply").cloneNode(); f.review.append(clone); clone.emit("click"); expect(f.actions).toHaveLength(1);
  });
  it("keeps explicit planet/budget selection through active A→B→A but retires review", () => {
    const f = fixture(); f.setup(); const budget = f.node("budgets").all().find(node => node.tagName === "input")!; budget.value = "12"; budget.emit("input"); f.reviewNow();
    const old = f.node("apply"); f.controller.observe({...f.state(), activePlanetId:"colony-3"}, true); f.controller.observe(f.state(), true);
    expect(f.planet("homeworld").checked).toBe(true); expect(f.planet("colony-2").checked).toBe(true); expect(budget.value).toBe("12");
    old.emit("click"); expect(f.actions).toHaveLength(0); expect(f.node("apply").disabled).toBe(true);
  });
  it("retires changed budgets and selection round trips without silently repricing", () => {
    const f = fixture(); f.setup(); f.reviewNow(); const old = f.node("apply");
    f.check("colony-2", false); f.check("colony-2"); old.emit("click"); expect(f.actions).toHaveLength(0);
    f.reviewNow(); const budget = f.node("budgets").all().find(node => node.tagName === "input")!; budget.value = "4";
    f.controller.observe(f.state(), true); budget.value = "0"; f.node("apply").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("disables protected and replaced-world selections even while folded", () => {
    const f = fixture(); f.setup(); f.reviewNow(); f.panel.open = false; f.controller.observe(f.state(), false);
    expect(f.select.disabled).toBe(true); expect(f.select.value).toBe(""); expect(f.node("apply").disabled).toBe(true);
    f.panel.open = true; f.controller.update(f.state(), true); f.setup(); f.reviewNow();
    f.controller.observe({...f.state(), universe:{...f.state().universe}}, true); expect(f.select.value).toBe(""); expect(f.node("apply").disabled).toBe(true);
  });
  it("does not revive a confirmation after ancestor hide→show, close→open or detach→reattach", () => {
    const f = fixture(); f.setup(); f.reviewNow(); f.host.hidden = true; f.host.hidden = false; f.node("apply").emit("click"); expect(f.actions).toHaveLength(0);
    f.reviewNow(); f.panel.open = false; f.panel.open = true; f.node("apply").emit("click"); expect(f.actions).toHaveLength(0);
    f.reviewNow(); f.body.remove(); (document as unknown as NodeDouble).append(f.body); f.node("apply").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("rejects a hide→show inserted between emission and handler consumption", () => {
    const f = fixture(); f.setup(); f.reviewNow(); f.before(() => { f.host.hidden = true; f.host.hidden = false; }); f.node("apply").emit("click");
    expect(f.actions).toHaveLength(1); expect(f.accepted).toEqual([false]);
  });
  it("rejects accessor-bearing tampered requests without invoking the accessor", () => {
    const f = fixture(), getter = vi.fn(() => "999"); f.setup(); f.reviewNow();
    f.before(action => Object.defineProperty(action.request.planets[0]!.budgets[0]!.budget, "metal", {get:getter, enumerable:true}));
    f.node("apply").emit("click"); expect(f.accepted).toEqual([false]); expect(getter).not.toHaveBeenCalled();
  });
  it("accepts scientific, leading-zero and trailing-zero caps using a canonical dispatch snapshot", () => {
    const f = fixture(); f.setup();
    const inputs = f.node("budgets").all().filter(node => node.tagName === "input");
    inputs[0]!.value = "1e3"; inputs[1]!.value = "00060"; inputs[2]!.value = "60.0"; f.reviewNow(); f.node("apply").emit("click");
    expect(f.accepted).toEqual([true]); expect(f.actions[0]!.request.planets[0]!.budgets[0]!.budget).toEqual({metal:"1000", crystal:"60", deuterium:"60"});
  });
  it("bounds explicit selection at four and supports reviewed zero-operation", () => {
    const f = fixture(); f.setup(); f.check("colony-3"); f.check("colony-4"); expect(f.planet("colony-5").disabled).toBe(true);
    f.check("colony-5"); expect(f.planet("colony-5").checked).toBe(false);
    const state = {...f.state(), planets:f.state().planets.map(planet => ({...planet, buildings:{...planet.buildings, metal_mine:2}}))};
    f.setState(state); f.controller.update(state, true); f.reviewNow();
    expect(f.node("review-summary").textContent).toContain("零操作"); expect(f.node("apply").disabled).toBe(false);
    f.node("apply").emit("click"); expect(f.accepted).toEqual([true]); expect(f.actions[0]!.request.planets.every(planet => planet.budgets.length === 0)).toBe(true);
  });
});
