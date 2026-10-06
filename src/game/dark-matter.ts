import { activePlanet, withPlanet } from "./empire";
/**
 * Dark matter (design doc §8.8). P2–P3 uses: halve / finish the running build, research or shipyard batch, the
 * item shop (KRAKEN, NEWTRON, DETROIT, resource boosters), resource packages and inventory items.
 * Every OGame duration (button price, item length, merchant day) runs on the dark-matter clock:
 * one OGame hour = one game minute (balance.json → darkMatterPrices.secondsPerOgameHour).
 */
import {
  DM_PRICES,
  DM_SECONDS_PER_OGAME_HOUR,
  dmClockSeconds,
  INVENTORY_LABEL,
  RESOURCE_PACKAGE,
  shopItemById,
  type InventoryItemId,
  type ShopItemId,
} from "../data/dark-matter";
import { resourceName } from "./content";
import { big, type BigNumber } from "./decimal";
import { economy } from "./economy";
import { formatAmount, formatDm, formatDuration } from "./format";
import { completeActive } from "./queue";
import { completeActiveResearch } from "./research";
import { RESOURCE_IDS, type GameState, type ResourceId } from "./types";
import { activeBooster } from "./boosters";
import { advanceShipyard, shipyardRemaining } from "./shipyard";

export { activeBooster, boosterFactor, nextBoosterExpiry, pruneBoosters, type Booster } from "./boosters";

export type SpeedupTarget = "build" | "research" | "shipyard";
export type SpeedupMode = "halve" | "finish";
export type PackageKind = ResourceId | "bundle";

export interface DmResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export interface SpeedupQuote {
  dm: number;
  allowed: boolean;
  reason: string;
}

export interface PackageQuote {
  amounts: Record<ResourceId, BigNumber>;
  dm: number;
  ok: boolean;
  reason: string;
}

const fail = (state: GameState, reason: string): DmResult => ({ state, ok: false, reason });

export function emptyInventory(): Record<InventoryItemId, number> {
  return { kraken_box: 0, newtron_box: 0, detroit_box: 0, booster_box: 0, supply_pack: 0 };
}

/** Add dark matter from an in-game source. */
export function grantDarkMatter(state: GameState, amount: number): GameState {
  if (!(amount > 0)) return state;
  return {
    ...state,
    darkMatter: state.darkMatter.add(amount),
    stats: { ...state.stats, darkMatterEarned: state.stats.darkMatterEarned + amount },
  };
}

function spend(state: GameState, dm: number): GameState {
  return { ...state, darkMatter: state.darkMatter.sub(dm) };
}

function lacksDm(state: GameState, dm: number): string {
  return state.darkMatter.lt(dm) ? `暗物质不足（需要 ${formatDm(dm)}，现有 ${formatDm(state.darkMatter)}）` : "";
}

// ---------- halve / finish ----------

/** Game seconds → OGame hours on the dark-matter clock (60 s = 1 OGame hour). */
export function toOgameHours(seconds: number): number {
  return Math.max(0, seconds) / DM_SECONDS_PER_OGAME_HOUR;
}

/**
 * OGame: 750 DM per started half hour of the time taken off, min 750, max 72,000 (buildings) /
 * 108,000 (research) per click, on the dark-matter clock (750 DM per started 30 game seconds). Halving is always possible (price capped); finishing in one click only
 * while its price stays under the cap.
 */
export function speedupQuote(remainingSeconds: number, target: SpeedupTarget, mode: SpeedupMode): SpeedupQuote {
  const prices = DM_PRICES.speedup;
  const max = target === "research" ? prices.maxResearch : prices.maxBuilding;
  const taken = mode === "finish" ? remainingSeconds : remainingSeconds / 2;
  const raw = prices.dmPerHalfHour * Math.ceil(toOgameHours(taken) * 2 - 1e-9);
  const dm = Math.min(max, Math.max(prices.min, raw));
  if (mode === "finish" && raw > max) {
    return { dm, allowed: false, reason: `超过单次上限 ${formatDm(max)}，先减半` };
  }
  return { dm, allowed: true, reason: "" };
}

