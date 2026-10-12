import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHIP_IDS } from "../src/data/units";
import type { FleetMessage } from "../src/game/fleet";
import * as rehearsal from "../src/game/npc-rehearsal";
import type { NpcScoutSnapshotV1 } from "../src/game/npc-scout-state";
import {
  installNpcRehearsalPanel, npcRehearsalPanelHtml, readNpcRehearsalSelection,
  NPC_REHEARSAL_FLYING_IDS, NPC_REHEARSAL_UNAVAILABLE, NPC_REHEARSAL_WARNING,
  type NpcRehearsalContext, type NpcRehearsalDraft, type NpcRehearsalHost,
} from "../src/ui/npc-rehearsal-panel";
import source from "../src/ui/npc-rehearsal-panel.ts?raw";

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
const zeroSelection = () => Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, "0"]));
function snapshot(): NpcScoutSnapshotV1 {
  return Object.freeze({ model: "npc-scout-snapshot-v1", fleetId: 1, originId: "historical-origin", target: Object.freeze({ galaxy: 1, system: 56, position: 6 }), observedAt: "10",
    stock: Object.freeze([515, 257.5, 3] as const), garrison: Object.freeze({ light_fighter: 3, heavy_fighter: 0 }), defenderTech: Object.freeze({ weapons: 0, shields: 0, armour: 0 }) });
}

function fixture() {
  const doc = new NodeDouble(); doc.connectedRoot = true;
  const body = new NodeDouble(), root = new NodeDouble(), messages = new NodeDouble(), panel = new NodeDouble("section");
  doc.append(body); body.append(root); root.append(messages); messages.id = "space-messages";
  messages.append(panel); panel.id = "npc-rehearsal-panel"; panel.hidden = true;
  function make(id: string, tag = "div", parent = panel) { const node = new NodeDouble(tag); node.id = id; parent.append(node); return node; }
  for (const id of ["title", "source", "origin", "status", "results", "fill-explanation"]) make(`npc-rehearsal-${id}`);
  const history = make("npc-rehearsal-history", "details"); make("npc-rehearsal-history-body", "div", history);
  const run = make("npc-rehearsal-run", "button"), cancel = make("npc-rehearsal-cancel", "button"), fill = make("npc-rehearsal-fill", "button"), speed = make("npc-rehearsal-speed", "select"); speed.value = "100";
  for (const id of NPC_REHEARSAL_FLYING_IDS) { make(`npc-rehearsal-stock-${id}`, "small"); make(`npc-rehearsal-ship-${id}`, "input").value = "0"; }
  const message: FleetMessage = Object.freeze({ id: "scout-1", at: 10, text: '<img src=x onerror="bad"> 历史文本不解析', npcScoutSnapshot: snapshot() });
  let context: NpcRehearsalContext = { adoptedWorld: {}, messages: [message], origin: { id: "current-origin", name: "当前星球", coordinates: { galaxy: 1, system: 56, position: 11 } }, landedShips: Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, 100])), completedTech: { weapons: 1, shields: 0, armour: 0 }, completedHyperspaceLevel: 8, writable: true, protectionReason: "" };
  let fleetDraft: NpcRehearsalDraft | null = null;
  const quote = vi.fn(() => ({ ok: true, reason: "可出征" }));
  const commit = vi.fn<NpcRehearsalHost["fillDraft"]>((draft, consume) => {
    if (!consume()) return { ok: false, reason: "草稿校验已失效" };
    fleetDraft = draft; return { ok: true, reason: "仅已填入，尚未派遣或付款" };
  });
  const host: NpcRehearsalHost = { readContext: () => context, quoteAttack: quote, fillDraft: commit };
  const controller = installNpcRehearsalPanel(element(root), host);
  controller.observe();
  const opener = make("report-open", "button", messages); controller.registerReport(button(opener), message);
  const node = (id: string) => root.querySelector(`#npc-rehearsal-${id}`)!;
  const ship = (id = "light_fighter") => node(`ship-${id}`);
  const edit = (count: string, id = "light_fighter") => { ship(id).value = count; ship(id).emit("input"); };
  const open = () => opener.emit("click");
  const runFleet = (count = "4") => { open(); edit(count); run.emit("click"); };
  return { doc, body, root, messages, panel, history, run, cancel, fill, speed, opener, message, controller, quote, commit, node, ship, edit, open, runFleet, make,
    context: () => context, setContext: (patch: Partial<NpcRehearsalContext>) => { context = { ...context, ...patch }; }, draft: () => fleetDraft };
}

