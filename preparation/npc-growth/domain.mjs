// Dormant pure experiment. No runtime imports, storage, fleet dispatch, or game migration.
export const MODEL = 'npc-civilian-growth-preparation-v1';
const CAPS = [50000, 30000, 10000], COST = [2000, 1000, 0];
const PERIOD = 60, HORIZON = 12000, MAX_SECONDS = 28800, SITE_LIMIT = 512;
const PHASES = ['saving', 'building-2', 'building-1', 'complete'];
const GARRISON_KEYS = ['light_fighter', 'heavy_fighter'];

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireThat(condition, message, code = 'INVALID_INPUT') {
  if (!condition) throw new Refusal(code, message);
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function fields(value, names) {
  return plain(value) && Reflect.ownKeys(value).length === names.length && names.every(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && 'value' in descriptor && descriptor.enumerable;
  });
}
function tuple(value, predicate) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== 3 || Reflect.ownKeys(value).length !== 4) return false;
  return [0, 1, 2].every(i => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    return descriptor && 'value' in descriptor && descriptor.enumerable && predicate(descriptor.value, i);
  });
}
const finite = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const stockTuple = stock => tuple(stock, (n, i) => finite(n, 0, CAPS[i]));
const validSeed = seed => Number.isInteger(seed) && finite(seed, 0, 0xffffffff);

