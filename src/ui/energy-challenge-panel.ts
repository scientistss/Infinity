import { energyChallengeStatus, quoteEnergyChallenge, type EnergyChallengeAction } from "../game/energy-challenge";
import type { GameState } from "../game/types";
import { ENERGY_CHALLENGE_RULES, energyChallengeIntentKey, energyChallengeReview, energyChallengeView } from "./energy-challenge-present";
import "./energy-challenge.css";

export type EnergyChallengeUiAction = Readonly<{ type: "energy-challenge"; action: EnergyChallengeAction }>;
type ReviewIntent = { action: EnergyChallengeAction; key: string; universe: GameState["universe"]; generation: number };
type Control = EnergyChallengeAction | "confirm" | "cancel";

/** A review records intent only. Host re-quotes and confirms exact consequences,
 * consumes this capability, then saves the candidate before adopting it. */
export function installEnergyChallengePanel(root: HTMLElement, onAction: (action: EnergyChallengeUiAction) => void) {
  const anchor = root.querySelector<HTMLElement>(".prestige-panel");
  if (!anchor) throw new Error("缺少能源紧缩挂载位置");
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, parent: HTMLElement): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); node.id = `energy-challenge-${id}`; parent.append(node); return node;
  };
  const panel = document.createElement("section"); panel.id = "energy-challenge"; panel.className = "energy-challenge";
  panel.setAttribute("aria-labelledby", "energy-challenge-title"); anchor.insertAdjacentElement("afterend", panel);
  const title = make("h3", "title", panel); title.tabIndex = -1;
  const summary = make("p", "summary", panel), home = make("p", "home", panel);
  const checklist = make("ul", "checklist", panel);
  const checklistRows = Array.from({length:4}, (_, index) => make("li", `check-${index}`, checklist));
  const load = make("p", "load", panel), status = make("p", "status", panel);
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const actions = make("div", "actions", panel); actions.className = "energy-challenge-actions";
  const controls = new Map<Control, HTMLButtonElement>();
  const registered = new WeakMap<HTMLButtonElement, Control>();
  function button(name: Control, label: string, parent: HTMLElement) {
    const node = make("button", name, parent); node.type = "button"; node.textContent = label; node.disabled = true;
    controls.set(name, node); registered.set(node, name); return node;
  }
  button("enter", "核对入场并发射", actions); button("finish", "核对完成并发射", actions); button("abandon", "核对放弃", actions);
  const rules = make("details", "rules", panel), ruleTitle = make("summary", "rules-title", rules); ruleTitle.textContent = "规则与读档说明";
  for (const [index, value] of ENERGY_CHALLENGE_RULES.entries()) make("p", `rule-${index}`, rules).textContent = value;
  const reviewPanel = make("section", "review", panel); reviewPanel.hidden = true;
  const reviewTitle = make("h3", "review-title", reviewPanel), reviewSummary = make("p", "review-summary", reviewPanel);
  const reviewDetails = make("details", "review-details", reviewPanel), detailTitle = make("summary", "review-details-title", reviewDetails);
  detailTitle.textContent = "本次重置、保留与协议卡明细";
  const reviewLines = make("ul", "review-lines", reviewDetails);
  const reviewNotice = make("p", "review-notice", reviewPanel); reviewNotice.textContent = "这一步仅核对。继续后将显示最新结果，仍需最后确认。";
  const reviewActions = make("div", "review-actions", reviewPanel); reviewActions.className = "energy-challenge-actions";
  button("confirm", "继续，核对最新结果", reviewActions); button("cancel", "取消核对", reviewActions);
  const mounted = [panel, title, summary, home, checklist, ...checklistRows, load, status, actions, rules, ruleTitle,
    reviewPanel, reviewTitle, reviewSummary, reviewDetails, detailTitle, reviewLines, reviewNotice, reviewActions];
  let state: GameState | null = null, writable = false, protection = "", generation = 0, mountRetired = false, projecting = false;
  let intent: ReviewIntent | null = null, pending: { emitted: EnergyChallengeUiAction; intent: ReviewIntent } | null = null;
  let lastKey = "", lastUniverse: GameState["universe"] | null = null, lastReady: boolean | null = null, resultNotice = "";
  let gates: ReturnType<typeof energyChallengeStatus> | null = null;
  const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
  function intact() {
    return !mountRetired && root.isConnected && mounted.every(node => node.isConnected && root.contains(node) && root.querySelector(`#${node.id}`) === node)
      && [...controls.values()].every(node => node.isConnected && panel.contains(node) && root.querySelector(`#${node.id}`) === node);
  }
  function visible(checkStyle = false) {
    if (document.hidden) return false;
    for (let node: HTMLElement | null = panel; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || node.style.display === "none" || node.style.visibility === "hidden") return false;
      if (checkStyle) { const style = window.getComputedStyle(node); if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false; }
    }
    return true;
  }
  function allowed(action: EnergyChallengeAction) {
    return !!gates && (action === "enter" ? gates.canEnter : action === "finish" ? gates.canFinish : gates.phase === "active");
  }
  function syncDisabled() {
    const usable = writable && intact() && visible();
    for (const [name, node] of controls) node.disabled = !usable || (name === "confirm" ? !intent || !!pending : name === "cancel" ? !intent : !allowed(name));
    if (!writable) text(status, protection || "存档受保护，当前不可操作。");
    else if (mountRetired) text(status, "操作区域已更换，请重新载入页面。");
  }
  function records(changes: MutationRecord[]) {
    if (projecting || mountRetired || !changes.length) return;
    let hiddenOrChanged = false;
    for (const record of changes) {
      if (record.type === "attributes" && record.target instanceof Element) {
        if (record.attributeName === "open" ? record.oldValue !== null : record.target.getAttribute(record.attributeName!) !== record.oldValue) hiddenOrChanged = true;
      }
      for (const removed of record.removedNodes) if (removed instanceof Element
        && [...mounted, ...controls.values()].some(node => removed === node || removed.contains(node))) mountRetired = true;
    }
    if (mountRetired) { intent = null; pending = null; generation++; observer.disconnect(); syncDisabled(); }
    else if (hiddenOrChanged) retire("查看区域已关闭或改变，请重新核对。");
  }
  const observer = new MutationObserver(records);
  observer.observe(panel, { childList:true, subtree:true, attributes:true, attributeOldValue:true, attributeFilter:["hidden", "style", "class", "aria-hidden", "open"] });
  for (let parent = panel.parentNode; parent; parent = parent.parentNode) observer.observe(parent, {
    childList:true, attributes:true, attributeOldValue:true, attributeFilter:["hidden", "style", "class", "aria-hidden"],
  });
  const drain = () => records(observer.takeRecords());
  function project(run: () => void) {
    drain(); projecting = true;
    try { run(); } finally { observer.takeRecords(); projecting = false; }
  }
  function replaceConfirm() {
    const old = controls.get("confirm")!; registered.delete(old);
    const node = old.cloneNode(true) as HTMLButtonElement; node.disabled = true; old.replaceWith(node);
    controls.set("confirm", node); registered.set(node, "confirm");
  }
  function retire(message = "") {
    const had = !!intent || !!pending; intent = null; pending = null; generation++;
    project(() => { if (had && !mountRetired) replaceConfirm(); reviewPanel.hidden = true; });
    if (message && had) { resultNotice = message; text(status, message); }
    syncDisabled();
  }
  function observe(next: GameState, ready: boolean, reason = "") {
    drain();
    const key = energyChallengeIntentKey(next);
    if ((lastKey && key !== lastKey) || (lastUniverse && next.universe !== lastUniverse) || (lastReady !== null && lastReady !== ready)) {
      retire("世界、当前星球或存档保护已改变，请重新核对。"); resultNotice = "";
    }
    state = next; writable = ready; protection = reason; lastKey = key; lastUniverse = next.universe; lastReady = ready;
    gates = energyChallengeStatus(next);
    if (intent && (!visible() || !allowed(intent.action))) retire("当前条件已改变，请重新核对。");
    // This path runs even when the host skips a hidden paint. No reset candidate,
    // full-state serialization or price calculation is made by observation.
    syncDisabled();
  }
  function update(next: GameState, ready: boolean, reason = "") {
    observe(next, ready, reason);
    if (!intact() || !visible()) return;
    const model = energyChallengeView(next);
    project(() => {
      text(title, model.title); text(summary, model.summary); text(home, model.home); text(load, model.loadRule);
      home.hidden = model.phase !== "active"; load.hidden = model.phase !== "active"; checklist.hidden = model.phase !== "active";
      controls.get("enter")!.hidden = model.phase !== "inactive";
      controls.get("finish")!.hidden = model.phase !== "active"; controls.get("abandon")!.hidden = model.phase !== "active";
      for (const [index, item] of model.checklist.entries()) { text(checklistRows[index]!, item.text); checklistRows[index]!.dataset.complete = String(item.complete); }
      if (ready) text(status, resultNotice || model.reason);
    });
    syncDisabled();
  }
  function currentIntent(value: ReviewIntent, current: GameState) {
    return writable && intact() && visible(true) && value.generation === generation && value.key === energyChallengeIntentKey(current)
      && value.universe === current.universe && allowed(value.action);
  }
  function check(action: EnergyChallengeUiAction, current: GameState) {
    drain();
    // Exact object comparison precedes property access; fabricated or accessor-
    // bearing action objects cannot borrow a capability from matching values.
    if (!pending || pending.emitted !== action || state !== current) return false;
    gates = energyChallengeStatus(current);
    return currentIntent(pending.intent, current);
  }
  panel.addEventListener("click", event => {
    const node = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    drain();
    const name = node && registered.get(node);
    if (!node || !name || controls.get(name) !== node || node.disabled || !state || !writable || !intact() || !visible(true)) return;
    if (name === "cancel") { retire(); resultNotice = "已取消核对，进度未改变。"; text(status, resultNotice); return; }
    if (name === "confirm") {
      if (!intent || !currentIntent(intent, state) || pending) { retire("核对已失效，请重新查看。"); return; }
      const emitted: EnergyChallengeUiAction = Object.freeze({type:"energy-challenge", action:intent.action});
      pending = {emitted, intent}; syncDisabled(); onAction(emitted); return;
    }
    retire(); resultNotice = "";
    const quote = quoteEnergyChallenge(state, name);
    if (!quote.ok) { text(status, quote.reason); return; }
    const model = energyChallengeReview(state, quote);
    intent = {action:name, key:energyChallengeIntentKey(state), universe:state.universe, generation};
    project(() => {
      replaceConfirm(); text(reviewTitle, model.title); text(reviewSummary, model.summary); reviewLines.replaceChildren();
      for (const value of model.details) { const line = document.createElement("li"); line.textContent = value; reviewLines.append(line); }
      reviewDetails.open = false; reviewPanel.hidden = false;
      text(status, "请核对本次操作。进度尚未改变。");
    });
    syncDisabled(); controls.get("confirm")!.focus();
  });
  const visibilityChanged = () => retire("页面已隐藏，请重新核对。");
  document.addEventListener("visibilitychange", visibilityChanged);
  syncDisabled();
  return {
    observe, update, retire,
    check,
    consume(action: EnergyChallengeUiAction, current: GameState) {
      const valid = check(action, current); retire(); return valid;
    },
    complete(message: string) { retire(); resultNotice = message; text(status, message); },
    showChoice() { retire(); resultNotice = "挑战进行中：请选择核对完成并发射，或核对放弃。"; text(status, resultNotice); title.focus(); },
  };
}
