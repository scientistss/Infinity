#!/usr/bin/env node
/** Fresh-seeded domain acceptance, never browser or human-play evidence.
 * node --import tsx scripts/energy-challenge-natural-fixture.mjs --out DIR [--allow-dirty]
 * No input-save/report, seed override, grants, manual collections or success search.
 * Only the named SaveSession checkpoints adopt the real strict-reader result.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialState } from '../src/game/state.ts';
import { activePlanet } from '../src/game/empire.ts';
import { economy, energyDemand } from '../src/game/economy.ts';
import { canEnqueue, enqueue, nextTargetLevel, costFor, queueCapacity } from '../src/game/queue.ts';
import { canEnqueueResearch, enqueueResearch, researchCapacity } from '../src/game/research.ts';
import { canBuildUnits, orderUnits, deficitAfterQueued } from '../src/game/shipyard.ts';
import { tick, emptyTickLog, expansionScore, warpGain } from '../src/game/logic.ts';
import { setProductionPct } from '../src/automation/engine.ts';
import { energyChallengeStatus, quoteEnergyChallenge, enterEnergyChallenge, finishEnergyChallenge, abandonEnergyChallenge } from '../src/game/energy-challenge.ts';
import { serializeState } from '../src/game/save.ts';
import { SaveSession } from '../src/game/save-session.ts';
import { SAVE_VERSION, SAVE_REVISION, STORAGE_KEY } from '../src/game/content.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_SEED = 20261013, ARCADE_SEED = 20261013;
const EPOCH = Date.UTC(2026, 9, 13), MAX_STAGE_SECONDS = 7200;
const POLICIES = ['solar', 'satellite', 'throttle'];
const RES = ['metal', 'crystal', 'deuterium'];
const PROOFS = ['metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant'];
const WEIGHTS = { metal: 1n, crystal: 3n, deuterium: 10n }, GOAL = 1000000000000000000n;
const hash = raw => createHash('sha256').update(raw).digest('hex');
const plain = x => JSON.parse(JSON.stringify(x));
const canonical = x => JSON.stringify(sort(x));
function sort(x) { return Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x; }
const money = x => Object.fromEntries(RES.map(id => [id, x[id].toString()]));
const stateHash = s => hash(canonical(serializeState(s)));
const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
function inventory(dir) {
  return readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink(), `Unexpected source symlink: ${dir}/${e.name}`);
    const path = `${dir}/${e.name}`;
    return e.isDirectory() ? inventory(path) : [{ path, sha256: hash(readFileSync(resolve(ROOT, path))) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function sourceManifest() {
  return [...inventory('src'), ...['package.json', 'package-lock.json', 'scripts/energy-challenge-natural-fixture.mjs'].map(path => ({ path, sha256: hash(readFileSync(resolve(ROOT, path))) }))];
}
let out, allowDirty = false;
const args = process.argv.slice(2);
while (args.length) {
  const arg = args.shift();
  if (arg === '--out') { assert(!out && args.length, 'One --out DIR required'); out = resolve(args.shift()); }
  else if (arg === '--allow-dirty') { assert(!allowDirty); allowDirty = true; }
  else throw new Error(`Unsupported argument ${arg}; no saves/reports/seeds may be supplied`);
}
assert(out, '--out DIR required');
const dirtyPaths = git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean);
assert(allowDirty || dirtyPaths.length === 0, 'Clean source required; --allow-dirty is diagnostic only');
const sourceFiles = sourceManifest();
const report = {
  schema: 'energy-challenge-natural-v1', status: 'running', evidenceKind: 'pure-domain-compressed-logical-time-not-browser-proof',
  sourceSha: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), sourceFiles, sourceManifestSha256: hash(canonical(sourceFiles)),
  sourceClassification: dirtyPaths.length ? 'diagnostic-working-tree' : 'clean-candidate-source', dirtyPaths, nodeVersion: process.version,
  sourceInput: { kind: 'createInitialState', worldSeed: WORLD_SEED, arcadeSeed: ARCADE_SEED, importedSaves: [], importedReports: [], stockGrants: [], directStatePatches: [] },
  rules: { maxStageSeconds: MAX_STAGE_SECONDS, secondsPerTick: 1, tickMode: 'live', policyOrder: POLICIES,
    reader: 'SaveSession.save candidate write/readback followed by new SaveSession at the same timestamp; adopted only at named checkpoints',
    pureProductionAudit: 'Independent rational retained-wallet upper bound at every whole tick; no in-tick payments, fusion, collection, transfers, cards or ring reveals. Internal segment floor losses may only reduce the capped score.' },
  routes: [], caveats: ['Compressed domain time, not elapsed browser or human-play time.', 'Does not replace migration, protection, cancellation, acceleration, UI or full-regression gates.'],
};
mkdirSync(out, { recursive: true });

// Independent finite-decimal arithmetic. This imports no game score/price helper.
function fraction(text) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  assert(m, `Nonnegative canonical amount expected: ${text}`);
  const exp = Number(m[3] || 0) - (m[2] || '').length;
  assert(Math.abs(exp) <= 100, 'Natural route wallet exponent exceeded independent audit bound');
  const n = BigInt(m[1] + (m[2] || ''));
  return exp < 0 ? [n, 10n ** BigInt(-exp)] : [n * 10n ** BigInt(exp), 1n];
}
function differenceUnits(before, after, weight) {
  const [a, ad] = fraction(before), [b, bd] = fraction(after);
  const numerator = b * ad - a * bd;
  assert(numerator >= 0n, 'A pure no-fusion/no-card tick unexpectedly reduced a wallet');
  return numerator * weight * 1000000000000n / (ad * bd);
}
const BUILD_PRICES = {
  metal_mine: [60, 15, 0, 1.5], crystal_mine: [48, 24, 0, 1.6], deuterium_synth: [225, 75, 0, 1.5],
  solar_plant: [75, 30, 0, 1.5], robotics_factory: [400, 120, 200, 2], shipyard: [400, 200, 100, 2],
  research_lab: [200, 400, 200, 2], metal_storage: [1000, 0, 0, 2], crystal_storage: [1000, 500, 0, 2], deuterium_tank: [1000, 1000, 0, 2],
};
const TECH_PRICES = { energy_tech: [0, 800, 400], computer_tech: [0, 400, 600], combustion_drive: [400, 0, 600] };
function goldenPrice(kind, target, level = 1) {
  const b = kind === 'building' ? BUILD_PRICES[target] : kind === 'research' ? [...TECH_PRICES[target], 2] : [0, 2000, 500, 1];
  assert(b, `No independently declared price for ${kind}/${target}`);
  return Object.fromEntries(RES.map((id, i) => [id, String(Math.floor(b[i] * b[3] ** (level - 1) + 1e-8))]));
}
function makeStore() {
  const map = new Map();
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function summary(s, seconds) {
  const p = activePlanet(s), eco = economy(s);
  return { logicalSeconds: seconds, totalTime: s.totalTime.toString(), wallets: { [p.id]: money(p.resources) },
    lifetime: money(s.lifetime), launches: s.stats.launches, warpCores: s.warpCores.toString(), expansionScore: expansionScore(s).toString(), warpGain: warpGain(s).toString(),
    nextJobId: s.orders.nextJobId, buildingCapacity: queueCapacity(s), researchCapacity: researchCapacity(s),
    challenge: plain(s.energyChallenge), buildings: { ...p.buildings }, productionPct: { ...p.productionPct }, satellites: p.units.solar_satellite,
    researchLevels: { ...s.research.levels }, buildingQueue: plain(p.buildQueue), researchQueue: plain(s.research.queue), shipyardQueue: plain(p.shipyardQueue),
    energy: { supply: eco.supply, demand: eco.demand, ordinaryDemand: energyDemand(p), efficiency: eco.efficiency } };
}
function jobsAt(s) {
  const p = activePlanet(s);
  return [...p.buildQueue.map(job => ({ kind: 'building', planetId: p.id, ...plain(job) })),
    ...p.shipyardQueue.map(job => ({ kind: 'shipyard', planetId: p.id, ...plain(job) })),
    ...s.research.queue.map(job => ({ kind: 'research', ...plain(job) }))];
}
function route(policy) {
  const destination = resolve(out, policy); mkdirSync(destination, { recursive: true });
  let state = createInitialState(WORLD_SEED, ARCADE_SEED), seconds = 0, stage = 'first-curvature', stageStart = 0;
  const store = makeStore(); let session = new SaveSession(store, EPOCH);
  const events = [], paidJobs = new Map(), checkpoints = {}, production = [];
  let independentUnits = 0n, activeTickCount = 0, shortageSeconds = 0, challengeStart = null;
  const row = { policy, status: 'running', checkpoints, stages: {}, replay: null, payments: [], completions: [], rejections: [], satellitePayments: [], productionAudit: null };
  report.routes.push(row);
  const emit = (api, request, before, extra = {}) => { const event = { index: events.length + 1, stage, api, request: plain(request), before, after: summary(state, seconds), ...plain(extra) }; events.push(event); return event; };
  function checkpoint(name, candidate = state) {
    assert(!checkpoints[name], `Duplicate checkpoint ${name}`);
    const before = summary(state, seconds), candidateHash = stateHash(candidate), now = EPOCH + seconds * 1000;
    const saved = session.save(candidate, now, now);
    assert(saved.ok, `${name}: SaveSession.save rejected: ${saved.message}`);
    const raw = store.getItem(STORAGE_KEY); assert(raw);
    const reader = new SaveSession(store, now);
    assert.equal(reader.mode, 'ready', `${name}: real reader protected: ${reader.message}`);
    assert.equal(reader.loaded.appliedSeconds, 0, `${name}: unintended offline interval`);
    assert.deepEqual(serializeState(reader.loaded.state), serializeState(candidate), `${name}: adopted reader drift`);
    state = reader.loaded.state; session = reader;
    const file = `${policy}/${name}.json`; writeFileSync(resolve(out, file), raw, { flag: 'wx' });
    checkpoints[name] = { file, sha256: hash(raw), stateSha256: candidateHash, logicalSeconds: seconds, totalTime: state.totalTime.toString(), schema: { version: SAVE_VERSION, revision: SAVE_REVISION }, summary: summary(state, seconds), eventIndex: events.length + 1 };
    emit('checkpoint', { name, file, appliedSeconds: 0, adoptsReader: true }, before, { stateSha256: candidateHash });
    return state;
  }
  function pay(kind, target, label = null) {
    const before = summary(state, seconds), p = activePlanet(state);
    const quote = kind === 'building' ? canEnqueue(state, target) : kind === 'research' ? canEnqueueResearch(state, target) : canBuildUnits(state, target, 1);
    assert(quote.ok, `${stage}: ${kind}/${target} blocked: ${quote.reason}`);
    const price = goldenPrice(kind, target, quote.targetLevel ?? 1);
    assert.deepEqual(money(quote.cost), price, 'Quote differs from independent ordinary catalog golden');
    const oldWallet = { ...p.resources }, expectedId = state.orders.nextJobId;
    const result = kind === 'building' ? enqueue(state, target, 'manual') : kind === 'research' ? enqueueResearch(state, target, 'manual') : orderUnits(state, target, 1, 'manual');
    assert(result.ok, result.reason); assert.equal(result.jobId, expectedId);
    state = result.state;
    for (const id of RES) assert.equal(activePlanet(state).resources[id].toString(), oldWallet[id].sub(price[id]).toString(), `${id}: real payment mismatch`);
    assert.equal(state.orders.nextJobId, expectedId + 1);
    assert.deepEqual(state.energyChallenge, before.challenge, 'Payment must not award challenge progress');
    const actual = jobsAt(state).find(job => job.jobId === result.jobId); assert(actual, 'Actual paid queue job missing');
    assert.equal(actual.source, 'manual'); assert.equal(actual.taskId, null);
    assert.deepEqual(kind === 'shipyard' ? actual.paidPerUnit : actual.paid, price);
    assert(!paidJobs.has(result.jobId), 'Paid identity reused');
    const payment = { kind, target, targetLevel: quote.targetLevel ?? null, jobId: result.jobId, cost: price, actualJob: actual,
      stage, logicalSeconds: seconds, beforeWallet: before.wallets.homeworld, afterWallet: money(activePlanet(state).resources), label };
    paidJobs.set(result.jobId, payment); row.payments.push(payment);
    if (kind === 'shipyard') row.satellitePayments.push(payment);
    emit(kind === 'building' ? 'enqueue' : kind === 'research' ? 'enqueueResearch' : 'orderUnits', { target, source: 'manual', count: kind === 'shipyard' ? 1 : null, label }, before, { payment });
    if (stage === 'challenge-proof' && PROOFS.includes(target)) checkpoint(`proof-${target}-paid`);
    return result.jobId;
  }
  function advance(reason) {
    assert(seconds - stageStart < MAX_STAGE_SECONDS, `${stage} exceeded frozen ${MAX_STAGE_SECONDS}s limit; ${reason}; ${JSON.stringify(summary(state, seconds))}`);
    const before = summary(state, seconds), oldJobs = jobsAt(state), oldProofs = state.energyChallenge.active?.proofs;
    assert.equal(state.planets.length, 1); assert.equal(activePlanet(state).buildings.fusion_reactor, 0);
    assert(state.protocols.slots.every(s => !s.card), 'Natural audit permits no automated payment or resource source');
    const log = emptyTickLog(), after = tick(state, 1, 'live', log);
    if (state.energyChallenge.active) {
      assert.equal(before.energy.demand, before.energy.ordinaryDemand * 2, 'Challenge mine demand must be exactly doubled');
      const delta = RES.reduce((sum, id) => sum + differenceUnits(before.wallets.homeworld[id], activePlanet(after).resources[id].toString(), WEIGHTS[id]), 0n);
      independentUnits += delta; activeTickCount += 1;
      const actual = BigInt(after.energyChallenge.active.scoreUnits);
      // 1s live tick permits at most 266 engine segments for this one-world/no-fleet route.
      // Each has at most three floors, so this conservative bound is independent of score helpers.
      const lossBound = BigInt(activeTickCount) * 798n;
      assert(actual <= (independentUnits < GOAL ? independentUnits : GOAL), 'Score exceeded independently retained production');
      assert(actual >= (independentUnits - lossBound < GOAL ? independentUnits - lossBound : GOAL), 'Score lost more than conservative segment quantization bound');
      production.push({ second: seconds, dt: 1, before: before.wallets.homeworld, after: money(activePlanet(after).resources),
        independentUpperDeltaUnits: delta.toString(), independentUpperCumulativeUnits: independentUnits.toString(), actualScoreUnits: actual.toString() });
      if (before.energy.efficiency < 1) shortageSeconds += 1;
    }
    state = after; seconds += 1;
    const remaining = new Set(jobsAt(state).map(job => job.jobId));
    const completed = oldJobs.filter(job => !remaining.has(job.jobId)).map(job => {
      const real = paidJobs.get(job.jobId); assert(real, 'Completion has no observed real payment');
      const logged = job.kind === 'building' ? log.completedBuilds.some(e => e.building === job.building && e.level === job.targetLevel)
        : job.kind === 'research' ? log.completedResearch.some(e => e.tech === job.tech && e.level === job.targetLevel)
        : log.completedUnits.some(e => e.unit === job.unit && e.count >= 1);
      assert(logged, `Removed paid job ${job.jobId} lacks tick completion`);
      const evidence = { kind: job.kind, jobId: job.jobId, target: real.target, targetLevel: real.targetLevel, stage, logicalSeconds: seconds };
      row.completions.push(evidence); return evidence;
    });
    emit('tick', { dt: 1, mode: 'live', reason }, before, { completed, log });
    if (stage === 'challenge-proof') for (const id of PROOFS) {
      if (oldProofs?.[id] === null && state.energyChallenge.active.proofs[id] !== null) checkpoint(`proof-${id}-completed`);
    }
  }
  function wait(reason, ready) { while (!ready()) advance(reason); }
  function reject(api, request, run) {
    const before = summary(state, seconds), old = stateHash(state), result = run();
    assert.equal(result.ok, false, `${api}: rejection expected`); assert.equal(result.state, state); assert.equal(stateHash(state), old);
    const rejection = { api, request, reason: result.reason, logicalSeconds: seconds }; row.rejections.push(rejection);
    emit('reject', { api, ...request }, before, { reason: result.reason });
  }
  function chooseBuilding(strategy) {
    const p = activePlanet(state), eco = economy(state), lv = id => nextTargetLevel(p, id) - 1;
    let id = 'metal_mine';
    if (lv('metal_mine') === 0) id = 'metal_mine';
    else if (lv('solar_plant') === 0) id = 'solar_plant';
    else if (lv('crystal_mine') === 0) id = 'crystal_mine';
    else if (lv('metal_mine') >= 4 && lv('deuterium_synth') === 0) id = 'deuterium_synth';
    else if (lv('metal_mine') >= 6 && lv('deuterium_synth') >= 2 && lv('research_lab') < 1) id = 'research_lab';
    else if (strategy === 'satellite' && lv('metal_mine') >= 6 && lv('deuterium_synth') >= 2 && lv('robotics_factory') < 2) id = 'robotics_factory';
    else if (strategy === 'satellite' && p.buildings.robotics_factory >= 2 && lv('shipyard') === 0) id = 'shipyard';
    else if (eco.efficiency < (strategy === 'solar' ? .95 : strategy === 'throttle' ? .65 : .8)
      && !p.buildQueue.some(job => job.building === 'solar_plant')
      && !(strategy === 'satellite' && p.buildings.shipyard >= 1 && deficitAfterQueued(state) <= 0)) id = 'solar_plant';
    else if (lv('crystal_mine') < lv('metal_mine') - 2) id = 'crystal_mine';
    else if (lv('deuterium_synth') < Math.max(1, Math.floor(lv('crystal_mine') * .6))) id = 'deuterium_synth';
    else if (lv('deuterium_synth') >= 1 && lv('robotics_factory') < Math.min(4, Math.floor(lv('metal_mine') / 4))) id = 'robotics_factory';
    const cost = costFor(state, id, nextTargetLevel(p, id));
    for (const [resource, storage] of [['metal', 'metal_storage'], ['crystal', 'crystal_storage'], ['deuterium', 'deuterium_tank']]) {
      if (cost[resource].gt(eco.caps[resource] * .9)) return storage;
    }
    return id;
  }
  function act(strategy, researchEnabled) {
    if (strategy === 'throttle' && (seconds - challengeStart) % 120 === 0) {
      const values = Math.floor((seconds - challengeStart) / 120) % 2 === 0 ? [100, 100, 0] : [40, 40, 100];
      PROOFS.slice(0, 3).forEach((building, index) => {
        const before = summary(state, seconds); state = setProductionPct(state, building, values[index]);
        emit('setProductionPct', { building, pct: values[index] }, before);
      });
    }
    if (strategy === 'satellite' && activePlanet(state).buildings.shipyard >= 1 && deficitAfterQueued(state) > 0 && canBuildUnits(state, 'solar_satellite', 1).ok) pay('shipyard', 'solar_satellite');
    if (researchEnabled && state.research.levels.energy_tech === 0 && state.research.queue.length === 0 && canEnqueueResearch(state, 'energy_tech').ok) pay('research', 'energy_tech');
    for (let n = 0; n < 2 && activePlanet(state).buildQueue.length < queueCapacity(state); n++) {
      const id = chooseBuilding(strategy); if (!canEnqueue(state, id).ok) break; pay('building', id);
    }
  }
  function transition(action) {
    const before = summary(state, seconds), quote = quoteEnergyChallenge(state, action); assert(quote.ok, quote.reason);
    const old = state, oldHash = stateHash(old), result = action === 'enter' ? enterEnergyChallenge(state, quote) : finishEnergyChallenge(state, quote);
    assert(result.ok, result.reason); assert.equal(stateHash(old), oldHash, 'Transition mutated its source');
    const replay = action === 'enter' ? enterEnergyChallenge(old, quote) : finishEnergyChallenge(old, quote);
    assert(!replay.ok && replay.state === old, 'Used source quote replay must refuse');
    assert.equal(result.state.stats.launches, old.stats.launches + 1, 'Exactly one ordinary curvature');
    assert.equal(result.state.warpCores.toString(), old.warpCores.add(quote.gain).toString());
    // Candidate is not visible/adopted until SaveSession has completed readback.
    const candidateSummary = summary(result.state, seconds);
    emit('challengeCandidate', { action }, before, { quote: plain(quote), candidate: candidateSummary, replayRejected: true });
    checkpoint(action === 'enter' ? 'entered' : 'completed', result.state);
    reject(action === 'enter' ? 'enterEnergyChallenge' : 'finishEnergyChallenge', { freshQuote: true }, () => {
      const q = quoteEnergyChallenge(state, action); return action === 'enter' ? enterEnergyChallenge(state, q) : finishEnergyChallenge(state, q);
    });
  }
  try {
    emit('createInitialState', { worldSeed: WORLD_SEED, arcadeSeed: ARCADE_SEED }, null);
    assert.deepEqual(money(activePlanet(state).resources), { metal: '500', crystal: '500', deuterium: '0' });
    checkpoint('initial');
    while (!(warpGain(state).gte(1) && state.research.levels.energy_tech >= 1 && PROOFS.every(id => activePlanet(state).buildings[id] >= 1))) {
      act('solar', true); advance('first legal ordinary curvature through production and paid research');
    }
    row.stages.first = { seconds, summary: summary(state, seconds) }; checkpoint('entry-ready');
    transition('enter'); assert.equal(state.energyChallenge.active.scoreUnits, '0'); assert.equal(queueCapacity(state), 2);
    assert.deepEqual(money(activePlanet(state).resources), { metal: '500', crystal: '500', deuterium: '0' });
    challengeStart = seconds; stageStart = seconds; stage = 'challenge-proof';
    pay('building', 'metal_mine'); pay('building', 'solar_plant'); wait('first two real home proof completions', () => activePlanet(state).buildQueue.length === 0);
    pay('building', 'crystal_mine'); pay('building', 'deuterium_synth'); wait('remaining real home proof completions', () => activePlanet(state).buildQueue.length === 0);
    for (const id of PROOFS) {
      const proof = state.energyChallenge.active.proofs[id], real = paidJobs.get(proof?.jobId);
      assert(proof && real && real.target === id && real.targetLevel === 1 && proof.jobId >= state.energyChallenge.active.entryJobFloor);
      assert.deepEqual(proof.paid, real.cost); assert(row.completions.some(c => c.jobId === proof.jobId));
    }
    checkpoint('active-progress');
    // Independent branch exercises real abandonment without replacing the main journey.
    const branchQuote = quoteEnergyChallenge(state, 'abandon'), branch = abandonEnergyChallenge(state, branchQuote); assert(branch.ok);
    const branchStore = makeStore(), branchSession = new SaveSession(branchStore, EPOCH + seconds * 1000);
    assert(branchSession.save(branch.state, EPOCH + seconds * 1000).ok);
    const branchReader = new SaveSession(branchStore, EPOCH + seconds * 1000); assert.equal(branchReader.mode, 'ready');
    assert.deepEqual(serializeState(branchReader.loaded.state), serializeState(branch.state));
    const branchRaw = branchStore.getItem(STORAGE_KEY), branchFile = `${policy}/abandoned.json`;
    writeFileSync(resolve(out, branchFile), branchRaw, { flag: 'wx' });
    checkpoints.abandoned = { file: branchFile, sha256: hash(branchRaw), stateSha256: stateHash(branch.state), logicalSeconds: seconds,
      totalTime: branch.state.totalTime.toString(), branch: { from: 'active-progress', action: 'abandonEnergyChallenge', adoptedSeparately: true }, summary: summary(branch.state, seconds) };
    stage = 'challenge-growth';
    while (!energyChallengeStatus(state).canFinish) { act(policy, false); advance('pure challenge production to legal finish'); }
    assert.equal(state.energyChallenge.active.scoreUnits, GOAL.toString()); assert(independentUnits >= GOAL);
    assert(warpGain(state).gte(1)); assert.equal(queueCapacity(state), 2);
    if (policy === 'satellite') assert(row.satellitePayments.some(p => p.stage === 'challenge-growth'), 'Satellite policy must actually pay for satellites');
    row.stages.challenge = { seconds: seconds - challengeStart, shortageSeconds, summary: summary(state, seconds) };
    checkpoint('finish-ready'); transition('finish');
    assert.equal(state.stats.launches, 2); assert.equal(queueCapacity(state), 3); assert.equal(researchCapacity(state), 3);
    row.productionAudit = { tickCount: activeTickCount, independentUpperUnits: independentUnits.toString(), cappedActualUnits: GOAL.toString(), conservativeFloorLossBoundUnits: String(activeTickCount * 798), pureBoundary: true };
    stage = 'reward-building'; stageStart = seconds;
    const buildIds = []; for (const id of ['metal_mine', 'crystal_mine', 'solar_plant']) {
      if (buildIds.length === 2) checkpoint('before-third-build-paid'); buildIds.push(pay('building', id, 'third-building-proof'));
    }
    assert.equal(activePlanet(state).buildQueue.length, 3); checkpoint('third-build-paid'); checkpoint('third-build-paid-reloaded');
    reject('enqueue', { building: 'deuterium_synth', fourth: true }, () => enqueue(state, 'deuterium_synth', 'manual'));
    wait('all three paid ordinary building positions finish once', () => activePlanet(state).buildQueue.length === 0);
    for (const id of ['metal_mine', 'crystal_mine', 'solar_plant']) assert.equal(activePlanet(state).buildings[id], 1);
    for (const id of buildIds) assert.equal(row.completions.filter(c => c.jobId === id).length, 1);
    checkpoint('third-build-completed');
    stage = 'reward-research'; stageStart = seconds;
    while (!(activePlanet(state).buildings.research_lab >= 1 && activePlanet(state).buildings.deuterium_synth >= 3)) { act('solar', false); advance('natural research infrastructure after completion'); }
    wait('drain paid building queue before research proof', () => activePlanet(state).buildQueue.length === 0);
    wait('naturally fund three research queue payments', () => activePlanet(state).resources.metal.gte(400) && activePlanet(state).resources.crystal.gte(2000) && activePlanet(state).resources.deuterium.gte(2000));
    const techIds = []; for (const tech of ['energy_tech', 'computer_tech', 'combustion_drive']) {
      if (techIds.length === 2) checkpoint('before-third-research-paid'); techIds.push(pay('research', tech, 'third-research-proof'));
    }
    assert.equal(state.research.queue.length, 3); checkpoint('third-research-paid'); checkpoint('third-research-paid-reloaded');
    reject('enqueueResearch', { tech: 'computer_tech', fourth: true }, () => enqueueResearch(state, 'computer_tech', 'manual'));
    wait('all three paid ordinary research positions finish once', () => state.research.queue.length === 0);
    assert.equal(state.research.levels.energy_tech, 2); assert.equal(state.research.levels.computer_tech, 1); assert.equal(state.research.levels.combustion_drive, 1);
    for (const id of techIds) assert.equal(row.completions.filter(c => c.jobId === id).length, 1);
    checkpoint('third-research-completed');
    row.reward = { buildingJobIds: buildIds, researchJobIds: techIds, thirdBuildId: 'solar_plant', thirdResearchId: 'combustion_drive', replayedReaderWithoutRepayment: true, exactlyOnceCompletions: true };
    row.nativeProofSteps = [];
    let proofCursor = checkpoints.entered.eventIndex;
    for (const name of Object.keys(checkpoints).filter(name => name.startsWith('proof-'))) {
      const end = checkpoints[name].eventIndex;
      const calls = events.slice(proofCursor, end - 1).filter(event => event.api === 'enqueue' || event.api === 'tick');
      const steps = calls.map(event => event.api === 'enqueue' ? { kind: 'build', building: event.request.target } : { kind: 'advance', seconds: event.request.dt });
      assert(steps.length, `Native proof checkpoint ${name} has no real intervening action`);
      steps[steps.length - 1].checkpoint = name; row.nativeProofSteps.push(...steps); proofCursor = end;
    }
    row.replay = replayRoute(events, checkpoints);
    assert.equal(state.manualClicks, 0); assert.equal(state.stats.automatedLaunches, 0);
    assert.deepEqual([...paidJobs.keys()], Array.from({ length: state.orders.nextJobId - 1 }, (_, i) => i + 1), 'Every issued real payment must be accounted for');
    row.status = 'passed'; row.totalLogicalSeconds = seconds; row.final = summary(state, seconds);
    process.stderr.write(`${policy}: two legal curvatures, ${row.stages.challenge.seconds}s challenge, ${row.satellitePayments.length} real satellite payments, third building/research payments verified\n`);
  } catch (error) { row.status = 'failed'; row.error = error instanceof Error ? error.message : String(error); row.failedStage = stage; row.final = summary(state, seconds); throw error; }
  finally {
    const receiptsRaw = JSON.stringify(events), productionRaw = production.map(x => JSON.stringify(x)).join('\n') + (production.length ? '\n' : '');
    writeFileSync(resolve(destination, 'receipts.json'), receiptsRaw, { flag: 'wx' });
    writeFileSync(resolve(destination, 'production.jsonl'), productionRaw, { flag: 'wx' });
    row.receipts = { file: `${policy}/receipts.json`, sha256: hash(receiptsRaw), count: events.length };
    row.productionTrace = { file: `${policy}/production.jsonl`, sha256: hash(productionRaw), count: production.length };
  }
}
/** Re-execute the entire recorded action transcript from the same fresh seed.
 * This consumes in-memory actions from this run, never an input save/report.
 */
