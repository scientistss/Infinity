import { UNIT_IDS, SHIP_IDS, type UnitId } from "../data/units";
import { activePlanet } from "../game/empire";
import type { GameState } from "../game/types";
import { formatManualUnitCost, quoteManualUnits, type ManualUnitMode, type ManualUnitQuote } from "./manual-unit-quote";
import type { ShipyardView } from "./shipyard-present";

/** An opaque, short-lived callback reference; never serialized or taken from DOM data. */
declare const manualAuthorityBrand: unique symbol;
export type ManualUnitAuthority = { readonly [manualAuthorityBrand]: true };
export type ManualUnitUiAction = { readonly type: "manual-unit-pay"; readonly authority: ManualUnitAuthority };

type ModeButton = { mode: ManualUnitMode; node: HTMLButtonElement; bind: string };
type Card = {
  id: UnitId; tab: "shipyard" | "defense"; panel: HTMLElement; node: HTMLElement; input: HTMLInputElement;
  pay: HTMLButtonElement; summary: HTMLElement; total: HTMLElement; hint: HTMLElement; reason: HTMLElement;
  buttons: ModeButton[]; mounted: Array<{ node: HTMLElement; bind: string }>;
  mode: ManualUnitMode; raw: string; quote: ManualUnitQuote | null; summaryText: string; totalText: string;
  phase: "draft" | "retired" | "consumed"; notice: string; removed: boolean;
};
const renew = "请修改数量或重新选择模式后核对报价。";
const consumed = `本次报价已使用；${renew}`;
const worldKey = (state: GameState) => `${state.universe.seed}:${state.universe.layout}:${state.stats.launches}`;
const samePrice = (a: ManualUnitQuote, b: ManualUnitQuote) =>
  a.planetId === b.planetId && a.unit === b.unit && a.mode === b.mode && a.raw === b.raw && a.count === b.count
  && a.cost.metal === b.cost.metal && a.cost.crystal === b.cost.crystal && a.cost.deuterium === b.cost.deuterium;
const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

