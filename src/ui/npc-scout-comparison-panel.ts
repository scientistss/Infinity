import type { FleetMessage } from "../game/fleet";
import { SPACE } from "../game/galaxy";
import { NPC_SCOUT_SNAPSHOT_MODEL, type NpcScoutSnapshotV1 } from "../game/npc-scout-state";
import {
  buildNpcScoutComparison, isNpcScoutComparisonHistory, isNpcScoutComparisonMessage, listNpcScoutComparisonCandidates,
  NPC_SCOUT_COMPARISON_UNAVAILABLE, NPC_SCOUT_COMPARISON_WARNING, type NpcScoutComparisonModel,
} from "./npc-scout-comparison-model";
import "./npc-scout-comparison.css";

const RETIRED = "对照已关闭；请从当前保留的侦察消息重新打开。";
const INSUFFICIENT = "同坐标不足两份有效的已保留 V1 侦察快照；请等待新的付费侦察抵达。";
const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
const coordinates = (value: Readonly<{ galaxy: number; system: number; position: number }>) => `${value.galaxy}:${value.system}:${value.position}`;
const signed = (value: string | number) => Number(value) > 0 ? `+${value}` : String(value);
const shortDifference = (value: string) => value.length > 18 ? `约${signed(Number(value).toExponential(4))}` : signed(value);

/** The token changes only when the host adopts a world. No saved ID or seed is authority. */
export interface NpcScoutComparisonContext {
  readonly adoptedWorld: object;
  readonly messages: readonly FleetMessage[];
  readonly writable: boolean;
  readonly protectionReason: string;
}
export interface NpcScoutComparisonHost { readContext(): NpcScoutComparisonContext }
interface CapturedContext extends NpcScoutComparisonContext {
  readonly retained: ReadonlySet<FleetMessage>;
  readonly snapshots: ReadonlyMap<FleetMessage, NpcScoutSnapshotV1 | null>;
}

/** Bounded identity capture only: never iterate an untrusted array or invoke a
 * message accessor. Full snapshot validation stays in the click-only model. */
function captureContext(host: NpcScoutComparisonHost): CapturedContext | null {
  try {
    const raw = host.readContext();
    if (!raw || typeof raw !== "object") return null;
    const values: Record<string, unknown> = {};
    for (const key of ["adoptedWorld", "messages", "writable", "protectionReason"]) {
      const field = Object.getOwnPropertyDescriptor(raw, key);
      if (!field || !("value" in field) || !field.enumerable) return null;
      values[key] = field.value;
    }
    const input = values.messages;
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return null;
    const length = Object.getOwnPropertyDescriptor(input, "length");
    if (!length || !("value" in length)
      || !Number.isInteger(length.value) || length.value < 0 || length.value > SPACE.maxMessages
      || Reflect.ownKeys(input).length !== length.value + 1 || !values.adoptedWorld || typeof values.adoptedWorld !== "object"
      || typeof values.writable !== "boolean" || typeof values.protectionReason !== "string") return null;
    const messages: FleetMessage[] = [], retained = new Set<FleetMessage>(), snapshots = new Map<FleetMessage, NpcScoutSnapshotV1 | null>();
    for (let index = 0; index < length.value; index++) {
      const entry = Object.getOwnPropertyDescriptor(input, String(index));
      if (!entry || !("value" in entry) || !entry.enumerable || !entry.value || typeof entry.value !== "object"
        || ![Object.prototype, null].includes(Object.getPrototypeOf(entry.value))) return null;
      const message = entry.value as FleetMessage, snapshot = Object.getOwnPropertyDescriptor(message, "npcScoutSnapshot");
      if (!snapshot || !("value" in snapshot) || !snapshot.enumerable || retained.has(message)
        || snapshot.value !== null && (!snapshot.value || typeof snapshot.value !== "object")) return null;
      messages.push(message); retained.add(message); snapshots.set(message, snapshot.value);
    }
    return { adoptedWorld: values.adoptedWorld, messages, writable: values.writable, protectionReason: values.protectionReason, retained, snapshots };
  } catch { return null; }
}
type Registration = { readonly button: HTMLButtonElement; readonly message: FleetMessage; readonly snapshot: NpcScoutSnapshotV1; readonly world: object; retired: boolean };
type Candidate = { readonly option: HTMLOptionElement; readonly message: FleetMessage; readonly snapshot: NpcScoutSnapshotV1 };
type Review = { readonly value: NpcScoutComparisonModel; readonly candidate: Candidate; readonly nodes: HTMLElement[] };
type Session = { readonly registration: Registration; readonly world: object; readonly candidates: readonly Candidate[]; readonly options: readonly HTMLOptionElement[]; selected: Candidate | null; review: Review | null };

