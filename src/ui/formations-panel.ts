import { unitById } from "../data/units";
import { previewFormationReplenishment } from "../game/formations";
import { FLYABLE_SHIP_IDS, MAX_FORMATIONS, MAX_FORMATION_QUANTITY, normalizeFormationDraft,
  type FormationAction, type FormationDraft, type FormationReplenishmentRequest } from "../game/formation-state";
import type { GameState } from "../game/types";
import { formationAuthoritySignature, formationMoney, formationPlanet, formationShips } from "./formations-present";
import "./formations.css";

export type FormationUiAction = FormationAction | {type:"formation-fill"; formationId:number; expectedRevision:number};
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
function get<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`缺少命名编成控件 ${selector}`);
  return element;
}
function put(root: ParentNode, selector: string, text: string) {
  const element = get(root, selector);
  if (element.textContent !== text) element.textContent = text;
}
const button = (action: string, label: string, id = "") => `<button type="button" data-formation-action="${action}"${id ? ` id="${id}"` : ""}>${label}</button>`;

export function formationsPanelHtml(): string {
  return `<details id="fleet-formations" class="fleet-formations"><summary>命名编成 · 保存数量，按需填入或有限补船</summary>
    <p class="muted formation-note">编成只保存名称与舰船数量，不保存派遣许可。选择和保存不会派船或付款；已填入的派遣数量可继续手动编辑。</p>
    <p id="formation-status" class="formation-note" role="status"></p>
    <div class="formation-layout"><div><div class="formation-actions">${button("new", "新建编成", "formation-new")}</div><p id="formation-count" class="muted"></p><div id="formation-library" class="formation-library"></div>
    <form id="formation-editor" class="ov-card formation-editor" hidden><h3 id="formation-editor-title">新建命名编成</h3>
      <label>名称（最多 64 个 Unicode 字符）<input id="formation-name" type="text" maxlength="128" autocomplete="off" required /></label>
      <p class="muted formation-note">至少一种可飞行舰船，数量为 0–1,000,000 的整数。无需已解锁或已拥有。编辑只影响未来使用。</p>
      <div class="formation-ship-grid">${FLYABLE_SHIP_IDS.map(id => `<label>${unitById(id).nameZh}<input data-formation-unit="${id}" type="number" min="0" max="${MAX_FORMATION_QUANTITY}" step="1" value="0" required aria-label="${unitById(id).nameZh}编成数量" /></label>`).join("")}</div>
      <div class="formation-actions"><button type="submit" data-formation-action="save" id="formation-save">保存编成</button>${button("cancel-edit", "取消编辑", "formation-cancel-edit")}</div>
    </form>
    <div id="formation-delete-dialog" class="ov-card" hidden><p id="formation-delete-label"></p><p id="formation-delete-references" class="formation-note"></p><div class="formation-actions">${button("confirm-delete", "确认删除未引用编成", "formation-confirm-delete")}${button("cancel-delete", "保留编成", "formation-cancel-delete")}</div></div></div>
    <section id="formation-selection" class="ov-card formation-selection" hidden><h3 id="formation-selected-title"></h3><p id="formation-selected-ships" class="formation-note"></p>
      <div class="formation-actions">${button("fill", "填入派遣数量", "formation-fill")}${button("close-selection", "关闭选择", "formation-close-selection")}</div>
      <p class="muted formation-note">填入会覆盖所有派遣舰种数量，未列舰种置 0；任务、目标、速度、货物和充能选项保持原值。库存不足不会自动裁剪，仍需通过原派遣检查。</p>
      <h3>一次有限补船</h3><label>本次固定付款 / 造船星球<select id="formation-payer"><option value="">请明确选择付款星球</option></select></label>
      <p class="muted formation-note">顶部切换星球不会改变这里。只计本星球现货和已付款待造；在途不抵扣，返航后可能超过目标。未付款计划不算拥有，有冲突须先处理原计划。</p>
      <div class="formation-actions">${button("preview", "预览本次缺额与固定预算", "formation-preview")}</div>
      <div id="formation-review-panel" class="formation-review" hidden><h4>一次补船核对</h4><p id="formation-review-summary"></p><div id="formation-review-rows" class="formation-review-rows"></div><p id="formation-review-total" class="formation-note"></p>
        <p class="muted formation-note">确认只登记固定新增数量，不立即付款。之后每 10 游戏秒按真实条件分批付款；各舰种独立预算，运输关闭。不自动补前置，不因出航、战损或取消队列扩大数量。</p>
        <div class="formation-actions">${button("replenish", "确认创建有限补船计划", "formation-confirm-replenish")}${button("cancel-review", "取消核对", "formation-cancel-review")}</div>
      </div>
    </section></div></details>`;
}

