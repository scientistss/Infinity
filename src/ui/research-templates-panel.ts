import { RESEARCH_IDS, isResearchId, researchById, type ResearchId } from "../data/research";
import { quoteResearchTemplate } from "../game/research-templates";
import { MAX_RESEARCH_TEMPLATES, MAX_RESEARCH_TEMPLATE_GOALS, MAX_RESEARCH_TEMPLATE_LEVEL, normalizeResearchTemplateDraft,
  type ResearchGoal, type ResearchTemplateAction, type ResearchTemplateApplyRequest,
  type ResearchTemplateDraft, type ResearchTemplateQuote } from "../game/research-template-state";
import type { OrderMoney } from "../game/order-state";
import type { GameState } from "../game/types";
import { TEMPLATE_RESOURCES, researchTemplateMapping, templateAuthoritySignature, templateGoals, templateMoney, templatePlanet, templateRowText } from "./research-templates-present";
import "./research-templates.css";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
function get<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`缺少研究模板控件 ${selector}`);
  return element;
}
function put(root: ParentNode, selector: string, value: string) {
  const element = get(root, selector);
  if (element.textContent !== value) element.textContent = value;
}
const button = (action: string, label: string, id = "") => `<button type="button" data-template-action="${action}"${id ? ` id="${id}"` : ""}>${label}</button>`;

export function researchTemplatesPanelHtml(): string {
  return `<details class="research-templates" id="research-templates"><summary>研究意图模板 · 保存目标，按需创建有限计划</summary>
    <p class="muted template-note">模板只保存名称与绝对目标等级，保存和查看不会付款。每次应用都需明确固定付款星球和逐项预算；不会自动补前置、循环重开或运输。</p>
    <p id="template-status" class="template-note" role="status"></p>
    <div class="template-layout"><div><div class="template-actions">${button("new", "新建模板", "template-new")}</div><p id="template-count" class="muted"></p><div id="template-library" class="template-library"></div>
    <form id="template-editor" class="ov-card template-editor" hidden><h3 id="template-editor-title">新建研究模板</h3>
      <label>模板名称（最多 64 个字符）<input id="template-name" type="text" maxlength="128" autocomplete="off" required /></label>
      <p class="muted">1–16 项互异科技，目标为 1–1000 级。编辑只影响未来应用，已创建计划保持原授权。</p>
      <div id="template-goals" class="template-goals"></div><div class="template-actions">${button("add-goal", "添加科技目标", "template-add-goal")}</div>
      <div class="template-actions"><button type="submit" data-template-action="save" id="template-save">保存意图模板</button>${button("cancel-edit", "取消编辑", "template-cancel-edit")}</div>
    </form>
    <div id="template-delete-dialog" class="ov-card" hidden><p id="template-delete-label"></p><p>删除模板；已创建计划继续执行，可在计划列表单独管理。</p><div class="template-actions">${button("confirm-delete", "确认删除模板", "template-confirm-delete")}${button("cancel-delete", "保留模板", "template-cancel-delete")}</div></div></div>
    <section id="template-apply" class="ov-card template-apply" hidden><h3 id="template-selected-title"></h3>
      <p class="muted">覆盖项显示已有计划的真实状态与原付款星球；选择本次付款星球不会恢复或改变它们。各项目标并列，执行顺序由现有研究队列决定。</p>
      <label>本次新建项的固定付款 / 实验星球<select id="template-payer"><option value="">请明确选择付款星球</option></select></label>
      <p class="muted">顶部切换星球不会改这里。每个新增科技独立预算，默认 0；预算不足会等待，不自动加钱。引力技术即使资源零报价仍需满足能源门槛。</p>
      <div id="template-mapping" class="template-mapping"></div><div id="template-budgets" class="template-budget-list"></div>
      <div class="template-actions">${button("fill-quotes", "按当前真实总报价填预算", "template-fill-quotes")}${button("review", "核对本次应用", "template-review")}${button("close-apply", "关闭应用", "template-close-apply")}</div>
      <div id="template-review-panel" class="template-review" hidden><h4>一次应用核对</h4><p id="template-review-summary"></p><div id="template-review-rows" class="template-review-rows"></div><div class="template-actions">${button("apply", "确认创建有限计划", "template-confirm-apply")}${button("cancel-review", "取消核对", "template-cancel-review")}</div></div>
    </section></div></details>`;
}

