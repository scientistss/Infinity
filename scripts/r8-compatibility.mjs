/** The sole r8→r9 state addition. Never project away any historical field. */
import assert from 'node:assert/strict';

export function liftR8State(state) {
  assert.ok(state && typeof state === 'object' && !Array.isArray(state), 'historical state must be an object');
  assert.equal(Object.hasOwn(state, 'buildingTemplates'), false, 'actual r8 source must not contain buildingTemplates');
  // Keep all old values, types and array ordering. Place the new field in the
  // current serializer's explicit order for independent native-byte proofs.
  return { buildingTemplates: { nextTemplateId: 1, templates: [] }, ...state };
}

export function assertR8StatePreserved(actual, historical, label) {
  assert.deepEqual(actual.buildingTemplates, { nextTemplateId: 1, templates: [] }, `${label}: sole new library must be empty`);
  assert.deepEqual(actual, liftR8State(historical), `${label}: all historical fields, types and array order unchanged`);
}
