import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import type { CombatTech } from "../game/encounter-combat";
import type { FleetMessage } from "../game/fleet";
import { rehearseNpcScout, type NpcRehearsalResult, type NpcRehearsalSample } from "../game/npc-rehearsal";
import type { NpcScoutSnapshotV1 } from "../game/npc-scout-state";
import { buildNpcRehearsalFormationCopy, listNpcRehearsalFormations } from "./npc-rehearsal-formation-model";

export const NPC_REHEARSAL_FLYING_IDS = Object.freeze(SHIP_IDS.filter(id => id !== "solar_satellite"));
type FlyingId = (typeof NPC_REHEARSAL_FLYING_IDS)[number];
type Coordinates = Readonly<{ galaxy: number; system: number; position: number }>;
type ShipCounts = Readonly<Partial<Record<ShipId, number>>>;
export const NPC_REHEARSAL_WARNING = "三个固定公开种子的示例，不代表胜率、所有结果或损失/战利品保证。仅使用这份侦察抵达时的库存和驻军；真实抵达时情况可能不同。";
export const NPC_REHEARSAL_UNAVAILABLE = "没有可用的演练快照；需要新的付费侦察抵达";
const TECH_KEYS = ["weapons", "shields", "armour"] as const;
const MAX_SHIPS = 1e12;
const RETIRED = "演练已关闭；请从当前保留的侦察消息重新打开并运行。";

/** The host rotates this object on world adoption, never on ordinary immutable ticks.
 * It must also call invalidate BEFORE import/reset/curvature confirmations, even
 * when the eventual operation is cancelled. No saved ID can replace this token. */
export interface NpcRehearsalContext {
  readonly adoptedWorld: object;
  readonly messages: readonly FleetMessage[];
  readonly origin: Readonly<{ id: string; name: string; coordinates: Coordinates }>;
  readonly landedShips: ShipCounts;
  /** Read-only saved-design subgraph, never GameState or order/payment data. */
  readonly formations: unknown;
  readonly completedTech: Readonly<CombatTech>;
  readonly completedHyperspaceLevel: number;
  readonly writable: boolean;
  readonly protectionReason: string;
}
export interface NpcRehearsalDraft {
  readonly originId: string;
  readonly mission: "attack";
  readonly target: Coordinates;
  readonly ships: Readonly<Record<FlyingId, number>>;
  readonly speedPercent: number;
  readonly cargo: Readonly<{ metal: 0; crystal: 0; deuterium: 0 }>;
}
export interface NpcRehearsalDecision { readonly ok: boolean; readonly reason: string }
export interface NpcRehearsalHost {
  readContext(): NpcRehearsalContext;
  /** Ordinary full, current attack quote only. Never return enemy information. */
  quoteAttack(draft: NpcRehearsalDraft): NpcRehearsalDecision;
  /** Synchronous, atomic DOM-only replacement. Validate all destination nodes
   * first, then consume immediately before changing mission/target/all 13 ship
   * fields/speed/zero cargo. Clear formation/transport provenance and navigate.
   * No payment, dispatch, selected-planet change, or send authority is permitted.
   * consume expires when this callback returns and is never transferable. */
  fillDraft(draft: NpcRehearsalDraft, consume: () => boolean): NpcRehearsalDecision;
}

const coordinates = (value: Coordinates) => `${value.galaxy}:${value.system}:${value.position}`;
const counts = (ships: ShipCounts) => NPC_REHEARSAL_FLYING_IDS.filter(id => (ships[id] ?? 0) > 0)
  .map(id => `${unitById(id).nameZh} ${ships[id]}`).join(" · ") || "无";
const loot = (value: readonly number[]) => `金属 ${value[0]} · 晶体 ${value[1]} · 重氢 ${value[2]}`;
const losses = (sample: NpcRehearsalSample) => Object.fromEntries(NPC_REHEARSAL_FLYING_IDS
  .map(id => [id, (sample.battle.attackerBefore[id] ?? 0) - (sample.battle.attackerAfter[id] ?? 0)]));
const outcome = (sample: NpcRehearsalSample) => sample.undefended ? "无驻军收集" : sample.battle.winner === "attacker" ? "胜" : sample.battle.winner === "defender" ? "败" : "平";
const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };

