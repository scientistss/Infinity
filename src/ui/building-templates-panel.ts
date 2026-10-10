import { activeBuildings, CURRENT_PHASE, isBuildingId, buildingById, type BuildingId } from "../data/buildings";
import { quoteBuildingTemplate } from "../game/building-templates";
import { MAX_BUILDING_TEMPLATES, MAX_BUILDING_TEMPLATE_GOALS, MAX_BUILDING_TEMPLATE_LEVEL, normalizeBuildingTemplateDraft,
  type BuildingGoal, type BuildingTemplateAction, type BuildingTemplateApplyRequest,
  type BuildingTemplateDraft, type BuildingTemplateQuote } from "../game/building-template-state";
import type { OrderMoney } from "../game/order-state";
import { isOrderMoney } from "../game/order-ledger";
import type { GameState } from "../game/types";
import { BUILDING_TEMPLATE_RESOURCES, buildingTemplateContextText, buildingTemplateBudgetText, buildingTemplateMapping, buildingTemplateAuthoritySignature, buildingTemplateGoals, buildingTemplateMoney, buildingTemplatePlanet, buildingTemplateRowText } from "./building-templates-present";
import "./building-templates.css";

const BUILDING_CHOICES = activeBuildings().map(building => building.id);
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
function get<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`缺少建筑模板控件 ${selector}`);
  return element;
}
function put(root: ParentNode, selector: string, value: string) {
  const element = get(root, selector);
  if (element.textContent !== value) element.textContent = value;
}
const button = (action: string, label: string, id = "") => `<button type="button" data-building-template-action="${action}"${id ? ` id="${id}"` : ""}>${label}</button>`;

export function buildingTemplatesPanelHtml(): string {
  return `<details class="building-templates" id="building-templates"><summary>建筑意图模板 · 保存目标，按需创建有限计划</summary>
    <p class="muted building-template-note">模板只保存名称与绝对目标等级，保存和查看不会付款。每次只在明确选择的同一星球付款和建造，逐项授权有限预算；不会自动补前置、跨星球、运输或无限重开。</p>
    <p id="building-template-status" class="building-template-note" role="status"></p>
    <div class="building-template-layout"><div><div class="building-template-actions">${button("new", "新建模板", "building-template-new")}</div><p id="building-template-count" class="muted"></p><div id="building-template-library" class="building-template-library"></div>
    <form id="building-template-editor" class="ov-card building-template-editor" hidden><h3 id="building-template-editor-title">新建建筑模板</h3>
      <label>模板名称（最多 64 个字符）<input id="building-template-name" type="text" maxlength="128" autocomplete="off" required /></label>
      <p class="muted">模板格式支持 1–16 项互异建筑，目标为 1–1000 级；当前可新增 ${BUILDING_CHOICES.length} 种已开放建筑。导入的未开放建筑标为设计目标，创建的有限计划仍需等待开放。编辑只影响未来应用，已创建计划保持原授权。</p>
      <div id="building-template-goals" class="building-template-goals"></div><div class="building-template-actions">${button("add-goal", "添加建筑目标", "building-template-add-goal")}</div>
      <div class="building-template-actions"><button type="submit" data-building-template-action="save" id="building-template-save">保存意图模板</button>${button("cancel-edit", "取消编辑", "building-template-cancel-edit")}</div>
    </form>
    <div id="building-template-delete-dialog" class="ov-card" hidden><p id="building-template-delete-label"></p><p>删除模板；已创建计划继续执行，可在计划列表单独管理。</p><div class="building-template-actions">${button("confirm-delete", "确认删除模板", "building-template-confirm-delete")}${button("cancel-delete", "保留模板", "building-template-cancel-delete")}</div></div></div>
    <section id="building-template-apply" class="ov-card building-template-apply" hidden><h3 id="building-template-selected-title"></h3>
      <p class="muted">只检查本次星球上的完成等级、已付款队列和运行 / 暂停计划；其他星球同建筑不覆盖这里。目标不规定施工顺序，按现有计划检查和本地队列执行。</p>
      <label>本次新建项的固定付款 / 执行星球<select id="building-template-payer"><option value="">请明确选择付款 / 执行星球</option></select></label>
      <p class="muted">顶部切换星球不会改这里。每个新增建筑独立预算，默认 0，不自动拆分总额。可以低于报价；预算或资源不足会等待，仍是有限计划，不会自动加钱。</p>
      <div id="building-template-mapping" class="building-template-mapping"></div><div id="building-template-budgets" class="building-template-budget-list"></div>
      <div class="building-template-actions">${button("fill-quotes", "按当前真实总报价填预算", "building-template-fill-quotes")}${button("review", "核对本次应用", "building-template-review")}${button("close-apply", "关闭应用", "building-template-close-apply")}</div>
      <div id="building-template-review-panel" class="building-template-review" hidden><h4>一次应用核对</h4><p id="building-template-review-summary"></p><div id="building-template-review-rows" class="building-template-review-rows"></div><div class="building-template-actions">${button("apply", "确认创建有限计划", "building-template-confirm-apply")}${button("cancel-review", "取消核对", "building-template-cancel-review")}</div></div>
    </section></div></details>`;
}

