import { big } from "../game/decimal";
import {
  OFFLINE_BASE_SECONDS,
  OFFLINE_MAX_SECONDS,
  PROTOCOL_OFFLINE_EVAL_SECONDS,
} from "../game/content";
import { applyAchievementUnlocks, emptyTickLog, tick } from "../game/logic";
import type { CompletedBuild } from "../game/queue";
import type { CompletedResearch } from "../game/research";
import type { ArcadeHistoryEntry } from "../game/arcade";
import type { CompletedUnits } from "../game/shipyard";
import { RESOURCE_IDS, type GameState, type ResourceId } from "../game/types";
import type { BigNumber } from "../game/decimal";

export interface OfflineCatchup {
  state: GameState;
  /** Seconds actually simulated, after the cap. */
  appliedSeconds: number;
  /** Wall-clock seconds since the last tick. */
  rawSeconds: number;
  capped: boolean;
  capSeconds: number;
  gains: Record<ResourceId, BigNumber>;
  /** Regular protocol passes in this window (event cards also run when builds finish). */
  protocolEvaluations: number;
  /** Build orders finished while away, in completion order. */
  completedBuilds: CompletedBuild[];
  /** Research levels finished while away, in completion order. */
  completedResearch: CompletedResearch[];
  /** Ships and defenses finished while away, per unit type. */
  completedUnits: CompletedUnits[];
  /** Ring machine runs revealed by the auto-runner card while away. */
  arcadeRuns: ArcadeHistoryEntry[];
  /** Ring machine runs stored now (beacons accrue offline too). */
  arcadeStored: number;
  newAchievementIds: string[];
}

/** min(8h, 2h + curvature bonus hours). */
export function offlineCapSeconds(state: GameState): number {
  const bonusHours = Number.isFinite(state.offlineBonusHours) ? Math.max(0, state.offlineBonusHours) : 0;
  const seconds = OFFLINE_BASE_SECONDS + bonusHours * 3600;
  if (!Number.isFinite(seconds)) return OFFLINE_BASE_SECONDS;
  return Math.min(OFFLINE_MAX_SECONDS, Math.max(OFFLINE_BASE_SECONDS, seconds));
}

/**
 * Count simplified offline protocol evaluations. Live play uses a 1 second cadence;
 * catch-up uses the balance interval so a long absence cannot spin once per frame.
 */
export function offlineProtocolEvaluations(appliedSeconds: number): number {
  if (!(appliedSeconds > 0) || !Number.isFinite(appliedSeconds)) return 0;
  return Math.floor(appliedSeconds / PROTOCOL_OFFLINE_EVAL_SECONDS);
}

/** One offline batch through the same event-driven tick as live play; protocol passes every 60s. */
export function catchUp(state: GameState, elapsedSeconds: number): OfflineCatchup {
  const capSeconds = offlineCapSeconds(state);
  const rawSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const appliedSeconds = Math.min(rawSeconds, capSeconds);
  const before = new Set(state.unlocked);
  const beforeResources = state.resources;
  const log = emptyTickLog();
  const next = tick(state, appliedSeconds, "offline", log);
  // Production while away. Builds spend resources, so prefer this-run lifetime output unless a launch reset it.
  const sameRun = next.stats.launches === state.stats.launches;
  const gains = emptyGains();
  for (const id of RESOURCE_IDS) {
    const delta = sameRun ? next.lifetime[id].sub(state.lifetime[id]) : next.resources[id].sub(beforeResources[id]);
    gains[id] = delta.gt(0) ? delta : big(0);
  }
  return {
    state: next,
    appliedSeconds,
    rawSeconds,
    capped: rawSeconds > capSeconds,
    capSeconds,
    gains,
    protocolEvaluations: offlineProtocolEvaluations(appliedSeconds),
    completedBuilds: log.completedBuilds,
    completedResearch: log.completedResearch,
    completedUnits: log.completedUnits,
    arcadeRuns: next.arcade.history.filter((entry) => entry.auto && entry.at > state.totalTime.toNumber()),
    arcadeStored: next.arcade.runs.length,
    newAchievementIds: next.unlocked.filter((id) => !before.has(id)),
  };
}

export function emptyCatchup(state: GameState): OfflineCatchup {
  return {
    state: applyAchievementUnlocks(state),
    appliedSeconds: 0,
    rawSeconds: 0,
    capped: false,
    capSeconds: offlineCapSeconds(state),
    gains: emptyGains(),
    protocolEvaluations: 0,
    completedBuilds: [],
    completedResearch: [],
    completedUnits: [],
    arcadeRuns: [],
    arcadeStored: state.arcade.runs.length,
    newAchievementIds: [],
  };
}

function emptyGains(): Record<ResourceId, BigNumber> {
  return { metal: big(0), crystal: big(0), deuterium: big(0) };
}
