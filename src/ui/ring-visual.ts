/** Scoped ring presentation; explicit actions are forwarded to the guarded application handler. */
import { ARCADE_SYMBOLS, BET_SYMBOLS, BOARD, arcadeSymbolDef, type ArcadeSymbol } from "../data/arcade";
import { DEEP } from "../data/deep-space";
import type { GameState } from "../game/types";
import { chargeDeliveryStatus } from "../game/deep-state";
import { historyKey, historySource, ringArtUrl, ringOdds, ringQueue, validOddsSource, type RingOddsSource } from "./ring-model";
import { ringAutoInput, ringAutoView } from "./ring-auto-model";
import "./ring-visual.css";

export type RingAction = { type: "ring-auto-arm"; slotIndex: number; planetId: string; count: number; maxDeuterium: string }
  | { type: "ring-auto-stop" };

function node<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`缺少星环机节点：${selector}`);
  return el;
}
function text(root: ParentNode, selector: string, value: string): void {
  const el = node(root, selector); if (el.textContent !== value) el.textContent = value;
}
function make(tag: string, className: string, content = ""): HTMLElement {
  const el = document.createElement(tag); el.className = className; el.textContent = content; return el;
}
function image(symbol: ArcadeSymbol, className = "ring-art"): HTMLImageElement {
  const img = document.createElement("img"); img.className = className;
  img.src = ringArtUrl(symbol, import.meta.env.BASE_URL); img.alt = "";
  img.width = 128; img.height = 128; img.draggable = false; return img;
}
function fold(parent: HTMLElement, title: string, children: HTMLElement[]): HTMLDetailsElement {
  const detail = document.createElement("details"); detail.className = "ring-details";
  detail.append(make("summary", "", title), ...children); parent.append(detail); return detail;
}
export function installRingVisual(root: HTMLElement, onAction: (action: RingAction) => void): (state: GameState) => void {
  const panel = node(root, '[data-tab-panel="arcade"]'); panel.classList.add("ring-visual");
  node(panel,"#arcade-title").append(make("small","ring-version","图像版 · R1"));
  const side = node(panel, ".arcade-side"), screen = node(panel, ".arcade-screen");
  const result = node(panel, '[data-bind="arcade-result"]');
  const intro = Array.from(panel.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "P");
  const oldBlurb = intro.find(el => el.classList.contains("blurb"));
  if (oldBlurb) oldBlurb.textContent = "信标每30分钟游戏时间积攒1次，离线也攒，最多3次。总待揭晓容量为5+远征槽（安全上限40），出航充能会预留位置。信标不会造成舰队损失；充能可能遭遇战损或未受保护的黑洞。";
  fold(side, "信标、充能与风险说明", intro);
  const lead = make("p", "ring-lead", "信标揭晓即结算；舰队充能只回放，物资返航后入港。两种来源使用不同概率。");
  node(panel, ".panel-head").after(lead);
  const technical = Array.from(side.querySelectorAll<HTMLElement>(":scope > p.muted")).filter(el => el.dataset.bind !== "arcade-betline");
  const betExplanation = technical.find(el => !el.dataset.bind);
  if (betExplanation) betExplanation.textContent = "信标按当前常驻押注扣重氢；命中时额外发放相应资源或舰船。基础赔率为0.9/p，单次押注上限沿用现有规则。保底、额外灯、充能来源与货舱截断会改变总回报，不能把全部玩法简单称为90%回报。舰队充能只在出发时勾选押注并锁定金额，回放不重复扣费。";
  fold(side, "押注、奖池与自动开奖", technical);
  node(side, ".group-title").textContent = "当前押注";
  fold(side, "完整奖励与事件明细", [result]);
  const stats = node(panel, '[data-bind="arcade-stats-line"]');
  const tables = node(panel, ".arcade-tables");
  const ruleDetails = fold(panel, "公开基础概率、保底与累计统计", [stats, tables]);
  ruleDetails.id = "ring-rules";
  const headings = tables.querySelectorAll("h3");
  if (headings[0]) headings[0].textContent = "信标基础概率（保底前）";
  if (headings[2]) headings[2].textContent = "全部来源累计统计（不可直接对照单张概率表）";

  const hero = make("div", "ring-hero"); hero.innerHTML = '<div class="ring-hero-art"></div><strong class="ring-hero-title">等待信号</strong><span class="ring-hero-source">结果在规则层预掷，界面仅负责揭晓</span><p class="ring-hero-brief"></p>';
  node(hero, ".ring-hero-art").append(image("empty")); screen.append(hero);
  const queue = make("div", "ring-queue"); queue.innerHTML = '<p id="ring-next"></p><div class="ring-counters"><span id="ring-direct"></span><span id="ring-charge"></span><span id="ring-reserved"></span></div>';
  side.prepend(queue);
  const shortcuts = make("div", "ring-shortcuts"); shortcuts.innerHTML = '<button type="button" data-ring="charge">派舰充能</button><button type="button" data-ring="deep">查看深空报告</button>';
  side.append(shortcuts);

  const automatic = make("section", "ring-auto");
  automatic.setAttribute("aria-labelledby", "ring-auto-title");
  automatic.innerHTML = '<h3 id="ring-auto-title">有限自动开奖</h3><p id="ring-auto-status" role="status" aria-live="polite"></p><p id="ring-auto-progress"></p><p id="ring-auto-frozen"></p><p id="ring-auto-source"></p><p id="ring-auto-bets"></p><div class="ring-auto-fields"><label>自动跑灯槽位<select id="ring-auto-slot" aria-describedby="ring-auto-prerequisite"></select></label><label>本批次数<input id="ring-auto-count" type="number" min="0" max="40" step="1" value="0" inputmode="numeric" /></label><label>总扣费上限（重氢）<input id="ring-auto-cap" type="text" value="0" inputmode="decimal" maxlength="100" /></label></div><p id="ring-auto-prerequisite"></p><p id="ring-auto-validation" role="status"></p><div class="ring-auto-actions"><button type="button" data-ring="auto-arm">授权本批次</button><button type="button" data-ring="auto-stop" disabled>停止自动开奖</button></div><p id="ring-auto-stop-reason" role="status"></p><small>只包含授权时已有的前 N 次；重氢上限按总扣费计算，赢回不补充额度。不会自动加注购买次数，未来信标、顺风奖励不续入。手动开奖或改押注会停止本批次；装配或开关卡片不等于授权。离线也只执行已授权范围。</small>';
  node(side, ".arcade-controls").after(automatic);
  const autoSlot = node<HTMLSelectElement>(automatic, "#ring-auto-slot");
  const autoCount = node<HTMLInputElement>(automatic, "#ring-auto-count");
  const autoCap = node<HTMLInputElement>(automatic, "#ring-auto-cap");
  let slotSignature = "";

  const inspect = make("div", "ring-inspect"); inspect.innerHTML = '<label>查看基础概率<select id="ring-odds-source"><option value="beacon">信标／加注</option><option value="charge-1">充能 · 1 段</option><option value="charge-2">充能 · 2 段</option><option value="charge-3">充能 · 3 段</option></select></label><p id="ring-tile-info" role="status" aria-live="polite">点击图块查看概率与规则，不会改变开奖。</p>';
  node(panel, ".arcade-layout").after(inspect);
  const odds = make("div", "ring-odds-table"); odds.innerHTML = `<div class="space-table-scroll"><table class="ov-table"><thead><tr><th>事件</th><th>当前来源基础概率</th></tr></thead><tbody>${ARCADE_SYMBOLS.map(s => `<tr><td>${arcadeSymbolDef(s).nameZh}</td><td data-ring-odds="${s}"></td></tr>`).join("")}</tbody></table></div><p class="muted">基础概率不含保底与黑洞保护的改判；历史统计混合不同来源，不能据此直接校验本表。</p>`;
  ruleDetails.querySelector("summary")!.after(odds);
  const historyDetail = make("section", "ring-history-detail"); historyDetail.hidden = true;
  historyDetail.innerHTML = '<div class="ring-history-heading"><strong id="ring-history-title"></strong><button type="button" data-ring="close-history" aria-label="关闭记录详情">关闭</button></div><p id="ring-history-source"></p><ul id="ring-history-lines"></ul><small>仅查看历史，不消耗次数、不再次结算。</small>';
  historyDetail.setAttribute("aria-label", "开奖记录详情"); historyDetail.setAttribute("tabindex", "-1");
  node(panel, '[data-bind="arcade-history"]').after(historyDetail);
  let state: GameState | null = null, selectedTile: number | null = null, source: RingOddsSource = "beacon", selectedHistory: string | null = null;
  let lastHero = "", lastHistory = "", lastReceipt = "", historyFocus: HTMLElement | null = null;
  function paintAuto() {
    if (!state) return;
    const model = ringAutoView(state), signature = JSON.stringify(model.slots);
    if (signature !== slotSignature) {
      slotSignature = signature;
      const selected = autoSlot.value;
      autoSlot.replaceChildren(...(model.slots.length ? model.slots : [{index: -1, label: "暂无可用槽位"}]).map(slot => {
        const option = document.createElement("option"); option.value = String(slot.index); option.textContent = slot.label; return option;
      }));
      if (model.slots.some(slot => String(slot.index) === selected)) autoSlot.value = selected;
    }
    autoCount.max = String(model.maxCount);
    for (const [id, value] of [["status", model.status], ["progress", model.progress], ["frozen", model.frozen], ["source", model.source], ["bets", model.bets], ["prerequisite", model.prerequisite], ["stop-reason", model.stopReason]]) text(automatic, `#ring-auto-${id}`, value!);
    const input = ringAutoInput(state, autoSlot.value, autoCount.value, autoCap.value);
    text(automatic, "#ring-auto-validation", model.armed || model.prerequisite ? "" : input.reason);
    const arm = node<HTMLButtonElement>(automatic, '[data-ring="auto-arm"]');
    arm.disabled = !input.valid;
    arm.textContent = state.arcade.autoBatch ? "重新授权本批次" : "授权本批次";
    node<HTMLButtonElement>(automatic, '[data-ring="auto-stop"]').disabled = !model.armed;
  }
  automatic.addEventListener("input", paintAuto);
  autoSlot.addEventListener("change", paintAuto);
  const tiles = BOARD.map((symbol, i) => {
    const tile = node(panel, `[data-tile="${i}"]`);
    node(tile, ".arcade-glyph").replaceChildren(image(symbol));
    tile.tabIndex = i === 0 ? 0 : -1; tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", `${arcadeSymbolDef(symbol).nameZh}，查看事件说明`);
    return tile;
  });
  for (const symbol of BET_SYMBOLS) {
    const name = node(panel, `.arcade-bet.sym-${symbol} .arcade-bet-name`);
    const odds = node(name, "strong"); name.replaceChildren(image(symbol), document.createTextNode(arcadeSymbolDef(symbol).nameZh + " "), odds);
  }
  function paintOdds() {
    const rows = ringOdds(source);
    for (const r of rows) text(panel, `[data-ring-odds="${r.symbol}"]`, `${r.percent.toFixed(1)}%`);
    if (selectedTile === null) return;
    const symbol = BOARD[selectedTile]!, def = arcadeSymbolDef(symbol), percent = rows.find(r => r.symbol === symbol)!.percent;
    const label = source === "beacon" ? "信标" : `充能 ${source.at(-1)} 段`;
    const hint = source === "beacon" ? def.effectZh : symbol === "blackhole" ? `前 ${DEEP.beginnerProtection} 次及黑洞后 ${DEEP.blackholeCooldown} 次保护；未保护时会全损，超过帝国舰队价值50%则改判乱流。` : symbol === "pirate" || symbol === "alien" ? "实际遭遇战，只影响出航舰队；可在深空页查看战报。" : "物资与道具随舰队返航，事件回放不会重复发奖。";
    text(panel, "#ring-tile-info", `${def.nameZh} · ${label}基础概率 ${percent.toFixed(1)}%（此类事件总概率，非单格） · ${hint}`);
    tiles.forEach((t, i) => { t.setAttribute("aria-pressed", String(i === selectedTile)); t.tabIndex = i === selectedTile ? 0 : -1; });
  }
  function paintHistory() {
    if (!state || !selectedHistory) { historyDetail.hidden = true; return; }
    const entry = state.arcade.history.find(h => historyKey(h) === selectedHistory);
    if (!entry) { historyDetail.hidden = true; selectedHistory = null; return; }
    historyDetail.hidden = false;
    text(panel, "#ring-history-title", `${arcadeSymbolDef(entry.symbol).nameZh}${entry.big ? " · 大档" : ""}`);
    text(panel, "#ring-history-source", `${historySource(entry)} · ${entry.auto ? "自动" : "手动"} · 游戏时间 ${Math.floor(entry.at)} 秒`);
    node(panel, "#ring-history-lines").replaceChildren(...entry.summary.split("；").map(line => make("li", "", line)));
  }
  panel.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const tile = target?.closest<HTMLElement>("[data-tile]");
    if (tile) { selectedTile = Number(tile.dataset.tile); paintOdds(); }
    const chip = target?.closest<HTMLElement>("[data-ring-history]");
    if (chip && state) { selectedHistory = chip.dataset.ringHistory!; historyFocus = chip; paintHistory(); historyDetail.focus({preventScroll:true}); }
    const button = target?.closest<HTMLElement>("[data-ring]");
    if (button instanceof HTMLButtonElement && button.disabled) return;
    if (button?.dataset.ring === "auto-arm" && state) {
      const input = ringAutoInput(state, autoSlot.value, autoCount.value, autoCap.value);
      if (input.valid) onAction({type: "ring-auto-arm", slotIndex: input.slotIndex, planetId: state.activePlanetId, count: input.count, maxDeuterium: input.maxDeuterium});
    }
    if (button?.dataset.ring === "auto-stop") onAction({type: "ring-auto-stop"});
    if (button?.dataset.ring === "close-history") { selectedHistory = null; paintHistory(); historyFocus?.focus({preventScroll:true}); }
    if (button?.dataset.ring === "charge") node<HTMLButtonElement>(root, '#space-deep [data-deep="charge"]').click();
    if (button?.dataset.ring === "deep") node<HTMLButtonElement>(root, '[data-tab="deep"]').click();
  });
  panel.addEventListener("keydown", event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.matches("[data-tile], [data-ring-history]") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); target.click(); }
    if (target?.hasAttribute("data-tile") && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const i = Number(target.dataset.tile);
      const next = event.key === "Home" ? 0 : event.key === "End" ? 23 : (i + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + 24) % 24;
      selectedTile = next; paintOdds(); tiles[next]!.focus();
    }
    if (event.key === "Escape" && !historyDetail.hidden) { selectedHistory = null; paintHistory(); historyFocus?.focus({preventScroll:true}); }
  });
  node<HTMLSelectElement>(panel, "#ring-odds-source").addEventListener("change", event => { source = validOddsSource((event.target as HTMLSelectElement).value); paintOdds(); });
  paintOdds();
  return next => {
    state = next; if (panel.hidden) return;
    paintAuto();
    const q = ringQueue(next);
    text(panel, "#ring-next", q.next); text(panel, '[data-bind="arcade-run"]', q.action);
    text(panel, "#ring-direct", `信标等奖励 ${q.direct}`); text(panel, "#ring-charge", `充能回放 ${q.charge}`); text(panel, "#ring-reserved", `出航预留 ${q.reserved} · 总容量 ${q.limit}`);
    const busy = result.textContent === "跑灯中……";
    const latest = next.arcade.history.at(-1);
    const brief = busy ? "跑灯中……" : latest?.summary.split("；").filter(line => !line.startsWith("深空事件回放：")).slice(0, 2).join("；") || "完成研究、积攒信标，或派舰前往第16位深空。";
    const heroKey = JSON.stringify([busy, latest && historyKey(latest), brief]);
    if (heroKey !== lastHero) {
      lastHero = heroKey;
      node(hero, ".ring-hero-art").replaceChildren(image(busy ? "empty" : latest?.symbol ?? "empty"));
      text(hero, ".ring-hero-title", busy ? "正在揭晓" : latest ? arcadeSymbolDef(latest.symbol).nameZh : "等待信号");
      text(hero, ".ring-hero-source", busy ? "预掷结果回放中" : latest ? historySource(latest) : "准备你的下一次探索");
      text(hero, ".ring-hero-brief", brief);
    }
    const history = node(panel, '[data-bind="arcade-history"]');
    for (const [i, chip] of Array.from(history.querySelectorAll<HTMLElement>(".arcade-chip")).entries()) {
      const entry = next.arcade.history[i]; if (!entry || chip.dataset.ringHistory) continue;
      chip.dataset.ringHistory = historyKey(entry); chip.setAttribute("role", "button"); chip.tabIndex = 0;
      chip.setAttribute("aria-label", `查看${arcadeSymbolDef(entry.symbol).nameZh}记录，仅查看不发奖`);
      chip.replaceChildren(image(entry.symbol));
    }
    const historySig = JSON.stringify(next.arcade.history);
    if (historySig !== lastHistory) { lastHistory = historySig; paintHistory(); }
    // Existing renderer applies beacon-only titles/classes; decorate after it without changing its bindings.
    const chances = ringOdds(source);
    tiles.forEach((t,i) => {
      const symbol = BOARD[i]!; t.title = `${arcadeSymbolDef(symbol).nameZh} · 点击查看 ${source === "beacon" ? "信标" : "充能"}基础概率`;
      t.classList.toggle("ring-source-unavailable", chances[ARCADE_SYMBOLS.indexOf(symbol)]!.percent === 0);
    });
    const charge = next.arcade.runs[0];
    const report = charge?.source === "charge" ? next.deepSpace.reports.find(r => r.id === charge.receipt?.reportId) : null;
    const receipt = report ? `充能凭证 #${report.fleetId} · ${chargeDeliveryStatus(next,report)}。回放不再扣押注或发奖。` : "";
    if (receipt !== lastReceipt) { lastReceipt = receipt; lead.textContent = receipt || "信标揭晓即结算；舰队充能只回放，物资返航后入港。两种来源使用不同概率。"; }
  };
}
