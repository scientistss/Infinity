import { buildingById } from "../data/buildings";
import type { DemolitionQuote } from "../game/demolition";
import { DEMOLISHABLE_BUILDING_IDS, type DemolitionJobRef } from "../game/demolition-state";
import { activePlanet } from "../game/empire";
import { formatDuration } from "../game/format";
import type { GameState } from "../game/types";
import type { OfflineCatchup } from "../core/offline";
import { DemolitionReview } from "./demolition-review-model";
import { demolitionFee, demolitionOfflineRows, demolitionPreview } from "./demolition-present";
import "./demolition.css";

export type DemolitionUiAction = { type: "demolition-confirm"; quote: DemolitionQuote }
  | { type: "demolition-cancel"; request: DemolitionJobRef };

export function installDemolitionPanel(root: HTMLElement, onAction: (action: DemolitionUiAction) => void) {
  const tab = root.querySelector<HTMLElement>('[data-tab-panel="facilities"]');
  if (!tab) throw Error("缺少建筑页");
  const panel = document.createElement("section");
  panel.id = "demolition-review";
  panel.className = "demolition-review";
  panel.setAttribute("aria-labelledby", "demolition-review-title");
  panel.hidden = true;
  panel.innerHTML = '<h3 id="demolition-review-title">拆除核对</h3><p id="demolition-review-fee"></p><p id="demolition-review-time"></p><ul id="demolition-review-losses"></ul><p id="demolition-review-reason" class="demolition-reason" role="status"></p><div class="demolition-actions" id="demolition-review-actions"></div>';
  const work = document.createElement("section");
  work.id = "demolition-job";
  work.className = "demolition-job";
  work.hidden = true;
  work.innerHTML = '<h3 id="demolition-job-title"></h3><p id="demolition-job-time"></p><p id="demolition-job-fee"></p><p>施工中保留原等级与功能，本星不能新增建筑工作。完工不返还历史投入。</p><div id="demolition-job-actions" class="demolition-actions"></div><p id="demolition-job-reason" class="demolition-reason" role="status"></p>';
  const anchor = tab.querySelector(".group-title");
  if (anchor) anchor.before(work, panel); else tab.append(work, panel);
  const offline = document.createElement("div");
  offline.id = "offline-demolitions"; offline.hidden = true;
  offline.innerHTML = '<h3 class="offline-sub">离线期间完成的拆除</h3><ul class="offline-gains offline-builds"></ul>';
  root.querySelector('[data-bind="offline-builds"]')?.after(offline);
  function node<T extends HTMLElement = HTMLElement>(id: string): T {
    const value = root.querySelector<T>(`#${id}`);
    if (!value) throw Error(`缺少拆除控件 ${id}`);
    return value;
  }
  const title = node("demolition-review-title"), fee = node("demolition-review-fee"), time = node("demolition-review-time");
  const losses = node("demolition-review-losses"), reason = node("demolition-review-reason"), actions = node("demolition-review-actions");
  const jobTitle = node("demolition-job-title"), jobTime = node("demolition-job-time"), jobFee = node("demolition-job-fee");
  const jobActions = node("demolition-job-actions"), jobReason = node("demolition-job-reason");
  const review = new DemolitionReview();
  let state: GameState | null = null, writable = false, retired = false;
  let confirm: HTMLButtonElement | null = null, cancel: HTMLButtonElement | null = null;
  let jobKey = "";
  let observedWorld = "";
  const entries = DEMOLISHABLE_BUILDING_IDS.flatMap(building => {
    const card = root.querySelector<HTMLElement>(`[data-bind="bld-${building}"]`);
    if (!card) return [];
    const row = document.createElement("div");
    row.className = "demolition-entry";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.demolish = building;
    button.textContent = "拆除一级…";
    button.disabled = true;
    row.append(button);
    card.append(row);
    button.addEventListener("click", () => {
      if (!mounted() || button.disabled || !state || !writable || tab.hidden || document.hidden) return;
      const quote = review.open(state, building, writable);
      panel.hidden = false;
      title.textContent = quote ? demolitionPreview(state, quote).title : `${activePlanet(state).name} · ${buildingById(building).nameZh}`;
      fee.textContent = ""; time.textContent = ""; delete time.dataset.totalSeconds; losses.replaceChildren();
      if (quote) {
        const model = demolitionPreview(state, quote);
        fee.textContent = model.fee; time.textContent = model.time; time.dataset.totalSeconds = String(model.totalSeconds);
        for (const text of model.losses) { const li = document.createElement("li"); li.textContent = text; losses.append(li); }
      }
      reason.textContent = review.reason;
      // Every review gets fresh nodes and a one-shot token. A retained old node
      // can never acquire the next review's consent, even at the same coordinates.
      confirm = null;
      actions.replaceChildren();
      const token = review.token;
      const pay = document.createElement("button");
      pay.type = "button"; pay.dataset.demolitionConfirm = ""; pay.textContent = "确认付费拆除一级"; pay.disabled = !quote || !!review.paymentProblem(state);
      const dismiss = document.createElement("button");
      dismiss.type = "button"; dismiss.dataset.demolitionDismiss = ""; dismiss.textContent = "取消核对";
      actions.append(pay, dismiss);
      confirm = pay;
      pay.addEventListener("click", () => {
        if (!mounted() || confirm !== pay || pay.disabled || !state || !writable || panel.hidden || tab.hidden || document.hidden || !actions.contains(pay)) return;
        const fresh = review.consume(state, token);
        pay.disabled = true;
        if (!fresh) { reason.textContent = review.reason || "核对已失效，请重新打开。"; return; }
        panel.hidden = true;
        onAction({ type: "demolition-confirm", quote: fresh });
      });
      dismiss.addEventListener("click", () => {
        if (!mounted() || !actions.contains(dismiss)) return;
        invalidate(); panel.hidden = true;
      });
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return [{ building, button, row }];
  });
  const fixed = [tab, panel, work, actions, jobActions, ...entries.map(entry => entry.button)];
  const observer = new MutationObserver(removed);
  const watched = new Set<Node>();
  for (const item of [...fixed, actions, jobActions]) for (let parent: Node | null = item.parentNode; parent; parent = parent.parentNode) {
    if (!watched.has(parent)) { watched.add(parent); observer.observe(parent, { childList: true }); }
  }
  observer.observe(actions, { childList: true }); observer.observe(jobActions, { childList: true });
  function removed(records: MutationRecord[]) {
    for (const record of records) for (const item of record.removedNodes) {
      if (!(item instanceof Element)) continue;
      if (fixed.some(value => item === value || item.contains(value))) { retired = true; observer.disconnect(); invalidate("拆除界面已更换，请重新载入页面。"); }
      if (confirm && (item === confirm || item.contains(confirm))) invalidate("核对按钮已更换，请重新核对。");
      if (cancel && (item === cancel || item.contains(cancel))) { cancel.disabled = true; cancel = null; }
    }
  }
  function mounted(): boolean {
    removed(observer.takeRecords());
    return !retired && root.isConnected && fixed.every(value => value.isConnected && root.contains(value));
  }
  function invalidate(message = "") {
    review.invalidate(message);
    if (confirm) confirm.disabled = true;
    if (message && !panel.hidden) reason.textContent = message;
  }
  // Invalidate as events happen, not when a later paint happens to see the final
  // value. Thus hidden A→B→A edits/navigation cannot revive a reviewed quote.
  const values = new WeakMap<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, string>();
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea")) values.set(input, input.value);
  for (const type of ["input", "change"]) root.addEventListener(type, event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) return;
    const value = input instanceof HTMLInputElement && input.type === "checkbox" ? String(input.checked) : input.value;
    if (values.get(input) !== value) { values.set(input, value); invalidate("输入已改变，请重新核对拆除。"); }
  }, true);
  root.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-tab]") : null;
    if (button && button.dataset.tab !== "facilities") invalidate("已离开建筑页，请重新核对拆除。");
  }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) invalidate("页面已离开，请重新核对拆除。"); });
  return {
    updateOffline(catchup: OfflineCatchup | null) {
      const rows = demolitionOfflineRows(catchup);
      offline.hidden = rows.length === 0;
      const list = offline.querySelector("ul")!;
      if (list.dataset.signature === JSON.stringify(rows)) return;
      list.dataset.signature = JSON.stringify(rows);
      list.replaceChildren(...rows.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
    },
    invalidate() { invalidate("存档或世界已替换，请重新核对拆除。"); jobKey = ""; if (cancel) cancel.disabled = true; cancel = null; },
    complete(message: string) { jobReason.textContent = message; reason.textContent = message; },
    observe(next: GameState, ready: boolean) {
      const world = `${next.universe.seed}:${next.stats.launches}:${next.activePlanetId}`;
      if (observedWorld && observedWorld !== world) { jobKey = ""; if (cancel) cancel.disabled = true; cancel = null; }
      observedWorld = world;
      state = next; writable = ready;
      review.observe(next, ready);
      if (!ready || !review.quote) {
        if (confirm) confirm.disabled = true;
        if (review.reason && !panel.hidden) reason.textContent = review.reason;
      } else if (confirm && !panel.hidden) {
        const problem = review.paymentProblem(next);
        confirm.disabled = !!problem;
        reason.textContent = problem;
      }
      if (!ready) {
        for (const entry of entries) entry.button.disabled = true;
        if (cancel) cancel.disabled = true;
        // Protection retires the rendered cancellation capability too. A later
        // fresh ready projection creates a new button for the actual saved job.
        cancel = null; jobKey = "";
        if (!work.hidden) jobReason.textContent = "存档受保护，不能取消拆除；工作与付款记录保持原样。";
      }
    },
    update(next: GameState, ready: boolean) {
      this.observe(next, ready);
      if (!mounted()) return;
      if (tab.hidden || document.hidden) { invalidate("页面已离开，请重新核对拆除。"); return; }
      const planet = activePlanet(next), job = planet.demolition;
      for (const entry of entries) {
        entry.row.hidden = planet.buildings[entry.building] < 1;
        entry.button.hidden = planet.buildings[entry.building] < 1;
        entry.button.disabled = !ready || !!job || planet.buildings[entry.building] < 1;
      }
      work.hidden = !job;
      if (!job) { jobKey = ""; if (cancel) cancel.disabled = true; cancel = null; return; }
      const nextKey = `${planet.id}:${job.jobId}`;
      work.dataset.jobId = String(job.jobId); work.dataset.planetId = planet.id;
      jobTitle.textContent = `${planet.name} · 拆除 #${job.jobId} · ${buildingById(job.building).nameZh} ${job.fromLevel} → ${job.toLevel}`;
      jobTime.textContent = `剩余 ${formatDuration(Math.ceil(job.remainingSeconds))} / 总计 ${formatDuration(Math.ceil(job.totalSeconds))}`;
      jobTime.dataset.remainingSeconds = String(job.remainingSeconds); jobTime.dataset.totalSeconds = String(job.totalSeconds);
      jobFee.textContent = `本次已付：${demolitionFee(job.paid)}。完成前取消全额退还此笔费用。`;
      if (ready && nextKey !== jobKey) {
        jobKey = nextKey; cancel = null; jobActions.replaceChildren(); jobReason.textContent = "";
        const button = document.createElement("button");
        const ref: DemolitionJobRef = { kind: "demolition", planetId: planet.id, jobId: job.jobId, taskId: null };
        button.type = "button"; button.dataset.cancelDemolition = String(job.jobId); button.textContent = "取消拆除 · 全退本次费用";
        button.addEventListener("click", () => {
          if (!mounted() || button !== cancel || button.disabled || !writable || !state || work.hidden || tab.hidden || document.hidden || !jobActions.contains(button)) return;
          const actual = activePlanet(state);
          if (actual.id !== ref.planetId || actual.demolition?.jobId !== ref.jobId || actual.demolition.remainingSeconds <= 0) { button.disabled = true; return; }
          onAction({ type: "demolition-cancel", request: { ...ref } });
        });
        jobActions.append(button); cancel = button;
      }
      if (cancel) cancel.disabled = !ready || job.remainingSeconds <= 0;
    },
  };
}