function activeRemaining(state: GameState, target: SpeedupTarget): number | null {
  if (target === "shipyard") return shipyardRemaining(state);
  const head = target === "build" ? activePlanet(state).buildQueue[0] : state.research.queue[0];
  if (!head || head.totalSeconds <= 0) return null;
  return head.remainingSeconds;
}

const NOTHING_RUNNING: Record<SpeedupTarget, string> = {
  build: "没有正在建造的项目",
  research: "没有正在进行的研究",
  shipyard: "造船厂没有在造的批次",
};

export function speedUp(state: GameState, target: SpeedupTarget, mode: SpeedupMode): DmResult {
  const remaining = activeRemaining(state, target);
  if (remaining === null) return fail(state, NOTHING_RUNNING[target]);
  const quote = speedupQuote(remaining, target, mode);
  if (!quote.allowed) return fail(state, quote.reason);
  const lack = lacksDm(state, quote.dm);
  if (lack) return fail(state, lack);
  const paid = spend(state, quote.dm);
  const taken = mode === "finish" ? remaining : remaining / 2;
  const next =
    target === "build"
      ? advanceBuild(paid, taken, false)
      : target === "research"
        ? advanceResearch(paid, taken, false)
        : advanceShipyard(paid, taken, false).state;
  const verb = mode === "finish" ? "立即完成" : "剩余时间减半";
  return { state: next, ok: true, reason: `花费 ${formatDm(quote.dm)} 暗物质，${verb}` };
}

/**
 * Take `seconds` off the running build. With `carry` the surplus moves on to the next orders (KRAKEN rule);
 * without it only the head order is shortened.
 */
export function advanceBuild(state: GameState, seconds: number, carry: boolean): GameState {
  let current = state;
  let left = seconds;
  for (let guard = 0; guard < 10 && left > 0; guard += 1) {
    const head = activePlanet(current).buildQueue[0];
    if (!head || head.totalSeconds <= 0) break;
    if (left + 1e-9 < head.remainingSeconds) {
      const [, ...rest] = activePlanet(current).buildQueue;
      current = { ...withPlanet(current, { planet: { ...activePlanet(current), buildQueue: [{ ...head, remainingSeconds: head.remainingSeconds - left }, ...rest] } }) };
      break;
    }
    left -= head.remainingSeconds;
    current = completeActive(current).state;
    if (!carry) break;
  }
  return current;
}

export function advanceResearch(state: GameState, seconds: number, carry: boolean): GameState {
  let current = state;
  let left = seconds;
  for (let guard = 0; guard < 10 && left > 0; guard += 1) {
    const head = current.research.queue[0];
    if (!head || head.totalSeconds <= 0) break;
    if (left + 1e-9 < head.remainingSeconds) {
      const [, ...rest] = current.research.queue;
      current = {
        ...current,
        research: { ...current.research, queue: [{ ...head, remainingSeconds: head.remainingSeconds - left }, ...rest] },
      };
      break;
    }
    left -= head.remainingSeconds;
    current = completeActiveResearch(current).state;
    if (!carry) break;
  }
  return current;
}

// ---------- boosters ----------

/**
 * One booster per resource (OGame: a stronger booster replaces a weaker one). The same strength extends the
 * end time; a weaker one is refused while a stronger one runs.
 */
export function applyBooster(state: GameState, res: ResourceId, pct: number, seconds: number): { state: GameState; ok: boolean; reason: string } {
  const now = state.totalTime.toNumber();
  const current = activeBooster(state, res);
  if (current && current.pct > pct) {
    return { state, ok: false, reason: `${resourceName(res)}已有 +${current.pct}% 加成生效中` };
  }
  const until = current && current.pct === pct ? current.until + seconds : now + seconds;
  const boosters = state.boosters.filter((booster) => booster.res !== res && booster.until > now);
  boosters.push({ res, pct, until });
  return { state: { ...state, boosters }, ok: true, reason: "" };
}

// ---------- shop ----------

