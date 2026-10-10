import { activePlanet } from "../game/empire";
import type { SpeedupTarget } from "../game/dark-matter";
import type { GameState } from "../game/types";

export type QueueHeads = Record<SpeedupTarget, string | null>;

/** Stable paid identities, never queue indices or retained world objects. */
export function queueHeads(state: GameState): QueueHeads {
  const planet = activePlanet(state);
  const build = planet.buildQueue[0];
  const research = state.research.queue[0];
  const shipyard = planet.shipyardQueue[0];
  return {
    build: build ? `${planet.id}:${build.jobId}` : null,
    research: research ? `${research.planetId}:${research.jobId}` : null,
    shipyard: shipyard ? `${planet.id}:${shipyard.jobId}` : null,
  };
}

export function sameQueueHeads(left: QueueHeads | null, right: QueueHeads): boolean {
  return left !== null && left.build === right.build && left.research === right.research && left.shipyard === right.shipyard;
}

export function maySpeedUp(painted: QueueHeads | null, current: QueueHeads, target: SpeedupTarget): boolean {
  return painted !== null && painted[target] !== null && painted[target] === current[target];
}
