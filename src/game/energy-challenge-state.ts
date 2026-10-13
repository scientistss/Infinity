import type { ProtocolCard } from "../data/protocol-cards";
import type { OrderMoney } from "./order-state";
import type { OrderSource } from "./planet";
import { HOMEWORLD_ID } from "./planet";
import type { GameState } from "./types";

/** The model fixes both the restriction and the conservative 10^-12 point quantum. */
export const ENERGY_CHALLENGE_MODEL = "energy-tightening-v1" as const;
export const ENERGY_CHALLENGE_BUILDINGS = ["metal_mine", "crystal_mine", "deuterium_synth", "solar_plant"] as const;
export type EnergyChallengeBuildingId = typeof ENERGY_CHALLENGE_BUILDINGS[number];
export { ENERGY_CHALLENGE_TARGET_UNITS } from "./energy-challenge-score";
export const ENERGY_CHALLENGE_AUTO_REASON = "能源紧缩挑战进行中，自动曲率保持关闭";

/** A consumed, actually completed paid job, captured before its queue entry is removed. */
export interface EnergyChallengePaidProof {
  jobId: number;
  targetLevel: number;
  source: OrderSource;
  taskId: number | null;
  paid: OrderMoney;
}
export interface EnergyChallengeAttempt {
  attemptId: number;
  universeSeed: number;
  homeworldId: typeof HOMEWORLD_ID;
  entryJobFloor: number;
  enteredAt: string;
  scoreUnits: string;
  proofs: Record<EnergyChallengeBuildingId, EnergyChallengePaidProof | null>;
}
export interface EnergyChallengeCompletion {
  attempt: EnergyChallengeAttempt;
  finish: {
    jobCeiling: number;
    finishedAt: string;
    ordinaryGain: string;
    homeLevels: Record<EnergyChallengeBuildingId, number>;
  };
}
export interface EnergyChallengeState {
  model: typeof ENERGY_CHALLENGE_MODEL;
  nextAttemptId: number;
  active: EnergyChallengeAttempt | null;
  completion: EnergyChallengeCompletion | null;
}
export function createEnergyChallengeState(): EnergyChallengeState {
  return { model: ENERGY_CHALLENGE_MODEL, nextAttemptId: 1, active: null, completion: null };
}
export function emptyEnergyChallengeProofs(): EnergyChallengeAttempt["proofs"] {
  return { metal_mine: null, crystal_mine: null, deuterium_synth: null, solar_plant: null };
}
export function isEnergyChallengeBuilding(id: string): id is EnergyChallengeBuildingId {
  return (ENERGY_CHALLENGE_BUILDINGS as readonly string[]).includes(id);
}
/** An active record is restrictive even before a caller performs its full consistency check. */
export function isEnergyChallengeActive(state: GameState): boolean {
  return state.energyChallenge?.active != null;
}
export function energyChallengeProtocolProblem(state: GameState, card: ProtocolCard): string | null {
  return isEnergyChallengeActive(state) && card.enabled && card.action.kind === "prestige" ? ENERGY_CHALLENGE_AUTO_REASON : null;
}
/** Only the action matters; template identity and slot visibility are deliberately irrelevant. */
export function disableEnergyChallengePrestigeCards(state: GameState): GameState {
  let changed = false;
  const slots = state.protocols.slots.map(slot => {
    if (!slot.card || slot.card.action.kind !== "prestige" || !slot.card.enabled) return slot;
    changed = true;
    return { ...slot, card: { ...slot.card, enabled: false } };
  });
  return changed ? { ...state, protocols: { ...state.protocols, slots } } : state;
}