function replayRoute(events, checkpoints) {
  let state = createInitialState(WORLD_SEED, ARCADE_SEED), seconds = 0, candidate = null;
  const store = makeStore(); let session = new SaveSession(store, EPOCH);
  for (const event of events) {
    if (event.before !== null) assert.deepEqual(summary(state, seconds), event.before, `Replay before event ${event.index}`);
    const r = event.request;
    if (event.api === 'tick') { state = tick(state, r.dt, r.mode); seconds += r.dt; }
    else if (event.api === 'enqueue' || event.api === 'enqueueResearch' || event.api === 'orderUnits') {
      const result = event.api === 'enqueue' ? enqueue(state, r.target, r.source) : event.api === 'enqueueResearch' ? enqueueResearch(state, r.target, r.source) : orderUnits(state, r.target, r.count, r.source);
      assert(result.ok); assert.equal(result.jobId, event.payment.jobId); state = result.state;
    } else if (event.api === 'setProductionPct') state = setProductionPct(state, r.building, r.pct);
    else if (event.api === 'challengeCandidate') {
      const q = quoteEnergyChallenge(state, r.action);
      assert.deepEqual(plain(q), event.quote);
      const result = r.action === 'enter' ? enterEnergyChallenge(state, q) : finishEnergyChallenge(state, q);
      assert(result.ok); candidate = result.state;
      assert.deepEqual(summary(candidate, seconds), event.candidate);
      const duplicate = r.action === 'enter' ? enterEnergyChallenge(state, q) : finishEnergyChallenge(state, q);
      assert(!duplicate.ok && duplicate.state === state);
    } else if (event.api === 'checkpoint') {
      const now = EPOCH + seconds * 1000;
      assert(session.save(candidate ?? state, now, now).ok);
      session = new SaveSession(store, now); assert.equal(session.mode, 'ready'); assert.equal(session.loaded.appliedSeconds, 0);
      state = session.loaded.state; candidate = null;
      assert.equal(stateHash(state), checkpoints[r.name].stateSha256, `Replay checkpoint ${r.name}`);
      assert.equal(hash(store.getItem(STORAGE_KEY)), checkpoints[r.name].sha256, `Replay exact envelope ${r.name}`);
    } else if (event.api === 'reject') {
      let result;
      if (r.api === 'enqueue') result = enqueue(state, r.building, 'manual');
      else if (r.api === 'enqueueResearch') result = enqueueResearch(state, r.tech, 'manual');
      else { const action = r.api === 'enterEnergyChallenge' ? 'enter' : 'finish', q = quoteEnergyChallenge(state, action); result = action === 'enter' ? enterEnergyChallenge(state, q) : finishEnergyChallenge(state, q); }
      assert(!result.ok && result.state === state); assert.equal(result.reason, event.reason);
    } else assert.equal(event.api, 'createInitialState');
    assert.deepEqual(summary(state, seconds), event.after, `Replay after event ${event.index}`);
  }
  return { status: 'passed', kind: 'fresh-seed-complete-action-transcript', eventCount: events.length, finalStateSha256: stateHash(state), exactEnvelopes: Object.keys(checkpoints).filter(key => key !== 'abandoned').length };
}

try {
  for (const policy of POLICIES) route(policy);
  assert.deepEqual(sourceManifest(), sourceFiles, 'Source changed during natural production; output cannot be acceptance evidence');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1; }
finally { writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); process.stdout.write(JSON.stringify({ status: report.status, report: resolve(out, 'report.json'), routes: report.routes.map(r => ({ policy: r.policy, status: r.status, error: r.error })) }) + '\n'); }