export function shopItemReason(state: GameState, id: ShopItemId, res: ResourceId = "metal"): string {
  const def = shopItemById(id);
  const lack = lacksDm(state, def.dm);
  if (lack) return lack;
  if (def.kind === "kraken" && activeRemaining(state, "build") === null) return "没有正在建造的项目";
  if (def.kind === "newtron" && activeRemaining(state, "research") === null) return "没有正在进行的研究";
  if (def.kind === "detroit" && activeRemaining(state, "shipyard") === null) return activePlanet(state).shipyardQueue.length > 0 ? "造船暂停中" : "造船厂没有在造的批次";
  if (def.kind === "booster") {
    const current = activeBooster(state, res);
    if (current && current.pct > (def.pct ?? 0)) return `${resourceName(res)}已有 +${current.pct}% 加成生效中`;
  }
  return "";
}

/** Buy and activate a shop item at once. */
export function buyShopItem(state: GameState, id: ShopItemId, res: ResourceId = "metal"): DmResult {
  const def = shopItemById(id);
  const reason = shopItemReason(state, id, res);
  if (reason) return fail(state, reason);
  const paid = spend(state, def.dm);
  if (def.kind === "kraken" || def.kind === "newtron" || def.kind === "detroit") {
    const seconds = dmClockSeconds(def.ogameHours ?? 0);
    const next =
      def.kind === "kraken"
        ? advanceBuild(paid, seconds, true)
        : def.kind === "newtron"
          ? advanceResearch(paid, seconds, true)
          : advanceShipyard(paid, seconds, true).state;
    return { state: next, ok: true, reason: `${def.nameZh}：缩短 ${formatDuration(seconds)}（OGame ${def.ogameHours} 小时）` };
  }
  const seconds = dmClockSeconds((def.ogameDays ?? 7) * 24);
  const boosted = applyBooster(paid, res, def.pct ?? 10, seconds);
  if (!boosted.ok) return fail(state, boosted.reason);
  return {
    state: boosted.state,
    ok: true,
    reason: `${def.nameZh}：${resourceName(res)}矿产量 +${def.pct}%，持续 ${formatDuration(seconds)}（OGame ${def.ogameDays} 天）`,
  };
}

// ---------- resource packages ----------

/** One OGame day of gross production (all mines and base output; 24 game minutes), at least 10,000. */
export function dailyProduction(state: GameState, res: ResourceId): number {
  const perSecond = economy(state).gross[res];
  return Math.max(RESOURCE_PACKAGE.minAmount, perSecond * dmClockSeconds(RESOURCE_PACKAGE.ogameHours));
}

/** Supply pack (ring machine supply box) = the merchant's 10% package: 2.4 game minutes, at least 10,000. */
export function supplyPackAmount(state: GameState, res: ResourceId): number {
  const perSecond = economy(state).gross[res];
  const seconds = dmClockSeconds(RESOURCE_PACKAGE.ogameHours) * RESOURCE_PACKAGE.supplyPackFraction;
  return Math.max(RESOURCE_PACKAGE.minAmount, perSecond * seconds);
}

export function freeStorage(state: GameState, res: ResourceId): number {
  const cap = economy(state).caps[res];
  return Math.max(0, cap - activePlanet(state).resources[res].toNumber());
}

/**
 * Resource merchant: up to one OGame day (24 game minutes) of production per resource for 36,000 DM (108,000
 * for all three), the same price as skipping 24 OGame hours on the button. Price proportional to the amount,
 * at least 500 DM, limited by free storage.
 */
