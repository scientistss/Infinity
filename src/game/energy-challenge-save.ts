import { big, bigFloor, isValidAmount } from "./decimal";
import {
  ENERGY_CHALLENGE_BUILDINGS, ENERGY_CHALLENGE_MODEL, ENERGY_CHALLENGE_TARGET_UNITS,
  type EnergyChallengeAttempt, type EnergyChallengeBuildingId, type EnergyChallengeCompletion,
  type EnergyChallengePaidProof, type EnergyChallengeState,
} from "./energy-challenge-state";
import { coordinateKey, homeCoordinates } from "./galaxy";
import { isCanonicalScoreUnits } from "./energy-challenge-score";
import { HOMEWORLD_ID } from "./planet";
import type { GameState } from "./types";

const fail = (): never => { throw new TypeError("能源紧缩挑战状态或完成凭证无效"); };
const RESOURCES = ["metal", "crystal", "deuterium"] as const;
function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === names.length && names.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor && "value" in descriptor && descriptor.enumerable;
    });
}
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function amount(value: unknown, integral = false): value is string {
  if (typeof value !== "string" || value.length > 80 || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/.test(value)) return false;
  const parsed = big(value);
  return isValidAmount(parsed) && parsed.toString() === value && (!integral || bigFloor(parsed).eq(parsed));
}
function readProof(value: unknown): EnergyChallengePaidProof | null {
  if (value === null) return null;
  if (!fields(value, ["jobId", "targetLevel", "source", "taskId", "paid"])
    || !integer(value.jobId, 1, Number.MAX_SAFE_INTEGER - 1) || !integer(value.targetLevel, 1, 1000)
    || !["manual", "protocol", "plan"].includes(value.source as string)
    || (value.source === "plan" ? !integer(value.taskId, 1, Number.MAX_SAFE_INTEGER - 1) : value.taskId !== null)
    || !fields(value.paid, RESOURCES)) return fail();
  const paid = {} as EnergyChallengePaidProof["paid"];
  for (const resource of RESOURCES) {
    const valueAtResource = value.paid[resource];
    if (!amount(valueAtResource)) return fail();
    paid[resource] = valueAtResource;
  }
  if (!RESOURCES.some(resource => big(paid[resource]).gt(0))) return fail();
  return { jobId: value.jobId, targetLevel: value.targetLevel, source: value.source as EnergyChallengePaidProof["source"],
    taskId: value.taskId as number | null, paid };
}
function readAttempt(value: unknown): EnergyChallengeAttempt {
  if (!fields(value, ["attemptId", "universeSeed", "homeworldId", "entryJobFloor", "enteredAt", "scoreUnits", "proofs"])
    || !integer(value.attemptId, 1, Number.MAX_SAFE_INTEGER - 1) || !integer(value.universeSeed, 0, 0xffffffff)
    || value.homeworldId !== HOMEWORLD_ID || !integer(value.entryJobFloor)
    || !amount(value.enteredAt) || !isCanonicalScoreUnits(value.scoreUnits) || !fields(value.proofs, ENERGY_CHALLENGE_BUILDINGS)) return fail();
  const proofs = {} as EnergyChallengeAttempt["proofs"];
  const ids = new Set<number>();
  for (const building of ENERGY_CHALLENGE_BUILDINGS) {
    const proof = readProof(value.proofs[building]);
    if (proof && (proof.jobId < value.entryJobFloor || ids.has(proof.jobId))) return fail();
    if (proof) ids.add(proof.jobId);
    proofs[building] = proof;
  }
  return { attemptId: value.attemptId, universeSeed: value.universeSeed, homeworldId: HOMEWORLD_ID,
    entryJobFloor: value.entryJobFloor, enteredAt: value.enteredAt, scoreUnits: value.scoreUnits, proofs };
}
function readCompletion(value: unknown): EnergyChallengeCompletion {
  if (!fields(value, ["attempt", "finish"]) || !fields(value.finish, ["jobCeiling", "finishedAt", "ordinaryGain", "homeLevels"])) return fail();
  const attempt = readAttempt(value.attempt), finish = value.finish;
  if (attempt.scoreUnits !== ENERGY_CHALLENGE_TARGET_UNITS || !integer(finish.jobCeiling)
    || finish.jobCeiling < attempt.entryJobFloor || !amount(finish.finishedAt)
    || big(finish.finishedAt).lt(attempt.enteredAt) || !amount(finish.ordinaryGain, true) || big(finish.ordinaryGain).lt(1)
    || !fields(finish.homeLevels, ENERGY_CHALLENGE_BUILDINGS)) return fail();
  const homeLevels = {} as Record<EnergyChallengeBuildingId, number>;
  for (const building of ENERGY_CHALLENGE_BUILDINGS) {
    const proof = attempt.proofs[building], level = finish.homeLevels[building];
    if (!proof || proof.jobId >= finish.jobCeiling || !integer(level, 1, 1000)) return fail();
    homeLevels[building] = level;
  }
  return { attempt, finish: { jobCeiling: finish.jobCeiling, finishedAt: finish.finishedAt,
    ordinaryGain: finish.ordinaryGain, homeLevels } };
}

/** Exact fields only; neither missing data nor a bare completion flag grants a reward. */
export function readEnergyChallengeState(value: unknown): EnergyChallengeState {
  if (!fields(value, ["model", "nextAttemptId", "active", "completion"]) || value.model !== ENERGY_CHALLENGE_MODEL
    || !integer(value.nextAttemptId) || value.active !== null && value.completion !== null) return fail();
  const active = value.active === null ? null : readAttempt(value.active);
  const completion = value.completion === null ? null : readCompletion(value.completion);
  const attempt = active ?? completion?.attempt;
  if (attempt && attempt.attemptId !== value.nextAttemptId - 1) return fail();
  return { model: ENERGY_CHALLENGE_MODEL, nextAttemptId: value.nextAttemptId, active, completion };
}

