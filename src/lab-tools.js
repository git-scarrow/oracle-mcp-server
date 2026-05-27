import crypto from 'crypto';
import {
  asJsonText,
  BLOCKING_DISPATCH_BLOCKS,
  BLOCKING_DISPATCH_MODES,
  BLOCKING_ESCALATION_LEVELS,
  DISPATCH_PACKET_VERSION,
  DISPATCH_VIA_DEFAULTS,
  isAutoBlockReason,
  isUuid,
  LANE_CONSTRAINTS,
  nowIso,
  parseJsonField,
  RETURN_STATUS_TO_STATE,
  TERMINAL_STATUSES,
  VALID_DISPATCH_VIA,
  VALID_ENVIRONMENTS,
  VALID_EXECUTION_LANES,
  VALID_TYPES,
  WRITERS_ROOM_TASK_TYPES,
} from './contracts.js';

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function intOrDefault(value, fallback) {
  return value == null ? fallback : Number(value);
}

// Serialize for a `... FORMAT JSON` bind. Returns SQL NULL (not the literal
// JSON string "null") when the value is absent, so absent and present-but-null
// stay distinguishable in the column.
function jsonOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}

function requireUuid(value, label) {
  if (!isUuid(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

export function buildLabToolDefinitions() {
  return [
    {
      name: 'check_gates',
      description: 'Check Pre-Flight Mode and cascade-depth gates for a work item in the backend-owned Lab mirror.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string', description: 'Work item UUID' },
        },
        required: ['work_item_id'],
      },
    },
    {
      name: 'get_dispatchable_items',
      description: 'List backend-owned Lab work items ready for dispatch.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum items to return (default 25)', default: 25 },
        },
      },
    },
    {
      name: 'build_dispatch_packet',
      description: 'Validate a Lab work item and build an execution packet for an external execution plane.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string', description: 'Work item UUID' },
        },
        required: ['work_item_id'],
      },
    },
    {
      name: 'stamp_dispatch_consumed',
      description: 'Accept dispatch start, stamp consumption, and move a work item to In Progress.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string', description: 'Work item UUID' },
          run_id: { type: 'string', description: 'Dispatch run UUID' },
        },
        required: ['work_item_id', 'run_id'],
      },
    },
    {
      name: 'fail_dispatch_preflight',
      description: 'Record a preflight failure and restore the work item to a dispatch-ready state.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string', description: 'Work item UUID' },
          run_id: { type: 'string', description: 'Dispatch run UUID' },
          reason: { type: 'string', description: 'Blocking reason' },
        },
        required: ['work_item_id', 'run_id', 'reason'],
      },
    },
    {
      name: 'handle_final_return',
      description: 'Ingest a structured execution-plane return payload into the backend-owned Lab mirror.',
      inputSchema: {
        type: 'object',
        properties: {
          work_item_id: { type: 'string' },
          run_id: { type: 'string' },
          status: { type: 'string' },
          summary: { type: 'string' },
          raw_output: { type: 'string' },
          duration_ms: { type: 'number' },
          model: { type: 'string' },
          lane: { type: 'string' },
          verdict: { type: 'string' },
          error: { type: 'string' },
          metrics: { type: ['string', 'object'] },
          artifacts: { type: ['string', 'array'] },
          files_changed: { type: ['string', 'array'] },
          commit_sha: { type: 'string' },
          pr_url: { type: 'string' },
          tool_calls: { type: ['string', 'array'] },
        },
        required: ['work_item_id', 'run_id', 'status', 'summary', 'raw_output', 'duration_ms', 'model', 'lane'],
      },
    },
    {
      name: 'dispatch_scene',
      description: 'Create a scene-item row and fire the writers-room entry signal.',
      inputSchema: {
        type: 'object',
        properties: {
          scene_name: { type: 'string' },
          season: { type: 'number' },
          task_type: { type: 'string' },
          creative_brief: { type: 'string' },
          character_list: { type: ['string', 'array'] },
          episode: { type: 'number' },
          prompt_notes: { type: 'string' },
          work_item_id: { type: 'string' },
        },
        required: ['scene_name', 'season', 'task_type', 'creative_brief'],
      },
    },
  ];
}

