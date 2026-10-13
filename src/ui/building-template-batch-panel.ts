import { buildingById, type BuildingId } from "../data/buildings";
import { buildingTemplateBatchAuthorityKey, quoteBuildingTemplateBatch } from "../game/building-template-batch";
import { hasBuildingTemplateBatchFields, normalizeBuildingTemplateBatchRequest, type BuildingTemplateBatchAction, type BuildingTemplateBatchRequest, type BuildingTemplateBatchQuote } from "../game/building-template-batch-state";
import type { BuildingTemplate } from "../game/building-template-state";
import { isOrderMoney } from "../game/order-ledger";
import type { OrderMoney } from "../game/order-state";
import type { GameState } from "../game/types";
import { BUILDING_TEMPLATE_RESOURCES, buildingTemplateBudgetText, buildingTemplateContextText, buildingTemplateMoney, buildingTemplateRowText } from "./building-templates-present";
import { buildingTemplateBatchBudgetTotals, buildingTemplateBatchGapText, buildingTemplateBatchPlanetText } from "./building-template-batch-present";
import "./building-template-batch.css";

type ActionName = "fill-quotes" | "review" | "apply" | "cancel-review" | "clear";
const button = (action: ActionName, label: string) => `<button type="button" id="building-template-batch-${action}" data-building-template-batch-action="${action}" disabled>${label}</button>`;
export function buildingTemplateBatchPanelHtml(): string {
  return `<details id="building-template-batch" class="building-template-batch"><summary>建筑模板 · 2–4 星球一次应用</summary>
    <p class="muted">选择已保存的建筑目标，再明确勾选 2–4 个现有星球。每星固定本地付款 / 执行，整批成功或整批不创建；不运输、不补前置、不自动续开。</p>
    <p id="building-template-batch-status" role="status" aria-live="polite"></p>
    <label class="batch-template-label">已保存模板<select id="building-template-batch-template" disabled><option value="">请明确选择模板</option></select></label>
    <p id="building-template-batch-selection" class="muted">尚未选择星球（需 2–4 个）。</p>
    <div id="building-template-batch-planets" class="batch-planet-choices"></div>
    <p class="muted">逐星、逐建筑、逐资源独立预算，默认 0。顶部切星不会改选定星球或预算；已有队列与计划保留原付款和授权。</p>
    <div id="building-template-batch-budgets" class="batch-budgets"></div>
    <div class="batch-actions">${button("fill-quotes", "按当前报价填写独立预算")}${button("review", "核对本次整批应用")}${button("clear", "清空本次选择")}</div>
    <section id="building-template-batch-review-panel" hidden><h3>本次整批核对</h3>
      <p id="building-template-batch-review-summary"></p><p id="building-template-batch-total-budget"></p>
      <p>固定上限，逐星实际入队时付款；登记不扣款。各项额度不共享、不自动追加，资源或预算不足时等待。</p>
      <div id="building-template-batch-review-planets" class="batch-review-planets"></div>
      <div class="batch-actions">${button("apply", "确认整批登记有限计划")}${button("cancel-review", "取消本次核对")}</div>
    </section></details>`;
}

type Choice = { planetId: string; input: HTMLInputElement; label: HTMLLabelElement };
type BudgetField = { planetId: string; building: BuildingId; field: HTMLFieldSetElement; inputs: Record<keyof OrderMoney, HTMLInputElement> };
type Review = { request: BuildingTemplateBatchRequest; authorityKey: string; draftKey: string; generation: number; activePlanetId: string };
type Dispatch = { action: BuildingTemplateBatchAction; generation: number; retirement: number; draftKey: string; authorityKey: string; requestKey: string; activePlanetId: string; universe: GameState["universe"] };

/** A separate ephemeral application. Only explicit fill/review operations price levels.
 * Host: observe even when hidden; invalidate before import/reset/curvature intent;
 * synchronously consume the exact emitted action before invoking the domain action. */
