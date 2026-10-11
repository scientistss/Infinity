/** Offline independent-oracle tests; no production imports, browser or JS bundle. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  liftR10StateToR11, assertNullDemolitionSlots, liftR8StateToR11,
  assertTerraformerMetadata, assertR8StatePreserved,
} from './r11-compatibility.mjs';

const evidence = JSON.parse(readFileSync(new URL('../tests/fixtures/demolition-r10.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

test('the original JavaScript r10 helper stays byte-identical', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('./r8-compatibility.mjs', import.meta.url))).digest('hex'),
    'd5bed35437c3549f70fe19827e292d174cb38b85534f6cf16b6ad98868664645');
});

test('every fixed r10 reader state gains only an ordered null slot', () => {
  assert.equal(evidence.sourceSha, 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a');
  assert.ok(evidence.rows.length >= 12);
  for (const row of evidence.rows) {
    const historical = clone(row.oldReaderOutput.state), saved = clone(historical);
    const actual = liftR10StateToR11(historical);
    assert.deepEqual(historical, saved, `${row.id}: unchanged source`);
    assert.deepEqual(assertNullDemolitionSlots(actual, historical, row.id), historical);
    assert.equal(actual.terraformerGrantJobFloor, historical.terraformerGrantJobFloor);
    for (let index = 0; index < historical.planets.length; index++) {
      const prior = historical.planets[index], lifted = actual.planets[index];
      const keys = Object.keys(prior);
      keys.splice(keys.indexOf('buildQueue') + 1, 0, 'demolition');
      assert.deepEqual(Object.keys(lifted), keys);
      assert.equal(lifted.demolition, null);
      assert.deepEqual(lifted.terraformerFields, prior.terraformerFields);
      assert.deepEqual(lifted.buildQueue, prior.buildQueue);
      assert.deepEqual(lifted.shipyardQueue, prior.shipyardQueue);
    }
  }
});

test('historical slots including null and missing old queue are rejected', () => {
  for (const value of [null, undefined, {}, [], false, 0, { kind: 'demolition', jobId: 1 }]) {
    const historical = clone(evidence.rows[0].oldReaderOutput.state);
    historical.planets[0].demolition = value;
    assert.throws(() => liftR10StateToR11(historical));
  }
  const historical = clone(evidence.rows[0].oldReaderOutput.state);
  delete historical.planets[0].buildQueue;
  assert.throws(() => liftR10StateToR11(historical));
});

test('missing and every non-null new slot fail closed', () => {
  const historical = evidence.rows[2].oldReaderOutput.state;
  for (const value of [undefined, {}, [], false, 0, '', 'null', { kind: 'demolition', jobId: 1 }]) {
    for (let index = 0; index < historical.planets.length; index++) {
      const actual = clone(liftR10StateToR11(historical));
      actual.planets[index].demolition = value;
      assert.throws(() => assertNullDemolitionSlots(actual, historical, 'malicious slot'));
    }
  }
  const actual = clone(liftR10StateToR11(historical));
  delete actual.planets[0].demolition;
  assert.throws(() => assertNullDemolitionSlots(actual, historical, 'missing slot'));
});

test('planet order, identity and count cannot be projected away', () => {
  const historical = evidence.rows[2].oldReaderOutput.state;
  for (const mutate of [p => p.reverse(), p => p.pop(), p => p.push(clone(p[0])), p => { p[0].id = 'forged'; }]) {
    const actual = clone(liftR10StateToR11(historical));
    mutate(actual.planets);
    assert.throws(() => assertNullDemolitionSlots(actual, historical, 'identity'));
  }
});

test('old values, earned grants and unrelated extra fields remain observable', () => {
  const historical = evidence.rows[2].oldReaderOutput.state;
  for (const mutate of [
    s => { s.planets[0].resources.metal = '123456789'; },
    s => { s.planets[0].terraformerFields.grantedLevels = 999; },
    s => { s.orders.nextJobId++; },
    s => { s.planets[0].extraOldField = { paid: '123' }; },
    s => { s.extraStateField = [true, 'retain']; },
    s => { s.planets[0].buildQueue.push({ forged: 'old queue value' }); },
  ]) {
    const actual = clone(liftR10StateToR11(historical));
    mutate(actual);
    const expected = clone(actual);
    for (const planet of expected.planets) delete planet.demolition;
    const projected = assertNullDemolitionSlots(actual, historical, 'remainder');
    assert.deepEqual(projected, expected);
    assert.notDeepEqual(projected, historical);
  }
});

test('r8 composition adds only the prior fixed r10 metadata and null slots', () => {
  const historical = JSON.parse(evidence.legacyInputs[0].raw).state;
  delete historical.buildingTemplates;
  const floor = historical.orders.nextJobId, frozen = clone(historical);
  const actual = liftR8StateToR11(historical, floor);
  assertR8StatePreserved(actual, historical, 'r8 composition', floor);
  assert.deepEqual(historical, frozen);
  const projected = assertTerraformerMetadata(actual, historical, floor, 'r8 projection');
  assert.deepEqual(projected, { buildingTemplates: { nextTemplateId: 1, templates: [] }, ...historical });
});

test('full preservation rejects old-value mutation, new work and a rebased floor', () => {
  const historical = JSON.parse(evidence.legacyInputs[0].raw).state;
  delete historical.buildingTemplates;
  const floor = historical.orders.nextJobId;
  for (const mutate of [
    s => { s.planets[0].resources.metal = '7'; },
    s => { s.planets[0].demolition = {}; },
    s => { delete s.planets[0].demolition; },
    s => { s.planets[0].demolition = { kind: 'demolition', jobId: floor }; },
    s => { s.terraformerGrantJobFloor++; },
    s => { s.extraOldField = 'must not be dropped'; },
  ]) {
    const actual = clone(liftR8StateToR11(historical, floor));
    mutate(actual);
    assert.throws(() => assertR8StatePreserved(actual, historical, 'forged preservation', floor));
  }
});
