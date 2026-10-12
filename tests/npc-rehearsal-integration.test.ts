import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { quoteFlight, sendFleet, type FleetMessage, type FleetRequest } from "../src/game/fleet";
import * as fleet from "../src/game/fleet";
import { tick, evaluatePrestige } from "../src/game/logic";
import * as rehearsal from "../src/game/npc-rehearsal";
import { createFormation, deleteFormation, editFormation } from "../src/game/formations";
import { enqueueResearch } from "../src/game/research";
import { createInitialState } from "../src/game/state";
import { installNpcAttackControls, type NpcAttackUiAction } from "../src/ui/npc-attack-controls";
import { NPC_REHEARSAL_FLYING_IDS } from "../src/ui/npc-rehearsal-panel";
import { installSpaceChrome, installSpaceNpcRehearsal } from "../src/ui/space-panel";
import mainSource from "../src/main.ts?raw";
import panelSource from "../src/ui/space-panel.ts?raw";

/** Behavioral DOM double only. It does not establish native event trust,
 * layout, measured frame times or actual browser focus/keyboard behavior. */
type Listener = (event: { target: NodeDouble; isTrusted: boolean; key?: string; preventDefault(): void }) => void;
class NodeDouble {
  id = ""; className = ""; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  tagName: string; private valueText = ""; private typeText = "number"; max = ""; disabled = false; title = ""; open = false; tabIndex = -1;
  connectedRoot = false; parentElement: NodeDouble | null = null; children: NodeDouble[] = [];
  listeners = new Map<string, Listener[]>(); ownText = ""; private hiddenValue = false;
  constructor(tag = "div") { this.tagName = tag; }
  get parentNode() { return this.parentElement; }
  get type() { return this.typeText; }
  set type(value: string) { this.typeText = value; }
  get value() { return this.valueText; }
  set value(value: string) { this.valueText = value; }
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
  get nextElementSibling(): NodeDouble | null { const siblings = this.parentElement?.children; return siblings?.[siblings.indexOf(this) + 1] ?? null; }
  contains(node: NodeDouble): boolean { return node === this || this.children.some(child => child.contains(node)); }
  append(...nodes: NodeDouble[]) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: NodeDouble, before: NodeDouble | null) { node.remove(); node.parentElement = this; if (before) this.children.splice(this.children.indexOf(before), 0, node); else this.children.push(node); }
  remove() {
    const parent = this.parentElement; if (!parent) return;
    parent.children = parent.children.filter(child => child !== this); this.parentElement = null;
    for (const observer of ObserverDouble.instances) if (observer.parents.has(parent)) observer.records.push({ type: "childList", removedNodes: [this] } as unknown as MutationRecord);
  }
  replaceChildren(...nodes: NodeDouble[]) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  matches(selector: string): boolean {
    if (selector.includes(",")) return selector.split(",").some(part => this.matches(part));
    if (selector === "[data-ship]") return !!this.dataset.ship;
    const attr = /^\[data-(ship|space)="(.+)"\]$/.exec(selector);
    if (attr) return this.dataset[attr[1]!] === attr[2];
    return selector.startsWith("#") ? this.id === selector.slice(1) : selector.startsWith(".") ? this.className.split(" ").includes(selector.slice(1)) : selector === this.tagName;
  }
  querySelectorAll(selector: string): NodeDouble[] { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
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
    expect(options.childList).toBe(true); this.parents.add(parent);
  }
  takeRecords() { const records = this.records; this.records = []; return records; }
  disconnect() { this.parents.clear(); }
}
const asElement = (node: NodeDouble) => node as unknown as HTMLElement;
const asButton = (node: NodeDouble) => node as unknown as HTMLButtonElement;
const TARGET = { galaxy: 1, system: 56, position: 6 };

