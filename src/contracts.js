export const DISPATCH_PACKET_VERSION = '1.1';

export const VALID_DISPATCH_VIA = new Set([
  'Claude',
  'Claude Code',
  'Gemini',
  'Cursor',
  'Codex',
  'Copilot',
  'Antigravity',
  'Manual',
]);

export const VALID_EXECUTION_LANES = new Set([
  'main',
  'planner',
  'coder',
  'reviewer',
  'dev',
  'sentinel',
  'sentinel-deploy',
  'scout',
  'bayview',
  'bayview-thinking',
  'bayview-tuning',
  'thinker',
  'ops',
  'writers-room',
]);

export const VALID_ENVIRONMENTS = new Set(['dev', 'staging', 'production', 'sandbox']);
export const VALID_TYPES = new Set([
  'Gauntlet',
  'Measurement Track',
  'Literature Survey',
  'Design Spec',
  'Feasibility Analysis',
  'Implementation',
  'Operational',
  'Review',
  'Experiment',
  'Fact-Check',
  'Creative',
  'Other',
]);

export const TERMINAL_STATUSES = new Set([
  'Done',
  'Kill Condition Met',
  'Inconclusive',
  'Closed',
  'Blocked',
]);

export const BLOCKING_DISPATCH_MODES = new Set(['incubate']);
export const BLOCKING_DISPATCH_BLOCKS = new Set(['pre_repo_incubation', 'safety_hold']);
export const BLOCKING_ESCALATION_LEVELS = new Set(['Needs Sam', 'Critical']);

export const DISPATCH_VIA_DEFAULTS = {
  Claude: 'main',
  'Claude Code': 'coder',
  Gemini: 'thinker',
  Cursor: 'dev',
  Codex: 'coder',
  Copilot: 'reviewer',
  Antigravity: 'ops',
  Manual: 'planner',
};

export const LANE_CONSTRAINTS = {
  main: { can_code: true, can_browse: true, can_deploy: false, write_scope: 'repo', max_timeout_s: 3600 },
  planner: { can_code: false, can_browse: true, can_deploy: false, write_scope: 'none', max_timeout_s: 1800 },
  coder: { can_code: true, can_browse: true, can_deploy: false, write_scope: 'repo', max_timeout_s: 3600 },
  reviewer: { can_code: false, can_browse: true, can_deploy: false, write_scope: 'read_only', max_timeout_s: 1800 },
  dev: { can_code: true, can_browse: true, can_deploy: false, write_scope: 'repo', max_timeout_s: 3600 },
  sentinel: { can_code: false, can_browse: true, can_deploy: true, write_scope: 'deploy', max_timeout_s: 3600 },
  'sentinel-deploy': { can_code: false, can_browse: true, can_deploy: true, write_scope: 'deploy', max_timeout_s: 3600 },
  scout: { can_code: false, can_browse: true, can_deploy: false, write_scope: 'read_only', max_timeout_s: 1800 },
  thinker: { can_code: false, can_browse: true, can_deploy: false, write_scope: 'none', max_timeout_s: 2400 },
  ops: { can_code: true, can_browse: true, can_deploy: true, write_scope: 'repo_and_runtime', max_timeout_s: 3600 },
  'writers-room': { can_code: false, can_browse: true, can_deploy: false, write_scope: 'story_artifacts', max_timeout_s: 2400 },
};

export const RETURN_STATUS_TO_STATE = {
  ok: { status: 'Done' },
  error: { status: 'Blocked' },
  gated: { status: 'Blocked' },
  timeout: { status: 'Blocked' },
};

export const WRITERS_ROOM_TASK_TYPES = new Set([
  'Full Scene Draft',
  'Scene Revision',
  'Beat Sheet Only',
  'Research Query',
  'Character Development',
  'Episode Outline',
  'Dialogue Polish',
  'Motif Placement',
]);

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function nowIso() {
  return new Date().toISOString();
}

export function asJsonText(value) {
  return JSON.stringify(value, null, 2);
}

export function parseJsonField(value, fieldName) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for ${fieldName}: ${error.message}`);
  }
}
