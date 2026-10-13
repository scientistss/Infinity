import { isCanonicalScoreUnits } from "./energy-challenge-score";
import { evaluatePrestige, warpGain, type PrestigeEvaluation } from "./logic";
import { HOMEWORLD_ID } from "./planet";
import { paidJobIdentityProblem } from "./paid-job-identity";
import type { GameState } from "./types";
import { validateEnergyChallengeReferences } from "./energy-challenge-save";
import {
  ENERGY_CHALLENGE_BUILDINGS, ENERGY_CHALLENGE_TARGET_UNITS,
  disableEnergyChallengePrestigeCards, emptyEnergyChallengeProofs,
  type EnergyChallengeAttempt, type EnergyChallengeCompletion,
} from "./energy-challenge-state";

export type EnergyChallengeAction = "enter" | "abandon" | "finish";
export interface EnergyChallengeResult { state: GameState; ok: boolean; reason: string }
export interface EnergyChallengeStatus {
  phase: "inactive" | "active" | "completed";
  scoreUnits: string;
  proofCount: number;
  homeReady: boolean;
  canEnter: boolean;
  canFinish: boolean;
  reason: string;
}
export interface EnergyChallengeQuote {
  readonly action: EnergyChallengeAction;
  readonly expected: Readonly<{
    nextAttemptId: number;
    attemptId: number | null;
    universeSeed: number;
    entryJobFloor: number;
  }>;
  readonly ok: boolean;
  readonly reason: string;
  readonly gain: string;
  readonly disabledPrestigeSlots: readonly number[];
}

/** Quotes are ephemeral, source-bound intents. They never hold an adoptable reset candidate. */
const issuedQuotes = new WeakMap<EnergyChallengeQuote, GameState>();
const STALE_REASON = "挑战预览已过期，请重新检查后确认";

function consistencyProblem(state: GameState): string | null {
  try { validateEnergyChallengeReferences(state); }
  catch { return "挑战记录与当前世界不一致，未改变游戏状态"; }
  return paidJobIdentityProblem(state);
}
function homeIsReady(state: GameState): boolean {
  const attempt = state.energyChallenge.active;
  const home = attempt && state.planets.find(planet => planet.id === attempt.homeworldId);
  return !!home && ENERGY_CHALLENGE_BUILDINGS.every(id => home.buildings[id] >= 1);
}
function actionProblem(state: GameState, action: EnergyChallengeAction, validate = true): string | null {
  if (validate) {
    const consistency = consistencyProblem(state);
    if (consistency) return consistency;
  }
  const challenge = state.energyChallenge;
  if (action === "enter") {
    if (challenge.completion) return "能源紧缩挑战已完成，普通建筑和研究队列已各增至 3 格";
    if (challenge.active) return "能源紧缩挑战正在进行";
    if (challenge.nextAttemptId >= Number.MAX_SAFE_INTEGER) return "挑战编号已到安全上限";
    if (Number.MAX_SAFE_INTEGER - state.orders.nextJobId < ENERGY_CHALLENGE_BUILDINGS.length) return "剩余付费任务编号不足以完成母星四项建设，不能进入挑战";
    if (warpGain(state).lt(1)) return "须达到普通曲率门槛后，手动曲率并进入挑战";
    return null;
  }
  if (!challenge.active) return "当前没有进行中的能源紧缩挑战";
  if (action === "abandon") return null;
  if (challenge.active.scoreUnits !== ENERGY_CHALLENGE_TARGET_UNITS) return "本次纯生产积分尚未达到 100 万";
  if (ENERGY_CHALLENGE_BUILDINGS.some(id => challenge.active!.proofs[id] === null)) return "母星三矿和太阳能均须在本次进入后真实付款并完成";
  if (!homeIsReady(state)) return "领取时母星三矿和太阳能等级均须至少为 1";
  if (warpGain(state).lt(1)) return "本次普通曲率收益尚不足 1，暂不能曲率并完成";
  return null;
}

/** Pure read model: no ticking, candidate construction, entitlement creation, or quote allocation. */
export function energyChallengeStatus(state: GameState): EnergyChallengeStatus {
  const active = state.energyChallenge.active;
  const completed = state.energyChallenge.completion;
  const phase = active ? "active" : completed ? "completed" : "inactive";
  const reason = actionProblem(state, active ? "finish" : "enter", false);
  return {
    phase, scoreUnits: active?.scoreUnits ?? completed?.attempt.scoreUnits ?? "0",
    proofCount: active ? ENERGY_CHALLENGE_BUILDINGS.filter(id => active.proofs[id] !== null).length : completed ? 4 : 0,
    homeReady: active ? homeIsReady(state) : false,
    canEnter: phase === "inactive" && reason === null,
    canFinish: phase === "active" && reason === null,
    reason: reason ?? (active ? "已满足条件，可手动曲率并完成" : "可手动曲率并进入挑战"),
  };
}

/** Inspection-only ordinary consequences for the synchronous final confirmation. */
export function energyChallengePrestigeEvaluation(state: GameState, action: "enter" | "finish"): PrestigeEvaluation {
  if (actionProblem(state, action)) return { gain: warpGain(state), next: state };
  if (action === "enter") return evaluatePrestige(state);
  return evaluatePrestige({ ...state, energyChallenge: { ...state.energyChallenge, active: null } });
}

