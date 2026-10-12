// Dormant preparation only. No game imports, simulated GameState, browser,
// production-schema, paid launch, offline-once receipt or native acceptance.
// Expected economic data comes from oracle.py's independent Fraction/Python
// float calculations. Loop assertions below are NOT independent test counts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { MODEL, createState, validateState, inspect, materialize, advance, debit } from './domain.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const fixture = golden.coordinateFixture;
const keys = fixture.coordinates.map(row => row.key);
const clone = value => JSON.parse(JSON.stringify(value));
const zeroGarrison = { light_fighter: 0, heavy_fighter: 0 };
const outcome = result => {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result;
};
const fresh = (stock = [500, 250, 0]) => outcome(createState({ seed: fixture.seed, stock })).state;
const read = (state, key = keys[0]) => outcome(inspect(state, key)).value;
const view = (state, key = keys[0]) => {
  const { stock, phase, spent } = read(state, key);
  return { stock, phase, spent };
};
const pure = (fn, state, ...args) => {
  const before = JSON.stringify(state);
  const result = fn(state, ...args);
  assert.equal(JSON.stringify(state), before, `${fn.name} mutated its input`);
  return result;
};
function refusal(fn, state, ...args) {
  const result = pure(fn, state, ...args);
  assert.equal(result.ok, false, `${fn.name} should refuse`);
  assert.equal(result.state, state, 'refusal retains the exact input state reference');
  assert.equal(typeof result.error.code, 'string');
  return result;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function roundtrip(state) {
  const before = JSON.stringify(state);
  const reloaded = JSON.parse(before);
  const validated = outcome(pure(validateState, reloaded));
  assert.equal(validated.value, true);
  assert.equal(JSON.stringify(reloaded), before, 'validation/reload never adopts time');
  return reloaded;
}

// This is an independently owned host arithmetic fixture, not game integration.
// Only actual countdown operands pick segment boundaries. No EPS, ideal total
// reconstruction, nominal-time regrouping, or source of wall-clock duration.
function driver(initial, duration, maxStep = Infinity, events = [], perturb = false) {
  if (!Number.isFinite(duration) || duration < 0 || duration > 28800) throw new RangeError('duration');
  if (!(maxStep > 0)) throw new RangeError('step');
  let state = clone(initial), remaining = duration, total = 0, passes = 0, actorVisits = 0;
  let queue = clone(events), steps = 0;
  for (const event of queue) {
    if (!Number.isFinite(event.remaining) || event.remaining <= 0) throw new RangeError('event countdown');
    if (!['scout', 'attack'].includes(event.kind)) throw new RangeError('event kind');
  }
  const trace = [], observations = [];
  while (remaining > 0) {
    const step = Math.min(remaining, maxStep, state.growthPassRemaining,
      ...queue.map(event => event.remaining));
    assert.ok(step > 0, 'no pending zero-duration loop');
    const changed = outcome(pure(advance, state, step));
    state = changed.state;
    total += step;
    remaining -= step;
    queue.forEach(event => { event.remaining -= step; });
    steps++;
    passes += changed.value.passes;
    actorVisits += changed.value.actorVisits;
    if (changed.value.passes) trace.push({ kind: 'growth', at: total, pass: passes });
    for (const item of changed.value.trace) trace.push({ ...item, at: total });
    const due = queue.filter(event => event.remaining === 0).sort((a, b) =>
      (a.kind === 'scout' ? 0 : 1) - (b.kind === 'scout' ? 0 : 1) || a.id - b.id);
    for (const event of due) {
      const observation = read(state, event.key);
      const record = { kind: event.kind, at: total, id: event.id,
        stock: observation.stock, phase: observation.phase, growthPasses: passes };
      if (event.kind === 'scout') observations.push(clone(observation));
      else {
        const paid = observation.stock.map(amount => Math.floor(amount / 2));
        const change = outcome(pure(debit, state, event.key, paid, zeroGarrison));
        state = change.state;
        record.loot = paid;
        record.after = change.value.after;
      }
      trace.push(record);
    }
    queue = queue.filter(event => event.remaining !== 0);
    if (perturb) {
      const frozen = JSON.stringify(state);
      for (let i = 0; i < 3; i++) { read(state); read(state, keys[1]); }
      assert.equal(JSON.stringify(state), frozen, 'added reads are inert');
      state = roundtrip(state);
    }
  }
  return { state, total, remaining, queue, trace, observations, passes, actorVisits, steps };
}
const flights = (deadline = 720, key = keys[0]) => [
  { kind: 'attack', id: 1, key, remaining: deadline },
  { kind: 'scout', id: 2, key, remaining: deadline },
];
function materialized(stock) {
  return outcome(pure(materialize, fresh(stock), keys[0])).state;
}
function eventsOnly(run) {
  return run.trace.filter(event => event.kind === 'scout' || event.kind === 'attack')
    .map(({ id, ...rest }) => rest);
}

for (const [name, initial, checkpointTimes, raidAt, scoutAt] of [
  ['fresh', [500, 250, 0], [720, 780, 840, 900]],
  ['zero', [0, 0, 0], [780, 840, 900, 960, 1020]],
  ['full', [50000, 30000, 10000], [60, 120, 180, 240]],
  ['raidBefore', [500, 250, 0], [660, 720, 840, 1080, 1140, 1200, 1260], 660],
  ['coincident', [500, 250, 0], [720, 780, 840, 900], 720, 720],
]) {
  test(`independent Fraction checkpoints: ${name}`, () => {
    let state = raidAt === undefined ? fresh(initial) : materialized(initial);
    let previous = 0;
    const trace = [], rows = [];
    for (const at of checkpointTimes) {
      const events = [];
      if (raidAt !== undefined && raidAt > previous && raidAt <= at)
        events.push({ kind: 'attack', id: 1, key: keys[0], remaining: raidAt - previous });
      if (scoutAt !== undefined && scoutAt > previous && scoutAt <= at)
        events.push({ kind: 'scout', id: 2, key: keys[0], remaining: scoutAt - previous });
      const result = driver(state, at - previous, Infinity, events);
      trace.push(...result.trace.map(item => ({ ...item, at: previous + item.at })));
      state = result.state;
      rows.push({ at, ...view(state) });
      previous = at;
    }
    assert.deepEqual(rows, golden.scenarios[name].map(({ at, stock, phase, spent }) => ({ at, stock, phase, spent })));
    const siteOrBaseline = raidAt === undefined ? 'baseline' : keys[0];
    const payments = trace.filter(item => item.kind === 'pay' && item.key === siteOrBaseline);
    assert.deepEqual(payments.map(item => item.at), golden.purchaseTimes[name]);
    assert.ok(payments.every(item => JSON.stringify(item.paid) === '[2000,1000,0]'));
    if (raidAt !== undefined) assert.deepEqual(read(state).garrison, zeroGarrison);
    if (scoutAt !== undefined) assert.deepEqual(trace.find(item => item.kind === 'scout').stock, [2100, 1050, 720]);
  });
}

test('one exact debit, cost-zero deuterium preserved, no retroactive completed rate', () => {
  const before = fresh([3700, 1850, 0.5]);
  const start = outcome(pure(advance, before, 60));
  assert.deepEqual(view(start.state), { stock: [2000, 1000, 60.5], phase: 'building-2', spent: [2000, 1000, 0] });
  assert.deepEqual(view(outcome(advance(start.state, 120)).state),
    { stock: [2600, 1300, 180.5], phase: 'complete', spent: [2000, 1000, 0] });
  const ended = outcome(advance(start.state, 240));
  assert.equal(ended.value.trace.filter(item => item.kind === 'pay').length, 0);
  assert.deepEqual(view(ended.state).stock, [3320, 1600, 300.5]);
  [4000, 2000, 60.5].forEach((amount, i) => assert.equal(view(start.state).stock[i] + [2000, 1000, 0][i], amount));
});

test('failed affordability leaves the saving stock anchor and phase untouched', () => {
  const state = fresh();
  const next = outcome(pure(advance, state, 60));
  assert.deepEqual(next.state.baseline, state.baseline);
  assert.equal(next.state.now, 60);
  assert.equal(next.state.growthPassRemaining, 60);
  assert.equal(next.value.passes, 1);
  assert.equal(next.value.actorVisits, 1);
  assert.deepEqual(view(next.state).stock, [800, 400, 60]);
});

test('unseen baseline develops; late materialization inherits paid phase without replay', () => {
  const advanced = outcome(advance(fresh(), 900));
  let state = advanced.state;
  assert.equal(Object.keys(state.sites).length, 0);
  assert.equal(advanced.value.trace.filter(item => item.kind === 'pay').length, 1);
  const observed = read(state, keys[1]);
  for (let i = 0; i < 100; i++) assert.deepEqual(pure(inspect, state, keys[1]).value, observed);
  state = outcome(pure(materialize, state, keys[1])).state;
  assert.deepEqual(read(state, keys[1]), observed);
  const after = outcome(advance(state, 60));
  assert.equal(after.value.trace.filter(item => item.kind === 'pay').length, 0);
  assert.deepEqual(view(after.state, keys[1]), view(after.state, keys[2]));
  assert.deepEqual(view(after.state, keys[1]).stock, golden.scenarios.lateMaterialization[1].stock);
});

test('materializing a second untouched coordinate does not inherit a raided purse', () => {
  let state = materialized();
  state = outcome(advance(state, 660)).state;
  state = outcome(debit(state, keys[0], read(state).stock.map(n => Math.floor(n / 2)), zeroGarrison)).state;
  const saved = clone(read(state));
  state = outcome(materialize(state, keys[1])).state;
  assert.deepEqual(read(state), saved);
  assert.deepEqual(view(state, keys[1]), view(state, keys[2]));
  assert.notDeepEqual(view(state), view(state, keys[1]));
});

test('true exact-zero endpoint orders growth then scouts by ID then attacks by ID', () => {
  const state = materialized();
  const events = [
    { kind: 'attack', id: 14, key: keys[0], remaining: 720 },
    { kind: 'scout', id: 19, key: keys[0], remaining: 720 },
    { kind: 'attack', id: 5, key: keys[0], remaining: 720 },
    { kind: 'scout', id: 3, key: keys[0], remaining: 720 },
  ];
  const run = driver(state, 720, Infinity, events);
  const due = run.trace.filter(event => ['scout', 'attack'].includes(event.kind));
  assert.deepEqual(due.map(({ kind, id }) => [kind, id]), [['scout', 3], ['scout', 19], ['attack', 5], ['attack', 14]]);
  assert.deepEqual(due.slice(0, 2).map(event => event.stock), [[2100, 1050, 720], [2100, 1050, 720]]);
  assert.deepEqual(view(run.state).stock, golden.orderingProbe.finalState.stock);
  assert.deepEqual(run.observations[0], run.observations[1]);
  assert.equal(run.observations[0].phase, 'building-2');
});

for (const name of ['eventBoundary', 'integer', 'tenth']) {
  test(`independent actual binary64 schedule: ${name}`, () => {
    const expected = golden.binary64Schedules[name];
    const maxStep = expected.maxStep === 'Infinity' ? Infinity : expected.maxStep;
    const initial = materialized();
    const run = driver(initial, 900, maxStep, flights());
    assert.deepEqual(view(run.state), (({ stock, phase, spent }) => ({ stock, phase, spent }))(expected.actors[1]));
    assert.deepEqual(view(run.state, keys[1]), (({ stock, phase, spent }) => ({ stock, phase, spent }))(expected.actors[0]));
    assert.equal(run.total, expected.total);
    assert.equal(run.steps, expected.stepCount);
    assert.equal(run.passes, expected.passCount);
    assert.equal(run.state.growthPassRemaining, expected.growthRemaining);
    assert.deepEqual(eventsOnly(run), expected.trace.filter(event => ['scout', 'attack'].includes(event.kind)));
    const perturbed = driver(initial, 900, maxStep, flights(), true);
    assert.deepEqual(perturbed, run, 'same actual schedule with arbitrary reads/JSON reloads is identical');
  });
}

test('original universal binary64 partition-equivalence assertion remains an explicit counterexample', () => {
  assert.equal(golden.originalPartitionEqualityFailure.status, 'FAILED, preserved');
  const initial = materialized();
  const whole = driver(initial, 900, Infinity, flights());
  const tenth = driver(initial, 900, 0.1, flights());
  assert.equal(view(whole.state).phase, 'complete');
  assert.equal(view(tenth.state).phase, 'saving');
  assert.notDeepEqual(view(tenth.state), view(whole.state));
  assert.equal(tenth.trace.find(item => item.kind === 'attack').at, 720);
  assert.equal(tenth.trace.find(item => item.kind === 'growth' && item.pass === 12).at, 720.0000000000881);
});

for (const name of ['before', 'equal', 'after']) {
  test(`actual representable fleet deadline ${name} growth endpoint`, () => {
    const expected = golden.binary64Neighbors[name];
    const initial = materialized([4000, 2000, 0]);
    const run = driver(initial, 61, Infinity, flights(expected.flightRemainingInitially));
    assert.deepEqual(view(run.state), (({ stock, phase, spent }) => ({ stock, phase, spent }))(expected.actors[1]));
    assert.deepEqual(eventsOnly(run), expected.trace.filter(event => ['scout', 'attack'].includes(event.kind)));
    assert.deepEqual(driver(initial, 61, Infinity, flights(expected.flightRemainingInitially), true), run);
  });
}

test('known adopted-endpoint relocation counterexample is retained without rounding', () => {
  const results = [];
  for (const segments of [[0.1, 0.1], [0.2]]) {
    let state = fresh([0, 0, 1.799999999999636]);
    state.now = state.baseline.mark = 11999.9;
    outcome(validateState(state));
    for (const step of segments) state = outcome(pure(advance, state, step)).state;
    results.push(view(state).stock);
  }
  const counter = golden.binary64AuthorityCounterexample;
  assert.deepEqual(results[0], counter.smallSegments.finalProjectedStock);
  assert.deepEqual(results[1], counter.largeSegment.finalProjectedStock);
  assert.deepEqual(results.map(stock => Math.floor(stock[2] / 2)), [0, 1]);
});

test('zero adoption, reads and JSON reload cannot consume any growth or offline time', () => {
  let state = fresh([4000, 2000, 0]);
  state.growthPassRemaining = Number.MIN_VALUE;
  const frozen = JSON.stringify(state);
  const noTime = outcome(pure(advance, state, 0));
  assert.equal(noTime.state, state);
  assert.deepEqual(noTime.value, { passes: 0, actorVisits: 0, trace: [] });
  for (let i = 0; i < 20; i++) { read(state); state = roundtrip(state); }
  assert.equal(JSON.stringify(state), frozen);
  assert.equal(view(state).phase, 'saving');
  // Once-only offline catch-up receipts belong to the absent host integration;
  // this test establishes only that the pure read/adoption API invents no time.
});

test('host fixture refuses negative/zero external countdowns and retains positive subnormal', () => {
  const state = materialized([4000, 2000, 0]);
  const before = JSON.stringify(state);
  for (const remaining of [-Number.MIN_VALUE, -1, 0, -0, NaN, Infinity]) {
    assert.throws(() => driver(state, 1, Infinity, [{ kind: 'scout', id: 1, key: keys[0], remaining }]), RangeError);
  }
  const pending = driver(state, 0, Infinity, [{ kind: 'scout', id: 1, key: keys[0], remaining: Number.MIN_VALUE }]);
  assert.equal(pending.queue[0].remaining, Number.MIN_VALUE);
  assert.equal(pending.trace.length, 0);
  assert.equal(JSON.stringify(state), before);
});

test('512 permanent damaged sites survive bounded eight-hour advance; 513th refusal is atomic', () => {
  let state = fresh();
  for (const key of keys.slice(0, 512)) {
    state = outcome(materialize(state, key)).state;
    state = outcome(debit(state, key, [1, 1, 0], zeroGarrison)).state;
  }
  assert.equal(Object.keys(state.sites).length, 512);
  const refused = refusal(materialize, state, keys[512]);
  assert.equal(refused.state, state);
  const again = outcome(pure(materialize, state, keys[0]));
  assert.equal(again.value.created, false);
  assert.deepEqual(again.state, state);
  const started = performance.now();
  const advanced = outcome(pure(advance, state, 28800));
  const elapsedMs = performance.now() - started;
  assert.equal(advanced.value.passes, 480);
  assert.equal(advanced.value.actorVisits, 246240);
  assert.equal(Object.keys(advanced.state.sites).length, 512);
  assert.equal(advanced.value.trace.filter(item => item.kind === 'pay').length, 513);
  assert.deepEqual(view(advanced.state).stock, [50000, 30000, 10000]);
  for (const key of keys.slice(0, 512)) {
    assert.deepEqual(read(advanced.state, key).garrison, zeroGarrison);
    assert.equal(read(advanced.state, key).phase, 'complete');
  }
  refusal(materialize, advanced.state, keys[512]);
  console.log(JSON.stringify({ measurement: 'pure preparation eight-hour advance', elapsedMs,
    passes: advanced.value.passes, actorVisits: advanced.value.actorVisits,
    note: 'Loop assertions are not independent test cases; wall time is observational, not a CI threshold.' }));
});

test('deeply frozen inputs work and detached observations cannot change state', () => {
  const state = freeze(materialized());
  const before = JSON.stringify(state);
  const observed = outcome(pure(inspect, state, keys[0])).value;
  observed.stock[0] = 0;
  observed.garrison.light_fighter = 0;
  observed.spent[0] = 0;
  observed.rates[0] = 999;
  assert.equal(JSON.stringify(state), before);
  outcome(pure(validateState, state));
  outcome(pure(materialize, state, keys[1]));
  outcome(pure(advance, state, 60));
  outcome(pure(debit, state, keys[0], [1, 1, 0], zeroGarrison));
});

test('finite duration and constructor budgets refuse malformed input without partial state', () => {
  const state = fresh();
  for (const seconds of [-1, -Number.MIN_VALUE, NaN, Infinity, -Infinity, '60', null, {}, 28800.000001])
    refusal(advance, state, seconds);
  for (const options of [null, [], 1, 'x', { unknown: true }, { seed: -1 }, { seed: 2 ** 32 },
    { seed: 0.5 }, { stock: [-1, 0, 0] }, { stock: [50001, 0, 0] }, { stock: [0, 0] },
    { stock: [0, NaN, 0] }, { stock: [0, Infinity, 0] }, { stock: ['0', 0, 0] }]) {
    const result = createState(options);
    assert.equal(result.ok, false, `constructor should reject ${JSON.stringify(options)}`);
    assert.equal(result.state, null);
  }
});

test('strict state shape, phase, clock, inventory and site budgets refuse atomically', () => {
  const mutations = [
    state => { state.extra = true; },
    state => { state.model = 'other'; },
    state => { state.seed = -1; },
    state => { state.now = Infinity; },
    state => { state.now = -1; },
    state => { state.now = 12000; },
    state => { state.growthPassRemaining = 0; },
    state => { state.growthPassRemaining = -Number.MIN_VALUE; },
    state => { state.growthPassRemaining = 60.00000000001; },
    state => { state.baseline.extra = true; },
    state => { state.baseline.mark = 1; },
    state => { state.baseline.mark = -1; },
    state => { state.baseline.phase = 'building-3'; },
    state => { state.baseline.stock = [0, 0, 10001]; },
    state => { state.baseline.stock = [0, 0, 0, 0]; },
    state => { state.sites[keys[0]].garrison.extra = 0; },
    state => { state.sites[keys[0]].garrison.light_fighter = 999999; },
    state => { state.sites[keys[0]].garrison.heavy_fighter = 0.5; },
    state => { state.sites[fixture.home.join(':')] = clone(state.sites[keys[0]]); },
    state => { state.sites['01:1:1'] = clone(state.sites[keys[0]]); },
    state => { state.sites = JSON.parse('{"__proto__":{}}'); },
    state => { for (const row of fixture.coordinates) state.sites[row.key] =
      { stock: [500, 250, 0], mark: 0, phase: 'saving', garrison: clone(row.garrison) }; },
  ];
  for (const mutate of mutations) {
    const invalid = materialized();
    mutate(invalid);
    refusal(validateState, invalid);
    refusal(advance, invalid, 60);
    refusal(materialize, invalid, keys[1]);
    refusal(inspect, invalid, keys[0]);
    refusal(debit, invalid, keys[0], [0, 0, 0]);
  }
});

test('raid debit uses represented conservation and cannot increase or respawn garrison', () => {
  let state = materialized([501, 251.5, 1]);
  const changed = outcome(pure(debit, state, keys[0], [250, 125, 0], zeroGarrison));
  assert.deepEqual(changed.value.before, [501, 251.5, 1]);
  assert.deepEqual(changed.value.after, [251, 126.5, 1]);
  changed.value.after.forEach((amount, i) => assert.equal(amount + changed.value.paid[i], changed.value.before[i]));
  state = changed.state;
  refusal(debit, state, keys[0], [0, 0, 0], fixture.coordinates[0].garrison);
  for (const paid of [[-1, 0, 0], [0.5, 0, 0], [126, 0, 0], [0, 64, 0], [0, 0, 1],
    [NaN, 0, 0], [Infinity, 0, 0], [0, 0], [0, 0, 0, 0]])
    refusal(debit, state, keys[0], paid);
  refusal(debit, state, keys[1], [0, 0, 0]);
  state = outcome(advance(state, 28800)).state;
  assert.deepEqual(read(state).garrison, zeroGarrison);
  const repeat = outcome(materialize(state, keys[0]));
  assert.equal(repeat.value.created, false);
  assert.deepEqual(read(repeat.state).garrison, zeroGarrison);
});

test('model and frozen rules are explicit and baseline/site stock do not alias', () => {
  assert.equal(MODEL, 'npc-civilian-growth-preparation-v1');
  const state = materialized();
  assert.notEqual(state.baseline.stock, state.sites[keys[0]].stock);
  const untouched = view(state, keys[1]);
  state.sites[keys[0]].stock[0] = 0;
  assert.deepEqual(view(state, keys[1]), untouched);
});

test('accessors, sparse/decorated arrays, symbols and exotic prototypes are rejected without invoking getters', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('must never invoke input getter'); };
  const options = {};
  Object.defineProperty(options, 'stock', { get: getter, enumerable: true });
  assert.equal(createState(options).ok, false);
  for (const mutate of [
    state => Object.defineProperty(state.baseline, 'stock', { get: getter, enumerable: true }),
    state => Object.defineProperty(state.sites, keys[0], { get: getter, enumerable: true }),
    state => Object.defineProperty(state.baseline.stock, '0', { get: getter, enumerable: true }),
    state => { delete state.baseline.stock[1]; },
    state => { state.baseline.stock.extra = 1; },
    state => { state.baseline.stock[Symbol('extra')] = 1; },
    state => { state[Symbol('extra')] = 1; },
    state => { Object.setPrototypeOf(state.baseline, { unexpected: true }); },
  ]) {
    const invalid = materialized();
    mutate(invalid);
    // Do not JSON-stringify accessor fixtures: that would itself invoke a getter.
    const result = validateState(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.state, invalid);
  }
  assert.equal(calls, 0);
});

test('short positive initial countdown has bounded 481-pass eight-hour work', () => {
  const state = fresh([4000, 2000, 0]);
  state.growthPassRemaining = Number.MIN_VALUE;
  const advanced = outcome(pure(advance, state, 28800));
  assert.equal(advanced.value.passes, 481);
  assert.equal(advanced.value.actorVisits, 481);
  assert.equal(advanced.value.trace.filter(item => item.kind === 'pay').length, 1);
  assert.equal(advanced.value.trace.filter(item => item.kind === 'complete').length, 1);
  assert.deepEqual(view(advanced.state).stock, [50000, 30000, 10000]);
});