class LabRepository {
  constructor(client) {
    this.client = client;
    this.schema = (process.env.ORACLE_DEFAULT_SCHEMA || process.env.LAB_SCHEMA || '').toUpperCase();
  }

  qualify(name) {
    return this.schema ? `${this.schema}.${name}` : name;
  }

  async fetchWorkItem(workItemId) {
    const sql = `
      SELECT wi.*, p.project_name, p.max_active_items, p.focus_flag AS project_focus,
             p.min_terminal_value, p.fork_budget, p.repo_url
      FROM ${this.qualify('lab_work_items')} wi
      LEFT JOIN ${this.qualify('lab_projects')} p ON p.project_id = wi.project_id
      WHERE wi.work_item_id = :1
    `;
    const result = await this.client.execute(sql, [workItemId], { maxRows: 1 });
    return result.rows[0] || null;
  }

  async getControlFlag(parameterName) {
    const sql = `
      SELECT parameter_name, flag_value, number_value, text_value
      FROM ${this.qualify('lab_control')}
      WHERE parameter_name = :1
    `;
    const result = await this.client.execute(sql, [parameterName], { maxRows: 1 });
    return result.rows[0] || null;
  }

  async countActiveProjectItems(projectId) {
    const sql = `
      SELECT COUNT(*) AS active_count
      FROM ${this.qualify('lab_work_items')}
      WHERE project_id = :1
        AND lab_dispatch_consumed_at IS NOT NULL
        AND return_received_at IS NULL
    `;
    const result = await this.client.execute(sql, [projectId], { maxRows: 1 });
    return Number(result.rows[0]?.ACTIVE_COUNT || result.rows[0]?.active_count || 0);
  }

  async listDispatchable(limit) {
    const sql = `
      SELECT *
      FROM ${this.qualify('lab_dispatch_queue_v')}
      WHERE is_dispatchable = 1
      ORDER BY lab_dispatch_requested_at, created_at
      FETCH FIRST ${Math.max(1, Math.min(limit, 100))} ROWS ONLY
    `;
    const result = await this.client.execute(sql, []);
    return result.rows;
  }

  async insertEvent(eventType, aggregateType, aggregateId, payload) {
    const sql = `
      INSERT INTO ${this.qualify('lab_domain_events')}
        (event_id, event_type, aggregate_type, aggregate_id, payload_json, created_at)
      VALUES
        (SYS_GUID(), :1, :2, :3, :4 FORMAT JSON, SYSTIMESTAMP)
    `;
    await this.client.execute(sql, [eventType, aggregateType, aggregateId, JSON.stringify(payload)], { autoCommit: true });
  }

  async acceptDispatchStart(workItemId, runId) {
    const sql = `
      UPDATE ${this.qualify('lab_work_items')}
      SET run_id = :2,
          lab_dispatch_consumed_at = SYSTIMESTAMP,
          status = 'In Progress',
          updated_at = SYSTIMESTAMP
      WHERE work_item_id = :1
        AND lab_dispatch_requested_at IS NOT NULL
        AND lab_dispatch_consumed_at IS NULL
    `;
    const result = await this.client.execute(sql, [workItemId, runId], { autoCommit: true });
    return result.rowCount;
  }