beforeEach(() => {
  const documentDouble = new NodeDouble(), windowDouble = new NodeDouble();
  Object.assign(documentDouble, { activeElement: null, createElement: (tag: string) => new NodeDouble(tag) });
  vi.stubGlobal("document", documentDouble); vi.stubGlobal("window", windowDouble); vi.stubGlobal("Element", NodeDouble); vi.stubGlobal("MutationObserver", ObserverDouble); ObserverDouble.instances = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("historical rehearsal selection and markup", () => {
  it("offers the existing 13 flying types at zero without touching ordinary ship fields", () => {
    const html = npcRehearsalPanelHtml();
    expect(NPC_REHEARSAL_FLYING_IDS).toEqual(SHIP_IDS.filter(id => id !== "solar_satellite"));
    expect(html.match(/演练数量/g)).toHaveLength(13); expect(html.match(/value="0"/g)).toHaveLength(13);
    expect(html).not.toContain("data-ship="); expect(html).not.toContain("solar_satellite"); expect(html).toContain("全部 13 类舰船数量");
    expect(html).toContain("aria-describedby=\"npc-rehearsal-fill-explanation\""); expect(html).toContain("填入攻击草稿（空载）");
  });
  it("admits the full 13e12 total and refuses overflow instead of truncating", () => {
    const raw = Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, "1000000000000"])), stock = Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, 1e12]));
    expect(Object.values(readNpcRehearsalSelection(raw, stock)).reduce((sum, count) => sum + count, 0)).toBe(13e12);
    expect(() => readNpcRehearsalSelection({ ...raw, light_fighter: "1000000000001" }, stock)).toThrow(/上限/);
    expect(raw.light_fighter).toBe("1000000000000");
  });
  it.each(["-1", "1.5", "1e12", "", "Infinity", "NaN", "9007199254740992", " 1", "+1"])("rejects ambiguous or invalid count %s", value => {
    expect(() => readNpcRehearsalSelection({ ...zeroSelection(), light_fighter: value }, { light_fighter: 1e12 })).toThrow();
  });
  it("rejects empty, unlanded and forbidden zero-valued types without invoking accessors", () => {
    expect(() => readNpcRehearsalSelection(zeroSelection(), {})).toThrow(/至少/);
    expect(() => readNpcRehearsalSelection({ ...zeroSelection(), light_fighter: "1" }, {})).toThrow(/库存/);
    for (const key of ["solar_satellite", "rocket_launcher", "unknown"]) expect(() => readNpcRehearsalSelection({ ...zeroSelection(), [key]: "0" }, {})).toThrow();
    const getter = vi.fn(() => "1"), raw = zeroSelection(); Object.defineProperty(raw, "light_fighter", { get: getter, enumerable: true });
    expect(() => readNpcRehearsalSelection(raw, { light_fighter: 1 })).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it("has no live enemy, real seed, dispatch, settlement, persistence or timer dependency", () => {
    expect(source).not.toMatch(/\b(npcAt|projectNpc|npcBattleSeed|resolveNpcBattleCandidate|sendFleet|localStorage|setTimeout|requestAnimationFrame|Math\.random)\b/);
  });
});

