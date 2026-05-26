import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISPATCH_VIA_DEFAULTS,
  VALID_ENVIRONMENTS,
  VALID_EXECUTION_LANES,
  VALID_TYPES,
  WRITERS_ROOM_TASK_TYPES,
  isUuid,
} from './src/contracts.js';

test('dispatch defaults cover the planned entry providers', () => {
  assert.equal(DISPATCH_VIA_DEFAULTS.Codex, 'coder');
  assert.equal(DISPATCH_VIA_DEFAULTS.Manual, 'planner');
});

test('contract enums include the Lab mirror execution surface', () => {
  assert.equal(VALID_EXECUTION_LANES.has('writers-room'), true);
  assert.equal(VALID_ENVIRONMENTS.has('production'), true);
  assert.equal(VALID_TYPES.has('Creative'), true);
  assert.equal(WRITERS_ROOM_TASK_TYPES.has('Full Scene Draft'), true);
});

test('uuid validator accepts canonical ids and rejects bad strings', () => {
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isUuid('not-a-uuid'), false);
});
