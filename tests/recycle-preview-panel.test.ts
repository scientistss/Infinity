import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { quoteFlight, type FleetRequest, type Mission } from "../src/game/fleet";
import * as flight from "../src/game/fleet";
import * as recycling from "../src/game/recycle-amounts";
import { tick } from "../src/game/logic";
import { enqueueResearch } from "../src/game/research";
import { serializeState } from "../src/game/save";
import { createInitialState, createPlanet } from "../src/game/state";
import type { GameState } from "../src/game/types";
import { recyclePreview, type RecyclePreview } from "../src/ui/recycle-preview-model";
import { installRecyclePreviewPanel, recyclePreviewHtml } from "../src/ui/recycle-preview-panel";
import { spaceFleetView } from "../src/ui/space-present";
import source from "../src/ui/recycle-preview-panel.ts?raw";
import adapter from "../src/ui/space-panel.ts?raw";
import presentSource from "../src/ui/space-present.ts?raw";

const { readFileSync } = await import("node:fs" as string) as { readFileSync(path: URL, encoding: "utf8"): string };
const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const DRAFT_ASSIGNMENT = /\.(?:value|disabled)\s*(?:=(?!=)|(?:[+\-*/%&|^?]{1,2}|<<|>>>?)=)/;

/** Same behavior-only DOM double as the existing read-only disclosure tests.
 * Native keyboard/focus, 320px layout and actual browser rendering are separate gates. */
