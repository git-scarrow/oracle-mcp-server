import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DISPATCH_VIA_DEFAULTS,
  VALID_ENVIRONMENTS,
  VALID_EXECUTION_LANES,
  VALID_TYPES,
  WRITERS_ROOM_TASK_TYPES,
  isAutoBlockReason,
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

test('isAutoBlockReason matches each computed (auto) block-reason prefix', () => {
  // One realistic value per AUTO_BLOCK_PREFIXES entry — these are re-derived
  // live by V15-V20, so V18 must treat them as transient (not human) blocks.
  const autoReasons = [
    'Work item is marked for Lab-only incubation',
    'Dispatch block is active (safety_hold)',
    'Repo execution is not ready for this work item',
    'Escalated for human review (Needs Sam)',
    'Project WIP cap reached for Pontius (2/2)',
  ];
  for (const reason of autoReasons) {
    assert.equal(isAutoBlockReason(reason), true, `expected auto: ${reason}`);
  }
});

test('isAutoBlockReason treats human/preflight reasons as genuine blocks', () => {
  assert.equal(isAutoBlockReason('Container failed to start: missing API key'), false);
  assert.equal(isAutoBlockReason('Manually held pending design decision'), false);
  assert.equal(isAutoBlockReason(''), false);
  assert.equal(isAutoBlockReason(null), false);
  assert.equal(isAutoBlockReason(undefined), false);
});
