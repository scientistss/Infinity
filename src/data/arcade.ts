/**
 * Deep-space ring machine (深空星环机), beacon version (design doc §8.6, P2; drifting ships open in P3).
 * A 7×7 arcade board: 24 tiles around the edge, one light runs clockwise and stops on the pre-rolled tile.
 * Pure data: symbols, the public odds table, the board layout, LUCKY extras and balance numbers.
 */
import balance from "./balance.json";

export const ARCADE = balance.arcade;

export const ARCADE_SYMBOLS = [
  "metal",
  "crystal",
  "deuterium",
  "drifter",
  "dark_matter",
  "supply",
  "empty",
  "turbulence",
  "tailwind",
  "pirate",
  "alien",
  "merchant",
  "blackhole",
  "lucky",
  "jackpot",
] as const;

export type ArcadeSymbol = (typeof ARCADE_SYMBOLS)[number];
export type BetSymbol = "metal" | "crystal" | "deuterium" | "drifter";
export const BET_SYMBOLS: readonly BetSymbol[] = ["metal", "crystal", "deuterium", "drifter"];

export interface ArcadeSymbolDef {
  id: ArcadeSymbol;
  nameZh: string;
  /** Short glyph drawn on the tile (no OGame art). */
  glyph: string;
  tiles: number;
  /** Beacon-run probability in percent from the doc table; 0 when the beacon column is "—". */
  beaconPct: number;
  /** Phase the tile opens; before that its weight moves to `mergeInto` and the tile is drawn dark. */
  opensIn: number;
  mergeInto?: ArcadeSymbol;
  effectZh: string;
}

/** Current port phase for the ring machine (P3: drifting ships open). */
export const ARCADE_PHASE = 3;

export const ARCADE_SYMBOL_DEFS: readonly ArcadeSymbolDef[] = [
  { id: "metal", nameZh: "金属陨石", glyph: "◆", tiles: 3, beaconPct: 16, opensIn: 2, effectZh: "金属：奖池 × 档位，最多帝国 10 分钟产量" },
  { id: "crystal", nameZh: "晶簇", glyph: "✦", tiles: 2, beaconPct: 13, opensIn: 2, effectZh: "晶体（金属当量 ÷ 2）" },
  { id: "deuterium", nameZh: "重氢云", glyph: "●", tiles: 2, beaconPct: 6, opensIn: 2, effectZh: "重氢（金属当量 ÷ 3）" },
  { id: "drifter", nameZh: "漂流舰", glyph: "▲", tiles: 3, beaconPct: 10, opensIn: 3, mergeInto: "metal", effectZh: "舰船：价值为资源奖品的一半（最多帝国 10 分钟产量），只出已解锁及高一档的舰船，不出死星" },
  { id: "dark_matter", nameZh: "暗物质", glyph: "◎", tiles: 2, beaconPct: 9, opensIn: 2, effectZh: "暗物质 300–400，大档 500–700" },
  { id: "supply", nameZh: "补给箱", glyph: "▣", tiles: 1, beaconPct: 3, opensIn: 2, effectZh: "道具进背包：克拉肯 / 纽特隆 / 底特律 / 资源 +10% / 补给包；大档 2 个" },
  { id: "empty", nameZh: "空域", glyph: "·", tiles: 3, beaconPct: 27, opensIn: 2, effectZh: "什么也没找到" },
  { id: "turbulence", nameZh: "引力乱流", glyph: "≈", tiles: 1, beaconPct: 5, opensIn: 2, effectZh: "下次信标冷却 +50%" },
  { id: "tailwind", nameZh: "曲速顺流", glyph: "»", tiles: 1, beaconPct: 5, opensIn: 2, effectZh: "信标冷却退回 50%" },
  { id: "pirate", nameZh: "海盗旗", glyph: "☠", tiles: 1, beaconPct: 0, opensIn: 5, mergeInto: "empty", effectZh: "P5 起战斗；信标开奖并入空域" },
  { id: "alien", nameZh: "异星眼", glyph: "◉", tiles: 1, beaconPct: 0, opensIn: 5, mergeInto: "empty", effectZh: "P5 起战斗；信标开奖并入空域" },
  { id: "merchant", nameZh: "商船", glyph: "⚑", tiles: 1, beaconPct: 3, opensIn: 4, mergeInto: "metal", effectZh: "限时商人（P4）；之前并入金属陨石" },
  { id: "blackhole", nameZh: "黑洞", glyph: "○", tiles: 1, beaconPct: 0, opensIn: 4, mergeInto: "empty", effectZh: "只影响充能舰队（P4）；信标开奖并入空域" },
  { id: "lucky", nameZh: "LUCKY 送灯", glyph: "★", tiles: 1, beaconPct: 2, opensIn: 2, effectZh: "送额外的灯，一次命中多个图块" },
  { id: "jackpot", nameZh: "JACKPOT 曲率大奖", glyph: "♛", tiles: 1, beaconPct: 1, opensIn: 2, effectZh: "巨大档奖品 + 暗物质 1,000–1,800" },
];

