/** View model for the deep-space ring machine tab (design doc §8.6). No DOM here. */
import {
  ARCADE,
  ARCADE_SYMBOL_DEFS,
  BET_SYMBOLS,
  BOARD,
  LUCKY_TABLE,
  arcadeSymbolDef,
  boardCell,
  type ArcadeSymbol,
  type BetSymbol,
} from "../data/arcade";
import {
  SYMBOL_CHANCE,
  TILE_WEIGHTS,
  arcadeUnlocked,
  betOdds,
  betUnitDeut,
  empirePoints,
  maxBetUnits,
  nextBeaconIn,
  prizeCap,
  productionMe,
  resourceRange,
  tileOpen,
  topUpPrice,
  topUpReason,
  totalBetUnits,
} from "../game/arcade";
import { big } from "../game/decimal";
import { formatAmount, formatDuration } from "../game/format";
import type { GameState } from "../game/types";

export interface ArcadeTileView {
  index: number;
  symbol: ArcadeSymbol;
  glyph: string;
  name: string;
  open: boolean;
  row: number;
  col: number;
  title: string;
}

export interface ArcadeBetView {
  symbol: BetSymbol;
  name: string;
  units: string;
  odds: string;
  canAdd: boolean;
  canSub: boolean;
}

export interface ArcadeOddsRow {
  key: string;
  cells: [string, string, string, string];
  dark: boolean;
}

export interface ArcadeHistoryChip {
  symbol: ArcadeSymbol;
  glyph: string;
  big: boolean;
  title: string;
}

export interface ArcadeView {
  visible: boolean;
  runsCount: number;
  runs: string;
  beacon: string;
  pity: string;
  jackpot: string;
  betLine: string;
  bets: ArcadeBetView[];
  topUpLabel: string;
  topUpEnabled: boolean;
  topUpTitle: string;
  canRun: boolean;
  prize: string;
  tiles: ArcadeTileView[];
  odds: ArcadeOddsRow[];
  luckyRows: ArcadeOddsRow[];
  history: ArcadeHistoryChip[];
  historySignature: string;
  stats: ArcadeOddsRow[];
  statsLine: string;
  last: string[];
  autoHint: string;
}

const pct = (value: number) => `${(value * 100).toFixed(value * 100 < 1 ? 2 : 1)}%`;

type Ranges = { normal: [number, number]; big: [number, number] };

function tileTitle(index: number, ranges: Ranges): string {
  const symbol = BOARD[index]!;
  const def = arcadeSymbolDef(symbol);
  if (!tileOpen(index)) {
    const into = def.mergeInto ? arcadeSymbolDef(def.mergeInto).nameZh : "其他图块";
    return `${def.nameZh}：第 ${def.opensIn} 阶段开放，现在权重并入${into}`;
  }
  const chance = `单格概率 ${pct(TILE_WEIGHTS[index] ?? 0)}`;
  if (symbol === "metal" || symbol === "crystal" || symbol === "deuterium") {
    const factor = symbol === "metal" ? 1 : symbol === "crystal" ? 2 : 3;
    const [lo, hi] = ranges.normal;
    const [blo, bhi] = ranges.big;
    const fmt = (v: number) => formatAmount(big(Math.floor(v / factor)));
    return `${def.nameZh} · ${chance}\n本次可能：普通 ${fmt(lo)}–${fmt(hi)}，大档 ${fmt(blo)}–${fmt(bhi)}`;
  }
  return `${def.nameZh} · ${chance}\n${def.effectZh}`;
}

export function arcadeVisible(state: GameState): boolean {
  return arcadeUnlocked(state) || state.arcade.stats.runs > 0 || state.arcade.runs.length > 0;
}