export function npcScoutComparisonPanelHtml(): string {
  return `<p id="npc-scout-comparison-notice" class="muted" role="status" aria-live="polite" hidden></p>
  <section id="npc-scout-comparison-panel" class="ov-card npc-scout-comparison" aria-labelledby="npc-scout-comparison-title" hidden>
    <h3 id="npc-scout-comparison-title" tabindex="-1">历史侦察对照</h3>
    <p id="npc-scout-comparison-source" class="chip"></p>
    <label for="npc-scout-comparison-other">同坐标的另一份报告<select id="npc-scout-comparison-other" disabled><option value="">请明确选择一份报告</option></select></label>
    <div class="space-controls"><button id="npc-scout-comparison-run" type="button" disabled>查看差值</button><button id="npc-scout-comparison-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-scout-comparison-status" class="muted" role="status" aria-live="polite"></p>
    <p id="npc-scout-comparison-warning" class="muted">${NPC_SCOUT_COMPARISON_WARNING}。</p>
    <div id="npc-scout-comparison-results" hidden></div>
  </section>`;
}

/** Read-only, object-bound history. Observation performs bounded identity checks,
 * never comparison/rendering on a frame. Only an original trusted click runs it.
 * The host must invalidate before import/reset confirmation, even if cancelled. */
export function installNpcScoutComparisonPanel(root: HTMLElement, host: NpcScoutComparisonHost) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const node = root.querySelector<T>(`#${id}`); if (!node) throw Error(`缺少历史对照控件 ${id}`); return node;
  }
  const panel = get("npc-scout-comparison-panel"), messagesPanel = get("space-messages"), title = get("npc-scout-comparison-title");
  const warning = get("npc-scout-comparison-warning"), notice = get("npc-scout-comparison-notice");
  const source = get("npc-scout-comparison-source"), status = get("npc-scout-comparison-status"), results = get("npc-scout-comparison-results");
  const other = get<HTMLSelectElement>("npc-scout-comparison-other"), run = get<HTMLButtonElement>("npc-scout-comparison-run"), cancel = get<HTMLButtonElement>("npc-scout-comparison-cancel");
  const mounted = [panel, messagesPanel, title, source, status, results, warning, notice, other, run, cancel];
  const registrations = new WeakMap<HTMLButtonElement, Registration>(), live = new Set<Registration>(), watched = new Set<Node>(), seenClicks = new WeakSet<Event>();
  let session: Session | null = null, disposed = false, mountRetired = false, watchDirty = false;
  let previousWorld: object | null = null, previousWritable: boolean | null = null, writableNow = false;
  function readContext() { const context = captureContext(host); writableNow = context?.writable ?? false; return context; }
  const visible = () => !document.hidden && !messagesPanel.hidden && !panel.hidden;
  const retained = (registration: Registration, context: CapturedContext) => !registration.retired
    && context.adoptedWorld === registration.world && context.retained.has(registration.message) && context.snapshots.get(registration.message) === registration.snapshot;
  function disable() {
    const enabled = !!session && !disposed && !mountRetired && visible() && writableNow;
    const disableOther = !enabled || !session?.candidates.length, disableRun = !enabled || !session?.selected;
    if (other.disabled !== disableOther) other.disabled = disableOther;
    if (run.disabled !== disableRun) run.disabled = disableRun;
  }
  function clearResult() {
    if (session) session.review = null;
    results.replaceChildren(); results.hidden = true; watchDirty = true;
  }
  function abandon(reason = RETIRED, returnFocus = false, notify = false) {
    if (notify) { text(notice, reason); if (notice.hidden) notice.hidden = false; }
    else if (!notice.hidden) notice.hidden = true;
    if (!session && panel.hidden && !results.firstChild && !other.firstChild) { text(status, reason); disable(); return; }
    const opener = session?.registration.button;
    session = null; clearResult(); other.replaceChildren(); other.value = "";
    panel.hidden = true; text(source, ""); text(status, reason); disable();
    if (returnFocus && opener?.isConnected && messagesPanel.contains(opener) && !messagesPanel.hidden && !document.hidden && !opener.disabled) opener.focus();
  }
  function retireRegistration(registration: Registration) {
    registration.retired = true; registration.button.disabled = true; live.delete(registration); watchDirty = true;
    if (session?.registration === registration) abandon("原报告已移除或隐藏，请从当前保留消息重新打开对照。", false, true);
  }
  function invalidate(reason = RETIRED) {
    abandon(reason, false, true);
    if (live.size) {
      for (const registration of live) { registration.retired = true; registration.button.disabled = true; }
      live.clear(); watchDirty = true;
    }
  }
  function removed(records: MutationRecord[]) {
    if (disposed || mountRetired) return;
    for (const record of records) {
      if (record.type === "attributes") {
        const hides = record.attributeName === "hidden" && record.oldValue === null || record.attributeName === "style" || record.attributeName === "aria-hidden";
        const target = record.target;
        const anchors = [panel, title, other, run, cancel, source, warning, ...(session?.options ?? []), ...(session?.review?.nodes ?? [])];
        if (hides && session && target instanceof Element && anchors.some(node => target === node || target.contains(node))) abandon("查看区域已隐藏，请重新打开对照。", false, true);
        // Hiding a report row retires that source. Whole-page navigation only
        // retires the session so another deliberate report click can reopen it.
        if (hides && target instanceof Element && target !== messagesPanel && messagesPanel.contains(target)) {
          for (const registration of live) if (target === registration.button || target.contains(registration.button)) retireRegistration(registration);
        }
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (mounted.some(control => node === control || node.contains(control))) {
          mountRetired = true; invalidate("历史对照控件已被替换，请重新载入页面。"); observer.disconnect(); return;
        }
        if ([...(session?.options ?? []), ...(session?.review?.nodes ?? [])].some(control => node === control || node.contains(control))) abandon("报告选择或查看结果已替换，请重新打开对照。", false, true);
        for (const registration of live) if (node === registration.button || node.contains(registration.button)) retireRegistration(registration);
      }
    }
  }
  const observer = new MutationObserver(removed);
  function watch(node: Node) {
    // Watch only original controls, results and ancestors, never a root subtree.
    for (let parent: Node | null = node; parent; parent = parent.parentNode) if (!watched.has(parent)) {
      watched.add(parent); observer.observe(parent, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "style", "aria-hidden"] });
    }
  }
  for (const node of mounted) watch(node);
  function intact(identities = true) {
    removed(observer.takeRecords());
    if (watchDirty && !mountRetired && !disposed) {
      observer.disconnect(); watched.clear();
      for (const node of mounted) watch(node);
      for (const registration of live) watch(registration.button);
      for (const node of [...(session?.options ?? []), ...(session?.review?.nodes ?? [])]) watch(node);
      watchDirty = false;
    }
    return !mountRetired && !disposed && root.isConnected && mounted.every(node => node.isConnected && root.contains(node)
      && (!identities || root.querySelector(`#${node.id}`) === node));
  }
  function currentContext(current: Session, identities = true, captured?: CapturedContext) {
    if (!intact(identities) || session !== current || !visible()) return null;
    const context = captured ?? readContext();
    if (!context) { invalidate("历史消息身份无效，对照已关闭。"); return null; }
    if (!context.writable) { invalidate(context.protectionReason || "存档受保护，历史对照已关闭。"); return null; }
    if (current.world !== context.adoptedWorld || !retained(current.registration, context)
      || current.candidates.some(candidate => !context.retained.has(candidate.message) || context.snapshots.get(candidate.message) !== candidate.snapshot)
      || current.options.length !== other.options.length || current.options.some((option, index) => other.options[index] !== option)) { abandon("报告或世界已改变，请从当前保留消息重新打开对照。", false, true); return null; }
    return context;
  }
  function observe() {
    if (!intact(false)) return;
    const context = readContext();
    if (!context) { invalidate("历史消息身份无效，对照已关闭。"); return; }
    if (!context.writable || previousWorld !== null && (context.adoptedWorld !== previousWorld || context.writable !== previousWritable)) invalidate(context.protectionReason || RETIRED);
    previousWorld = context.adoptedWorld; previousWritable = context.writable;
    for (const registration of live) if (!retained(registration, context)) retireRegistration(registration);
    const current = session;
    if (current && (!visible() || !currentContext(current, false, context))) { if (session) abandon(); }
    disable();
  }
  function freshClick(event: Event, button: HTMLButtonElement) {
    if (!event.isTrusted || event.target !== button || seenClicks.has(event)) return false;
    seenClicks.add(event); return true;
  }
  function open(registration: Registration, event: Event) {
    if (!freshClick(event, registration.button) || registration.button.disabled || !intact() || document.hidden || messagesPanel.hidden) return;
    observe();
    const context = readContext();
    if (!context || !context.writable || !registration.button.isConnected || !messagesPanel.contains(registration.button) || !retained(registration, context)) return;
    if (!isNpcScoutComparisonMessage(registration.message) || !isNpcScoutComparisonHistory(context.messages)) { invalidate(NPC_SCOUT_COMPARISON_UNAVAILABLE); return; }
    const candidates = listNpcScoutComparisonCandidates(context.messages, registration.message);
    abandon(); panel.hidden = false;
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "请明确选择一份报告"; other.append(placeholder);
    const options: HTMLOptionElement[] = [placeholder];
    const choices: Candidate[] = candidates.map((candidate, index) => {
      const message = context.messages[candidate.index]!, snapshot = context.snapshots.get(message)!;
      const option = document.createElement("option"); option.value = String(index + 1);
      option.textContent = `舰队 #${candidate.fleetId} · 观察 ${candidate.observedAt} 秒`;
      other.append(option); options.push(option); return { option, message, snapshot };
    });
    other.value = "";
    // Internal close/reopen and option replacement are not a new capability.
    removed(observer.takeRecords());
    if (disposed || mountRetired) return;
    session = { registration, world: context.adoptedWorld, candidates: choices, options, selected: null, review: null };
    for (const option of options) watch(option);
    text(source, `固定报告：舰队 #${registration.snapshot.fleetId} · [${coordinates(registration.snapshot.target)}] · 观察 ${registration.snapshot.observedAt} 秒`);
    text(status, choices.length ? "选择另一份报告，再点击查看差值。前后按保留消息顺序确定。" : INSUFFICIENT);
    disable(); title.focus();
  }
  const edited = (event: Event) => {
    if (event.target !== other) return;
    const current = session;
    if (!current || !currentContext(current)) return;
    const option = other.options[other.selectedIndex], selected = current.candidates.find(candidate => candidate.option === option) ?? null;
    if (selected === current.selected && event.isTrusted) return;
    clearResult(); current.selected = event.isTrusted ? selected : null;
    text(status, current.selected ? "已更换报告；请点击查看差值。" : "请明确选择另一份报告，再查看差值。"); disable();
  };
  function field(parent: HTMLElement, side: string, key: string, label: string, value: string | number) {
    const row = document.createElement("p"), output = document.createElement("span");
    row.textContent = `${label}：`; output.dataset.comparisonSide = side; output.dataset.comparisonField = key; output.textContent = String(value); row.append(output); parent.append(row);
    return [row, output];
  }
  function render(current: Session, review: Review) {
    clearResult(); results.hidden = false;
    // Drain our own hidden-region changes before installing new result anchors.
    removed(observer.takeRecords());
    if (session !== current || disposed || mountRetired) return;
    current.review = review;
    const summary = document.createElement("p"); summary.id = "npc-scout-comparison-summary";
    const value = review.value;
    summary.textContent = `后次 − 前次观察：金属 ${shortDifference(value.delta.stock[0])} · 晶体 ${shortDifference(value.delta.stock[1])} · 重氢 ${shortDifference(value.delta.stock[2])}；轻战 ${signed(value.delta.garrison.light_fighter)} · 重战 ${signed(value.delta.garrison.heavy_fighter)}。`;
    const exact = document.createElement("details"), heading = document.createElement("summary"), body = document.createElement("div");
    exact.id = "npc-scout-comparison-exact"; body.id = "npc-scout-comparison-exact-body"; body.className = "npc-report-details";
    heading.textContent = "两次原值与精确观察时间"; exact.append(heading, body); results.append(summary, exact);
    review.nodes.push(summary, exact, heading, body); for (const node of review.nodes) watch(node);
    let shown = false;
    exact.addEventListener("toggle", () => {
      if (!exact.open || shown || session !== current || current.review !== review || !currentContext(current) || !results.contains(exact)) return;
      for (const side of ["before", "after"] as const) {
        const observation = value[side], group = document.createElement("section"), label = document.createElement("h4");
        label.textContent = side === "before" ? "前次观察（消息顺序较早）" : "后次观察（消息顺序较晚）"; group.append(label); body.append(group);
        review.nodes.push(group, label);
        const add = (key: string, name: string, raw: string | number) => review.nodes.push(...field(group, side, key, name, raw));
        add("model", "模型", NPC_SCOUT_SNAPSHOT_MODEL); add("messageId", "消息", observation.messageId); add("fleetId", "舰队", observation.fleetId);
        add("originId", "历史出发星球", observation.originId); add("target", "目标坐标", coordinates(value.target)); add("observedAt", "精确观察时间（秒）", observation.observedAt);
        for (const [index, name] of ["metal", "crystal", "deuterium"].entries()) add(`stock.${name}`, ["金属", "晶体", "重氢"][index]!, observation.stock[index]!);
        add("garrison.light_fighter", "轻型战斗机", observation.garrison.light_fighter); add("garrison.heavy_fighter", "重型战斗机", observation.garrison.heavy_fighter);
        for (const key of ["weapons", "shields", "armour"] as const) add(`defenderTech.${key}`, `驻军 ${key}`, observation.defenderTech[key]);
      }
      for (const [index, name] of ["metal", "crystal", "deuterium"].entries()) review.nodes.push(...field(body, "delta", `stock.${name}`, `${["金属", "晶体", "重氢"][index]}观察差`, value.delta.stock[index]!));
      for (const key of ["light_fighter", "heavy_fighter"] as const) review.nodes.push(...field(body, "delta", `garrison.${key}`, `${key === "light_fighter" ? "轻战" : "重战"}观察差`, value.delta.garrison[key]));
      for (const key of ["weapons", "shields", "armour"] as const) review.nodes.push(...field(body, "delta", `defenderTech.${key}`, `驻军 ${key} 观察差`, value.after.defenderTech[key] - value.before.defenderTech[key]));
      const precision = document.createElement("p"); precision.className = "muted"; precision.textContent = value.precision; body.append(precision); review.nodes.push(precision);
      for (const node of review.nodes) watch(node); shown = true;
    });
  }
  const runClick = (event: Event) => {
    if (!freshClick(event, run) || run.disabled) return;
    const current = session, context = current && currentContext(current), candidate = current?.selected;
    if (!current || !context || !candidate || other.options[other.selectedIndex] !== candidate.option || context.snapshots.get(candidate.message) !== candidate.snapshot) return;
    const value = buildNpcScoutComparison(context.messages, current.registration.message, candidate.message);
    if (!value) { abandon(NPC_SCOUT_COMPARISON_UNAVAILABLE, false, true); return; }
    if (!currentContext(current) || current.selected !== candidate) return;
    render(current, { value, candidate, nodes: [] }); text(status, "已显示两次历史观察差；更换报告后需重新查看。"); disable();
  };
  const cancelClick = (event: Event) => { if (freshClick(event, cancel) && intact()) abandon(RETIRED, true); };
  const keydown = (event: KeyboardEvent) => { if (event.isTrusted && event.key === "Escape" && session && panel.contains(event.target as Node)) { event.preventDefault(); abandon(RETIRED, true); } };
  const hidden = () => { if (document.hidden) abandon(); };
  const back = () => abandon();
  other.addEventListener("input", edited); other.addEventListener("change", edited); run.addEventListener("click", runClick); cancel.addEventListener("click", cancelClick);
  root.addEventListener("keydown", keydown); document.addEventListener("visibilitychange", hidden); window.addEventListener("popstate", back); disable();
  return {
    observe, invalidate,
    registerReport(button: HTMLButtonElement, message: FleetMessage): boolean {
      if (registrations.has(button) || !intact() || !button.isConnected || !messagesPanel.contains(button)) return false;
      const context = readContext();
      if (!context || !context.writable || !context.retained.has(message) || !isNpcScoutComparisonMessage(message)) { button.disabled = true; return false; }
      const snapshot = context.snapshots.get(message)!;
      const registration: Registration = { button, message, snapshot, world: context.adoptedWorld, retired: false };
      registrations.set(button, registration); live.add(registration); watch(button); button.disabled = false;
      button.addEventListener("click", event => open(registration, event)); return true;
    },
    close() { abandon(RETIRED, true); },
    dispose() {
      invalidate(); disposed = true; observer.disconnect(); watched.clear();
      other.removeEventListener("input", edited); other.removeEventListener("change", edited); run.removeEventListener("click", runClick); cancel.removeEventListener("click", cancelClick);
      root.removeEventListener("keydown", keydown); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("popstate", back);
    },
  };
}
