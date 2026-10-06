import { evaluateEvents, evaluateLoadout, refreshUnlocks, type ProtocolEvents } from "../automation/engine";
import { ACHIEVEMENTS } from "../data/achievements";
import type { StoredResId } from "../data/protocol-cards";
import {
  OFFLINE_PROTOCOL_SECONDS,
  PRESTIGE_SCORE_UNIT,
  PROTOCOL_LIVE_EVAL_SECONDS,
  SCORE_WEIGHTS,
} from "./content";
import { big, bigFloor, bigSqrt, type BigNumber } from "./decimal";
import { baseCollectAmount, economy, type EconomySnapshot } from "./economy";
import { MIN_BUILD_SECONDS } from "./formulas";
import { completeActive, startNext, queueCapacity, type CompletedBuild } from "./queue";
import {
  completeActiveResearch,
  researchCapacity,
  startNextResearch,
  withResearchRemaining,
  type CompletedResearch,
} from "./research";
import { applySeedStock, manualClickMultiplier, scoreMultiplier } from "../prestige/tree";
import { createInitialState } from "./state";
import { nextBoosterExpiry, pruneBoosters } from "./boosters";
import { accrueBeacons, cloneArcade, grantRun, nextBeaconIn } from "./arcade";
import { DM_ACHIEVEMENT_REWARD } from "../data/dark-matter";
import { advanceShipyard, nextShipyardEvent, type CompletedUnits } from "./shipyard";
import { RESOURCE_IDS, type GameState } from "./types";

export { energyReport, globalMultiplier, productionPerSecond, storageCaps, type EnergyReport } from "./economy";

export type TickMode = "live" | "offline";

/** Optional sink for things that happened inside one tick (offline summary). */
export interface TickLog {
  completedBuilds: CompletedBuild[];
  completedResearch: CompletedResearch[];
  completedUnits: CompletedUnits[];
}

export function emptyTickLog(): TickLog {
  return { completedBuilds: [], completedResearch: [], completedUnits: [] };
}

const EPS = 1e-9;

/**
 * Advance the simulation by `dtSeconds` with event-driven piecewise integration (design doc §5.10).
 * Between events (build finished, storage full, deuterium empty, protocol pass) every rate is
 * constant, so one long tick equals many short ones. Live play runs protocol passes every second,
 * offline catch-up every 60 seconds; queue/storage events run event cards immediately in both.
 * Pure: the input state is not mutated.
 */
export function tick(state: GameState, dtSeconds: number, mode: TickMode = "live", log?: TickLog): GameState {
  let current = applyAchievementUnlocks(startNextResearch(startNext(state)));
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return current;
  const period = mode === "offline" ? OFFLINE_PROTOCOL_SECONDS : PROTOCOL_LIVE_EVAL_SECONDS;
  const limit = Math.ceil(dtSeconds / period) + 4 * Math.ceil(dtSeconds / MIN_BUILD_SECONDS) + 64;

  let t = 0;
  let segments = 0;
  while (dtSeconds - t > EPS) {
    segments += 1;
    const eco = economy(current);
    const left = dtSeconds - t;
    if (segments > limit) {
      // Safety valve: integrate the rest in one piece rather than spin.
      current = integrate(current, left, eco).state;
      break;
    }
    let step = left;
    const head = current.planet.buildQueue[0];
    if (head && head.totalSeconds > 0) step = Math.min(step, Math.max(0, head.remainingSeconds));
    const lab = current.research.queue[0];
    if (lab && lab.totalSeconds > 0) step = Math.min(step, Math.max(0, lab.remainingSeconds));
    step = Math.min(step, Math.max(0, period - current.protocols.accumulator));
    step = Math.min(step, nextBoundary(current, eco), nextBoosterExpiry(current), nextBeaconIn(current), nextShipyardEvent(current));

    const moved = integrate(current, step, eco);
    current = pruneBoosters(moved.state);

    // Shipyard: runs on the levels at the start of the step (it pauses while the shipyard / nanite upgrade).
    const yardBusy = current.planet.shipyardQueue.length > 0;
    const yard = advanceShipyard(current, step);
    current = yard.state;
    if (log) for (const done of yard.completed) addUnits(log.completedUnits, done);
    const shipyardIdle = yardBusy && current.planet.shipyardQueue.length === 0;

    // Queue: count down the active order, finish it, start the next one.
    let queueIdle = false;
    const active = current.planet.buildQueue[0];
    if (active && active.totalSeconds > 0) {
      const remaining = active.remainingSeconds - step;
      if (remaining <= EPS) {
        const done = completeActive(current);
        current = done.state;
        if (done.completed) log?.completedBuilds.push(done.completed);
        queueIdle = current.planet.buildQueue.length < queueCapacity(current);
      } else {
        current = withHeadRemaining(current, remaining);
      }
    }

    // Research: same countdown on the empire research queue.
    let researchIdle = false;
    const studying = current.research.queue[0];
    if (studying && studying.totalSeconds > 0) {
      const remaining = studying.remainingSeconds - step;
      if (remaining <= EPS) {
        const done = completeActiveResearch(current);
        current = done.state;
        if (done.completed) log?.completedResearch.push(done.completed);
        researchIdle = current.research.queue.length < researchCapacity(current);
      } else {
        current = withResearchRemaining(current, remaining);
      }
    }

    // Ring machine: beacons accrue on game time (offline too, within the offline cap).
    const beacon = accrueBeacons(current, step);
    current = beacon.state;

    const events: ProtocolEvents = { queueIdle, researchIdle, storageFull: moved.filled, runsReady: beacon.granted > 0, shipyardIdle };
    if (moved.filled.length > 0 && !current.stats.seenStorageFull) {
      current = { ...current, stats: { ...current.stats, seenStorageFull: true } };
    }
    current = evaluateEvents(refreshUnlocks(current), events);

    const accrued = current.protocols.accumulator + step;
    if (accrued >= period - EPS) current = evaluateLoadout(setAccumulator(current, 0), period);
    else current = setAccumulator(current, accrued);

    current = applyAchievementUnlocks(refreshUnlocks(current));
    t += step;
  }
  return applyAchievementUnlocks(refreshUnlocks(markStorageSeen(current)));
}

