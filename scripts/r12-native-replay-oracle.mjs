/** Test-only, fixed-ca5 replay of an observed application RAF/save/reload trace.
 * Candidate states and raw saves are assertions only. Economic inputs are the
 * untouched historical bytes, actual constructor clocks and actual RAF now/gap.
 * No current game module is imported, no clock is fitted, and no totalTime delta
 * or candidate NPC field supplies the independently folded NPC age.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPinnedSource, dependencyIdentity, DEPENDENCIES, SOURCE_SHA } from './r11-startup-oracle.mjs';
import { captureAdoptedSteps } from './capture-adopted-steps.mjs';

export { DEPENDENCIES, SOURCE_SHA };
export const TRACE_SCHEMA = 'infinity-native-frame-replay-input-v1';
const RESULT_SCHEMA = 'infinity-fixed-r11-native-replay-oracle-v1';
const RUNNER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CAP = 11900;
const digest = text => createHash('sha256').update(text).digest('hex');
const copy = value => structuredClone(value);
const fold = (age, steps) => steps.reduce((value, step) => Math.min(CAP, value + step), age);

function object(value, where) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${where}: object required`);
}
function keys(value, required, optional, where) {
  object(value, where);
  for (const key of required) assert.ok(Object.hasOwn(value, key), `${where}: missing ${key}`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) assert.ok(allowed.has(key), `${where}: unexpected ${key}`);
}
function milliseconds(value, where) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    `${where}: finite nonnegative safe milliseconds required (fractions are preserved)`);
}
function currentState(oldState, age) {
  assert.equal(Object.hasOwn(oldState, 'npcEconomy'), false, 'ca5 state must not contain current NPC data');
  return { npcEconomy: { model: 'fixed-production-v1', elapsedSeconds: age }, ...oldState };
}
function currentEnvelope(oldEnvelope, age) {
  return { ...oldEnvelope, revision: 12, state: currentState(oldEnvelope.state, age) };
}
function assertState(actual, oldState, age, where) {
  assert.deepEqual(actual, currentState(oldState, age), `${where}: complete current state equals independent ca5 state plus independently folded NPC age`);
}
function parsedRaw(raw, where) {
  assert.equal(typeof raw, 'string', `${where}: exact raw bytes required`);
  const parsed = JSON.parse(raw);
  object(parsed, where);
  return parsed;
}

/**
 * Input epochs contain constructorNow, the original paired startupClock,
 * sourceRaw, ready {mode,lastTickAt,state}, events, and migrationRaw only for the
 * first historical migration. Events are frame/frame-end/save-input/save/action.
 * Observed state/raw fields must be complete, never pre-projected or normalized.
 * Native provenance is supplied by the separate capture, not asserted by this
 * mathematical replay. Synthetic tests use exactly the same verification path.
 */
