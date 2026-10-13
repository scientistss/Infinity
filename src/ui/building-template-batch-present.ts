import { normalizeOrderAmount } from "../game/order-money";
import type { OrderMoney } from "../game/order-state";
import type { GameState } from "../game/types";
import { BUILDING_TEMPLATE_RESOURCES, buildingTemplateMoney } from "./building-templates-present";

const UNIT = 10n ** 18n;
function scaled(value: string): bigint | null {
  const canonical = normalizeOrderAmount(value);
  if (canonical === null) return null;
  const [whole, fraction = ""] = canonical.split(".");
  return BigInt(whole!) * UNIT + BigInt(fraction.padEnd(18, "0"));
}
function display(value: bigint): string {
  const fraction = (value % UNIT).toString().padStart(18, "0").replace(/0+$/, "");
  return `${value / UNIT}${fraction ? `.${fraction}` : ""}`;
}

/** Display-only totals may exceed a single plan's limit. Never round through Number. */
export function buildingTemplateBatchBudgetTotals(rows: readonly { budget: OrderMoney; quote: OrderMoney | null }[]): {
  budget: OrderMoney | null; shortfall: OrderMoney | null;
} {
  const budget = {} as OrderMoney, shortfall = {} as OrderMoney;
  let knownQuotes = true;
  for (const [resource] of BUILDING_TEMPLATE_RESOURCES) {
    let total = 0n, gap = 0n;
    for (const row of rows) {
      const cap = scaled(row.budget[resource]);
      if (cap === null) return { budget: null, shortfall: null };
      total += cap;
      const quote = row.quote ? scaled(row.quote[resource]) : null;
      if (quote === null) knownQuotes = false;
      else if (quote > cap) gap += quote - cap;
    }
    budget[resource] = display(total); shortfall[resource] = display(gap);
  }
  return { budget, shortfall: knownQuotes ? shortfall : null };
}

export function buildingTemplateBatchGapText(shortfall: OrderMoney | null): string {
  if (!shortfall) return "逐项预算缺口无法精确核对。";
  const zero = BUILDING_TEMPLATE_RESOURCES.every(([id]) => shortfall[id] === "0");
  return zero ? "逐项预算缺口为 0；实际入队仍需本星库存、前置、格子与队列可用。"
    : `逐项预算缺口合计：${buildingTemplateMoney(shortfall)}。不足仍可登记；额度不足时等待，不自动追加，也不跨项调剂。`;
}

export function buildingTemplateBatchPlanetText(state: GameState, id: string): string {
  const planet = state.planets.find(value => value.id === id);
  if (!planet) return `${id}（已不存在）`;
  const coordinates = planet.coordinates;
  return `${planet.name} [${coordinates.galaxy}:${coordinates.system}:${coordinates.position}] · ${planet.id}`;
}