/** Explicit synthetic state for authority/effect testing, not paid-route evidence. */
function fixture() {
  let state = createInitialState(20261010, 97531);
  const planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) };
  planet.buildings.shipyard = 2;
  for (const id of NPC_REHEARSAL_FLYING_IDS) planet.units[id] = 100;
  Object.assign(state.research.levels, { weapons_tech: 1, combustion_drive: 2, hyperspace_tech: 8 });
  const message: FleetMessage = { id: "scout-1", at: 10, text: "侦察历史：<img src=x onerror=bad>", npcScoutSnapshot: {
    model: "npc-scout-snapshot-v1", fleetId: 1, originId: "historical-gone", target: { ...TARGET }, observedAt: "10",
    stock: [515, 257.5, 3], garrison: { light_fighter: 3, heavy_fighter: 0 }, defenderTech: { weapons: 0, shields: 0, armour: 0 },
  } };
  state.messages = [message]; state.totalTime = big(10); state.nextFleetId = 2;
  const doc = new NodeDouble(); doc.connectedRoot = true;
  const body = new NodeDouble(), root = new NodeDouble(); doc.append(body); body.append(root);
  function make(id: string, tag = "div", parent = root) { const node = new NodeDouble(tag); node.id = id; parent.append(node); return node; }
  const messages = make("space-messages"), list = make("space-message-list", "div", messages), panel = make("npc-rehearsal-panel", "section", messages); panel.hidden = true;
  for (const id of ["title", "source", "origin", "status", "results", "fill-explanation"]) make(`npc-rehearsal-${id}`, "div", panel);
  make("npc-rehearsal-formation", "select", panel); make("npc-rehearsal-copy", "button", panel); make("npc-rehearsal-formation-source", "p", panel);
  const deficits = make("npc-rehearsal-deficits", "details", panel); make("npc-rehearsal-deficit-summary", "summary", deficits); make("npc-rehearsal-deficit-body", "div", deficits);
  const history = make("npc-rehearsal-history", "details", panel); make("npc-rehearsal-history-body", "div", history);
  for (const id of ["run", "cancel", "fill"]) make(`npc-rehearsal-${id}`, "button", panel);
  make("npc-rehearsal-speed", "select", panel).value = "100";
  for (const id of NPC_REHEARSAL_FLYING_IDS) { make(`npc-rehearsal-stock-${id}`, "small", panel); make(`npc-rehearsal-ship-${id}`, "input", panel).value = "0"; }
  const fleetPanel = make("space-fleet"); fleetPanel.hidden = true;
  make("space-galaxy"); make("space-fleets", "div", fleetPanel);
  const handoffNotice = make("npc-rehearsal-draft-notice", "p", fleetPanel); handoffNotice.hidden = true; handoffNotice.className = "npc-rehearsal-draft-notice muted";
  make("ordinary-status", "p", fleetPanel).className = "space-status";
  make("ordinary-location", "p", fleetPanel).className = "space-location";
  make("npc-attack-options", "div", fleetPanel); make("npc-attack-draft-status", "p", fleetPanel);
  const send = make("space-send", "button", fleetPanel), clear = make("clear", "button", fleetPanel); clear.dataset.space = "attack-clear-cargo";
  make("flight-mission", "select", fleetPanel).value = "transport"; make("flight-speed", "select", fleetPanel).value = "20";
  for (const id of ["galaxy", "system", "position"]) make(`flight-${id}`, "input", fleetPanel).value = "1";
  for (const id of ["metal", "crystal", "deuterium"]) make(`cargo-${id}`, "input", fleetPanel).value = "17";
  for (const id of NPC_REHEARSAL_FLYING_IDS) { const node = make(`ordinary-${id}`, "input", fleetPanel); node.dataset.ship = id; node.value = "9"; }
  const read = (): FleetRequest => ({ mission: root.querySelector("#flight-mission")!.value as "attack", speedPercent: Number(root.querySelector("#flight-speed")!.value), target: { galaxy: Number(root.querySelector("#flight-galaxy")!.value), system: Number(root.querySelector("#flight-system")!.value), position: Number(root.querySelector("#flight-position")!.value) }, ships: Object.fromEntries(NPC_REHEARSAL_FLYING_IDS.map(id => [id, Number(root.querySelector(`#ordinary-${id}`)!.value)])), cargo: { metal: big(root.querySelector("#cargo-metal")!.value), crystal: big(root.querySelector("#cargo-crystal")!.value), deuterium: big(root.querySelector("#cargo-deuterium")!.value) } });
  const actions: NpcAttackUiAction[] = [];
  const attack = installNpcAttackControls(asElement(root), read, action => actions.push(action));
  attack.observe(state, true, "");
  let formationSource: string | null = "old-formation", afterCalls = 0;
  const bridge = installSpaceNpcRehearsal(asElement(root), () => {
    afterCalls++; formationSource = null;
    fleetPanel.hidden = false; messages.hidden = true; bridge.close(); attack.edited(true);
  });
  const updateSpaceChrome = installSpaceChrome(asElement(root), () => {});
  const observe = (ready = true) => { attack.observe(state, ready, ready ? "" : "写入冲突"); bridge.observe(state, ready, ready ? "" : "写入冲突"); };
  observe(); bridge.updateMessages();
  const node = (id: string) => root.querySelector(`#${id}`)!;
  const open = () => { messages.hidden = false; fleetPanel.hidden = true; bridge.updateMessages(); list.querySelector("button")!.emit("click"); };
  const run = (count = "4") => { open(); node("npc-rehearsal-ship-light_fighter").value = count; node("npc-rehearsal-ship-light_fighter").emit("input"); node("npc-rehearsal-run").emit("click"); };
  const fill = () => node("npc-rehearsal-fill").emit("click");
  return { doc, body, root, list, panel, fleetPanel, messages, bridge, updateSpaceChrome, attack, send, node, open, run, fill, read, observe, actions, message,
    state: () => state, setState: (next: typeof state) => { state = next; }, afterCalls: () => afterCalls, formation: () => formationSource };
}