// Frozen fixture identity copied from galaxy.ts/npc-garrison.ts at base 576e929.
// The fixture has only its deterministic home; real player-colony membership is not modeled.
function coordinate(key) {
  requireThat(typeof key === 'string' && key.length <= 8 && /^[1-5]:([1-9]|[1-9][0-9]|100):([1-9]|1[0-5])$/.test(key), 'Invalid canonical coordinate key');
  return key.split(':').map(Number);
}
function random(seed, [galaxy, system, position], salt = 0) {
  let x = (seed ^ Math.imul(galaxy, 73856093) ^ Math.imul(system, 19349663)
    ^ Math.imul(position, 83492791) ^ Math.imul(salt, 2654435761)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function target(seed, key) {
  const c = coordinate(key), homeSeed = [1, 50, 8];
  const home = `1:${40 + Math.floor(random(seed, homeSeed, 20) * 21)}:${4 + Math.floor(random(seed, homeSeed, 21) * 9)}`;
  requireThat(key !== home && random(seed, c) < 0.25, 'Target is not a fixture NPC');
  return random(seed, c, 101) < 0.75
    ? { light_fighter: 4, heavy_fighter: 0 } : { light_fighter: 8, heavy_fighter: 1 };
}
function validGarrison(value, ceiling) {
  return fields(value, GARRISON_KEYS) && GARRISON_KEYS.every(k => Number.isSafeInteger(value[k]) && finite(value[k], 0, ceiling[k]));
}
function validActor(value, now, site = false) {
  return fields(value, site ? ['stock', 'mark', 'phase', 'garrison'] : ['stock', 'mark', 'phase'])
    && stockTuple(value.stock) && finite(value.mark, 0, now) && PHASES.includes(value.phase);
}
function assertState(state) {
  requireThat(fields(state, ['model', 'seed', 'now', 'growthPassRemaining', 'baseline', 'sites'])
    && state.model === MODEL && validSeed(state.seed) && finite(state.now, 0, HORIZON) && state.now < HORIZON
    && finite(state.growthPassRemaining, 0, PERIOD) && state.growthPassRemaining > 0
    && validActor(state.baseline, state.now) && plain(state.sites), 'Invalid growth state header');
  const keys = Reflect.ownKeys(state.sites);
  requireThat(keys.length <= SITE_LIMIT, 'Too many permanent sites');
  for (const key of keys) {
    const initial = target(state.seed, key), descriptor = Object.getOwnPropertyDescriptor(state.sites, key);
    requireThat(descriptor && 'value' in descriptor && descriptor.enumerable
      && validActor(descriptor.value, state.now, true) && validGarrison(descriptor.value.garrison, initial), 'Invalid permanent site');
  }
}
function success(state, value) { return { ok: true, state, value }; }
function checked(state, operation, validate = true) {
  try {
    if (validate) assertState(state);
    return operation();
  } catch (error) {
    return { ok: false, state, error: { code: error instanceof Refusal ? error.code : 'INVALID_INPUT',
      message: error instanceof Error ? error.message : 'Invalid input' } };
  }
}
const copyActor = actor => ({ stock: [...actor.stock], mark: actor.mark, phase: actor.phase,
  ...('garrison' in actor ? { garrison: { ...actor.garrison } } : {}) });
function copyState(state) {
  return { ...state, baseline: copyActor(state.baseline),
    sites: Object.fromEntries(Object.entries(state.sites).map(([key, actor]) => [key, copyActor(actor)])) };
}
const rates = actor => actor.phase === 'complete' ? [6, 2.5, 1] : [5, 2.5, 1];
function project(state, actor) {
  const elapsed = state.now - actor.mark, production = rates(actor);
  return actor.stock.map((n, i) => Math.min(CAPS[i], n + production[i] * elapsed));
}

/** A fresh fixture, not an import/migration or a grant to a player. */
export function createState(options = {}) {
  return checked(null, () => {
    requireThat(plain(options) && Reflect.ownKeys(options).every(k => ['seed', 'stock'].includes(k)
      && Object.getOwnPropertyDescriptor(options, k)?.enumerable
      && 'value' in Object.getOwnPropertyDescriptor(options, k)), 'Invalid creation options');
    const seed = Object.hasOwn(options, 'seed') ? options.seed : 20261010;
    const stock = Object.hasOwn(options, 'stock') ? options.stock : [500, 250, 0];
    requireThat(validSeed(seed) && stockTuple(stock), 'Invalid seed or initial stock');
    return success({ model: MODEL, seed, now: 0, growthPassRemaining: PERIOD,
      baseline: { stock: [...stock], mark: 0, phase: 'saving' }, sites: {} }, null);
  }, false);
}

/** Strict pure validation; it does not normalize, repair, freeze, or advance input. */
export function validateState(state) { return checked(state, () => success(state, true)); }

/** Pure observation; it never materializes a coordinate or changes an anchor. */
export function inspect(state, key) {
  return checked(state, () => {
    const initial = target(state.seed, key), actor = state.sites[key] ?? state.baseline;
    return success(state, { key, stock: project(state, actor), phase: actor.phase,
      spent: actor.phase === 'saving' ? [0, 0, 0] : [...COST], rates: rates(actor),
      garrison: { ...(state.sites[key]?.garrison ?? initial) } });
  });
}

/** Preparation candidate only. Production would need a separately authorized paid launch. */
export function materialize(state, key) {
  return checked(state, () => {
    const initial = target(state.seed, key);
    if (Object.hasOwn(state.sites, key)) return success(state, { created: false });
    requireThat(Object.keys(state.sites).length < SITE_LIMIT, 'Permanent site capacity reached', 'SITE_CAPACITY');
    const next = copyState(state);
    next.sites[key] = { stock: project(state, state.baseline), mark: state.now,
      phase: state.baseline.phase, garrison: initial };
    return success(next, { created: true });
  });
}

function produce(state, seconds) {
  state.now += seconds;
  if (state.now >= HORIZON) {
    // End of this actual segment only. No special split at HORIZON, no read relocation.
    for (const actor of [state.baseline, ...Object.values(state.sites)]) {
      actor.stock = project(state, actor); actor.mark = 0;
    }
    state.now = 0;
  }
}
function visit(state, actor, key, at, trace) {
  if (actor.phase === 'complete') return;
  if (actor.phase === 'building-2') { actor.phase = 'building-1'; return; }
  if (actor.phase === 'building-1') {
    actor.stock = project(state, actor); actor.mark = state.now; actor.phase = 'complete';
    trace.push({ kind: 'complete', key, at, stock: [...actor.stock], paid: [0, 0, 0] });
    return;
  }
  const before = project(state, actor);
  if (before[0] < 4000 || before[1] < 2000) return;
  const after = before.map((n, i) => n - COST[i]);
  requireThat(after.every((n, i) => n >= 0 && n + COST[i] === before[i]), 'Investment debit is not represented exactly', 'INEXACT_DEBIT');
  actor.stock = after; actor.mark = state.now; actor.phase = 'building-2';
  trace.push({ kind: 'pay', key, at, stock: [...after], paid: [...COST] });
}

/**
 * Adopt a caller-authorized Number duration, bounded to eight hours. Splits only
 * at the actual persisted growth countdown. Caller must stop at other events.
 * No clock, offline receipt, totalTime, EPS, or wall-time authority is invented.
 */
export function advance(state, seconds) {
  return checked(state, () => {
    requireThat(finite(seconds, 0, MAX_SECONDS), 'Adopted duration must be finite and within 0..28800');
    const value = { passes: 0, actorVisits: 0, trace: [] };
    if (seconds === 0) return success(state, value);
    const next = copyState(state);
    let remaining = seconds, adopted = 0, segments = 0;
    while (remaining > 0) {
      requireThat(++segments <= 482, 'Adopted step budget exceeded', 'STEP_BUDGET');
      const step = Math.min(remaining, next.growthPassRemaining);
      requireThat(step > 0, 'Nonpositive adopted step', 'STEP_BUDGET');
      produce(next, step);
      next.growthPassRemaining -= step;
      remaining -= step; adopted += step;
      if (next.growthPassRemaining === 0) {
        visit(next, next.baseline, 'baseline', adopted, value.trace);
        for (const [key, actor] of Object.entries(next.sites)) visit(next, actor, key, adopted, value.trace);
        value.passes++; value.actorVisits += 1 + Object.keys(next.sites).length;
        next.growthPassRemaining = PERIOD;
      }
    }
    assertState(next);
    return success(next, value);
  });
}

/** Synthetic, explicit bounded integer withdrawal; no combat/RNG/fleets/rewards. */
export function debit(state, key, paid, garrison) {
  return checked(state, () => {
    target(state.seed, key);
    requireThat(Object.hasOwn(state.sites, key), 'Debit requires an existing permanent site', 'SITE_REQUIRED');
    const actor = state.sites[key], before = project(state, actor);
    requireThat(tuple(paid, (n, i) => Number.isSafeInteger(n) && finite(n, 0, Math.floor(before[i] / 2))), 'Debit exceeds represented half-stock integer eligibility');
    const survivors = garrison === undefined ? actor.garrison : garrison;
    requireThat(validGarrison(survivors, actor.garrison), 'Garrison survivors cannot increase');
    const after = before.map((n, i) => n - paid[i]);
    requireThat(after.every((n, i) => n + paid[i] === before[i]), 'Debit is not represented exactly', 'INEXACT_DEBIT');
    const next = copyState(state), site = next.sites[key];
    if (paid.some(n => n > 0)) { site.stock = after; site.mark = next.now; }
    site.garrison = { ...survivors };
    return success(next, { before, paid: [...paid], after: [...after] });
  });
}
