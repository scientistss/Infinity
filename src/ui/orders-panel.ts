import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId } from "../data/units";
import { MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, type CreateOrderRequest, type OrderAction, type OrderKind, type OrderMoney } from "../game/order-state";
import { ORDER_KIND_LABEL, ORDER_RESOURCES, orderChoices, type OrdersView } from "./orders-present";
import "./orders.css";

const escaped = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]!);
function node<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`缺少计划控件 ${selector}`);
  return found;
}
function text(root: ParentNode, selector: string, value: string) {
  const el = node(root, selector);
  if (el.textContent !== value) el.textContent = value;
}
export function ordersPanelHtml(): string {
  return `<div class="orders-layout"><div class="ov-card order-form-card"><h3><img class="icon" src="${import.meta.env.BASE_URL}icons/protocol_card.webp" alt="" /> 有限计划</h3>
    <p class="muted">只在选定星球付款和入队。建筑 / 研究达到目标等级即结束；造船按本计划额外完成数量结束。</p>
    <form id="order-form"><div class="order-fields">
      <label>固定付款 / 执行星球<select id="order-planet" required></select></label>
      <label>计划类型<select id="order-kind"><option value="building">建筑</option><option value="research">研究</option><option value="shipyard">造船 / 防御</option></select></label>
      <label>目标<select id="order-target" required></select></label>
      <label><span id="order-goal-label">目标等级</span><input id="order-goal" type="number" min="1" max="${MAX_ORDER_LEVEL}" step="1" value="1" required /></label>
    </div><fieldset><legend>资源净支出上限（固定，不自动追加）</legend><div class="order-budgets">${ORDER_RESOURCES.map(([id,label]) => `<label>${label}<input id="order-budget-${id}" type="text" inputmode="decimal" maxlength="256" value="0" required autocomplete="off" /></label>`).join("")}</div></fieldset>
    <p id="order-review" class="order-review"></p><p id="order-draft-status" class="muted" role="status"></p>
    <div class="order-actions"><button id="order-create" type="submit">创建有限计划</button><button type="button" id="order-new">新计划</button></div></form>
    <details><summary>付款、暂停与取消</summary><p class="muted">每 10 游戏秒检查一次。实际入队时按原价付款；资源、条件或预算不足会等待。暂停只阻止新的付款，已付款工作继续。取消会尝试取消本计划的精确工作并退还未完成部分；失败时保留工作并暂停。净支出 = 累计付款 − 实际退款，已完成单位的费用仍计入上限。当前只支持本地有限队列。</p></details>
  </div><div><h3 class="group-title">计划记录</h3><p id="order-empty" class="muted">尚无计划。三个预算默认均为 0，创建本身不会付款。</p><div id="order-list" class="order-list"></div></div></div>`;
}