/** Explicit drafts and real-node capabilities survive ordinary renders, never world replacement. */
export function installFormationsPanel(root: HTMLElement, onAction: (action: FormationUiAction) => void) {
  const panel = get(root, "#fleet-formations");
  const editor = get<HTMLFormElement>(panel, "#formation-editor");
  const payer = get<HTMLSelectElement>(panel, "#formation-payer");
  const library = get(panel, "#formation-library");
  const selection = get(panel, "#formation-selection");
  const reviewPanel = get(panel, "#formation-review-panel");
  let latest: GameState | null = null;
  let ready = false, generation = 0, listSignature = "", planetSignature = "";
  type Identity = {id:number; revision:number; generation:number};
  type EditAuthority = {generation:number; nextId:number; formation:Identity | null};
  type ButtonAuthority = {action:string; generation:number; formation?:Identity};
  let selected: Identity | null = null, pendingDelete: Identity | null = null, edit: EditAuthority | null = null;
  let review: {request:FormationReplenishmentRequest; signature:string; generation:number} | null = null;
  let buttons = new WeakMap<HTMLButtonElement, ButtonAuthority>();
  function register(scope: ParentNode, identity?: Identity) {
    for (const item of scope.querySelectorAll<HTMLButtonElement>("button[data-formation-action]")) buttons.set(item, {action:item.dataset.formationAction!, generation, formation:identity});
  }
  register(panel);
  function retireRemoved(records: MutationRecord[]) {
    for (const record of records) for (const removed of record.removedNodes) if (removed instanceof Element) {
      if (removed instanceof HTMLButtonElement) buttons.delete(removed);
      for (const item of removed.querySelectorAll<HTMLButtonElement>("button")) buttons.delete(item);
    }
  }
  const observer = new MutationObserver(retireRemoved);
  observer.observe(panel, {childList:true, subtree:true});
  function renewButtons(scope: ParentNode) {
    retireRemoved(observer.takeRecords());
    for (const old of scope.querySelectorAll<HTMLButtonElement>("button[data-formation-action]")) {
      const authority = buttons.get(old); buttons.delete(old);
      const fresh = old.cloneNode(true) as HTMLButtonElement;
      old.replaceWith(fresh);
      if (authority) { fresh.dataset.formationAction = authority.action; buttons.set(fresh, {...authority, generation}); }
    }
  }
  const status = (value: string) => put(panel, "#formation-status", value);
  function valid(identity: Identity | null): identity is Identity {
    return !!identity && identity.generation === generation && !!latest?.formations.entries.some(item => item.id === identity.id && item.revision === identity.revision);
  }
  function references(identity: Identity | null): number[] {
    return identity && latest ? latest.orders.tasks.filter(task => task.formationOrigin?.formation.id === identity.id).map(task => task.id) : [];
  }
  function retireReview(message?: string) {
    review = null; renewButtons(reviewPanel); reviewPanel.hidden = true;
    get<HTMLButtonElement>(panel, "#formation-confirm-replenish").disabled = true;
    if (message) status(message);
  }
  function currentDraft(): FormationDraft {
    return {name:get<HTMLInputElement>(panel, "#formation-name").value,
      ships:Object.fromEntries(FLYABLE_SHIP_IDS.map(id => [id, Number(get<HTMLInputElement>(editor, `[data-formation-unit="${id}"]`).value)]))};
  }
  function openEditor(identity: Identity | null) {
    if (!latest || !ready || (identity && !valid(identity))) return;
    retireReview(); pendingDelete = null; get(panel, "#formation-delete-dialog").hidden = true;
    const formation = identity ? latest.formations.entries.find(item => item.id === identity.id)! : null;
    renewButtons(editor); edit = {generation, nextId:latest.formations.nextFormationId, formation:identity};
    get<HTMLInputElement>(panel, "#formation-name").value = formation?.name ?? "";
    for (const id of FLYABLE_SHIP_IDS) get<HTMLInputElement>(editor, `[data-formation-unit="${id}"]`).value = String(formation?.ships[id] ?? 0);
    put(panel, "#formation-editor-title", formation ? `编辑 #${formation.id} · 修订 ${formation.revision}` : "新建命名编成");
    editor.hidden = false; status("只保存名称与数量，不派船、不付款。已有计划保留创建时版本。");
    syncDisabled(); get<HTMLInputElement>(panel, "#formation-name").focus();
  }
  function chooseFormation(identity: Identity) {
    if (!valid(identity) || !latest) return;
    retireReview(); renewButtons(selection); selected = {...identity};
    const formation = latest.formations.entries.find(item => item.id === identity.id)!;
    put(panel, "#formation-selected-title", `#${formation.id} ${formation.name} · 修订 ${formation.revision}`);
    put(panel, "#formation-selected-ships", formationShips(formation));
    payer.value = ""; selection.hidden = false;
    status("已选择编成。填入派遣和有限补船都需要另行明确操作。"); syncDisabled();
  }
  function makeReview() {
    if (!latest || !ready || !valid(selected) || !payer.value) { status("请先选择已保存编成和固定付款星球。"); return; }
    retireReview();
    // The only UI pricing path: an explicit preview click, never an animation render.
    const quote = previewFormationReplenishment(latest, {formationId:selected.id, formationRevision:selected.revision, planetId:payer.value});
    put(panel, "#formation-review-summary", `固定付款 / 造船星球：${formationPlanet(latest, payer.value)}；新增 ${quote.request?.lines.length ?? quote.rows.filter(row => row.deficit > 0).length} 个本地有限计划。${quote.reason}`);
    get(panel, "#formation-review-rows").innerHTML = quote.rows.map(row => `<article data-formation-review-unit="${row.unit}"><p>${escape(unitById(row.unit).nameZh)}：目标 ${row.target} / 现货 ${row.localStock} / 已付款待造 ${row.paidQueueRemaining} / 本次固定新增 ${row.deficit}</p>${row.deficit > 0 ? `<p>真实单价：${escape(row.quotedUnitCost ? formationMoney(row.quotedUnitCost) : "无法精确表示")}<br />本项固定预算：${escape(row.budget ? formationMoney(row.budget) : "无法精确表示")}</p>` : `<p>无需补船，不创建计划。</p>`}${row.conflictingTaskIds.length ? `<p>冲突计划：${row.conflictingTaskIds.map(id => `#${id}`).join("、")}，整次不可创建。</p>` : ""}${row.warnings.length ? `<p>${escape(row.warnings.join("；"))}</p>` : ""}</article>`).join("");
    put(panel, "#formation-review-total", quote.request ? `本次总授权预算：${formationMoney(quote.request.totalBudget)}。每项仅使用自己的固定预算。` : quote.ok ? "无需补船，不产生预算、计划或费用。" : "当前不可创建，不授予补船授权。");
    reviewPanel.hidden = false;
    if (quote.ok && quote.request) review = {generation, signature:formationAuthoritySignature(latest, selected.id, payer.value), request:quote.request};
    put(panel, "#formation-confirm-replenish", `确认创建 ${quote.request?.lines.length ?? 0} 个有限补船计划`);
    status(review ? "请核对固定新增数量、付款星球和逐项精确预算；确认只创建一次。" : quote.reason);
    syncDisabled();
  }
  function updateDeleteReferences() {
    if (!pendingDelete) return;
    const ids = references(pendingDelete);
    put(panel, "#formation-delete-references", ids.length ? `仍被保留计划 ${ids.map(id => `#${id}`).join("、")} 引用（包括旧修订和已结束记录），不能删除。请先按原规则完成或取消并明确移除这些记录。` : "没有保留计划引用，可删除。删除不会改变已填入的派遣数量或真实舰船。");
  }
  function syncDisabled() {
    for (const item of panel.querySelectorAll<HTMLButtonElement>("button[data-formation-action]")) {
      const action = buttons.get(item)?.action;
      item.disabled = !ready || !action;
      if (action === "save") item.disabled ||= !edit;
      if (action === "fill" || action === "close-selection") item.disabled ||= !valid(selected);
      if (action === "preview") item.disabled ||= !valid(selected) || !payer.value;
      if (action === "replenish") item.disabled ||= !review;
      if (action === "confirm-delete") item.disabled ||= !valid(pendingDelete) || references(pendingDelete).length > 0;
      if (action === "new") item.disabled ||= !!latest && latest.formations.entries.length >= MAX_FORMATIONS;
    }
    for (const input of editor.querySelectorAll<HTMLInputElement>("input")) input.disabled = !ready || !edit;
    payer.disabled = !ready || !valid(selected);
  }
  function authorized(item: HTMLButtonElement | null): ButtonAuthority | null {
    retireRemoved(observer.takeRecords());
    if (!item || item.disabled || !panel.contains(item)) return null;
    const authority = buttons.get(item);
    if (!authority || authority.generation !== generation || item.dataset.formationAction !== authority.action) return null;
    if (authority.formation && (!valid(authority.formation) || item.dataset.formationId !== String(authority.formation.id) || item.dataset.formationRevision !== String(authority.formation.revision))) return null;
    return authority;
  }
  editor.addEventListener("submit", event => {
    event.preventDefault();
    if (!ready || !latest || !edit || edit.generation !== generation) return;
    if (event.submitter ? !(event.submitter instanceof HTMLButtonElement) || authorized(event.submitter)?.action !== "save" : !event.isTrusted) return;
    const draft = normalizeFormationDraft(currentDraft());
    if (!draft) { status("名称需为 1–64 个 Unicode 字符；至少一种可飞行舰船，数量需为 0–1,000,000 的整数。请修正草稿。"); return; }
    const authority = edit; edit = null; retireReview(); syncDisabled();
    onAction(authority.formation ? {type:"formation-edit", formationId:authority.formation.id, expectedRevision:authority.formation.revision, ...draft}
      : {type:"formation-create", expectedNextFormationId:authority.nextId, ...draft});
  });
  panel.addEventListener("click", event => {
    const item = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-formation-action]") : null;
    const authority = authorized(item);
    if (!authority || !ready || !latest) return;
    const action = authority.action;
    if (action === "new") openEditor(null);
    else if (action === "edit" && authority.formation) openEditor(authority.formation);
    else if (action === "select" && authority.formation) chooseFormation(authority.formation);
    else if (action === "delete" && authority.formation) {
      retireReview(); renewButtons(get(panel, "#formation-delete-dialog")); pendingDelete = {...authority.formation};
      const formation = latest.formations.entries.find(value => value.id === pendingDelete!.id)!;
      put(panel, "#formation-delete-label", `删除 #${formation.id} ${formation.name}？`);
      get(panel, "#formation-delete-dialog").hidden = false; updateDeleteReferences(); syncDisabled();
    } else if (action === "confirm-delete" && valid(pendingDelete)) {
      const identity = pendingDelete; pendingDelete = null; retireReview(); get(panel, "#formation-delete-dialog").hidden = true;
      onAction({type:"formation-delete", formationId:identity.id, expectedRevision:identity.revision});
    } else if (action === "cancel-delete") { pendingDelete = null; get(panel, "#formation-delete-dialog").hidden = true; }
    else if (action === "cancel-edit") { edit = null; editor.hidden = true; syncDisabled(); }
    else if (action === "close-selection") { selected = null; retireReview(); selection.hidden = true; syncDisabled(); }
    else if (action === "cancel-review") { retireReview("已取消核对。再次创建需要明确重新预览。"); syncDisabled(); }
    else if (action === "fill" && valid(selected)) onAction({type:"formation-fill", formationId:selected.id, expectedRevision:selected.revision});
    else if (action === "preview") makeReview();
    else if (action === "replenish" && review && review.generation === generation && valid(selected)) {
      const request = review.request;
      retireReview("本次确认已提交，重复点击不会再次创建。"); syncDisabled();
      onAction({type:"formation-replenish", request});
    }
  });
  panel.addEventListener("change", event => {
    if (event.target === payer) { retireReview(); syncDisabled(); }
    // Late unchanged input/change/blur never creates editor, selection or review authority.
  });
  return {
    update(state: GameState, writable: boolean) {
      latest = state; ready = writable;
      if (edit?.formation && !valid(edit.formation)) edit = null;
      if (pendingDelete && !valid(pendingDelete)) { pendingDelete = null; get(panel, "#formation-delete-dialog").hidden = true; }
      if (selected && !valid(selected)) { selected = null; retireReview("编成已修改或删除，请重新选择。"); selection.hidden = true; }
      if (review && (!selected || review.signature !== formationAuthoritySignature(state, selected.id, payer.value))) retireReview("缺额、编成或计划容量已改变，请明确重新预览。");
      const planets = JSON.stringify(state.planets.map(planet => [planet.id, planet.name]));
      if (planetSignature !== planets) {
        const selectedPayer = payer.value;
        payer.innerHTML = `<option value="">请明确选择付款星球</option>${state.planets.map(planet => `<option value="${escape(planet.id)}">${escape(planet.name)} [${escape(planet.id)}]</option>`).join("")}`;
        payer.value = state.planets.some(planet => planet.id === selectedPayer) ? selectedPayer : ""; planetSignature = planets;
      }
      const signature = JSON.stringify(state.formations);
      if (signature !== listSignature) {
        listSignature = signature; library.replaceChildren();
        for (const formation of state.formations.entries) {
          const row = document.createElement("article"); row.className = "ov-card"; row.dataset.formationId = String(formation.id);
          row.innerHTML = `<strong>#${formation.id} ${escape(formation.name)}</strong><span class="muted">修订 ${formation.revision} · ${escape(formationShips(formation))}</span><div class="formation-actions">${button("select", "选择编成")}${button("edit", "编辑编成")}${button("delete", "删除编成")}</div>`;
          for (const item of row.querySelectorAll<HTMLButtonElement>("button")) { item.dataset.formationId = String(formation.id); item.dataset.formationRevision = String(formation.revision); }
          register(row, {id:formation.id, revision:formation.revision, generation}); library.append(row);
        }
      }
      put(panel, "#formation-count", `已保存 ${state.formations.entries.length} / ${MAX_FORMATIONS} 个编成`);
      updateDeleteReferences(); syncDisabled();
    },
    completeAction(reason: string, ok: boolean) { status(reason); if (ok && !edit) editor.hidden = true; },
    invalidateAuthority() {
      generation++; latest = null; ready = false; selected = null; pendingDelete = null; edit = null; review = null;
      listSignature = ""; library.replaceChildren(); renewButtons(panel);
      selection.hidden = true; get(panel, "#formation-delete-dialog").hidden = true; reviewPanel.hidden = true;
      status("世界或存档已替换，旧编成选择与核对已失效。请明确重新选择、新建或编辑。"); syncDisabled();
    },
  };
}