  async restoreDispatchReady(workItemId, runId, reason) {
    // Mirror notion-forge fail_dispatch_preflight: revert the dispatch start
    // (clear run_id / consumed_at, reset to a dispatch-ready status) but WRITE
    // the failure reason into blocked_reason, so the item is Blocked for human
    // review rather than auto-redispatched. The V18 gate only fires on
    // human/preflight reasons (it ignores AUTO_BLOCK_PREFIXES via
    // isAutoBlockReason), so transient computed conditions don't trap the item
    // while a genuine preflight failure correctly holds it. Auto-restoring here
    // would risk the known preflight->redispatch->preflight cycle.
    const sql = `
      UPDATE ${this.qualify('lab_work_items')}
      SET run_id = NULL,
          lab_dispatch_consumed_at = NULL,
          blocked_reason = :3,
          status = CASE
            WHEN prompt_drafts IS NOT NULL THEN 'Prompt Drafted'
            ELSE 'Not Started'
          END,
          updated_at = SYSTIMESTAMP
      WHERE work_item_id = :1
        AND run_id = :2
    `;
    const result = await this.client.execute(sql, [workItemId, runId, reason], { autoCommit: true });
    return result.rowCount;
  }

  async ingestFinalReturn(payload) {
    const mappedState = RETURN_STATUS_TO_STATE[payload.status];
    if (!mappedState) {
      throw new Error(`Unsupported return status: ${payload.status}`);
    }

    const sql = `
      UPDATE ${this.qualify('lab_work_items')}
      SET return_received_at = SYSTIMESTAMP,
          return_consumed_at = SYSTIMESTAMP,
          outcome = :3,
          execution_lane = COALESCE(execution_lane, :4),
          verdict = :5,
          status = :6,
          error_text = :7,
          metrics_json = :8 FORMAT JSON,
          artifacts_json = :9 FORMAT JSON,
          files_changed_json = :10 FORMAT JSON,
          tool_calls_json = :11 FORMAT JSON,
          commit_sha = :12,
          pr_url = :13,
          model_name = :14,
          duration_ms = :15,
          updated_at = SYSTIMESTAMP
      WHERE work_item_id = :1
        AND run_id = :2
    `;
    const result = await this.client.execute(
      sql,
      [
        payload.work_item_id,
        payload.run_id,
        payload.summary,
        payload.lane,
        payload.verdict || null,
        mappedState.status,
        payload.error || null,
        jsonOrNull(payload.metrics),
        jsonOrNull(payload.artifacts),
        jsonOrNull(payload.files_changed),
        jsonOrNull(payload.tool_calls),
        payload.commit_sha || null,
        payload.pr_url || null,
        payload.model,
        payload.duration_ms,
      ],
      { autoCommit: true },
    );
    return result.rowCount;
  }

  async createSceneItem(scene) {
    const sql = `
      INSERT INTO ${this.qualify('lab_scene_items')}
        (scene_item_id, scene_name, season_number, episode_number, task_type, creative_brief,
         character_list_json, prompt_notes, revision_pass, work_item_id,
         source_grounding_requested_at, pipeline_status, escalation_level, created_at, updated_at)
      VALUES
        (:1, :2, :3, :4, :5, :6, :7 FORMAT JSON, :8, 1, :9, SYSTIMESTAMP, 'Source Grounding',
         'Normal', SYSTIMESTAMP, SYSTIMESTAMP)
    `;
    await this.client.execute(
      sql,
      [
        scene.scene_item_id,
        scene.scene_name,
        scene.season,
        scene.episode || null,
        scene.task_type,
        scene.creative_brief,
        JSON.stringify(scene.character_list || []),
        scene.prompt_notes || null,
        scene.work_item_id || null,
      ],
      { autoCommit: true },
    );
  }
}

class LabService {
  constructor(repository) {
    this.repository = repository;
  }

  async checkGates(workItemId) {
    requireUuid(workItemId, 'work_item_id');
    const item = await this.repository.fetchWorkItem(workItemId);
    if (!item) {
      throw new Error(`Work item not found: ${workItemId}`);
    }

    const preFlight = await this.repository.getControlFlag('Pre-Flight Mode');
    if (preFlight?.FLAG_VALUE || preFlight?.flag_value) {
      return {
        halt: true,
        reason: 'pre_flight_active',
        detail: 'Pre-Flight Mode is active. All dispatch suspended.',
      };
    }

    const cascadeRow = await this.repository.getControlFlag('Max Cascade Depth');
    const maxDepth = Number(cascadeRow?.NUMBER_VALUE || cascadeRow?.number_value || 5);
    const depth = Number(item.CASCADE_DEPTH || item.cascade_depth || 1);
    if (depth >= maxDepth) {
      return {
        halt: true,
        reason: 'cascade_depth_exceeded',
        detail: `Cascade depth ${depth} >= limit ${maxDepth}.`,
      };
    }

    return { proceed: true, cascade_depth: depth };
  }

