/** Read-only test observer for a fixed historical engine's actually adopted steps.
 * No source rewrite, candidate state, wall-clock substitution or balance fitting.
 * The original engine also runs without this observer; full serialized parity is mandatory.
 */
import assert from 'node:assert/strict';

export function captureAdoptedSteps(state, advance, serialize) {
  assert.ok(state && state.totalTime && typeof state.totalTime.add === 'function');
  const steps = [], tracked = new WeakSet();
  function wrap(decimal) {
    const proxy = new Proxy(decimal, {
      get(target, key, receiver) {
        if (key === 'add') return step => {
          assert.ok(typeof step === 'number' && Number.isFinite(step) && step >= 0,
            'Pinned engine totalTime.add must receive an actual nonnegative finite numeric segment');
          steps.push(step);
          return wrap(target.add(step));
        };
        return Reflect.get(target, key, receiver);
      },
    });
    tracked.add(proxy);
    return proxy;
  }
  const before = serialize(state);
  const plain = advance(state);
  assert.deepEqual(serialize(state), before, 'Unobserved historical execution must not mutate its input');
  const observedInput = { ...state, totalTime: wrap(state.totalTime) };
  const observed = advance(observedInput);
  assert.ok(tracked.has(observed.state.totalTime), 'Historical time carrier must remain observed through completion');
  assert.deepEqual(serialize(observed.state), serialize(plain.state),
    'Observer cannot change any historical serialized state field');
  for (const field of ['appliedSeconds', 'rawSeconds', 'capSeconds', 'capped']) {
    assert.equal(observed[field], plain[field], `Observer preserves ${field}`);
  }
  assert.deepEqual(serialize(state), before, 'Observed historical execution must not mutate its input');
  return { result: plain, adoptedSegmentsSeconds: steps,
    npcElapsedSeconds: steps.reduce((age, step) => Math.min(11900, age + step), 0),
    observation: 'old-totalTime-add; full unobserved old-state equivalence verified' };
}
