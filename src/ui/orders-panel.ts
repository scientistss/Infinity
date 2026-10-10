import type { GameState } from "../game/types";
import { isBuildingId } from "../data/buildings";
import { isResearchId } from "../data/research";
import { isUnitId, unitById } from "../data/units";
import { SPACE } from "../game/galaxy";
import { MAX_ORDER_LEVEL, MAX_ORDER_QUANTITY, MAX_ORDER_TRIPS, MAX_ORDER_SPEED_PERCENT, MIN_ORDER_SPEED_PERCENT, ORDER_SPEED_STEP, type CreateOrderRequest, type OrderAction, type OrderKind, type OrderMoney, type OrderTransportAuthorization } from "../game/order-state";
import { ORDER_KIND_LABEL, ORDER_RESOURCES, ORDER_TRANSPORT_SHIPS, orderChoices, type OrdersView } from "./orders-present";
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
    <p class="muted">只在固定执行星球付款和入队。可明确授权一个固定来源运输；建筑 / 研究达到目标等级即结束，造船按额外完成数量结束。</p>
    <form id="order-form"><div class="order-fields">
      <label>固定付款 / 执行星球<select id="order-planet" required></select></label>
      <label>计划类型<select id="order-kind"><option value="building">建筑</option><option value="research">研究</option><option value="shipyard">造船 / 防御</option></select></label>
      <label>目标<select id="order-target" required></select></label>
      <label><span id="order-goal-label">目标等级</span><input id="order-goal" type="number" min="1" max="${MAX_ORDER_LEVEL}" step="1" value="1" required /></label>
    </div><fieldset><legend>资源净支出上限（实际工作 + 不可退往返燃料）</legend><div class="order-budgets">${ORDER_RESOURCES.map(([id,label]) => `<label>${label}<input id="order-budget-${id}" type="text" inputmode="decimal" maxlength="256" value="0" required autocomplete="off" /></label>`).join("")}</div></fieldset>
    <label class="order-transport-toggle"><input id="order-transport-enabled" type="checkbox" /> 授权单源真实运输（默认关闭）</label>
    <fieldset id="order-transport-fields" hidden><legend>固定运输授权（创建后不能更改）</legend><div class="order-fields">
      <label>固定来源星球<select id="order-donor" required></select></label>
      <label>固定舰种<select id="order-ship">${ORDER_TRANSPORT_SHIPS.map(id => `<option value="${id}">${unitById(id).nameZh}</option>`).join("")}</select></label>
      <label>每次固定舰船数量<input id="order-ship-count" type="number" min="1" max="${SPACE.maxShips}" step="1" value="1" required /></label>
      <label>固定速度<select id="order-speed">${Array.from({length:(MAX_ORDER_SPEED_PERCENT-MIN_ORDER_SPEED_PERCENT)/ORDER_SPEED_STEP+1},(_,i)=>MAX_ORDER_SPEED_PERCENT-i*ORDER_SPEED_STEP).map(n=>`<option value="${n}">${n}%</option>`).join("")}</select></label>
      <label>最多出发次数<input id="order-max-trips" type="number" min="1" max="${MAX_ORDER_TRIPS}" step="1" value="1" required /></label>
    </div><p id="order-donor-stock" class="muted"></p><p class="muted">累计毛发出上限：召回、取消、返货均不恢复额度；燃料另计净支出。每个固定子任务最多运输一次，必须一船完整补齐缺口。</p>
    <div class="order-budgets">${ORDER_RESOURCES.map(([id,label]) => `<label>${label}毛发出上限<input id="order-cargo-cap-${id}" type="text" inputmode="decimal" maxlength="256" value="0" required autocomplete="off" /></label>`).join("")}</div></fieldset>
    <p id="order-review" class="order-review"></p><p id="order-draft-status" class="muted" role="status"></p>
    <div class="order-actions"><button id="order-create" type="submit">创建有限计划</button><button type="button" id="order-new">新计划</button></div></form>
    <details><summary>付款、暂停与取消</summary><p class="muted">每 10 游戏秒检查一次。实际入队时按原价付款；资源、条件或预算不足会等待。暂停只阻止新的付款，已付款工作继续。取消会尝试取消本计划的精确工作并退还未完成部分；失败时保留工作并暂停。净支出 = 实际工作付款 + 往返燃料 − 实际退款，预算还包含当前未付款工作预留。运输只搬运真实资源；船、燃料和货舱不足会等待，不自动换来源或增船。已交付和已返港分别记录；终止计划的船仍需真实返港。</p></details>
  </div><div><h3 class="group-title">计划记录</h3><p id="order-empty" class="muted">尚无计划。三个预算默认均为 0，创建本身不会付款。</p><div id="order-list" class="order-list"></div></div></div>`;
}

/** DOM fields are draft authority, never overwritten by animation renders or planet navigation. */
export function installOrdersPanel(root: HTMLElement, onAction: (action: OrderAction) => void) {
  const form = node<HTMLFormElement>(root, "#order-form");
  const planet = node<HTMLSelectElement>(root, "#order-planet");
  const kind = node<HTMLSelectElement>(root, "#order-kind");
  const target = node<HTMLSelectElement>(root, "#order-target");
  const goal = node<HTMLInputElement>(root, "#order-goal");
  const enabled = node<HTMLInputElement>(root, "#order-transport-enabled");
  const donor = node<HTMLSelectElement>(root, "#order-donor");
  const ship = node<HTMLSelectElement>(root, "#order-ship");
  let transportInitialized = false;
  const rows = new Map<number, HTMLElement>();
  let latest: OrdersView | null = null;
  let latestState: GameState | null = null;
  let writable = true, bootstrapped = false;
  let nonce: number | null = null;
  let planetSignature = "";
  let attempted = false;
  let retired = false;
  type ButtonAuthority = {taskId: number; type: string; fleetId?: number};
  let taskButtons = new WeakMap<HTMLButtonElement, ButtonAuthority>();
  let lastDraftSignature: string | null = null;
  let targetKind: string | null = null;
  function draftSignature(): string {
    return JSON.stringify([planet.value,kind.value,target.value,goal.value,
      ...ORDER_RESOURCES.map(([id]) => node<HTMLInputElement>(root, `#order-budget-${id}`).value),
      enabled.checked, donor.value, ship.value, node<HTMLInputElement>(root,"#order-ship-count").value,
      node<HTMLSelectElement>(root,"#order-speed").value, node<HTMLInputElement>(root,"#order-max-trips").value,
      ...ORDER_RESOURCES.map(([id]) => node<HTMLInputElement>(root, `#order-cargo-cap-${id}`).value)]);
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
  function transport(): OrderTransportAuthorization | null {
    if (!enabled.checked) return null;
    return {donorPlanetId:donor.value, ship:ship.value as OrderTransportAuthorization["ship"],
      count:Number(node<HTMLInputElement>(root,"#order-ship-count").value), speedPercent:Number(node<HTMLSelectElement>(root,"#order-speed").value),
      maxTrips:Number(node<HTMLInputElement>(root,"#order-max-trips").value),
      grossCargoCap:Object.fromEntries(ORDER_RESOURCES.map(([id]) => [id,node<HTMLInputElement>(root,`#order-cargo-cap-${id}`).value.trim()])) as OrderMoney};
  }
  function review() {
    const caps = budget(), auth = transport();
    node(root,"#order-transport-fields").hidden = !enabled.checked;
    const available = latestState
      ? latestState.planets.find(p => p.id === donor.value)?.units[ship.value as typeof ORDER_TRANSPORT_SHIPS[number]]
      : latest?.donorShips.find(p => p.planetId === donor.value)?.ships.find(s => s.id === ship.value)?.count;
    text(root,"#order-donor-stock", `来源星球现有该舰种 ${available ?? 0} 艘；选择和数量不会自动调整。`);
    text(root, "#order-review", `确认：${planet.selectedOptions[0]?.textContent ?? "请选择星球"} · ${ORDER_KIND_LABEL[kind.value as OrderKind]} ${target.selectedOptions[0]?.textContent ?? ""} · ${kind.value === "shipyard" ? "额外" : "目标"} ${goal.value}${kind.value === "shipyard" ? " 个" : " 级"}；净支出上限：${ORDER_RESOURCES.map(([id,label]) => `${label} ${caps[id]}`).join(" / ")}${auth ? `；单源运输：${donor.selectedOptions[0]?.textContent ?? auth.donorPlanetId} → 执行星球，${ship.selectedOptions[0]?.textContent ?? auth.ship} × ${auth.count}，${auth.speedPercent}%，最多 ${auth.maxTrips} 次；毛发出上限：${ORDER_RESOURCES.map(([id,label]) => `${label} ${auth.grossCargoCap[id]}`).join(" / ")}` : "；未授权运输"}`);
    text(root, "#order-draft-status", retired ? "存档已替换，旧草稿授权已失效。请检查目标和预算，编辑表单或点“新计划”后再创建。" : attempted ? "本次创建已提交；重复点击不会再次创建。修改表单或点“新计划”可重新授权。" : "切换顶部当前星球不会更改这个计划的付款星球。");
  }
  function edited(explicitNew = false) {
    const signature = draftSignature();
    // Blur can deliver an earlier edit's change event after a file import has
    // retired its authority. Only genuinely changed values or New plan renew it.
    if (!explicitNew && signature === lastDraftSignature) { review(); return; }
    lastDraftSignature = signature;
    nonce = latestState?.orders.nextTaskId ?? latest?.nextTaskId ?? null;
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
    if (!(event.target instanceof HTMLSelectElement) && event.target !== enabled) return;
    if (event.target === kind) populateTargets();
    edited();
  });
  node(root, "#order-new").addEventListener("click", () => edited(true));
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!writable || nonce === null || attempted) return;
    const common = {planetId: planet.value, expectedNextTaskId: nonce, budget: budget(), transport:transport()};
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
    if (!writable || !button || button.disabled || !node(root,"#order-list").contains(button)) return;
    const taskId = Number(button.dataset.taskId), type = button.dataset.orderAction;
    const authority = taskButtons.get(button);
    if (!authority || authority.taskId !== taskId || authority.type !== type || !Number.isSafeInteger(taskId) || taskId <= 0) return;
    if (type === "order-retry-dock") {
      const fleetId = Number(button.dataset.fleetId);
      if (authority.fleetId === fleetId && Number.isSafeInteger(fleetId) && fleetId > 0) onAction({type,taskId,fleetId});
      return;
    }
    if (type === "order-pause" || type === "order-resume" || type === "order-cancel" || type === "order-dismiss") onAction({type, taskId});
  });
  populateTargets();
  function syncFormDisabled() {
    for (const input of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")) input.disabled = !writable || (!!input.closest("#order-transport-fields") && !enabled.checked);
  }
  function syncDisabled() {
    syncFormDisabled();
    // Reuse only the already projected row policy: no ledger projection and no
    // draft nonce renewal. A blocked return must still prevent Resume.
    for (const item of latest?.rows ?? []) {
      const row = rows.get(item.id);
      if (!row) continue;
      for (const button of row.querySelectorAll<HTMLButtonElement>("button")) {
        button.disabled = !writable || (taskButtons.get(button)?.type === "order-resume" && item.retryFleetId !== null);
      }
    }
  }
  type DraftContext = Pick<OrdersView, "planets" | "donorShips" | "initialPlanetId" | "nextTaskId">;
  function updateDraftContext(model: DraftContext) {
    if (nonce === null && !retired) nonce = model.nextTaskId;
    const signature = JSON.stringify(model.planets);
    if (signature !== planetSignature) {
      const selected = planetSignature ? planet.value : model.initialPlanetId;
      planetSignature = signature;
      const choices = [...model.planets];
      if (selected && !choices.some(p => p.id === selected)) choices.push({id: selected, name: `${selected}（已不存在）`});
      planet.replaceChildren(...choices.map(p => { const option = document.createElement("option"); option.value = p.id; option.textContent = p.name; return option; }));
      planet.value = selected;
      const selectedDonor = transportInitialized ? donor.value : model.planets.find(p => p.id !== selected)?.id ?? selected;
      const donorChoices = [...model.planets];
      if (selectedDonor && !donorChoices.some(p => p.id === selectedDonor)) donorChoices.push({id:selectedDonor,name:`${selectedDonor}（已不存在）`});
      donor.replaceChildren(...donorChoices.map(p => {const option=document.createElement("option");option.value=p.id;option.textContent=p.name;return option;}));
      donor.value = selectedDonor;
      if (!transportInitialized) {
        const available = model.donorShips.find(p => p.planetId === selectedDonor)?.ships;
        const preferred = ["small_cargo","large_cargo"].find(id => available?.some(s => s.id === id && s.count > 0));
        if (preferred) ship.value = preferred;
        transportInitialized = true;
      }
    }
    if (lastDraftSignature === null) lastDraftSignature = draftSignature();
    review();
    syncFormDisabled();
  }
  function observe(state: GameState, ready: boolean) {
    const maskChanged = latestState === null || writable !== ready;
    latestState = state; writable = ready;
    if (bootstrapped) {
      if (maskChanged) syncDisabled();
      return;
    }
    // Preserve the startup draft's payer, donor, preferred ship, and counter even
    // if Orders is first opened only after navigating to another active planet.
    // The one-time bootstrap excludes every order row and its transport ledger.
    bootstrapped = true;
    updateDraftContext({
      planets: state.planets.map(p => ({id:p.id, name:`${p.name} [${p.coordinates.galaxy}:${p.coordinates.system}:${p.coordinates.position}]`})),
      donorShips: state.planets.map(p => ({planetId:p.id, ships:ORDER_TRANSPORT_SHIPS.map(id => ({id, count:p.units[id]}))})),
      initialPlanetId: state.activePlanetId,
      nextTaskId: state.orders.nextTaskId,
    });
  }
  const update = (model: OrdersView, ready = true) => {
    latest = model; writable = ready;
    bootstrapped = true;
    updateDraftContext(model);
    const list = node(root, "#order-list");
    const ids = new Set(model.rows.map(row => row.id));
    for (const [id,row] of rows) if (!ids.has(id)) {for (const button of row.querySelectorAll<HTMLButtonElement>("button")) taskButtons.delete(button);row.remove();rows.delete(id);}
    for (const item of model.rows) {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement("article"); row.className = "ov-card order-row"; row.dataset.orderId = String(item.id);
        row.innerHTML = `<strong data-order="title"></strong><span class="muted" data-order="location"></span><span data-order="progress"></span><div class="queue-bar"><span data-order="bar"></span></div><span data-order="spending"></span><span class="muted" data-order="job"></span><span data-order="work"></span><span data-order="transport"></span><span data-order="limits"></span><span class="order-reason" data-order="reason"></span><div class="order-actions">${[["order-pause","暂停"],["order-resume","恢复"],["order-cancel","取消计划"],["order-dismiss","移除记录"]].map(([action,label]) => `<button type="button" data-order-action="${action}" data-task-id="${item.id}"${action.includes("cancel") || action.includes("dismiss") ? ' class="danger"' : ""}>${escaped(label!)}</button>`).join("")}</div>`;
        for (const button of row.querySelectorAll<HTMLButtonElement>("button[data-order-action]")) {
          taskButtons.set(button,{taskId:item.id,type:button.dataset.orderAction!});
        }
        rows.set(item.id,row); list.append(row);
      }
      row.dataset.orderStatus = item.status;
      for (const [field,value] of [["title",item.title],["location",item.location],["progress",item.progress],["spending",item.spending],["job",item.activeJob],["work",item.work],["transport",item.transport],["limits",item.limits],["reason",item.reason]]) text(row, `[data-order="${field}"]`, value!);
      node(row, '[data-order="bar"]').style.width = `${item.progressPct}%`;
      let retry = row.querySelector<HTMLButtonElement>('[data-order-action="order-retry-dock"]');
      if (retry && Number(retry.dataset.fleetId) !== item.retryFleetId) {taskButtons.delete(retry);retry.remove();retry=null;}
      if (!retry && item.retryFleetId !== null) {
        retry=document.createElement("button");retry.type="button";retry.dataset.orderAction="order-retry-dock";
        retry.dataset.taskId=String(item.id);retry.dataset.fleetId=String(item.retryFleetId);retry.textContent=`重试舰队 #${item.retryFleetId} 返港入库`;
        taskButtons.set(retry,{taskId:item.id,type:"order-retry-dock",fleetId:item.retryFleetId});
        node(row,".order-actions").append(retry);
      }
      const terminal = item.status === "completed" || item.status === "cancelled";
      for (const button of row.querySelectorAll<HTMLButtonElement>("button")) {
        button.hidden = button.dataset.orderAction === "order-retry-dock" ? item.retryFleetId === null : button.dataset.orderAction === "order-dismiss" ? !item.canDismiss : button.dataset.orderAction === "order-pause" ? item.status !== "running" : button.dataset.orderAction === "order-resume" ? item.status !== "paused" : terminal;
        button.disabled = !ready || (button.dataset.orderAction === "order-resume" && item.retryFleetId !== null);
        button.title = button.dataset.orderAction === "order-resume" && item.retryFleetId !== null ? "请先重试返港入库，再恢复计划" : "";
      }
    }
    node(root,"#order-empty").hidden = model.rows.length > 0;
  };
  return {
    observe,
    update,
    invalidateOrderAuthority() {
      // Keep the user's visible draft for review, but require a deliberate edit
      // before it can authorize work against the replacement save's counters.
      lastDraftSignature = draftSignature();
      retired = true;
      nonce = null;
      latest = null;
      latestState = null;
      // Retire capabilities without inventing a protected session or blurring a
      // live draft. The next observe() applies the replacement's actual readiness.
      attempted = false;
      taskButtons = new WeakMap<HTMLButtonElement, ButtonAuthority>();
      rows.clear();
      node(root,"#order-list").replaceChildren();
      review();
      syncDisabled();
    },
  };
}
