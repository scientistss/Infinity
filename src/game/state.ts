import { emptyCurvature } from "../prestige/tree";
import { big } from "./decimal";
import { FREE_SOLAR_PLANTS } from "./content";
import {
  PRODUCER_IDS,
  PROTOCOL_SLOT_COUNT,
  RESOURCE_IDS,
  type GameState,
  type PlayerStats,
  type ProtocolLoadout,
  type ProtocolSlotState,
} from "./types";

export function emptyStats(): PlayerStats {
  return {
    scrapes: 0,
    launches: 0,
    seenEnergyShort: false,
    manualActions: 0,
    automatedLaunches: 0,
  };
}

function zeros<T extends string>(ids: readonly T[]): Record<T, ReturnType<typeof big>> {
  const out = {} as Record<T, ReturnType<typeof big>>;
  for (const id of ids) out[id] = big(0);
  return out;
}

export function emptyProtocolSlot(): ProtocolSlotState {
  return { card: null, elapsed: 0, lamp: "gray", reason: "空槽位" };
}

export function createDefaultProtocols(): ProtocolLoadout {
  return {
    accumulator: 0,
    slots: Array.from({ length: PROTOCOL_SLOT_COUNT }, () => emptyProtocolSlot()),
  };
}

export function createInitialState(): GameState {
  const producers = zeros(PRODUCER_IDS);
  producers.solar_plant = big(FREE_SOLAR_PLANTS);
  return {
    resources: zeros(RESOURCE_IDS),
    producers,
    lifetime: zeros(RESOURCE_IDS),
    warpCores: big(0),
    curvature: emptyCurvature(),
    totalTime: big(0),
    manualClicks: 0,
    seenEnergyShortage: false,
    hasPrestiged: false,
    unlockedCards: [],
    protocols: createDefaultProtocols(),
    unlocked: [],
    stats: emptyStats(),
    offlineBonusHours: 0,
  };
}