export function quoteEnergyChallenge(state: GameState, action: EnergyChallengeAction): EnergyChallengeQuote {
  const problem = actionProblem(state, action);
  const quote: EnergyChallengeQuote = Object.freeze({
    action,
    expected: Object.freeze({
      nextAttemptId: state.energyChallenge.nextAttemptId,
      attemptId: state.energyChallenge.active?.attemptId ?? null,
      universeSeed: state.universe.seed,
      entryJobFloor: state.energyChallenge.active?.entryJobFloor ?? state.orders.nextJobId,
    }),
    ok: problem === null, reason: problem ?? "", gain: action === "abandon" ? "0" : warpGain(state).toString(),
    disabledPrestigeSlots: Object.freeze(state.protocols.slots.flatMap((slot, index) =>
      slot.card?.enabled && slot.card.action.kind === "prestige" ? [index] : [])),
  });
  issuedQuotes.set(quote, state);
  return quote;
}

function validateQuote(state: GameState, quote: EnergyChallengeQuote, action: EnergyChallengeAction): string | null {
  if (issuedQuotes.get(quote) !== state || quote.action !== action || !quote.ok
    || quote.expected.nextAttemptId !== state.energyChallenge.nextAttemptId
    || quote.expected.attemptId !== (state.energyChallenge.active?.attemptId ?? null)
    || quote.expected.universeSeed !== state.universe.seed
    || quote.expected.entryJobFloor !== (state.energyChallenge.active?.entryJobFloor ?? state.orders.nextJobId)) return STALE_REASON;
  return actionProblem(state, action);
}
function refuse(state: GameState, reason: string): EnergyChallengeResult { return { state, ok: false, reason }; }
function finishCandidate(state: GameState, quote: EnergyChallengeQuote, candidate: GameState, reason: string): EnergyChallengeResult {
  const invalid = consistencyProblem(candidate);
  if (invalid) return refuse(state, invalid);
  issuedQuotes.delete(quote);
  return { state: candidate, ok: true, reason };
}

/** The caller must persist/read back this pure candidate before adopting it. */
export function enterEnergyChallenge(state: GameState, quote: EnergyChallengeQuote): EnergyChallengeResult {
  const invalid = validateQuote(state, quote, "enter");
  if (invalid) return refuse(state, invalid);
  const ordinary = evaluatePrestige(state);
  if (ordinary.next === state || ordinary.gain.lt(1)) return refuse(state, "普通曲率条件已变化，请重新预览");
  const attempt: EnergyChallengeAttempt = {
    attemptId: state.energyChallenge.nextAttemptId,
    universeSeed: state.universe.seed,
    homeworldId: HOMEWORLD_ID,
    entryJobFloor: ordinary.next.orders.nextJobId,
    enteredAt: ordinary.next.totalTime.toString(),
    scoreUnits: "0", proofs: emptyEnergyChallengeProofs(),
  };
  const candidate = disableEnergyChallengePrestigeCards({ ...ordinary.next, energyChallenge: {
    ...state.energyChallenge, nextAttemptId: attempt.attemptId + 1, active: attempt, completion: null,
  } });
  return finishCandidate(state, quote, candidate, "已执行普通曲率并进入能源紧缩挑战");
}

/** Abandonment deliberately keeps every economic object and paid queue from this run. */
export function abandonEnergyChallenge(state: GameState, quote: EnergyChallengeQuote): EnergyChallengeResult {
  const invalid = validateQuote(state, quote, "abandon");
  if (invalid) return refuse(state, invalid);
  const candidate = { ...state, energyChallenge: { ...state.energyChallenge, active: null } };
  return finishCandidate(state, quote, candidate, "已放弃本次挑战；下次合法手动曲率时可重新进入");
}

/** One ordinary curve and one coherent completion receipt form a single adoptable candidate. */
export function finishEnergyChallenge(state: GameState, quote: EnergyChallengeQuote): EnergyChallengeResult {
  const invalid = validateQuote(state, quote, "finish");
  if (invalid) return refuse(state, invalid);
  const attempt = state.energyChallenge.active!;
  const home = state.planets.find(planet => planet.id === attempt.homeworldId)!;
  // Only this checked manual transition removes the ordinary-prestige active guard.
  const ordinarySource = { ...state, energyChallenge: { ...state.energyChallenge, active: null } };
  const ordinary = evaluatePrestige(ordinarySource);
  if (ordinary.next === ordinarySource || ordinary.gain.lt(1)) return refuse(state, "普通曲率条件已变化，请重新预览");
  const receipt: EnergyChallengeCompletion = {
    attempt: structuredClone(attempt),
    finish: {
      jobCeiling: state.orders.nextJobId,
      finishedAt: state.totalTime.toString(),
      ordinaryGain: ordinary.gain.toString(),
      homeLevels: {
        metal_mine: home.buildings.metal_mine, crystal_mine: home.buildings.crystal_mine,
        deuterium_synth: home.buildings.deuterium_synth, solar_plant: home.buildings.solar_plant,
      },
    },
  };
  const candidate = { ...ordinary.next, energyChallenge: { ...state.energyChallenge, active: null, completion: receipt } };
  return finishCandidate(state, quote, candidate, "已曲率并完成挑战；普通建筑和研究队列各增至 3 格");
}

/** Exact user-facing decimal points, without a floating conversion of the integer unit balance. */
export function energyChallengeScoreText(units: string): string {
  if (!isCanonicalScoreUnits(units)) return "0";
  const padded = units.padStart(13, "0");
  const whole = padded.slice(0, -12), fraction = padded.slice(-12).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