  async getDispatchableItems(limit = 25) {
    const rows = await this.repository.listDispatchable(limit);
    return rows.map((row) => ({
      work_item_id: row.WORK_ITEM_ID || row.work_item_id,
      work_item_name: row.ITEM_NAME || row.item_name,
      status: row.STATUS || row.status,
      dispatch_mode: row.DISPATCH_MODE || row.dispatch_mode,
      execution_lane: row.EXECUTION_LANE || row.execution_lane,
      environment: row.ENVIRONMENT_NAME || row.environment_name,
      project_name: row.PROJECT_NAME || row.project_name,
      lab_dispatch_requested_at: row.LAB_DISPATCH_REQUESTED_AT || row.lab_dispatch_requested_at,
    }));
  }

  async buildDispatchPacket(workItemId) {
    requireUuid(workItemId, 'work_item_id');
    const item = await this.repository.fetchWorkItem(workItemId);
    if (!item) {
      throw new Error(`Work item not found: ${workItemId}`);
    }

    const errors = [];
    const normalized = {
      work_item_id: item.WORK_ITEM_ID || item.work_item_id,
      work_item_name: normalizeValue(item.ITEM_NAME || item.item_name),
      project_id: item.PROJECT_ID || item.project_id || null,
      project_name: normalizeValue(item.PROJECT_NAME || item.project_name) || null,
      objective: normalizeValue(item.OBJECTIVE || item.objective),
      kill_condition: normalizeValue(item.KILL_CONDITION || item.kill_condition) || null,
      dispatch_via: normalizeValue(item.DISPATCH_VIA || item.dispatch_via) || null,
      execution_lane: normalizeValue(item.EXECUTION_LANE || item.execution_lane),
      environment: normalizeValue(item.ENVIRONMENT_NAME || item.environment_name),
      branch_name: normalizeValue(item.BRANCH_NAME || item.branch_name) || null,
      type_name: normalizeValue(item.TYPE_NAME || item.type_name),
      prompt_notes: normalizeValue(item.PROMPT_NOTES || item.prompt_notes) || null,
      repo_url: normalizeValue(item.REPO_URL || item.repo_url) || null,
      github_issue_url: normalizeValue(item.GITHUB_ISSUE_URL || item.github_issue_url) || null,
      cascade_depth: Number(item.CASCADE_DEPTH || item.cascade_depth || 1),
      execution_budget: item.EXECUTION_BUDGET || item.execution_budget || null,
      retry_count: intOrDefault(item.RETRY_COUNT || item.retry_count, 0),
      dispatch_mode: normalizeValue(item.DISPATCH_MODE || item.dispatch_mode || 'execute'),
      dispatch_block: normalizeValue(item.DISPATCH_BLOCK || item.dispatch_block || 'none'),
      repo_ready: Number(item.REPO_READY || item.repo_ready || 0) === 1,
      escalation_level: normalizeValue(item.ESCALATION_LEVEL || item.escalation_level || 'Normal'),
      project_focus: Number(item.PROJECT_FOCUS || item.project_focus || 0) === 1,
      project_max_active_items: intOrDefault(item.MAX_ACTIVE_ITEMS ?? item.max_active_items, 2),
      project_min_terminal_value: normalizeValue(item.MIN_TERMINAL_VALUE || item.min_terminal_value || 'Any'),
      project_fork_budget: item.FORK_BUDGET || item.fork_budget || null,
      created_at: item.CREATED_AT || item.created_at || nowIso(),
      run_id: item.RUN_ID || item.run_id || null,
      lab_dispatch_requested_at: item.LAB_DISPATCH_REQUESTED_AT || item.lab_dispatch_requested_at || null,
      lab_dispatch_consumed_at: item.LAB_DISPATCH_CONSUMED_AT || item.lab_dispatch_consumed_at || null,
      blocked_reason: normalizeValue(item.BLOCKED_REASON || item.blocked_reason) || null,
      writers_room_config: parseJsonField(item.WRITERS_ROOM_CONFIG_JSON || item.writers_room_config_json || null, 'writers_room_config'),
    };

    // Resolve execution_lane from dispatch_via before validating it (V3).
    // Otherwise a dispatch_via-only item fails V3 and the default below would
    // be unreachable.
    if (!normalized.execution_lane && normalized.dispatch_via) {
      normalized.execution_lane =
        DISPATCH_VIA_DEFAULTS[normalized.dispatch_via] || normalized.execution_lane;
    }

    const gateState = await this.checkGates(workItemId);
    if (gateState.halt) {
      errors.push(`V13/V14: ${gateState.detail}`);
    }

    if (!isUuid(normalized.work_item_id)) {
      errors.push('V1: work_item_id must be a UUID');
    }
    if (normalized.dispatch_via && !VALID_DISPATCH_VIA.has(normalized.dispatch_via)) {
      errors.push(`V2: dispatch_via '${normalized.dispatch_via}' is not a known value`);
    }
    if (!VALID_EXECUTION_LANES.has(normalized.execution_lane)) {
      errors.push(`V3: execution_lane '${normalized.execution_lane}' is not valid`);
    }
    if (!VALID_ENVIRONMENTS.has(normalized.environment)) {
      errors.push(`V4: environment '${normalized.environment}' is not valid`);
    }
    if (!normalized.objective) {
      errors.push('V6: objective must be non-empty');
    }
    if (!VALID_TYPES.has(normalized.type_name)) {
      errors.push(`V6b: type '${normalized.type_name}' is not valid`);
    }
    if (normalized.run_id) {
      errors.push('V8: run_id is already set; work item appears active');
    }
    if (!normalized.lab_dispatch_requested_at) {
      errors.push('V9: Lab Dispatch Requested At is empty');
    }
    if (normalized.lab_dispatch_consumed_at) {
      errors.push('V10: Lab Dispatch Consumed At is already set');
    }
    if (normalized.dispatch_mode && BLOCKING_DISPATCH_MODES.has(normalized.dispatch_mode)) {
      errors.push(`V15: dispatch_mode '${normalized.dispatch_mode}' is Lab-only and cannot enter Factory dispatch`);
    }
    if (normalized.dispatch_block && BLOCKING_DISPATCH_BLOCKS.has(normalized.dispatch_block)) {
      errors.push(`V16: dispatch_block '${normalized.dispatch_block}' blocks dispatch`);
    }
    if (!normalized.repo_ready && normalized.execution_lane !== 'writers-room') {
      errors.push('V17: repo_ready is false for a non-writers-room dispatch');
    }
    // V18 fires only on human/preflight-set block reasons. Transient computed
    // reasons (AUTO_BLOCK_PREFIXES) are re-derived live by V15-V20 above, so a
    // stale auto-reason from a prior pass must not permanently block dispatch.
    if (normalized.blocked_reason && !isAutoBlockReason(normalized.blocked_reason)) {
      errors.push(`V18: blocked_reason is set (${normalized.blocked_reason})`);
    }
    if (BLOCKING_ESCALATION_LEVELS.has(normalized.escalation_level)) {
      errors.push(`V19: escalation_level '${normalized.escalation_level}' blocks dispatch`);
    }
    if (normalized.project_id) {
      const activeCount = await this.repository.countActiveProjectItems(normalized.project_id);
      if (activeCount >= normalized.project_max_active_items) {
        errors.push(`V20: project WIP cap reached (${activeCount}/${normalized.project_max_active_items})`);
      }
    }
    if (normalized.project_focus === false && process.env.LAB_REQUIRE_PROJECT_FOCUS === 'true') {
      errors.push('V21: project is not in focus');
    }
    if (normalized.execution_lane === 'writers-room') {
      const wr = normalized.writers_room_config;
      if (!wr || !WRITERS_ROOM_TASK_TYPES.has(wr.task_type) || !wr.scene_name || !wr.creative_brief) {
        errors.push('V22: writers-room dispatch requires valid writers_room_config');
      }
    }

    if (errors.length > 0) {
      return { packet: null, errors };
    }

    const executionLane = normalized.execution_lane;
    const packet = {
      version: DISPATCH_PACKET_VERSION,
      run_id: crypto.randomUUID(),
      work_item_id: normalized.work_item_id,
      work_item_name: normalized.work_item_name,
      project_name: normalized.project_name,
      project_id: normalized.project_id,
      objective: normalized.objective,
      kill_condition: normalized.kill_condition,
      dispatch_via: normalized.dispatch_via,
      execution_lane: executionLane,
      environment: normalized.environment,
      branch: normalized.branch_name,
      type: normalized.type_name,
      prompt_notes: normalized.prompt_notes,
      repo_url: normalized.repo_url,
      github_issue_url: normalized.github_issue_url,
      cascade_depth: normalized.cascade_depth,
      concurrency_group: normalized.project_id,
      execution_budget: normalized.execution_budget,
      retry_count: normalized.retry_count,
      dispatch_mode: normalized.dispatch_mode,
      dispatch_block: normalized.dispatch_block,
      repo_ready: normalized.repo_ready,
      escalation_level: normalized.escalation_level,
      project_focus: normalized.project_focus,
      project_min_terminal_value: normalized.project_min_terminal_value,
      project_fork_budget: normalized.project_fork_budget,
      portfolio_focus_active: normalized.project_focus,
      created_at: nowIso(),
      constraints: LANE_CONSTRAINTS[executionLane],
      writers_room_config: normalized.execution_lane === 'writers-room' ? normalized.writers_room_config : null,
    };

    await this.repository.insertEvent('dispatch_packet_built', 'work_item', normalized.work_item_id, {
      run_id: packet.run_id,
      execution_lane: packet.execution_lane,
    });

    return { packet, errors: [] };
  }