export function arcadeView(state: GameState): ArcadeView {
  const arcade = state.arcade;
  const visible = arcadeVisible(state);
  const runsCount = arcade.runs.length;
  const nextIn = nextBeaconIn(state);
  const beacon = !arcadeUnlocked(state)
    ? "天体物理学 1 级后开始积攒信标"
    : Number.isFinite(nextIn)
      ? `下次信标 ${formatDuration(Math.ceil(nextIn))}（冷却 ${formatDuration(arcade.beaconRequired)}）`
      : `信标已存满 ${ARCADE.beaconMax} 次，开奖后继续积攒`;
  const unit = betUnitDeut(state);
  const total = totalBetUnits(state);
  const max = maxBetUnits();
  const bets: ArcadeBetView[] = BET_SYMBOLS.map((symbol) => ({
    symbol,
    name: arcadeSymbolDef(symbol).nameZh,
    units: `${arcade.bets[symbol]} 注`,
    odds: `×${betOdds(symbol).toFixed(1)}`,
    canAdd: total < max,
    canSub: arcade.bets[symbol] > 0,
  }));
  const price = topUpPrice(state);
  const reason = topUpReason(state);
  const points = empirePoints(state);
  const cap = prizeCap(state);
  const window = productionMe(state) * ARCADE.prizeWindowSeconds;
  const ranges: Ranges = visible ? { normal: resourceRange(state, false), big: resourceRange(state, true) } : { normal: [0, 0], big: [0, 0] };

  const odds: ArcadeOddsRow[] = ARCADE_SYMBOL_DEFS.map((def) => {
    const open = def.opensIn <= 2;
    const chance = SYMBOL_CHANCE[def.id];
    const merged = !open && def.mergeInto ? `并入${arcadeSymbolDef(def.mergeInto).nameZh}` : "—";
    return {
      key: def.id,
      cells: [`${def.glyph} ${def.nameZh}`, String(def.tiles), open ? pct(chance) : merged, def.effectZh] as [string, string, string, string],
      dark: !open,
    };
  });
  const luckyRows: ArcadeOddsRow[] = LUCKY_TABLE.map((row) => ({
    key: row.kind,
    cells: [row.nameZh, "", `${row.pct}%`, row.detailZh] as [string, string, string, string],
    dark: false,
  }));

  const runs = arcade.stats.runs;
  const stats: ArcadeOddsRow[] = ARCADE_SYMBOL_DEFS.filter((def) => def.opensIn <= 2).map((def) => {
    const hits = arcade.stats.hits[def.id];
    return {
      key: def.id,
      cells: [
        `${def.glyph} ${def.nameZh}`,
        String(hits),
        runs > 0 ? pct(hits / runs) : "—",
        pct(SYMBOL_CHANCE[def.id]),
      ] as [string, string, string, string],
      dark: false,
    };
  });
  const history = arcade.history.map((entry) => ({
    symbol: entry.symbol,
    glyph: arcadeSymbolDef(entry.symbol).glyph,
    big: entry.big,
    title: `${arcadeSymbolDef(entry.symbol).nameZh}${entry.big ? "（大）" : ""}${entry.auto ? " · 自动" : ""}\n${entry.summary}`,
  }));
  const lastEntry = arcade.history[arcade.history.length - 1];
  const manual = arcade.stats.manualRuns;
  const autoHint = state.unlockedCards.includes("auto_runner")
    ? "协议卡「自动跑灯」已解锁：有开奖次数时按常驻押注自动开奖（离线也会开）。"
    : `手动开奖 ${Math.min(manual, ARCADE.autoCardManualRuns)}/${ARCADE.autoCardManualRuns} 次后解锁协议卡「自动跑灯」。`;

  return {
    visible,
    runsCount,
    runs: `${runsCount} / ${ARCADE.storedMax}`,
    beacon,
    pity: `保底 ${arcade.pity.empty}/${ARCADE.emptyPity}`,
    jackpot: `大奖 ${arcade.pity.jackpot}/${ARCADE.jackpotPity}`,
    betLine: `押注合计 ${total}/${max} 注 = ${formatAmount(big(total * unit))} 重氢 · 1 注 = ${formatAmount(big(unit))} 重氢（帝国 5 分钟重氢产量）`,
    bets,
    topUpLabel: `重氢加注 ${formatAmount(big(price))}`,
    topUpEnabled: reason === "",
    topUpTitle: reason || "花重氢立刻多攒 1 次开奖；价格 = 每小时重氢产量 × 2^(过去 24 小时游戏时间内的加注次数)",
    canRun: runsCount > 0,
    prize: `奖池上限 ${formatAmount(big(cap))} 金属当量（积分 ${points.toLocaleString("en-US")} 对应 OGame 远征阶梯 × ${ARCADE.fleetFactor}）· 资源图块最多帝国 10 分钟产量 ${formatAmount(big(window))} 金属当量`,
    tiles: BOARD.map((symbol, index) => {
      const def = arcadeSymbolDef(symbol);
      const cell = boardCell(index);
      return { index, symbol, glyph: def.glyph, name: def.nameZh, open: tileOpen(index), row: cell.row, col: cell.col, title: tileTitle(index, ranges) };
    }),
    odds,
    luckyRows,
    history,
    historySignature: arcade.history.map((entry) => `${entry.at}:${entry.symbol}`).join("|"),
    stats,
    statsLine: `累计开奖 ${runs} 次（手动 ${manual}，自动 ${arcade.stats.autoRuns}）· 星环机暗物质 ${arcade.stats.darkMatter.toLocaleString("en-US")} · 押注花费 ${formatAmount(big(arcade.stats.betSpent))} / 赢回 ${formatAmount(big(arcade.stats.betWon))}（金属当量）`,
    last: lastEntry ? lastEntry.summary.split("；") : ["还没有开过奖。"],
    autoHint,
  };
}
