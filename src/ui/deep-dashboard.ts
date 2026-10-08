/** Progressive enhancement of the original deep tab; all actions use existing handlers. */
import type { GameState } from "../game/types";
import { arcadeSymbolDef } from "../data/arcade";
import { ringArtUrl } from "./ring-model";
import { chargeRows, merchantSummary, protectionSummary, reportMatches, validReportFilter } from "./deep-dashboard-model";
import "./deep-dashboard.css";

function el<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw Error(`缺少深空面板节点 ${selector}`);
  return value;
}
function text(root: ParentNode, selector: string, value: string): void {
  const target = el(root, selector); if (target.textContent !== value) target.textContent = value;
}
function help(paragraph: HTMLElement, title: string): void {
  const detail = document.createElement("details"); detail.className = "deep-help";
  const summary = document.createElement("summary"); summary.textContent = title;
  paragraph.before(detail); detail.append(summary, paragraph);
}
export function installDeepDashboard(root: HTMLElement): (state: GameState) => void {
  const panel = el(root, "#space-deep");
  const intro = el(panel, ":scope > p.muted");
  help(intro, "充能、返航与回放的区别");
  panel.querySelector(".deep-help")!.insertAdjacentHTML("beforebegin", '<p class="deep-lead">派舰 → 驻留 → 事件 → 返航。物资到港入库，星环机只回放。</p>');
  el(panel, "#deep-protection").classList.add("deep-risk");
  const merchant = el(panel, ".ov-card");
  help(el(merchant, "p.muted"), "报价、手续费与交易规则");
  merchant.querySelector("h3")!.insertAdjacentHTML("afterend", '<p id="deep-merchant-hint"></p>');
  for (const [selector, title] of [["#deep-debris", "残骸来源与货舱限制"], ["#deep-reports", "战斗模型与损失范围"]]) {
    const paragraph = el(panel, selector!).previousElementSibling;
    if (paragraph instanceof HTMLElement && paragraph.matches("p.muted")) help(paragraph, title!);
  }
  const flights = document.createElement("section");
  flights.setAttribute("aria-label", "在途充能舰队");
  flights.innerHTML = '<div class="deep-section-head"><h3>在途充能</h3><span id="deep-flight-count"></span></div><div id="deep-flight-list"></div><p class="muted" id="deep-flight-empty">暂无在途充能舰队。使用上方“派舰”编队，不会自动出航。</p>';
  merchant.before(flights);
  const reports = el(panel, "#deep-reports");
  const filter = document.createElement("div"); filter.className = "deep-section-head";
  filter.innerHTML = '<label>报告筛选<select id="deep-report-filter"><option value="all">全部事件</option><option value="battle">遭遇战</option><option value="merchant">商人联络</option><option value="loss">舰队全损</option><option value="pending">待返航入库</option></select></label><span id="deep-report-count" role="status"></span>';
  reports.before(filter);
  reports.insertAdjacentHTML("afterend", '<p class="muted" id="deep-report-empty" hidden>当前筛选没有报告。切换“全部事件”查看其他记录。</p>');
  let state: GameState | null = null;
  const roundOpen = new Set<string>();
  const list = el(panel, "#deep-flight-list");
  const rowNodes = new Map<number, HTMLElement>();
  function showReports(): void {
    if (!state) return;
    const selected = validReportFilter(el<HTMLSelectElement>(panel, "#deep-report-filter").value);
    let count = 0;
    for (const row of reports.querySelectorAll<HTMLElement>(":scope > [data-report]")) {
      const report = state.deepSpace.reports.find(r => r.id === row.dataset.report);
      row.hidden = !report || !reportMatches(state, report, selected);
      if (!row.hidden) count++;
    }
    text(panel, "#deep-report-count", `${count} / ${state.deepSpace.reports.length} 条`);
    el(panel, "#deep-report-empty").hidden = count > 0 || state.deepSpace.reports.length === 0;
  }
  el(panel, "#deep-report-filter").addEventListener("change", showReports);
  panel.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-deep-report]") : null;
    if (!button) return;
    el<HTMLSelectElement>(panel, "#deep-report-filter").value = "all"; showReports();
    const row = [...reports.querySelectorAll<HTMLDetailsElement>("[data-report]")].find(r => r.dataset.report === button.dataset.deepReport);
    if (row) { row.open = true; row.focus(); row.scrollIntoView({ block: "nearest" }); }
  });
  function decorateReports(): void {
    if (!state) return;
    for (const row of reports.querySelectorAll<HTMLDetailsElement>(":scope > [data-report]")) {
      if (row.dataset.dashboardReady) continue;
      const report = state.deepSpace.reports.find(r => r.id === row.dataset.report); if (!report) continue;
      row.dataset.dashboardReady = "true"; row.tabIndex = -1;
      const icon = document.createElement("img");
      icon.src = ringArtUrl(report.symbol, import.meta.env.BASE_URL); icon.width = 128; icon.height = 128;
      icon.alt = ""; icon.className = "deep-event-icon"; icon.title = arcadeSymbolDef(report.symbol).nameZh;
      el(row, "summary").prepend(icon);
      const table = row.querySelector<HTMLElement>(".space-table-scroll");
      if (table) {
        const detail = document.createElement("details"); detail.className = "deep-rounds";
        const summary = document.createElement("summary"); summary.textContent = `查看逐回合数据（${report.battle?.rounds.length ?? 0} 回合）`;
        table.before(detail); detail.append(summary, table); detail.open = roundOpen.has(report.id);
        detail.addEventListener("toggle", () => { if (detail.isConnected) { if (detail.open) roundOpen.add(report.id); else roundOpen.delete(report.id); } });
      }
    }
  }
  return next => {
    state = next; if (panel.hidden) return;
    text(panel, "#deep-protection", protectionSummary(next));
    text(panel, "#deep-merchant-hint", merchantSummary(next).text);
    const rows = chargeRows(next), ids = new Set(rows.map(r => r.id));
    for (const [id, node] of rowNodes) if (!ids.has(id)) { node.remove(); rowNodes.delete(id); }
    for (const model of rows) {
      let row = rowNodes.get(model.id);
      if (!row) {
        row = document.createElement("article"); row.className = "deep-flight-row"; row.dataset.deepFlight = String(model.id);
        row.innerHTML = '<div class="deep-flight-heading"><strong class="deep-flight-name"></strong><span class="deep-flight-origin"></span><strong class="deep-timer"></strong><button type="button" data-space="recall">召回</button><button type="button" class="deep-view-report">查看报告</button></div><div class="deep-phase-steps"><span data-phase="outbound">01 前往深空</span><span data-phase="holding">02 驻留充能</span><span data-phase="return">03 返航入港</span></div><progress max="100" aria-label="当前阶段进度"></progress><p class="deep-flight-load"></p><p class="deep-flight-note"></p>';
        el(row, '[data-space="recall"]').dataset.fleet = String(model.id);
        rowNodes.set(model.id, row); list.append(row);
      }
      text(row, ".deep-flight-name", `舰队 #${model.id}`);
      text(row, ".deep-flight-origin", `${model.origin} → [${model.destination}]`);
      text(row, ".deep-timer", `${model.stage} · ${model.remaining}`);
      text(row, ".deep-flight-load", `${model.ships} 艘 · 货物合计 ${model.cargo} · 驻留 ${model.slots} 段`);
      text(row, ".deep-flight-note", model.note);
      el<HTMLProgressElement>(row, "progress").value = model.progress;
      for (const step of row.querySelectorAll<HTMLElement>("[data-phase]")) {
        if (step.dataset.phase === model.phase) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
      }
      const recall = el<HTMLButtonElement>(row, '[data-space="recall"]'); recall.disabled = !model.canRecall;
      recall.title = model.canRecall ? "停止未完成的充能；燃料不退，未结算押注返港退回" : "已在返航途中，不能再次召回";
      const reportButton = el(row, ".deep-view-report"); reportButton.hidden = !model.reportId;
      reportButton.dataset.deepReport = model.reportId ?? "";
    }
    text(panel, "#deep-flight-count", `${rows.length} 支`); el(panel, "#deep-flight-empty").hidden = rows.length > 0;
    decorateReports(); showReports();
  };
}