class NodeDouble {
  id = ""; dataset: Record<string, string> = {}; children: NodeDouble[] = [];
  parentElement: NodeDouble | null = null; connectedRoot = false;
  attributeWrites = 0; textWrites = 0; private hiddenValue = false; private openValue = false;
  disabled = false; value = ""; private ownText = "";
  listeners = new Map<string, Array<(event: { target: NodeDouble }) => void>>();
  constructor(readonly tagName = "div") {}
  get hidden() { return this.hiddenValue; }
  set hidden(value: boolean) { this.attributeWrites++; this.hiddenValue = value; }
  get open() { return this.openValue; }
  set open(value: boolean) { this.attributeWrites++; this.openValue = value; }
  get isConnected(): boolean { return this.connectedRoot || !!this.parentElement?.isConnected; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.textWrites++; this.ownText = value; this.children = []; }
  set innerHTML(_value: string) { throw Error("Untrusted HTML must never be parsed"); }
  append(child: NodeDouble) { child.parentElement = this; this.children.push(child); }
  matches(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector === "[data-ship]") return !!this.dataset.ship;
    const key = /^\[data-recycle="([^"]+)"\]$/.exec(selector)?.[1];
    return key !== undefined && this.dataset.recycle === key;
  }
  querySelectorAll(selector: string): NodeDouble[] {
    return this.children.flatMap(child => [...(selector.split(",").some(part => child.matches(part)) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string): NodeDouble | null { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type: string, listener: (event: { target: NodeDouble }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, target = this) { for (const listener of this.listeners.get(type) ?? []) listener({ target }); }
  focus() { (document as unknown as { activeElement: NodeDouble }).activeElement = this; }
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function stateFixture(): GameState {
  const state = createInitialState(20261012, 42), home = activePlanet(state);
  home.coordinates = { galaxy: 1, system: 56, position: 11 };
  home.resources = { metal: big(1e8), crystal: big(1e8), deuterium: big(1e8) };
  Object.assign(home.units, { recycler: 10, small_cargo: 10 });
  Object.assign(home.buildings, { research_lab: 7, crystal_storage: 20, deuterium_tank: 20 });
  Object.assign(state.research.levels, { combustion_drive: 6, energy_tech: 5, shielding_tech: 5, computer_tech: 6 });
  state.deepSpace.debris = [{ target: { galaxy: 1, system: 56, position: 16 }, metal: "100000", crystal: "50000" }];
  return state;
}
function fixture() {
  const root = new NodeDouble(); root.connectedRoot = true;
  function node(id: string, tag = "div", parent = root) { const result = new NodeDouble(tag); result.id = id; parent.append(result); return result; }
  const fleet = node("space-fleet"), panel = node("recycle-preview", "div", fleet);
  const fields: Record<string, NodeDouble> = {};
  const bound = (key: string, tag = "p", parent = panel) => { const result = node("", tag, parent); result.dataset.recycle = key; fields[key] = result; return result; };
  bound("summary");
  const details = bound("details", "details"), summary = node("", "summary", details); summary.textContent = "回收估算详情";
  for (const key of ["target", "field", "capacity", "room", "leftovers", "notice"]) bound(key, "p", details);
  bound("protection");
  const input = (id: string, value: string, tag = "input") => { const result = node(id, tag, fleet); result.value = value; return result; };
  const mission = input("flight-mission", "recycle", "select"), speed = input("flight-speed", "100", "select");
  const galaxy = input("flight-galaxy", "1"), system = input("flight-system", "56"), position = input("flight-position", "16");
  const recycler = input("recycler-draft", "1"); recycler.dataset.ship = "recycler";
  const cargoShip = input("cargo-ship-draft", "1"); cargoShip.dataset.ship = "small_cargo";
  const metal = input("cargo-metal", "100"), crystal = input("cargo-crystal", "200"), deuterium = input("cargo-deuterium", "300");
  const send = node("space-send", "button", fleet); send.disabled = false;
  const quote = node("space-quote", "p", fleet); quote.textContent = "原有航程报价";
  const amount = (field: NodeDouble) => /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(field.value) ? big(field.value) : big(-1);
  const read = (): FleetRequest => ({ mission: mission.value as Mission, speedPercent: Number(speed.value),
    target: { galaxy: Number(galaxy.value), system: Number(system.value), position: Number(position.value) },
    ships: { recycler: Number(recycler.value), small_cargo: Number(cargoShip.value) },
    cargo: { metal: amount(metal), crystal: amount(crystal), deuterium: amount(deuterium) } });
  const controller = installRecyclePreviewPanel(root as unknown as HTMLElement);
  let state = stateFixture();
  const observe = (next = state, writable = true, reason = "") => { state = next; controller.observe(state, writable, reason); };
  const paint = () => { const model = spaceFleetView(state, read()); controller.update(model.recyclePreview); return model; };
  const edit = (field: NodeDouble, value: string, type = "input") => { field.value = value; root.emit(type, field); };
  const start = () => { observe(); return paint(); };
  return { root, fleet, panel, fields, details, summary, mission, speed, galaxy, system, position, recycler, cargoShip, metal, crystal, deuterium, send, quote, read, controller, observe, paint, edit, start, get state() { return state; } };
}

beforeEach(() => {
  const documentDouble = new NodeDouble() as NodeDouble & { activeElement: NodeDouble | null };
  documentDouble.activeElement = null;
  vi.stubGlobal("document", documentDouble);
  vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("read-only recycling draft disclosure", () => {
  it("starts hidden with a closed native disclosure and no added actions or storage", () => {
    const html = recyclePreviewHtml();
    expect(html).toContain('class="recycle-preview muted" hidden');
    expect(html).toContain('<details data-recycle="details"><summary>回收估算详情</summary>');
    expect(html).not.toMatch(/\bopen\b|<button|<input|<a\b|data-action|onclick/);
    expect(source).not.toMatch(/\b(quoteFlight|sendFleet|onAction|localStorage|sessionStorage|setTimeout|requestAnimationFrame|MutationObserver)\b/);
    expect(source).not.toMatch(DRAFT_ASSIGNMENT);
    expect(presentSource).toContain("recyclePreview:recyclePreview(state,request,quote)");
    expect(adapter).toContain("recyclePanel.observe(state,writable,protectionMessage)");
    expect(adapter).toContain("recyclePanel.update(model.recyclePreview)");
    expect(adapter).toContain("transportLoad.invalidate();recyclePanel.invalidate();npcAttack.invalidate()");
    expect(css).toMatch(/\.space-panel \.recycle-preview \{[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*overflow-wrap: anywhere;/);
    const f = fixture(); expect(f.panel.hidden).toBe(true); expect(f.details.open).toBe(false);
  });

  it("distinguishes real draft/control assignments from read-only comparisons", () => {
    for (const value of ["field.value = '3'", "send.disabled=true", "field.value += '0'", "field.value ||= '0'", "send.disabled &&= false", "field.value ??= '0'", "field.value <<= 1"]) {
      expect(value).toMatch(DRAFT_ASSIGNMENT);
    }
    for (const value of ["mission.value === 'recycle'", "field.value == '3'", "send.disabled === true", "send.disabled == false", "field.value !== '3'", "send.disabled != true"]) {
      expect(value).not.toMatch(DRAFT_ASSIGNMENT);
    }
  });

  it("reuses the visible projection's one quote and preserves its original launch result", () => {
    const f = fixture(), draft = f.read(), expected = quoteFlight(f.state, draft);
    const quote = vi.spyOn(flight, "quoteFlight");
    const model = f.start();
    expect(quote).toHaveBeenCalledTimes(1);
    expect(model.quote.ok).toBe(expected.ok); expect(expected.ok).toBe(true);
    expect(f.fields.summary!.textContent).toContain("预计回收（当前条件）");
    expect(f.fields.field!.textContent).toBe("当前可见残骸：金属 100000 · 晶体 50000");
    expect(f.fields.capacity!.textContent).toBe("总货舱 25000 · 回收船上限 20000");
    expect(f.fields.room!.textContent).toContain("现有货物占用 600 · 剩余可回收货舱 20000");
    expect(f.fields.leftovers!.textContent).toContain("按当前残骸计算的剩余");
    expect(f.fields.notice!.textContent).toContain("抵达前残骸或科技可能变化");
    expect(f.fields.notice!.textContent).toContain("不再次扣除");
    expect(f.fields.notice!.textContent).toContain("不会派遣、占用或预留残骸");
    expect(f.send.disabled).toBe(false); expect(f.quote.textContent).toBe("原有航程报价");
  });

  it("preserves native details, focused nodes and every full-state field across repeated observations and paints", () => {
    const f = fixture(); f.observe(freeze(f.state)); f.paint();
    const before = JSON.stringify(serializeState(f.state)), draft = JSON.stringify(f.read());
    const nodes = [...f.details.children], inputText = [f.metal.value, f.crystal.value, f.deuterium.value];
    f.details.open = true; f.summary.focus();
    for (let i = 0; i < 12; i++) { f.observe(); f.paint(); }
    expect(f.details.open).toBe(true); expect(document.activeElement).toBe(f.summary);
    expect(f.details.children).toEqual(nodes);
    f.metal.focus(); f.observe(); f.paint(); expect(document.activeElement).toBe(f.metal);
    expect([f.metal.value, f.crystal.value, f.deuterium.value]).toEqual(inputText);
    expect(JSON.stringify(f.read())).toBe(draft);
    expect(JSON.stringify(serializeState(f.state))).toBe(before);
    expect(localStorage.setItem).not.toHaveBeenCalled(); expect(localStorage.removeItem).not.toHaveBeenCalled(); expect(localStorage.clear).not.toHaveBeenCalled();
  });

  it("does not repeat hidden/open attribute or text writes for unchanged hidden, visible or protected observations", () => {
    const f = fixture();
    const nodes = [f.panel, ...Object.values(f.fields)];
    const writes = () => ({ attributes: nodes.reduce((sum, node) => sum + node.attributeWrites, 0), text: nodes.reduce((sum, node) => sum + node.textWrites, 0) });
    f.fleet.hidden = true; f.observe();
    const initialHidden = writes();
    for (let i = 0; i < 10; i++) f.observe();
    expect(writes()).toEqual(initialHidden);
    f.fleet.hidden = false; f.paint();
    expect(writes().attributes).toBeGreaterThan(initialHidden.attributes);
    f.details.open = true;
    const visible = writes();
    for (let i = 0; i < 10; i++) { f.observe(); f.paint(); }
    expect(writes()).toEqual(visible);
    f.observe(f.state, false, "存档暂停");
    expect(writes().attributes).toBeGreaterThan(visible.attributes);
    const protectedWrites = writes();
    for (let i = 0; i < 10; i++) { f.observe(f.state, false, "存档暂停"); f.paint(); }
    expect(writes()).toEqual(protectedWrites);
    f.observe(f.state, true, ""); f.paint();
    expect(writes().attributes).toBeGreaterThan(protectedWrites.attributes);
    expect(f.fields.capacity!.textContent).toContain("25000");
  });

  it("refreshes on real research completion and changed or exhausted debris without closing details", () => {
    const f = fixture(), queued = enqueueResearch(f.state, "hyperspace_tech", "manual");
    expect(queued.ok).toBe(true); f.observe(queued.state); f.paint(); f.details.open = true;
    expect(f.fields.capacity!.textContent).toContain("25000");
    f.observe(tick(f.state, f.state.research.queue[0]!.remainingSeconds)); f.paint();
    expect(f.state.research.levels.hyperspace_tech).toBe(1);
    expect(f.fields.capacity!.textContent).toBe("总货舱 26250 · 回收船上限 21000"); expect(f.details.open).toBe(true);
    f.observe({ ...f.state, deepSpace: { ...f.state.deepSpace, debris: [{ ...f.state.deepSpace.debris[0]!, metal: "31", crystal: "19" }] } }); f.paint();
    expect(f.fields.summary!.textContent).toContain("金属 31 · 晶体 19");
    expect(f.fields.leftovers!.textContent).toContain("金属 0 · 晶体 0");
    f.observe({ ...f.state, deepSpace: { ...f.state.deepSpace, debris: [] } }); f.paint();
    expect(f.fields.summary!.textContent).toContain("没有可见残骸"); expect(f.fields.capacity!.textContent).toBe(""); expect(f.fields.leftovers!.textContent).toBe("");
    expect(f.details.open).toBe(true); expect(f.panel.textContent).not.toContain("26250");
  });

  it.each(["recycler", "cargoShip", "speed", "galaxy", "system", "position", "metal", "crystal", "deuterium"] as const)("retires stale quantities on %s editing without calculating or altering the draft", key => {
    const f = fixture(); f.start(); f.details.open = true;
    const quote = vi.spyOn(flight, "quoteFlight"), calculate = vi.spyOn(recycling, "calculateRecycleAmounts");
    const value = key === "recycler" ? "-1" : key === "metal" ? "invalid" : "7";
    f.edit(f[key], value);
    expect(f.fields.summary!.textContent).toBe("回收预览待更新。");
    expect(f.fields.capacity!.textContent).toBe(""); expect(f.fields.leftovers!.textContent).toBe("");
    expect(f[key].value).toBe(value); expect(f.details.open).toBe(true);
    expect(quote).not.toHaveBeenCalled(); expect(calculate).not.toHaveBeenCalled();
    f.paint();
    if (key === "recycler" || key === "metal") { expect(f.fields.summary!.textContent).toContain("不可用"); expect(f.fields.capacity!.textContent).toBe(""); }
    expect(f[key].value).toBe(value); expect(f.send.disabled).toBe(false);
  });

  it.each(["transport", "deploy", "colonize", "scout", "attack", "charge"] as const)("clears the hidden view for %s and does no recycling arithmetic", mission => {
    const f = fixture(); f.start(); f.details.open = true;
    const calculate = vi.spyOn(recycling, "calculateRecycleAmounts");
    f.edit(f.mission, mission, "change");
    expect(f.panel.hidden).toBe(true); expect(f.fields.summary!.textContent).toBe(""); expect(f.fields.field!.textContent).toBe(""); expect(f.details.open).toBe(false);
    const model = f.paint(); expect(model.recyclePreview).toBeNull(); expect(calculate).not.toHaveBeenCalled();
    f.edit(f.mission, "recycle", "change"); f.paint(); expect(f.panel.hidden).toBe(false); expect(f.details.open).toBe(false);
  });

  it("clears same-ID imports, resets, universe adoption and active-origin changes before the next projection", () => {
    const f = fixture(); f.start(); f.details.open = true;
    const imported = stateFixture(); imported.deepSpace.debris[0]!.metal = "123";
    f.observe(imported);
    expect(f.fields.capacity!.textContent).toBe(""); expect(f.details.open).toBe(false); f.paint(); expect(f.fields.field!.textContent).toContain("金属 123");
    f.controller.invalidate(); expect(f.fields.field!.textContent).toBe(""); expect(f.fields.summary!.textContent).toBe("回收预览待更新。");
    f.observe(stateFixture()); f.paint(); expect(f.fields.field!.textContent).toContain("金属 100000");
    const colony = createPlanet("other-source", { galaxy: 1, system: 56, position: 10 });
    f.observe(selectPlanet({ ...f.state, planets: [...f.state.planets, colony] }, colony.id));
    expect(f.fields.field!.textContent).toBe(""); f.paint(); expect(f.fields.summary!.textContent).toContain("数量不足"); expect(f.fields.capacity!.textContent).toBe("");
    f.observe({ ...f.state, universe: { ...f.state.universe } }); expect(f.fields.summary!.textContent).toBe("回收预览待更新。");
  });

  it("makes protection explicitly unavailable immediately and never treats a model as launch authority", () => {
    const f = fixture(), model = f.start().recyclePreview;
    f.details.open = true;
    f.observe(f.state, false, "另一标签页更新了存档");
    expect(f.fields.summary!.textContent).toContain("存档保护中：回收预览不可用（冻结进度）");
    expect(f.fields.protection!.textContent).toBe("另一标签页更新了存档"); expect(f.fields.capacity!.textContent).toBe("");
    f.controller.update(model); expect(f.fields.capacity!.textContent).toBe(""); expect(f.details.hidden).toBe(true);
    f.observe(f.state, true, "旧保护文字并不代表当前状态");
    expect(f.fields.summary!.textContent).toBe("回收预览待更新。"); f.paint();
    expect(f.fields.protection!.hidden).toBe(true); expect(f.fields.protection!.textContent).toBe(""); expect(f.fields.capacity!.textContent).toContain("25000");
    expect(f.send.disabled).toBe(false); expect(f.quote.textContent).toBe("原有航程报价");
  });

  it("clears hidden fleet/document or detached-root text without a quote and only displays fresh values on return", () => {
    const f = fixture(), old = f.start().recyclePreview;
    const quote = vi.spyOn(flight, "quoteFlight");
    f.fleet.hidden = true; f.observe(); f.controller.update(old);
    expect(f.panel.hidden).toBe(true); expect(f.fields.field!.textContent).toBe("");
    f.fleet.hidden = false; f.controller.syncVisibility(); expect(f.panel.hidden).toBe(true);
    expect(quote).not.toHaveBeenCalled(); f.paint();
    (document as unknown as NodeDouble).hidden = true; (document as unknown as NodeDouble).emit("visibilitychange");
    expect(f.fields.summary!.textContent).toBe(""); expect(f.fields.leftovers!.textContent).toBe("");
    (document as unknown as NodeDouble).hidden = false; f.root.connectedRoot = false; f.controller.update(old); expect(f.panel.hidden).toBe(true);
    f.root.connectedRoot = true; f.observe({ ...f.state, deepSpace: { ...f.state.deepSpace, debris: [] } }); f.paint(); expect(f.fields.summary!.textContent).toContain("没有可见残骸");
  });

  it("uses textContent for arbitrarily long source strings and markup-looking text", () => {
    const f = fixture(); f.observe();
    const hostile = '<img src=x onerror="boom()"> & "长文本"'.repeat(100);
    const model = recyclePreview(f.state, f.read())!;
    const modified: RecyclePreview = freeze({ ...model, summary: hostile, target: hostile, notice: hostile, visibleDebris: { metal: hostile, crystal: hostile },
      amounts: { ...model.amounts!, capacity: hostile, collector: hostile, used: hostile, room: hostile, leftMetal: hostile, leftCrystal: hostile } });
    const before = JSON.stringify(modified); f.controller.update(modified);
    expect(f.fields.summary!.textContent).toBe(hostile); expect(f.fields.target!.textContent).toBe(`目标 [${hostile}]`);
    for (const key of ["summary", "target", "field", "capacity", "room", "leftovers", "notice"]) expect(f.fields[key]!.children).toEqual([]);
    expect(JSON.stringify(modified)).toBe(before);
    f.observe(f.state, false, hostile); expect(f.fields.protection!.textContent).toBe(hostile); expect(f.fields.protection!.children).toEqual([]);
  });
});
