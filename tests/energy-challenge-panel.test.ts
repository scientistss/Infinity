import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import * as challenge from "../src/game/energy-challenge";
import { createInitialState } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { installEnergyChallengePanel, type EnergyChallengeUiAction } from "../src/ui/energy-challenge-panel";

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
  insertAdjacentElement(_position: string, node: NodeDouble) {
    const parent = this.parentElement!; const index = parent.children.indexOf(this); node.remove(); node.parentElement = parent; parent.children.splice(index + 1, 0, node);
  }
  focus() { Object.assign(document, {activeElement:this}); }
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
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
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
function fixture(initial?: GameState) {
  const doc = document as unknown as NodeDouble, body = new NodeDouble(), root = new NodeDouble(), host = new NodeDouble(), anchor = new NodeDouble();
  doc.append(body); body.append(root); root.append(host); host.append(anchor); anchor.className = "prestige-panel";
  let state = initial ?? createInitialState(0x12345678, 0x13579);
  if (!initial) state.lifetime.metal = big(1e8);
  const actions: EnergyChallengeUiAction[] = [], accepted: boolean[] = [];
  let beforeConsume: (() => void) | null = null;
  const controller = installEnergyChallengePanel(root as unknown as HTMLElement, action => {
    actions.push(action); beforeConsume?.(); accepted.push(controller.consume(action, state));
  });
  const node = (id: string) => root.querySelector(`#energy-challenge-${id}`)!;
  const setState = (next: GameState, writable = true) => { state = next; controller.observe(state, writable, writable ? "" : "测试存档保护"); };
  const review = (name = "enter") => node(name).emit("click");
  controller.update(state, true);
  return {root, body, host, controller, actions, accepted, node, review, state:() => state, setState,
    before:(run: () => void) => { beforeConsume = run; }};
}
describe("energy challenge one-shot manual controls", () => {
  it("starts folded, locked on a fresh game, and never enrolls by observing", () => {
    const f = fixture(createInitialState(1, 2)), quote = vi.spyOn(challenge, "quoteEnergyChallenge"), evaluate = vi.spyOn(challenge, "energyChallengePrestigeEvaluation");
    expect(f.node("rules").open).toBe(false); expect(f.node("review").hidden).toBe(true); expect(f.node("enter").disabled).toBe(true);
    for (let i = 0; i < 10; i++) f.controller.update(f.state(), true);
    expect(quote).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled(); expect(f.actions).toHaveLength(0);
  });
  it("reviews without mutation and emits a capability exactly once after an unrelated tick", () => {
    const f = fixture(), evaluate = vi.spyOn(challenge, "energyChallengePrestigeEvaluation");
    f.review(); const old = f.node("confirm"); expect(f.node("review").hidden).toBe(false);
    expect(f.node("review-details").open).toBe(false); expect(evaluate).toHaveBeenCalledTimes(1);
    f.setState({...f.state(), totalTime:big(0.1), lifetime:{...f.state().lifetime, metal:big(100000001)}});
    f.node("confirm").emit("click"); expect(f.accepted).toEqual([true]);
    expect(f.controller.consume(f.actions[0]!, f.state())).toBe(false); old.emit("click"); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(1);
    expect(f.state().energyChallenge.active).toBeNull();
  });
  it("keeps hidden observations cheap and disables protection immediately", () => {
    const f = fixture(); f.review(); f.host.hidden = true;
    const quote = vi.spyOn(challenge, "quoteEnergyChallenge"), evaluate = vi.spyOn(challenge, "energyChallengePrestigeEvaluation");
    f.setState(f.state(), false);
    expect(f.node("enter").disabled).toBe(true); expect(f.node("confirm").disabled).toBe(true); expect(f.node("status").textContent).toContain("测试存档保护");
    for (let i = 0; i < 20; i++) f.controller.observe(f.state(), false);
    expect(quote).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
    f.host.hidden = false; f.setState(f.state(), true); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("retires selected-planet, world and import/reset epochs including same-valued worlds", () => {
    const f = fixture(); f.review(); const source = f.state();
    f.setState({...source, activePlanetId:"colony"}); f.setState(source); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
    f.review(); f.setState({...source, universe:{...source.universe}}); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
    f.review(); f.controller.retire(); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("retires hide/show, details close/open and visibility round trips", () => {
    const f = fixture(); f.review(); f.host.hidden = true; f.host.hidden = false; f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
    f.review(); f.node("review-details").open = true; f.node("review-details").open = false; f.node("review-details").open = true;
    f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
    f.review(); (document as unknown as NodeDouble).emit("visibilitychange"); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("rejects fabricated actions and cloned controls", () => {
    const f = fixture(); f.review(); const clone = f.node("confirm").cloneNode(); f.node("review-actions").append(clone); clone.emit("click"); expect(f.actions).toHaveLength(0);
    expect(f.controller.consume({type:"energy-challenge", action:"enter"}, f.state())).toBe(false);
    f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0);
  });
  it("permanently retires a detached/reparented original control or ancestor", () => {
    for (const target of ["confirm", "ancestor"]) {
      const f = fixture(); f.review(); const node = target === "ancestor" ? f.body : f.node("confirm"); const parent = node.parentElement!;
      node.remove(); parent.append(node); f.node("confirm").emit("click"); expect(f.actions).toHaveLength(0); expect(f.node("enter").disabled).toBe(true);
    }
  });
  it("revalidates the exact authority after an intervening hide before handler consume", () => {
    const f = fixture(); f.review(); f.before(() => { f.host.hidden = true; f.host.hidden = false; }); f.node("confirm").emit("click");
    expect(f.actions).toHaveLength(1); expect(f.accepted).toEqual([false]);
  });
  it("cancels without dispatch and never revives an old button after a new review", () => {
    const f = fixture(); f.review(); const old = f.node("confirm"); f.node("cancel").emit("click"); f.review(); old.emit("click"); expect(f.actions).toHaveLength(0);
    f.node("confirm").emit("click"); expect(f.accepted).toEqual([true]);
  });
  it("shows paid proof and load rules on active challenge, with text-safe mother name", () => {
    const source = createInitialState(0x12345678, 0x13579); source.lifetime.metal = big(1e8);
    const active = challenge.enterEnergyChallenge(source, challenge.quoteEnergyChallenge(source, "enter")).state;
    active.planets[0]!.name = "母星 <img src=x>";
    const f = fixture(active); expect(f.node("home").textContent).toContain("<img src=x>");
    expect(f.node("home").children).toHaveLength(0); expect(f.node("checklist").children).toHaveLength(4);
    expect(f.node("load").hidden).toBe(false); expect(f.node("enter").hidden).toBe(true); expect(f.node("finish").disabled).toBe(true);
    f.review("abandon"); expect(f.node("review-summary").textContent).toContain("不重置、不退款、无奖励");
    f.node("confirm").emit("click"); expect(f.accepted).toEqual([true]);
  });
});
