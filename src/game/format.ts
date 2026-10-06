import { big, type BigNumber } from "./decimal";

/**
 * Antimatter-Dimensions-style scientific notation: values under 1000 keep two
 * decimals so ticks stay visible; everything else is `m.mme+x` (e.g. 1.23e4).
 */
export function formatAmount(value: BigNumber): string {
  const sign = value.sign() < 0 ? "-" : "";
  const abs = value.abs();
  if (abs.lt(1000)) return sign + abs.toFixed(2);

  let exponent = abs.exponent;
  let mantissa = Number(abs.mantissa.toFixed(2));
  if (!Number.isFinite(exponent) || !Number.isFinite(mantissa)) return value.toString();
  if (mantissa >= 10) {
    mantissa /= 10;
    exponent += 1;
  }
  return `${sign}${mantissa.toFixed(2)}e${exponent}`;
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

/** Dark matter is a whole-number currency: thousands separators below 1e9, scientific above. */
export function formatDm(value: BigNumber | number): string {
  const n = typeof value === "number" ? value : value.toNumber();
  if (!Number.isFinite(n) || Math.abs(n) >= 1e9) return formatAmount(typeof value === "number" ? big(value) : value);
  return Math.floor(n).toLocaleString("en-US");
}

/** Ship / defense counts: whole numbers with thousands separators, scientific from 1e9. */
export function formatUnits(value: number): string {
  return formatDm(value);
}