/** Separate zeroed selection. Never reads or changes the ordinary flight form. */
export function npcRehearsalPanelHtml(): string {
  return `<section id="npc-rehearsal-panel" class="ov-card" aria-labelledby="npc-rehearsal-title" hidden>
    <h3 id="npc-rehearsal-title" tabindex="-1">历史侦察演练</h3>
    <p id="npc-rehearsal-source" class="muted"></p><p id="npc-rehearsal-origin" class="chip"></p>
    <details id="npc-rehearsal-history"><summary>侦察抵达时的精确情报</summary><div id="npc-rehearsal-history-body" class="npc-report-details"></div></details>
    <p class="muted">仅选择当前星球已停泊舰船。演练不派遣、不付款；排队建造与研究不计入。</p>
    <div class="space-controls"><label for="npc-rehearsal-formation">保存编成<select id="npc-rehearsal-formation" aria-label="保存编成"><option value="">选择命名编成</option></select></label><button id="npc-rehearsal-copy" type="button" disabled>填入演练数量</button></div>
    <p id="npc-rehearsal-formation-source" class="muted"></p>
    <details id="npc-rehearsal-deficits"><summary id="npc-rehearsal-deficit-summary">数量与当前停泊库存</summary><div id="npc-rehearsal-deficit-body" class="npc-report-details"></div></details>
    <div class="space-ships">${NPC_REHEARSAL_FLYING_IDS.map(id => `<label class="space-ship"><span>${unitById(id).nameZh}<small id="npc-rehearsal-stock-${id}"></small></span><input id="npc-rehearsal-ship-${id}" type="number" min="0" max="${MAX_SHIPS}" step="1" value="0" aria-label="${unitById(id).nameZh}演练数量" /></label>`).join("")}</div>
    <div class="space-controls"><label>草稿速度<select id="npc-rehearsal-speed">${[100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map(n => `<option value="${n}">${n}%</option>`).join("")}</select></label>
    <button id="npc-rehearsal-run" type="button">运行三个公开种子示例</button><button id="npc-rehearsal-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-rehearsal-status" class="space-error" role="status" aria-live="polite"></p>
    <div id="npc-rehearsal-results" hidden></div>
    <p id="npc-rehearsal-fill-explanation" class="muted">填入会替换舰队草稿的任务、目标、全部 13 类舰船数量、速度和货物（全部清零），保留当前所选星球。之后仍需单独点击付费出征。</p>
    <button id="npc-rehearsal-fill" type="button" aria-describedby="npc-rehearsal-fill-explanation" disabled>填入攻击草稿（空载）</button>
  </section>`;
}

/** Reject instead of truncating oversized pasted input. Unknown zero keys also fail. */
export function readNpcRehearsalSelection(raw: Readonly<Record<string, string>>, landed: ShipCounts): Readonly<Record<FlyingId, number>> {
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== NPC_REHEARSAL_FLYING_IDS.length || keys.some(key => typeof key !== "string" || !NPC_REHEARSAL_FLYING_IDS.includes(key as FlyingId))) throw Error("演练舰船输入不完整或含未知舰种。");
  const result = {} as Record<FlyingId, number>;
  let total = 0;
  for (const id of NPC_REHEARSAL_FLYING_IDS) {
    const field = Object.getOwnPropertyDescriptor(raw, id);
    if (!field || !("value" in field) || !field.enumerable || typeof field.value !== "string" || !/^\d{1,13}$/.test(field.value)) throw Error(`${unitById(id).nameZh}数量须为非负整数。`);
    const count = Number(field.value), stock = landed[id] ?? 0;
    if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(count) || count > MAX_SHIPS || count > stock) throw Error(`${unitById(id).nameZh}数量超出当前停泊库存或单舰种 1e12 上限。`);
    total += count;
    if (!Number.isSafeInteger(total)) throw Error("演练舰船总数超出安全整数范围。");
    result[id] = count;
  }
  if (!total) throw Error("请先选择至少一艘当前已停泊舰船。");
  return Object.freeze(result);
}

type Registration = { readonly button: HTMLButtonElement; readonly message: FleetMessage; readonly snapshot: NpcScoutSnapshotV1; readonly world: object; retired: boolean };
type Review = { readonly result: NpcRehearsalResult; readonly draft: NpcRehearsalDraft; readonly fingerprint: string; readonly available: readonly number[]; readonly nodes: HTMLElement[]; stale: boolean; quote: NpcRehearsalDecision };
type FormationCopy = NonNullable<ReturnType<typeof buildNpcRehearsalFormationCopy>>;
type FormationOption = { readonly node: HTMLOptionElement; readonly value: string; readonly source: unknown; readonly ships: unknown; readonly mark: string; retired: boolean };
type FormationChoice = { readonly option: FormationOption; readonly copy: FormationCopy };
type Session = { readonly registration: Registration; readonly originId: string; readonly world: object; readonly snapshot: NpcScoutSnapshotV1; historyShown: boolean; review: Review | null; formation: FormationChoice | null };

/** Capabilities are original object references, never datasets or persisted IDs.
 * observe is a cheap lifecycle/stock/technology check; combat runs only on a
 * trusted Run click. All output stays tied to captured historical inputs. */