export function packageQuote(state: GameState, kind: PackageKind, fraction: number): PackageQuote {
  const amounts = { metal: big(0), crystal: big(0), deuterium: big(0) } as Record<ResourceId, BigNumber>;
  const ids: readonly ResourceId[] = kind === "bundle" ? RESOURCE_IDS : [kind];
  const f = Math.min(1, Math.max(0, fraction));
  let share = 0;
  for (const id of ids) {
    const daily = dailyProduction(state, id);
    const raw = Math.max(0, Math.min(daily * f, freeStorage(state, id)));
    amounts[id] = big(Math.floor(raw));
    share += raw / daily;
  }
  const full = kind === "bundle" ? RESOURCE_PACKAGE.dmBundle : RESOURCE_PACKAGE.dmPerResource;
  const dm = Math.max(RESOURCE_PACKAGE.minDm, Math.ceil((full * share) / ids.length - 1e-6));
  if (ids.every((id) => amounts[id].lte(0))) return { amounts, dm, ok: false, reason: "仓库已满，放不下" };
  const lack = lacksDm(state, dm);
  return { amounts, dm, ok: lack === "", reason: lack };
}

export function buyPackage(state: GameState, kind: PackageKind, fraction: number): DmResult {
  const quote = packageQuote(state, kind, fraction);
  if (!quote.ok) return fail(state, quote.reason);
  const resources = { ...activePlanet(state).resources };
  const parts: string[] = [];
  for (const id of RESOURCE_IDS) {
    if (quote.amounts[id].lte(0)) continue;
    resources[id] = resources[id].add(quote.amounts[id]);
    parts.push(`${resourceName(id)} ${formatAmount(quote.amounts[id])}`);
  }
  return {
    state: { ...withPlanet(spend(state, quote.dm), { resources }) },
    ok: true,
    reason: `花费 ${formatDm(quote.dm)} 暗物质，获得 ${parts.join("、")}`,
  };
}

// ---------- inventory ----------

export function addInventory(state: GameState, id: InventoryItemId, count = 1): GameState {
  return { ...state, items: { ...state.items, [id]: state.items[id] + count } };
}

export function useInventory(state: GameState, id: InventoryItemId): DmResult {
  if (state.items[id] <= 0) return fail(state, `背包里没有${INVENTORY_LABEL[id].name}`);
  const take = (s: GameState): GameState => ({ ...s, items: { ...s.items, [id]: s.items[id] - 1 } });
  if (id === "kraken_box") {
    const remaining = activeRemaining(state, "build");
    if (remaining === null) return fail(state, "没有正在建造的项目");
    return { state: advanceBuild(take(state), remaining * 0.3, false), ok: true, reason: "克拉肯：建造剩余时间 −30%" };
  }
  if (id === "newtron_box") {
    const remaining = activeRemaining(state, "research");
    if (remaining === null) return fail(state, "没有正在进行的研究");
    return { state: advanceResearch(take(state), remaining * 0.3, false), ok: true, reason: "纽特隆：研究剩余时间 −30%" };
  }
  if (id === "detroit_box") {
    const remaining = activeRemaining(state, "shipyard");
    if (remaining === null) return fail(state, activePlanet(state).shipyardQueue.length > 0 ? "造船暂停中" : "造船厂没有在造的批次");
    return { state: advanceShipyard(take(state), remaining * 0.3, false).state, ok: true, reason: "底特律：造船厂当前批次剩余时间 −30%" };
  }
  if (id === "booster_box") {
    let next = take(state);
    const applied: string[] = [];
    for (const res of RESOURCE_IDS) {
      const boosted = applyBooster(next, res, 10, 3600);
      if (boosted.ok) {
        next = boosted.state;
        applied.push(resourceName(res));
      }
    }
    if (applied.length === 0) return fail(state, "三种资源都已有更高的加成");
    return { state: next, ok: true, reason: `资源 +10%：${applied.join("、")}，持续 1 小时` };
  }
  // Supply pack = the merchant's 10% package of each resource.
  const resources = { ...activePlanet(state).resources };
  const parts: string[] = [];
  for (const res of RESOURCE_IDS) {
    const amount = Math.floor(Math.min(supplyPackAmount(state, res), freeStorage(state, res)));
    if (amount <= 0) continue;
    resources[res] = resources[res].add(amount);
    parts.push(`${resourceName(res)} ${formatAmount(big(amount))}`);
  }
  if (parts.length === 0) return fail(state, "仓库已满，放不下");
  return { state: { ...withPlanet(take(state), { resources }) }, ok: true, reason: `资源补给包：${parts.join("、")}` };
}
