import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetMessage } from "../src/game/fleet";
import type { NpcScoutSnapshotV1 } from "../src/game/npc-scout-state";
import * as model from "../src/ui/npc-scout-comparison-model";
import { installNpcScoutComparisonPanel, npcScoutComparisonPanelHtml, type NpcScoutComparisonContext } from "../src/ui/npc-scout-comparison-panel";
import source from "../src/ui/npc-scout-comparison-panel.ts?raw";
import adapterSource from "../src/ui/space-panel.ts?raw";

/** Behavioral DOM double only. It does not establish native event trust,
 * layout, measured frame times or actual browser focus/keyboard behavior. */
type Listener = (event: { target: NodeDouble; isTrusted: boolean; key?: string; preventDefault(): void }) => void;
class NodeDouble {
  id = ""; className = ""; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  tagName: string; value = ""; max = ""; disabled = false; title = ""; open = false; tabIndex = -1;
  connectedRoot = false; parentElement: NodeDouble | null = null; children: NodeDouble[] = [];
  listeners = new Map<string, Listener[]>(); ownText = ""; private hiddenValue = false;
  constructor(tag = "div") { this.tagName = tag; }
  get parentNode() { return this.parentElement; }
  get hidden() { return this.hiddenValue; }
  set hidden(value: boolean) {
    if (value === this.hiddenValue) return;
    const oldValue = this.hiddenValue ? "" : null; this.hiddenValue = value;
    for (const observer of ObserverDouble.instances) if (observer.parents.has(this)) observer.records.push({ type: "attributes", target: this, attributeName: "hidden", oldValue, removedNodes: [] } as unknown as MutationRecord);
  }
  get isConnected(): boolean { return this.connectedRoot || !!this.parentElement?.isConnected; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
  get firstChild() { return this.children[0] ?? null; }
  get options() { return this.children.filter(child => child.tagName === "option"); }
  get selectedIndex() { return this.options.findIndex(option => option.value === this.value); }
  get firstElementChild() { return this.children[0] ?? null; }
  contains(node: NodeDouble): boolean { return node === this || this.children.some(child => child.contains(node)); }
  append(...nodes: NodeDouble[]) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() {
    const parent = this.parentElement; if (!parent) return;
    parent.children = parent.children.filter(child => child !== this); this.parentElement = null;
    for (const observer of ObserverDouble.instances) if (observer.parents.has(parent)) observer.records.push({ type: "childList", removedNodes: [this] } as unknown as MutationRecord);
  }
  replaceChildren(...nodes: NodeDouble[]) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  matches(selector: string) { return selector.startsWith("#") ? this.id === selector.slice(1) : selector.startsWith(".") ? this.className.split(" ").includes(selector.slice(1)) : selector === this.tagName; }
  querySelectorAll(selector: string): NodeDouble[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  setAttribute(name: string, value: string) {
    const oldValue = this.attributes[name] ?? null; this.attributes[name] = value;
    if (["style", "aria-hidden"].includes(name)) for (const observer of ObserverDouble.instances) if (observer.parents.has(this)) observer.records.push({ type: "attributes", target: this, attributeName: name, oldValue, removedNodes: [] } as unknown as MutationRecord);
  }
  removeAttribute(name: string) {
    const oldValue = this.attributes[name] ?? null; delete this.attributes[name];
    if (["style", "aria-hidden"].includes(name)) for (const observer of ObserverDouble.instances) if (observer.parents.has(this)) observer.records.push({ type: "attributes", target: this, attributeName: name, oldValue, removedNodes: [] } as unknown as MutationRecord);
  }
  addEventListener(type: string, listener: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type: string, listener: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener)); }
  emit(type: string, trusted = true, key?: string, target = this) {
    const event = { target, isTrusted: trusted, key, preventDefault() {} };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    if (["click", "input", "change", "keydown"].includes(type)) this.parentElement?.emit(type, trusted, key, target);
    return event;
  }
  focus() { if (this.isConnected) (document as unknown as { activeElement: NodeDouble }).activeElement = this; }
}
class ObserverDouble {
  static instances: ObserverDouble[] = [];
  parents = new Set<NodeDouble>(); records: MutationRecord[] = [];
  constructor(_callback: MutationCallback) { ObserverDouble.instances.push(this); }
  observe(parent: NodeDouble, options: MutationObserverInit) {
    expect(options).toEqual({ childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "style", "aria-hidden"] }); this.parents.add(parent);
  }
  takeRecords() { const records = this.records; this.records = []; return records; }
  disconnect() { this.parents.clear(); }
}
const element = (node: NodeDouble) => node as unknown as HTMLElement;
const button = (node: NodeDouble) => node as unknown as HTMLButtonElement;
function report(fleetId: number, observedAt = String(fleetId * 10)): FleetMessage {
  const snapshot: NpcScoutSnapshotV1 = Object.freeze({ model: "npc-scout-snapshot-v1", fleetId, originId: `origin-${fleetId}`,
    target: Object.freeze({ galaxy: 1, system: 56, position: 6 }), observedAt,
    stock: Object.freeze([100.25 + fleetId, 200 + fleetId * 2, 3.5] as const),
    garrison: Object.freeze({ light_fighter: fleetId === 1 ? 3 : 1, heavy_fighter: 0 }), defenderTech: Object.freeze({ weapons: 0, shields: 0, armour: 0 }) });
  return Object.freeze({ id: `scout-${fleetId}`, at: Math.min(Number(observedAt), 1e12), text: `<img src=x onerror="bad">报告 ${fleetId}`, npcScoutSnapshot: snapshot });
}
function fixture(reports: readonly FleetMessage[] = [report(1), report(2), report(3)], anchorIndex = 1) {
  const doc = new NodeDouble(); doc.connectedRoot = true;
  const body = new NodeDouble(), root = new NodeDouble(), messages = new NodeDouble(), panel = new NodeDouble("section");
  doc.append(body); body.append(root); root.append(messages); messages.id = "space-messages";
  messages.append(panel); panel.id = "npc-scout-comparison-panel"; panel.hidden = true;
  function make(id: string, tag = "div", parent = panel) { const node = new NodeDouble(tag); node.id = id; parent.append(node); return node; }
  make("npc-scout-comparison-notice", "p", messages).hidden = true;
  for (const id of ["title", "source", "status", "results", "warning"]) make(`npc-scout-comparison-${id}`);
  const other = make("npc-scout-comparison-other", "select"), run = make("npc-scout-comparison-run", "button"), cancel = make("npc-scout-comparison-cancel", "button");
  const anchor = reports[anchorIndex]!;
  let context: NpcScoutComparisonContext = { adoptedWorld: {}, messages: reports, writable: true, protectionReason: "" };
  let hostFailure = false;
  const controller = installNpcScoutComparisonPanel(element(root), { readContext: () => { if (hostFailure) throw Error("host failure"); return context; } }); controller.observe();
  const opener = make("report-open", "button", messages); controller.registerReport(button(opener), anchor);
  const node = (id: string) => root.querySelector(`#npc-scout-comparison-${id}`)!;
  const open = () => opener.emit("click");
  const select = (index = 1, trusted = true) => { other.value = String(index); other.emit("change", trusted); };
  const compare = (index = 1) => { open(); select(index); run.emit("click"); };
  const exact = () => { const details = node("exact"); details.open = true; details.emit("toggle"); return node("exact-body"); };
  return { doc, body, root, messages, panel, other, run, cancel, opener, anchor, reports, controller, make, node, open, select, compare, exact,
    failHost: () => { hostFailure = true; }, context: () => context, setContext: (patch: Partial<NpcScoutComparisonContext>) => { context = { ...context, ...patch }; } };
}
beforeEach(() => {
  const documentDouble = new NodeDouble(), windowDouble = new NodeDouble();
  Object.assign(documentDouble, { activeElement: null, createElement: (tag: string) => new NodeDouble(tag) });
  vi.stubGlobal("document", documentDouble); vi.stubGlobal("window", windowDouble); vi.stubGlobal("Element", NodeDouble); vi.stubGlobal("MutationObserver", ObserverDouble); ObserverDouble.instances = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("historical scout comparison panel", () => {
  it("provides a separate read-only card with no automatic comparison or flight controls", () => {
    const html = npcScoutComparisonPanelHtml();
    expect(html).toContain("历史侦察对照"); expect(html).toContain(model.NPC_SCOUT_COMPARISON_WARNING);
    expect(html).toContain('value=""'); expect(html).not.toMatch(/data-ship|出征|填入|演练/);
    expect(source).not.toMatch(/\b(npcAt|projectNpc|quoteFlight|sendFleet|rehearseNpcScout|localStorage|setTimeout|requestAnimationFrame|Math\.random)\b/);
    expect(adapterSource).toContain("${npcRehearsalPanelHtml()}${npcScoutComparisonPanelHtml()}${npcBattlePanelHtml()}");
  });
  it("fixes the opened report, selects nothing and requires an explicit choice then Run", () => {
    const f = fixture(), build = vi.spyOn(model, "buildNpcScoutComparison"), before = JSON.stringify(f.context()); f.open();
    expect(f.panel.hidden).toBe(false); expect(f.node("source").textContent).toContain("舰队 #2"); expect(f.other.value).toBe(""); expect(f.run.disabled).toBe(true);
    expect(f.other.options.map(option => option.textContent)).toEqual(["请明确选择一份报告", "舰队 #1 · 观察 10 秒", "舰队 #3 · 观察 30 秒"]);
    expect(build).not.toHaveBeenCalled(); f.select(); expect(build).not.toHaveBeenCalled(); expect(f.run.disabled).toBe(false);
    f.run.emit("click"); expect(build).toHaveBeenCalledTimes(1); expect(f.node("summary").textContent).toContain("金属 +1"); expect(f.node("summary").textContent).toContain("轻战 -2");
    expect(f.node("exact-body").textContent).toBe(""); expect(JSON.stringify(f.context())).toBe(before); expect(document.activeElement).toBe(f.node("title"));
  });
  it("shows complete original fields, canonical times and exact difference only on expansion", () => {
    const f = fixture(); f.compare(); const body = f.exact();
    expect(body.textContent).toContain("origin-1"); expect(body.textContent).toContain("origin-2"); expect(body.textContent).toContain("npc-scout-snapshot-v1");
    const fields = body.querySelectorAll("span");
    const value = (side: string, key: string) => fields.find(node => node.dataset.comparisonSide === side && node.dataset.comparisonField === key)?.textContent;
    expect(value("before", "stock.metal")).toBe("101.25"); expect(value("after", "stock.metal")).toBe("102.25"); expect(value("delta", "stock.metal")).toBe("1");
    expect(value("before", "observedAt")).toBe("10"); expect(value("after", "observedAt")).toBe("20"); expect(value("before", "target")).toBe("1:56:6");
    expect(value("before", "defenderTech.armour")).toBe("0"); expect(body.textContent).toContain(model.NPC_SCOUT_COMPARISON_PRECISION); expect(body.querySelector("img")).toBeNull();
    const count = fields.length; f.node("exact").emit("toggle"); expect(body.querySelectorAll("span")).toHaveLength(count);
  });
  it("uses actual array order when at is capped and observedAt is identical", () => {
    const a = report(3, "10000000000000"), b = report(1, "10000000000000"), f = fixture([a, b], 1); f.compare();
    expect(f.node("summary").textContent).toContain("金属 -2"); const fields = f.exact().querySelectorAll("span");
    expect(fields.find(node => node.dataset.comparisonSide === "before" && node.dataset.comparisonField === "fleetId")?.textContent).toBe("3");
  });
  it("offers no fabricated candidate for a single retained report or old text", () => {
    const a = report(1), legacy = { id: "scout-old", at: 0, text: "库存 999", npcScoutSnapshot: null }, f = fixture([a, legacy], 0); f.open();
    expect(f.other.disabled).toBe(true); expect(f.run.disabled).toBe(true); expect(f.node("status").textContent).toContain("不足两份");
    const fake = f.make("old-report", "button", f.messages); expect(f.controller.registerReport(button(fake), legacy)).toBe(false); expect(fake.disabled).toBe(true);
    fake.emit("click"); expect(f.node("source").textContent).not.toContain("999");
  });
  it("rejects copied report references, cloned buttons, untrusted choices and synthetic clicks", () => {
    const f = fixture(), fake = f.make("report-open", "button", f.messages), build = vi.spyOn(model, "buildNpcScoutComparison");
    expect(f.controller.registerReport(button(fake), { ...f.anchor })).toBe(false); fake.dataset.npcScoutComparison = ""; fake.emit("click"); expect(f.panel.hidden).toBe(true);
    f.opener.emit("click", false); expect(f.panel.hidden).toBe(true); f.open(); f.select(1, false); f.run.disabled = false; f.run.emit("click"); expect(build).not.toHaveBeenCalled();
    f.select(); f.run.emit("click", false); expect(build).not.toHaveBeenCalled();
  });
  it("clears a previous comparison on each new choice and cannot revive its old detail callback", () => {
    const f = fixture(), build = vi.spyOn(model, "buildNpcScoutComparison"); f.compare(); const oldExact = f.node("exact"), oldBody = f.node("exact-body");
    f.select(2); expect(f.node("results").hidden).toBe(true); expect(f.node("results").textContent).toBe(""); expect(build).toHaveBeenCalledTimes(1);
    oldExact.open = true; oldExact.emit("toggle"); expect(oldBody.textContent).toBe(""); f.run.emit("click"); expect(build).toHaveBeenCalledTimes(2);
    f.select(1); oldExact.emit("toggle"); expect(oldBody.textContent).toBe(""); expect(f.node("results").hidden).toBe(true);
  });
  it("does not compare or rebuild results during repeated visible or hidden observation", () => {
    const f = fixture(), build = vi.spyOn(model, "buildNpcScoutComparison"), candidates = vi.spyOn(model, "listNpcScoutComparisonCandidates"); f.compare(); const summary = f.node("summary");
    for (let i = 0; i < 30; i++) f.controller.observe();
    expect(build).toHaveBeenCalledTimes(1); expect(candidates).toHaveBeenCalledTimes(1); expect(f.node("summary")).toBe(summary);
    f.messages.hidden = true; for (let i = 0; i < 30; i++) f.controller.observe(); expect(build).toHaveBeenCalledTimes(1); expect(candidates).toHaveBeenCalledTimes(1);
  });
  it.each(["anchor-evicted", "other-evicted", "anchor-cloned", "snapshot-replaced", "world"])("retires %s before the next click even without painting", kind => {
    const f = fixture(); f.compare(); const oldExact = f.node("exact"), oldBody = f.node("exact-body");
    if (kind === "world") f.setContext({ adoptedWorld: {} });
    else if (kind === "snapshot-replaced") { const replacement = { ...f.reports[0]!, npcScoutSnapshot: report(1).npcScoutSnapshot }; f.setContext({ messages: [replacement, ...f.reports.slice(1)] }); }
    else if (kind === "anchor-cloned") f.setContext({ messages: f.reports.map(message => message === f.anchor ? { ...message } : message) });
    else f.setContext({ messages: f.reports.filter(message => message !== (kind === "anchor-evicted" ? f.anchor : f.reports[0])) });
    f.run.emit("click"); expect(f.panel.hidden).toBe(true); expect(f.node("results").textContent).toBe("");
    oldExact.open = true; oldExact.emit("toggle"); expect(oldBody.textContent).toBe(""); f.setContext({ messages: f.reports }); f.run.disabled = false; f.run.emit("click"); expect(f.panel.hidden).toBe(true);
  });
  it("retires a changed snapshot reference on the same retained message object", () => {
    const a = { ...report(1) }, b = { ...report(2) }, f = fixture([a, b], 1); f.compare();
    a.npcScoutSnapshot = report(1).npcScoutSnapshot; f.run.emit("click");
    expect(f.panel.hidden).toBe(true); expect(f.node("results").textContent).toBe("");
  });
  it("does not add or choose a newer retained report during ordinary observation", () => {
    const f = fixture([report(1), report(2)], 1); f.open();
    const original = [...f.other.options]; f.setContext({ messages: [...f.reports, report(3)] }); f.controller.observe();
    expect(f.other.options).toEqual(original); expect(f.other.value).toBe(""); expect(f.run.disabled).toBe(true);
  });
  it("synchronously disables and clears protection, then requires a fresh registered report click", () => {
    const f = fixture(); f.compare(); f.setContext({ writable: false, protectionReason: "保存失败" }); f.controller.observe();
    expect(f.run.disabled).toBe(true); expect(f.other.disabled).toBe(true); expect(f.opener.disabled).toBe(true); expect(f.node("results").textContent).toBe("");
    f.setContext({ writable: true }); f.controller.observe(); f.opener.disabled = false; f.open(); expect(f.panel.hidden).toBe(true);
    const fresh = f.make("fresh-open", "button", f.messages); expect(f.controller.registerReport(button(fresh), f.anchor)).toBe(true); fresh.emit("click"); expect(f.panel.hidden).toBe(false); expect(f.run.disabled).toBe(true);
  });
  it.each(["cancel", "escape", "back", "tab", "document", "hidden-aba", "import-cancel", "reset-cancel"])("retires the result across %s until a fresh opening", kind => {
    const f = fixture(); f.compare(); const body = f.node("exact-body"), exact = f.node("exact");
    if (kind === "cancel") f.cancel.emit("click");
    else if (kind === "escape") f.other.emit("keydown", true, "Escape");
    else if (kind === "back") (window as unknown as NodeDouble).emit("popstate");
    else if (kind === "document") { (document as unknown as NodeDouble).hidden = true; (document as unknown as NodeDouble).emit("visibilitychange"); (document as unknown as NodeDouble).hidden = false; }
    else if (kind.startsWith("import") || kind.startsWith("reset")) f.controller.invalidate();
    else { f.messages.hidden = true; if (kind === "tab") f.controller.observe(); f.messages.hidden = false; f.controller.observe(); }
    expect(f.panel.hidden).toBe(true); f.run.disabled = false; f.run.emit("click"); exact.open = true; exact.emit("toggle"); expect(body.textContent).toBe(""); expect(f.node("results").textContent).toBe("");
  });
  it.each(["run", "other", "panel", "root", "body", "option", "summary"])("retires detached and reinserted %s even before mutation delivery", kind => {
    const f = fixture(); f.compare();
    const node = kind === "root" ? f.root : kind === "body" ? f.body : kind === "panel" ? f.panel : kind === "option" ? f.other.options[1]! : f.node(kind);
    const parent = node.parentElement!; node.remove(); parent.append(node); f.run.disabled = false; f.run.emit("click"); expect(f.panel.hidden).toBe(true); expect(f.node("results").textContent).toBe("");
  });
  it.each(["run", "other", "cancel", "title", "warning", "summary", "exact"].flatMap(control => ["hidden", "style", "aria-hidden"].map(attribute => [control, attribute] as const)))("retires direct %s %s hide/restore ABA", (control, attribute) => {
    const f = fixture(); f.compare(); const node = f.node(control);
    if (attribute === "hidden") { node.hidden = true; node.hidden = false; } else { node.setAttribute(attribute, attribute === "style" ? "display:none" : "true"); node.removeAttribute(attribute); }
    f.run.emit("click"); expect(f.panel.hidden).toBe(true); expect(f.node("results").textContent).toBe("");
  });
  it("rejects a detached or cloned report button, replacement option and disposed controller", () => {
    const f = fixture(); f.open(); f.opener.remove(); f.messages.append(f.opener); f.controller.observe();
    expect(f.controller.registerReport(button(f.opener), f.anchor)).toBe(false); f.opener.disabled = false; f.open(); expect(f.panel.hidden).toBe(true);
    const g = fixture(); g.open(); g.select(); const option = g.other.options[1]!; option.remove(); const clone = new NodeDouble("option"); clone.value = option.value; g.other.append(clone); g.run.emit("click"); expect(g.panel.hidden).toBe(true);
    const h = fixture(); h.compare(); h.controller.dispose(); h.run.disabled = false; h.run.emit("click"); h.open(); expect(h.panel.hidden).toBe(true);
  });
  it.each(["snapshot", "index", "iterator", "context", "snapshot-field", "snapshot-target"])("never invokes a malicious %s getter/iterator after registration", kind => {
    const a = { ...report(1), npcScoutSnapshot: { ...report(1).npcScoutSnapshot! } }, b = { ...report(2) }, f = fixture([a, b], 1);
    const attack = vi.fn(() => { throw Error("accessor must not execute"); });
    f.compare();
    if (kind === "snapshot") Object.defineProperty(a, "npcScoutSnapshot", { get: attack, enumerable: true });
    else if (kind === "snapshot-field") Object.defineProperty(a.npcScoutSnapshot, "fleetId", { get: attack, enumerable: true });
    else if (kind === "snapshot-target") Object.defineProperty(a.npcScoutSnapshot, "target", { get: attack, enumerable: true });
    else if (kind === "context") Object.defineProperty(f.context(), "messages", { get: attack, enumerable: true });
    else {
      const messages = [...f.reports];
      if (kind === "index") Object.defineProperty(messages, "0", { get: attack, enumerable: true });
      else Object.defineProperty(messages, Symbol.iterator, { value: attack });
      f.setContext({ messages });
    }
    expect(() => f.controller.observe()).not.toThrow(); expect(() => f.run.emit("click")).not.toThrow(); expect(attack).not.toHaveBeenCalled();
    expect(f.panel.hidden).toBe(true); expect(f.node("results").textContent).toBe(""); expect(f.node("notice").hidden).toBe(false);
  });
  it.each(["fleetId", "target", "observedAt"])("does not read raw anchor %s after the click-only validator rejects it", key => {
    const anchor = { ...report(2), npcScoutSnapshot: { ...report(2).npcScoutSnapshot! } }, f = fixture([report(1), anchor], 1);
    const attack = vi.fn(() => { throw Error("anchor getter"); }); Object.defineProperty(anchor.npcScoutSnapshot, key, { get: attack, enumerable: true });
    expect(() => f.open()).not.toThrow(); expect(attack).not.toHaveBeenCalled(); expect(f.panel.hidden).toBe(true); expect(f.node("notice").hidden).toBe(false);
  });
  it("safely retires when the context provider throws", () => {
    const f = fixture(); f.compare(); f.failHost(); expect(() => f.controller.observe()).not.toThrow(); expect(f.panel.hidden).toBe(true); expect(f.run.disabled).toBe(true);
  });
  it.each(["hidden", "style", "aria-hidden"])("permanently retires a report-row %s hide/restore but allows a fresh report button", attribute => {
    const f = fixture(), row = f.make("report-row", "article", f.messages);
    // Move the old source before registering a fresh source in the row.
    const opener = f.make("row-open", "button", row); f.controller.registerReport(button(opener), f.anchor); opener.emit("click"); f.select(); f.run.emit("click");
    if (attribute === "hidden") { row.hidden = true; row.hidden = false; } else { row.setAttribute(attribute, attribute === "style" ? "display:none" : "true"); row.removeAttribute(attribute); }
    f.controller.observe(); expect(opener.disabled).toBe(true); expect(f.panel.hidden).toBe(true); expect(f.node("notice").hidden).toBe(false);
    opener.disabled = false; opener.emit("click"); expect(f.panel.hidden).toBe(true); f.open(); expect(f.panel.hidden).toBe(false); expect(f.node("notice").hidden).toBe(true);
  });
  it("keeps a visible explanation when the chosen message disappears and clears it only on a fresh open", () => {
    const f = fixture(); f.compare(); f.setContext({ messages: [f.anchor] }); f.controller.observe();
    expect(f.panel.hidden).toBe(true); expect(f.node("notice").hidden).toBe(false); expect(f.node("notice").textContent).toContain("重新打开");
    expect(f.node("results").textContent).toBe(""); f.open(); expect(f.node("notice").hidden).toBe(true); expect(f.node("status").textContent).toContain("不足两份");
  });
  it("does not accept replay of the exact same trusted event object in the behavioral double", () => {
    const f = fixture(); const openingEvent = f.open(); f.controller.close();
    for (const listener of f.opener.listeners.get("click") ?? []) listener(openingEvent); expect(f.panel.hidden).toBe(true);
    f.open(); f.select(); const build = vi.spyOn(model, "buildNpcScoutComparison"), runEvent = f.run.emit("click");
    for (const listener of f.run.listeners.get("click") ?? []) listener(runEvent); expect(build).toHaveBeenCalledTimes(1);
  });
});
