/** Independent, additive demolition-null migration expectations. No production imports. */
import assert from 'node:assert/strict';
import { liftR8StateToR10, assertTerraformerMetadata as assertR10Metadata } from './r8-compatibility.mjs';

export function liftR10StateToR11(state) {
  assert.ok(state && Array.isArray(state.planets), 'historical state has ordered planets');
  return { ...state, planets: state.planets.map(planet => {
    assert.equal(Object.hasOwn(planet, 'demolition'), false, 'actual historical planet has no demolition slot');
    assert.ok(Object.hasOwn(planet, 'buildQueue'), 'historical planet has a construction queue');
    return Object.fromEntries(Object.entries(planet).flatMap(([key, value]) => key === 'buildQueue'
      ? [[key, value], ['demolition', null]] : [[key, value]]));
  }) };
}

export function assertNullDemolitionSlots(actual, historical, label) {
  assert.deepEqual(actual.planets.map(p => p.id), historical.planets.map(p => p.id), `${label}: unchanged ordered planet identity`);
  const prior = structuredClone(actual);
  for (const planet of prior.planets) {
    assert.ok(Object.hasOwn(planet, 'demolition'), `${label}: explicit own demolition field`);
    assert.equal(planet.demolition, null, `${label}: no new demolition work or authorization`);
    delete planet.demolition;
  }
  return prior;
}

export function liftR8StateToR11(state, floor) {
  return liftR10StateToR11(liftR8StateToR10(state, floor));
}

export function assertTerraformerMetadata(actual, historical, floor, label) {
  return assertR10Metadata(assertNullDemolitionSlots(actual, historical, label), historical, floor, label);
}

export function assertR8StatePreserved(actual, historical, label, floor) {
  assert.deepEqual(actual.buildingTemplates, { nextTemplateId: 1, templates: [] }, `${label}: new building library remains empty`);
  assertTerraformerMetadata(actual, historical, floor, label);
  assert.deepEqual(actual, liftR8StateToR11(historical, floor), `${label}: all historical fields, scalar types and ordering unchanged`);
}
