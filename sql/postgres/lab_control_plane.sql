-- Backend-owned Lab mirror for PostgreSQL.

CREATE TABLE lab_projects (
  project_id uuid PRIMARY KEY,
  project_name text NOT NULL,
  repo_url text,
  active_issue_url text,
  focus_flag boolean NOT NULL DEFAULT false,
  max_active_items integer NOT NULL DEFAULT 2,
  min_terminal_value text NOT NULL DEFAULT 'Any',
  fork_budget numeric,
  roadmap_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_control (
  parameter_name text PRIMARY KEY,
  flag_value boolean NOT NULL DEFAULT false,
  number_value numeric,
  text_value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_agent_registry (
  agent_name text PRIMARY KEY,
  role_name text NOT NULL,
  entry_signal text,
  exit_signal text,
  enabled_flag boolean NOT NULL DEFAULT true,
  tool_contract_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_work_items (
  work_item_id uuid PRIMARY KEY,
  project_id uuid REFERENCES lab_projects(project_id),
  item_name text NOT NULL,
  objective text NOT NULL,
  kill_condition text,
  type_name text NOT NULL,
  status text NOT NULL DEFAULT 'Not Started',
  verdict text,
  environment_name text NOT NULL DEFAULT 'dev',
  dispatch_via text,
  execution_lane text,
  dispatch_mode text NOT NULL DEFAULT 'execute',
  dispatch_block text NOT NULL DEFAULT 'none',
  repo_ready boolean NOT NULL DEFAULT false,
  blocked_reason text,
  escalation_level text NOT NULL DEFAULT 'Normal',
  prompt_notes text,
  prompt_drafts text,
  outcome text,
  findings text,
  github_issue_url text,
  branch_name text,
  repo_url text,
  run_id uuid,
  cascade_depth integer NOT NULL DEFAULT 1,
  retry_count integer NOT NULL DEFAULT 0,
  execution_budget numeric,
  error_text text,
  metrics_json jsonb,
  artifacts_json jsonb,
  files_changed_json jsonb,
  tool_calls_json jsonb,
  writers_room_config_json jsonb,
  model_name text,
  duration_ms integer,
  commit_sha text,
  pr_url text,
  lab_dispatch_requested_at timestamptz,
  lab_dispatch_consumed_at timestamptz,
  prompt_request_received_at timestamptz,
  prompt_request_consumed_at timestamptz,
  incubation_requested_at timestamptz,
  return_received_at timestamptz,
  return_consumed_at timestamptz,
  librarian_request_received_at timestamptz,
  librarian_request_consumed_at timestamptz,
  synthesis_completed_at timestamptz,
  synthesis_consumed_at timestamptz,
  shadow_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_scene_items (
  scene_item_id uuid PRIMARY KEY,
  work_item_id uuid REFERENCES lab_work_items(work_item_id),
  scene_name text NOT NULL,
  season_number integer NOT NULL,
  episode_number integer,
  task_type text NOT NULL,
  creative_brief text NOT NULL,
  character_list_json jsonb,
  prompt_notes text,
  revision_pass integer NOT NULL DEFAULT 1,
  pipeline_status text NOT NULL DEFAULT 'Not Started',
  escalation_level text NOT NULL DEFAULT 'Normal',
  blocked_reason text,
  source_grounding_requested_at timestamptz,
  source_grounding_consumed_at timestamptz,
  canon_review_requested_at timestamptz,
  canon_review_consumed_at timestamptz,
  dramatic_architecture_requested_at timestamptz,
  dramatic_architecture_consumed_at timestamptz,
  human_review_requested_at timestamptz,
  scene_revision_requested_at timestamptz,
  scene_revision_consumed_at timestamptz,
  source_audit_json jsonb,
  provenance_tags_json jsonb,
  scene_type_classification text,
  governing_voice text,
  character_clearance_json jsonb,
  motif_clearance_json jsonb,
  escalation_flags_json jsonb,
  beat_sheet_json jsonb,
  scene_draft text,
  stress_test_results_json jsonb,
  stress_test_score integer,
  revision_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_domain_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_outbox_events (
  outbox_id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload_json jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notion_projection_state (
  notion_object_id text PRIMARY KEY,
  notion_object_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  source_updated_at timestamptz,
  projected_at timestamptz,
  last_error text
);

CREATE TABLE lab_audit_log (
  audit_id bigserial PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  transition_name text NOT NULL,
  actor_name text NOT NULL,
  from_status text,
  to_status text,
  detail_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_telemetry (
  telemetry_id bigserial PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  metric_name text NOT NULL,
  metric_value numeric,
  metric_text text,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_evidence_dossier (
  dossier_id uuid PRIMARY KEY,
  work_item_id uuid REFERENCES lab_work_items(work_item_id),
  claim_text text NOT NULL,
  claim_type text,
  load_bearing_flag boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'Unchecked',
  notes_text text,
  evidence_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION lab_work_items_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF (OLD.dispatch_mode IS DISTINCT FROM NEW.dispatch_mode) AND NEW.lab_dispatch_requested_at IS NULL THEN
    NEW.lab_dispatch_requested_at := now();
  END IF;
  IF OLD.return_received_at IS NULL AND NEW.return_received_at IS NOT NULL THEN
    NEW.shadow_requested_at := COALESCE(NEW.shadow_requested_at, now());
    NEW.librarian_request_received_at := COALESCE(NEW.librarian_request_received_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lab_work_items_bu
BEFORE UPDATE ON lab_work_items
FOR EACH ROW
EXECUTE FUNCTION lab_work_items_before_update();

CREATE OR REPLACE FUNCTION lab_work_items_after_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.lab_dispatch_requested_at IS NULL AND NEW.lab_dispatch_requested_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('dispatch_requested', 'work_item', NEW.work_item_id, jsonb_build_object('work_item_id', NEW.work_item_id, 'status', NEW.status));
  END IF;

  IF OLD.return_received_at IS NULL AND NEW.return_received_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('return_received', 'work_item', NEW.work_item_id, jsonb_build_object('work_item_id', NEW.work_item_id, 'run_id', NEW.run_id, 'status', NEW.status));
  END IF;

  IF OLD.synthesis_completed_at IS NULL AND NEW.synthesis_completed_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('synthesis_completed', 'work_item', NEW.work_item_id, jsonb_build_object('work_item_id', NEW.work_item_id, 'status', NEW.status));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER lab_work_items_au
AFTER UPDATE ON lab_work_items
FOR EACH ROW
EXECUTE FUNCTION lab_work_items_after_change();

CREATE VIEW lab_dispatch_queue_v AS
SELECT
  wi.work_item_id,
  wi.item_name,
  wi.status,
  wi.dispatch_mode,
  wi.execution_lane,
  wi.environment_name,
  wi.lab_dispatch_requested_at,
  wi.lab_dispatch_consumed_at,
  p.project_name,
  (
    wi.lab_dispatch_requested_at IS NOT NULL
    AND wi.lab_dispatch_consumed_at IS NULL
    AND wi.return_received_at IS NULL
    AND wi.status IN ('Not Started', 'Prompt Drafted')
  )::int AS is_dispatchable,
  wi.created_at
FROM lab_work_items wi
LEFT JOIN lab_projects p ON p.project_id = wi.project_id;

INSERT INTO lab_control (parameter_name, flag_value, number_value, text_value)
VALUES ('Pre-Flight Mode', false, null, 'Global stop-the-line gate');

INSERT INTO lab_control (parameter_name, flag_value, number_value, text_value)
VALUES ('Max Cascade Depth', false, 5, 'Maximum successor depth before automated halt');
