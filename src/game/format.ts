import { big, type BigNumber } from "./decimal";

const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];

/** Stable, readable amount. Sub-1000 values keep two decimals so ticks are visible. */
export function formatAmount(value: BigNumber): string {
  const sign = value.sign() < 0 ? "-" : "";
  const abs = value.abs();
  if (abs.lt(1000)) return sign + abs.toFixed(2);

  const exp = Math.floor(abs.log10());
  if (!Number.isFinite(exp)) return value.toString();

  const tier = Math.floor(exp / 3);
  if (tier > 0 && tier < SUFFIXES.length) {
    const scaled = abs.div(big(10).pow(tier * 3));
    return sign + scaled.toFixed(2) + SUFFIXES[tier];
  }
  return sign + abs.toExponential(2);
}

export function formatCount(value: BigNumber): string {
  if (value.lt(1000)) return value.floor().toFixed(0);
  return formatAmount(value);
}

export function formatRate(value: BigNumber): string {
  const sign = value.sign() < 0 ? "" : "+";
  return `${sign}${formatAmount(value)}/s`;
}

export function formatMultiplier(value: BigNumber): string {
  if (value.lt(1000)) return `×${value.toFixed(2)}`;
  return `×${formatAmount(value)}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0 秒";
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${secs} 秒`;
  return `${secs} 秒`;
}

export function formatPlayed(value: BigNumber): string {
  if (value.gt(1e12)) return `${formatAmount(value)} 秒`;
  return formatDuration(value.toNumber());
}
