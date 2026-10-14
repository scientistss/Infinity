#!/usr/bin/env node
/** Read-only original prefix replay, deliberately separate from acceptance. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { solarMathProbe } from './solar-math-probe.mjs';
const [source, artifact, output] = process.argv.slice(2).map(value => resolve(value));
assert(source && artifact && output);
const sha = raw => createHash('sha256').update(raw).digest('hex');
const read = name => readFileSync(resolve(artifact, name));
const identity = JSON.parse(read('energy-solar-evidence/000000-common-identity.json')).identity;
assert.equal(identity.source.sourceSha, '309ec2037c0f4412c913d07bc7263d4f83b1f153');
assert.equal(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), identity.source.fullTree);
for (const [name, hash] of Object.entries(identity.source.sourceCode)) assert.equal(sha(readFileSync(resolve(source, name))), hash, name);
const load = name => import(pathToFileURL(resolve(source, 'src', name)).href);
const [{ createInitialState }, { SaveSession }, { STORAGE_KEY }, { tick }, { enqueue }, { serializeState }, { economy }, { big }, { solarOutputPerHour }] = await Promise.all(['game/state.ts', 'game/save-session.ts', 'game/content.ts', 'game/logic.ts', 'game/queue.ts', 'game/save.ts', 'game/economy.ts', 'game/decimal.ts', 'game/formulas.ts'].map(load));
const events = JSON.parse(read('energy-solar-evidence/natural/solar/receipts.json'));
const states = read('energy-solar-evidence/oracle/expectedStates.jsonl').toString().trim().split('\n').map(JSON.parse);
const native = JSON.parse(read('energy-solar-evidence/000076-failure-trace.json'));
assert.deepEqual(native.events[1029].state, states[115].state);
assert.equal(events[116].index, 117); assert.equal(events[116].api, 'tick');
const map = new Map(), store = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
const epoch = 1791849600000;
let state = createInitialState(20261013, 20261013), seconds = 0, session = new SaveSession(store, epoch), operands;
for (const event of events.slice(0, 117)) {
  if (event.index === 117) operands = solarMathProbe(state, economy(state), big, solarOutputPerHour);
  if (event.api === 'tick') { state = tick(state, 1, 'live'); seconds++; }
  else if (event.api === 'enqueue') { const result = enqueue(state, event.request.target, 'manual'); assert(result.ok); state = result.state; }
  else if (event.api === 'checkpoint') {
    assert.equal(event.request.name, 'initial'); assert(session.save(state, epoch, epoch).ok);
    assert.equal(map.get(STORAGE_KEY), states[event.index - 1].raw);
    session = new SaveSession(store, epoch); assert.equal(session.loaded.appliedSeconds, 0); state = session.loaded.state;
  } else assert.equal(event.api, 'createInitialState');
  if (event.index < 117) assert.deepEqual(serializeState(state), states[event.index - 1].state, `Original complete state ${event.index}`);
}
const actual = serializeState(state);
const result = { schema: 'infinity-solar-math-diagnostic-v1', classification: 'read-only numerical diagnosis; not acceptance', sourceSha: identity.source.sourceSha, sourceTree: identity.source.fullTree, runtime: process.versions, executable: { path: process.execPath, sha256: sha(readFileSync(process.execPath)) }, mathImplementation: { api: 'unmodified native Math.pow', v8: process.versions.v8, execArgv: process.execArgv }, sourceReferences: Object.fromEntries(['energy-solar-evidence/natural/solar/receipts.json', 'energy-solar-evidence/oracle/expectedStates.jsonl', 'energy-solar-evidence/000076-failure-trace.json'].map(name => [name, sha(read(name))])), matchedWholeStates: 116, seconds, event117Operands: operands, event116State: states[115].state, actualEvent117State: actual, oracleEvent117State: states[116].state, originalNativeEvent117State: native.events[1033].state, matchesOracle: isDeepStrictEqual(actual, states[116].state), deuterium: { actual: actual.planets[0].resources.deuterium, oracle: states[116].state.planets[0].resources.deuterium, native: native.events[1033].state.planets[0].resources.deuterium } };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ runtime: process.versions.node, deuterium: result.deuterium, output }));
