import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NpcBattleReceipt } from "../src/game/npc-attack-state";
import { createInitialState } from "../src/game/state";
import { installNpcBattlePanel } from "../src/ui/npc-battle-panel";
import * as presentation from "../src/ui/npc-battle-present";

/** Controller/text double only; native browser checks own layout, focus and hit areas. */
class PanelNode {
  id = ""; className = ""; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  hidden = false; open = false; connectedRoot = false; tabIndex = -1; textWrites = 0; focusCalls = 0; scrollCalls = 0;
  parentElement: PanelNode | null = null; children: PanelNode[] = [];
  listeners = new Map<string, Array<() => void>>();
  private ownText = "";
  constructor(public tagName = "div") {}
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.textWrites++; this.ownText = value; this.replaceChildren(); }
  set innerHTML(value: string) {
    // The existing constant table header is the only HTML path; report text must stay text-only.
    expect(this.tagName).toBe("table");
    expect(value).toBe("<thead><tr><th>回合</th><th>我方剩余</th><th>NPC 剩余</th><th>我方输出</th><th>NPC 输出</th></tr></thead>");
  }
  get isConnected(): boolean { return this.connectedRoot || !!this.parentElement?.isConnected; }
  get firstElementChild(): PanelNode | null { return this.children[0] ?? null; }
  get nextElementSibling(): PanelNode | null { const siblings = this.parentElement?.children; return siblings?.[siblings.indexOf(this) + 1] ?? null; }
  contains(node: PanelNode): boolean { return this === node || this.children.some(child => child.contains(node)); }
  append(...nodes: PanelNode[]): void { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: PanelNode, before: PanelNode | null): void {
    node.remove(); node.parentElement = this;
    if (before) this.children.splice(this.children.indexOf(before), 0, node); else this.children.push(node);
  }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  replaceChildren(...nodes: PanelNode[]): void { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
  focus(): void { if (this.isConnected) { this.focusCalls++; (document as unknown as { activeElement: PanelNode }).activeElement = this; } }
  scrollIntoView(options: ScrollIntoViewOptions): void { expect(options).toEqual({ block: "nearest" }); this.scrollCalls++; }
  matches(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    const match = /^\[data-npc-(report|rounds)="(\d+)"\]$/.exec(selector);
    if (match) return this.dataset[match[1] === "report" ? "npcReport" : "npcRounds"] === match[2];
    return this.tagName === selector;
  }
  querySelector(selector: string): PanelNode | null {
    for (const child of this.children) { if (child.matches(selector)) return child; const found = child.querySelector(selector); if (found) return found; }
    return null;
  }
}

function receipt(id = 1, zeroRounds = false): NpcBattleReceipt {
  return {
    fleetId: id, originId: "homeworld", target: { galaxy: 1, system: 56, position: 6 }, at: "25892.3997786282",
    seed: 42, cargoFactor: 1.4, attackerTech: { weapons: 1, shields: 5, armour: 0 },
    stockBefore: [530, 264, 46], loot: [265, 132, 23], delivery: "delivered",
    battle: {
      mode: "squadron-v1", winner: "attacker", attackerBefore: { light_fighter: 6 }, attackerAfter: { light_fighter: 6 },
      defenderBefore: zeroRounds ? {} : { light_fighter: 2 }, defenderAfter: {},
      rounds: zeroRounds ? [] : [{ round: 1, attacker: 6, defender: 0, attackDamage: 304.7282301764935, defendDamage: 100.55614576209338 }],
    },
  };
}

function models(...reports: NpcBattleReceipt[]) {
  const state = createInitialState(42, 42);
  state.npcBattles = { ...state.npcBattles, reports };
  const before = JSON.stringify(state), view = presentation.npcBattleReportsView(state);
  expect(JSON.stringify(state)).toBe(before);
  return view;
}

function fixture() {
  const doc = new PanelNode(); doc.connectedRoot = true;
  const root = new PanelNode(), panel = new PanelNode(), list = new PanelNode();
  panel.id = "space-messages"; list.id = "npc-battle-reports"; doc.append(root); root.append(panel); panel.append(list);
  const controls = installNpcBattlePanel(root as unknown as HTMLElement);
  const row = (id = 1) => list.querySelector(`[data-npc-report="${id}"]`)!;
  const rounds = (id = 1) => row(id).querySelector(`[data-npc-rounds="${id}"]`)!;
  return { doc, root, panel, list, controls, row, rounds };
}

