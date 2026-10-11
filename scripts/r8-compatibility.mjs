/** Explicit additive legacy lifts. Never normalize or discard a historical value. */
import assert from 'node:assert/strict';

/** Retained r8→r9 contract, also used to preserve the archived intermediate shape. */
export function liftR8State(state) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'historical state must be an object');
  assert.equal(Object.hasOwn(state, 'buildingTemplates'), false, 'actual r8 source must not contain buildingTemplates');
  return { buildingTemplates: { nextTemplateId: 1, templates: [] }, ...state };
}

/** floor belongs to the migration/start snapshot, never a later runtime counter. */
export function liftR9StateToR10(state, floor) {
  assert.ok(Number.isSafeInteger(floor) && floor >= 1 && floor <= state.orders.nextJobId, 'explicit valid starting grant floor required');
  assert.equal(Object.hasOwn(state, 'terraformerGrantJobFloor'), false, 'historical source has no r10 floor');
  return { terraformerGrantJobFloor: floor, ...state, planets: state.planets.map(planet => {
    assert.equal(Object.hasOwn(planet, 'terraformerFields'), false, 'historical planet has no r10 grant ledger');
    // Match actual serializePlanet insertion order without sorting any old keys.
    return Object.fromEntries(Object.entries(planet).flatMap(([key, value]) => key === 'fieldsMax'
      ? [[key, value], ['terraformerFields', { base: value, grantedLevels: 0 }]] : [[key, value]]));
  }) };
}

export function liftR8StateToR10(state, floor) {
  return liftR9StateToR10(liftR8State(state), floor);
}

/** Assert every new value separately before returning an exact prior-field view. */
export function assertTerraformerMetadata(actual, historical, floor, label) {
  assert.ok(Number.isSafeInteger(floor) && floor >= 1 && floor <= actual.orders.nextJobId, `${label}: explicit starting floor`);
  assert.equal(actual.terraformerGrantJobFloor, floor, `${label}: fixed migration/start floor`);
  assert.deepEqual(actual.planets.map(planet => planet.id), historical.planets.map(planet => planet.id), `${label}: planet identities and ordering`);
  for (let index = 0; index < historical.planets.length; index++) {
    assert.deepEqual(actual.planets[index].terraformerFields, {base: historical.planets[index].fieldsMax, grantedLevels: 0}, `${label}: unchanged base and zero grants on non-terraformer trajectory`);
    assert.equal(actual.planets[index].fieldsMax, historical.planets[index].fieldsMax, `${label}: historical field capacity`);
  }
  const prior = structuredClone(actual);
  delete prior.terraformerGrantJobFloor;
  for (const planet of prior.planets) delete planet.terraformerFields;
  return prior;
}

export function assertR8StatePreserved(actual, historical, label, floor) {
  assert.deepEqual(actual.buildingTemplates, { nextTemplateId: 1, templates: [] }, `${label}: new building library must be empty`);
  assertTerraformerMetadata(actual, historical, floor, label);
  assert.deepEqual(actual, liftR8StateToR10(historical, floor), `${label}: all historical fields, types and array order unchanged`);
}
