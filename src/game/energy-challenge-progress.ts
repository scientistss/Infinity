import { activePlanet } from "./empire";
import { isValidAmount } from "./decimal";
import { validOwnedPaidJob } from "./order-ledger";
import { actualPaidJobs, paidJobIdentityProblem } from "./paid-job-identity";
import type { BuildOrder } from "./planet";
import { RESOURCE_IDS, type GameState } from "./types";
import { accumulateScoreUnits, computeProductionContributionUnits } from "./energy-challenge-score";
import { ENERGY_CHALLENGE_TARGET_UNITS, isEnergyChallengeBuilding, type EnergyChallengePaidProof } from "./energy-challenge-state";

const WEIGHTS = { metal: 1, crystal: 3, deuterium: 10 } as const;

/** Called only around one pure integration segment on one planet, after the wallet's own clamps. */
export function recordEnergyChallengeProduction(before: GameState, after: GameState): GameState {
  const attempt = before.energyChallenge?.active;
  if (!attempt || after.energyChallenge.active !== attempt || attempt.scoreUnits === ENERGY_CHALLENGE_TARGET_UNITS) return after;
  let scoreUnits = attempt.scoreUnits;
  const oldStock = activePlanet(before).resources;
  const newStock = activePlanet(after).resources;
  for (const id of RESOURCE_IDS) {
    const contribution = computeProductionContributionUnits(oldStock[id].toString(), newStock[id].toString(), WEIGHTS[id]);
    scoreUnits = accumulateScoreUnits(scoreUnits, contribution);
  }
  return scoreUnits === attempt.scoreUnits ? after : {
    ...after, energyChallenge: { ...after.energyChallenge, active: { ...attempt, scoreUnits } },
  };
}

/** Queue completion and paid acceleration both enter here with the actually consumed zero timer. */
export function recordEnergyChallengeBuildCompletion(before: GameState, after: GameState, head: BuildOrder): GameState {
  const attempt = before.energyChallenge?.active;
  if (!attempt || after.energyChallenge.active !== attempt || !isEnergyChallengeBuilding(head.building)
    || attempt.proofs[head.building] !== null || activePlanet(before).id !== attempt.homeworldId
    || activePlanet(before).buildQueue[0] !== head || !Number.isFinite(head.totalSeconds) || head.totalSeconds <= 0
    || head.remainingSeconds !== 0 || paidJobIdentityProblem(before)
    || head.jobId < attempt.entryJobFloor || head.jobId >= before.orders.nextJobId
    || !Number.isSafeInteger(head.targetLevel) || head.targetLevel < 1 || head.targetLevel > 1000
    || activePlanet(after).id !== attempt.homeworldId || activePlanet(after).buildings[head.building] < 1
    || actualPaidJobs(after).some(entry => entry.job.jobId === head.jobId)) return after;
  if (!RESOURCE_IDS.every(id => isValidAmount(head.paid[id])) || !RESOURCE_IDS.some(id => head.paid[id].gt(0))) return after;
  if (head.source === "plan") {
    const task = before.orders.tasks.find(value => value.id === head.taskId);
    const credited = after.orders.tasks.find(value => value.id === head.taskId);
    if (!task || !validOwnedPaidJob(before, task) || !credited || credited.activeJob !== null || credited.currentWork !== null) return after;
  } else if ((head.source !== "manual" && head.source !== "protocol") || head.taskId !== null) return after;
  const proof: EnergyChallengePaidProof = {
    jobId: head.jobId, targetLevel: head.targetLevel, source: head.source, taskId: head.taskId,
    paid: { metal: head.paid.metal.toString(), crystal: head.paid.crystal.toString(), deuterium: head.paid.deuterium.toString() },
  };
  return { ...after, energyChallenge: { ...after.energyChallenge, active: {
    ...attempt, proofs: { ...attempt.proofs, [head.building]: proof },
  } } };
}