export function installBuildingTemplateBatchPanel(root: HTMLElement, onAction: (action: BuildingTemplateBatchAction) => void) {
  function get<T extends HTMLElement = HTMLElement>(id: string): T {
    const value = root.querySelector<T>(`#building-template-batch${id ? `-${id}` : ""}`);
    if (!value) throw new Error(`缺少多星建筑模板控件 ${id}`);
    return value;
  }
  const panel = get<HTMLDetailsElement>(""), select = get<HTMLSelectElement>("template"), status = get("status"), selectionText = get("selection");
  const planets = get("planets"), budgets = get("budgets"), reviewPanel = get("review-panel"), reviewSummary = get("review-summary");
  const totalBudget = get("total-budget"), reviewPlanets = get("review-planets");
  const mounted = [panel, select, status, selectionText, planets, budgets, reviewPanel, reviewSummary, totalBudget, reviewPlanets];
  const names: ActionName[] = ["fill-quotes", "review", "apply", "cancel-review", "clear"];
  const controls = new Map<ActionName, HTMLButtonElement>();
  const registrations = new WeakMap<HTMLButtonElement, { action: ActionName; generation: number }>();
  for (const name of names) { const node = get<HTMLButtonElement>(name); controls.set(name, node); registrations.set(node, {action:name, generation:0}); }
  let latest: GameState | null = null, ready = false, generation = 0, retirement = 0, disposed = false, mountRetired = false;
  let selected: { id: number; revision: number; snapshot: string } | null = null;
  let choices: Choice[] = [], fields: BudgetField[] = [], optionBindings = new Map<HTMLOptionElement, { id: number; revision: number }>();
  let selectedPlanets: string[] = [], review: Review | null = null, pending: Dispatch | null = null;
  let templateSignature = "", planetSignature = "", lastAuthority = "", lastActive = "", worldToken: unknown = undefined;
  let universe: GameState["universe"] | null = null;
  let draining = false;
  const watched = new Set<Node>();
  function text(node: HTMLElement, value: string) { if (node.textContent !== value) node.textContent = value; }
  function originalTemplate(): BuildingTemplate | null {
    const template = selected && latest?.buildingTemplates.templates.find(value => value.id === selected!.id);
    return template && template.revision === selected!.revision && JSON.stringify(template) === selected!.snapshot ? template : null;
  }
  function visible(checkStyle = false): boolean {
    if (document.hidden || !panel.open) return false;
    for (let node: HTMLElement | null = panel; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true" || node.style.display === "none" || node.style.visibility === "hidden") return false;
      if (checkStyle) { const style = window.getComputedStyle(node); if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false; }
    }
    return true;
  }
  function mountedNow(): boolean {
    return !disposed && !mountRetired && root.isConnected && mounted.every(node => node.isConnected && root.contains(node) && root.querySelector(`#${node.id}`) === node)
      && names.every(name => { const node = controls.get(name)!; return node.isConnected && panel.contains(node) && root.querySelector(`#${node.id}`) === node; });
  }
  function syncDisabled() {
    const usable = ready && mountedNow();
    select.disabled = !usable;
    for (const choice of choices) choice.input.disabled = !usable || !selected || (selectedPlanets.length >= 4 && !selectedPlanets.includes(choice.planetId));
    for (const field of fields) for (const [resource] of BUILDING_TEMPLATE_RESOURCES) field.inputs[resource].disabled = !usable || !selected;
    for (const name of names) {
      const node = controls.get(name)!;
      node.disabled = !usable || (name === "apply" ? !review : name === "cancel-review" ? reviewPanel.hidden
        : name === "clear" ? !selected && !selectedPlanets.length : !selected || selectedPlanets.length < 2 || selectedPlanets.length > 4);
    }
  }
  function watchAncestors() {
    for (let node: Node | null = panel.parentNode; node; node = node.parentNode) if (!watched.has(node)) {
      observer.observe(node, { childList:true, attributes:true, attributeOldValue:true, attributeFilter:["hidden", "style", "class", "aria-hidden", "open"] }); watched.add(node);
    }
  }
  function records(values: MutationRecord[]) {
    if (draining || disposed || mountRetired || !values.length) return;
    let reviewChanged = false, draftChanged = false;
    for (const record of values) {
      if (record.type === "attributes") {
        const node = record.target;
        // Opening folded per-planet details is display-only. Closing the outer
        // section, filtering/hiding, or styling an authorization region retires it.
        if (record.attributeName === "open") {
          if (node === panel && record.oldValue !== null) reviewChanged = true;
        } else if (node instanceof Element && node.getAttribute(record.attributeName!) !== record.oldValue) reviewChanged = true;
      }
      for (const removed of record.removedNodes) if (removed instanceof Element) {
        if (mounted.some(node => removed === node || removed.contains(node))
          || [...controls.values()].some(node => removed === node || removed.contains(node))) { mountRetired = true; break; }
        if (choices.some(choice => removed === choice.input || removed.contains(choice.input)) || fields.some(field => removed === field.field || removed.contains(field.field)
          || BUILDING_TEMPLATE_RESOURCES.some(([id]) => removed === field.inputs[id] || removed.contains(field.inputs[id])))
          || [...optionBindings.keys()].some(option => removed === option || removed.contains(option))) draftChanged = true;
        if (reviewPlanets.contains(record.target)) reviewChanged = true;
      }
    }
    draining = true;
    if (mountRetired) { pending = null; review = null; selected = null; ready = false; text(status, "操作区域已被替换，请重新载入页面后选择。"); syncDisabled(); observer.disconnect(); }
    else if (draftChanged) clearSelection("选择或预算控件已替换，请重新选择模板和星球。");
    else if (reviewChanged) retireReview("查看区域已关闭、隐藏或改变，请重新核对。");
    observer.takeRecords(); draining = false;
  }
  const observer = new MutationObserver(records);
  observer.observe(panel, { childList:true, subtree:true, attributes:true, attributeOldValue:true, attributeFilter:["hidden", "style", "class", "aria-hidden", "open"] });
  watchAncestors();
  function drain() { records(observer.takeRecords()); }
  /** Internal projection cannot accidentally turn its own removed nodes into a new capability. */
  function project(run: () => void) {
    drain(); const wasDraining = draining; draining = true;
    try { run(); } finally { observer.takeRecords(); draining = wasDraining; }
  }
  function freshConfirm() {
    const old = controls.get("apply")!;
    registrations.delete(old);
    const fresh = old.cloneNode(true) as HTMLButtonElement;
    fresh.disabled = true; old.replaceWith(fresh); controls.set("apply", fresh);
    registrations.set(fresh, {action:"apply", generation});
  }
  function retireReview(reason?: string) {
    const hadReview = !!review || !reviewPanel.hidden;
    retirement++; pending = null; review = null;
    project(() => { if (hadReview && !mountRetired) freshConfirm(); reviewPanel.hidden = true; });
    if (reason && hadReview) text(status, reason);
    syncDisabled();
  }
  function clearSelection(reason?: string) {
    retireReview(); selected = null; selectedPlanets = []; fields = []; lastAuthority = "";
    project(() => { select.value = ""; for (const choice of choices) choice.input.checked = false; budgets.replaceChildren(); });
    text(selectionText, "尚未选择星球（需 2–4 个）。");
    if (reason) text(status, reason); syncDisabled();
  }
  function draftKey(): string {
    return JSON.stringify([select.value, choices.map(choice => [choice.planetId, choice.input.checked]), fields.map(field => [field.planetId, field.building,
      ...BUILDING_TEMPLATE_RESOURCES.map(([id]) => field.inputs[id].value)])]);
  }
  function draftIntact(): boolean {
    const option = select.options[select.selectedIndex];
    const binding = option && optionBindings.get(option);
    return !!selected && !!binding && binding.id === selected.id && binding.revision === selected.revision && select.value === String(selected.id)
      && choices.every(choice => choice.input.isConnected && planets.contains(choice.label) && choice.label.contains(choice.input)
        && choice.input.checked === selectedPlanets.includes(choice.planetId))
      && fields.every(field => field.field.isConnected && budgets.contains(field.field) && BUILDING_TEMPLATE_RESOURCES.every(([id]) => field.field.contains(field.inputs[id]) && field.inputs[id].isConnected));
  }
  function authority(): string {
    return latest && selected && selectedPlanets.length >= 2 && selectedPlanets.length <= 4
      ? buildingTemplateBatchAuthorityKey(latest, selected.id, selectedPlanets) : "";
  }
  function refreshAuthority() {
    drain();
    if (!mountedNow() || !latest) return;
    if (selected && (!originalTemplate() || !draftIntact() || selectedPlanets.some(id => !latest!.planets.some(planet => planet.id === id)))) {
      clearSelection("模板、星球或草稿身份已改变，请明确重新选择。"); return;
    }
    const key = authority();
    if (review && (!visible() || review.generation !== generation || review.authorityKey !== key || review.activePlanetId !== latest.activePlanetId || review.draftKey !== draftKey())) {
      retireReview("星球、目标、预算、队列或计划状态已改变，请重新核对。");
    }
    if (key !== lastAuthority) { if (review) retireReview("执行条件已改变，请重新核对。"); lastAuthority = key; }
  }
  function addText(parent: HTMLElement, tag: string, value: string, className = "") {
    const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; parent.append(node); return node;
  }
  function renderBudgets(preserve: boolean) {
    const template = originalTemplate();
    const prior = preserve ? new Map(fields.map(field => [`${field.planetId}:${field.building}`, readBudget(field)])) : new Map<string, OrderMoney>();
    fields = [];
    project(() => {
      budgets.replaceChildren();
      if (!template || !latest) return;
      for (const planetId of selectedPlanets) {
        const group = document.createElement("details"); group.className = "batch-budget-planet"; group.dataset.batchBudgetPlanet = planetId;
        addText(group, "summary", `${buildingTemplateBatchPlanetText(latest, planetId)} · ${template.goals.length} 项独立预算`);
        for (const goal of template.goals) {
          const field = document.createElement("fieldset"); field.dataset.batchBudgetBuilding = goal.building;
          addText(field, "legend", `${buildingById(goal.building).nameZh} → ${goal.targetLevel} 级`);
          const inputs = {} as BudgetField["inputs"], row = document.createElement("div"); row.className = "batch-budget-resources";
          for (const [id, label] of BUILDING_TEMPLATE_RESOURCES) {
            const holder = document.createElement("label"), input = document.createElement("input"); holder.textContent = label;
            input.type = "text"; input.inputMode = "decimal"; input.maxLength = 256; input.autocomplete = "off";
            input.value = prior.get(`${planetId}:${goal.building}`)?.[id] ?? "0";
            input.dataset.batchBudgetResource = id; input.setAttribute("aria-label", `${buildingTemplateBatchPlanetText(latest, planetId)} ${buildingById(goal.building).nameZh}${label}预算`);
            holder.append(input); row.append(holder); inputs[id] = input;
          }
          field.append(row); group.append(field); fields.push({planetId, building:goal.building, field, inputs});
        }
        budgets.append(group);
      }
    });
    text(selectionText, selectedPlanets.length ? `已明确选择 ${selectedPlanets.length} / 4 个星球；至少选择 2 个。` : "尚未选择星球（需 2–4 个）。");
    syncDisabled();
  }
  function readBudget(field: BudgetField): OrderMoney {
    return Object.fromEntries(BUILDING_TEMPLATE_RESOURCES.map(([id]) => [id, field.inputs[id].value.trim()])) as OrderMoney;
  }
  function budgetFor(planetId: string, building: BuildingId): OrderMoney {
    const field = fields.find(value => value.planetId === planetId && value.building === building);
    return field ? readBudget(field) : {metal:"", crystal:"", deuterium:""};
  }
  function renderQuote(quote: BuildingTemplateBatchQuote) {
    if (!latest) return;
    const state = latest;
    const all = quote.planets.flatMap(planet => planet.quote.rows.filter(row => row.status === "new").map(row => ({quote:row.quote, budget:budgetFor(planet.planetId, row.building)})));
    const totals = buildingTemplateBatchBudgetTotals(all);
    project(() => {
      reviewPlanets.replaceChildren();
      text(reviewSummary, `${quote.planets.length} 个固定付款 / 执行星球 · 新增 ${quote.newCount} 个有限计划。${quote.newCount === 0 ? "全部已达到或被原计划覆盖：本次为零操作，不创建、不付款、不改原计划。" : "任何星球有冲突或整批容量不足，均不创建。"}${quote.totalQuote ? ` 当前未付总报价：${buildingTemplateMoney(quote.totalQuote)}。` : " 当前报价无法精确表示。"}${quote.blockers.length ? ` ${quote.blockers.join("；")}` : ""}`);
      text(totalBudget, totals.budget ? `本批新增项授权总预算：${buildingTemplateMoney(totals.budget)}。` : "本批预算无效：请修正每项非负精确金额。");
      for (const planet of quote.planets) {
        const group = document.createElement("article"); group.className = "batch-review-planet"; group.dataset.batchReviewPlanet = planet.planetId;
        addText(group, "h4", buildingTemplateBatchPlanetText(state, planet.planetId));
        const rows = planet.quote.rows.filter(row => row.status === "new").map(row => ({quote:row.quote, budget:budgetFor(planet.planetId, row.building)}));
        const sum = buildingTemplateBatchBudgetTotals(rows);
        addText(group, "p", `新增 ${planet.quote.newCount} 项；当前未付报价：${planet.quote.totalQuote ? buildingTemplateMoney(planet.quote.totalQuote) : "无法精确表示"}。`);
        addText(group, "p", `本星新增项独立预算合计：${sum.budget ? buildingTemplateMoney(sum.budget) : "无效"}。${buildingTemplateBatchGapText(sum.shortfall)}`);
        const details = document.createElement("details"); addText(details, "summary", "目标、原有付款与逐项预算详情");
        addText(details, "p", buildingTemplateContextText(state, planet.quote));
        for (const row of planet.quote.rows) {
          const item = document.createElement("div"); item.className = "batch-review-row"; item.dataset.batchReviewBuilding = row.building;
          addText(item, "p", buildingTemplateRowText(state, row));
          if (row.status === "new") {
            const budget = budgetFor(planet.planetId, row.building);
            addText(item, "p", `当前未付报价：${row.quote ? buildingTemplateMoney(row.quote) : "无法精确表示"}；独立授权预算：${buildingTemplateMoney(budget)}。`);
            addText(item, "p", buildingTemplateBudgetText(row.quote, budget));
          }
          details.append(item);
        }
        group.append(details); reviewPlanets.append(group);
      }
      reviewPanel.hidden = false;
    });
  }
  function makeReview(fill: boolean) {
    refreshAuthority();
    if (!latest || !ready || !mountedNow() || !visible() || !selected || !draftIntact() || selectedPlanets.length < 2 || selectedPlanets.length > 4) return;
    retireReview();
    // Exactly this explicit operation prices the bounded 2–4 planet selection.
    const quote = quoteBuildingTemplateBatch(latest, selected.id, selectedPlanets);
    if (fill) {
      for (const planet of quote.planets) for (const row of planet.quote.rows) if (row.status === "new" && row.quote) {
        const field = fields.find(value => value.planetId === planet.planetId && value.building === row.building);
        if (field) for (const [id] of BUILDING_TEMPLATE_RESOURCES) field.inputs[id].value = row.quote[id];
      }
      text(status, `已明确填写各新增项的当前报价；请重新核对后确认。${quote.blockers.join("；")}`); syncDisabled(); return;
    }
    renderQuote(quote);
    const entries = quote.planets.map(planet => ({planetId:planet.planetId, budgets:planet.quote.rows.filter(row => row.status === "new").map(row => ({building:row.building, budget:budgetFor(planet.planetId, row.building)}))}));
    const validBudgets = entries.every(planet => planet.budgets.every(entry => isOrderMoney(entry.budget)));
    if (quote.ok && validBudgets) review = {generation, authorityKey:quote.authorityKey, draftKey:draftKey(), activePlanetId:latest.activePlanetId, request:{
      templateId:selected.id, expectedTemplateRevision:quote.templateRevision, expectedNextTaskId:quote.nextTaskId, expectedReviewKey:quote.reviewKey, planets:entries,
    }};
    text(controls.get("apply")!, quote.newCount ? `确认整批登记 ${quote.newCount} 个有限计划` : "确认零操作（不创建计划）");
    text(status, !validBudgets ? "预算无效，请填写非负精确金额后重新核对。" : quote.ok ? "请核对总预算与每星缺口；本次确认仅可使用一次。" : quote.reason);
    lastAuthority = authority(); syncDisabled();
  }
  function renderChoices(state: GameState) {
    const templatesKey = JSON.stringify(state.buildingTemplates.templates);
    const planetsKey = JSON.stringify(state.planets.map(planet => [planet.id, planet.name, planet.coordinates]));
    if (templatesKey !== templateSignature) {
      retireReview("模板列表已改变，请重新核对。");
      project(() => {
        select.replaceChildren(); optionBindings = new Map();
        const none = document.createElement("option"); none.value = ""; none.textContent = "请明确选择模板"; select.append(none);
        for (const template of state.buildingTemplates.templates) {
          const option = document.createElement("option"); option.value = String(template.id); option.textContent = `#${template.id} ${template.name} · 修订 ${template.revision}`;
          optionBindings.set(option, {id:template.id, revision:template.revision}); select.append(option);
        }
        select.value = selected ? String(selected.id) : "";
      }); templateSignature = templatesKey;
    }
    if (planetsKey !== planetSignature) {
      retireReview("星球列表已改变，请重新核对。");
      project(() => {
        planets.replaceChildren(); choices = [];
        for (const planet of state.planets) {
          const label = document.createElement("label"), input = document.createElement("input"), caption = document.createElement("span");
          label.className = "batch-planet-choice"; input.type = "checkbox"; input.dataset.batchPlanet = planet.id; input.checked = selectedPlanets.includes(planet.id);
          caption.textContent = buildingTemplateBatchPlanetText(state, planet.id); label.append(input, caption); planets.append(label); choices.push({planetId:planet.id, input, label});
        }
      }); planetSignature = planetsKey;
    }
    if (!state.buildingTemplates.templates.length) text(status, "尚无已保存模板；请先在上方建筑意图模板中保存目标。");
  }
  function observe(state: GameState, writable: boolean) {
    drain();
    const protectedNow = ready && !writable, worldChanged = universe !== null && universe !== state.universe;
    const activeChanged = lastActive !== "" && lastActive !== state.activePlanetId;
    latest = state; ready = writable; lastActive = state.activePlanetId; universe = state.universe;
    if (worldChanged || protectedNow) clearSelection(worldChanged ? "世界已改变，旧选择与核对失效。" : "存档已进入保护状态，旧选择与核对失效。");
    else if (activeChanged) retireReview("顶部星球已切换；明确选择与预算保持，请重新核对。");
    refreshAuthority(); syncDisabled();
  }
  function authorized(node: HTMLButtonElement | null): ActionName | null {
    // Checkbox pre-activation toggles checked before its input/change events.
    // Ignore non-action clicks until those events update the explicit selection.
    if (!node) return null;
    refreshAuthority();
    if (!ready || !mountedNow() || !visible(true) || node.disabled || !node.isConnected || !panel.contains(node)) return null;
    const registration = registrations.get(node);
    return registration && registration.generation === generation && controls.get(registration.action) === node && node.dataset.buildingTemplateBatchAction === registration.action ? registration.action : null;
  }
  function click(event: Event) {
    const node = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-building-template-batch-action]") : null;
    const action = authorized(node);
    if (!action || !latest) return;
    if (action === "clear") clearSelection("已清空本次选择与预算。");
    else if (action === "cancel-review") retireReview("已取消核对；再次应用需重新核对。");
    else if (action === "fill-quotes" || action === "review") makeReview(action === "fill-quotes");
    else if (action === "apply" && review) {
      const approved = review;
      const request = normalizeBuildingTemplateBatchRequest(approved.request);
      if (!request) { retireReview("核对请求无效，请重新核对。"); return; }
      const dispatch: BuildingTemplateBatchAction = {type:"building-template-batch-apply", request};
      retireReview("本次确认已提交，重复点击不会再次创建。");
      pending = {action:dispatch, generation, retirement, draftKey:approved.draftKey, authorityKey:approved.authorityKey, requestKey:JSON.stringify(dispatch.request), activePlanetId:approved.activePlanetId, universe:latest.universe};
      try { onAction(dispatch); } finally { pending = null; }
    }
  }
  function edited(event: Event) {
    drain();
    if (!ready || !latest || !mountedNow() || !visible()) return;
    if (event.target === select) {
      const option = select.options[select.selectedIndex], binding = option && optionBindings.get(option);
      const template = binding && latest.buildingTemplates.templates.find(value => value.id === binding.id && value.revision === binding.revision);
      clearSelection();
      if (template && option.value === String(template.id)) {
        selected = {id:template.id, revision:template.revision, snapshot:JSON.stringify(template)}; select.value = String(template.id);
        text(status, "请明确勾选 2–4 个星球，再填写或查看各项独立预算。");
      }
      syncDisabled(); return;
    }
    const choice = choices.find(value => value.input === event.target);
    if (choice) {
      retireReview();
      if (!selected || !originalTemplate() || choice.input.disabled) { choice.input.checked = selectedPlanets.includes(choice.planetId); return; }
      if (choice.input.checked && !selectedPlanets.includes(choice.planetId)) {
        if (selectedPlanets.length >= 4) { choice.input.checked = false; return; }
        selectedPlanets.push(choice.planetId);
      } else if (!choice.input.checked) selectedPlanets = selectedPlanets.filter(id => id !== choice.planetId);
      renderBudgets(true); lastAuthority = authority(); return;
    }
    if (fields.some(field => BUILDING_TEMPLATE_RESOURCES.some(([id]) => field.inputs[id] === event.target))) { retireReview(); syncDisabled(); }
  }
  const hidden = () => { if (document.hidden) retireReview("页面已进入后台，请重新核对。"); };
  function invalidateAuthority() {
    generation++; pending = null; clearSelection("世界或存档操作已开始，旧选择与核对失效。请明确重新选择。");
    project(() => { for (const name of names) {
      const old = controls.get(name)!; registrations.delete(old); const fresh = old.cloneNode(true) as HTMLButtonElement;
      fresh.disabled = true; old.replaceWith(fresh); controls.set(name, fresh); registrations.set(fresh, {action:name, generation});
    } }); latest = null; ready = false; universe = null; lastActive = ""; syncDisabled();
  }
  panel.addEventListener("click", click); panel.addEventListener("change", edited); panel.addEventListener("input", edited); document.addEventListener("visibilitychange", hidden);
  return {
    observe, observeContext:observe,
    update(state: GameState, writable: boolean) { observe(state, writable); if (!mountedNow()) return; renderChoices(state); refreshAuthority(); syncDisabled(); },
    retireReview,
    completeAction(reason: string, _ok: boolean) { text(status, reason); syncDisabled(); },
    consume(action: BuildingTemplateBatchAction, state: GameState): boolean {
      const token = pending; pending = null; drain();
      if (!token || token.action !== action || !hasBuildingTemplateBatchFields(action, ["type", "request"]) || action.type !== "building-template-batch-apply") return false;
      const request = normalizeBuildingTemplateBatchRequest(action.request);
      return !!request && token.generation === generation && token.retirement === retirement && ready && mountedNow() && visible(true)
        && draftIntact() && draftKey() === token.draftKey
        && token.universe === state.universe && token.activePlanetId === state.activePlanetId && JSON.stringify(request) === token.requestKey
        && token.authorityKey === buildingTemplateBatchAuthorityKey(state, request.templateId, request.planets.map(planet => planet.planetId));
    },
    invalidateAuthority,
    observeWorldAdoption(token: unknown) { if (worldToken !== undefined && token !== worldToken) invalidateAuthority(); worldToken = token; },
    dispose() { pending = null; review = null; ready = false; disposed = true; syncDisabled(); observer.disconnect(); panel.removeEventListener("click", click); panel.removeEventListener("change", edited); panel.removeEventListener("input", edited); document.removeEventListener("visibilitychange", hidden); },
  };
}