export function installNpcRehearsalPanel(root: HTMLElement, host: NpcRehearsalHost) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const node = root.querySelector<T>(`#${id}`); if (!node) throw Error(`缺少演练控件 ${id}`); return node;
  }
  const panel = get("npc-rehearsal-panel"), messagesPanel = get("space-messages"), title = get("npc-rehearsal-title");
  const source = get("npc-rehearsal-source"), origin = get("npc-rehearsal-origin"), status = get("npc-rehearsal-status");
  const history = get<HTMLDetailsElement>("npc-rehearsal-history"), historyBody = get("npc-rehearsal-history-body"), results = get("npc-rehearsal-results");
  const run = get<HTMLButtonElement>("npc-rehearsal-run"), cancel = get<HTMLButtonElement>("npc-rehearsal-cancel"), fill = get<HTMLButtonElement>("npc-rehearsal-fill");
  const speed = get<HTMLSelectElement>("npc-rehearsal-speed");
  const formation = get<HTMLSelectElement>("npc-rehearsal-formation"), copy = get<HTMLButtonElement>("npc-rehearsal-copy"), formationSource = get("npc-rehearsal-formation-source");
  const deficits = get<HTMLDetailsElement>("npc-rehearsal-deficits"), deficitSummary = get("npc-rehearsal-deficit-summary"), deficitBody = get("npc-rehearsal-deficit-body");
  const inputPrototype = HTMLInputElement.prototype, inputValue = Object.getOwnPropertyDescriptor(inputPrototype, "value"), inputType = Object.getOwnPropertyDescriptor(inputPrototype, "type");
  const fields = NPC_REHEARSAL_FLYING_IDS.map(id => ({ id, input: get<HTMLInputElement>(`npc-rehearsal-ship-${id}`), available: get(`npc-rehearsal-stock-${id}`) }));
  const mounted = [panel, messagesPanel, title, source, origin, status, history, historyBody, results, run, cancel, fill, speed, formation, copy, formationSource, deficits, deficitSummary, deficitBody, ...fields.flatMap(field => [field.input, field.available])];
  const registrations = new WeakMap<HTMLButtonElement, Registration>(), live = new Set<Registration>();
  const watched = new Set<Node>();
  let session: Session | null = null, busy = false, mountRetired = false, disposed = false, watchDirty = false;
  let formationEntries: unknown, formationOptions: FormationOption[] = [], emptyOption: HTMLOptionElement | null = null;
  let deficitKey = "";
  let previousWorld: object | null = null, previousOrigin = "", previousWritable: boolean | null = null;
  const fingerprint = () => JSON.stringify([...fields.map(field => field.input.value), speed.value]);
  const available = (context: NpcRehearsalContext) => fields.map(field => context.landedShips[field.id] ?? 0);
  const visible = () => !document.hidden && !panel.hidden && !messagesPanel.hidden;
  const retained = (registration: Registration, context: NpcRehearsalContext, messages?: ReadonlySet<FleetMessage>) => !registration.retired && registration.world === context.adoptedWorld
    && (messages ? messages.has(registration.message) : context.messages.includes(registration.message)) && registration.message.npcScoutSnapshot === registration.snapshot;
  function controlsDisabled() {
    const current = session, context = host.readContext();
    const enabled = !!current && !mountRetired && !disposed && visible() && context.writable && !busy;
    for (const field of fields) field.input.disabled = !enabled;
    speed.disabled = !enabled; formation.disabled = !enabled || !formationOptions.length; copy.disabled = !enabled || !current?.formation;
    run.disabled = !enabled;
    text(run, current?.review && !current.review.stale && current.review.fingerprint === fingerprint() ? "重新核对出征条件" : "运行三个公开种子示例");
    fill.disabled = !enabled || !current?.review || current.review.stale || !current.review.quote.ok;
  }
  function abandon(reason = RETIRED, returnFocus = false) {
    if (!session && panel.hidden) return;
    const opener = session?.registration.button;
    session = null; busy = false; watchDirty = true; results.replaceChildren(); results.hidden = true;
    historyBody.replaceChildren(); history.open = false; panel.hidden = true; text(status, reason);
    formation.value = ""; text(formationSource, ""); deficitBody.replaceChildren(); deficits.open = false; deficitKey = "";
    controlsDisabled();
    if (returnFocus && opener?.isConnected && root.contains(opener) && !messagesPanel.hidden && !document.hidden && !opener.disabled) opener.focus();
  }
  function invalidate(reason = RETIRED) {
    abandon(reason);
    for (const registration of live) { registration.retired = true; registration.button.disabled = true; }
    live.clear(); watchDirty = true;
  }
  function removed(records: MutationRecord[]) {
    if (disposed || mountRetired) return;
    for (const record of records) {
      if (record.type === "attributes") {
        // oldValue detects hidden→visible again before the observer runs.
        const hides = record.attributeName === "hidden" && record.oldValue === null
          || record.attributeName === "aria-hidden" || record.attributeName === "style";
        const target = record.target;
        // The optional result region is intentionally hidden when editing.
        // Only hiding current controls/their ancestors or reviewed result
        // nodes retires the session, not that internal empty-region update.
        const anchors = [panel, run, fill, speed, formation, copy, ...formationOptions.map(option => option.node), ...fields.map(field => field.input), ...(session?.review?.nodes ?? [])];
        if (hides && session && target instanceof Element && anchors.some(node => target === node || target.contains(node))) abandon();
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (mounted.some(control => node === control || node.contains(control))) { mountRetired = true; invalidate("演练控件已被替换，请重新载入页面。"); observer.disconnect(); return; }
        if (session?.review?.nodes.some(control => node === control || node.contains(control))) abandon();
        for (const option of formationOptions) if (node === option.node || node.contains(option.node)) {
          option.retired = true;
          if (session?.formation?.option === option) retireChoice(session);
        }
        for (const registration of live) if (node === registration.button || node.contains(registration.button)) {
          registration.retired = true; registration.button.disabled = true; live.delete(registration); watchDirty = true;
          if (session?.registration === registration) abandon();
        }
      }
    }
  }
  const observer = new MutationObserver(removed);
  function watch(node: Node) {
    // Include the capability itself: hiding and restoring a leaf before the
    // next click must retire it just like hiding/removing an ancestor.
    for (let parent: Node | null = node; parent; parent = parent.parentNode) if (!watched.has(parent)) {
      watched.add(parent); observer.observe(parent, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["hidden", "style", "aria-hidden"] });
    }
  }
  for (const node of mounted) watch(node);
  function intact() {
    removed(observer.takeRecords());
    if (watchDirty && !mountRetired && !disposed) {
      observer.disconnect(); watched.clear();
      for (const node of mounted) watch(node);
      for (const registration of live) watch(registration.button);
      for (const option of formationOptions) watch(option.node);
      for (const node of session?.review?.nodes ?? []) watch(node);
      watchDirty = false;
    }
    return !mountRetired && !disposed && root.isConnected && mounted.every(node => node.isConnected && root.contains(node) && root.querySelector(`#${node.id}`) === node);
  }
  function currentContext(current: Session, writable = true): NpcRehearsalContext | null {
    if (!intact() || session !== current || !visible()) return null;
    const context = host.readContext();
    if (context.adoptedWorld !== current.world || context.origin.id !== current.originId || !retained(current.registration, context)) { abandon(); return null; }
    if (writable && !context.writable) { invalidate(context.protectionReason || "存档受保护，无法运行或填入。"); return null; }
    return context;
  }
  // A bounded selected-object signature catches edits even when an adapter keeps
  // the same array or revision. Never invoke a getter while checking authority.
  function formationMark(value: unknown): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 4 || keys.some(key => typeof key !== "string" || !["id", "revision", "name", "ships"].includes(key))) return null;
    const data = ["id", "revision", "name", "ships"].map(key => Object.getOwnPropertyDescriptor(value, key));
    if (data.some(field => !field || !("value" in field) || !field.enumerable)) return null;
    const ships: unknown = data[3]!.value;
    if (!ships || typeof ships !== "object" || Array.isArray(ships)) return null;
    const shipProto = Object.getPrototypeOf(ships), shipKeys = Reflect.ownKeys(ships);
    if ((shipProto !== Object.prototype && shipProto !== null) || shipKeys.some(key => typeof key !== "string" || !NPC_REHEARSAL_FLYING_IDS.includes(key as FlyingId))) return null;
    const values: unknown[] = [];
    for (const id of NPC_REHEARSAL_FLYING_IDS) {
      const field = Object.getOwnPropertyDescriptor(ships, id);
      if (field && (!("value" in field) || !field.enumerable || typeof field.value !== "number")) return null;
      values.push(field ? field.value : null);
    }
    if (typeof data[0]!.value !== "number" || typeof data[1]!.value !== "number" || typeof data[2]!.value !== "string") return null;
    return JSON.stringify([data[0]!.value, data[1]!.value, data[2]!.value, values]);
  }
  function landedProjection(context: NpcRehearsalContext): unknown {
    const original = context.landedShips;
    if (!original || typeof original !== "object" || Array.isArray(original)) return null;
    const prototype = Object.getPrototypeOf(original);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (!Array.isArray(context.formations) || context.formations.length > 32) return null;
    for (let index = 0; index < context.formations.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(context.formations, String(index));
      if (!entry || !("value" in entry) || !entry.value || typeof entry.value !== "object") return null;
      if (entry.value === original || Object.getOwnPropertyDescriptor(entry.value, "ships")?.value === original) return null;
    }
    const value: Record<string, number> = {};
    for (const id of NPC_REHEARSAL_FLYING_IDS) {
      const field = Object.getOwnPropertyDescriptor(context.landedShips, id);
      if (field && (!("value" in field) || !field.enumerable || typeof field.value !== "number")) return null;
      value[id] = field?.value ?? 0;
    }
    return value;
  }
  function optionNodesIntact() {
    const nodes = Array.from(formation.children);
    return nodes.length === formationOptions.length + 1 && nodes[0] === emptyOption && emptyOption?.value === ""
      && formationOptions.every((option, index) => nodes[index + 1] === option.node && option.node.value === option.value);
  }
  function retireChoice(current: Session) {
    current.formation = null; formation.value = ""; copy.disabled = true;
  }
  function refreshFormations(context: NpcRehearsalContext, force = false) {
    if (!force && formationEntries === context.formations) return;
    formationEntries = context.formations;
    if (session?.formation) retireChoice(session);
    formationOptions = [];
    emptyOption = document.createElement("option"); emptyOption.value = ""; emptyOption.textContent = "选择命名编成";
    formation.replaceChildren(emptyOption);
    for (const item of listNpcRehearsalFormations(context.formations)) {
      const entry = Object.getOwnPropertyDescriptor(context.formations as object, String(item.index));
      if (!entry || !("value" in entry)) continue;
      const mark = formationMark(entry.value); if (mark === null) continue;
      const node = document.createElement("option"), value = String(item.index + 1);
      node.value = value; node.textContent = `#${item.id} ${item.name} · r${item.revision}`; formation.append(node);
      formationOptions.push({ node, value, source: entry.value, ships: Object.getOwnPropertyDescriptor(entry.value, "ships")!.value, mark, retired: false }); watch(node);
    }
    formation.value = ""; watchDirty = true;
  }
  function choiceCurrent(current: Session, context: NpcRehearsalContext): boolean {
    const choice = current.formation;
    if (!choice || !Array.isArray(context.formations) || context.formations.length > 32 || choice.option.retired || Object.getOwnPropertyDescriptor(choice.option.source as object, "ships")?.value !== choice.option.ships || formation.value !== choice.option.value || !optionNodesIntact() || formationMark(choice.option.source) !== choice.option.mark) return false;
    // Only reference checks here; complete library validation happens on the
    // explicit selection/copy paths, never a 32-design deep scan per frame.
    let matches = 0;
    for (let i = 0; i < context.formations.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(context.formations, String(i));
      if (!entry || !("value" in entry)) return false;
      if (entry.value === choice.option.source) matches++;
    }
    return matches === 1;
  }
  function retireReview(current: Session) {
    current.review = null; watchDirty = true; results.replaceChildren(); results.hidden = true;
  }
  function paintDeficits(context: NpcRehearsalContext) {
    const rows = fields.map(field => ({ id: field.id, raw: field.input.value, stock: Object.getOwnPropertyDescriptor(context.landedShips, field.id) }));
    const key = JSON.stringify(rows.map(row => [row.raw, row.stock && "value" in row.stock ? row.stock.value : null]));
    if (key === deficitKey) return;
    deficitKey = key; deficitBody.replaceChildren();
    let total = 0, valid = true;
    for (const row of rows) {
      const stock = row.stock && "value" in row.stock ? row.stock.value : 0, target = Number(row.raw);
      if (!/^\d{1,13}$/.test(row.raw) || !Number.isSafeInteger(target) || target > MAX_SHIPS || !Number.isSafeInteger(stock) || stock < 0) { valid = false; continue; }
      const missing = Math.max(0, target - stock); total += missing;
      if (missing) { const line = paragraph(deficitBody, `${unitById(row.id).nameZh}：目标 ${target} · 停泊 ${stock} · 缺 ${missing}`); line.dataset.rehearsalDeficitUnit = row.id; }
    }
    text(deficitSummary, !valid ? "数量待核对" : total ? `停泊缺额 ${total} 艘 · 展开查看` : "停泊库存充足");
  }
  const formationChange = (event: Event) => {
    if (!event.isTrusted || event.target !== formation || formation.disabled || busy) return;
    const current = session, context = current && currentContext(current);
    if (!current || !context) return;
    const selected = formation.value;
    retireChoice(current); retireReview(current);
    // The trusted event records a value only through original option nodes.
    // retireChoice clears the UI value; restore only an authenticated option.
    const option = formationOptions.find(value => value.value === selected);
    if (!option || option.retired || !optionNodesIntact() || Object.getOwnPropertyDescriptor(option.source as object, "ships")?.value !== option.ships || formationMark(option.source) !== option.mark) { controlsDisabled(); return; }
    const value = buildNpcRehearsalFormationCopy(context.formations, option.source, landedProjection(context));
    if (!value) { text(status, "编成已改变，请重新选择。"); controlsDisabled(); return; }
    formation.value = option.value; current.formation = { option, copy: value }; text(status, "已选择编成；点击填入演练数量，再显式运行。"); controlsDisabled();
  };
  const copyClick = (event: Event) => {
    if (!event.isTrusted || event.target !== copy || copy.disabled || busy) return;
    const current = session, context = current && currentContext(current), choice = current?.formation;
    if (!current || !context || !choice) return;
    const fail = () => { retireChoice(current); text(status, "编成或演练控件已改变，数量未填入；请重新选择。"); controlsDisabled(); };
    if (!choiceCurrent(current, context)) { fail(); return; }
    const value = buildNpcRehearsalFormationCopy(context.formations, choice.option.source, landedProjection(context));
    if (!value || JSON.stringify(value.origin) !== JSON.stringify(choice.copy.origin) || JSON.stringify(value.values) !== JSON.stringify(choice.copy.values)) { fail(); return; }
    const latest = currentContext(current);
    if (!latest || !choiceCurrent(current, latest)) { if (session === current) fail(); return; }
    const verified = buildNpcRehearsalFormationCopy(latest.formations, choice.option.source, landedProjection(latest));
    if (!verified || JSON.stringify(verified.origin) !== JSON.stringify(value.origin) || JSON.stringify(verified.values) !== JSON.stringify(value.values)
      || new Set(fields.map(field => field.input)).size !== NPC_REHEARSAL_FLYING_IDS.length
      || !inputValue?.get || !inputValue.set || !inputType?.get
      || Object.getOwnPropertyDescriptor(inputPrototype, "value")?.get !== inputValue.get || Object.getOwnPropertyDescriptor(inputPrototype, "value")?.set !== inputValue.set
      || Object.getOwnPropertyDescriptor(inputPrototype, "type")?.get !== inputType.get
      || fields.some(field => !(field.input instanceof HTMLInputElement) || Object.getPrototypeOf(field.input) !== inputPrototype
        || Object.hasOwn(field.input, "type") || inputType.get!.call(field.input) !== "number" || Object.hasOwn(field.input, "value") || field.input.id !== `npc-rehearsal-ship-${field.id}` || root.querySelectorAll(`#npc-rehearsal-ship-${field.id}`).length !== 1)) { fail(); return; }
    // All authority and all 13 destinations passed. Consume before any write.
    busy = true; current.formation = null; current.review = null;
    try { for (const field of fields) inputValue.set.call(field.input, verified.values[field.id]); }
    finally { busy = false; }
    retireChoice(current); retireReview(current);
    text(formationSource, `来自 #${verified.origin.id} ${verified.origin.name} · r${verified.origin.revision}`);
    text(status, "数量已填入；请核对停泊库存后显式运行。");
    busy = false; paintDeficits(latest); controlsDisabled();
  };
  function captureTech(context: NpcRehearsalContext) {
    const levels = context.completedTech, hyperspace = context.completedHyperspaceLevel;
    if (!TECH_KEYS.every(key => Number.isInteger(levels[key]) && levels[key] >= 0 && levels[key] <= 1000)
      || !Number.isInteger(hyperspace) || hyperspace < 0 || hyperspace > 1000) throw Error("已完成科技等级无效，无法演练。");
    return { tech: Object.freeze({ weapons: levels.weapons, shields: levels.shields, armour: levels.armour }), factor: 1 + .05 * hyperspace };
  }
  function reviewCurrent(current: Session, context: NpcRehearsalContext) {
    const review = current.review;
    if (!review || review.stale || review.fingerprint !== fingerprint()) return false;
    const tech = context.completedTech;
    return TECH_KEYS.every(key => tech[key] === review.result.attackerTech[key])
      && 1 + .05 * context.completedHyperspaceLevel === review.result.cargoFactor
      && available(context).every((count, index) => count === review.available[index]);
  }
  function paragraph(parent: HTMLElement, value: string, className = "") {
    const node = document.createElement("p"); node.className = className; node.textContent = value; parent.append(node); return node;
  }
  function showHistory() {
    const current = session;
    if (!current || !history.open || current.historyShown || !currentContext(current, false)) return;
    const snapshot = current.snapshot;
    paragraph(historyBody, current.registration.message.text);
    paragraph(historyBody, `模型 ${snapshot.model}；历史出发星球 ${snapshot.originId}；舰队 #${snapshot.fleetId}。`);
    paragraph(historyBody, `精确观察时间 ${snapshot.observedAt} 秒；目标 [${coordinates(snapshot.target)}]。历史情报，之后可能变化。`);
    paragraph(historyBody, `当时库存：${loot(snapshot.stock)}。当时驻军：${counts(snapshot.garrison)}。`);
    paragraph(historyBody, "NPC 当时武器 0 / 护盾 0 / 装甲 0。本页不会刷新或比对现在的 NPC 库存与驻军。");
    current.historyShown = true;
  }
  function renderResult(current: Session, review: Review) {
    results.replaceChildren(); results.hidden = false;
    const value = review.result;
    paragraph(results, NPC_REHEARSAL_WARNING, "muted");
    paragraph(results, `种子组 ${value.seedGroup} · 本次编成：${counts(value.selectedShips)} · 草稿速度 ${review.draft.speedPercent}%。`, "chip");
    paragraph(results, `运行时已完成科技：武器 ${value.attackerTech.weapons} / 护盾 ${value.attackerTech.shields} / 装甲 ${value.attackerTech.armour}；货舱倍率 ×${value.cargoFactor}。真实出征在派遣时冻结货舱倍率，在抵达时读取战斗科技，可能使用更新等级。`, "muted");
    for (const [index, sample] of value.samples.entries()) {
      const card = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("div");
      card.className = "ov-card npc-battle-report"; body.className = "npc-report-details";
      const lost = Object.values(losses(sample)).reduce((sum, count) => sum + count, 0);
      summary.textContent = `公开示例 ${index + 1} · ${outcome(sample)} · ${sample.battle.rounds.length} 回合 · 永久损失 ${lost} 艘 · 历史可能装载：${loot(sample.loot)}`;
      card.append(summary, body); results.append(card);
      for (const node of [card, summary, body]) { review.nodes.push(node); watch(node); }
      let populated = false;
      card.addEventListener("toggle", () => {
        if (!card.open || populated || session !== current || current.review !== review || !currentContext(current, false) || !results.contains(card)) return;
        paragraph(body, `公开种子 ${sample.seed}；${value.seedGroup}；战斗模型 ${sample.battle.mode}。`);
        paragraph(body, `我方永久损失：${counts(losses(sample))}；幸存：${counts(sample.battle.attackerAfter)}。NPC 剩余：${counts(sample.battle.defenderAfter)}。`);
        const rounds = document.createElement("details"), heading = document.createElement("summary"), scroll = document.createElement("div");
        heading.textContent = "逐回合精确数据"; scroll.className = "space-table-scroll"; scroll.tabIndex = 0;
        scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", `公开示例 ${index + 1} 的回合数据，可横向滚动`);
        rounds.append(heading, scroll); body.append(rounds);
        for (const node of [rounds, heading, scroll]) { review.nodes.push(node); watch(node); }
        let roundsShown = false;
        rounds.addEventListener("toggle", () => {
          if (!rounds.open || roundsShown || !card.open || session !== current || current.review !== review || !currentContext(current, false) || !results.contains(rounds)) return;
          if (!sample.battle.rounds.length) paragraph(scroll, "无驻军收集，本例没有战斗回合。");
          else {
            const table = document.createElement("table"); table.className = "ov-table npc-round-table";
            const header = document.createElement("tr");
            for (const label of ["回合", "我方剩余", "NPC 剩余", "我方输出", "NPC 输出"]) { const cell = document.createElement("th"); cell.textContent = label; header.append(cell); }
            const head = document.createElement("thead"), tbody = document.createElement("tbody"); head.append(header); table.append(head, tbody);
            for (const round of sample.battle.rounds) {
              const row = document.createElement("tr");
              for (const number of [round.round, round.attacker, round.defender, round.attackDamage, round.defendDamage]) { const cell = document.createElement("td"); cell.textContent = String(number); row.append(cell); }
              tbody.append(row);
            }
            scroll.append(table);
          }
          roundsShown = true;
        });
        populated = true;
      });
    }
  }
  function observe() {
    if (!intact()) return;
    const context = host.readContext();
    if (previousWorld !== null && (previousWorld !== context.adoptedWorld || previousOrigin !== context.origin.id || previousWritable !== context.writable)) invalidate(context.protectionReason || RETIRED);
    previousWorld = context.adoptedWorld; previousOrigin = context.origin.id; previousWritable = context.writable;
    const messages = new Set(context.messages);
    for (const registration of live) if (!retained(registration, context, messages)) {
      registration.retired = true; registration.button.disabled = true; live.delete(registration); watchDirty = true;
      if (session?.registration === registration) abandon();
    }
    const current = session;
    if (!current) { controlsDisabled(); return; }
    if (!visible()) { abandon(); return; }
    if (!currentContext(current, false)) return;
    text(origin, `当前所选星球：${context.origin.name} [${coordinates(context.origin.coordinates)}] → 历史目标 [${coordinates(current.snapshot.target)}]`);
    for (const field of fields) { const stock = context.landedShips[field.id] ?? 0; text(field.available, `可用 ${stock}`); field.input.max = String(MAX_SHIPS); }
    refreshFormations(context);
    if (current.formation && !choiceCurrent(current, context)) retireChoice(current);
    paintDeficits(context);
    const review = current.review;
    if (review && !reviewCurrent(current, context)) {
      review.stale = true; text(status, "当前库存或已完成科技已改变；以上仍是原输入的历史示例。请重新运行后再填入。");
    } else if (review && context.writable) {
      text(status, review.quote.ok ? "上次核对时可填入空载草稿；点击填入仍会重新核对。尚未派遣或付款。" : `演练可查看；上次核对时攻击草稿不可填入：${review.quote.reason}；可显式重新核对出征条件。`);
    } else if (!context.writable) text(status, context.protectionReason || "存档受保护，仅可阅读历史情报。");
    controlsDisabled();
  }
  function open(registration: Registration, event: Event) {
    if (!event.isTrusted || event.target !== registration.button || !intact() || document.hidden || messagesPanel.hidden || registration.button.disabled) return;
    observe();
    const context = host.readContext();
    if (!registration.button.isConnected || !messagesPanel.contains(registration.button) || !retained(registration, context)) return;
    abandon(); panel.hidden = false;
    // Drain our own hide/show records before creating a new session.
    removed(observer.takeRecords());
    if (mountRetired || disposed) return;
    for (const field of fields) field.input.value = "0";
    speed.value = "100";
    session = { registration, originId: context.origin.id, world: context.adoptedWorld, snapshot: registration.snapshot, historyShown: false, review: null, formation: null };
    refreshFormations(context, true);
    text(source, `历史情报，之后可能变化 · 侦察抵达时间 ${registration.snapshot.observedAt} 秒 · ${registration.snapshot.model}`);
    text(status, context.writable ? "选择当前停泊舰船，再显式运行三个公开种子示例。" : context.protectionReason || "存档受保护，仅可阅读历史情报。");
    observe(); title.focus();
  }
  const edit = (event: Event) => {
    if (!fields.some(field => field.input === event.target) && event.target !== speed) return;
    const current = session;
    if (!current || !currentContext(current)) return;
    if (fields.some(field => field.input === event.target)) {
      text(formationSource, formationSource.textContent ? "数量已手改" : "");
      paintDeficits(host.readContext());
    }
    if (current.review?.fingerprint !== fingerprint()) {
      retireReview(current);
      text(status, "编成或速度已改变；请显式重新运行。"); controlsDisabled();
    }
  };
  const runClick = (event: Event) => {
    if (!event.isTrusted || event.target !== run || run.disabled || busy) return;
    const current = session, context = current && currentContext(current);
    if (!current || !context) return;
    const key = fingerprint();
    let errorNotice = "";
    busy = true; controlsDisabled();
    try {
      if (current.review && reviewCurrent(current, context)) {
        current.review.quote = host.quoteAttack(current.review.draft);
        return;
      }
      const ships = readNpcRehearsalSelection(Object.fromEntries(fields.map(field => [field.id, field.input.value])), context.landedShips);
      const speedPercent = Number(speed.value);
      if (!/^(?:[1-9]0|100)$/.test(speed.value)) throw Error("草稿速度须为 10% 至 100% 的整十档位。");
      const captured = captureTech(context), stock = Object.freeze(available(context));
      const draft: NpcRehearsalDraft = Object.freeze({ originId: current.originId, mission: "attack", target: Object.freeze({ ...current.snapshot.target }), ships, speedPercent, cargo: Object.freeze({ metal: 0, crystal: 0, deuterium: 0 }) });
      const result = rehearseNpcScout(current.snapshot, ships, captured.tech, captured.factor);
      const latest = currentContext(current);
      if (!latest || key !== fingerprint()) return;
      const review: Review = { result, draft, fingerprint: key, available: stock, nodes: [], stale: false, quote: { ok: false, reason: "尚未校验当前攻击条件。" } };
      // Replacing a stale review must release observers/listeners retaining its
      // old detached result tree, even when no input edit preceded this Run.
      watchDirty = true; current.review = review;
      if (!reviewCurrent(current, latest)) review.stale = true;
      else review.quote = host.quoteAttack(draft);
      if (session === current) renderResult(current, review);
    } catch (error) { errorNotice = error instanceof Error ? error.message : "演练输入无效。"; }
    finally { busy = false; if (session === current) { observe(); if (errorNotice) text(status, errorNotice); } }
  };
  const fillClick = (event: Event) => {
    if (!event.isTrusted || event.target !== fill || fill.disabled || busy) return;
    const current = session, context = current && currentContext(current), review = current?.review;
    if (!current || !context || !review || !reviewCurrent(current, context)) { observe(); return; }
    const fresh = host.quoteAttack(review.draft);
    review.quote = fresh;
    if (!fresh.ok) { text(status, fresh.reason); controlsDisabled(); return; }
    let liveCall = true, consumed = false, accepted = false;
    busy = true; controlsDisabled();
    try {
      const result = host.fillDraft(review.draft, () => {
        if (!liveCall || consumed) return false;
        consumed = true;
        const latest = currentContext(current);
        accepted = !!latest && current.review === review && reviewCurrent(current, latest) && host.quoteAttack(review.draft).ok;
        return accepted;
      });
      if (result.ok && accepted) {
        // Navigating may already have retired this panel. Never report payment.
        if (session === current) abandon("仅已填入，尚未派遣或付款。");
      } else if (session === current) text(status, result.reason || "草稿未填入；请重新检查当前条件。");
    } catch { if (session === current) text(status, "草稿未填入；当前控件校验失败，请重新打开演练。");
    } finally { liveCall = false; busy = false; if (session === current) controlsDisabled(); }
  };
  const cancelClick = (event: Event) => { if (event.isTrusted && event.target === cancel && intact()) abandon(RETIRED, true); };
  const keydown = (event: KeyboardEvent) => { if (event.isTrusted && event.key === "Escape" && session && panel.contains(event.target as Node)) { event.preventDefault(); abandon(RETIRED, true); } };
  const hidden = () => { if (document.hidden) abandon(); };
  const back = () => abandon();
  root.addEventListener("input", edit); root.addEventListener("change", edit); root.addEventListener("keydown", keydown);
  formation.addEventListener("change", formationChange); copy.addEventListener("click", copyClick);
  run.addEventListener("click", runClick); fill.addEventListener("click", fillClick); cancel.addEventListener("click", cancelClick);
  history.addEventListener("toggle", showHistory); document.addEventListener("visibilitychange", hidden); window.addEventListener("popstate", back);
  controlsDisabled();
  return {
    observe,
    /** Register each freshly rendered retained message button once. A clone or
     * a detached/reinserted old node cannot acquire this registration again. */
    registerReport(button: HTMLButtonElement, message: FleetMessage): boolean {
      if (registrations.has(button) || !intact() || !button.isConnected || !messagesPanel.contains(button)) return false;
      const context = host.readContext(), snapshot = message.npcScoutSnapshot;
      if (!snapshot || !context.messages.includes(message)) { button.disabled = true; button.title = NPC_REHEARSAL_UNAVAILABLE; return false; }
      const registration: Registration = { button, message, snapshot, world: context.adoptedWorld, retired: false };
      registrations.set(button, registration); live.add(registration); watch(button); button.disabled = false;
      button.addEventListener("click", event => open(registration, event)); return true;
    },
    close() { abandon(RETIRED, true); },
    invalidate,
    dispose() {
      invalidate(); disposed = true; observer.disconnect(); watched.clear();
      root.removeEventListener("input", edit); root.removeEventListener("change", edit); root.removeEventListener("keydown", keydown);
      formation.removeEventListener("change", formationChange); copy.removeEventListener("click", copyClick);
      run.removeEventListener("click", runClick); fill.removeEventListener("click", fillClick); cancel.removeEventListener("click", cancelClick);
      history.removeEventListener("toggle", showHistory); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("popstate", back);
    },
  };
}