/** DOM fields are draft authority, never overwritten by animation renders or planet navigation. */
export function installOrdersPanel(root: HTMLElement, onAction: (action: OrderAction) => void) {
  const form = node<HTMLFormElement>(root, "#order-form");
  const planet = node<HTMLSelectElement>(root, "#order-planet");
  const kind = node<HTMLSelectElement>(root, "#order-kind");
  const target = node<HTMLSelectElement>(root, "#order-target");
  const goal = node<HTMLInputElement>(root, "#order-goal");
  const rows = new Map<number, HTMLElement>();
  let latest: OrdersView | null = null;
  let nonce: number | null = null;
  let planetSignature = "";
  let attempted = false;
  let retired = false;
  let taskButtons = new WeakMap<HTMLButtonElement, {taskId: number; type: string}>();
  let lastDraftSignature: string | null = null;
  let targetKind: string | null = null;
  function draftSignature(): string {
    return JSON.stringify([planet.value,kind.value,target.value,goal.value,
      ...ORDER_RESOURCES.map(([id]) => node<HTMLInputElement>(root, `#order-budget-${id}`).value)]);
  }
  function populateTargets() {
    if (targetKind === kind.value) return;
    targetKind = kind.value;
    const choices = orderChoices(kind.value as OrderKind);
    target.replaceChildren(...choices.map(choice => {
      const option = document.createElement("option"); option.value = choice.id; option.textContent = choice.name; return option;
    }));
    const ships = kind.value === "shipyard";
    text(root, "#order-goal-label", ships ? "额外完成数量" : "目标等级");
    goal.max = String(ships ? MAX_ORDER_QUANTITY : MAX_ORDER_LEVEL);
  }
  function budget(): OrderMoney {
    return Object.fromEntries(ORDER_RESOURCES.map(([id]) => [id, node<HTMLInputElement>(root, `#order-budget-${id}`).value.trim()])) as OrderMoney;
  }
  function review() {
    const caps = budget();
    text(root, "#order-review", `确认：${planet.selectedOptions[0]?.textContent ?? "请选择星球"} · ${ORDER_KIND_LABEL[kind.value as OrderKind]} ${target.selectedOptions[0]?.textContent ?? ""} · ${kind.value === "shipyard" ? "额外" : "目标"} ${goal.value}${kind.value === "shipyard" ? " 个" : " 级"}；净支出上限：${ORDER_RESOURCES.map(([id,label]) => `${label} ${caps[id]}`).join(" / ")}`);
    text(root, "#order-draft-status", retired ? "存档已替换，旧草稿授权已失效。请检查目标和预算，编辑表单或点“新计划”后再创建。" : attempted ? "本次创建已提交；重复点击不会再次创建。修改表单或点“新计划”可重新授权。" : "切换顶部当前星球不会更改这个计划的付款星球。");
  }
  function edited(explicitNew = false) {
    const signature = draftSignature();
    // Blur can deliver an earlier edit's change event after a file import has
    // retired its authority. Only genuinely changed values or New plan renew it.
    if (!explicitNew && signature === lastDraftSignature) { review(); return; }
    lastDraftSignature = signature;
    nonce = latest?.nextTaskId ?? null;
    attempted = false;
    retired = false;
    review();
  }
  form.addEventListener("input", event => {
    if (event.target === kind) populateTargets();
    edited();
  });
  form.addEventListener("change", event => {
    // Text/number edits already arrive through input. Their delayed blur/change
    // is never new authority; unchanged select changes are also signature-gated.
    if (!(event.target instanceof HTMLSelectElement)) return;
    if (event.target === kind) populateTargets();
    edited();
  });
  node(root, "#order-new").addEventListener("click", () => edited(true));
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (nonce === null || attempted) return;
    const common = {planetId: planet.value, expectedNextTaskId: nonce, budget: budget()};
    let request: CreateOrderRequest;
    if (kind.value === "building" && isBuildingId(target.value)) request = {...common, kind: "building", building: target.value, targetLevel: Number(goal.value)};
    else if (kind.value === "research" && isResearchId(target.value)) request = {...common, kind: "research", tech: target.value, targetLevel: Number(goal.value)};
    else if (kind.value === "shipyard" && isUnitId(target.value)) request = {...common, kind: "shipyard", unit: target.value, quantity: Number(goal.value)};
    else return;
    attempted = true;
    lastDraftSignature = draftSignature();
    onAction({type: "order-create", request});
    review();
  });
  node(root, "#order-list").addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-order-action]") : null;
    if (!button || button.disabled) return;
    const taskId = Number(button.dataset.taskId), type = button.dataset.orderAction;
    const authority = taskButtons.get(button);
    if (!authority || authority.taskId !== taskId || authority.type !== type || !Number.isSafeInteger(taskId) || taskId <= 0) return;
    if (type === "order-pause" || type === "order-resume" || type === "order-cancel" || type === "order-dismiss") onAction({type, taskId});
  });
  populateTargets();
  const update = (model: OrdersView, ready = true) => {
    latest = model;
    if (nonce === null && !retired) nonce = model.nextTaskId;
    const signature = JSON.stringify(model.planets);
    if (signature !== planetSignature) {
      const selected = planetSignature ? planet.value : model.initialPlanetId;
      planetSignature = signature;
      const choices = [...model.planets];
      if (selected && !choices.some(p => p.id === selected)) choices.push({id: selected, name: `${selected}（已不存在）`});
      planet.replaceChildren(...choices.map(p => { const option = document.createElement("option"); option.value = p.id; option.textContent = p.name; return option; }));
      planet.value = selected;
    }
    if (lastDraftSignature === null) lastDraftSignature = draftSignature();
    review();
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")) input.disabled = !ready;
    const list = node(root, "#order-list");
    const ids = new Set(model.rows.map(row => row.id));
    for (const [id,row] of rows) if (!ids.has(id)) {row.remove();rows.delete(id);}
    for (const item of model.rows) {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement("article"); row.className = "ov-card order-row"; row.dataset.orderId = String(item.id);
        row.innerHTML = `<strong data-order="title"></strong><span class="muted" data-order="location"></span><span data-order="progress"></span><div class="queue-bar"><span data-order="bar"></span></div><span data-order="spending"></span><span class="muted" data-order="job"></span><span class="order-reason" data-order="reason"></span><div class="order-actions">${[["order-pause","暂停"],["order-resume","恢复"],["order-cancel","取消计划"],["order-dismiss","移除记录"]].map(([action,label]) => `<button type="button" data-order-action="${action}" data-task-id="${item.id}"${action.includes("cancel") || action.includes("dismiss") ? ' class="danger"' : ""}>${escaped(label!)}</button>`).join("")}</div>`;
        for (const button of row.querySelectorAll<HTMLButtonElement>("button[data-order-action]")) {
          taskButtons.set(button,{taskId:item.id,type:button.dataset.orderAction!});
        }
        rows.set(item.id,row); list.append(row);
      }
      row.dataset.orderStatus = item.status;
      for (const [field,value] of [["title",item.title],["location",item.location],["progress",item.progress],["spending",item.spending],["job",item.activeJob],["reason",item.reason]]) text(row, `[data-order="${field}"]`, value!);
      node(row, '[data-order="bar"]').style.width = `${item.progressPct}%`;
      const terminal = item.status === "completed" || item.status === "cancelled";
      for (const button of row.querySelectorAll<HTMLButtonElement>("button")) {
        button.hidden = button.dataset.orderAction === "order-dismiss" ? !terminal : button.dataset.orderAction === "order-pause" ? item.status !== "running" : button.dataset.orderAction === "order-resume" ? item.status !== "paused" : terminal;
        button.disabled = !ready;
      }
    }
    node(root,"#order-empty").hidden = model.rows.length > 0;
  };
  return {
    update,
    invalidateOrderAuthority() {
      // Keep the user's visible draft for review, but require a deliberate edit
      // before it can authorize work against the replacement save's counters.
      lastDraftSignature = draftSignature();
      retired = true;
      nonce = null;
      latest = null;
      attempted = false;
      taskButtons = new WeakMap<HTMLButtonElement, {taskId: number; type: string}>();
      rows.clear();
      node(root,"#order-list").replaceChildren();
      review();
    },
  };
}
