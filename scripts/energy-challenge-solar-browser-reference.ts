/** Test-only same-browser domain reference. Never imported by the application.
 * The sole input is the frozen action tape, not states, quotes, payments or saves.
 * Every value in the result is freshly earned with the unmodified domain engine.
 */
import { createInitialState } from '../src/game/state';
import { activePlanet } from '../src/game/empire';
import { economy, energyDemand } from '../src/game/economy';
import { canEnqueue, enqueue, queueCapacity } from '../src/game/queue';
import { canEnqueueResearch, enqueueResearch, researchCapacity } from '../src/game/research';
import { tick, emptyTickLog, expansionScore, warpGain } from '../src/game/logic';
import { quoteEnergyChallenge, enterEnergyChallenge, finishEnergyChallenge } from '../src/game/energy-challenge';
import { serializeState, exportSave } from '../src/game/save';
import { SaveSession } from '../src/game/save-session';
import { STORAGE_KEY, SAVE_VERSION, SAVE_REVISION } from '../src/game/content';
import type { BuildingId, GameState } from '../src/game/types';
import type { ResearchId } from '../src/data/research';

export const SEED = 20261013, EPOCH = Date.UTC(2026, 9, 13), ROW_COUNT = 4383;
export const FIXED = Object.freeze({ createInitialState: 1, tick: 4201, enqueue: 149, enqueueResearch: 4, challengeCandidate: 2, checkpoint: 22, reject: 4 });
// Canonical projection of the original fixed natural journey. No outcomes encoded.
export const ACTION_TAPE_SHA256 = '8aa4f1042249670115af3c9de4436e147a32c94e2670bcd80ba68a2aec6a9f2f';
const RES = ['metal', 'crystal', 'deuterium'] as const;
const STAGES = ['first-curvature', 'challenge-proof', 'challenge-growth', 'reward-building', 'reward-research'];
const BUILDINGS = ['metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant', 'robotics_factory', 'research_lab', 'metal_storage', 'crystal_storage'];
const TECHS = ['energy_tech', 'computer_tech', 'combustion_drive'];
const CHECKPOINTS = ['initial', 'entry-ready', 'entered', 'proof-metal_mine-paid', 'proof-solar_plant-paid', 'proof-metal_mine-completed', 'proof-solar_plant-completed', 'proof-crystal_mine-paid', 'proof-deuterium_synth-paid', 'proof-crystal_mine-completed', 'proof-deuterium_synth-completed', 'active-progress', 'finish-ready', 'completed', 'before-third-build-paid', 'third-build-paid', 'third-build-paid-reloaded', 'third-build-completed', 'before-third-research-paid', 'third-research-paid', 'third-research-paid-reloaded', 'third-research-completed'];
type Action = { index: number; stage: string; api: keyof typeof FIXED; request: Record<string, unknown> };
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }
function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  const result = JSON.stringify(value); check(result !== undefined, 'JSON value required'); return result;
}
async function sha(value: string): Promise<string> {
  check(globalThis.crypto?.subtle, 'Reference requires genuine browser WebCrypto in a secure context');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
function equal(a: unknown, b: unknown, reason: string): void { check(canonical(a) === canonical(b), reason); }
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Plain object required');
  check(Object.getPrototypeOf(value) === Object.prototype, 'Plain JSON object required');
  equal(Reflect.ownKeys(value).sort(), [...keys].sort(), 'Exact action field whitelist required');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    check('value' in descriptor && descriptor.enumerable, 'Only own enumerable data fields allowed');
  }
}
/** Reject even a same-census alternate route, before constructing any state. */
export async function validateActionTape(value: unknown): Promise<Action[]> {
  check(Array.isArray(value) && value.length === ROW_COUNT, 'Exactly 4383 actions required');
  check(Reflect.ownKeys(value).length === ROW_COUNT + 1, 'No additional array payload allowed');
  for (let i = 0; i < ROW_COUNT; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); check(d && d.enumerable && 'value' in d, 'Dense own action data required'); }
  const counts: Record<string, number> = {}, checkpoints: unknown[] = [], challenges: unknown[] = [], rejections: unknown[] = [];
  for (const [index, event] of value.entries()) {
    object(event, ['index', 'stage', 'api', 'request']);
    check(event.index === index + 1 && typeof event.stage === 'string' && STAGES.includes(event.stage), 'Ordered action with fixed stage required');
    check(typeof event.api === 'string' && Object.hasOwn(FIXED, event.api), 'Unsupported action');
    counts[event.api] = (counts[event.api] ?? 0) + 1;
    const r = event.request;
    if (event.api === 'createInitialState') { object(r, ['worldSeed', 'arcadeSeed']); check(index === 0 && r.worldSeed === SEED && r.arcadeSeed === SEED, 'Fixed fresh constructor required'); }
    else if (event.api === 'tick') { object(r, ['dt', 'mode', 'reason']); check(r.dt === 1 && r.mode === 'live' && typeof r.reason === 'string', 'Only original one-second live ticks'); }
    else if (event.api === 'enqueue' || event.api === 'enqueueResearch') {
      object(r, ['target', 'source', 'count', 'label']); check(r.source === 'manual' && r.count === null, 'Only single manual payment');
      check(typeof r.target === 'string' && (event.api === 'enqueue' ? BUILDINGS : TECHS).includes(r.target), 'Fixed ordinary target required');
      check(r.label === null || r.label === (event.api === 'enqueue' ? 'third-building-proof' : 'third-research-proof'), 'Fixed payment label required');
    } else if (event.api === 'challengeCandidate') { object(r, ['action']); challenges.push(r.action); }
    else if (event.api === 'checkpoint') {
      object(r, ['name', 'file', 'appliedSeconds', 'adoptsReader']);
      check(typeof r.name === 'string' && r.file === `solar/${r.name}.json` && r.appliedSeconds === 0 && r.adoptsReader === true, 'Own zero-offline SaveSession checkpoint required'); checkpoints.push(r.name);
    } else {
      check(r !== null && typeof r === 'object' && !Array.isArray(r), 'Rejection request required');
      const apiField = Object.getOwnPropertyDescriptor(r, 'api'); check(apiField && apiField.enumerable && 'value' in apiField, 'Own rejection API data required');
      const api = apiField.value;
      if (api === 'enterEnergyChallenge' || api === 'finishEnergyChallenge') { object(r, ['api', 'freshQuote']); check(r.freshQuote === true, 'Fresh rejection quote required'); }
      else if (api === 'enqueue') { object(r, ['api', 'building', 'fourth']); check(r.building === 'deuterium_synth' && r.fourth === true, 'Fourth building rejection required'); }
      else { object(r, ['api', 'tech', 'fourth']); check(api === 'enqueueResearch' && r.tech === 'computer_tech' && r.fourth === true, 'Fourth research rejection required'); }
      rejections.push(api);
    }
  }
  equal(counts, FIXED, 'Fixed action census required'); equal(checkpoints, CHECKPOINTS, 'All 22 original checkpoints required');
  equal(challenges, ['enter', 'finish'], 'Exactly two ordinary curve confirmations required');
  equal(rejections, ['enterEnergyChallenge', 'finishEnergyChallenge', 'enqueue', 'enqueueResearch'], 'All four rejections required');
  const snapshot = plain(value) as Action[];
  check(await sha(canonical(snapshot)) === ACTION_TAPE_SHA256, 'Frozen original action chronology required');
  return snapshot;
}
const money = (value: { metal: { toString(): string }; crystal: { toString(): string }; deuterium: { toString(): string } }) => Object.fromEntries(RES.map(key => [key, value[key].toString()]));
function summary(state: GameState, seconds: number) {
  const p = activePlanet(state), e = economy(state);
  return { logicalSeconds: seconds, totalTime: state.totalTime.toString(), wallets: { [p.id]: money(p.resources) },
    lifetime: money(state.lifetime), launches: state.stats.launches, warpCores: state.warpCores.toString(), expansionScore: expansionScore(state).toString(), warpGain: warpGain(state).toString(),
    nextJobId: state.orders.nextJobId, buildingCapacity: queueCapacity(state), researchCapacity: researchCapacity(state),
    challenge: plain(state.energyChallenge), buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, satellites: p.units.solar_satellite,
    researchLevels: { ...state.research.levels }, buildingQueue: plain(p.buildQueue), researchQueue: plain(state.research.queue), shipyardQueue: plain(p.shipyardQueue),
    energy: { supply: e.supply, demand: e.demand, ordinaryDemand: energyDemand(p), efficiency: e.efficiency } };
}
function jobsAt(state: GameState) {
  const p = activePlanet(state);
  return [...p.buildQueue.map(job => ({ kind: 'building' as const, planetId: p.id, ...plain(job) })),
    ...p.shipyardQueue.map(job => ({ kind: 'shipyard' as const, planetId: p.id, ...plain(job) })),
    ...state.research.queue.map(job => ({ kind: 'research' as const, ...plain(job) }))];
}
/** Nothing accepts an input state. The context must be sealed/closed before native UI. */
export async function replay(value: unknown) {
  const actions = await validateActionTape(value);
  let state = createInitialState(SEED, SEED), seconds = 0, candidate: GameState | null = null;
  const initial = exportSave(state, EPOCH, EPOCH), map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, raw: string) => { map.set(key, raw); }, removeItem: (key: string) => { map.delete(key); } };
  let session = new SaveSession(store, EPOCH);
  const receipts: Record<string, unknown>[] = [], expectedStates: Record<string, unknown>[] = [], checkpoints: Record<string, unknown> = {};
  const paidJobs = new Map<number, { target: string; targetLevel: number }>();
  for (const action of actions) {
    const { api, request: r, index, stage } = action, before = api === 'createInitialState' ? null : summary(state, seconds);
    const extra: Record<string, unknown> = {}, row: Record<string, unknown> = { index };
    check(!candidate || api === 'checkpoint', 'Candidate may only be adopted by its immediately following SaveSession checkpoint');
    if (api === 'tick') {
      const oldJobs = jobsAt(state), log = emptyTickLog(); state = tick(state, 1, 'live', log); seconds++;
      const remaining = new Set(jobsAt(state).map(job => job.jobId));
      extra.completed = oldJobs.filter(job => !remaining.has(job.jobId)).map(job => {
        const paid = paidJobs.get(job.jobId); check(paid, 'Completion must have an observed paid identity');
        const logged = job.kind === 'building' ? log.completedBuilds.some(item => item.building === job.building && item.level === job.targetLevel)
          : job.kind === 'research' ? log.completedResearch.some(item => item.tech === job.tech && item.level === job.targetLevel)
          : log.completedUnits.some(item => item.unit === job.unit && item.count >= 1);
        check(logged, 'Removed job requires its actual tick completion');
        return { kind: job.kind, jobId: job.jobId, target: paid.target, targetLevel: paid.targetLevel, stage, logicalSeconds: seconds };
      }); extra.log = plain(log);
    } else if (api === 'enqueue' || api === 'enqueueResearch') {
      check(before, 'Payment before summary required');
      const kind = api === 'enqueue' ? 'building' : 'research', target = r.target as string;
      const quote = api === 'enqueue' ? canEnqueue(state, target as BuildingId) : canEnqueueResearch(state, target as ResearchId);
      check(quote.ok, `Original fixed payment must be affordable: ${quote.reason}`);
      const cost = money(quote.cost), oldWallet = activePlanet(state).resources, expectedId = state.orders.nextJobId;
      const result = api === 'enqueue' ? enqueue(state, target as BuildingId, 'manual') : enqueueResearch(state, target as ResearchId, 'manual');
      check(result.ok && result.jobId === expectedId, `Real payment must issue the expected next identity: ${result.reason}`); state = result.state;
      check(state.orders.nextJobId === expectedId + 1 && !paidJobs.has(expectedId), 'Paid identity cannot repeat');
      for (const id of RES) check(activePlanet(state).resources[id].toString() === oldWallet[id].sub(cost[id]).toString(), 'Exact whole-wallet subtraction required');
      equal(state.energyChallenge, before.challenge, 'Payment cannot award challenge progress');
      const actualJob = jobsAt(state).find(job => job.jobId === expectedId); check(actualJob && actualJob.kind !== 'shipyard' && actualJob.source === 'manual' && actualJob.taskId === null, 'Actual ordinary paid job required');
      equal(actualJob.paid, cost, 'Whole real job price must match quote'); paidJobs.set(expectedId, { target, targetLevel: quote.targetLevel });
      extra.payment = { kind, target, targetLevel: quote.targetLevel, jobId: expectedId, cost, actualJob,
        stage, logicalSeconds: seconds, beforeWallet: before.wallets.homeworld, afterWallet: money(activePlanet(state).resources), label: r.label };
    } else if (api === 'challengeCandidate') {
      const challengeAction = r.action as 'enter' | 'finish', quote = quoteEnergyChallenge(state, challengeAction);
      check(quote.ok, `Original ordinary curve must be eligible: ${quote.reason}`);
      const old = canonical(serializeState(state)), operation = challengeAction === 'enter' ? enterEnergyChallenge : finishEnergyChallenge;
      const result = operation(state, quote); check(result.ok, result.reason); candidate = result.state;
      check(canonical(serializeState(state)) === old, 'Curve cannot mutate source state');
      const duplicate = operation(state, quote); check(!duplicate.ok && duplicate.state === state, 'One-use quote must reject replay');
      check(candidate.stats.launches === state.stats.launches + 1 && candidate.warpCores.eq(state.warpCores.add(quote.gain)), 'Exactly one ordinary curve reward required');
      extra.quote = plain(quote); extra.candidate = summary(candidate, seconds); extra.replayRejected = true; row.candidate = serializeState(candidate);
    } else if (api === 'checkpoint') {
      const now = EPOCH + seconds * 1000, expected = serializeState(candidate ?? state), saved = session.save(candidate ?? state, now, now);
      check(saved.ok, 'Actual local SaveSession write/readback must succeed');
      session = new SaveSession(store, now); check(session.mode === 'ready' && session.loaded.appliedSeconds === 0, 'Own reader must adopt without offline progress');
      equal(serializeState(session.loaded.state), expected, 'Whole adopted state must equal own candidate');
      state = session.loaded.state; candidate = null;
      const raw = store.getItem(STORAGE_KEY); check(typeof raw === 'string', 'Own primary envelope required');
      const stateSha256 = await sha(canonical(serializeState(state)));
      checkpoints[r.name as string] = { file: r.file, raw, sha256: await sha(raw), stateSha256, logicalSeconds: seconds, totalTime: state.totalTime.toString(), schema: { version: SAVE_VERSION, revision: SAVE_REVISION }, summary: summary(state, seconds), eventIndex: index };
      extra.stateSha256 = stateSha256; row.raw = raw;
      if (r.name === 'initial') check(raw === initial, 'Initial checkpoint must be pristine constructor bytes');
    } else if (api === 'reject') {
      const old = canonical(serializeState(state)); let result;
      if (r.api === 'enqueue') result = enqueue(state, r.building as BuildingId, 'manual');
      else if (r.api === 'enqueueResearch') result = enqueueResearch(state, r.tech as ResearchId, 'manual');
      else { const challengeAction = r.api === 'enterEnergyChallenge' ? 'enter' : 'finish', quote = quoteEnergyChallenge(state, challengeAction); result = challengeAction === 'enter' ? enterEnergyChallenge(state, quote) : finishEnergyChallenge(state, quote); }
      check(!result.ok && result.state === state && canonical(serializeState(state)) === old, 'Rejected action must preserve every field'); extra.reason = result.reason;
    } else check(api === 'createInitialState' && index === 1, 'Only first constructor marker allowed');
    receipts.push(plain({ ...action, before, after: summary(state, seconds), ...extra })); row.state = serializeState(state); expectedStates.push(plain(row));
  }
  check(candidate === null && seconds === 4201 && receipts.length === ROW_COUNT && Object.keys(checkpoints).length === 22, 'Complete uninterrupted fixed journey required');
  check(state.manualClicks === 0 && state.stats.automatedLaunches === 0 && state.stats.launches === 2, 'Only two manual ordinary curves');
  check(paidJobs.size === 153 && state.orders.nextJobId === 154 && [...paidJobs.keys()].every((id, i) => id === i + 1), 'Every issued paid identity must be accounted for');
  check(queueCapacity(state) === 3 && researchCapacity(state) === 3 && activePlanet(state).buildQueue.length === 0 && state.research.queue.length === 0, 'Earned three-wide queues must complete');
  check(state.research.levels.energy_tech === 2 && state.research.levels.computer_tech === 1 && state.research.levels.combustion_drive === 1, 'Three real research completions required');
  const finalState = serializeState(state);
  return { schema: 'infinity-energy-challenge-solar-browser-replay-v1', receipts, expectedStates, initial, checkpoints, rows: ROW_COUNT, logicalSeconds: seconds, finalState, finalStateSha256: await sha(canonical(finalState)) };
}
