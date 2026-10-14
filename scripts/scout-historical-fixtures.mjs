/** Independent historical-source migration fixtures, never current exports with old tags.
 * Generate: node --import tsx scripts/scout-historical-fixtures.mjs generate /tmp/infinity-scout-historical/prepared.json
 * Verify:   node --import tsx scripts/scout-historical-fixtures.mjs verify /tmp/infinity-scout-historical/prepared.json
 * Generation imports only exact archived historical production source. Verification alone
 * imports the candidate. Synthetic source-produced fixtures are explicitly labeled.
 */
import assert from 'node:assert/strict';
import { liftR14EnvelopeToR16 } from './r16-compatibility.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createLegacyR6Fixtures } from './legacy-r6-fixture.ts';
import { createLegacyR7Fixtures } from './legacy-r7-fixture.ts';

const [mode = 'verify', preparationPath = '/tmp/infinity-scout-historical/prepared.json', outputArg] = process.argv.slice(2);
assert.ok(['generate', 'verify'].includes(mode));
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = outputArg ?? resolve(repo, 'tests/fixtures/npc-scout-legacy.json');
const prepared = JSON.parse(readFileSync(preparationPath, 'utf8'));
assert.equal(prepared.schema, 'infinity-scout-historical-preparation-v1');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2);
const modules = new Map();
for (const source of Object.values(prepared.sourceBindings)) {
  for (const file of source.sourceFiles) assert.equal(hash(readFileSync(resolve(source.root, file.path))), file.sha256, `unmodified archived r${source.revision}: ${file.path}`);
}
async function load(revision, name) {
  const key = `${revision}/${name}`;
  if (!modules.has(key)) modules.set(key, await import(pathToFileURL(resolve(prepared.sourceBindings[revision].root, `src/game/${name}.ts`)).href));
  return modules.get(key);
}
function accept(result, label) { assert.equal(result.ok, true, `${label}: ${result.reason}`); return result.state; }
function differences(a, b, path = '') {
  if (Object.is(a, b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return [path || '$'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => differences(a[k], b[k], `${path}/${k}`));
}
function expectedR14(baseline) {
  const file = structuredClone(baseline); file.revision = 14;
  for (const message of file.state.messages) { assert.equal(Object.hasOwn(message, 'npcScoutSnapshot'), false); message.npcScoutSnapshot = null; }
  return file;
}
function refusal(reader, raw) {
  try { reader.importSave(raw); } catch (error) { return { rejected: true, message: error.message }; }
  throw Error('Historical reader accepted a future-revision envelope');
}
async function originalRows() {
  const rows = structuredClone(prepared.rows);
  for (const [filename, revision, names] of [
    ['terraformer-r9.json', 9, ['continuous_manual', 'full10000_plan', 'complete_world_outbound', 'complete_world_returning']],
    ['demolition-r10.json', 10, ['G10a-earned-grant', 'G10c-mixed-old-new-pending', 'G10d-cancelled-id-gaps', 'C10-real-prestige-floor']],
    ['npc-economy-r11.json', 11, null],
  ]) {
    const bytes = readFileSync(resolve(repo, 'tests/fixtures', filename));
    const container = JSON.parse(bytes);
    assert.equal(container.sourceSha, prepared.sourceBindings[revision].sourceSha);
    for (const [index, row] of container.rows.entries()) {
      const name = row.id ?? row.name;
      if (names && !names.includes(name)) continue;
      assert.equal(hash(row.raw), row.rawSha256);
      rows.push({ id: `r${revision}-${name}`, revision, sourceSha: container.sourceSha, raw: row.raw, rawSha256: row.rawSha256,
        rawBytes: Buffer.byteLength(row.raw), synthetic: row.synthetic, naturalProgression: row.naturalProgression === true,
        provenance: { kind: 'committed-original-source-export-string', file: `tests/fixtures/${filename}`, fileSha256: hash(bytes), jsonPath: `rows[${index}].raw`,
          producerSha256: container.producerSha256 ?? container.producer?.sha256 ?? null,
          sourceNormalizationClaim: row.canonical ?? null, bytes: 'Original raw string copied unchanged.' } });
    }
  }
  const bytes = readFileSync(resolve(repo, 'tests/fixtures/building-templates-r8.json'));
  const fixed = JSON.parse(bytes);
  assert.equal(fixed.sourceSha, prepared.sourceBindings[8].sourceSha);
  for (const [phase, value] of Object.entries(fixed.fixtures)) {
    const raw = json(value);
    // This is recovered serialization, not a byte-slice claim. Exact historical hash is mandatory.
    assert.equal(hash(raw), fixed.sha256[phase], `exact recorded r8 ${phase} original export bytes`);
    rows.push({ id: `r8-${phase}`, revision: 8, raw, rawSha256: hash(raw), rawBytes: Buffer.byteLength(raw), sourceSha: fixed.sourceSha, synthetic: true, naturalProgression: false,
      provenance: { kind: 'committed-export-recovered-by-exact-original-hash', file: 'tests/fixtures/building-templates-r8.json', fileSha256: hash(bytes), jsonPath: `fixtures.${phase}`, generatedBy: fixed.generatedBy,
        bytes: 'JSON.stringify(object, null, 2) recovered exact original export bytes verified against the original committed SHA256.' } });
  }
  return rows;
}
async function sourceProducedRows() {
  const rows = [];
  async function record(revision, name, state, provenance) {
    const save = await load(revision, 'save');
    const raw = save.exportSave(state, 1_000_000);
    assert.equal(JSON.parse(raw).revision, revision, 'The actual historical serializer must emit this revision without edits');
    rows.push({ id: `r${revision}-${name}`, revision, raw, rawSha256: hash(raw), rawBytes: Buffer.byteLength(raw), sourceSha: prepared.sourceBindings[revision].sourceSha,
      synthetic: true, naturalProgression: false, provenance: { kind: 'new-unmodified-historical-serializer-output', ...provenance } });
  }
  for (let revision = 2; revision <= 7; revision++) {
    const [factory, decimal, fleet, galaxy, logic] = await Promise.all(['state', 'decimal', 'fleet', 'galaxy', 'logic'].map(name => load(revision, name)));
    let state = factory.createInitialState(20261011 + revision); state.arcade.seed = 20261011 + revision;
    const planet = state.planets[0];
    // Explicit synthetic setup, followed only by genuine paid dispatch and flight APIs.
    Object.assign(planet.buildings, { research_lab: 4, shipyard: 3, robotics_factory: 1, metal_mine: 5, crystal_mine: 3, solar_plant: 8 });
    Object.assign(state.research.levels, { combustion_drive: 3, espionage_tech: 2, computer_tech: 3, energy_tech: 3 });
    planet.resources = { metal: decimal.big(2e6), crystal: decimal.big(1e6), deuterium: decimal.big(3e5) };
    planet.units.espionage_probe = 1;
    state = logic.tick(state, 0);
    let target;
    outer: for (let system = 1; system <= 100; system++) for (let position = 1; position <= 15; position++) {
      const coordinates = { galaxy: 1, system, position };
      if (galaxy.npcAt(state, coordinates)) { target = coordinates; break outer; }
    }
    assert.ok(target);
    state = accept(fleet.sendFleet(state, { mission: 'scout', target, ships: { espionage_probe: 1 }, cargo: fleet.emptyCargo(), speedPercent: 100 }), `r${revision} paid scout`);
    const provenance = { setup: 'Synthetic resources, completed prerequisites, one probe and fixed seeds. Real historical sendFleet pays fuel and allocates the ID; real tick produces arrival/text. No envelope/state reconstruction or retagging.', actions: ['createInitialState', 'tick(0)', 'sendFleet(scout)', 'tick(partial)', 'tick(arrival)', 'tick(return)'] };
    const half = state.fleets[0].duration / 2;
    state = logic.tick(state, half);
    await record(revision, 'scout-outbound-halfway', state, provenance);
    state = logic.tick(state, half);
    assert.equal(state.fleets[0].returning, true);
    assert.ok(state.messages.some(m => m.id === 'scout-1'));
    await record(revision, 'scout-returning', state, provenance);
    state = logic.tick(state, state.fleets[0].remaining);
    assert.equal(state.fleets.length, 0);
    await record(revision, 'scout-returned', state, provenance);
    if (revision <= 5) {
      const [queue, research, yard] = await Promise.all(['queue', 'research', 'shipyard'].map(name => load(revision, name)));
      state = accept(queue.enqueue(state, 'metal_mine', 'manual'), 'real paid building queue');
      state = accept(research.enqueueResearch(state, 'computer_tech', 'manual'), 'real paid research queue');
      state = accept(yard.enqueueUnits(state, 'small_cargo', 7, 'manual'), 'real paid ship queue');
      state = yard.advanceShipyard(state, yard.unitSeconds(state, 'small_cargo') * 2.5, false).state;
      if (revision === 5) {
        const orders = await load(5, 'orders');
        state = accept(orders.createOrderTask(state, { kind: 'building', building: 'crystal_mine', targetLevel: 5, planetId: state.activePlanetId, expectedNextTaskId: state.orders.nextTaskId, budget: { metal: '1000000', crystal: '1000000', deuterium: '1000000' } }), 'r5 real finite plan');
        state = orders.advanceOrderPlans(state, 10);
        assert.ok(state.orders.tasks[0].activeJob);
      }
      await record(revision, 'scout-history-paid-queues', logic.tick(state, 0), { ...provenance, paidQueues: 'Real building/research/shipyard payment and partial production; r5 additionally owns a real paid finite plan.' });
    }
  }
  for (const [revision, producer] of [[6, createLegacyR6Fixtures], [7, createLegacyR7Fixtures]]) {
    const save = await load(revision, 'save');
    const results = await producer(prepared.sourceBindings[revision].root, 1_000_000);
    for (const [phase, envelope] of Object.entries(results)) {
      // Recover source state through its own reader, then take exact source serializer bytes.
      const state = save.deserializeState(save.importSave(JSON.stringify(envelope)).state);
      await record(revision, `paid-transport-${phase}`, state, { producer: `scripts/legacy-r${revision}-fixture.ts`, producerSha256: hash(readFileSync(resolve(repo, `scripts/legacy-r${revision}-fixture.ts`))), setup: 'Existing explicitly synthetic source-only paid transport/research producer. Original source reader and serializer produce the final raw bytes.' });
    }
  }
  return rows;
}
async function syntheticR13Rows(rows) {
  const parent = rows.find(row => row.id === 'r13-new-scout6-outbound'); assert.ok(parent);
  const [save, decimal, logic] = await Promise.all(['save', 'decimal', 'logic'].map(name => load(13, name)));
  const result = [];
  for (const collision of ['none', 'unfilled', 'oldest-full']) {
    let state = save.deserializeState(save.importSave(parent.raw).state);
    const scout = state.fleets.find(f => f.mission === 'scout' && !f.returning); assert.ok(scout);
    scout.cargo = { metal: decimal.big(1), crystal: decimal.big(2.5), deuterium: decimal.big(3) };
    if (collision !== 'none') {
      const oldMessage = { id: `scout-${scout.id}`, at: 0, text: 'Synthetic old-reader collision' };
      if (collision === 'oldest-full') state.messages = [oldMessage, ...Array.from({ length: 149 }, (_, i) => ({ id: `synthetic-fill-${i}`, at: 0, text: `Synthetic historical filler ${i}` }))];
      else state.messages.push(oldMessage);
    }
    const raw = save.exportSave(state, JSON.parse(parent.raw).savedAt);
    const sourceReaderOutput = save.importSave(raw);
    state = save.deserializeState(sourceReaderOutput.state);
    const arrivalSeconds = state.fleets.find(f => f.id === scout.id).remaining;
    state = logic.tick(state, arrivalSeconds);
    // A colliding historical message duplicates its ID on arrival; old reader refusal
    // is recorded instead of pretending this old runtime output was importable.
    const arrivalRaw = save.exportSave(state, JSON.parse(parent.raw).savedAt);
    let arrivalOutput = null, arrivalReaderError = null;
    try { arrivalOutput = save.importSave(arrivalRaw); } catch (error) { arrivalReaderError = error.message; }
    const returnSeconds = state.fleets.find(f => f.id === scout.id).remaining;
    state = logic.tick(state, returnSeconds);
    const returnRaw = save.exportSave(state, JSON.parse(parent.raw).savedAt);
    let returnOutput = null, returnReaderError = null;
    try { returnOutput = save.importSave(returnRaw); } catch (error) { returnReaderError = error.message; }
    result.push({ id: collision === 'none' ? 'r13-synthetic-scout-cargo' : collision === 'unfilled' ? 'r13-synthetic-scout-message-collision' : 'r13-synthetic-scout-oldest-full-collision', revision: 13, raw, rawSha256: hash(raw), rawBytes: Buffer.byteLength(raw), sourceSha: parent.sourceSha, synthetic: true, naturalProgression: false,
      provenance: { kind: 'new-unmodified-historical-serializer-output', parentRawSha256: parent.rawSha256, explicitEdits: ['Live scout cargo assigned [1, 2.5, 3] using archived Decimal.', ...(collision === 'none' ? [] : collision === 'unfilled' ? ['One text-only message appended with same scout ID before arrival.'] : ['Message list replaced with 150 synthetic old messages; same scout ID occupies oldest index 0.'])], scope: 'Synthetic old accepted-state boundary, not an authorized new dispatch; old quote forbids nonempty scout cargo.' },
      legacyBoundary: { sourceSha: parent.sourceSha, collision, arrivalSeconds, oldArrivalRaw: arrivalRaw, oldArrivalState: JSON.parse(arrivalRaw).state, oldArrivalReaderOutput: arrivalOutput, oldArrivalReaderError: arrivalReaderError, returnSeconds, oldReturnRaw: returnRaw, oldReturnState: JSON.parse(returnRaw).state, oldReturnReaderOutput: returnOutput, oldReturnReaderError: returnReaderError } });
  }
  return result;
}

if (mode === 'generate') {
  const rows = [...await sourceProducedRows(), ...await originalRows()];
  rows.push(...await syntheticR13Rows(rows));
  const r13 = await load(13, 'save');
  for (const row of rows) {
    const reader = await load(row.revision, 'save');
    assert.equal(hash(row.raw), row.rawSha256); assert.equal(JSON.parse(row.raw).revision, row.revision);
    row.sourceReaderOutput = reader.importSave(row.raw);
    row.r13ReaderOutput = r13.importSave(row.raw);
    row.sourceReaderOutputSha256 = hash(json(row.sourceReaderOutput));
    row.r13ReaderOutputSha256 = hash(json(row.r13ReaderOutput));
    row.sourceNormalization = { changed: differences(JSON.parse(row.raw), row.sourceReaderOutput).length > 0, changedPaths: differences(JSON.parse(row.raw), row.sourceReaderOutput) };
    const probe = json(expectedR14(row.r13ReaderOutput));
    row.sourceRefusesR14 = { ...refusal(reader, probe), inputKind: 'synthetic-next-revision-envelope-probe', inputSha256: hash(probe) };
    const invalid = JSON.parse(row.raw); invalid.state.nextFleetId = 0;
    row.sourceNegativeControl = { mutation: 'state.nextFleetId = 0', ...refusal(reader, json(invalid)) };
  }
  rows.sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id));
  assert.deepEqual([...new Set(rows.map(row => row.revision))], Array.from({ length: 12 }, (_, i) => i + 2));
  const sourceBindings = Object.fromEntries(Object.entries(prepared.sourceBindings).map(([revision, binding]) => { const { root, ...publicBinding } = binding; return [revision, publicBinding]; }));
  const result = { schema: 'infinity-scout-genuine-legacy-fixtures-v1', generatedBy: { path: 'scripts/scout-historical-fixtures.mjs', sha256: hash(readFileSync(fileURLToPath(import.meta.url))), preparationPath: 'scripts/scout-historical-fixtures.py', preparationSha256: hash(readFileSync(resolve(repo, 'scripts/scout-historical-fixtures.py'))), runtimeNode: process.version, dependencyLockSha256: hash(readFileSync(resolve(repo, 'package-lock.json'))), decimalPackageVersion: JSON.parse(readFileSync(resolve(repo, 'node_modules/break_infinity.js/package.json'))).version },
    boundary: 'Actual supported historical source exports and original raw records. New fixtures are labeled synthetic. Every source reader and exact archived 7554 r13 reader ran independently; no candidate code is imported during generation. Old normalization differences are explicit. New-revision refusal probes are negative tests, never historical migration provenance. Original artifact results are historical and do not claim new native/CI acceptance.',
    sourceBindings, originalReports: prepared.originalReports, rows };
  writeFileSync(output, json(result) + '\n');
  console.log(json({ output: relative(repo, output), rows: rows.length, revisions: [...new Set(rows.map(row => row.revision))], changedByOldNormalization: rows.filter(row => row.sourceNormalization.changed).map(row => row.id), bytes: Buffer.byteLength(json(result) + '\n'), sha256: hash(readFileSync(output)) }));
} else {
  const fixture = JSON.parse(readFileSync(output, 'utf8'));
  const candidate = await import(pathToFileURL(resolve(repo, 'src/game/save.ts')).href);
  const checked = [];
  for (const row of fixture.rows) {
    assert.equal(hash(row.raw), row.rawSha256);
    const sourceReader = await load(row.revision, 'save');
    const r13 = await load(13, 'save');
    assert.deepEqual(sourceReader.importSave(row.raw), row.sourceReaderOutput, `${row.id}: original old reader acceptance`);
    assert.deepEqual(r13.importSave(row.raw), row.r13ReaderOutput, `${row.id}: independently fixed r13 baseline`);
    const actual = candidate.importSave(row.raw);
    assert.deepEqual(actual, liftR14EnvelopeToR16(expectedR14(row.r13ReaderOutput)), `${row.id}: exact full old-normalized envelope, only independently verified null slots, inactive challenge field and output revision added`);
    assert.deepEqual(candidate.importSave(json(actual)), actual, `${row.id}: candidate stable roundtrip`);
    const refusalEvidence = refusal(sourceReader, json(actual));
    const invalid = JSON.parse(row.raw); invalid.state.nextFleetId = 0;
    assert.throws(() => sourceReader.importSave(json(invalid)));
    assert.throws(() => candidate.importSave(json(invalid)));
    const smuggled = JSON.parse(row.raw); smuggled.state.npcScoutSnapshot = null;
    assert.throws(() => candidate.importSave(json(smuggled)), `${row.id}: raw legacy marker must fail before normalization`);
    checked.push({ id: row.id, revision: row.revision, messages: actual.state.messages.length, fullProjection: 'exact', actualCandidateRefusedByOldSource: refusalEvidence });
  }
  console.log(json({ schema: 'infinity-scout-genuine-legacy-verification-v1', candidateSaveSha256: hash(readFileSync(resolve(repo, 'src/game/save.ts'))), fixtureSha256: hash(readFileSync(output)), rows: checked.length, checks: checked, status: 'passed' }));
}