  async stampDispatchConsumed(workItemId, runId) {
    requireUuid(workItemId, 'work_item_id');
    requireUuid(runId, 'run_id');
    const updated = await this.repository.acceptDispatchStart(workItemId, runId);
    if (updated === 0) {
      throw new Error('Dispatch was not accepted. Work item may already be consumed or missing a request signal.');
    }
    await this.repository.insertEvent('dispatch_consumed', 'work_item', workItemId, { run_id: runId });
    return {
      status: 'consumed',
      work_item_id: workItemId,
      run_id: runId,
      consumed_at: nowIso(),
    };
  }

  async failDispatchPreflight(workItemId, runId, reason) {
    requireUuid(workItemId, 'work_item_id');
    requireUuid(runId, 'run_id');
    requireNonEmptyString(reason, 'reason');
    const updated = await this.repository.restoreDispatchReady(workItemId, runId, reason);
    if (updated === 0) {
      throw new Error('Dispatch preflight failure could not be recorded for this run_id.');
    }
    await this.repository.insertEvent('dispatch_preflight_failed', 'work_item', workItemId, { run_id: runId, reason });
    return {
      status: 'reverted',
      work_item_id: workItemId,
      run_id: runId,
      reason,
    };
  }

  async handleFinalReturn(args) {
    requireUuid(args.work_item_id, 'work_item_id');
    requireUuid(args.run_id, 'run_id');
    requireNonEmptyString(args.summary, 'summary');
    requireNonEmptyString(args.raw_output, 'raw_output');
    requireNonEmptyString(args.model, 'model');
    requireNonEmptyString(args.lane, 'lane');

    const metrics = parseJsonField(args.metrics, 'metrics');
    const artifacts = parseJsonField(args.artifacts, 'artifacts');
    const toolCalls = parseJsonField(args.tool_calls, 'tool_calls');
    const filesChanged = Array.isArray(args.files_changed)
      ? args.files_changed
      : parseJsonField(args.files_changed, 'files_changed');

    const payload = {
      work_item_id: args.work_item_id,
      run_id: args.run_id,
      status: args.status,
      summary: args.summary,
      raw_output: args.raw_output,
      duration_ms: Number(args.duration_ms),
      model: args.model,
      lane: args.lane,
      verdict: args.verdict || null,
      error: args.error || null,
      metrics,
      artifacts,
      files_changed: filesChanged,
      tool_calls: toolCalls,
      commit_sha: args.commit_sha || null,
      pr_url: args.pr_url || null,
    };

    const updated = await this.repository.ingestFinalReturn(payload);
    if (updated === 0) {
      throw new Error('Final return did not match an active run.');
    }
    await this.repository.insertEvent('return_received', 'work_item', payload.work_item_id, payload);
    return {
      ingested: true,
      work_item_id: payload.work_item_id,
      run_id: payload.run_id,
      status: payload.status,
      verdict: payload.verdict,
    };
  }

