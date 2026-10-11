import { afterEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet, selectPlanet } from "../src/game/empire";
import { emptyCargo, type FleetRequest } from "../src/game/fleet";
import { evaluatePrestige } from "../src/game/logic";
import type { NpcBattleReceipt } from "../src/game/npc-attack-state";
import { createPlanet } from "../src/game/planet";
import { createInitialState } from "../src/game/state";
import { npcBattleDetails } from "../src/ui/npc-battle-present";
import { installPrestigePreview } from "../src/ui/prestige-preview";
import { prestigeConfirmation, prestigePreview } from "../src/ui/prestige-preview-model";
import { updateNpcRemainderDetail } from "../src/ui/space-panel";
import { npcRemainderView, spaceFleetView } from "../src/ui/space-present";

const tails = (metal = "0", crystal = "0", deuterium = "0") => ({ metal, crystal, deuterium });
const longest = `0.${"0".repeat(255)}1`;
const request = (): FleetRequest => ({ mission: "transport", target: { galaxy: 1, system: 50, position: 9 }, ships: {}, cargo: emptyCargo(), speedPercent: 100 });
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

/** Text-only DOM double: HTML interpolation fails, native browser QA owns layout. */
class TextNode {
  id = ""; className = ""; dataset: Record<string, string> = {}; hidden = false; open = false;
  parentElement: TextNode | null = null; children: TextNode[] = []; private ownText = "";
  constructor(public tagName = "div") {}
  get textContent(): string { return this.ownText + this.children.map(node => node.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; for (const child of this.children) child.parentElement = null; this.children = []; }
  set innerHTML(_value: string) { throw Error("HTML interpolation forbidden in exact-right details"); }
  get firstElementChild(): TextNode | null { return this.children[0] ?? null; }
  get lastElementChild(): TextNode | null { return this.children.at(-1) ?? null; }
  get nextElementSibling(): TextNode | null { const siblings = this.parentElement?.children; return siblings?.[siblings.indexOf(this) + 1] ?? null; }
  append(...nodes: TextNode[]): void { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: TextNode, before: TextNode | null): void {
    node.remove(); node.parentElement = this;
    if (before) this.children.splice(this.children.indexOf(before), 0, node); else this.children.push(node);
  }
  insertAdjacentElement(where: string, node: TextNode): void {
    expect(where).toBe("afterend"); this.parentElement!.insertBefore(node, this.nextElementSibling);
  }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(_name: string, _value: string): void {}
  matches(selector: string): boolean {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(" ").includes(selector.slice(1));
    return selector === '[data-tab-panel="curvature"]' && this.dataset.tabPanel === "curvature";
  }
  querySelector<T extends TextNode = TextNode>(selector: string): T | null {
    for (const child of this.children) { if (child.matches(selector)) return child as T; const match = child.querySelector<T>(selector); if (match) return match; }
    return null;
  }
}
const asElement = (node: TextNode) => node as unknown as HTMLElement;
function documentDouble() { vi.stubGlobal("document", { hidden: false, createElement: (tag: string) => new TextNode(tag) }); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("exact NPC remainder rights presentation", () => {
  it("hides zero rights and retains every digit of all three nonzero tails without summation", () => {
    expect(npcRemainderView(tails())).toBeNull();
    const source = tails(longest, "0.999999999999999999999999999999999999999", "0.0000000003");
    freeze(source);
    const model = npcRemainderView(source)!;
    expect(longest).toHaveLength(258);
    expect(model.amounts).toEqual(source); expect(model.amounts).not.toBe(source);
    expect(model.resourceCount).toBe(3); expect(model.exactText).toContain(longest);
    expect(model.notice).toContain("不计入普通可花库存");
    expect(model.notice).toContain("正额 NPC 战利品");
    expect(model.notice).toContain("不保证下次全部结清");
  });

  it("keeps ordinary planet stock and ownership unchanged when rights exist or selection changes", () => {
    const state = createInitialState(42), home = activePlanet(state), colony = createPlanet("remainder-colony");
    home.resources = { metal: big("0.75"), crystal: big(100), deuterium: big("0.75") };
    state.planets.push(colony);
    const ordinary = spaceFleetView(state, request()).planets.map(row => row.stock);
    home.npcResourceRemainder = tails("0.25", "0", "0.25");
    colony.npcResourceRemainder = tails(longest);
    const snapshot = JSON.stringify(state); freeze(state);
    const model = spaceFleetView(state, request());
    expect(model.planets.map(row => row.stock)).toEqual(ordinary);
    expect(model.planets[0]!.npcRemainder!.amounts).toEqual(tails("0.25", "0", "0.25"));
    expect(model.planets[1]!.npcRemainder!.exactText).toContain(longest);
    const switched = spaceFleetView(selectPlanet(state, colony.id), request());
    expect(switched.planets.map(row => row.npcRemainder)).toEqual(model.planets.map(row => row.npcRemainder));
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("appends a single text-only detail after original controls and preserves its identity/open state", () => {
    documentDouble();
    const row = new TextNode(), title = new TextNode("strong"), stock = new TextNode("span"), actions = new TextNode();
    row.append(title, stock, actions);
    updateNpcRemainderDetail(asElement(row), npcRemainderView(tails()));
    expect(row.children).toEqual([title, stock, actions]);
    updateNpcRemainderDetail(asElement(row), npcRemainderView(tails(longest)));
    const detail = row.querySelector(".npc-resource-remainder")!;
    expect(row.children).toEqual([title, stock, actions, detail]);
    expect(detail.children[0]!.textContent).toBe("不足 1 的待结算权益");
    const summary = detail.children[0], exact = detail.querySelector(".npc-remainder-exact");
    detail.open = true;
    updateNpcRemainderDetail(asElement(row), npcRemainderView(tails("0.25", longest)));
    expect(row.querySelector(".npc-resource-remainder")).toBe(detail);
    expect(detail.open).toBe(true); expect(detail.children[0]).toBe(summary);
    expect(detail.querySelector(".npc-remainder-exact")).toBe(exact);
    expect(exact!.textContent).toBe(`金属 0.25 · 晶体 ${longest} · 重氢 0`);
    // Invalid runtime text must never become executable markup even before protection renders.
    updateNpcRemainderDetail(asElement(row), npcRemainderView(tails('<img src=x onerror="boom">')));
    expect(exact!.textContent).toContain('<img src=x onerror="boom">'); expect(exact!.children).toEqual([]);
    updateNpcRemainderDetail(asElement(row), null);
    expect(row.children).toEqual([title, stock, actions]);
  });

  it("keeps battle loot the original full integers and describes rights without granting again", () => {
    const report: NpcBattleReceipt = {
      fleetId: 1, seed: 42, originId: "homeworld", target: { galaxy: 1, system: 50, position: 9 }, at: "20",
      loot: [265, 101, 37], attackerTech: { weapons: 1, shields: 0, armour: 0 }, cargoFactor: 1,
      stockBefore: [530, 202, 74], delivery: "delivered",
      battle: { mode: "squadron-v1", winner: "attacker", rounds: [], attackerBefore: { small_cargo: 1 }, attackerAfter: { small_cargo: 1 }, defenderBefore: {}, defenderAfter: {} },
    };
    const details = npcBattleDetails(report);
    expect(details.loot).toContain("实际装载：金属 265 · 晶体 101 · 重氢 37");
    expect(details.loot).toContain("不计入普通可花库存");
    expect(details.loot).toContain("完整整数战利品");
    expect(details.loot).toContain("历史战报不可再次领取");
    expect(details.loot).not.toContain("一次入库");
  });
});

describe("curvature pending-right loss disclosure", () => {
  it("counts all bounded planets/resources and preserves each exact tail beyond the 20-row sample", () => {
    const state = createInitialState(42); state.lifetime.metal = big(1e8);
    state.planets = Array.from({ length: 100 }, (_, i) => {
      const planet = createPlanet(i ? `tail-${i}` : "homeworld");
      planet.name = `权益星球 ${i}`; planet.npcResourceRemainder = tails(longest, "0.99999999999999999999999999999", "0.25"); return planet;
    });
    const evaluation = evaluatePrestige(state), snapshot = JSON.stringify(state); freeze(state); freeze(evaluation);
    const model = prestigePreview(state, evaluation);
    expect(model.npcRemainders.planets).toBe(100); expect(model.npcRemainders.resources).toBe(300);
    expect(model.rows).toHaveLength(20); expect(model.npcRemainders.rows).toHaveLength(100);
    expect(model.npcRemainders.rows[99]!.amounts).toEqual(state.planets[99]!.npcResourceRemainder);
    expect(model.worlds.resources).toEqual(tails());
    const confirmation = prestigeConfirmation(state, evaluation);
    expect(confirmation).toContain("100 颗星球、300 项资源"); expect(confirmation).toContain(longest);
    expect(confirmation).toContain("权益星球 99 [tail-99]"); expect(confirmation).toContain("不转移或退款");
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(evaluation.next.planets[0]!.npcResourceRemainder).toEqual(tails());
  });

  it("does not label rights as losses before the launch threshold", () => {
    const state = createInitialState(1); state.planets[0]!.npcResourceRemainder = tails(longest);
    const evaluation = evaluatePrestige(state), model = prestigePreview(state, evaluation);
    expect(model.eligible).toBe(false); expect(model.npcRemainders).toEqual({ planets: 0, resources: 0, rows: [] });
    expect(prestigeConfirmation(state, evaluation)).toContain("当前无法发射");
    expect(prestigeConfirmation(state, evaluation)).not.toContain("丢弃");
    expect(state.planets[0]!.npcResourceRemainder.metal).toBe(longest);
  });

  it("adds no zero-right DOM and patches safe exact rows without replacing old curvature nodes", () => {
    documentDouble(); let now = 0; vi.stubGlobal("performance", { now: () => now });
    const root = new TextNode(), tab = new TextNode(); tab.dataset.tabPanel = "curvature";
    const anchor = new TextNode(); anchor.className = "prestige-panel"; tab.append(anchor); root.append(tab);
    const preview = installPrestigePreview(asElement(root));
    const state = createInitialState(42); state.lifetime.metal = big(1e8);
    preview.update(state, true);
    expect(root.querySelector("#prestige-preview-npc-remainders")).toBeNull();
    const original = root.querySelector("#prestige-preview-details")!, children = [...original.children]; original.open = true;
    state.planets[0]!.name = '<img src=x onerror="boom">'; state.planets[0]!.npcResourceRemainder = tails(longest);
    now = 1001; preview.update(state, true);
    const detail = root.querySelector("#prestige-preview-npc-remainders")!, list = root.querySelector("#prestige-preview-npc-remainder-rows")!;
    expect(original.children.slice(0, children.length)).toEqual(children); expect(original.children.at(-1)).toBe(detail);
    expect(list.children).toHaveLength(1); expect(list.children[0]!.textContent).toContain(longest);
    expect(list.children[0]!.textContent).toContain('<img src=x onerror="boom">'); expect(list.children[0]!.children).toEqual([]);
    expect(root.querySelector("#prestige-preview-losses")!.textContent).toContain("1 颗星球、1 项资源");
    const row = list.children[0]; detail.open = true;
    state.planets[0]!.npcResourceRemainder = tails("0.25", longest); now = 2002; preview.update(state, true);
    expect(root.querySelector("#prestige-preview-npc-remainders")).toBe(detail); expect(detail.open).toBe(true); expect(original.open).toBe(true);
    expect(list.children[0]).toBe(row); expect(detail.children[0]!.textContent).toContain("2 项资源");
    state.planets[0]!.npcResourceRemainder = tails(); now = 3003; preview.update(state, true);
    expect(root.querySelector("#prestige-preview-npc-remainders")).toBeNull(); expect(original.children).toEqual(children);
  });
});
