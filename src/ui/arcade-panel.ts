import { icon, type ArtId } from "./art";
/**
 * DOM for the deep-space ring machine tab: 7×7 board, centre screen, bet panel, odds table, history.
 * The light animation is cosmetic: the state already holds the result when it starts.
 */
import { ARCADE, ARCADE_PHASE, ARCADE_SYMBOL_DEFS, BET_SYMBOLS, BOARD, LUCKY_TABLE, arcadeSymbolDef, boardCell } from "../data/arcade";
import type { RunResult } from "../game/arcade";
import type { ArcadeView } from "./arcade-present";

const SKIP_KEY = "infinity.ui.arcadeSkip";

function bindNode(root: ParentNode, bind: string): HTMLElement {
  const node = root.querySelector(`[data-bind="${bind}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing view node ${bind}`);
  return node;
}

function put(root: ParentNode, bind: string, text: string): void {
  const node = bindNode(root, bind);
  if (node.textContent !== text) node.textContent = text;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

export function readSkipPreference(): boolean {
  try {
    const saved = localStorage.getItem(SKIP_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    // ignore
  }
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function writeSkipPreference(skip: boolean): void {
  try {
    localStorage.setItem(SKIP_KEY, skip ? "1" : "0");
  } catch {
    // ignore
  }
}

function tableRows(prefix: string, rows: readonly { key: string; dark: boolean }[]): string {
  return rows
    .map(
      (row) =>
        `<tr class="${row.dark ? "dark" : ""}">${[0, 1, 2, 3]
          .map((index) => `<td data-bind="${prefix}-${row.key}-${index}"></td>`)
          .join("")}</tr>`,
    )
    .join("");
}

const ODDS_KEYS = ARCADE_SYMBOL_DEFS.map((def) => ({ key: def.id, dark: def.opensIn > ARCADE_PHASE }));
const LUCKY_KEYS = LUCKY_TABLE.map((row) => ({ key: row.kind, dark: false }));
const STAT_KEYS = ARCADE_SYMBOL_DEFS.filter((def) => def.opensIn <= ARCADE_PHASE).map((def) => ({ key: def.id, dark: false }));

const SYMBOL_ART: Record<string, ArtId> = { metal: "metal", crystal: "crystal", deuterium: "deuterium", dark_matter: "dark-matter", drifter: "cruiser", supply: "dark-matter", lucky: "badge-galaxy", jackpot: "badge-infinity" };

export function arcadePanelHtml(headIcon: string): string {
  const tiles = BOARD.map((symbol, index) => {
    const def = arcadeSymbolDef(symbol);
    const cell = boardCell(index);
    return `<div class="arcade-tile sym-${symbol}" data-tile="${index}" data-bind="arcade-tile-${index}" style="grid-row:${cell.row};grid-column:${cell.col}"><span class="arcade-glyph">${SYMBOL_ART[symbol] ? icon(SYMBOL_ART[symbol]!, "", { alt: "", size: 30 }) : def.glyph}</span><small>${def.nameZh}</small></div>`;
  }).join("");
  const bets = BET_SYMBOLS.map((symbol) => {
    const def = arcadeSymbolDef(symbol);
    return `
      <div class="arcade-bet sym-${symbol}">
        <span class="arcade-bet-name">${def.glyph} ${def.nameZh} <strong data-bind="arcade-odds-${symbol}"></strong></span>
        <button type="button" data-action="arcade-bet" data-symbol="${symbol}" data-delta="-1" data-bind="arcade-bet-sub-${symbol}" aria-label="${def.nameZh}减 1 注">−</button>
        <span class="arcade-bet-units" data-bind="arcade-bet-${symbol}">0 注</span>
        <button type="button" data-action="arcade-bet" data-symbol="${symbol}" data-delta="1" data-bind="arcade-bet-add-${symbol}" aria-label="${def.nameZh}加 1 注">+</button>
      </div>`;
  }).join("");
  return `
      <section class="tab-panel" data-tab-panel="arcade" aria-labelledby="arcade-title" hidden>
        <div class="panel-head">
          <h2 id="arcade-title">${headIcon} 深空星环机</h2>
          <p data-bind="arcade-beacon"></p>
        </div>
        <p class="blurb">信标版（第 3 阶段起有漂流舰）：每 ${ARCADE.beaconSeconds / 60} 分钟游戏时间自动攒 1 次信标开奖（离线也攒，最多存 ${ARCADE.beaconMax} 次；加注和奖励开奖最多存到 ${ARCADE.storedMax} 次）。结果在获得开奖次数时就已掷定，跑灯只负责揭晓。信标开奖不会损失任何东西（押注除外）。</p>
        <div class="arcade-layout">
          <div class="arcade-board" data-bind="arcade-board">
            ${tiles}
            <div class="arcade-screen">
              <p class="arcade-runs">剩余开奖 <strong data-bind="arcade-runs">0 / ${ARCADE.storedMax}</strong></p>
              <p class="arcade-pity"><span data-bind="arcade-pity"></span> · <span data-bind="arcade-jackpot"></span></p>
              <ul class="arcade-result" data-bind="arcade-result"></ul>
            </div>
          </div>
          <div class="arcade-side">
            <div class="arcade-controls">
              <button type="button" class="arcade-run" data-action="arcade-run" data-bind="arcade-run">开奖</button>
              <button type="button" data-action="arcade-all" data-bind="arcade-all">全部开奖</button>
              <label class="arcade-skip"><input type="checkbox" data-bind="arcade-skip" /> 跳过动画</label>
            </div>
            <button type="button" class="arcade-topup" data-action="arcade-topup" data-bind="arcade-topup"></button>
            <p class="status" data-bind="status-arcade" role="status"></p>
            <h3 class="group-title">重氢押注（常驻，自动开奖也沿用）</h3>
            <div class="arcade-bets">${bets}</div>
            <p class="muted arcade-betline" data-bind="arcade-betline"></p>
            <button type="button" class="arcade-clear" data-action="arcade-bet-clear">清空押注</button>
            <p class="muted">押中时额外得到 注数 × 1 注重氢的金属当量 × 赔率，以该资源发放（漂流舰发同等价值的舰船）；没押中，押注的重氢没收。赔率 = 0.9 / 该符号概率，期望回报是押注的 90%。暗物质、LUCKY、JACKPOT 不能押；JACKPOT 按押注最多的符号发奖。</p>
            <p class="muted" data-bind="arcade-prize"></p>
            <p class="muted" data-bind="arcade-auto"></p>
          </div>
        </div>
        <h3 class="group-title">最近 ${ARCADE.historySize} 次</h3>
        <div class="arcade-history" data-bind="arcade-history"></div>
        <p class="muted" data-bind="arcade-stats-line"></p>
        <div class="arcade-tables">
          <div>
            <h3 class="group-title">赔率表（信标开奖，真实概率）</h3>
            <table class="ov-table arcade-odds">
              <thead><tr><th>符号</th><th>图块</th><th>概率</th><th>效果</th></tr></thead>
              <tbody>${tableRows("arcade-odds", ODDS_KEYS)}</tbody>
            </table>
            <h3 class="group-title">LUCKY 送灯</h3>
            <table class="ov-table arcade-odds">
              <thead><tr><th>类型</th><th></th><th>概率</th><th>效果</th></tr></thead>
              <tbody>${tableRows("arcade-lucky", LUCKY_KEYS)}</tbody>
            </table>
            <p class="muted">保底：连续 ${ARCADE.emptyPity} 次空域 / 引力乱流后，下一次必定落在资源、暗物质、补给箱或 LUCKY 上；每 ${ARCADE.jackpotPity} 次开奖内至少 1 次 JACKPOT。保底只改落点，不改赔率表。普通图块 ${Math.round((1 - ARCADE.bigChance) * 100)}% 普通档、${Math.round(ARCADE.bigChance * 100)}% 大档（落灯时金边）。送出的灯不会停在 LUCKY、JACKPOT 和暗色图块上。</p>
          </div>
          <div>
            <h3 class="group-title">命中统计（与赔率表对照）</h3>
            <table class="ov-table arcade-odds">
              <thead><tr><th>符号</th><th>命中</th><th>实际</th><th>概率</th></tr></thead>
              <tbody>${tableRows("arcade-stat", STAT_KEYS)}</tbody>
            </table>
          </div>
        </div>
      </section>`;
}

interface Playback {
  results: RunResult[];
  start: number;
  /** Per result: [startMs, mainEndMs, endMs] relative to `start`. */
  plan: { begin: number; mainEnd: number; end: number; steps: number }[];
  total: number;
  fast: boolean;
}

const ACCEL = 0.6;
const CRUISE = 1.2;
const DECEL = 1.2;
const EXTRA_STEP = 0.35;

/** Distance (in tiles) covered after `t` seconds for a run of `steps` tiles in 3 s. */
function travelled(steps: number, t: number): number {
  const v = steps / (ACCEL / 2 + CRUISE + DECEL / 2);
  if (t <= 0) return 0;
  if (t < ACCEL) return (0.5 * v * t * t) / ACCEL;
  if (t < ACCEL + CRUISE) return 0.5 * v * ACCEL + v * (t - ACCEL);
  const d = Math.min(DECEL, t - ACCEL - CRUISE);
  return 0.5 * v * ACCEL + v * CRUISE + v * d - (0.5 * v * d * d) / DECEL;
}

export class ArcadeAnimator {
  private playback: Playback | null = null;
  private resultLines: string[] | null = null;
  private hits: Map<number, string> = new Map();
  private finishedAt = 0;
  private sig: string | null = null;

  get busy(): boolean {
    return this.playback !== null;
  }

  play(results: RunResult[], skip: boolean, now: number): void {
    if (results.length === 0) return;
    const lines =
      results.length === 1
        ? results[0]!.lines
        : [
            ...summaryLines(results),
            ...results.flatMap((result, i) => [`第 ${i + 1} 次：${arcadeSymbolDef(result.symbol).nameZh}${result.big ? "（大）" : ""}`, ...result.lines.map((line) => `  ${line}`)]),
          ];
    if (skip) {
      this.playback = null;
      this.finish(results, lines);
      return;
    }
    const fast = results.length > 1;
    const plan: Playback["plan"] = [];
    let cursor = 0;
    for (const result of results) {
      const distance = (result.mainTile - result.startTile + BOARD.length) % BOARD.length;
      const steps = fast ? (distance === 0 ? BOARD.length : distance) : distance + BOARD.length * 2;
      const mainDuration = fast ? 0.7 : ACCEL + CRUISE + DECEL;
      const extras = result.lights.length - 1;
      const begin = cursor;
      const mainEnd = begin + mainDuration;
      const end = mainEnd + extras * EXTRA_STEP + (fast ? 0.25 : 0.6);
      plan.push({ begin, mainEnd, end, steps });
      cursor = end;
    }
    this.playback = { results, start: now, plan, total: cursor, fast };
    this.resultLines = ["跑灯中……"];
    this.hits.clear();
    this.pendingLines = lines;
  }

  private pendingLines: string[] = [];

  private finish(results: RunResult[], lines: string[]): void {
    this.resultLines = lines;
    this.finishedAt = performance.now();
    this.sig = null;
    this.hits.clear();
    const last = results[results.length - 1]!;
    for (const light of last.lights) {
      if (!light.paid) continue;
      this.hits.set(light.tile, light.big ? "hit hit-big" : "hit");
    }
  }

  /** Per-frame update of tile classes and the centre screen. */
  frame(root: ParentNode, model: ArcadeView, now: number): void {
    const classes = new Map<number, string>();
    if (!this.playback && this.resultLines) {
      // Follow the latest history again once something newer happened (e.g. an auto run).
      if (this.sig === null) this.sig = model.historySignature;
      else if (this.sig !== model.historySignature) {
        this.resultLines = null;
        this.hits.clear();
      }
    }
    if (this.hits.size > 0 && now - this.finishedAt > 6000) this.hits.clear();
    const playback = this.playback;
    if (playback) {
      const t = (now - playback.start) / 1000;
      if (t >= playback.total) {
        this.playback = null;
        this.finish(playback.results, this.pendingLines);
      } else {
        const index = playback.plan.findIndex((p) => t < p.end);
        const step = playback.plan[index]!;
        const result = playback.results[index]!;
        const local = t - step.begin;
        const mainDuration = step.mainEnd - step.begin;
        if (local < mainDuration) {
          const scaled = playback.fast ? (local / mainDuration) * (ACCEL + CRUISE + DECEL) : local;
          const pos = result.startTile + Math.floor(travelled(step.steps, scaled));
          for (let k = 0; k < 3; k += 1) {
            const tile = (((pos - k) % BOARD.length) + BOARD.length) % BOARD.length;
            if (!classes.has(tile)) classes.set(tile, k === 0 ? "lit" : `trail trail-${k}`);
          }
        } else {
          classes.set(result.mainTile, result.big ? "lit hit-big" : "lit");
          const shown = Math.floor((local - mainDuration) / EXTRA_STEP);
          result.lights.slice(1, 1 + shown + 1).forEach((light, i) => {
            if (i <= shown) classes.set(light.tile, light.paid ? (light.big ? "lit hit-big" : "lit") : "lit skipped");
          });
        }
      }
    } else if (this.hits.size > 0) {
      for (const [tile, cls] of this.hits) classes.set(tile, cls);
    } else if (model.runsCount > 0) {
      classes.set(Math.floor(now / 140) % BOARD.length, "attract");
    }
    for (let i = 0; i < BOARD.length; i += 1) {
      const node = bindNode(root, `arcade-tile-${i}`);
      const tile = model.tiles[i]!;
      const want = `arcade-tile sym-${tile.symbol}${tile.open ? "" : " closed"}${classes.has(i) ? ` ${classes.get(i)}` : ""}`;
      if (node.className !== want) node.className = want;
      if (node.title !== tile.title) node.title = tile.title;
    }
    const lines = this.playback ? ["跑灯中……"] : (this.resultLines ?? model.last);
    const list = bindNode(root, "arcade-result");
    const signature = lines.join("\n");
    if (list.dataset.sig !== signature) {
      list.dataset.sig = signature;
      list.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
    }
  }
}

function summaryLines(results: RunResult[]): string[] {
  const counts = new Map<string, number>();
  for (const result of results) {
    const name = arcadeSymbolDef(result.symbol).nameZh;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [`全部开奖 ${results.length} 次：${[...counts.entries()].map(([name, n]) => `${name} ×${n}`).join("、")}`];
}

export function updateArcadePanel(root: ParentNode, model: ArcadeView, animator: ArcadeAnimator, now: number): void {
  put(root, "arcade-beacon", model.beacon);
  put(root, "arcade-runs", model.runs);
  put(root, "arcade-pity", model.pity);
  put(root, "arcade-jackpot", model.jackpot);
  put(root, "arcade-betline", model.betLine);
  put(root, "arcade-prize", model.prize);
  put(root, "arcade-auto", model.autoHint);
  put(root, "arcade-stats-line", model.statsLine);
  const run = bindNode(root, "arcade-run") as HTMLButtonElement;
  run.disabled = !model.canRun;
  const all = bindNode(root, "arcade-all") as HTMLButtonElement;
  all.disabled = model.runsCount < 1;
  const topUp = bindNode(root, "arcade-topup") as HTMLButtonElement;
  if (topUp.textContent !== model.topUpLabel) topUp.textContent = model.topUpLabel;
  topUp.disabled = !model.topUpEnabled;
  if (topUp.title !== model.topUpTitle) topUp.title = model.topUpTitle;
  for (const bet of model.bets) {
    put(root, `arcade-odds-${bet.symbol}`, bet.odds);
    put(root, `arcade-bet-${bet.symbol}`, bet.units);
    (bindNode(root, `arcade-bet-add-${bet.symbol}`) as HTMLButtonElement).disabled = !bet.canAdd;
    (bindNode(root, `arcade-bet-sub-${bet.symbol}`) as HTMLButtonElement).disabled = !bet.canSub;
  }
  for (const row of model.odds) row.cells.forEach((cell, i) => put(root, `arcade-odds-${row.key}-${i}`, cell));
  for (const row of model.luckyRows) row.cells.forEach((cell, i) => put(root, `arcade-lucky-${row.key}-${i}`, cell));
  for (const row of model.stats) row.cells.forEach((cell, i) => put(root, `arcade-stat-${row.key}-${i}`, cell));
  const history = bindNode(root, "arcade-history");
  if (history.dataset.sig !== model.historySignature) {
    history.dataset.sig = model.historySignature;
    history.innerHTML =
      model.history.length === 0
        ? `<span class="muted">还没有开奖记录</span>`
        : model.history
            .map((chip) => `<span class="arcade-chip sym-${chip.symbol}${chip.big ? " big" : ""}" title="${escapeHtml(chip.title)}">${chip.glyph}</span>`)
            .join("");
  }
  animator.frame(root, model, now);
}
