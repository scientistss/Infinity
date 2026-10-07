import { activePlanet, withPlanet, onPlanet, selectPlanet } from "./empire";
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
  completedBuilds: Array<CompletedBuild & { planetId?: string }>;
  completedResearch: CompletedResearch[];
  completedUnits: Array<CompletedUnits & { planetId?: string }>;
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
  let current = state;
  for (const planet of state.planets) current = onPlanet(current, planet.id, startNext);
  current = applyEmpireAchievements(startNextResearch(current));
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return current;
  const period = mode === "offline" ? OFFLINE_PROTOCOL_SECONDS : PROTOCOL_LIVE_EVAL_SECONDS;
  const limit = Math.ceil(dtSeconds / period) + 8 * state.planets.length * Math.ceil(dtSeconds / MIN_BUILD_SECONDS) + 256;
  let t = 0, segments = 0;
  while (dtSeconds - t > EPS) {
    if (++segments > limit) throw new Error("模拟事件过密，已停止结算以保护存档；请缩短结算间隔");
    const selectedId = current.activePlanetId;
    // Freeze all local rates at the same time. Later completions must not boost earlier intervals.
    const snapshots = current.planets.map((p) => ({ id: p.id, eco: economy(selectPlanet(current, p.id)) }));
    let step = dtSeconds - t;
    const lab = current.research.queue[0];
    if (lab && lab.totalSeconds > 0) step = Math.min(step, Math.max(0, lab.remainingSeconds));
    step = Math.min(step, Math.max(0, period - current.protocols.accumulator), nextBoosterExpiry(current), nextBeaconIn(current));
    for (const snapshot of snapshots) {
      const local = selectPlanet(current, snapshot.id);
      const head = activePlanet(local).buildQueue[0];
      if (head && head.totalSeconds > 0) step = Math.min(step, Math.max(0, head.remainingSeconds));
      step = Math.min(step, nextBoundary(local, snapshot.eco), nextShipyardEvent(local));
    }
    let filled: StoredResId[] = [];
    for (const snapshot of snapshots) {
      current = onPlanet(current, snapshot.id, (local) => {
        const moved = integrate(local, step, snapshot.eco);
        if (snapshot.id === selectedId) filled = moved.filled;
        return moved.filled.length > 0 ? { ...moved.state, stats: { ...moved.state.stats, seenStorageFull: true } } : moved.state;
      });
    }
    current = { ...current, totalTime: current.totalTime.add(step) };
    let queueIdle = false, shipyardIdle = false;
    for (const snapshot of snapshots) {
      current = onPlanet(current, snapshot.id, (local) => {
        const wasBusy = activePlanet(local).shipyardQueue.length > 0;
        const yard = advanceShipyard(local, step);
        let result = yard.state;
        if (log) for (const done of yard.completed) addUnits(log.completedUnits, current.planets.length > 1 ? { ...done, planetId: snapshot.id } : done);
        if (snapshot.id === selectedId) shipyardIdle = wasBusy && activePlanet(result).shipyardQueue.length === 0;
        const head = activePlanet(result).buildQueue[0];
        if (head && head.totalSeconds > 0) {
          const remaining = head.remainingSeconds - step;
          if (remaining <= EPS) {
            const done = completeActive(result);
            result = done.state;
            if (done.completed) log?.completedBuilds.push(current.planets.length > 1 ? { ...done.completed, planetId: snapshot.id } : done.completed);
            if (snapshot.id === selectedId) queueIdle = activePlanet(result).buildQueue.length < queueCapacity(result);
          } else result = withHeadRemaining(result, remaining);
        }
        return result;
      });
    }
    let researchIdle = false;
    const studying = current.research.queue[0];
    if (studying && studying.totalSeconds > 0) {
      const remaining = studying.remainingSeconds - step;
      if (remaining <= EPS) {
        const done = completeActiveResearch(current);
        current = done.state;
        if (done.completed) log?.completedResearch.push(done.completed);
        researchIdle = current.research.queue.length < researchCapacity(current);
      } else current = withResearchRemaining(current, remaining);
    }
    current = pruneBoosters(current);
    const beacon = accrueBeacons(current, step);
    current = beacon.state;
    // P4 foundation: the one protocol rack follows the selected planet. It is not cloned per colony.
    const events: ProtocolEvents = { queueIdle, researchIdle, storageFull: filled, runsReady: beacon.granted > 0, shipyardIdle };
    current = evaluateEvents(refreshUnlocks(current), events);
    const accrued = current.protocols.accumulator + step;
    current = accrued >= period - EPS ? evaluateLoadout(setAccumulator(current, 0), period) : setAccumulator(current, accrued);
    current = applyEmpireAchievements(refreshUnlocks(current));
    t += step;
  }
  return applyEmpireAchievements(refreshUnlocks(markStorageSeen(current)));
}
function applyEmpireAchievements(state: GameState): GameState {
  let result = state;
  for (const planet of state.planets) result = onPlanet(result, planet.id, local => {
    const next = applyAchievementUnlocks(local);
    return state.planets.length > 1 ? refreshUnlocks(next) : next;
  });
  return result;
}

function addUnits(list: TickLog["completedUnits"], done: CompletedUnits & { planetId?: string }): void {
  const same = list.find((entry) => entry.unit === done.unit && entry.planetId === done.planetId);
  if (same) same.count += done.count;
  else list.push({ ...done });
}

/** Seconds until the first resource changes regime (reaches its cap, or deuterium runs dry). */
function nextBoundary(state: GameState, eco: EconomySnapshot): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const id of RESOURCE_IDS) {
    const stock = activePlanet(state).resources[id].toNumber();
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
  const resources = { ...activePlanet(state).resources };
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
    state: { ...withPlanet(state, { resources }), lifetime },
    filled,
  };
}

function withHeadRemaining(state: GameState, remaining: number): GameState {
  const [head, ...rest] = activePlanet(state).buildQueue;
  if (!head) return state;
  return { ...withPlanet(state, { planet: { ...activePlanet(state), buildQueue: [{ ...head, remainingSeconds: remaining }, ...rest] } }) };
}

function setAccumulator(state: GameState, accumulator: number): GameState {
  return { ...state, protocols: { ...state.protocols, accumulator } };
}

function markStorageSeen(state: GameState): GameState {
  if (state.stats.seenStorageFull) return state;
  const full = state.planets.some(p => {
    const caps = economy(selectPlanet(state, p.id)).caps;
    return RESOURCE_IDS.some(id => p.resources[id].gte(caps[id]));
  });
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
    refreshUnlocks({ ...withPlanet(state, { resources: { ...activePlanet(state).resources, metal: activePlanet(state).resources.metal.add(gain) } }), manualClicks: state.manualClicks + 1, lifetime: { ...state.lifetime, metal: state.lifetime.metal.add(gain) }, stats: {
        ...state.stats,
        scrapes: state.stats.scrapes + 1,
        manualActions: state.stats.manualActions + 1,
      } }),
  );
}