/** Input values belong to explicit drafts. Animation renders never grant authority or rewrite them. */
export function installResearchTemplatesPanel(root: HTMLElement, onAction: (action: ResearchTemplateAction) => void) {
  const panel = get(root, "#research-templates");
  const editor = get<HTMLFormElement>(panel, "#template-editor");
  const payer = get<HTMLSelectElement>(panel, "#template-payer");
  const library = get(panel, "#template-library");
  let latest: GameState | null = null;
  let ready = false, generation = 0, listSignature = "", planetSignature = "";
  type Identity = { id: number; revision: number; generation: number };
  type EditAuthority = { generation: number; nextId: number; template: Identity | null };
  type ButtonAuthority = { action: string; generation: number; template?: Identity };
  let selected: Identity | null = null, pendingDelete: Identity | null = null, edit: EditAuthority | null = null;
  let review: { request: ResearchTemplateApplyRequest; signature: string; generation: number } | null = null;
  let buttons = new WeakMap<HTMLButtonElement, ButtonAuthority>();
  let goalCounter = 0;
  const register = (scope: ParentNode, identity?: Identity) => {
    for (const item of scope.querySelectorAll<HTMLButtonElement>("button[data-template-action]")) {
      buttons.set(item, { action: item.dataset.templateAction!, generation, template: identity });
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
  function renewButtons(scope: ParentNode) {
    retireRemoved(observer.takeRecords());
    for (const old of scope.querySelectorAll<HTMLButtonElement>("button[data-template-action]")) {
      const authority = buttons.get(old);
      buttons.delete(old);
      const fresh = old.cloneNode(true) as HTMLButtonElement;
      old.replaceWith(fresh);
      if (authority) {
        fresh.dataset.templateAction = authority.action;
        buttons.set(fresh, {...authority, generation});
      }
    }
  }
  function status(value: string) { put(panel, "#template-status", value); }
  function valid(identity: Identity | null): identity is Identity {
    return !!identity && identity.generation === generation && !!latest?.researchTemplates.templates.some(item => item.id === identity.id && item.revision === identity.revision);
  }
  function retireReview(message?: string) {
    review = null;
    renewButtons(get(panel, "#template-review-panel"));
    get<HTMLButtonElement>(panel, "#template-confirm-apply").disabled = true;
    get(panel, "#template-review-panel").hidden = true;
    if (message) status(message);
  }
  function currentDraft(): ResearchTemplateDraft {
    const goals: ResearchGoal[] = [];
    for (const row of get(panel, "#template-goals").querySelectorAll<HTMLElement>(".template-goal")) {
      const tech = get<HTMLSelectElement>(row, "select").value;
      if (isResearchId(tech)) goals.push({tech, targetLevel: Number(get<HTMLInputElement>(row, "input").value)});
    }
    return {name: get<HTMLInputElement>(panel, "#template-name").value, goals};
  }
  function addGoal(goal?: ResearchGoal) {
    const container = get(panel, "#template-goals");
    if (container.children.length >= MAX_RESEARCH_TEMPLATE_GOALS) return;
    const existing = new Set(currentDraft().goals.map(item => item.tech));
    const tech = goal?.tech ?? RESEARCH_IDS.find(id => !existing.has(id)) ?? RESEARCH_IDS[0];
    const row = document.createElement("div"); row.className = "template-goal";
    const number = ++goalCounter;
    row.innerHTML = `<label>科技<select id="template-tech-${number}" aria-label="目标科技">${RESEARCH_IDS.map(id => `<option value="${id}">${researchById(id).nameZh}</option>`).join("")}</select></label><label>绝对等级<input type="number" min="1" max="${MAX_RESEARCH_TEMPLATE_LEVEL}" step="1" value="${goal?.targetLevel ?? 1}" required aria-label="绝对目标等级" /></label>${button("remove-goal", "移除")}`;
    get<HTMLSelectElement>(row, "select").value = tech;
    container.append(row); register(row);
  }
  function openEditor(identity: Identity | null) {
    if (!latest || !ready || (identity && !valid(identity))) return;
    retireReview(); pendingDelete = null; get(panel, "#template-delete-dialog").hidden = true;
    const template = identity ? latest.researchTemplates.templates.find(item => item.id === identity.id)! : null;
    renewButtons(editor);
    edit = {generation, nextId: latest.researchTemplates.nextTemplateId, template: identity};
    get<HTMLInputElement>(panel, "#template-name").value = template?.name ?? "";
    get(panel, "#template-goals").replaceChildren();
    for (const goal of template?.goals ?? [{tech: "energy_tech" as const, targetLevel: 1}]) addGoal(goal);
    put(panel, "#template-editor-title", template ? `编辑 #${template.id} · 修订 ${template.revision}` : "新建研究模板");
    editor.hidden = false; status("只保存研究意图，不付款、不改已有计划。");
    syncDisabled(); get<HTMLInputElement>(panel, "#template-name").focus();
  }
  function chooseTemplate(identity: Identity) {
    if (!valid(identity) || !latest) return;
    retireReview(); renewButtons(get(panel, "#template-apply")); selected = {...identity};
    const template = latest.researchTemplates.templates.find(item => item.id === identity.id)!;
    put(panel, "#template-selected-title", `#${template.id} ${template.name} · 修订 ${template.revision}`);
    payer.value = "";
    const budgets = get(panel, "#template-budgets");
    budgets.innerHTML = template.goals.map(goal => `<fieldset data-template-tech="${goal.tech}"><legend>${researchById(goal.tech).nameZh} → ${goal.targetLevel} 级 · 独立净支出上限</legend><div class="template-budget-row">${TEMPLATE_RESOURCES.map(([id, label]) => `<label>${label}<input data-template-budget="${id}" type="text" inputmode="decimal" maxlength="256" value="0" autocomplete="off" aria-label="${researchById(goal.tech).nameZh}${label}预算" /></label>`).join("")}</div></fieldset>`).join("");
    get(panel, "#template-apply").hidden = false;
    status("请明确选择付款星球，再核对目标与每项预算。"); updateMapping(); syncDisabled();
  }
  function readBudget(tech: ResearchId): OrderMoney {
    const scope = get(panel, `[data-template-tech="${tech}"]`);
    return Object.fromEntries(TEMPLATE_RESOURCES.map(([id]) => [id, get<HTMLInputElement>(scope, `[data-template-budget="${id}"]`).value.trim()])) as OrderMoney;
  }
  function renderQuote(quote: ResearchTemplateQuote) {
    if (!latest) return;
    put(panel, "#template-review-summary", `固定付款 / 实验星球：${templatePlanet(latest, payer.value)}；新增 ${quote.newCount} 个本地有限研究计划；创建时不付款，之后每 10 游戏秒检查条件。${quote.totalQuote ? `当前未付总报价：${templateMoney(quote.totalQuote)}。` : ""}${quote.blockers.join("；")}`);
    get(panel, "#template-review-rows").innerHTML = quote.rows.map(row => `<article data-template-review-tech="${row.tech}"><p>${escape(templateRowText(latest!, row))}</p>${row.status === "new" ? `<p>真实未付总报价：${escape(row.quote ? templateMoney(row.quote) : "无法精确表示，请降低目标")}<br />本项授权预算：${escape(templateMoney(readBudget(row.tech)))}</p>` : ""}</article>`).join("");
    get(panel, "#template-review-panel").hidden = false;
  }
  function makeReview(fill: boolean) {
    if (!latest || !ready || !valid(selected) || !payer.value) { status("请先选择已保存模板和固定付款星球。"); return; }
    retireReview();
    // This is one of the two explicit user operations allowed to price all levels.
    const quote = quoteResearchTemplate(latest, selected.id, payer.value);
    if (fill) {
      for (const row of quote.rows) if (row.status === "new" && row.quote) {
        const scope = get(panel, `[data-template-tech="${row.tech}"]`);
        for (const [id] of TEMPLATE_RESOURCES) get<HTMLInputElement>(scope, `[data-template-budget="${id}"]`).value = row.quote[id];
      }
      status("已按当前真实报价填写各项独立预算；请点击“核对本次应用”后确认。" + (quote.blockers.length ? ` ${quote.blockers.join("；")}` : ""));
      syncDisabled(); return;
    }
    renderQuote(quote);
    if (quote.ok) review = {generation, signature: templateAuthoritySignature(latest, selected.id, payer.value), request: {
      templateId: selected.id, expectedTemplateRevision: quote.templateRevision, planetId: payer.value,
      expectedNextTaskId: quote.nextTaskId, expectedReviewKey: quote.reviewKey,
      budgets: quote.rows.filter(row => row.status === "new").map(row => ({tech: row.tech, budget: readBudget(row.tech)})),
    }};
    put(panel, "#template-confirm-apply", `确认创建 ${quote.newCount} 个有限计划`);
    status(quote.ok ? "请核对每项授权；确认只创建一次，不立即付款。" : quote.reason || "无需创建，或存在冲突。请检查目标映射。");
    syncDisabled();
  }
  function updateMapping() {
    if (!latest || !valid(selected)) return;
    const mapping = researchTemplateMapping(latest, selected.id, payer.value);
    const rows = mapping.rows.map(row => `<p data-template-map-tech="${row.tech}" data-template-map-status="${row.status}">${escape(templateRowText(latest!, row))}</p>`).join("");
    const element = get(panel, "#template-mapping");
    if (element.dataset.signature !== rows) { element.innerHTML = rows; element.dataset.signature = rows; }
    const newTechs = new Set(mapping.rows.filter(row => row.status === "new").map(row => row.tech));
    for (const field of get(panel, "#template-budgets").querySelectorAll<HTMLFieldSetElement>("fieldset")) {
      const tech = field.dataset.templateTech;
      // The DOM values stay intact if a goal becomes covered while the user edits.
      field.disabled = !ready || !tech || !isResearchId(tech) || !newTechs.has(tech);
    }
  }
  function syncDisabled() {
    for (const item of panel.querySelectorAll<HTMLButtonElement>("button[data-template-action]")) {
      const action = buttons.get(item)?.action;
      item.disabled = !ready || !action;
      if (action === "save" || action === "add-goal") item.disabled ||= !edit;
      if (action === "remove-goal") item.disabled ||= !edit;
      if (action === "apply") item.disabled ||= !review;
      if (action === "review" || action === "fill-quotes") item.disabled ||= !valid(selected) || !payer.value;
      if (action === "confirm-delete") item.disabled ||= !valid(pendingDelete);
      if (action === "new") item.disabled ||= !!latest && latest.researchTemplates.templates.length >= MAX_RESEARCH_TEMPLATES;
    }
    for (const input of editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select")) input.disabled = !ready || !edit;
    payer.disabled = !ready || !valid(selected);
    for (const input of get(panel, "#template-budgets").querySelectorAll<HTMLInputElement>("input")) input.disabled = !ready || !valid(selected);
  }
  // Observation never projects lists or grants draft/review authority. Explicit
  // handlers read this reference even when the next scheduled paint is skipped.
  function observe(state: GameState, writable: boolean) { latest = state; ready = writable; }
  function refreshAuthority() {
    if (!latest) return;
    if (edit?.template && !valid(edit.template)) edit = null;
    if (pendingDelete && !valid(pendingDelete)) { pendingDelete = null; get(panel, "#template-delete-dialog").hidden = true; }
    if (selected && !valid(selected)) { selected = null; retireReview("模板已修改或删除，请重新选择后核对。"); get(panel, "#template-apply").hidden = true; }
    if (review && (!selected || review.signature !== templateAuthoritySignature(latest, selected.id, payer.value))) retireReview("目标、队列或计划状态已改变，请明确重新核对后创建。");
  }
  function authorized(item: HTMLButtonElement | null): ButtonAuthority | null {
    refreshAuthority();
    retireRemoved(observer.takeRecords());
    if (!item || item.disabled || !panel.contains(item)) return null;
    const authority = buttons.get(item);
    if (!authority || authority.generation !== generation || item.dataset.templateAction !== authority.action) return null;
    if (authority.template && (!valid(authority.template) || item.dataset.templateId !== String(authority.template.id) || item.dataset.templateRevision !== String(authority.template.revision))) return null;
    return authority;
  }
  editor.addEventListener("submit", event => {
    event.preventDefault();
    refreshAuthority();
    if (!ready || !latest || !edit || edit.generation !== generation) return;
    if (event.submitter && (!(event.submitter instanceof HTMLButtonElement) || authorized(event.submitter)?.action !== "save")) return;
    // Keyboard submission is also scoped to a live, explicitly opened editor.
    const draft = normalizeResearchTemplateDraft(currentDraft());
    if (!draft) { status("名称需为 1–64 个字符，科技不得重复，目标需为 1–1000 的整数。请修正当前草稿。"); return; }
    const authority = edit; edit = null; retireReview(); syncDisabled();
    onAction(authority.template ? {type:"research-template-edit", templateId:authority.template.id, expectedTemplateRevision:authority.template.revision, draft}
      : {type:"research-template-create", expectedNextTemplateId:authority.nextId, draft});
  });
  panel.addEventListener("click", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-template-action]") : null;
    const authority = authorized(item);
    if (!authority || !ready || !latest) return;
    const action = authority.action;
    if (action === "new") openEditor(null);
    else if (action === "edit" && authority.template) openEditor(authority.template);
    else if (action === "select" && authority.template) chooseTemplate(authority.template);
    else if (action === "delete" && authority.template) {
      retireReview(); renewButtons(get(panel, "#template-delete-dialog")); pendingDelete = {...authority.template};
      const template = latest.researchTemplates.templates.find(value => value.id === pendingDelete!.id)!;
      put(panel, "#template-delete-label", `删除 #${template.id} ${template.name}？`); get(panel, "#template-delete-dialog").hidden = false; syncDisabled();
    } else if (action === "confirm-delete" && valid(pendingDelete)) {
      const identity = pendingDelete; pendingDelete = null; retireReview(); get(panel, "#template-delete-dialog").hidden = true;
      onAction({type:"research-template-delete", templateId:identity.id, expectedTemplateRevision:identity.revision});
    } else if (action === "cancel-delete") { pendingDelete = null; get(panel, "#template-delete-dialog").hidden = true; }
    else if (action === "cancel-edit") { edit = null; editor.hidden = true; }
    else if (action === "add-goal" && edit) { addGoal(); retireReview(); }
    else if (action === "remove-goal" && edit && item) { item.closest(".template-goal")?.remove(); retireReview(); }
    else if (action === "close-apply") { selected = null; retireReview(); get(panel, "#template-apply").hidden = true; }
    else if (action === "cancel-review") retireReview("已取消核对。再次创建需要明确重新核对。");
    else if (action === "review") makeReview(false);
    else if (action === "fill-quotes") makeReview(true);
    else if (action === "apply" && review && review.generation === generation && valid(selected)) {
      const request = review.request;
      // Consume before the synchronous domain action, including failed attempts.
      retireReview("本次确认已提交。重复点击不会再次创建。"); syncDisabled();
      onAction({type:"research-template-apply", request});
    }
  });
  panel.addEventListener("input", event => {
    if (!(event.target instanceof HTMLElement) || !panel.contains(event.target)) return;
    if (editor.contains(event.target) || get(panel, "#template-budgets").contains(event.target)) retireReview();
  });
  panel.addEventListener("change", event => {
    if (!(event.target instanceof HTMLElement) || !panel.contains(event.target)) return;
    if (event.target === payer) { retireReview(); updateMapping(); syncDisabled(); }
    else if (editor.contains(event.target) || get(panel, "#template-budgets").contains(event.target)) retireReview();
    // No input/change/blur handler grants a new draft, selection or review nonce.
  });
  return {
    observe,
    update(state: GameState, writable: boolean) {
      observe(state, writable);
      refreshAuthority();
      const planets = JSON.stringify(state.planets.map(planet => [planet.id, planet.name]));
      if (planetSignature !== planets) {
        const selectedPayer = payer.value;
        payer.innerHTML = `<option value="">请明确选择付款星球</option>${state.planets.map(planet => `<option value="${escape(planet.id)}">${escape(planet.name)} [${escape(planet.id)}]</option>`).join("")}`;
        payer.value = state.planets.some(planet => planet.id === selectedPayer) ? selectedPayer : ""; planetSignature = planets;
      }
      const signature = JSON.stringify(state.researchTemplates);
      if (signature !== listSignature) {
        listSignature = signature; library.replaceChildren();
        for (const template of state.researchTemplates.templates) {
          const row = document.createElement("article"); row.className = "ov-card"; row.dataset.templateId = String(template.id);
          row.innerHTML = `<strong>#${template.id} ${escape(template.name)}</strong><span class="muted">修订 ${template.revision} · ${escape(templateGoals(template))}</span><div class="template-actions">${button("select", "选择并应用")}${button("edit", "编辑意图")}${button("delete", "删除模板")}</div>`;
          const identity = {id:template.id, revision:template.revision, generation};
          for (const item of row.querySelectorAll<HTMLButtonElement>("button")) { item.dataset.templateId = String(template.id); item.dataset.templateRevision = String(template.revision); }
          register(row, identity); library.append(row);
        }
      }
      put(panel, "#template-count", `已保存 ${state.researchTemplates.templates.length} / ${MAX_RESEARCH_TEMPLATES} 个模板${state.researchTemplates.templates.length ? "" : "，尚未授权任何研究"}`);
      updateMapping(); syncDisabled();
    },
    completeAction(reason: string, ok: boolean) {
      status(reason);
      if (ok && !edit) editor.hidden = true;
    },
    invalidateAuthority() {
      generation++; latest = null; selected = null; pendingDelete = null; edit = null; review = null;
      listSignature = "";
      library.replaceChildren();
      // Replace every visible action capability. Same IDs in another save/world
      // never inherit old buttons, even when an attacker later reinserts them.
      renewButtons(panel);
      get(panel, "#template-apply").hidden = true; get(panel, "#template-delete-dialog").hidden = true;
      get(panel, "#template-review-panel").hidden = true;
      status("世界或存档已替换，旧草稿与核对已失效。请明确新建、编辑或重新选择模板。"); syncDisabled();
    },
  };
}