function addUnits(list: CompletedUnits[], done: CompletedUnits): void {
  const same = list.find((entry) => entry.unit === done.unit);
  if (same) same.count += done.count;
  else list.push({ ...done });
}

/** Seconds until the first resource changes regime (reaches its cap, or deuterium runs dry). */
function nextBoundary(state: GameState, eco: EconomySnapshot): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const id of RESOURCE_IDS) {
    const stock = state.resources[id].toNumber();
    const cap = eco.caps[id];
    const rate = eco.net[id];
    if (stock < cap && rate > 0) soonest = Math.min(soonest, (cap - stock) / rate);
    else if (stock > cap && rate < 0) soonest = Math.min(soonest, (stock - cap) / -rate);
    else if (stock > 0 && stock <= cap && rate < 0) soonest = Math.min(soonest, stock / -rate);
  }
  return soonest;
}

/** Integrate `dt` seconds at constant rates. Clamps at caps and zero; lifetime counts real output only. */
function integrate(state: GameState, dt: number, eco: EconomySnapshot): { state: GameState; filled: StoredResId[] } {
  const resources = { ...state.resources };
  const lifetime = { ...state.lifetime };
  const filled: StoredResId[] = [];
  if (dt <= 0) return { state, filled };
  for (const id of RESOURCE_IDS) {
    const before = resources[id];
    const cap = big(eco.caps[id]);
    let after = before.add(eco.net[id] * dt);
    const tolerance = eco.caps[id] * 1e-12;
    if (before.lt(cap) && after.gte(cap.sub(tolerance))) {
      after = cap;
      filled.push(id);
    } else if (before.gt(cap) && after.lte(cap.add(tolerance))) {
      after = cap;
    }
    if (after.lt(Math.max(1e-9, Math.abs(eco.net[id] * dt) * 1e-12))) after = big(0);
    resources[id] = after;
    const produced = after.sub(before).add(eco.consumption[id] * dt);
    if (produced.gt(0)) lifetime[id] = lifetime[id].add(produced);
  }
  return {
    state: { ...state, resources, lifetime, totalTime: state.totalTime.add(dt) },
    filled,
  };
}

function withHeadRemaining(state: GameState, remaining: number): GameState {
  const [head, ...rest] = state.planet.buildQueue;
  if (!head) return state;
  return {
    ...state,
    planet: { ...state.planet, buildQueue: [{ ...head, remainingSeconds: remaining }, ...rest] },
  };
}

function setAccumulator(state: GameState, accumulator: number): GameState {
  return { ...state, protocols: { ...state.protocols, accumulator } };
}

function markStorageSeen(state: GameState): GameState {
  if (state.stats.seenStorageFull) return state;
  const caps = economy(state).caps;
  const full = RESOURCE_IDS.some((id) => state.resources[id].gte(caps[id]));
  return full ? { ...state, stats: { ...state.stats, seenStorageFull: true } } : state;
}

/**
 * Record an energy shortage, then append any newly met achievements. Already unlocked stays unlocked.
 * Each new achievement grants a little dark matter (design doc §8.8).
 */