beforeEach(() => {
  const doc = new NodeDouble(), win = new NodeDouble(); Object.assign(doc, { activeElement: null, createElement: (tag: string) => new NodeDouble(tag) });
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win); vi.stubGlobal("Element", NodeDouble); vi.stubGlobal("HTMLInputElement", NodeDouble); vi.stubGlobal("HTMLSelectElement", NodeDouble); vi.stubGlobal("MutationObserver", ObserverDouble); ObserverDouble.instances = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual space-panel historical rehearsal wiring", () => {
  it("keeps exact message row/button identity and focus stable through ordinary immutable ticks", () => {
    const f = fixture(), row = f.list.firstElementChild!, opener = row.querySelector("button")!, spy = vi.spyOn(rehearsal, "rehearseNpcScout"), quote = vi.spyOn(fleet, "quoteFlight");
    opener.focus(); const before = JSON.stringify(f.state());
    for (let i = 0; i < 8; i++) { f.setState({ ...f.state(), messages: [...f.state().messages] }); f.observe(); f.bridge.updateMessages(); }
    expect(f.list.firstElementChild).toBe(row); expect(row.querySelector("button")).toBe(opener); expect(document.activeElement).toBe(opener);
    expect(spy).not.toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled(); expect(JSON.stringify(f.state())).toBe(before);
    f.run(); expect(f.node("npc-rehearsal-results").querySelectorAll(".npc-battle-report")).toHaveLength(3);
  });
  it("inserts new messages without moving an existing open row and prunes evicted rows while hidden", () => {
    const f = fixture(); f.run(); const row = f.list.firstElementChild!;
    const plain: FleetMessage = { id: "other", at: 11, text: "普通消息", npcScoutSnapshot: null };
    f.setState({ ...f.state(), messages: [f.message, plain] }); f.observe(); f.bridge.updateMessages();
    expect(f.list.children[1]).toBe(row); expect(f.panel.hidden).toBe(false);
    expect(f.list.children[0]!.children.map(node => node.tagName)).toEqual(["small", "p"]); expect(f.list.children[0]!.dataset).toEqual({});
    expect(f.list.children[0]!.textContent).not.toContain("没有可用的演练快照");
    f.messages.hidden = true; f.setState({ ...f.state(), messages: [plain] }); f.observe();
    expect(row.isConnected).toBe(false); expect(f.panel.hidden).toBe(true);
  });
  it("fills the real draft atomically with all 13 counts and zero cargo, leaving every game field untouched", () => {
    const f = fixture(), before = JSON.stringify(f.state()); f.run();
    expect(f.read().mission).toBe("transport"); expect(f.read().cargo.metal.eq(17)).toBe(true); expect(f.actions).toEqual([]);
    f.fill(); expect(f.afterCalls()).toBe(1); expect(f.formation()).toBeNull(); expect(f.messages.hidden).toBe(true); expect(f.fleetPanel.hidden).toBe(false);
    const request = f.read(); expect(request.mission).toBe("attack"); expect(request.target).toEqual(TARGET); expect(request.speedPercent).toBe(100);
    expect(Object.keys(request.ships)).toEqual([...NPC_REHEARSAL_FLYING_IDS]); expect(request.ships.light_fighter).toBe(4);
    for (const id of NPC_REHEARSAL_FLYING_IDS) if (id !== "light_fighter") expect(request.ships[id]).toBe(0);
    expect(Object.values(request.cargo).every(value => value.eq(0))).toBe(true); expect(f.actions).toEqual([]); expect(JSON.stringify(f.state())).toBe(before);
    expect(f.node("npc-rehearsal-draft-notice").textContent).toContain("仅已填入，尚未派遣或付款");
  });
  it("only a separate existing send authority pays and dispatches, and that authority is one-shot", () => {
    const f = fixture(); f.run(); f.fill(); const before = JSON.stringify(f.state());
    expect(f.actions).toEqual([]); expect(quoteFlight(f.state(), f.read()).ok).toBe(true);
    f.attack.paint(true); f.attack.send(asButton(f.send)); expect(f.actions).toHaveLength(1);
    const action = f.actions[0]!; expect(f.attack.consume(action, f.state())).toBe(true); expect(f.attack.consume(action, f.state())).toBe(false);
    if (action.type !== "send-fleet") throw Error("wrong action");
    const sent = sendFleet(f.state(), action.request); expect(sent.ok).toBe(true); expect(sent.state.fleets).toHaveLength(1);
    expect(JSON.stringify(f.state())).toBe(before); expect(activePlanet(sent.state).units.light_fighter).toBe(activePlanet(f.state()).units.light_fighter - 4);
    expect(activePlanet(sent.state).resources.deuterium.lt(activePlanet(f.state()).resources.deuterium)).toBe(true);
  });
  it("keeps the unpaid handoff notice through the mounted production chrome renderer after Fill", () => {
    const f = fixture(); f.run(); f.fill(); const before = JSON.stringify(f.state()), notice = f.node("npc-rehearsal-draft-notice").textContent;
    for (const status of ["探测器已派遣", "已自动保存", "舰队已出发", ""]) {
      f.updateSpaceChrome("当前星球", status);
      expect(f.node("ordinary-status").textContent).toBe(status);
      expect(f.node("npc-rehearsal-draft-notice").textContent).toBe(notice); expect(f.node("npc-rehearsal-draft-notice").hidden).toBe(false);
    }
    expect(notice).toContain("仅已填入，尚未派遣或付款"); expect(JSON.stringify(f.state())).toBe(before); expect(f.actions).toEqual([]);
    expect(panelSource).toContain('const updateSpaceChrome=installSpaceChrome(root,()=>{if(selected)choose(selected);});');
    expect(panelSource).toContain('id="npc-rehearsal-draft-notice" class="npc-rehearsal-draft-notice muted"');
  });
  it.each(["ship", "cargo", "mission", "fleet", "root"])("rejects detached/reinserted real %s destinations without partial draft changes", kind => {
    const f = fixture(); f.run(); const before = JSON.stringify(f.read());
    const node = kind === "ship" ? f.node("ordinary-light_fighter") : kind === "cargo" ? f.node("cargo-metal") : kind === "mission" ? f.node("flight-mission") : kind === "fleet" ? f.fleetPanel : f.root;
    const parent = node.parentElement!; node.remove(); parent.append(node); f.fill();
    expect(JSON.stringify(f.read())).toBe(before); expect(f.afterCalls()).toBe(0); expect(f.actions).toEqual([]);
  });
  it("checks the latest full ordinary quote at Fill even when no paint ran after fuel changed", () => {
    const f = fixture(); f.run(); const before = JSON.stringify(f.read());
    activePlanet(f.state()).resources.deuterium = big(0); f.fill();
    expect(JSON.stringify(f.read())).toBe(before); expect(f.afterCalls()).toBe(0); expect(f.node("npc-rehearsal-status").textContent).toMatch(/燃料|重氢/);
  });
  it("forbids queued weapons from satisfying the quote while still allowing historical examples", () => {
    const f = fixture(); f.state().research.levels.weapons_tech = 0; activePlanet(f.state()).buildings.research_lab = 4;
    const queued = enqueueResearch(f.state(), "weapons_tech", "manual"); expect(queued.ok, queued.reason).toBe(true); f.setState(queued.state);
    expect(f.state().research.queue[0]!.targetLevel).toBe(1);
    // Even a due but not yet settled queue head is not a completed level.
    f.state().research.queue[0]!.remainingSeconds = 0; f.observe(); f.run();
    expect(f.node("npc-rehearsal-results").querySelectorAll(".npc-battle-report")).toHaveLength(3);
    expect(f.node("npc-rehearsal-results").textContent).toContain("武器 0");
    expect(f.node("npc-rehearsal-fill").disabled).toBe(true); expect(f.node("npc-rehearsal-status").textContent).toContain("武器技术等级 1");
  });
  it("shows a text-only legacy scout notice without manufacturing an actionable snapshot", () => {
    const f = fixture(), legacy = { ...f.message, npcScoutSnapshot: null };
    f.setState({ ...f.state(), messages: [legacy] }); f.observe(); f.bridge.updateMessages();
    const row = f.list.firstElementChild!;
    expect(row.dataset.messageId).toBe("scout-1"); expect(row.children.map(node => node.tagName)).toEqual(["small", "p", "p"]);
    expect(row.textContent).toContain("没有可用的演练快照；需要新的付费侦察抵达"); expect(row.querySelector("button")).toBeNull();
  });
  it("retirement before a cancelled/failed confirmation never changes the actual draft", () => {
    const f = fixture(); f.run(); const before = JSON.stringify(f.read()), history = f.state().messages;
    f.bridge.retire(); f.node("npc-rehearsal-fill").disabled = false; f.fill();
    expect(JSON.stringify(f.read())).toBe(before); expect(f.state().messages).toBe(history); expect(f.actions).toEqual([]);
    f.bridge.updateMessages(); f.run(); expect(f.node("npc-rehearsal-fill").disabled).toBe(false);
  });
  it("requires current retained message references after a same-ID adoption", () => {
    const f = fixture(); f.run(); const oldButton = f.list.querySelector("button")!, oldState = f.state(), before = JSON.stringify(f.read());
    const replacement = { ...oldState, messages: [{ ...f.message, npcScoutSnapshot: { ...f.message.npcScoutSnapshot! } }] };
    f.setState(replacement); f.bridge.adoptWorld(); f.observe(); f.bridge.updateMessages();
    oldButton.disabled = false; oldButton.emit("click"); expect(f.panel.hidden).toBe(true); expect(JSON.stringify(f.read())).toBe(before);
    f.run(); f.fill(); expect(f.afterCalls()).toBe(1);
  });
  it("disables immediately on protection, preserves draft and needs a newly rendered entry after recovery", () => {
    const f = fixture(); f.run(); const oldButton = f.list.querySelector("button")!, before = JSON.stringify(f.read()), quote = vi.spyOn(fleet, "quoteFlight");
    f.observe(false); expect(f.panel.hidden).toBe(true); expect(JSON.stringify(f.read())).toBe(before); expect(quote).not.toHaveBeenCalled();
    f.observe(); oldButton.disabled = false; oldButton.emit("click"); expect(f.panel.hidden).toBe(true);
    f.bridge.updateMessages(); f.run(); expect(f.node("npc-rehearsal-fill").disabled).toBe(false);
  });
  it("per-frame and hidden observation performs no quote, combat or sample rerun", () => {
    const f = fixture(); f.run(); const quote = vi.spyOn(fleet, "quoteFlight"), simulate = vi.spyOn(rehearsal, "rehearseNpcScout");
    for (let i = 0; i < 10; i++) f.observe();
    f.messages.hidden = true; for (let i = 0; i < 10; i++) f.observe();
    expect(quote).not.toHaveBeenCalled(); expect(simulate).not.toHaveBeenCalled();
  });
});