export function arcadeSymbolDef(id: ArcadeSymbol): ArcadeSymbolDef {
  const def = ARCADE_SYMBOL_DEFS.find((item) => item.id === id);
  if (!def) throw new Error(`Unknown ring machine symbol ${id}`);
  return def;
}

export function isArcadeSymbol(value: unknown): value is ArcadeSymbol {
  return typeof value === "string" && (ARCADE_SYMBOLS as readonly string[]).includes(value);
}

export function isBetSymbol(value: unknown): value is BetSymbol {
  return typeof value === "string" && (BET_SYMBOLS as readonly string[]).includes(value);
}

/**
 * Board, clockwise from the top-left corner (tiles 1–24 in the doc). Same symbols never touch, the ring wraps.
 */
export const BOARD: readonly ArcadeSymbol[] = [
  "metal", "empty", "crystal", "dark_matter", "drifter", "lucky", "metal",
  "deuterium", "empty", "turbulence", "crystal", "supply", "drifter",
  "metal", "pirate", "dark_matter", "jackpot", "empty", "deuterium",
  "tailwind", "drifter", "alien", "merchant", "blackhole",
];

/** Grid cell (1-based row / column on the 7×7 board) for a ring index. */
export function boardCell(index: number): { row: number; col: number } {
  if (index < 7) return { row: 1, col: index + 1 };
  if (index < 12) return { row: index - 5, col: 7 };
  if (index < 19) return { row: 7, col: 7 - (index - 12) };
  return { row: 7 - (index - 18), col: 1 };
}

export type LuckyKind = "two" | "three" | "small_three" | "train" | "big_three";

export const LUCKY_TABLE: readonly { kind: LuckyKind; pct: number; nameZh: string; detailZh: string }[] = [
  { kind: "two", pct: 50, nameZh: "送 2 灯", detailZh: "再跑 2 盏灯，各自结算" },
  { kind: "three", pct: 25, nameZh: "送 3 灯", detailZh: "再跑 3 盏灯" },
  { kind: "small_three", pct: 15, nameZh: "小三元", detailZh: "金属、晶体、重氢各发一份普通档" },
  { kind: "train", pct: 8, nameZh: "开火车", detailZh: "从落点起连亮 3–6 格，好结果全发，坏结果忽略" },
  { kind: "big_three", pct: 2, nameZh: "大三元", detailZh: "金属、晶体、重氢各发一份大档" },
];

/** Extra lights from LUCKY never stop here (no chains, no penalties). */
export const LUCKY_EXCLUDED: readonly ArcadeSymbol[] = ["lucky", "jackpot", "blackhole", "pirate", "alien"];
/** Outcomes that count toward the empty-light pity. */
export const EMPTY_SYMBOLS: readonly ArcadeSymbol[] = ["empty", "turbulence"];
/** The empty-light pity lands on one of these. */
export const GOOD_SYMBOLS: readonly ArcadeSymbol[] = ["metal", "crystal", "deuterium", "drifter", "dark_matter", "supply", "lucky"];

/** Flavour lines for empty space, written for this game in the style of an expedition log. */
export const EMPTY_LINES: readonly string[] = [
  "信标扫过一片寂静的星域，只记录到宇宙背景辐射。",
  "探测器追着一颗彗星跑了半圈，结果只是冰块。",
  "传感器读数异常——原来是镜头上落了一粒星尘。",
  "这片空域干净得像刚打扫过，什么也没有。",
  "信标收到一段古老的广播：只是有人在报天气。",
  "一群发光的星际水母从屏幕前游过，没有留下任何东西。",
  "导航员坚信看到了什么，回放录像后承认那是反光。",
  "深空很大，这一次，它保持了沉默。",
];