/** Input values belong to explicit drafts. Animation renders never grant authority or rewrite them. */
export function installBuildingTemplatesPanel(root: HTMLElement, onAction: (action: BuildingTemplateAction) => void) {
  const panel = get(root, "#building-templates");
  const editor = get<HTMLFormElement>(panel, "#building-template-editor");
  const payer = get<HTMLSelectElement>(panel, "#building-template-payer");
  const library = get(panel, "#building-template-library");
  let latest: GameState | null = null;
  let ready = false, generation = 0, listSignature = "", planetSignature = "";
  type Identity = { id: number; revision: number; generation: number };
  type EditAuthority = { generation: number; nextId: number; template: Identity | null };
  type ButtonAuthority = { action: string; generation: number; template?: Identity };
  let selected: Identity | null = null, pendingDelete: Identity | null = null, edit: EditAuthority | null = null;
  let review: { request: BuildingTemplateApplyRequest; signature: string; draftSignature: string; generation: number } | null = null;
  let buttons = new WeakMap<HTMLButtonElement, ButtonAuthority>();
  let goalCounter = 0;
  const register = (scope: ParentNode, identity?: Identity) => {
    for (const item of scope.querySelectorAll<HTMLButtonElement>("button[data-building-template-action]")) {
      buttons.set(item, { action: item.dataset.buildingTemplateAction!, generation, template: identity });
    }
  };
  register(panel);
  // A detached capability can never be reinserted to recover authority, even if
  // its visible data attributes happen to match a current template.
  function retireRemoved(records: MutationRecord[]) {
    for (const record of records) for (const removed of record.removedNodes) if (removed instanceof Element) {
      if (removed instanceof HTMLButtonElement) buttons.delete(removed);
      for (const item of removed.querySelectorAll<HTMLButtonElement>("button")) buttons.delete(item);
    }
  }
  const observer = new MutationObserver(retireRemoved);
  observer.observe(panel, { childList: true, subtree: true });
  // Removing the whole panel must revoke its controls too. The stable parent
  // needs only childList observation, never unrelated descendant projection.
  if (panel.parentNode) observer.observe(panel.parentNode, { childList: true });
  function renewButtons(scope: ParentNode) {
    retireRemoved(observer.takeRecords());
    for (const old of scope.querySelectorAll<HTMLButtonElement>("button[data-building-template-action]")) {
      const authority = buttons.get(old);
      buttons.delete(old);
      const fresh = old.cloneNode(true) as HTMLButtonElement;
      old.replaceWith(fresh);
      if (authority) {
        fresh.dataset.buildingTemplateAction = authority.action;
        buttons.set(fresh, {...authority, generation});
      }
    }
  }
  function status(value: string) { put(panel, "#building-template-status", value); }
  function valid(identity: Identity | null): identity is Identity {
    return !!identity && identity.generation === generation && !!latest?.buildingTemplates.templates.some(item => item.id === identity.id && item.revision === identity.revision);
  }
  function retireReview(message?: string) {
    review = null;
    renewButtons(get(panel, "#building-template-review-panel"));
    get<HTMLButtonElement>(panel, "#building-template-confirm-apply").disabled = true;
    get(panel, "#building-template-review-panel").hidden = true;
    if (message) status(message);
  }
  function currentDraft(): BuildingTemplateDraft {
    const goals: BuildingGoal[] = [];
    for (const row of get(panel, "#building-template-goals").querySelectorAll<HTMLElement>(".building-template-goal")) {
      const building = get<HTMLSelectElement>(row, "select").value;
      // Keep invalid DOM values in the draft so the domain rejects the whole
      // request rather than accidentally saving a silently shortened template.
      goals.push({building: building as BuildingId, targetLevel: Number(get<HTMLInputElement>(row, "input").value)});
    }
    return {name: get<HTMLInputElement>(panel, "#building-template-name").value, goals};
  }
  function addGoal(goal?: BuildingGoal) {
    const container = get(panel, "#building-template-goals");
    if (container.children.length >= MAX_BUILDING_TEMPLATE_GOALS) return;
    const existing = new Set(currentDraft().goals.map(item => item.building));
    const building = goal?.building ?? BUILDING_CHOICES.find(id => !existing.has(id));
    if (!building) return;
    const locked = buildingById(building).phase > CURRENT_PHASE;
    const choices = locked ? [...BUILDING_CHOICES, building] : BUILDING_CHOICES;
    const row = document.createElement("div"); row.className = "building-template-goal";
    const number = ++goalCounter;
    row.innerHTML = `<label>建筑<select id="building-template-building-${number}" aria-label="目标建筑">${choices.map(id => `<option value="${id}">${buildingById(id).nameZh}${buildingById(id).phase > CURRENT_PHASE ? `（设计目标 · 第 ${buildingById(id).phase} 阶段未开放）` : ""}</option>`).join("")}</select></label><label>绝对等级<input type="number" min="1" max="${MAX_BUILDING_TEMPLATE_LEVEL}" step="1" value="${goal?.targetLevel ?? 1}" required aria-label="绝对目标等级" /></label>${button("remove-goal", "移除")}`;
    get<HTMLSelectElement>(row, "select").value = building;
    container.append(row); register(row);
  }
  function openEditor(identity: Identity | null) {
    if (!latest || !ready || (identity && !valid(identity))) return;
    retireReview(); pendingDelete = null; get(panel, "#building-template-delete-dialog").hidden = true;
    const template = identity ? latest.buildingTemplates.templates.find(item => item.id === identity.id)! : null;
    renewButtons(editor);
    edit = {generation, nextId: latest.buildingTemplates.nextTemplateId, template: identity};
    get<HTMLInputElement>(panel, "#building-template-name").value = template?.name ?? "";
    get(panel, "#building-template-goals").replaceChildren();
    for (const goal of template?.goals ?? [{building: "metal_mine" as const, targetLevel: 1}]) addGoal(goal);
    put(panel, "#building-template-editor-title", template ? `编辑 #${template.id} · 修订 ${template.revision}` : "新建建筑模板");
    editor.hidden = false; status("只保存建筑意图，不付款、不改已有计划。");
    syncDisabled(); get<HTMLInputElement>(panel, "#building-template-name").focus();
  }
  function chooseTemplate(identity: Identity) {
    if (!valid(identity) || !latest) return;
    retireReview(); renewButtons(get(panel, "#building-template-apply")); selected = {...identity};
    const template = latest.buildingTemplates.templates.find(item => item.id === identity.id)!;
    put(panel, "#building-template-selected-title", `#${template.id} ${template.name} · 修订 ${template.revision}`);
    payer.value = "";
    const budgets = get(panel, "#building-template-budgets");
    budgets.innerHTML = template.goals.map(goal => `<fieldset data-building-template-building="${goal.building}"><legend>${buildingById(goal.building).nameZh} → ${goal.targetLevel} 级 · 独立净支出上限</legend><div class="building-template-budget-row">${BUILDING_TEMPLATE_RESOURCES.map(([id, label]) => `<label>${label}<input data-building-template-budget="${id}" type="text" inputmode="decimal" maxlength="256" value="0" autocomplete="off" aria-label="${buildingById(goal.building).nameZh}${label}预算" /></label>`).join("")}</div></fieldset>`).join("");
    get(panel, "#building-template-apply").hidden = false;
    status("请明确选择付款 / 执行星球，再核对目标与每项预算。"); updateMapping(); syncDisabled();
  }
  function readBudget(building: BuildingId): OrderMoney {
    const scope = get(panel, `[data-building-template-building="${building}"]`);
    return Object.fromEntries(BUILDING_TEMPLATE_RESOURCES.map(([id]) => [id, get<HTMLInputElement>(scope, `[data-building-template-budget="${id}"]`).value.trim()])) as OrderMoney;
  }
  function localDraftSignature(): string {
    return JSON.stringify([payer.value, ...Array.from(get(panel, "#building-template-budgets").querySelectorAll<HTMLFieldSetElement>("fieldset"), field => [
      field.dataset.buildingTemplateBuilding,
      ...Array.from(field.querySelectorAll<HTMLInputElement>("input"), input => [input.dataset.buildingTemplateBudget, input.value]),
    ])]);
  }
  function renderQuote(quote: BuildingTemplateQuote) {
    if (!latest) return;
    put(panel, "#building-template-review-summary", `固定付款 / 执行星球：${buildingTemplatePlanet(latest, payer.value)}；新增 ${quote.newCount} 个本地有限建筑计划；创建时不付款，之后每 10 游戏秒检查条件。${quote.totalQuote ? `当前未付总报价：${buildingTemplateMoney(quote.totalQuote)}。` : ""}${quote.blockers.join("；")}`);
    get(panel, "#building-template-review-rows").innerHTML = `<p>${escape(buildingTemplateContextText(latest, quote))}</p>` + quote.rows.map(row => `<article data-building-template-review-building="${row.building}"><p>${escape(buildingTemplateRowText(latest!, row))}</p>${row.status === "new" ? `<p>真实未付总报价：${escape(row.quote ? buildingTemplateMoney(row.quote) : "无法精确表示，请降低目标")}<br />本项授权预算：${escape(buildingTemplateMoney(readBudget(row.building)))}</p><p>${escape(buildingTemplateBudgetText(row.quote, readBudget(row.building)))}</p>` : ""}</article>`).join("");
    get(panel, "#building-template-review-panel").hidden = false;
  }
  function makeReview(fill: boolean) {
    if (!latest || !ready || !valid(selected) || !payer.value) { status("请先选择已保存模板和固定付款星球。"); return; }
    retireReview();
    // This is one of the two explicit user operations allowed to price all levels.
    const quote = quoteBuildingTemplate(latest, selected.id, payer.value);
    if (fill) {
      for (const row of quote.rows) if (row.status === "new" && row.quote) {
        const scope = get(panel, `[data-building-template-building="${row.building}"]`);
        for (const [id] of BUILDING_TEMPLATE_RESOURCES) get<HTMLInputElement>(scope, `[data-building-template-budget="${id}"]`).value = row.quote[id];
      }
      status("已按当前真实报价填写各项独立预算；请点击“核对本次应用”后确认。" + (quote.blockers.length ? ` ${quote.blockers.join("；")}` : ""));
      syncDisabled(); return;
    }
    renderQuote(quote);
    const budgets = quote.rows.filter(row => row.status === "new").map(row => ({building: row.building, budget: readBudget(row.building)}));
    const budgetsValid = budgets.every(entry => isOrderMoney(entry.budget));
    if (quote.ok && budgetsValid) review = {generation, signature: buildingTemplateAuthoritySignature(latest, selected.id, payer.value), draftSignature: localDraftSignature(), request: {
      templateId: selected.id, expectedTemplateRevision: quote.templateRevision, planetId: payer.value,
      expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
      budgets,
    }};
    put(panel, "#building-template-confirm-apply", `确认创建 ${quote.newCount} 个有限计划`);
    status(!budgetsValid ? "预算无效，请填写非负精确金额后重新核对。" : quote.ok ? "请核对每项授权；确认只创建一次，不立即付款。" : quote.reason || "无需创建，或存在冲突。请检查目标映射。");
    syncDisabled();
  }
  function updateMapping() {
    if (!latest || !valid(selected)) return;
    const mapping = buildingTemplateMapping(latest, selected.id, payer.value);
    const rows = `<p>${escape(buildingTemplateContextText(latest, mapping))}</p>` + mapping.rows.map(row => `<p data-building-template-map-building="${row.building}" data-building-template-map-status="${row.status}">${escape(buildingTemplateRowText(latest!, row))}</p>`).join("");
    const element = get(panel, "#building-template-mapping");
    if (element.dataset.signature !== rows) { element.innerHTML = rows; element.dataset.signature = rows; }
    const newBuildings = new Set(mapping.rows.filter(row => row.status === "new").map(row => row.building));
    for (const field of get(panel, "#building-template-budgets").querySelectorAll<HTMLFieldSetElement>("fieldset")) {
      const building = field.dataset.buildingTemplateBuilding;
      // The DOM values stay intact if a goal becomes covered while the user edits.
      field.disabled = !ready || !building || !isBuildingId(building) || !newBuildings.has(building);
    }
  }
  function syncDisabled() {
    for (const item of panel.querySelectorAll<HTMLButtonElement>("button[data-building-template-action]")) {
      const action = buttons.get(item)?.action;
      item.disabled = !ready || !action;
      if (action === "save" || action === "add-goal") item.disabled ||= !edit;
      if (action === "add-goal" && edit) {
        const goals = currentDraft().goals;
        item.disabled ||= goals.length >= MAX_BUILDING_TEMPLATE_GOALS || BUILDING_CHOICES.every(id => goals.some(goal => goal.building === id));
      }
      if (action === "remove-goal") item.disabled ||= !edit;
      if (action === "apply") item.disabled ||= !review;
      if (action === "review" || action === "fill-quotes") item.disabled ||= !valid(selected) || !payer.value;
      if (action === "confirm-delete") item.disabled ||= !valid(pendingDelete);
      if (action === "new") item.disabled ||= !!latest && latest.buildingTemplates.templates.length >= MAX_BUILDING_TEMPLATES;
    }
    for (const input of editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) input.disabled = !ready || !edit;
    payer.disabled = !ready || !valid(selected);
    for (const input of get(panel, "#building-template-budgets").querySelectorAll<HTMLInputElement>("input")) input.disabled = !ready || !valid(selected);
  }
  // Observation never projects lists or grants draft/review authority. Active
  // capabilities are checked even when folded/hidden so A→B→A cannot revive A.
  function observe(state: GameState, writable: boolean) {
    const maskChanged = latest === null || ready !== writable;
    const becameProtected = ready && !writable;
    latest = state; ready = writable;
    if (becameProtected) {
      edit = null; pendingDelete = null; selected = null;
      retireReview("保存已进入保护状态，旧草稿与核对已失效。恢复后请明确重新打开模板。");
      renewButtons(editor);
      renewButtons(get(panel, "#building-template-delete-dialog"));
      get(panel, "#building-template-apply").hidden = true;
      get(panel, "#building-template-delete-dialog").hidden = true;
    } else if (edit || pendingDelete || selected || review) refreshAuthority();
    // Protection reaches mounted controls immediately. With no active draft or
    // review, an ordinary observation only replaces these two references.
    if (maskChanged) syncDisabled();
  }
  function refreshAuthority() {
    if (!latest) return;
    let retired = false;
    if (edit && (edit.template ? !valid(edit.template) : edit.nextId !== latest.buildingTemplates.nextTemplateId)) { edit = null; retired = true; }
    if (pendingDelete && !valid(pendingDelete)) { pendingDelete = null; retired = true; get(panel, "#building-template-delete-dialog").hidden = true; }
    if (selected && !valid(selected)) { selected = null; retired = true; retireReview("模板已修改或删除，请重新选择后核对。"); get(panel, "#building-template-apply").hidden = true; }
    if (review && (!selected || review.draftSignature !== localDraftSignature() || review.signature !== buildingTemplateAuthoritySignature(latest, selected.id, payer.value))) {
      retired = true; retireReview("目标、预算、队列或计划状态已改变，请明确重新核对后创建。");
    }
    if (retired) syncDisabled();
  }
  function authorized(item: HTMLButtonElement | null): ButtonAuthority | null {
    refreshAuthority();
    retireRemoved(observer.takeRecords());
    if (!item || item.disabled || !item.isConnected || !root.contains(panel) || !panel.contains(item)) return null;
    const authority = buttons.get(item);
    if (!authority || authority.generation !== generation || item.dataset.buildingTemplateAction !== authority.action) return null;
    if (authority.template && (!valid(authority.template) || item.dataset.buildingTemplateId !== String(authority.template.id) || item.dataset.buildingTemplateRevision !== String(authority.template.revision))) return null;
    return authority;
  }
  editor.addEventListener("submit", event => {
    event.preventDefault();
    refreshAuthority();
    if (!ready || !latest || !edit || edit.generation !== generation || !editor.isConnected || !panel.contains(editor)) return;
    // Genuine implicit Enter uses the form's default Save submitter. Synthetic
    // no-submitter events cannot bypass a removed form/button's retired scope.
    if (!(event.submitter instanceof HTMLButtonElement) || authorized(event.submitter)?.action !== "save") return;
    const draft = normalizeBuildingTemplateDraft(currentDraft());
    if (!draft) { status("名称需为 1–64 个字符，建筑不得重复，目标需为 1–1000 的整数。请修正当前草稿。"); return; }
    const authority = edit; edit = null; retireReview(); syncDisabled();
    onAction(authority.template ? {type:"building-template-edit", templateId:authority.template.id, expectedTemplateRevision:authority.template.revision, draft}
      : {type:"building-template-create", expectedNextTemplateId:authority.nextId, draft});
  });
  panel.addEventListener("click", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-building-template-action]") : null;
    const authority = authorized(item);
    if (!authority || !ready || !latest) return;
    const action = authority.action;
    if (action === "new") openEditor(null);
    else if (action === "edit" && authority.template) openEditor(authority.template);
    else if (action === "select" && authority.template) chooseTemplate(authority.template);
    else if (action === "delete" && authority.template) {
      retireReview(); renewButtons(get(panel, "#building-template-delete-dialog")); pendingDelete = {...authority.template};
      const template = latest.buildingTemplates.templates.find(value => value.id === pendingDelete!.id)!;
      put(panel, "#building-template-delete-label", `删除 #${template.id} ${template.name}？`); get(panel, "#building-template-delete-dialog").hidden = false; syncDisabled();
    } else if (action === "confirm-delete" && valid(pendingDelete)) {
      const identity = pendingDelete; pendingDelete = null; retireReview(); get(panel, "#building-template-delete-dialog").hidden = true;
      syncDisabled();
      onAction({type:"building-template-delete", templateId:identity.id, expectedTemplateRevision:identity.revision});
    } else if (action === "cancel-delete") { pendingDelete = null; get(panel, "#building-template-delete-dialog").hidden = true; }
    else if (action === "cancel-edit") { edit = null; editor.hidden = true; syncDisabled(); }
    else if (action === "add-goal" && edit) { addGoal(); retireReview(); syncDisabled(); }
    else if (action === "remove-goal" && edit && item) { item.closest(".building-template-goal")?.remove(); retireReview(); syncDisabled(); }
    else if (action === "close-apply") { selected = null; retireReview(); get(panel, "#building-template-apply").hidden = true; }
    else if (action === "cancel-review") retireReview("已取消核对。再次创建需要明确重新核对。");
    else if (action === "review") makeReview(false);
    else if (action === "fill-quotes") makeReview(true);
    else if (action === "apply" && review && review.generation === generation && valid(selected)) {
      const request = review.request;
      // Consume before the synchronous domain action, including failed attempts.
      retireReview("本次确认已提交。重复点击不会再次创建。"); syncDisabled();
      onAction({type:"building-template-apply", request});
    }
  });
  panel.addEventListener("input", event => {
    if (!(event.target instanceof HTMLElement) || !panel.contains(event.target)) return;
    if (editor.contains(event.target) || get(panel, "#building-template-budgets").contains(event.target)) retireReview();
  });
  panel.addEventListener("change", event => {
    if (!(event.target instanceof HTMLElement) || !panel.contains(event.target)) return;
    if (event.target === payer) { retireReview(); updateMapping(); syncDisabled(); }
    else if (editor.contains(event.target) || get(panel, "#building-template-budgets").contains(event.target)) { retireReview(); syncDisabled(); }
    // No input/change/blur handler grants a new draft, selection or review nonce.
  });
  return {
    observe,
    observeContext: observe,
    update(state: GameState, writable: boolean) {
      observe(state, writable);
      refreshAuthority();
      const planets = JSON.stringify(state.planets.map(planet => [planet.id, planet.name]));
      if (planetSignature !== planets) {
        const selectedPayer = payer.value;
        payer.innerHTML = `<option value="">请明确选择付款 / 执行星球</option>${state.planets.map(planet => `<option value="${escape(planet.id)}">${escape(planet.name)} [${escape(planet.id)}]</option>`).join("")}`;
        payer.value = state.planets.some(planet => planet.id === selectedPayer) ? selectedPayer : ""; planetSignature = planets;
      }
      const signature = JSON.stringify(state.buildingTemplates);
      if (signature !== listSignature) {
        listSignature = signature; library.replaceChildren();
        for (const template of state.buildingTemplates.templates) {
          const row = document.createElement("article"); row.className = "ov-card"; row.dataset.buildingTemplateId = String(template.id);
          row.innerHTML = `<strong>#${template.id} ${escape(template.name)}</strong><span class="muted">修订 ${template.revision} · ${escape(buildingTemplateGoals(template))}</span><div class="building-template-actions">${button("select", "选择并应用")}${button("edit", "编辑意图")}${button("delete", "删除模板")}</div>`;
          const identity = {id:template.id, revision:template.revision, generation};
          for (const item of row.querySelectorAll<HTMLButtonElement>("button")) { item.dataset.buildingTemplateId = String(template.id); item.dataset.buildingTemplateRevision = String(template.revision); }
          register(row, identity); library.append(row);
        }
      }
      put(panel, "#building-template-count", `已保存 ${state.buildingTemplates.templates.length} / ${MAX_BUILDING_TEMPLATES} 个模板${state.buildingTemplates.templates.length ? "" : "，仅保存建筑意图，尚无模板"}`);
      updateMapping(); syncDisabled();
    },
    completeAction(reason: string, ok: boolean) {
      status(reason);
      if (ok && !edit) editor.hidden = true;
    },
    invalidateAuthority() {
      generation++; latest = null; ready = false; selected = null; pendingDelete = null; edit = null; review = null;
      listSignature = "";
      library.replaceChildren();
      // Replace every visible action capability. Same IDs in another save/world
      // never inherit old buttons, even when an attacker later reinserts them.
      renewButtons(panel);
      get(panel, "#building-template-apply").hidden = true; get(panel, "#building-template-delete-dialog").hidden = true;
      get(panel, "#building-template-review-panel").hidden = true;
      status("世界或存档已替换，旧草稿与核对已失效。请明确新建、编辑或重新选择模板。"); syncDisabled();
    },
  };
}
