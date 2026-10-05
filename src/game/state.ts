import { big } from "./decimal";
import { PRODUCER_IDS, RESOURCE_IDS, type GameState } from "./types";

function zeros<T extends string>(ids: readonly T[]): Record<T, ReturnType<typeof big>> {
  const out = {} as Record<T, ReturnType<typeof big>>;
  for (const id of ids) out[id] = big(0);
  return out;
}

export function createInitialState(): GameState {
  return {
    resources: zeros(RESOURCE_IDS),
    producers: zeros(PRODUCER_IDS),
    lifetime: zeros(RESOURCE_IDS),
    telemetry: big(0),
    totalTime: big(0),
  };
}