beforeEach(() => { vi.stubGlobal("document", { hidden: false, activeElement: null, createElement: (tag: string) => new PanelNode(tag) }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("compact NPC battle report panel", () => {
  it("starts folded with separate summary fields and never interpolates report text as HTML", () => {
    const f = fixture(), view = models(receipt());
    const unsafeRoute = '<img src=x onerror="boom"> 母星 [1:56:11] → [1:56:6]';
    view[0] = { ...view[0], route: unsafeRoute };
    const before = JSON.stringify(view), detailSpy = vi.spyOn(presentation, "npcBattleDetails"), roundSpy = vi.spyOn(presentation, "npcBattleRounds");
    f.controls.update(view);
    const row = f.row(), summary = row.children[0]!;
    expect(summary.tagName).toBe("summary"); expect(row.open).toBe(false); expect(f.rounds().open).toBe(false);
    for (const [hook, key] of [["result", "outcome"], ["delivery", "delivery"], ["route", "route"], ["losses", "lossText"], ["loot", "lootText"], ["time", "timeText"]] as const) {
      expect(summary.querySelector(`.npc-report-${hook}`)!.textContent).toBe(view[0][key]);
    }
    expect(summary.querySelector(".npc-report-route")!.children).toEqual([]);
    expect(summary.textContent).toContain("1 回合"); expect(summary.textContent).toContain("#1"); expect(summary.textContent).toContain("查看详情");
    expect(row.querySelector(".npc-report-blocked")!.hidden).toBe(true);
    expect(row.querySelector(".npc-report-blocked")!.textContent).toBe("");
    expect(row.querySelector("button")).toBeNull(); expect(row.querySelector("input")).toBeNull();
    expect(detailSpy).not.toHaveBeenCalled(); expect(roundSpy).not.toHaveBeenCalled(); expect(JSON.stringify(view)).toBe(before);
  });

  it("lazily retains full precision in the existing nested scroll region", () => {
    const f = fixture(), view = models(receipt()); f.controls.update(view);
    const detailSpy = vi.spyOn(presentation, "npcBattleDetails"), roundSpy = vi.spyOn(presentation, "npcBattleRounds");
    const row = f.row(), rounds = f.rounds(), body = row.querySelector(".npc-report-details")!, scroll = rounds.children[1]!;
    row.open = true; row.emit("toggle");
    expect(detailSpy).toHaveBeenCalledTimes(1); expect(roundSpy).not.toHaveBeenCalled();
    expect(body.textContent).toContain("25892.3997786282 秒"); expect(body.textContent).toContain("历史战报不可再次领取");
    expect(scroll.children).toEqual([]); expect(scroll.tabIndex).toBe(0);
    expect(scroll.attributes).toEqual({ role: "region", "aria-label": "战斗回合数据，可横向滚动" });
    rounds.open = true; rounds.emit("toggle");
    expect(roundSpy).toHaveBeenCalledTimes(1); expect(scroll.querySelector("table")!.className).toBe("ov-table npc-round-table");
    expect(scroll.textContent).toContain("304.7282301764935"); expect(scroll.textContent).toContain("100.55614576209338");
    row.open = false; row.emit("toggle"); row.open = true; row.emit("toggle"); rounds.emit("toggle"); f.controls.update(view);
    expect(detailSpy).toHaveBeenCalledTimes(1); expect(roundSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps zero-round collection explicit without manufacturing a combat table", () => {
    const f = fixture(); f.controls.update(models(receipt(1, true)));
    expect(f.row().querySelector(".npc-report-result")!.textContent).toBe("无驻军收集");
    expect(f.row().querySelector(".npc-report-round-count")!.textContent).toBe("0 回合");
    f.row().open = true; f.rounds().open = true; f.row().emit("toggle");
    expect(f.rounds().children[1]!.textContent).toBe("无驻军收集，本次没有战斗回合。");
    expect(f.rounds().querySelector("table")).toBeNull();
  });

  it("preserves keyed nodes, focus, both open states and unchanged text during live updates", () => {
    const f = fixture(), view = models(receipt()); f.controls.update(view); f.controls.focus(1);
    const row = f.row(), summary = row.children[0]!, rounds = f.rounds(), content = summary.children[0]!;
    rounds.open = true; rounds.emit("toggle");
    const route = row.querySelector(".npc-report-route")!, delivery = row.querySelector(".npc-report-delivery")!, result = row.querySelector(".npc-report-result")!;
    const detail = row.querySelector(".npc-report-details")!.children[0], table = rounds.querySelector("table"), originalWrites = [route.textWrites, delivery.textWrites, result.textWrites];
    for (let i = 0; i < 4; i++) f.controls.update(view);
    expect([route.textWrites, delivery.textWrites, result.textWrites]).toEqual(originalWrites);
    const changed = { ...view[0], route: "新名称 [1:56:11] → [1:56:6]", delivery: "入港受阻" };
    f.controls.update([models(receipt(2))[0], changed]);
    expect(f.list.children).toEqual([f.row(2), row]); expect(f.row()).toBe(row); expect(row.children[0]).toBe(summary);
    expect(summary.children[0]).toBe(content); expect(row.open).toBe(true); expect(rounds.open).toBe(true); expect(document.activeElement).toBe(summary);
    expect(row.querySelector(".npc-report-route")).toBe(route); expect(row.querySelector(".npc-report-delivery")).toBe(delivery);
    expect(route.textWrites).toBe(originalWrites[0] + 1); expect(delivery.textWrites).toBe(originalWrites[1] + 1); expect(result.textWrites).toBe(originalWrites[2]);
    expect(row.querySelector(".npc-report-details")!.children[0]).toBe(detail); expect(rounds.querySelector("table")).toBe(table);
    expect(row.dataset.delivery).toBe("入港受阻"); expect(row.querySelector(".npc-report-blocked")!.hidden).toBe(false);
    expect(row.querySelector(".npc-report-blocked")!.textContent).toContain("幸存舰船与货物仍在舰队");
    expect(row.querySelector(".npc-report-blocked")!.textContent).toContain("舰队页重试入港");
    f.controls.update(view); expect(row.querySelector(".npc-report-blocked")!.hidden).toBe(true); expect(row.querySelector(".npc-report-blocked")!.textContent).toBe("");
    expect(row.open).toBe(true); expect(rounds.open).toBe(true); expect(document.activeElement).toBe(summary);
  });

  it("applies only the latest pending navigation after the hidden panel becomes visible", () => {
    const f = fixture(), view = models(receipt(1), receipt(2));
    f.panel.hidden = true; f.controls.focus(1); f.controls.focus(2); f.controls.update(view);
    expect(f.list.children).toEqual([]); expect(document.activeElement).toBeNull();
    f.panel.hidden = false; f.controls.update(view);
    expect(f.row(1).open).toBe(false); expect(f.row(2).open).toBe(true); expect(f.rounds(2).open).toBe(false);
    expect(document.activeElement).toBe(f.row(2).children[0]); expect(f.row(2).scrollCalls).toBe(1);
    f.controls.update(view); expect(f.row(2).scrollCalls).toBe(1);
  });

  it.each(["panel", "document", "root", "list", "detached-panel"])("does not render, focus or populate while %s is hidden or detached", mode => {
    const f = fixture(), view = models(receipt()); f.controls.update(view);
    const row = f.row(), rounds = f.rounds(), summary = row.children[0]!;
    const detailSpy = vi.spyOn(presentation, "npcBattleDetails"), roundSpy = vi.spyOn(presentation, "npcBattleRounds");
    if (mode === "panel") f.panel.hidden = true;
    else if (mode === "document") (document as unknown as { hidden: boolean }).hidden = true;
    else if (mode === "root") f.root.remove();
    else if (mode === "list") f.list.remove();
    else f.panel.remove();
    row.open = true; rounds.open = true; row.emit("toggle"); rounds.emit("toggle"); f.controls.focus(1);
    f.controls.update([{ ...view[0], route: "不得更新" }]);
    expect(detailSpy).not.toHaveBeenCalled(); expect(roundSpy).not.toHaveBeenCalled(); expect(summary.focusCalls).toBe(0);
    expect(row.querySelector(".npc-report-route")!.textContent).toBe(view[0].route);
  });

  it("retires old toggle handlers and pending navigation across invalidation, including reused report IDs", () => {
    const f = fixture(), view = models(receipt()); f.controls.update(view);
    const old = f.row(), oldRounds = f.rounds(); f.panel.hidden = true; f.controls.focus(1); f.controls.invalidate();
    expect(f.list.children).toEqual([]);
    f.panel.hidden = false; f.controls.update(view);
    const fresh = f.row(); expect(fresh).not.toBe(old); expect(fresh.open).toBe(false); expect(document.activeElement).toBeNull();
    const detailSpy = vi.spyOn(presentation, "npcBattleDetails"), roundSpy = vi.spyOn(presentation, "npcBattleRounds");
    old.open = true; oldRounds.open = true;
    // Even a retained old node reinserted beside the new one cannot regain ownership.
    f.list.append(old); old.emit("toggle"); oldRounds.emit("toggle");
    expect(detailSpy).not.toHaveBeenCalled(); expect(roundSpy).not.toHaveBeenCalled(); expect(old.querySelector(".npc-report-details")!.children).toEqual([]);
    fresh.open = true; fresh.emit("toggle"); expect(detailSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts an empty report list and prunes removed rows without keeping usable handlers", () => {
    const f = fixture(); f.controls.update([]); expect(f.list.children).toEqual([]);
    f.controls.update(models(receipt())); const old = f.row(), rounds = f.rounds();
    f.controls.update([]); expect(f.list.children).toEqual([]);
    const detailSpy = vi.spyOn(presentation, "npcBattleDetails"), roundSpy = vi.spyOn(presentation, "npcBattleRounds");
    old.open = true; rounds.open = true; old.emit("toggle"); rounds.emit("toggle"); f.controls.update([]);
    expect(detailSpy).not.toHaveBeenCalled(); expect(roundSpy).not.toHaveBeenCalled();
  });
});