  async dispatchScene(args) {
    requireNonEmptyString(args.scene_name, 'scene_name');
    requireNonEmptyString(args.creative_brief, 'creative_brief');
    if (!WRITERS_ROOM_TASK_TYPES.has(args.task_type)) {
      throw new Error(`Unknown task_type: ${args.task_type}`);
    }
    const season = Number(args.season);
    if (!Number.isFinite(season) || season <= 0) {
      throw new Error('season must be a positive number');
    }
    let episode = null;
    if (args.episode != null) {
      episode = Number(args.episode);
      if (!Number.isFinite(episode) || episode <= 0) {
        throw new Error('episode must be a positive number when provided');
      }
    }

    const sceneItemId = crypto.randomUUID();
    const characterList = Array.isArray(args.character_list)
      ? args.character_list
      : typeof args.character_list === 'string' && args.character_list.trim()
        ? args.character_list.split(',').map((value) => value.trim()).filter(Boolean)
        : [];

    const scene = {
      scene_item_id: sceneItemId,
      scene_name: args.scene_name,
      season,
      episode,
      task_type: args.task_type,
      creative_brief: args.creative_brief,
      character_list: characterList,
      prompt_notes: args.prompt_notes || null,
      work_item_id: args.work_item_id || null,
    };

    await this.repository.createSceneItem(scene);
    await this.repository.insertEvent('scene_source_grounding_requested', 'scene_item', sceneItemId, scene);

    return {
      created: true,
      scene_item_id: sceneItemId,
      scene_name: scene.scene_name,
      entry_signal: 'source_grounding_requested_at',
    };
  }
}

export function registerLabToolHandlers(server, client) {
  const repository = new LabRepository(client);
  const service = new LabService(repository);
  return {
    async check_gates(args) {
      return server.jsonResponse(await service.checkGates(args.work_item_id));
    },
    async get_dispatchable_items(args) {
      return server.jsonResponse(await service.getDispatchableItems(args.limit || 25));
    },
    async build_dispatch_packet(args) {
      return server.jsonResponse(await service.buildDispatchPacket(args.work_item_id));
    },
    async stamp_dispatch_consumed(args) {
      return server.jsonResponse(await service.stampDispatchConsumed(args.work_item_id, args.run_id));
    },
    async fail_dispatch_preflight(args) {
      return server.jsonResponse(await service.failDispatchPreflight(args.work_item_id, args.run_id, args.reason));
    },
    async handle_final_return(args) {
      return server.jsonResponse(await service.handleFinalReturn(args));
    },
    async dispatch_scene(args) {
      return server.jsonResponse(await service.dispatchScene(args));
    },
  };
}