/** Receipt consistency, not a cryptographic defense against rewriting the entire save. */
export function validateEnergyChallengeReferences(state: GameState, challenge = readEnergyChallengeState(state.energyChallenge)): void {
  const attempt = challenge.active ?? challenge.completion?.attempt;
  if (!attempt) return;
  if (state.hasPrestiged !== true || !integer(state.stats.launches, challenge.completion ? 2 : 1)
    || !integer(state.orders.nextJobId) || !integer(state.orders.nextTaskId) || attempt.entryJobFloor > state.orders.nextJobId
    || attempt.universeSeed !== state.universe.seed || big(attempt.enteredAt).gt(state.totalTime)) return fail();
  const home = state.planets.find(planet => planet.id === HOMEWORLD_ID);
  if (!home || coordinateKey(home.coordinates) !== coordinateKey(homeCoordinates(attempt.universeSeed))) return fail();
  if (challenge.active && (attempt.entryJobFloor !== state.terraformerGrantJobFloor
    || state.protocols.slots.some(slot => slot.card?.enabled && slot.card.action.kind === "prestige"))) return fail();
  const queued = new Set<number>(state.research.queue.map(job => job.jobId));
  for (const planet of state.planets) {
    for (const job of [...planet.buildQueue, ...planet.shipyardQueue]) queued.add(job.jobId);
    if (planet.demolition) queued.add(planet.demolition.jobId);
  }
  for (const building of ENERGY_CHALLENGE_BUILDINGS) {
    const proof = attempt.proofs[building];
    if (proof && (proof.jobId >= state.orders.nextJobId || queued.has(proof.jobId)
      || proof.taskId !== null && proof.taskId >= state.orders.nextTaskId)) return fail();
  }
  if (challenge.completion && (challenge.completion.finish.jobCeiling > state.orders.nextJobId
    || challenge.completion.finish.jobCeiling > state.terraformerGrantJobFloor
    || big(challenge.completion.finish.finishedAt).gt(state.totalTime))) return fail();
}

/**
 * Preserve historical acceptance: only typed field/model markers identify challenge
 * data. A normal message containing the model string is always ordinary text.
 * Inspect descriptors before projection or JSON can hide misplaced authority.
 */
export function rejectEnergyChallengeFields(raw: unknown, legacy: boolean, envelope = false): void {
  const seen = new WeakMap<object, { active: boolean; protected: boolean; authority: boolean }>();
  const decimalPrototype: object = Object.getPrototypeOf(big(0));
  const builtins = new Set<object>([Object.prototype, Array.prototype, Function.prototype, decimalPrototype]);
  let work = 0;
  const visit = (value: unknown, location: "envelope" | "state" | "challenge" | "child" | "other", depth: number): boolean => {
    if (!value || typeof value !== "object" && typeof value !== "function") return false;
    if (depth > 256 || ++work > 1_000_000) return fail();
    const protectedNode = location === "challenge" || location === "child", previous = seen.get(value);
    if (previous) {
      if (previous.active || previous.protected || previous.authority || protectedNode) return fail();
      return false;
    }
    const node = { active: true, protected: protectedNode, authority: protectedNode };
    seen.set(value, node);
    const prototype = Object.getPrototypeOf(value);
    if (prototype && !builtins.has(prototype)) node.authority = visit(prototype, "other", depth + 1) || node.authority;
    const keys = Reflect.ownKeys(value);
    if (keys.length + work > 1_000_000) return fail();
    for (const key of keys) {
      if (++work > 1_000_000) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) return fail();
      const child: unknown = descriptor.value;
      if (key === "energyChallenge" && (legacy || location !== "state" || !descriptor.enumerable)) return fail();
      if (key === "model" && child === ENERGY_CHALLENGE_MODEL
        && (legacy || location !== "challenge" || !descriptor.enumerable)) return fail();
      let next: typeof location = "other";
      if (location === "envelope" && key === "state" && descriptor.enumerable) next = "state";
      if (location === "state" && key === "energyChallenge" && descriptor.enumerable) next = "challenge";
      if (protectedNode) next = "child";
      node.authority = visit(child, next, depth + 1) || node.authority;
    }
    node.active = false;
    return node.authority;
  };
  visit(raw, envelope ? "envelope" : "state", 0);
  if (!legacy) {
    const source = envelope && raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "state")?.value : raw;
    if (!source || typeof source !== "object") return fail();
    const descriptor = Object.getOwnPropertyDescriptor(source, "energyChallenge");
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return fail();
    const challenge = readEnergyChallengeState(descriptor.value);
    if (challenge.active || challenge.completion) {
      // Read these prerequisites before the historical core reader can infer a
      // prestige flag from core holdings or fill absent historical counters.
      const prestige = Object.getOwnPropertyDescriptor(source, "hasPrestiged"), stats = Object.getOwnPropertyDescriptor(source, "stats");
      const launches = stats && "value" in stats && stats.value && typeof stats.value === "object"
        ? Object.getOwnPropertyDescriptor(stats.value, "launches") : undefined;
      if (!prestige || !("value" in prestige) || !prestige.enumerable || prestige.value !== true
        || !stats?.enumerable || !launches || !("value" in launches) || !launches.enumerable
        || !integer(launches.value, challenge.completion ? 2 : 1)) return fail();
    }
  }
}