/** Keeps one selected quote per visible card; economics remain in quote/orderUnits. */
export function installManualUnitControls(root: HTMLElement, onAction: (action: ManualUnitUiAction) => void) {
  function get<T extends HTMLElement = HTMLElement>(bind: string): T {
    const node = root.querySelector<T>(`[data-bind="${bind}"]`);
    if (!node) throw Error(`缺少手动造船控件 ${bind}`);
    return node;
  }
  const panels = ["shipyard", "defense"].map(tab => {
    const panel = root.querySelector<HTMLElement>(`[data-tab-panel="${tab}"]`);
    if (!panel) throw Error(`缺少手动造船页面 ${tab}`);
    return panel;
  });
  const cards: Card[] = UNIT_IDS.map(id => {
    const buttons: ModeButton[] = ([ ["count", "ubuild"], ["fill", "ufill"], ["max", "umax"] ] as const)
      .map(([mode, prefix]) => ({ mode, bind: `${prefix}-${id}`, node: get<HTMLButtonElement>(`${prefix}-${id}`) }));
    const binds = ["ucard", "uqty", "upay", "uquote", "utotal", "umode-hint", "umanual-reason"].map(prefix => `${prefix}-${id}`);
    const mounted = [...binds.map(bind => ({ node: get(bind), bind })), ...buttons.map(button => ({ node: button.node, bind: button.bind }))];
    return { id, tab: (SHIP_IDS as readonly UnitId[]).includes(id) ? "shipyard" : "defense", panel: panels[(SHIP_IDS as readonly UnitId[]).includes(id) ? 0 : 1]!, node: get(`ucard-${id}`), input: get<HTMLInputElement>(`uqty-${id}`),
      pay: get<HTMLButtonElement>(`upay-${id}`), summary: get(`uquote-${id}`), total: get(`utotal-${id}`), hint: get(`umode-hint-${id}`), reason: get(`umanual-reason-${id}`),
      buttons, mounted, mode: "count", raw: get<HTMLInputElement>(`uqty-${id}`).value, quote: null, summaryText: "", totalText: "", phase: "draft", notice: "", removed: false };
  });
  let state: GameState | null = null, ready = false, observed = false, planetId = "", world = "", protection = "";
  let pending: { action: ManualUnitUiAction; card: Card; quote: ManualUnitQuote; world: string } | null = null;

  const quoteNodes = (card: Card) => [card.summary, card.total, card.pay];
  function hiddenStyle(style: CSSStyleDeclaration): boolean {
    return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
      || style.opacity === "0" || style.contentVisibility === "hidden";
  }
  function visible(card: Card): boolean {
    if (document.hidden || !root.isConnected || !card.panel.contains(card.node)) return false;
    for (const field of quoteNodes(card)) for (let node: HTMLElement | null = field; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || hiddenStyle(node.style)) return false;
    }
    return true;
  }
  // Layout/style reads are action-time checks, never a 24-card per-frame scan.
  function rendered(card: Card): boolean {
    if (!visible(card) || card.summary.childElementCount !== 0 || card.total.childElementCount !== 0) return false;
    const checked = new Set<HTMLElement>();
    for (const field of quoteNodes(card)) {
      if (![...field.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
      for (let node: HTMLElement | null = field; node; node = node.parentElement) if (!checked.has(node)) {
        checked.add(node);
        if (hiddenStyle(getComputedStyle(node))) return false;
      }
    }
    return true;
  }
  // Ignore harmless caret/color changes (including browser screenshot setup).
  // Only declarations that can conceal a quote retire it, including round trips.
  function visibilityStyle(raw: string | null): string {
    return (raw ?? "").split(";").map(part => part.trim().toLowerCase())
      .filter(part => /^(display|visibility|opacity|content-visibility|clip-path|transform)\s*:/.test(part)).sort().join(";");
  }
  const visibilityNodes = new Map<HTMLElement, Set<Card>>();
  for (const card of cards) for (const field of quoteNodes(card)) for (let node: HTMLElement | null = field; node; node = node.parentElement) {
    const affected = visibilityNodes.get(node) ?? new Set<Card>(); affected.add(card); visibilityNodes.set(node, affected);
  }
  function sync(card: Card) {
    card.input.disabled = card.mode === "max";
    for (const button of card.buttons) button.node.setAttribute("aria-pressed", String(button.mode === card.mode));
    text(card.hint, card.mode === "max" ? "按当前资源计算，不使用输入数量。" : card.mode === "fill" ? "补到输入总量，本星已有及已付排队计入。" : "建造输入的数量；选择模式只更新报价。");
    card.pay.disabled = card.removed || !ready || !state || card.phase !== "draft" || !card.quote?.ok || !visible(card);
    text(card.reason, card.removed ? "控件已更换，请重新载入页面。" : !ready ? protection || "存档受保护，暂不能支付。" : card.notice || (card.quote?.ok ? "" : card.quote?.reason ?? ""));
  }
  function retire(card: Card, message: string) {
    if (pending?.card === card) pending = null;
    if (card.phase !== "consumed") { card.phase = "retired"; card.notice = message; }
    card.quote = null;
    sync(card);
  }
  function retireAll(message: string) { pending = null; for (const card of cards) retire(card, message); }
  function inspectMutations(records: MutationRecord[]) {
    for (const record of records) {
      if (record.type === "attributes") {
        const node = record.target as HTMLElement, attribute = record.attributeName;
        const current = attribute ? node.getAttribute(attribute) : null;
        const changed = attribute === "style" ? visibilityStyle(record.oldValue) !== visibilityStyle(current)
          : attribute === "aria-hidden" ? (record.oldValue === "true") !== (current === "true")
            : record.oldValue !== current;
        // Class changes can apply/remove stylesheet visibility rules. There is
        // no reliable old computed style after a synchronous hide/show, so they
        // conservatively retire just the affected original quote surfaces.
        if (changed) for (const card of visibilityNodes.get(node) ?? []) if (card.quote) retire(card, `报价显示状态已改变；${renew}`);
        continue;
      }
      for (const removed of record.removedNodes) {
        if (!(removed instanceof Element)) continue;
        for (const card of cards) if (!card.removed && card.mounted.some(item => removed === item.node || removed.contains(item.node))) {
          card.removed = true; retire(card, "控件已更换，请重新载入页面。");
        }
      }
    }
  }
  const observer = new MutationObserver(inspectMutations);
  const watched = new Set<Node>();
  // Watch only direct parents of original controls and their ancestors. Text
  // updates remove text nodes, which cannot retire these exact element nodes.
  for (const card of cards) for (const item of card.mounted) for (let parent = item.node.parentNode; parent; parent = parent.parentNode) if (!watched.has(parent)) {
    watched.add(parent); observer.observe(parent, { childList: true });
  }
  for (const node of visibilityNodes.keys()) observer.observe(node, { childList: watched.has(node), attributes: true,
    attributeFilter: ["hidden", "style", "aria-hidden", "class"], attributeOldValue: true });
  function intact(card: Card): boolean {
    inspectMutations(observer.takeRecords());
    if (card.removed) return false;
    const valid = root.isConnected && card.mounted.every(item => item.node.isConnected && root.contains(item.node)
      && root.querySelector(`[data-bind="${item.bind}"]`) === item.node)
      && root.querySelector(`[data-tab-panel="${card.tab}"]`) === card.panel
      && card.pay.dataset.action === "manual-unit-pay" && card.pay.dataset.id === card.id
      && card.buttons.every(button => button.node.dataset.action === "manual-unit-mode" && button.node.dataset.id === card.id && button.node.dataset.mode === button.mode);
    if (!valid) { card.removed = true; retire(card, "控件已更换，请重新载入页面。"); }
    return valid;
  }
  function show(card: Card, quote: ManualUnitQuote, current: GameState) {
    card.quote = quote;
    const planet = activePlanet(current), at = planet.coordinates;
    card.summaryText = `当前星球 ${planet.name} [${at.galaxy}:${at.system}:${at.position}] · 本次新增 ${formatManualUnitCost(String(quote.count))}`;
    card.totalText = `金属 ${formatManualUnitCost(quote.cost.metal)} · 晶体 ${formatManualUnitCost(quote.cost.crystal)} · 重氢 ${formatManualUnitCost(quote.cost.deuterium)}`;
    text(card.summary, card.summaryText); text(card.total, card.totalText);
    sync(card);
  }
  function paint(card: Card) {
    if (!intact(card)) return;
    if (!visible(card)) { if (card.quote) retire(card, `已离开该页面；${renew}`); else sync(card); return; }
    if (card.input.value !== card.raw) {
      card.raw = card.input.value;
      retire(card, `数量已改变；${renew}`);
    }
    if (!state || !ready || card.phase !== "draft") { sync(card); return; }
    const fresh = quoteManualUnits(state, { unit: card.id, mode: card.mode, raw: card.raw });
    const changed = card.quote !== null && !samePrice(card.quote, fresh);
    show(card, fresh, state);
    if (changed) retire(card, `报价已改变，本次未支付。${renew}`);
  }
  function renewCard(card: Card) {
    pending = null;
    if (!intact(card) || !state || !ready || !visible(card)) { sync(card); return; }
    card.phase = "draft"; card.notice = ""; card.quote = null;
    paint(card);
    // A never-shown summary may have zero height until show() writes its text.
    // Establish action-time readiness only after rendering that fresh quote.
    if (card.quote && !rendered(card)) retire(card, `请先显示完整报价；${renew}`);
  }
  function validate(card: Card, shown: ManualUnitQuote, current: GameState): ManualUnitQuote | null {
    if (!intact(card) || !ready || !state || card.phase !== "draft") { sync(card); return null; }
    if (!rendered(card)) { retire(card, `请先显示完整报价；${renew}`); return null; }
    if (card.summary.textContent !== card.summaryText || card.total.textContent !== card.totalText) {
      retire(card, `报价显示内容已改变；${renew}`); return null;
    }
    if (worldKey(current) !== world || activePlanet(current).id !== planetId || shown.planetId !== planetId) {
      retire(card, `当前星球或世界已改变；${renew}`); return null;
    }
    if (card.raw !== card.input.value || card.mode !== shown.mode || card.raw !== shown.raw) {
      card.raw = card.input.value; retire(card, `数量或模式已改变；${renew}`); return null;
    }
    const fresh = quoteManualUnits(current, { unit: card.id, mode: card.mode, raw: card.raw });
    if (!fresh.ok || !samePrice(shown, fresh)) {
      show(card, fresh, current);
      retire(card, `${fresh.ok ? "报价已改变，本次未支付。" : `${fresh.reason}；本次未支付。`}${renew}`);
      return null;
    }
    return fresh;
  }
  for (const card of cards) {
    card.input.addEventListener("input", () => {
      if (card.input.value === card.raw) return;
      card.raw = card.input.value;
      retire(card, `数量已改变；${renew}`);
      renewCard(card);
    });
    for (const button of card.buttons) button.node.addEventListener("click", () => {
      if (!intact(card) || !visible(card)) return;
      card.mode = button.mode; card.raw = card.input.value;
      retire(card, `模式已改变；${renew}`);
      renewCard(card);
    });
    card.pay.addEventListener("click", () => {
      if (!state || card.pay.disabled || !card.quote) { sync(card); return; }
      const shown = card.quote;
      if (!validate(card, shown, state)) return;
      const authority = Object.freeze({}) as ManualUnitAuthority;
      const action: ManualUnitUiAction = Object.freeze({ type: "manual-unit-pay", authority });
      pending = { action, card, quote: shown, world };
      try { onAction(action); } finally { if (pending?.action === action) pending = null; }
    });
    sync(card);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) retireAll(`页面已隐藏；${renew}`); });
  return {
    observe(next: GameState, writable: boolean, message: string) {
      inspectMutations(observer.takeRecords());
      const nextPlanet = activePlanet(next).id, nextWorld = worldKey(next);
      protection = message;
      if (observed && (planetId !== nextPlanet || world !== nextWorld || ready !== writable)) retireAll(`当前星球、世界或保护状态已改变；${renew}`);
      state = next; ready = writable; observed = true; planetId = nextPlanet; world = nextWorld;
      // Observation never quotes any card. Protection is synchronous even if a
      // frame is skipped; ordinary immutable tick roots preserve a live draft.
      for (const card of cards) {
        if (card.quote && !visible(card)) retire(card, `已离开该页面；${renew}`);
        if (!ready || card.phase !== "draft" || card.removed) sync(card);
      }
    },
    update(view: ShipyardView) {
      inspectMutations(observer.takeRecords());
      const presented = new Set([...view.ships, ...view.defenses].map(card => card.id));
      for (const card of cards) {
        if (view.visible && presented.has(card.id) && visible(card)) paint(card);
        else if (card.quote) retire(card, `已离开该页面；${renew}`);
      }
    },
    invalidate(message = `存档或世界已替换；${renew}`) { retireAll(message); },
    consume(action: ManualUnitUiAction, current: GameState): { id: UnitId; count: number } | null {
      const issued = pending;
      if (!issued || issued.action !== action || action.type !== "manual-unit-pay" || issued.world !== world) return null;
      pending = null;
      const fresh = validate(issued.card, issued.quote, current);
      if (!fresh) return null;
      issued.card.phase = "consumed"; issued.card.notice = consumed; issued.card.quote = null; sync(issued.card);
      return { id: issued.card.id, count: fresh.count };
    },
  };
}