export function applyAchievementUnlocks(state: GameState): GameState {
  const marked = markEnergyShortage(state);
  const owned = new Set(marked.unlocked);
  let added = 0;
  for (const def of ACHIEVEMENTS) {
    if (owned.has(def.id)) continue;
    if (def.met(marked)) {
      owned.add(def.id);
      added += 1;
    }
  }
  if (added === 0) return marked;
  const reward = added * DM_ACHIEVEMENT_REWARD;
  const next: GameState = {
    ...marked,
    unlocked: ACHIEVEMENTS.filter((def) => owned.has(def.id)).map((def) => def.id),
    darkMatter: marked.darkMatter.add(reward),
    stats: { ...marked.stats, darkMatterEarned: marked.stats.darkMatterEarned + reward },
  };
  // Opening the ring machine comes with one bonus run of at least the big tier (design doc §8.6.7).
  if (owned.has(BONUS_RUN_ACHIEVEMENT) && !marked.unlocked.includes(BONUS_RUN_ACHIEVEMENT)) {
    return grantRun(next, "bonus", true).state;
  }
  return next;
}

const BONUS_RUN_ACHIEVEMENT = "astrophysics_1";

export function markEnergyShortage(state: GameState): GameState {
  if (state.seenEnergyShortage && state.stats.seenEnergyShort) return state;
  const short = state.seenEnergyShortage || economy(state).efficiency < 1;
  if (!short) return state;
  return {
    ...state,
    seenEnergyShortage: true,
    stats: { ...state.stats, seenEnergyShort: true },
  };
}

export function expansionScore(state: GameState): BigNumber {
  const raw = state.lifetime.metal
    .mul(SCORE_WEIGHTS.metal)
    .add(state.lifetime.crystal.mul(SCORE_WEIGHTS.crystal))
    .add(state.lifetime.deuterium.mul(SCORE_WEIGHTS.deuterium));
  return raw.mul(scoreMultiplier(state));
}

/** Warp cores granted by launching a colony ship from this run. */
export function warpGain(state: GameState): BigNumber {
  const score = expansionScore(state);
  if (score.lt(PRESTIGE_SCORE_UNIT)) return big(0);
  return bigFloor(bigSqrt(score.div(PRESTIGE_SCORE_UNIT)));
}

/**
 * Launch the colony ship. Resets buildings, queue, production settings and resources to the 500/500 start.
 * Protocol cards, unlocks, achievements, the tech tree, research levels, dark matter, items, the ring machine and manual-click
 * progress stay (design doc §14.3). Research still in the queue is dropped with the rest of the run.
 * Returns the same state when the gain would be zero.
 */
export function prestige(state: GameState): GameState {
  const gain = warpGain(state);
  if (gain.lt(1)) return state;
  const next = createInitialState();
  next.warpCores = state.warpCores.add(gain);
  next.curvature = { ...state.curvature };
  next.research = { levels: { ...state.research.levels }, queue: [] };
  next.darkMatter = state.darkMatter;
  next.items = { ...state.items };
  next.boosters = state.boosters.map((booster) => ({ ...booster }));
  next.arcade = cloneArcade(state.arcade);
  next.totalTime = state.totalTime;
  next.manualClicks = state.manualClicks;
  next.seenEnergyShortage = state.seenEnergyShortage;
  next.hasPrestiged = true;
  next.unlockedCards = state.unlockedCards.slice();
  next.unlocked = state.unlocked.slice();
  next.offlineBonusHours = state.offlineBonusHours;
  next.stats = {
    ...state.stats,
    launches: state.stats.launches + 1,
    manualActions: 0,
    automatedLaunches: state.stats.automatedLaunches + (state.stats.manualActions === 0 ? 1 : 0),
  };
  next.protocols = {
    accumulator: 0,
    slots: state.protocols.slots.map((slot) => ({
      ...slot,
      card: slot.card ? structuredClone(slot.card) : null,
    })),
  };
  return applyAchievementUnlocks(refreshUnlocks(applySeedStock(next)));
}

/** Metal from one manual collect: max(10, one second of metal output), ×10 with the curvature tech. */
export function scrapeAmount(state: GameState): number {
  return baseCollectAmount(state) * manualClickMultiplier(state);
}

/** Manual collect. Counts toward the auto-collect unlock. Auto-collect does not call this. Can exceed the cap. */
export function scrape(state: GameState): GameState {
  const gain = big(scrapeAmount(state));
  return applyAchievementUnlocks(
    refreshUnlocks({
      ...state,
      manualClicks: state.manualClicks + 1,
      resources: { ...state.resources, metal: state.resources.metal.add(gain) },
      lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(gain) },
      stats: {
        ...state.stats,
        scrapes: state.stats.scrapes + 1,
        manualActions: state.stats.manualActions + 1,
      },
    }),
  );
}