describe("main host adoption and pre-confirmation wiring", () => {
  it("uses explicit adoption and retires before an import await or replacement dialog", () => {
    expect(mainSource).toContain('if (["import-text", "import-file", "reset", "prestige"].includes(action.type)) view.retireNpcRehearsal();');
    expect(mainSource).toContain("state = result.state;\n  view.adoptNpcRehearsalWorld();");
    expect(mainSource).toContain("if (state.universe === adoptedUniverse) return;"); expect(mainSource).not.toContain("let adoptedLaunches");
    expect(panelSource).toContain('choose("fleet");transportLoad.edited();npcAttack.edited(true);');
    expect(panelSource).not.toContain('html(root,"#space-message-list"');
  });
  it("ordinary ticks preserve exact universe identity, while a same-seed saturated-count curvature replaces it", () => {
    const initial = createInitialState(42, 42), ordinary = tick(initial, .25);
    expect(ordinary).not.toBe(initial); expect(ordinary.universe).toBe(initial.universe);
    const ready = createInitialState(42, 42); ready.lifetime.metal = big("1e30"); ready.stats.launches = 1e20;
    const next = evaluatePrestige(ready).next;
    expect(next).not.toBe(ready); expect(next.stats.launches).toBe(ready.stats.launches); expect(next.universe.seed).toBe(ready.universe.seed); expect(next.universe).not.toBe(ready.universe);
  });
});


