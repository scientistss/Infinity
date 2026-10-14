#!/usr/bin/env node
/** Bounded, anonymous domain fixture preparation, NOT native performance evidence.
 * node --import tsx scripts/energy-active-performance-fixture.mjs --out DIR
 * No input saves, seeds, progress patches, success search, browser or production edits.
 * Both profiles independently execute the published fresh natural solar route.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceOption = process.argv.indexOf('--source-root');
const SOURCE_ROOT = sourceOption >= 0 ? resolve(process.argv[sourceOption + 1]) : ROOT;
const fromSource = path => import(pathToFileURL(resolve(SOURCE_ROOT, path)).href);
const { createInitialState } = await fromSource('src/game/state.ts');
const { activePlanet, selectPlanet, withPlanet } = await fromSource('src/game/empire.ts');
const { big } = await fromSource('src/game/decimal.ts');
const { economy, energyDemand } = await fromSource('src/game/economy.ts');
const { canEnqueue, enqueue, nextTargetLevel, costFor, queueCapacity } = await fromSource('src/game/queue.ts');
const { canEnqueueResearch, enqueueResearch, researchCapacity } = await fromSource('src/game/research.ts');
const { canBuildUnits, orderUnits } = await fromSource('src/game/shipyard.ts');
const { tick, emptyTickLog, warpGain } = await fromSource('src/game/logic.ts');
const { quoteEnergyChallenge, enterEnergyChallenge, abandonEnergyChallenge } = await fromSource('src/game/energy-challenge.ts');
const { quoteFlight, sendFleet, emptyCargo, shipEngine } = await fromSource('src/game/fleet.ts');
const { coordinateKey, npcAt, wrap, distance } = await fromSource('src/game/galaxy.ts');
const { serializeState, importSave } = await fromSource('src/game/save.ts');
const { SaveSession } = await fromSource('src/game/save-session.ts');
const { SAVE_VERSION, SAVE_REVISION, STORAGE_KEY } = await fromSource('src/game/content.ts');

const SOURCE = '6af7a5e85a522ba89478c5e95d919a2c04fb2e55';
const SEED = 20261013, EPOCH = Date.UTC(2026, 9, 13);
const RES = ['metal', 'crystal', 'deuterium'];
const PROOFS = ['metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant'];
const STORAGE = ['metal_storage', 'crystal_storage', 'deuterium_tank'];
const GOAL = 1000000000000000000n;
export const BOUNDS = Object.freeze({ naturalSeconds: 7200, setupSeconds: 1800, setupPaidJobs: 200, coordinateCandidates: 90, nativeRunSeconds: 120, fleetMinimumSeconds: 180, headroomSeconds: 480 });
export const PROFILE_IDS = ['ordinary-1world', 'capital-assisted-4world-8fleet'];
const plain = x => JSON.parse(JSON.stringify(x));
const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
const canonical = x => JSON.stringify(sort(x));
const hash = x => createHash('sha256').update(x).digest('hex');
const stateHash = s => hash(canonical(serializeState(s)));
const money = x => Object.fromEntries(RES.map(id => [id, x[id].toString()]));
/** Exact finite-decimal delta for grant receipts, independent of Decimal rounding. */
export function exactDelta(before, after) {
  const parse = text => {
    const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text); assert(m, `Invalid amount ${text}`);
    const exponent = Number(m[3] ?? 0) - (m[2] ?? '').length; assert(Math.abs(exponent) <= 100);
    return { coefficient: BigInt(m[1] + (m[2] ?? '')), exponent };
  };
  const a = parse(before), b = parse(after), exponent = Math.min(a.exponent, b.exponent, 0);
  const delta = b.coefficient * 10n ** BigInt(b.exponent - exponent) - a.coefficient * 10n ** BigInt(a.exponent - exponent);
  assert(delta >= 0n, 'Grant must not remove resources');
  if (!delta) return '0';
  const digits = delta.toString().padStart(1 - exponent, '0');
  return exponent === 0 ? digits : `${digits.slice(0, exponent)}.${digits.slice(exponent)}`.replace(/0+$/, '').replace(/\.$/, '');
}
const git = (...args) => execFileSync('git', ['-C', SOURCE_ROOT, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
function inventory(dir) {
  return readdirSync(resolve(SOURCE_ROOT, dir), { withFileTypes: true }).flatMap(e => {
    assert(!e.isSymbolicLink()); const path = `${dir}/${e.name}`;
    return e.isDirectory() ? inventory(path) : [{ path, sha256: hash(readFileSync(resolve(SOURCE_ROOT, path))) }];
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function manifest() {
  return [...inventory('src'), ...['package.json', 'package-lock.json', 'scripts/energy-challenge-natural-fixture.mjs'].map(path => ({ path, sha256: hash(readFileSync(resolve(SOURCE_ROOT, path))) })), { path: 'scripts/energy-active-performance-fixture.mjs', sha256: hash(readFileSync(fileURLToPath(import.meta.url))), origin: 'harness' }];
}
function store() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function summary(s, seconds) {
  return {
    logicalSeconds: seconds, totalTime: s.totalTime.toString(), stateSha256: stateHash(s), activePlanetId: s.activePlanetId,
    lifetime: money(s.lifetime), warpCores: s.warpCores.toString(), launches: s.stats.launches,
    nextJobId: s.orders.nextJobId, queueCapacity: queueCapacity(s), researchCapacity: researchCapacity(s),
    challenge: plain(s.energyChallenge), research: plain(s.research), fleets: plain(s.fleets),
    planets: s.planets.map(p => { const e = economy(selectPlanet(s, p.id)); return {
      id: p.id, coordinates: p.coordinates, resources: money(p.resources), buildings: p.buildings, units: p.units,
      buildQueue: plain(p.buildQueue), shipyardQueue: plain(p.shipyardQueue), productionPct: p.productionPct,
      energy: { supply: e.supply, demand: e.demand, ordinaryDemand: energyDemand(p), energyFactor: e.efficiency }, caps: e.caps, gross: e.gross, net: e.net,
    }; }),
  };
}
function jobs(s) {
  return [...s.planets.flatMap(p => [...p.buildQueue.map(j => ({ kind: 'building', planetId: p.id, ...plain(j) })), ...p.shipyardQueue.map(j => ({ kind: 'shipyard', planetId: p.id, ...plain(j) }))]), ...s.research.queue.map(j => ({ kind: 'research', ...plain(j) }))];
}
function readback(state, seconds, memory = store()) {
  const now = EPOCH + seconds * 1000, writer = new SaveSession(memory, now);
  const saved = writer.save(state, now, now); assert(saved.ok, saved.message);
  const raw = memory.getItem(STORAGE_KEY); assert(raw);
  const reader = new SaveSession(memory, now); assert.equal(reader.mode, 'ready', reader.message);
  assert.equal(reader.loaded.appliedSeconds, 0);
  assert.deepEqual(serializeState(reader.loaded.state), serializeState(state), 'Strict reader changed candidate');
  return { state: reader.loaded.state, raw };
}
function withoutActive(s) { const copy = plain(s); copy.energyChallenge.active = null; return copy; }

/** Replay only public API actions and the explicitly authorized wallet-only topups. */
function replay(actions, final, checkpoints) {
  let s = createInitialState(SEED, SEED), seconds = 0;
  for (const event of actions) {
    assert.equal(stateHash(s), event.beforeHash, `Replay before ${event.index}/${event.api}`);
    const r = event.request;
    if (event.api === 'tick') { s = tick(s, r.dt, 'live'); seconds += r.dt; }
    else if (event.api === 'selectPlanet') s = selectPlanet(s, r.planetId);
    else if (event.api === 'walletTopup') {
      s = withPlanet(s, { resources: Object.fromEntries(RES.map(id => [id, big(r.afterWallet[id])])) });
    } else if (event.api === 'checkpoint') {
      const result = readback(s, seconds); s = result.state;
      assert.equal(hash(result.raw), checkpoints[r.name].sha256);
    } else if (event.api !== 'createInitialState' && event.api !== 'coordinateCandidate') {
      let result;
      if (event.api === 'enqueue') result = enqueue(s, r.target, 'manual');
      else if (event.api === 'enqueueResearch') result = enqueueResearch(s, r.target, 'manual');
      else if (event.api === 'orderUnits') result = orderUnits(s, r.target, r.count, 'manual');
      else if (event.api === 'enterEnergyChallenge') result = enterEnergyChallenge(s, quoteEnergyChallenge(s, 'enter'));
      else if (event.api === 'sendFleet') result = sendFleet(s, { ...r, cargo: emptyCargo() });
      else throw Error(`Unrecognized replay action ${event.api}`);
      assert(result.ok, result.reason); s = result.state;
    }
    assert.equal(stateHash(s), event.afterHash, `Replay after ${event.index}/${event.api}`);
  }
  assert.equal(stateHash(s), stateHash(final));
  return { status: 'passed', events: actions.length, kind: 'independent-fresh-seed-exact-action-reexecution', finalStateSha256: stateHash(s) };
}

function makeProfile(out, id, report) {
  const capital = id === PROFILE_IDS[1], directory = resolve(out, id);
  mkdirSync(directory, { recursive: true });
  const traceFile = `${id}/receipts.jsonl`; writeFileSync(resolve(out, traceFile), '', { flag: 'wx' });
  let state = createInitialState(SEED, SEED), seconds = 0, stage = 'natural-first-curvature', checkpointSeconds = null, checkpointJobId = null;
  const actions = [], payments = [], grants = [], completions = [], candidates = [], checkpoints = {};
  const row = { id, capitalAssisted: capital, status: 'running', checkpoints, variants: {}, payments, grants, completions, coordinateCandidates: candidates };
  report.profiles.push(row);
  const emit = (api, request, before, extra = {}, full = false) => {
    const event = { index: actions.length + 1, stage, api, request: plain(request), beforeHash: stateHash(before), afterHash: stateHash(state), before: summary(before, api === 'tick' ? seconds - request.dt : seconds), after: summary(state, seconds), ...plain(extra) };
    if (full) { event.beforeState = serializeState(before); event.afterState = serializeState(state); }
    appendFileSync(resolve(out, traceFile), JSON.stringify(event) + '\n');
    actions.push({ index: event.index, api, request: event.request, beforeHash: event.beforeHash, afterHash: event.afterHash });
    return event.index;
  };
  function checkpoint(name) {
    assert(!checkpoints[name]); const before = state, read = readback(state, seconds); state = read.state;
    const file = `${id}/${name}.json`; writeFileSync(resolve(out, file), read.raw, { flag: 'wx' });
    checkpoints[name] = { file, sha256: hash(read.raw), bytes: Buffer.byteLength(read.raw), stateSha256: stateHash(state), eventIndex: actions.length + 1, summary: summary(state, seconds) };
    emit('checkpoint', { name }, before);
  }
  function bounded() {
    if (checkpointSeconds === null) assert(seconds <= BOUNDS.naturalSeconds, 'Fresh natural checkpoint exceeded 7200s');
    else {
      assert(seconds - checkpointSeconds <= BOUNDS.setupSeconds, 'Post-checkpoint setup exceeded 1800s');
      assert(state.orders.nextJobId - checkpointJobId <= BOUNDS.setupPaidJobs, 'Post-checkpoint setup exceeded 200 paid jobs');
    }
  }
  function advance(reason) {
    bounded(); const before = state, oldJobs = jobs(state), oldProofs = plain(state.energyChallenge.active?.proofs ?? null), log = emptyTickLog();
    state = tick(state, 1, 'live', log); seconds++; bounded();
    const remaining = new Set(jobs(state).map(j => j.jobId));
    const completed = oldJobs.filter(j => !remaining.has(j.jobId)).map(j => {
      const payment = payments.find(p => p.jobId === j.jobId); assert(payment, `Completion without payment ${j.jobId}`);
      const actual = j.kind === 'building' ? log.completedBuilds.some(x => x.building === j.building && x.level === j.targetLevel && (!x.planetId || x.planetId === j.planetId))
        : j.kind === 'research' ? log.completedResearch.some(x => x.tech === j.tech && x.level === j.targetLevel)
        : log.completedUnits.some(x => x.unit === j.unit && x.count >= 1);
      assert(actual, `Missing real tick completion ${j.jobId}`);
      const c = { jobId: j.jobId, kind: j.kind, target: payment.target, planetId: payment.planetId, seconds, eventIndex: actions.length + 1 }; completions.push(c); return c;
    });
    emit('tick', { dt: 1, mode: 'live', reason }, before, { completed, log }, completed.length > 0 || before.planets.length !== state.planets.length);
    if (stage === 'natural-home-proofs') for (const target of PROOFS) if (oldProofs?.[target] === null && state.energyChallenge.active.proofs[target] !== null) checkpoint(`proof-${target}-completed`);
  }
  function wait(reason, ready) { while (!ready()) advance(reason); }
  function topup(cost, purpose) {
    assert(capital && checkpointSeconds !== null, 'Wallet grants require capital profile after natural checkpoint');
    const before = state, p = activePlanet(state), beforeWallet = money(p.resources);
    const resources = Object.fromEntries(RES.map(r => [r, p.resources[r].max(cost[r])]));
    const afterWallet = money(resources); if (RES.every(r => beforeWallet[r] === afterWallet[r])) return;
    state = withPlanet(state, { resources });
    const expected = serializeState(before); expected.planets.find(p => p.id === state.activePlanetId).resources = afterWallet;
    assert.deepEqual(serializeState(state), expected, 'Grant changed non-wallet state');
    assert.deepEqual(before.energyChallenge, state.energyChallenge, 'Grant awarded progress');
    const grant = { planetId: p.id, purpose, beforeWallet, afterWallet, granted: Object.fromEntries(RES.map(r => [r, exactDelta(beforeWallet[r], afterWallet[r])])), scoreBefore: state.energyChallenge.active.scoreUnits, scoreAfter: state.energyChallenge.active.scoreUnits, eventIndex: actions.length + 1 };
    grants.push(grant); emit('walletTopup', { planetId: p.id, afterWallet, purpose }, before, { grant }, true);
  }
  function pay(kind, target, count = 1, permitGrant = capital && checkpointSeconds !== null) {
    const quote = () => kind === 'building' ? canEnqueue(state, target) : kind === 'research' ? canEnqueueResearch(state, target) : canBuildUnits(state, target, count);
    let q = quote();
    if (!q.ok && q.onlyResources && permitGrant) { topup(q.cost, `${kind}/${target}/${q.targetLevel ?? count}`); q = quote(); }
    assert(q.ok, `${stage} ${kind}/${target}: ${q.reason}`); bounded();
    if (checkpointJobId !== null) assert(state.orders.nextJobId - checkpointJobId < BOUNDS.setupPaidJobs, 'No paid jobs remain in bounded setup');
    const before = state, p = activePlanet(state), expectedId = state.orders.nextJobId;
    const result = kind === 'building' ? enqueue(state, target, 'manual') : kind === 'research' ? enqueueResearch(state, target, 'manual') : orderUnits(state, target, count, 'manual');
    assert(result.ok, result.reason); assert.equal(result.jobId, expectedId); state = result.state;
    for (const r of RES) assert.equal(activePlanet(state).resources[r].toString(), p.resources[r].sub(q.cost[r]).toString(), `Payment mismatch ${r}`);
    assert.deepEqual(state.energyChallenge, before.energyChallenge, 'Payment changed score/proofs');
    const job = jobs(state).find(j => j.jobId === result.jobId); assert(job); assert.equal(job.source, 'manual'); assert.equal(job.taskId, null);
    const payment = { jobId: result.jobId, kind, target, targetLevel: q.targetLevel ?? null, count, planetId: p.id, cost: money(q.cost), beforeWallet: money(p.resources), afterWallet: money(activePlanet(state).resources), actualJob: job, seconds, stage, eventIndex: actions.length + 1 };
    payments.push(payment); emit(kind === 'building' ? 'enqueue' : kind === 'research' ? 'enqueueResearch' : 'orderUnits', { target, count, source: 'manual' }, before, { payment }, true);
    if (stage === 'natural-home-proofs' && PROOFS.includes(target)) checkpoint(`proof-${target}-paid`);
    return result.jobId;
  }
  function naturalBuilding() {
    const p = activePlanet(state), e = economy(state), lv = id => nextTargetLevel(p, id) - 1; let id = 'metal_mine';
    if (lv('metal_mine') === 0) id = 'metal_mine';
    else if (lv('solar_plant') === 0) id = 'solar_plant';
    else if (lv('crystal_mine') === 0) id = 'crystal_mine';
    else if (lv('metal_mine') >= 4 && lv('deuterium_synth') === 0) id = 'deuterium_synth';
    else if (lv('metal_mine') >= 6 && lv('deuterium_synth') >= 2 && lv('research_lab') < 1) id = 'research_lab';
    else if (e.efficiency < .95 && !p.buildQueue.some(j => j.building === 'solar_plant')) id = 'solar_plant';
    else if (lv('crystal_mine') < lv('metal_mine') - 2) id = 'crystal_mine';
    else if (lv('deuterium_synth') < Math.max(1, Math.floor(lv('crystal_mine') * .6))) id = 'deuterium_synth';
    else if (lv('deuterium_synth') >= 1 && lv('robotics_factory') < Math.min(4, Math.floor(lv('metal_mine') / 4))) id = 'robotics_factory';
    const cost = costFor(state, id, nextTargetLevel(p, id));
    for (let i = 0; i < RES.length; i++) if (cost[RES[i]].gt(e.caps[RES[i]] * .9)) return STORAGE[i];
    return id;
  }
  function buildTo(target, level) {
    while (activePlanet(state).buildings[target] < level) {
      assert.equal(activePlanet(state).buildQueue.length, 0);
      if (!capital) wait(`Naturally fund ${target}`, () => canEnqueue(state, target).ok);
      pay('building', target); wait(`Complete paid ${target}`, () => activePlanet(state).buildQueue.length === 0);
    }
  }
  function researchTo(target, level) {
    while (state.research.levels[target] < level) { pay('research', target); wait(`Complete paid ${target}`, () => state.research.queue.length === 0); }
  }
  function select(id) { const before = state; state = selectPlanet(state, id); emit('selectPlanet', { planetId: id }, before); }
  function dispatch(request) {
    let q = quoteFlight(state, request);
    if (!q.ok) {
      // Derive this one-ship fuel quote from the published formula, without making
      // a hypothetical funded state. The actual public quote must confirm it.
      const p = activePlanet(state), selected = Object.entries(request.ships); assert.equal(selected.length, 1); assert.equal(selected[0][1], 1);
      const engine = shipEngine(state, selected[0][0]); assert(engine.speed > 0);
      const fuel = big(engine.fuel).mul(distance(p.coordinates, request.target) / 35000).mul((request.speedPercent / 100 + 1) ** 2).ceil().add(1).mul(2);
      topup({ metal: p.resources.metal, crystal: p.resources.crystal, deuterium: fuel }, `flight/${request.mission}/${coordinateKey(request.target)}`);
      q = quoteFlight(state, request);
      assert.equal(q.fuel.toString(), fuel.toString(), 'Funded public flight quote differs from preflight fuel calculation');
    }
    assert(q.ok, q.reason); const before = state, result = sendFleet(state, request); assert(result.ok, result.reason); state = result.state;
    assert.deepEqual(state.energyChallenge, before.energyChallenge);
    emit('sendFleet', request, before, { quote: plain(q), fleetId: result.fleetId }, true);
  }
  try {
    emit('createInitialState', { worldSeed: SEED, arcadeSeed: SEED }, state, {}, true); checkpoint('initial');
    while (!(warpGain(state).gte(1) && state.research.levels.energy_tech >= 1 && PROOFS.every(b => activePlanet(state).buildings[b] >= 1))) {
      if (state.research.levels.energy_tech === 0 && state.research.queue.length === 0 && canEnqueueResearch(state, 'energy_tech').ok) pay('research', 'energy_tech', 1, false);
      for (let i = 0; i < 2 && activePlanet(state).buildQueue.length < queueCapacity(state); i++) { const target = naturalBuilding(); if (!canEnqueue(state, target).ok) break; pay('building', target, 1, false); }
      advance('Fresh natural production and paid development to first legal curvature');
    }
    checkpoint('entry-ready');
    const before = state, quote = quoteEnergyChallenge(state, 'enter'); assert(quote.ok, quote.reason);
    const entered = enterEnergyChallenge(state, quote); assert(entered.ok, entered.reason); state = entered.state;
    assert.equal(state.stats.launches, 1); assert.equal(state.energyChallenge.active.scoreUnits, '0');
    emit('enterEnergyChallenge', { action: 'enter' }, before, { quote }, true); checkpoint('entered');
    stage = 'natural-home-proofs';
    pay('building', 'metal_mine', 1, false); pay('building', 'solar_plant', 1, false);
    wait('First two real post-entry home proofs', () => activePlanet(state).buildQueue.length === 0);
    pay('building', 'crystal_mine', 1, false); pay('building', 'deuterium_synth', 1, false);
    wait('Remaining real post-entry home proofs', () => activePlanet(state).buildQueue.length === 0);
    for (const target of PROOFS) {
      const proof = state.energyChallenge.active.proofs[target], paid = payments.find(p => p.jobId === proof?.jobId);
      assert(proof && paid && paid.target === target && paid.targetLevel === 1 && proof.jobId >= state.energyChallenge.active.entryJobFloor);
      assert.deepEqual(proof.paid, paid.cost); assert(completions.some(c => c.jobId === proof.jobId));
    }
    checkpoint('natural-checkpoint'); checkpointSeconds = seconds; checkpointJobId = state.orders.nextJobId;
    stage = capital ? 'capital-assisted-paid-setup' : 'ordinary-natural-paid-setup';
    buildTo('solar_plant', 4);
    if (capital) {
      buildTo('robotics_factory', 2); buildTo('shipyard', 4); buildTo('research_lab', 3);
      for (const [tech, level] of [['energy_tech', 1], ['impulse_drive', 3], ['espionage_tech', 4], ['astrophysics', 5], ['computer_tech', 7], ['combustion_drive', 2]]) researchTo(tech, level);
      pay('shipyard', 'colony_ship', 3); pay('shipyard', 'small_cargo', 8);
      wait('Complete three real colony ships and eight real cargo ships', () => activePlanet(state).shipyardQueue.length === 0);
      const home = activePlanet(state), chosen = [];
      // Fixed bounded coordinates, not a search over seeds or previous output.
      for (let offset = 0; offset < 6 && chosen.length < 3; offset++) for (let position = 1; position <= 15 && chosen.length < 3; position++) {
        assert(candidates.length < BOUNDS.coordinateCandidates);
        const target = { galaxy: 3, system: wrap(home.coordinates.system + offset, 100), position };
        const occupied = !!npcAt(state, target), systemUsed = chosen.some(c => c.galaxy === target.galaxy && c.system === target.system);
        const candidate = { target, occupied, systemUsed, accepted: !occupied && !systemUsed };
        candidates.push(candidate); emit('coordinateCandidate', candidate, state);
        if (candidate.accepted) chosen.push(target);
      }
      assert.equal(chosen.length, 3, 'No three legal distinct-system colonies within 90 candidates');
      for (const target of chosen) dispatch({ mission: 'colonize', target, ships: { colony_ship: 1 }, cargo: emptyCargo(), speedPercent: 50 });
      wait('Real colony arrivals and consumption of three colony ships', () => state.planets.length === 4 && state.fleets.length === 0);
      for (const planet of state.planets) {
        select(planet.id); for (const target of PROOFS.slice(0, 3)) buildTo(target, 1); buildTo('solar_plant', 4);
        for (const target of STORAGE) buildTo(target, 2);
      }
      select('homeworld');
      for (let i = 0; i < 8; i++) dispatch({ mission: 'transport', target: state.planets[1 + i % 3].coordinates, ships: { small_cargo: 1 }, cargo: emptyCargo(), speedPercent: 10 });
    } else {
      // Ordinary profile remains entirely naturally funded, including all storage.
      for (const target of STORAGE) buildTo(target, 1);
    }
    assert.equal(jobs(state).length, 0); assert.equal(state.activePlanetId, 'homeworld');
    // A final idle tick settles ordinary achievement/unlock housekeeping through the engine.
    advance('Final natural idle stabilization');
    assert.equal(state.manualClicks, 0); assert.equal(state.stats.automatedLaunches, 0);
    assert.equal(state.planets.length, capital ? 4 : 1); assert.equal(state.fleets.length, capital ? 8 : 0);
    if (capital) {
      assert.equal(activePlanet(state).buildings.robotics_factory, 2); assert.equal(activePlanet(state).buildings.shipyard, 4); assert.equal(activePlanet(state).buildings.research_lab, 3);
      for (const [tech, level] of [['energy_tech', 1], ['impulse_drive', 3], ['espionage_tech', 4], ['astrophysics', 5], ['computer_tech', 7], ['combustion_drive', 2]]) assert.equal(state.research.levels[tech], level);
      assert.equal(new Set(state.planets.slice(1).map(p => `${p.coordinates.galaxy}:${p.coordinates.system}`)).size, 3);
    }
    assert.equal(state.energyChallenge.completion, null); assert.equal(queueCapacity(state), 2); assert.equal(researchCapacity(state), 2);
    assert.equal(state.orders.tasks.length, 0); assert(state.protocols.slots.every(s => !s.card)); assert.equal(state.boosters.length, 0);
    assert.equal(state.arcade.autoBatch, null);
    for (const p of state.planets) {
      for (const target of PROOFS.slice(0, 3)) assert.equal(p.buildings[target], 1);
      assert.equal(p.buildings.solar_plant, 4); assert.equal(p.buildings.fusion_reactor, 0); assert.equal(p.units.solar_satellite, 0);
      const eco = economy(selectPlanet(state, p.id)); assert.equal(eco.efficiency, 1); assert(Math.abs(eco.supply - 117.128) < 1e-8); assert.equal(eco.demand, 88);
      for (const r of RES) { assert(eco.net[r] > 0); assert(p.resources[r].add(eco.gross[r] * BOUNDS.headroomSeconds * 1.1).lt(eco.caps[r]), `${p.id}/${r} lacks 480s conservative storage headroom`); }
    }
    assert(state.fleets.every(f => f.mission === 'transport' && !f.returning && f.remaining > BOUNDS.fleetMinimumSeconds && RES.every(r => f.cargo[r].eq(0))));
    const upperPoints = state.planets.reduce((sum, p) => { const e = economy(selectPlanet(state, p.id)); return sum + e.gross.metal + 3 * e.gross.crystal + 10 * e.gross.deuterium; }, 0) * BOUNDS.headroomSeconds * 1.1;
    assert(BigInt(state.energyChallenge.active.scoreUnits) + BigInt(Math.ceil(upperPoints * 1e12)) < GOAL, '480s score headroom insufficient');
    stage = 'final-active'; checkpoint('active'); row.variants.active = checkpoints.active;
    row.replay = replay(actions, state, checkpoints);
    const active = state, q = quoteEnergyChallenge(active, 'abandon'); assert(q.ok, q.reason);
    const result = abandonEnergyChallenge(active, q); assert(result.ok, result.reason);
    assert.deepEqual(serializeState(result.state), withoutActive(serializeState(active)), 'Abandon changed more than active');
    const control = readback(result.state, seconds), file = `${id}/control.json`;
    writeFileSync(resolve(out, file), control.raw, { flag: 'wx' });
    assert.deepEqual(serializeState(control.state), withoutActive(serializeState(active)), 'Control reader changed more than active');
    assert.equal(control.state.energyChallenge.completion, null); assert.equal(queueCapacity(control.state), 2); assert.equal(researchCapacity(control.state), 2);
    for (const p of control.state.planets) { const e = economy(selectPlanet(control.state, p.id)); assert.equal(e.demand, 44); assert.equal(e.efficiency, 1); }
    row.variants.control = { file, sha256: hash(control.raw), bytes: Buffer.byteLength(control.raw), stateSha256: stateHash(control.state), summary: summary(control.state, seconds) };
    row.controlDerivation = { api: 'quoteEnergyChallenge + abandonEnergyChallenge + SaveSession.save + new SaveSession', quote: plain(q), fromStateSha256: stateHash(active), toStateSha256: stateHash(control.state), serializedChangedPaths: ['energyChallenge.active'], beforeState: serializeState(active), afterState: serializeState(control.state) };
    row.bounds = { setupSeconds: seconds - checkpointSeconds, setupPaidJobs: state.orders.nextJobId - checkpointJobId, coordinateCandidates: candidates.length, nativeRunSeconds: BOUNDS.nativeRunSeconds, minimumFleetRemaining: state.fleets.length ? Math.min(...state.fleets.map(f => f.remaining)) : null, conservativeHeadroomSeconds: BOUNDS.headroomSeconds, conservativeHeadroomMultiplier: 1.1, maximumAddedScoreUnits: String(BigInt(Math.ceil(upperPoints * 1e12))) };
    row.counts = { wholeRoutePaidJobs: payments.length, preEntryPaidJobs: payments.filter(p => p.stage === 'natural-first-curvature').length, postEntryPaidJobs: payments.filter(p => p.stage !== 'natural-first-curvature').length, homeProofPaidJobs: payments.filter(p => p.stage === 'natural-home-proofs').length, postNaturalCheckpointPaidJobs: state.orders.nextJobId - checkpointJobId, walletGrants: grants.length };
    row.status = 'passed'; process.stderr.write(`${id}: ${seconds}s total, ${row.bounds.setupSeconds}s setup, ${row.bounds.setupPaidJobs} paid setup jobs, ${grants.length} grants\n`);
  } catch (error) { row.status = 'failed'; row.error = error instanceof Error ? error.message : String(error); row.failedStage = stage; row.final = summary(state, seconds); throw error; }
  finally { row.transcript = { file: traceFile, sha256: hash(readFileSync(resolve(out, traceFile))), bytes: readFileSync(resolve(out, traceFile)).byteLength, events: actions.length }; }
}

export function generateFixtures(out) {
  out = resolve(out); mkdirSync(out, { recursive: true });
  const sourceFiles = manifest();
  const report = { schema: 'energy-active-performance-fixtures-v1', status: 'running', evidenceKind: 'fresh-domain-fixtures-not-native-performance-proof', sourceRoot: SOURCE_ROOT, harnessRoot: ROOT, sourceSha: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD^{tree}'), sourceFiles, sourceManifestSha256: hash(canonical(sourceFiles)), nodeVersion: process.version, storageKey: STORAGE_KEY, saveVersion: SAVE_VERSION, saveRevision: SAVE_REVISION, sourceInput: { kind: 'createInitialState', worldSeed: SEED, arcadeSeed: SEED, importedSaves: [], importedReports: [], permittedSyntheticChange: 'capital profile after natural checkpoint: receipt-backed wallet topups only' }, bounds: BOUNDS, profiles: [], caveats: ['Compressed logical domain setup is not elapsed browser or human-play evidence.', '480s is conservative storage/score headroom and the native-worker aggregate budget; per-context arrival-free measurement is bounded to 120s.'] };
  try {
    assert.equal(report.sourceSha, SOURCE, 'Only exact public r16 source is authorized'); assert.equal(SAVE_VERSION, 9); assert.equal(SAVE_REVISION, 16);
    // Engine sources must be the exact public checkout; diagnostic scripts may be new.
    assert.equal(git('diff', 'HEAD', '--', 'src', 'package.json', 'package-lock.json'), '', 'Production source differs from authorized public commit');
    assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'src'), '', 'Untracked engine source is not authorized');
    for (const id of PROFILE_IDS) makeProfile(out, id, report);
    assert.deepEqual(manifest(), sourceFiles, 'Source changed during fixture generation'); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); }
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

/** Strict-reader validation lane, outside any native CPU measurement window.
 * A manifest is { files: [{ file: "relative/or/absolute.json", sha256?: "..." }] }.
 * Every input is preserved. Validation never changes timestamps or supplied state.
 */
export function validateRawInputs(input, isManifest = false) {
  const sourceFiles = manifest();
  const result = { schema: 'energy-active-performance-strict-reader-v1', status: 'running', sourceSha: git('rev-parse', 'HEAD'), sourceManifestSha256: hash(canonical(sourceFiles)), sourceFiles, inputs: [] };
  try {
    assert.equal(result.sourceSha, SOURCE);
    assert.equal(git('diff', 'HEAD', '--', 'src', 'package.json', 'package-lock.json'), '');
    const refs = isManifest ? JSON.parse(readFileSync(input, 'utf8')).files : [{ file: resolve(input) }];
    assert(Array.isArray(refs) && refs.length > 0 && refs.length <= 512, 'Bounded nonempty raw input list required');
    for (const ref of refs) {
      const path = resolve(dirname(input), ref.file), raw = readFileSync(path, 'utf8'), sha256 = hash(raw), bytes = Buffer.byteLength(raw);
      if (ref.sha256) assert.equal(sha256, ref.sha256, 'Supplied input hash differs');
      const envelope = JSON.parse(raw); assert.equal(envelope.version, SAVE_VERSION); assert.equal(envelope.revision, SAVE_REVISION);
      const imported = importSave(raw), memory = store(); memory.setItem(STORAGE_KEY, raw);
      const reader = new SaveSession(memory, imported.lastTickAt);
      assert.equal(reader.mode, 'ready', reader.message); assert.equal(reader.loaded.appliedSeconds, 0);
      const serializedState = serializeState(reader.loaded.state); assert.deepEqual(serializedState, imported.state); assert.deepEqual(serializedState, envelope.state);
      const saved = reader.save(reader.loaded.state, imported.savedAt, imported.lastTickAt); assert(saved.ok, saved.message);
      const reloaded = new SaveSession(memory, imported.lastTickAt); assert.equal(reloaded.mode, 'ready'); assert.equal(reloaded.loaded.appliedSeconds, 0);
      assert.deepEqual(serializeState(reloaded.loaded.state), serializedState);
      result.inputs.push({ file: path, sha256, bytes, readerMode: reader.mode, appliedSeconds: 0, stateSha256: stateHash(reader.loaded.state), serializedState, roundtripRawSha256: hash(memory.getItem(STORAGE_KEY)) });
    }
    assert.deepEqual(manifest(), sourceFiles); result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  while (args.length) { const key = args.shift(); assert(['--source-root', '--out', '--validate-raw', '--validate-raw-manifest', '--output'].includes(key) && args.length && !options[key], `Unsupported/duplicate option ${key}`); options[key] = args.shift(); }
  const validating = options['--validate-raw'] || options['--validate-raw-manifest'];
  assert(!(options['--validate-raw'] && options['--validate-raw-manifest']));
  assert(validating ? options['--output'] && !options['--out'] : options['--out'] && !options['--output'], 'Use --out NEW_DIRECTORY or --validate-raw[-manifest] INPUT --output OUTPUT');
  const result = validating ? validateRawInputs(resolve(validating), !!options['--validate-raw-manifest']) : generateFixtures(options['--out']);
  if (validating) { mkdirSync(dirname(resolve(options['--output'])), { recursive: true }); writeFileSync(options['--output'], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  process.stdout.write(JSON.stringify({ status: result.status, report: validating ? resolve(options['--output']) : resolve(options['--out'], 'report.json'), error: result.error, profiles: result.profiles?.map(p => ({ id: p.id, status: p.status })) }) + '\n');
  if (result.status !== 'passed') process.exitCode = 1;
}
