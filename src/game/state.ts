import { emptyCurvature } from "../prestige/tree";
import { big } from "./decimal";
import { STARTING_RESOURCES } from "./content";
import { createPlanet } from "./planet";
import { createResearch } from "./research";
import { createArcade } from "./arcade";
import {
  PROTOCOL_SLOT_COUNT,
  RESOURCE_IDS,
  type GameState,
  type ResourceAmounts,
  type PlayerStats,
  type ProtocolLoadout,
  type ProtocolSlotState,
} from "./types";

export { createPlanet };

export function emptyStats(): PlayerStats {
  return {
    scrapes: 0,
    launches: 0,
    seenEnergyShort: false,
    manualActions: 0,
    automatedLaunches: 0,
    buildsCompleted: 0,
    seenStorageFull: false,
    seenQueueIdle: false,
    researchCompleted: 0,
    darkMatterEarned: 0,
    unitsBuilt: 0,
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

/** OGame new-account start: 500 metal, 500 crystal, no buildings. Base production keeps it moving. */
export function startingResources(): ResourceAmounts {
  return {
    metal: big(STARTING_RESOURCES.metal),
    crystal: big(STARTING_RESOURCES.crystal),
    deuterium: big(STARTING_RESOURCES.deuterium),
  };
}

export function createInitialState(): GameState {
  return {
    planets: [{ ...createPlanet(), resources: startingResources() }],
    activePlanetId: "home",
    universe: { seed: 0x1f17a17e },
    fleets: [],
    messages: [],
    nextFleetId: 1,
    research: createResearch(),
    darkMatter: big(0),
    items: { kraken_box: 0, newtron_box: 0, detroit_box: 0, booster_box: 0, supply_pack: 0 },
    boosters: [],
    arcade: createArcade(),
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