export async function replayNativeTrace(root, input) {
  assert.equal(arguments.length, 2, 'only pinned source root and complete trace input are accepted');
  keys(input, ['schema', 'originalRaw', 'epochs'], [], 'trace');
  assert.equal(input.schema, TRACE_SCHEMA, 'explicit replay trace schema required');
  assert.ok(Array.isArray(input.epochs) && input.epochs.length > 0, 'at least one complete epoch required');
  const original = parsedRaw(input.originalRaw, 'originalRaw');
  assert.ok(Number.isInteger(original.revision) && original.revision >= 2 && original.revision <= 11,
    'untouched genuine historical r2-r11 input required; current candidates cannot seed this oracle');
  root = assertPinnedSource(root);
  const dependencies = dependencyIdentity(root);
  assert.deepEqual(dependencies, DEPENDENCIES, 'old resolved numerical dependency bytes match fixed oracle');
  assert.deepEqual(dependencyIdentity(RUNNER_ROOT), dependencies, 'runner numerical dependency bytes equal fixed old dependencies');
  const [save, offline, logic, content] = await Promise.all([
    'src/game/save.ts', 'src/core/offline.ts', 'src/game/logic.ts', 'src/game/content.ts',
  ].map(path => import(pathToFileURL(resolve(root, path)).href)));
  assert.equal(content.SAVE_REVISION, 11);
  assert.equal(content.SAVE_VERSION, 9);
  assert.deepEqual(content.SUPPORTED_SAVE_REVISIONS, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  let state, age = 0, observedRaw = input.originalRaw, independentSavedEnvelope = null, independentSavedAge = null;
  const epochs = [], adoptions = [], saves = [];
  function adopt(kind, gapSeconds, epochIndex, eventIndex) {
    const beforeAge = age;
    const adopted = captureAdoptedSteps(state, before => kind === 'tick'
      ? { state: logic.tick(before, gapSeconds) } : offline.catchUp(before, gapSeconds), save.serializeState);
    state = adopted.result.state;
    age = fold(age, adopted.adoptedSegmentsSeconds);
    const entry = { epochIndex, eventIndex, kind, gapSeconds, ageBefore: beforeAge,
      adoptedSegmentsSeconds: adopted.adoptedSegmentsSeconds, npcElapsedSeconds: age,
      oldObservedAndUnobservedStateEqual: true, adoptedTimeObservation: adopted.observation };
    if (kind === 'catchUp') for (const key of ['rawSeconds', 'appliedSeconds', 'capSeconds', 'capped']) entry[key] = adopted.result[key];
    adoptions.push(entry);
    return entry;
  }
  function checkSave(raw, savedAt, lastTickAt, where, epochIndex, eventIndex, reason) {
    milliseconds(savedAt, `${where}.savedAt`);
    milliseconds(lastTickAt, `${where}.lastTickAt`);
    const expectedOld = JSON.parse(save.exportSave(state, savedAt, lastTickAt));
    const actual = parsedRaw(raw, where), expected = currentEnvelope(expectedOld, age);
    assert.deepEqual(actual, expected, `${where}: complete saved envelope/state equals independent expected save`);
    // Runtime r12 exportSave uses the same envelope/order as ca5, prepends the
    // NPC field to serializeState, and emits JSON.stringify(file, null, 2).
    // Exact bytes are required for these observed runtime writes. This does not
    // canonicalize or constrain the historical source bytes/backup in any way.
    assert.equal(raw, JSON.stringify(expected, null, 2), `${where}: exact canonical runtime save bytes required`);
    // This projection is checked, never adopted as economic input. Only these
    // two schema changes are allowed; timestamps and all old fields stay exact.
    const { npcEconomy: ignored, ...projectedState } = actual.state;
    assert.deepEqual({ ...actual, revision: 11, state: projectedState }, expectedOld,
      `${where}: strict synthetic r11 compatibility bridge removes only NPC and changes only revision`);
    observedRaw = raw;
    independentSavedEnvelope = expectedOld;
    independentSavedAge = age;
    const entry = { epochIndex, eventIndex, reason, savedAt, lastTickAt, rawSha256: digest(raw),
      npcElapsedSeconds: age, expectedEnvelope: expected,
      compatibilityBridge: 'synthetic r11 envelope from independent expected state; not a historical source save' };
    saves.push(entry);
    return entry;
  }

  for (const [epochIndex, epoch] of input.epochs.entries()) {
    const where = `epoch[${epochIndex}]`;
    keys(epoch, ['constructorNow', 'startupClock', 'sourceRaw', 'ready', 'events'], ['migrationRaw'], where);
    milliseconds(epoch.constructorNow, `${where}.constructorNow`);
    keys(epoch.startupClock, ['wallAt', 'frameAt'], [], `${where}.startupClock`);
    milliseconds(epoch.startupClock.wallAt, `${where}.wallAt`);
    milliseconds(epoch.startupClock.frameAt, `${where}.frameAt`);
    assert.equal(epoch.constructorNow, epoch.startupClock.wallAt, `${where}: actual constructor uses the original paired wall sample`);
    assert.equal(epoch.sourceRaw, observedRaw, `${where}: constructor reads exact bytes of the preceding verified persisted save`);
    if (epochIndex > 0) {
      assert.ok(independentSavedEnvelope, `${where}: preceding verified save required`);
      // The durable age travels atomically with the durable old state. Frames
      // after the last successful write cannot leak their unsaved age through a
      // reload, even if the capture observes them before the old context dies.
      age = independentSavedAge;
    }
    // First import alone performs the genuine legacy lift. Every later import
    // uses an independently produced r11 save; re-lifting r9 would erase or
    // rebase real terraformer grants and paid-job boundaries after completion.
    const independentReaderRaw = epochIndex === 0 ? input.originalRaw : JSON.stringify(independentSavedEnvelope);
    const read = save.importSave(independentReaderRaw);
    state = save.deserializeState(read.state);
    const startup = adopt('catchUp', (epoch.constructorNow - read.lastTickAt) / 1000, epochIndex, -1);
    let accountedFrameAt = epoch.startupClock.frameAt;
    const lastTickAt = () => epoch.startupClock.wallAt + (accountedFrameAt - epoch.startupClock.frameAt);
    if (epochIndex === 0) {
      assert.ok(Object.hasOwn(epoch, 'migrationRaw'), `${where}: actual initial migration write A required`);
      checkSave(epoch.migrationRaw, epoch.constructorNow, epoch.constructorNow, `${where}.migrationRaw`, epochIndex, -1, 'migration');
    } else {
      assert.equal(Object.hasOwn(epoch, 'migrationRaw'), false, `${where}: current constructor does not save; savedAt is not constructorNow`);
    }
    keys(epoch.ready, ['mode', 'lastTickAt', 'state'], [], `${where}.ready`);
    assert.equal(epoch.ready.mode, 'ready', `${where}: this oracle certifies successful ready-session trajectories only`);
    assert.equal(epoch.ready.lastTickAt, lastTickAt(), `${where}.ready: paired watermark`);
    assertState(epoch.ready.state, save.serializeState(state), age, `${where}.ready`);
    assert.ok(Array.isArray(epoch.events), `${where}: ordered events required`);
    let pendingFrame = null, pendingSave = null;
    const epochSavesAtStart = saves.length;
    for (const [eventIndex, event] of epoch.events.entries()) {
      const place = `${where}.events[${eventIndex}]`;
      object(event, place);
      assert.equal(typeof event.kind, 'string', `${place}: event kind required`);
      if (event.kind === 'frame') {
        keys(event, ['kind', 'now', 'gapSeconds', 'mode', 'lastTickAtBefore'], [], place);
        assert.equal(pendingFrame, null, `${place}: no overlapping/missing-end frames`);
        assert.equal(pendingSave, null, `${place}: previous save must finish`);
        milliseconds(event.now, `${place}.now`);
        assert.equal(event.mode, 'ready', `${place}: unmodelled protected/conflict transitions are not accepted`);
        assert.equal(event.lastTickAtBefore, lastTickAt(), `${place}: pre-frame paired watermark`);
        const projectedWall = epoch.startupClock.wallAt + (event.now - epoch.startupClock.frameAt);
        const admissible = event.now >= accountedFrameAt && projectedWall >= 0 && projectedWall <= Number.MAX_SAFE_INTEGER;
        const expectedGap = admissible ? (event.now - accountedFrameAt) / 1000 : 0;
        assert.equal(event.gapSeconds, expectedGap, `${place}: observed gap must equal actual RAF now minus independently accounted epoch`);
        let adoption = null;
        if (expectedGap > 0) {
          adoption = adopt(expectedGap >= 5 ? 'catchUp' : 'tick', expectedGap, epochIndex, eventIndex);
          accountedFrameAt = event.now;
        }
        pendingFrame = { now: event.now, catchUp: expectedGap >= 5, saves: 0, adoption };
      } else if (event.kind === 'frame-end') {
        keys(event, ['kind', 'now', 'mode', 'lastTickAt'], [], place);
        assert.ok(pendingFrame, `${place}: frame-end requires an actual prior frame`);
        assert.equal(pendingSave, null, `${place}: catchUp persist must finish before frame-end`);
        assert.equal(event.now, pendingFrame.now, `${place}: same actual RAF callback`);
        assert.equal(event.mode, 'ready', `${place}: ready after original frame stages`);
        assert.equal(event.lastTickAt, lastTickAt(), `${place}: post-adoption paired watermark`);
        assert.equal(pendingFrame.saves, pendingFrame.catchUp ? 1 : 0,
          `${place}: fixed main phase order requires exactly one catchUp save and no live-frame save`);
        pendingFrame = null;
      } else if (event.kind === 'save-input') {
        keys(event, ['kind', 'savedAt', 'lastTickAt', 'mode', 'state', 'expectedRaw'], [], place);
        assert.equal(pendingSave, null, `${place}: no overlapping saves`);
        assert.equal(event.mode, 'ready', `${place}: only a ready save may be committed`);
        if (pendingFrame) assert.ok(pendingFrame.catchUp && pendingFrame.saves === 0, `${place}: only catchUp phase may save inside a frame`);
        milliseconds(event.savedAt, `${place}.savedAt`);
        assert.equal(event.lastTickAt, lastTickAt(), `${place}: save must preserve actual accounted watermark`);
        assert.equal(event.expectedRaw, observedRaw, `${place}: save baseline equals last verified write`);
        assertState(event.state, save.serializeState(state), age, place);
        pendingSave = event;
      } else if (event.kind === 'save') {
        keys(event, ['kind', 'savedAt', 'lastTickAt', 'raw', 'reason'], [], place);
        assert.ok(pendingSave, `${place}: persisted raw requires original save-input`);
        assert.equal(event.savedAt, pendingSave.savedAt, `${place}: raw belongs to the original save call`);
        assert.equal(event.lastTickAt, pendingSave.lastTickAt, `${place}: no repaired/re-paired watermark`);
        assert.ok(['beforeunload', 'visibility-hidden', 'manual', 'autosave', 'catchUp'].includes(event.reason), `${place}: explicit observed save cause required`);
        if (pendingFrame) assert.equal(event.reason, 'catchUp', `${place}: catchUp persist occurs before frame-end`);
        else assert.notEqual(event.reason, 'catchUp', `${place}: catchUp save must be inside its actual frame`);
        checkSave(event.raw, event.savedAt, event.lastTickAt, place, epochIndex, eventIndex, event.reason);
        if (pendingFrame) pendingFrame.saves++;
        pendingSave = null;
      } else if (event.kind === 'action') {
        keys(event, ['kind', 'actionType', 'mode'], [], place);
        assert.equal(pendingFrame, null, `${place}: action cannot interleave a synchronous frame`);
        assert.equal(pendingSave, null, `${place}: action cannot interleave a synchronous save`);
        assert.equal(event.mode, 'ready', `${place}: ready action required`);
        assert.ok(['save', 'dismiss-notice', 'dismiss-offline'].includes(event.actionType),
          `${place}: economic actions are outside native clock/save/reload replay scope`);
      } else assert.fail(`${place}: unsupported event ${event.kind}`);
    }
    assert.equal(pendingFrame, null, `${where}: truncated application frame`);
    assert.equal(pendingSave, null, `${where}: truncated persisted save`);
    if (epochIndex + 1 < input.epochs.length) {
      assert.ok(saves.length > epochSavesAtStart, `${where}: reload requires actual post-constructor persisted B/C`);
      assert.ok(saves.slice(epochSavesAtStart).some(save => save.reason === 'beforeunload'),
        `${where}: reload requires its actual beforeunload save`);
      assert.ok(['beforeunload', 'visibility-hidden'].includes(saves.at(-1).reason),
        `${where}: reload is bound to its real final lifecycle save (hidden may follow beforeunload)`);
    }
    epochs.push({ epochIndex, constructorNow: epoch.constructorNow, startupClock: copy(epoch.startupClock),
      sourceRawSha256: digest(epoch.sourceRaw), sourceSavedAt: read.savedAt, sourceLastTickAt: read.lastTickAt,
      startupAdoption: startup, npcElapsedSeconds: age, lastTickAt: lastTickAt(),
      readerInput: epochIndex === 0 ? 'untouched historical source bytes' : 'synthetic r11 compatibility bridge from independent expected state',
      state: save.serializeState(state) });
  }
  return { schema: RESULT_SCHEMA, sourceSha: SOURCE_SHA, dependencyIdentity: dependencies,
    inputRawSha256: digest(input.originalRaw), sourceRevision: original.revision,
    oldObservedAndUnobservedStateEqual: true, boundary: 'Economic replay verification; native capture provenance is verified separately',
    epochs, adoptions, saves, npcElapsedSeconds: age, state: save.serializeState(state) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'provide exactly one archived ca5 source root');
  console.log(JSON.stringify(await replayNativeTrace(process.argv[2], JSON.parse(readFileSync(0, 'utf8')))));
}
