import { big } from "./decimal";
import { PRODUCER_IDS, RESOURCE_IDS, type GameState } from "./types";

function zeros<T extends string>(ids: readonly T[]): Record<T, ReturnType<typeof big>> {
  const out = {} as Record<T, ReturnType<typeof big>>;
  for (const id of ids) out[id] = big(0);
  return out;
}

export function createInitialState(): GameState {
  const producers = zeros(PRODUCER_IDS);
  producers.solar_plant = big(1);
  return {
    resources: zeros(RESOURCE_IDS),
    producers,
    lifetime: zeros(RESOURCE_IDS),
    warpCores: big(0),
    totalTime: big(0),
  };
}