describe("saved formation to real historical rehearsal adapter", () => {
  function save(f: ReturnType<typeof fixture>, ships = { light_fighter: 4 }) {
    const result = createFormation(f.state(), { expectedNextFormationId: 1, name: "历史演练编成", ships });
    expect(result.ok).toBe(true); f.setState(result.state); f.observe();
  }
  function choose(f: ReturnType<typeof fixture>) { f.node("npc-rehearsal-formation").value = "1"; f.node("npc-rehearsal-formation").emit("change"); }
  function copy(f: ReturnType<typeof fixture>) { f.node("npc-rehearsal-copy").emit("click"); }
  it("copies a saved design into dense13 with no quote/payment/order or real-draft change", () => {
    const f = fixture(); save(f); f.open();
    for (const id of NPC_REHEARSAL_FLYING_IDS) f.node(`npc-rehearsal-ship-${id}`).value = "9";
    f.node("npc-rehearsal-speed").value = "70";
    const stateBefore = JSON.stringify(f.state()), draftBefore = JSON.stringify(f.read()), quote = vi.spyOn(fleet, "quoteFlight"), simulate = vi.spyOn(rehearsal, "rehearseNpcScout");
    choose(f); expect(f.node("npc-rehearsal-ship-light_fighter").value).toBe("9"); copy(f);
    for (const id of NPC_REHEARSAL_FLYING_IDS) expect(f.node(`npc-rehearsal-ship-${id}`).value).toBe(id === "light_fighter" ? "4" : "0");
    expect(f.node("npc-rehearsal-speed").value).toBe("70"); expect(JSON.stringify(f.read())).toBe(draftBefore); expect(JSON.stringify(f.state())).toBe(stateBefore);
    expect(quote).not.toHaveBeenCalled(); expect(simulate).not.toHaveBeenCalled(); expect(f.actions).toEqual([]); expect(f.afterCalls()).toBe(0);
    f.node("npc-rehearsal-run").emit("click"); expect(simulate).toHaveBeenCalledTimes(1); f.fill();
    expect(f.afterCalls()).toBe(1); expect(f.read().ships.light_fighter).toBe(4); expect(JSON.stringify(f.state())).toBe(stateBefore); expect(f.actions).toEqual([]);
  });
  it("keeps copied quantities independent and permits deletion of an unreferenced source", () => {
    const f = fixture(); save(f); f.open(); choose(f); copy(f);
    const edited = editFormation(f.state(), { formationId: 1, expectedRevision: 1, name: "新名称", ships: { light_fighter: 7 } });
    expect(edited.ok).toBe(true); f.setState(edited.state); f.observe(); expect(f.node("npc-rehearsal-ship-light_fighter").value).toBe("4");
    const deleted = deleteFormation(f.state(), { formationId: 1, expectedRevision: 2 }); expect(deleted.ok).toBe(true);
    f.setState(deleted.state); f.observe(); expect(f.node("npc-rehearsal-ship-light_fighter").value).toBe("4");
    expect(f.node("npc-rehearsal-formation-source").textContent).toBe("来自 #1 历史演练编成 · r1"); expect(f.state().orders.tasks).toEqual([]);
  });
  it("keeps saved shortages exact and does not rerun when inventory rises", () => {
    const f = fixture(); save(f, { light_fighter: 101 }); f.open(); choose(f); copy(f);
    const simulate = vi.spyOn(rehearsal, "rehearseNpcScout"), before = JSON.stringify(f.read()); f.node("npc-rehearsal-run").emit("click");
    expect(simulate).not.toHaveBeenCalled(); expect(f.node("npc-rehearsal-ship-light_fighter").value).toBe("101"); expect(f.node("npc-rehearsal-deficit-summary").textContent).toContain("缺额 1 艘");
    activePlanet(f.state()).units.light_fighter = 101; f.observe(); expect(simulate).not.toHaveBeenCalled(); expect(f.node("npc-rehearsal-fill").disabled).toBe(true); expect(JSON.stringify(f.read())).toBe(before);
    f.node("npc-rehearsal-run").emit("click"); expect(simulate).toHaveBeenCalledTimes(1);
  });
  it.each(["weapons", "fuel", "slots"])("can Run stocked copied numbers with insufficient %s, while Fill still uses the ordinary quote", kind => {
    const f = fixture(); save(f); f.open(); choose(f); copy(f);
    if (kind === "weapons") f.state().research.levels.weapons_tech = 0;
    else if (kind === "fuel") activePlanet(f.state()).resources.deuterium = big(0);
    else {
      const sent = sendFleet(f.state(), { mission: "attack", target: { ...TARGET }, ships: { light_fighter: 1 }, speedPercent: 100, cargo: { metal: big(0), crystal: big(0), deuterium: big(0) } });
      expect(sent.ok).toBe(true); f.setState(sent.state);
    }
    f.observe(); const before = JSON.stringify(f.state()), draft = JSON.stringify(f.read()); f.node("npc-rehearsal-run").emit("click");
    expect(f.node("npc-rehearsal-results").querySelectorAll(".npc-battle-report")).toHaveLength(3); expect(f.node("npc-rehearsal-fill").disabled).toBe(true);
    f.node("npc-rehearsal-fill").disabled = false; f.fill(); expect(JSON.stringify(f.state())).toBe(before); expect(JSON.stringify(f.read())).toBe(draft); expect(f.afterCalls()).toBe(0);
  });
});
