/**
 * Anonymous historical r10 evidence producer. No production edits, new reader, or browser.
 * Run with the fixed r10 checkout's tsx loader; every output stays in the supplied /tmp directory.
 * Example:
 * node --import /absolute/r10/node_modules/tsx/dist/loader.mjs scripts/demolition-r10-fixture.ts \
 *   --source-root /absolute/r10 --expected-source-sha <exact-40-character-local-HEAD> \
 *   --r9-source-root /absolute/r9 --expected-r9-sha f96894eb1b32737ab403890ed83fdb3da41a0644 \
 *   --out /tmp/infinity-demolition-r10-evidence
 * Optional: --compare-source-sha <locally-present-commit> proves whole-tree and src-tree equality.
 * A source pin is provenance only, never a claim that its CI passed.
 */
declare const process: { argv: string[]; version: string; stdout: { write(value: string): void }; stderr: { write(value: string): void }; exitCode?: number };
const [{ strict: assert }, { execFileSync }, { createHash }, fs, paths, { pathToFileURL }] = await Promise.all([
  import('node:assert' as string), import('node:child_process' as string), import('node:crypto' as string),
  import('node:fs' as string), import('node:path' as string), import('node:url' as string),
]);
const { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = fs;
const { isAbsolute, join, resolve } = paths;

type Any = any;
const stable = (value: Any): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const equal = (a: Any, b: Any, label: string) => assert.equal(stable(a), stable(b), label);
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(key?.startsWith('--') && value && !value.startsWith('--'), 'Flags require explicit values');
  assert(!args.has(key), `Duplicate flag ${key}`); args.set(key, value);
}
const allowed = ['--source-root', '--expected-source-sha', '--r9-source-root', '--expected-r9-sha', '--out', '--compare-source-sha'];
for (const key of args.keys()) assert(allowed.includes(key), `Unknown flag ${key}`);
const required = (key: string) => { const value = args.get(key); if (!value) throw Error(`Missing ${key}`); return value; };
const shaArg = (key: string) => { const value = required(key); assert(/^[a-f0-9]{40}$/.test(value), `${key} requires an exact full SHA`); return value; };
const rootArg = (key: string) => { const path = required(key); assert(isAbsolute(path), `${key} must be absolute`); return realpathSync(path); };
const git = (root: string, ...parts: string[]): string => execFileSync('git', ['-C', root, ...parts], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function verifySource(root: string, expected: string) {
  assert.equal(git(root, 'rev-parse', '--show-toplevel'), root, 'Source must be a git checkout root');
  assert.equal(git(root, 'rev-parse', 'HEAD'), expected, 'Explicit source SHA must equal the actual local HEAD');
  git(root, 'diff', '--exit-code', expected, '--', 'src');
  assert.equal(git(root, 'ls-files', '--others', '--exclude-standard', '--', 'src'), '', 'Untracked src files would make the source scope ambiguous');
  const files = git(root, 'ls-tree', '-r', '--name-only', expected, '--', 'src').split('\n').filter(Boolean).sort();
  const scopeFiles = files.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { sourceSha: expected, headVerified: true, srcClean: true,
    sourceTree: git(root, 'rev-parse', `${expected}:src`), fullTree: git(root, 'rev-parse', `${expected}^{tree}`),
    sourceScopeDigest: hash(stable(scopeFiles)), sourceScopeFileCount: files.length, sourceScopeFiles: scopeFiles,
    checkoutStatus: git(root, 'status', '--short'), ciStatus: 'not-assessed-by-this-producer' };
}
function diffs(a: Any, b: Any, path = '$'): Any[] {
  if (stable(a) === stable(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap(key => diffs(a[key], b[key], `${path}.${key}`));
  }
  return [{ path, before: a === undefined ? { missing: true } : a, after: b === undefined ? { missing: true } : b }];
}
async function load(root: string) {
  const names = ['game/state', 'game/save', 'game/content', 'game/decimal', 'game/empire', 'game/queue', 'game/logic',
    'game/research', 'game/shipyard', 'game/orders', 'game/planet', 'automation/engine'];
  const mods = await Promise.all(names.map(name => import(pathToFileURL(join(root, 'src', `${name}.ts`)).href)));
  return Object.fromEntries(names.map((name, i) => [name.split('/').at(-1)!, mods[i]]));
}
async function main() {
  const root = rootArg('--source-root'), oldRoot = rootArg('--r9-source-root');
  const source = verifySource(root, shaArg('--expected-source-sha'));
  const oldSource = verifySource(oldRoot, shaArg('--expected-r9-sha'));
  assert.equal(oldSource.sourceSha, 'f96894eb1b32737ab403890ed83fdb3da41a0644', 'This producer pins the genuine reviewed r9 source');
  const outputArg = required('--out'); assert(isAbsolute(outputArg), '--out must be absolute');
  const output = resolve(outputArg); assert(output.startsWith('/tmp/'), 'Outputs must stay under /tmp, never in production/worktrees');
  assert(!existsSync(output), 'Output directory already exists; choose a new directory to preserve earlier raw evidence');
  const compare = args.get('--compare-source-sha');
  const comparison = compare ? (() => {
    assert(/^[a-f0-9]{40}$/.test(compare), 'Comparison requires full SHA');
    const srcTree = git(root, 'rev-parse', `${compare}:src`), fullTree = git(root, 'rev-parse', `${compare}^{tree}`);
    return { sourceSha: compare, sourceTree: srcTree, fullTree, sourceTreeEqual: srcTree === source.sourceTree, fullTreeEqual: fullTree === source.fullTree };
  })() : { status: 'not-requested', note: 'No remote SHA or CI equivalence is inferred from a local checkout.' };
  const a = await load(root), old = await load(oldRoot);
  assert.equal(a.content.SAVE_VERSION, 9); assert.equal(a.content.SAVE_REVISION, 10);
  assert.equal(old.content.SAVE_VERSION, 9); assert.equal(old.content.SAVE_REVISION, 9);
  assert.equal(a.content.SAVE_SCHEMA, old.content.SAVE_SCHEMA);
  mkdirSync(output); mkdirSync(join(output, 'inputs'));
  const rows: Any[] = [], inputs: Any[] = [];
  const write = (relative: string, bytes: string) => { writeFileSync(join(output, relative), bytes, { flag: 'wx' }); assert.equal(readFileSync(join(output, relative), 'utf8'), bytes); return { path: relative, bytes: new TextEncoder().encode(bytes).byteLength, sha256: hash(bytes) }; };
  const writeJson = (relative: string, data: Any) => write(relative, JSON.stringify(data, null, 2) + '\n');
  const snapshot = (state: Any) => a.save.serializeState(state);
  const active = (state: Any) => a.empire.activePlanet(state);
  const ok = (result: Any, label: string) => { assert.equal(result.ok, true, `${label}: ${result.reason}`); return result.state; };
  const newState = (index: number, module = a) => {
    const state = module.state.createInitialState(31000 + index, 41000 + index);
    state.planets[0].name = `Synthetic ${module.content.SAVE_REVISION} home ${index}`;
    return state;
  };
  const ready = (index: number, two = false) => {
    const state = newState(index); state.research.levels.energy_tech = 12; state.research.levels.combustion_drive = 1;
    if (two) {
      const home = state.planets[0].coordinates;
      state.planets.push(a.planet.createPlanet(`synthetic-colony-${index}`, { ...home, system: home.system === 1 ? 2 : 1 }, 187));
    }
    for (const p of state.planets) {
      p.name = `Synthetic funded ${p.id}`; p.buildings.nanite_factory = 1; p.buildings.research_lab = 12; p.buildings.shipyard = 2;
      p.tempMax = 10; p.units.solar_satellite = 100;
      p.resources = { metal: a.decimal.big(1e6), crystal: a.decimal.big(1e6), deuterium: a.decimal.big(1e6) };
    }
    return a.logic.tick(state, 0);
  };
  const setup = 'Synthetic deterministic factory worlds, completed prerequisites, satellites and starting wallets are preconfigured; this is not natural progression. All subsequent payments, ticks, grants and cancellations stated in actions use the fixed r10 APIs.';
  function census(state: Any) {
    const paid = [...state.research.queue.map((j: Any) => ({ kind: 'research', planetId: j.planetId, jobId: j.jobId })),
      ...state.planets.flatMap((p: Any) => [...p.buildQueue.map((j: Any) => ({ kind: 'building', planetId: p.id, building: j.building, jobId: j.jobId })),
        ...p.shipyardQueue.map((j: Any) => ({ kind: 'shipyard', planetId: p.id, jobId: j.jobId }))])];
    const G = state.planets.reduce((n: number, p: Any) => n + p.terraformerFields.grantedLevels, 0);
    const P = paid.filter((j: Any) => j.jobId >= state.terraformerGrantJobFloor).length;
    const I = state.orders.nextJobId - state.terraformerGrantJobFloor;
    assert(G + P <= I); assert.equal(new Set(paid.map((j: Any) => j.jobId)).size, paid.length);
    return { floor: state.terraformerGrantJobFloor, nextJobId: state.orders.nextJobId, G, P, I, paid,
      worlds: state.planets.map((p: Any) => ({ id: p.id, coordinates: p.coordinates, fieldsMax: p.fieldsMax, ledger: p.terraformerFields,
        terraformerLevel: p.buildings.terraformer, usedFields: a.planet.usedFields(p) })) };
  }
  function emit(id: string, state: Any, details: Any) {
    const raw = a.save.exportSave(state, 1000, 900), parsed = JSON.parse(raw), oracle = a.save.importSave(raw);
    assert.equal(parsed.revision, 10); assert.equal(oracle.revision, 10);
    const normalization = diffs(parsed, oracle);
    assert(normalization.every(change => /^\$\.state\.unlockedCards(\.|$)/.test(change.path) || change.path === '$.state.seenEnergyShortage'), `${id}: unexpected old-reader normalization: ${stable(normalization)}`);
    const again = a.save.importSave(JSON.stringify(oracle)); equal(again, oracle, `${id}: fixed r10 re-import not idempotent`);
    const restored = a.save.deserializeState(oracle.state);
    const repeatRaw = a.save.exportSave(restored, 1000, 900);
    equal(JSON.parse(repeatRaw), oracle, `${id}: fixed r10 cold serializer round-trip changed canonical parsed semantics`);
    const serializerBytesEqual = repeatRaw === raw;
    const coldRoundtripFile = write(`${id}.cold-roundtrip.r10.json`, repeatRaw);
    const evidence = census(restored);
    const rawFile = write(`${id}.r10.json`, raw), canonicalFile = writeJson(`${id}.fixed-r10.json`, oracle);
    const meta = { id, sourceSha: source.sourceSha, sourceRevision: 10, sourceScopeDigest: source.sourceScopeDigest,
      synthetic: true, naturalProgression: false, generationMode: 'unmodified-r10-serializer-output', canonical: normalization.length === 0,
      setup, ...details, rawFile, canonicalFile, coldRoundtripFile, serializerByteNormalization: { exactBytesEqual: serializerBytesEqual, classification: serializerBytesEqual ? 'none' : normalization.length ? 'established-fixed-r10-reader-normalization; see differences' : 'json-object-key-order-only; parsed-values-identical' }, canonicalStateSha256: hash(stable(oracle.state)),
      normalization: { classification: normalization.length ? 'established-fixed-r10-reader-normalization' : 'none-after-fixed-r10-read', differences: normalization },
      checks: { fixedReaderAccepted: true, importIdempotent: true, coldRuntimeRoundtrip: true, exactSerializerBytesRoundtrip: serializerBytesEqual, parsedSerializerRoundtrip: true }, evidence };
    const metadataFile = writeJson(`${id}.metadata.json`, meta); rows.push({ ...meta, metadataFile });
  }
  function r9Input(id: string, state: Any, mutate?: (file: Any) => void) {
    const serializerRaw = old.save.exportSave(old.logic.tick(state, 0), 1000, 900);
    const serializerOracle = old.save.importSave(serializerRaw);
    const serializerNormalization = diffs(JSON.parse(serializerRaw), serializerOracle);
    assert(serializerNormalization.every(change => /^\$\.state\.unlockedCards(\.|$)/.test(change.path)), `${id}: unexpected genuine r9 serializer normalization`);
    let raw = serializerRaw;
    if (mutate) { const file = JSON.parse(serializerRaw); mutate(file); raw = JSON.stringify(file, null, 2); }
    const oldOracle = old.save.importSave(raw), r10Oracle = a.save.importSave(raw);
    const oldState = oldOracle.state;
    const { terraformerGrantJobFloor: _floor, ...projected } = r10Oracle.state;
    projected.planets = r10Oracle.state.planets.map((p: Any) => { const { terraformerFields: _ledger, ...rest } = p; return rest; });
    equal(projected, oldState, `${id}: r9 to fixed-r10 changed existing semantics`);
    assert.equal(r10Oracle.state.terraformerGrantJobFloor, oldState.orders.nextJobId);
    for (const p of r10Oracle.state.planets) equal(p.terraformerFields, { base: p.fieldsMax, grantedLevels: 0 }, `${id}: legacy migration ledger`);
    const metadata = { id, sourceSha: oldSource.sourceSha, sourceRevision: 9, sourceScopeDigest: oldSource.sourceScopeDigest, synthetic: true, naturalProgression: false,
      generationMode: mutate ? 'explicitly-hand-edited-normalization-input-derived-from-genuine-r9-serializer' : 'unmodified-r9-serializer-output',
      canonical: !mutate && serializerNormalization.length === 0, originalSerializerNormalization: serializerNormalization, serializerParentFile: write(`inputs/${id}.r9-serializer-parent.json`, serializerRaw),
      rawFile: write(`inputs/${id}.r9.json`, raw), parentRawSha256: hash(serializerRaw),
      explicitEdits: mutate ? diffs(JSON.parse(serializerRaw), JSON.parse(raw)) : [],
      oldNormalization: { classification: diffs(JSON.parse(raw), oldOracle).length ? 'established-r9-reader-normalization' : 'none', differences: diffs(JSON.parse(raw), oldOracle) },
      oldReaderFile: writeJson(`inputs/${id}.fixed-r9.json`, oldOracle), r10ReaderFile: writeJson(`inputs/${id}.fixed-r10.json`, r10Oracle),
      historicalMigrationDifferences: diffs(oldOracle, r10Oracle),
      checks: { oldReaderAccepted: true, r10Accepted: true, priorFieldsEqualToFixedR9Reader: true, originalRawReadbackExact: true } };
    inputs.push({ ...metadata, metadataFile: writeJson(`inputs/${id}.metadata.json`, metadata) });
    return a.save.deserializeState(r10Oracle.state);
  }

  emit('H10-fresh', a.logic.tick(newState(1), 0), { actions: ['deterministic r10 factory and tick(0) refresh'] });

  let one = ok(a.queue.enqueue(ready(2), 'terraformer', 'manual'), 'one paid terraformer');
  const oneId = active(one).buildQueue[0].jobId, oneDuration = active(one).buildQueue[0].remainingSeconds;
  const oneLog = a.logic.emptyTickLog(); one = a.logic.tick(one, oneDuration, 'live', oneLog);
  equal(oneLog.completedBuilds, [{ building: 'terraformer', level: 1 }], 'single actual completion');
  equal(active(one).terraformerFields, { base: 163, grantedLevels: 1 }, 'earned ledger');
  emit('G10a-earned-grant', one, { actions: [{ enqueue: 'terraformer', jobId: oneId }, { tickSeconds: oneDuration, completedBuilds: oneLog.completedBuilds }] });

  let multi = ready(3, true); const colonyId = multi.planets[1].id;
  multi = ok(a.queue.enqueue(multi, 'terraformer', 'manual'), 'home grant');
  multi = a.empire.selectPlanet(multi, colonyId); multi = ok(a.queue.enqueue(multi, 'terraformer', 'manual'), 'colony grant');
  const multiDuration = Math.max(...multi.planets.map((p: Any) => p.buildQueue[0].remainingSeconds));
  multi = a.logic.tick(multi, multiDuration);
  equal(multi.planets.map((p: Any) => p.terraformerFields.grantedLevels), [1, 1], 'two actually earned grants');
  multi = a.empire.selectPlanet(multi, 'homeworld'); multi = ok(a.queue.enqueue(multi, 'terraformer', 'manual'), 'current home paid terra');
  multi = a.empire.selectPlanet(multi, colonyId); multi = ok(a.queue.enqueue(multi, 'metal_storage', 'manual'), 'ordinary paid building');
  multi = ok(a.research.enqueueResearch(multi, 'computer_tech', 'manual'), 'ordinary paid research');
  multi = ok(a.shipyard.enqueueUnits(multi, 'light_fighter', 7, 'manual'), 'ordinary paid yard');
  multi = a.logic.tick(multi, 0.125);
  assert.equal(multi.research.queue.length, 1); assert.equal(active(multi).shipyardQueue.length, 1);
  emit('G10b-multiworld-paid', multi, { actions: ['real terraformer payments/completions on two distinct worlds', 'real active terraformer/building/research/seven-unit yard payments', 'tick(0.125)'],
    assertions: { grantsByWorld: [1, 1], activeKinds: ['building', 'research', 'shipyard'] } });

  let oldMixed = newState(4, old); const oldHome = oldMixed.planets[0];
  const oldColonyId = 'synthetic-r9-colony';
  const oldColony = old.planet.createPlanet(oldColonyId, { ...oldHome.coordinates, system: oldHome.coordinates.system === 1 ? 2 : 1 }, 187);
  oldMixed.planets.push(oldColony); oldMixed.research.levels.energy_tech = 12;
  for (const p of oldMixed.planets) { p.resources = { metal: old.decimal.big(1e6), crystal: old.decimal.big(1e6), deuterium: old.decimal.big(1e6) }; p.tempMax = 10; p.units.solar_satellite = 100; }
  oldColony.buildings.nanite_factory = 1;
  // Genuine r9 serialization of an explicitly synthetic accepted historical shape.
  // r9 did not expose this facility for payment, so this is NOT an old enqueue claim.
  oldHome.buildQueue = [{ jobId: 1, taskId: null, building: 'terraformer', targetLevel: 1, paid: old.queue.costFor(oldMixed, 'terraformer', 1),
    totalSeconds: 120, remainingSeconds: 120, source: 'manual' }]; oldMixed.orders.nextJobId = 2;
  let mixed = r9Input('legacy-paid-terra', oldMixed);
  mixed = a.empire.selectPlanet(mixed, oldColonyId); mixed = ok(a.queue.enqueue(mixed, 'terraformer', 'manual'), 'new terra alongside old on another star');
  assert.equal(mixed.terraformerGrantJobFloor, 2);
  emit('G10c-mixed-old-new-pending', mixed, { actions: ['actual fixed-r10 import of genuine r9 serializer bytes', 'new real r10 terraformer payment on the other star'], inputId: 'legacy-paid-terra',
    syntheticExceptions: ['Historical r9 terraformer job, timer and issued ID are explicitly seeded as an old-reader-accepted synthetic state; no natural r9 enqueue is claimed.'] });
  mixed = a.logic.tick(mixed, active(mixed).buildQueue[0].remainingSeconds);
  assert(mixed.planets[0].buildQueue[0].remainingSeconds > 0); assert.equal(mixed.planets[1].terraformerFields.grantedLevels, 1);
  emit('G10c-mixed-old-paid-new-earned', mixed, { inputId: 'legacy-paid-terra', actions: ['real tick completed only the post-floor colony terraformer'],
    assertions: { oldJobId: 1, newConsumedJobId: 2, fixedFloor: 2, legacyHomeGrant: 0, colonyGrant: 1 } });
  mixed = a.logic.tick(mixed, mixed.planets[0].buildQueue[0].remainingSeconds);
  equal(mixed.planets.map((p: Any) => p.terraformerFields.grantedLevels), [0, 1], 'legacy completion must not retro-grant');
  assert.equal(mixed.planets[0].buildings.terraformer, 1);
  emit('G10c-legacy-completed-no-grant', mixed, { inputId: 'legacy-paid-terra', actions: ['real tick consumed pre-floor legacy terraformer without granting fields'], assertions: { fixedFloor: 2, grantsByWorld: [0, 1] } });

  let gaps = ready(5); gaps = ok(a.queue.enqueue(gaps, 'metal_storage', 'manual'), 'cancelled ordinary payment');
  const cancelledOne = active(gaps).buildQueue[0].jobId; gaps = ok(a.queue.cancel(gaps, 0), 'ordinary cancellation');
  gaps = ok(a.queue.enqueue(gaps, 'terraformer', 'manual'), 'cancelled terra payment');
  const cancelledTwo = active(gaps).buildQueue[0].jobId; gaps = ok(a.queue.cancel(gaps, 0), 'terra cancellation');
  gaps = ok(a.queue.enqueue(gaps, 'terraformer', 'manual'), 'post-gap payment');
  equal([cancelledOne, cancelledTwo, active(gaps).buildQueue[0].jobId, gaps.orders.nextJobId], [1, 2, 3, 4], 'IDs are not recycled');
  emit('G10d-cancelled-id-gaps', gaps, { actions: ['real ordinary payment/cancel', 'real terraformer payment/cancel', 'real fresh terraformer payment'], cancelledJobIds: [1, 2] });

  let exhausted = ready(6); exhausted.orders.nextJobId = Number.MAX_SAFE_INTEGER - 1; exhausted.terraformerGrantJobFloor = Number.MAX_SAFE_INTEGER - 1;
  exhausted = ok(a.queue.enqueue(exhausted, 'terraformer', 'manual'), 'last issuable identity');
  assert.equal(exhausted.orders.nextJobId, Number.MAX_SAFE_INTEGER);
  const beforeExhausted = stable(snapshot(exhausted)), refused = a.queue.enqueue(exhausted, 'metal_mine', 'manual');
  assert.equal(refused.ok, false); assert.equal(refused.state, exhausted); assert.equal(stable(snapshot(refused.state)), beforeExhausted);
  emit('E10-exhausted-id-boundary', exhausted, { syntheticExceptions: ['nextJobId and floor explicitly seeded at MAX_SAFE_INTEGER - 1; this many jobs were not played.'],
    actions: ['real final legal terraformer identity issued', 'further ordinary payment refused without mutation'], refusalReason: refused.reason });

  let reset = ready(7, true); reset.research.levels.combustion_drive = 6; reset.research.levels.computer_tech = 3;
  const donor = reset.planets[0], payer = reset.planets[1]; donor.units.small_cargo = 1;
  payer.resources = { metal: a.decimal.big(0), crystal: a.decimal.big(0), deuterium: a.decimal.big(0) };
  for (const p of reset.planets) for (const key of Object.keys(p.productionPct)) p.productionPct[key] = 0;
  reset = ok(a.queue.enqueue(reset, 'terraformer', 'manual'), 'pre-reset pending job');
  reset = ok(a.orders.createOrderTask(reset, { kind: 'building', planetId: payer.id, building: 'metal_storage', targetLevel: 1,
    expectedNextTaskId: reset.orders.nextTaskId, budget: { metal: '1000', crystal: '1000', deuterium: '1000' },
    transport: { donorPlanetId: donor.id, ship: 'small_cargo', count: 1, speedPercent: 100, maxTrips: 1,
      grossCargoCap: { metal: '1000', crystal: '1000', deuterium: '1000' } } }), 'real transport plan');
  reset = a.orders.runDueOrderPass(reset);
  assert.equal(reset.fleets.length, 1, `real transport dispatch failed: ${reset.orders.tasks[0]?.reason}`);
  assert.equal(reset.orders.tasks[0].transport.trips.length, 1);
  const preReset = snapshot(reset), preResetFloor = reset.terraformerGrantJobFloor, preResetNext = reset.orders.nextJobId;
  reset.lifetime.metal = a.decimal.big(a.content.PRESTIGE_SCORE_UNIT).mul(4);
  const evaluation = a.logic.evaluatePrestige(reset); assert(evaluation.gain.gte(1)); assert.notEqual(evaluation.next, reset);
  reset = evaluation.next; assert.equal(reset.terraformerGrantJobFloor, preResetNext); assert(reset.terraformerGrantJobFloor > preResetFloor);
  assert.equal(reset.orders.tasks[0].transport.trips.length, 1); assert.equal(reset.fleets.length, 0); assert.equal(reset.planets.length, 1);
  assert.equal(reset.orders.nextJobId, preResetNext); assert.equal(reset.planets[0].terraformerFields.grantedLevels, 0);
  const preResetFile = writeJson('inputs/C10-before-real-prestige.fixed-r10-state.json', preReset);
  emit('C10-real-prestige-floor', reset, { syntheticExceptions: ['Lifetime metal explicitly preconfigured to meet the existing prestige threshold.'],
    actions: ['real paid terraformer and transport plan dispatch', 'actual evaluatePrestige reset'], preResetFloor, preResetNext, preResetFile,
    assertions: { floorRaisedByPrestigeOnly: true, retainedPlanRecords: reset.orders.tasks.length, retainedTripRecords: reset.orders.tasks[0].transport.trips.length } });

  let locked = ready(8, true); const rackColony = locked.planets[1]; rackColony.buildings.robotics_factory = 6;
  locked.research.levels.computer_tech = 0; locked.unlockedCards = [...new Set([...locked.unlockedCards, 'auto_collect', 'auto_build'])];
  locked = a.empire.selectPlanet(locked, rackColony.id);
  for (const index of [1, 2, 3]) { const eq = a.engine.equipCard(locked, index, index === 1 ? 'auto_build' : 'auto_collect'); locked = eq.state; assert(locked.protocols.slots[index].card, eq.status); }
  locked = a.engine.toggleSlot(locked, 1, true); locked = a.engine.toggleSlot(locked, 2, false); locked = a.engine.clearSlot(locked, 3);
  locked = a.empire.selectPlanet(locked, 'homeworld'); assert.equal(a.engine.unlockedSlotCount(locked), 1);
  assert.equal(locked.protocols.slots[1].card.enabled, true); assert.equal(locked.protocols.slots[2].card.enabled, false); assert.equal(locked.protocols.slots[3].card, null);
  locked = a.logic.tick(locked, 0);
  emit('S10-locked-card-configs', locked, { syntheticExceptions: ['Colony robotics 6 and catalog unlocks preconfigured so old APIs can equip and explicitly disable/clear while open.'],
    actions: ['real equip/toggle/clear APIs on open colony rack', 'real selectPlanet locks slots 2, 3 and 4 on homeworld'],
    assertions: { visibleOpenSlots: 1, lockedEnabledSlot: 2, lockedDisabledSlot: 3, lockedClearedSlot: 4, savedRackSlots: locked.protocols.slots.length } });

  let over = newState(9, old), overPlanet = over.planets[0]; overPlanet.fieldsMax = 5; overPlanet.buildings.metal_mine = 20; overPlanet.buildings.lunar_base = 3;
  overPlanet.buildQueue = [27, 23].map((targetLevel, i) => ({ jobId: i + 1, taskId: null, building: 'metal_mine', targetLevel,
    paid: old.queue.costFor(over, 'metal_mine', targetLevel), totalSeconds: i ? 0 : 100, remainingSeconds: i ? 0 : 40, source: 'manual' }));
  over.orders.nextJobId = 3;
  const migratedOver = r9Input('legacy-ordinary-overfull', over);
  assert(a.planet.usedFields(migratedOver.planets[0]) > migratedOver.planets[0].fieldsMax);
  equal(migratedOver.planets[0].buildQueue.map((j: Any) => j.targetLevel), [27, 23], 'old noncontiguous targets retained');
  emit('O10-ordinary-legacy-overfull', migratedOver, { inputId: 'legacy-ordinary-overfull',
    syntheticExceptions: ['Old accepted overfull fields, noncontiguous ordinary targets, hidden lunar level and old queue identities are explicitly synthetic, serializer-emitted and not natural progression.'],
    actions: ['genuine r9 serializer', 'fixed r9 reader acceptance', 'real fixed-r10 migration without tick or queue editing'] });

  const normalized = r9Input('legacy-explicit-normalization', newState(10, old), file => {
    const p = file.state.planets[0]; delete p.fieldsMax; delete p.buildings.terraformer;
    p.buildQueue = [{ jobId: 1, taskId: null, building: 'terraformer', targetLevel: 1, paid: { metal: '000', crystal: '+5e4', deuterium: 100000 },
      totalSeconds: 10, remainingSeconds: 20, source: 'manual' }]; file.state.orders.nextJobId = 2;
  });
  equal(normalized.planets[0].terraformerFields, { base: 163, grantedLevels: 0 }, 'normalization base follows old reader');
  emit('N10-after-old-normalization', normalized, { inputId: 'legacy-explicit-normalization',
    syntheticExceptions: ['Input is separately labeled hand-edited r9 normalization probe, not unmodified serializer bytes. Genuine parent bytes and explicit edits are preserved.'],
    actions: ['fixed r9 reader normalizes fields, missing level, money representations and remaining timer', 'fixed-r10 migration adds its historical ledger after that normalization', 'unmodified r10 export'] });

  assert.equal(rows.length, 12, 'Keep the fixture matrix bounded');
  const endSource = verifySource(root, source.sourceSha), endOld = verifySource(oldRoot, oldSource.sourceSha);
  assert.equal(endSource.sourceScopeDigest, source.sourceScopeDigest, 'r10 source changed during generation');
  assert.equal(endOld.sourceScopeDigest, oldSource.sourceScopeDigest, 'r9 source changed during generation');
  const manifest = { format: 'anonymous-fixed-r10-fixture-evidence-v1', description: 'Synthetic, test-only historical serializer evidence. This does not implement demolition, test a later reader, establish natural player progression, or assert CI/browser/release acceptance.',
    producer: { path: "scripts/demolition-r10-fixture.ts", sha256: hash(readFileSync(process.argv[1])), runtime: process.version },
    source, oldSource, comparison, rowCount: rows.length, inputCount: inputs.length, rows, inputs,
    checks: { sourceUnchangedAtFinish: true, outputReadbackExact: true, oldNormalizationClassified: true, genuineR9InputsRetained: true } };
  const manifestFile = writeJson('manifest.json', manifest);
  const report = ['# Anonymous fixed-r10 serializer evidence', '',
    `Source HEAD: ${source.sourceSha}`, `Source src tree: ${source.sourceTree}`, `Source full tree: ${source.fullTree}`,
    `Source scope SHA-256: ${source.sourceScopeDigest}`, `Genuine r9 source: ${oldSource.sourceSha}`, '',
    'All 12 r10 raw files were emitted by the verified r10 serializer. Each was accepted by the same fixed reader, cold-deserialized and re-exported with exactly equal canonical reader values, and read back from disk exactly. Any JSON key-order-only reserialization difference is explicitly recorded; original raw bytes are never replaced.',
    'Every state is anonymous and explicitly synthetic. Prerequisites and wallets are preconfigured. Earned r10 grants and stated payments/cancellations/ticks/reset use real old APIs; historical r9 queued terraformer and ordinary overfull shapes are explicitly synthetic because r9 did not expose terraformer payment.',
    'The normalization probe has genuine r9 serializer parent bytes, separately labeled edited bytes, hashes, exact edits, fixed-r9 before/after differences, and fixed-r10 migration differences. No unnormalized input is described as an unmodified serializer output.',
    'No source or production/worktree files were edited. No later reader was imported or implemented. CI, browser and release status were not assessed.', '',
    ...rows.map(row => `- ${row.id}: floor=${row.evidence.floor}; next=${row.evidence.nextJobId}; G=${row.evidence.G}; P=${row.evidence.P}; I=${row.evidence.I}; raw sha256=${row.rawFile.sha256}`), '',
    `Manifest SHA-256: ${manifestFile.sha256}`, ''].join('\n');
  write('README.md', report);
  process.stdout.write(JSON.stringify({ output, sourceSha: source.sourceSha, sourceTree: source.sourceTree, fullTree: source.fullTree,
    sourceScopeDigest: source.sourceScopeDigest, comparison, checkedRows: rows.length, genuineR9Inputs: inputs.length,
    manifestSha256: manifestFile.sha256, fixtures: rows.map(row => ({ id: row.id, rawSha256: row.rawFile.sha256, metadataSha256: row.metadataFile.sha256, evidence: row.evidence })) }, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