describe("historical rehearsal panel authority", () => {
  it("opens zeroed, leaves the draft untouched and formats exact history only on demand", () => {
    const f = fixture(), runSpy = vi.spyOn(rehearsal, "rehearseNpcScout"), before = JSON.stringify(f.context()); f.open();
    expect(f.panel.hidden).toBe(false); expect(f.ship().value).toBe("0"); expect(f.speed.value).toBe("100"); expect(f.draft()).toBeNull(); expect(runSpy).not.toHaveBeenCalled();
    expect(f.node("source").textContent).toContain("历史情报，之后可能变化"); expect(f.node("origin").textContent).toContain("当前星球 [1:56:11]");
    expect(f.node("history-body").textContent).toBe(""); expect(document.activeElement).toBe(f.node("title"));
    f.history.open = true; f.history.emit("toggle"); expect(f.node("history-body").textContent).toContain("257.5"); expect(f.node("history-body").textContent).toContain("historical-origin");
    expect(f.node("history-body").textContent).toContain(f.message.text); expect(f.node("history-body").querySelector("img")).toBeNull();
    expect(JSON.stringify(f.context())).toBe(before); expect(runSpy).not.toHaveBeenCalled();
  });
  it("rejects text-only, copied message references and fabricated/clone buttons", () => {
    const f = fixture(), old = { ...f.message, npcScoutSnapshot: null }, fake = f.make("fake", "button", f.messages);
    expect(f.controller.registerReport(button(fake), old)).toBe(false); expect(fake.title).toBe(NPC_REHEARSAL_UNAVAILABLE);
    expect(f.controller.registerReport(button(fake), { ...f.message })).toBe(false);
    fake.dataset = { npcRehearsal: "scout-1", action: "run", originId: "current-origin" }; fake.emit("click"); expect(f.panel.hidden).toBe(true);
    f.opener.emit("click", false); expect(f.panel.hidden).toBe(true);
  });
  it("runs exactly once for unchanged selection, captures completed inputs and lists three separate examples", () => {
    const f = fixture(), spy = vi.spyOn(rehearsal, "rehearseNpcScout"), before = JSON.stringify(f.context()); f.runFleet();
    expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0].slice(2)).toEqual([{ weapons: 1, shields: 0, armour: 0 }, 1.4]);
    expect(f.run.disabled).toBe(false); expect(f.run.textContent).toBe("重新核对出征条件"); f.run.emit("click"); expect(spy).toHaveBeenCalledTimes(1);
    const result = f.node("results"); expect(result.querySelectorAll(".npc-battle-report")).toHaveLength(3); expect(result.textContent).toContain(NPC_REHEARSAL_WARNING);
    expect(result.textContent).toContain("npc-rehearsal-public-v1"); expect(result.textContent).toContain("真实出征在派遣时冻结货舱倍率，在抵达时读取战斗科技");
    expect(result.querySelectorAll("table")).toEqual([]); expect(JSON.stringify(f.context())).toBe(before); expect(f.draft()).toBeNull();
    const quoted = f.quote.mock.calls.length;
    for (let i = 0; i < 10; i++) f.controller.observe(); expect(spy).toHaveBeenCalledTimes(1); expect(f.quote).toHaveBeenCalledTimes(quoted);
  });
  it("rejects untrusted Run/Fill, including replay after valid review", () => {
    const f = fixture(), spy = vi.spyOn(rehearsal, "rehearseNpcScout"); f.open(); f.edit("4"); f.run.emit("click", false);
    expect(spy).not.toHaveBeenCalled(); f.run.emit("click"); f.fill.emit("click", false); expect(f.commit).not.toHaveBeenCalled(); expect(f.draft()).toBeNull();
  });
  it("folds per-example exact details and formats round data only after an explicit expansion", () => {
    const f = fixture(); f.runFleet(); const card = f.node("results").querySelectorAll("details")[0]!;
    expect(card.textContent).not.toContain("608135816"); card.open = true; card.emit("toggle");
    expect(card.textContent).toContain("608135816"); expect(card.textContent).toContain("我方永久损失"); expect(card.querySelectorAll("table")).toEqual([]);
    const rounds = card.querySelector("details")!; rounds.open = true; rounds.emit("toggle");
    expect(rounds.querySelectorAll("table")).toHaveLength(1); const region = rounds.querySelector(".space-table-scroll")!;
    expect(region.tabIndex).toBe(0); expect(region.attributes.role).toBe("region");
    const table = rounds.querySelector("table"); rounds.emit("toggle"); expect(rounds.querySelector("table")).toBe(table);
  });
  it("shows historical samples even when the exact current full attack quote fails", () => {
    const f = fixture(); f.quote.mockReturnValue({ ok: false, reason: "攻击需要武器技术等级 1" }); f.runFleet();
    expect(f.node("results").hidden).toBe(false); expect(f.fill.disabled).toBe(true); expect(f.node("status").textContent).toContain("攻击需要武器技术等级 1");
    f.fill.disabled = false; f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled();
    f.quote.mockReturnValue({ ok: true, reason: "可出征" }); f.controller.observe(); expect(f.fill.disabled).toBe(true);
    const spy = vi.spyOn(rehearsal, "rehearseNpcScout"); f.run.emit("click"); expect(f.fill.disabled).toBe(false); expect(spy).not.toHaveBeenCalled();
  });
  it("fills only an all-13 empty-cargo proposal, preserves origin and consumes only once", () => {
    const f = fixture(), before = JSON.stringify(f.context()); let replay: (() => boolean) | null = null;
    f.commit.mockImplementation((draft, consume) => { replay = consume; expect(consume()).toBe(true); expect(consume()).toBe(false); expect(Object.isFrozen(draft)).toBe(true); expect(Object.isFrozen(draft.ships)).toBe(true); return { ok: true, reason: "已填入" }; });
    f.runFleet(); f.speed.value = "70"; f.speed.emit("change"); f.run.emit("click"); f.fill.emit("click");
    expect(f.commit).toHaveBeenCalledTimes(1); const proposal = f.commit.mock.calls[0]![0];
    expect(proposal).toEqual({ mission: "attack", originId: "current-origin", target: { galaxy: 1, system: 56, position: 6 }, speedPercent: 70, cargo: { metal: 0, crystal: 0, deuterium: 0 }, ships: Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, id === "light_fighter" ? 4 : 0])) });
    expect((replay as unknown as () => boolean)()).toBe(false); expect(f.panel.hidden).toBe(true); expect(JSON.stringify(f.context())).toBe(before);
    f.fill.disabled = false; f.fill.emit("click"); expect(f.commit).toHaveBeenCalledTimes(1);
  });
  it("uses a new quote at Fill and immediately before the atomic commit", () => {
    const f = fixture(); f.runFleet(); f.quote.mockReturnValueOnce({ ok: true, reason: "可出征" }).mockReturnValueOnce({ ok: false, reason: "燃料已不足" });
    f.fill.emit("click"); expect(f.commit).toHaveBeenCalledTimes(1); expect(f.draft()).toBeNull(); expect(f.panel.hidden).toBe(false);
  });
  it("expires a deferred fill callback at the end of the synchronous handoff", () => {
    const f = fixture(); let deferred: (() => boolean) | undefined;
    f.commit.mockImplementation((_draft, consume) => { deferred = consume; return { ok: false, reason: "延期回调无效" }; });
    f.runFleet(); f.fill.emit("click"); expect(deferred!()).toBe(false); expect(f.draft()).toBeNull();
  });
  it.each(["ships", "speed"])("editing %s discards the reviewed result and cannot auto-run", kind => {
    const f = fixture(), spy = vi.spyOn(rehearsal, "rehearseNpcScout"); f.runFleet();
    if (kind === "ships") f.edit("5"); else { f.speed.value = "50"; f.speed.emit("change"); }
    expect(f.node("results").hidden).toBe(true); expect(f.fill.disabled).toBe(true); expect(f.run.disabled).toBe(false); expect(spy).toHaveBeenCalledTimes(1);
    f.fill.disabled = false; f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled();
  });
  it.each(["stock", "weapons", "cargo"])("keeps old examples visible but permanently retires their Fill after a %s change", kind => {
    const f = fixture(), original = f.context(); f.runFleet(); const resultText = f.node("results").textContent;
    if (kind === "stock") f.setContext({ landedShips: { ...original.landedShips, light_fighter: 99 } });
    else if (kind === "weapons") f.setContext({ completedTech: { ...original.completedTech, weapons: 2 } });
    else f.setContext({ completedHyperspaceLevel: 9 });
    f.controller.observe(); expect(f.node("results").textContent).toBe(resultText); expect(f.fill.disabled).toBe(true); expect(f.run.disabled).toBe(false);
    f.setContext(original); f.controller.observe(); expect(f.fill.disabled).toBe(true);
    f.run.emit("click"); expect(f.fill.disabled).toBe(false);
  });
  it("rechecks unpainted stock/tech changes at Fill", () => {
    const f = fixture(); f.runFleet(); f.setContext({ completedTech: { weapons: 2, shields: 0, armour: 0 } }); f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled();
  });
  it.each(["cancel", "escape", "back", "tab", "document", "hide-reinsert"])("retires the review across %s and requires deliberate reopening", kind => {
    const f = fixture(); f.runFleet();
    if (kind === "cancel") f.cancel.emit("click");
    else if (kind === "escape") f.ship().emit("keydown", true, "Escape");
    else if (kind === "back") (window as unknown as NodeDouble).emit("popstate");
    else if (kind === "tab") { f.messages.hidden = true; f.controller.observe(); f.messages.hidden = false; }
    else if (kind === "document") { (document as unknown as NodeDouble).hidden = true; (document as unknown as NodeDouble).emit("visibilitychange"); (document as unknown as NodeDouble).hidden = false; }
    else { f.messages.hidden = true; f.messages.hidden = false; f.controller.observe(); }
    expect(f.panel.hidden).toBe(true); f.fill.disabled = false; f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled();
    if (kind === "cancel" || kind === "escape") expect(document.activeElement).toBe(f.opener);
    f.open(); expect(f.panel.hidden).toBe(false); expect(f.ship().value).toBe("0"); expect(f.fill.disabled).toBe(true);
  });
  it.each(["run", "input", "panel", "root", "body"])("permanently retires detach/reinsert of the original %s before observer delivery", kind => {
    const f = fixture(); f.runFleet();
    const node = kind === "run" ? f.run : kind === "input" ? f.ship() : kind === "panel" ? f.panel : kind === "root" ? f.root : f.body, parent = node.parentElement!;
    node.remove(); parent.append(node); f.fill.disabled = false; f.fill.emit("click");
    expect(f.commit).not.toHaveBeenCalled(); f.open(); expect(f.panel.hidden).toBe(true);
  });
  it("does not reauthorize detached report nodes or a replacement with a copied ID/dataset", () => {
    const f = fixture(); f.runFleet(); f.opener.remove(); f.messages.append(f.opener); f.controller.observe();
    expect(f.controller.registerReport(button(f.opener), f.message)).toBe(false); f.opener.disabled = false; f.open(); expect(f.panel.hidden).toBe(true);
    const clone = f.make("report-open", "button", f.messages); clone.dataset = { ...f.opener.dataset }; clone.emit("click"); expect(f.panel.hidden).toBe(true);
  });
  it("retires a reviewed result card detached and reinserted before Fill", () => {
    const f = fixture(); f.runFleet(); const card = f.node("results").querySelector("details")!, parent = card.parentElement!;
    card.remove(); parent.append(card); f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled(); expect(f.panel.hidden).toBe(true);
  });
  it.each(["run", "fill", "speed", ...NPC_REHEARSAL_FLYING_IDS.map(id => `ship-${id}`), "sample-summary"].flatMap(control => ["hidden", "style", "aria-hidden"].map(attribute => [control, attribute] as const)))("retires direct %s %s hiding even after restoration before the observer callback", (control, attribute) => {
    const f = fixture(); f.runFleet();
    const node = control === "sample-summary" ? f.node("results").querySelector("summary")! : f.node(control);
    if (attribute === "hidden") { node.hidden = true; node.hidden = false; }
    else { node.setAttribute(attribute, attribute === "style" ? "display:none" : "true"); node.removeAttribute(attribute); }
    f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled(); expect(f.panel.hidden).toBe(true);
  });
  it("releases old result observers on repeated stale-stock reruns without any input edit", () => {
    const f = fixture(); f.runFleet();
    for (let stock = 99; stock >= 96; stock--) {
      const previous = f.node("results").querySelector("details")!;
      previous.open = true; previous.emit("toggle");
      const oldNodes = [previous, ...previous.querySelectorAll("div"), ...previous.querySelectorAll("summary")];
      f.setContext({ landedShips: { ...f.context().landedShips, light_fighter: stock } }); f.controller.observe(); f.run.emit("click");
      const current = f.node("results").querySelector("details")!;
      expect(current).not.toBe(previous); expect(f.fill.disabled).toBe(false);
      expect(ObserverDouble.instances.some(observer => observer.parents.has(current))).toBe(true);
      for (const node of oldNodes) expect(ObserverDouble.instances.some(observer => observer.parents.has(node))).toBe(false);
    }
  });
  it.each(["world", "origin", "evicted", "snapshot", "protection"])("retires pending callbacks on exact %s invalidation even without a paint", kind => {
    const f = fixture(); f.runFleet();
    if (kind === "world") f.setContext({ adoptedWorld: {} });
    else if (kind === "origin") f.setContext({ origin: { ...f.context().origin, id: "new-origin" } });
    else if (kind === "evicted") f.setContext({ messages: [] });
    else if (kind === "snapshot") f.setContext({ messages: [{ ...f.message, npcScoutSnapshot: snapshot() }] });
    else f.setContext({ writable: false, protectionReason: "写入冲突" });
    f.fill.emit("click"); expect(f.commit).not.toHaveBeenCalled(); expect(f.panel.hidden).toBe(true);
  });
  it("never revives old report buttons on protection recovery; freshly registered protected history remains readable", () => {
    const f = fixture(); f.runFleet(); f.setContext({ writable: false, protectionReason: "写入冲突" }); f.controller.observe();
    f.setContext({ writable: true }); f.controller.observe(); f.opener.disabled = false; f.open(); expect(f.panel.hidden).toBe(true);
    f.setContext({ writable: false }); f.controller.observe(); const fresh = f.make("new-report", "button", f.messages);
    expect(f.controller.registerReport(button(fresh), f.message)).toBe(true); fresh.emit("click"); expect(f.panel.hidden).toBe(false); expect(f.run.disabled).toBe(true); expect(f.fill.disabled).toBe(true);
    f.history.open = true; f.history.emit("toggle"); expect(f.node("history-body").textContent).toContain("257.5");
  });
  it("explicit invalidation preserves history and permits a fresh current-world review after curvature", () => {
    const f = fixture(); f.runFleet(); const history = f.context().messages;
    f.controller.invalidate(); f.setContext({ adoptedWorld: {}, origin: { ...f.context().origin, id: "after-curvature" } }); f.controller.observe();
    expect(f.context().messages).toBe(history); f.opener.disabled = false; f.open(); expect(f.panel.hidden).toBe(true);
    const fresh = f.make("current-history", "button", f.messages); f.controller.registerReport(button(fresh), f.message); fresh.emit("click"); f.edit("4"); f.run.emit("click"); f.fill.emit("click");
    expect(f.draft()?.originId).toBe("after-curvature"); expect(f.draft()?.target).toEqual(f.message.npcScoutSnapshot!.target);
  });
  it("retires the synchronous fill guard when a confirmation or context change intervenes", () => {
    const f = fixture(); f.runFleet(); f.commit.mockImplementation((_draft, consume) => { f.controller.invalidate("取消导入仍须重新审阅"); expect(consume()).toBe(false); return { ok: false, reason: "已取消" }; });
    f.fill.emit("click"); expect(f.draft()).toBeNull(); expect(f.panel.hidden).toBe(true);
  });
  it("does not format hidden rounds or compute on restored visibility", () => {
    const f = fixture(), spy = vi.spyOn(rehearsal, "rehearseNpcScout"); f.runFleet(); const card = f.node("results").querySelectorAll("details")[0]!;
    f.messages.hidden = true; card.open = true; card.emit("toggle"); expect(card.querySelector("details")).toBeNull();
    f.messages.hidden = false; f.controller.observe(); expect(spy).toHaveBeenCalledTimes(1); expect(f.panel.hidden).toBe(true);
  });
  it("dispose retires every remaining callback without changing the current draft", () => {
    const f = fixture(); f.runFleet(); f.controller.dispose(); f.opener.disabled = false; f.open(); f.run.disabled = false; f.run.emit("click"); f.fill.disabled = false; f.fill.emit("click");
    expect(f.commit).not.toHaveBeenCalled(); expect(f.draft()).toBeNull();
  });
});
