-- Backend-owned Lab mirror for Oracle.
-- This schema turns the Lab state machine into relational tables plus outbox-backed automations.

CREATE TABLE lab_projects (
  project_id                 VARCHAR2(36) PRIMARY KEY,
  project_name               VARCHAR2(255) NOT NULL,
  repo_url                   VARCHAR2(1024),
  active_issue_url           VARCHAR2(1024),
  focus_flag                 NUMBER(1) DEFAULT 0 NOT NULL CHECK (focus_flag IN (0, 1)),
  max_active_items           NUMBER DEFAULT 2 NOT NULL,
  min_terminal_value         VARCHAR2(32) DEFAULT 'Any' NOT NULL,
  fork_budget                NUMBER,
  roadmap_json               CLOB CHECK (roadmap_json IS JSON),
  created_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_control (
  parameter_name             VARCHAR2(128) PRIMARY KEY,
  flag_value                 NUMBER(1) DEFAULT 0 NOT NULL CHECK (flag_value IN (0, 1)),
  number_value               NUMBER,
  text_value                 VARCHAR2(4000),
  updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_agent_registry (
  agent_name                 VARCHAR2(128) PRIMARY KEY,
  role_name                  VARCHAR2(128) NOT NULL,
  entry_signal               VARCHAR2(128),
  exit_signal                VARCHAR2(128),
  enabled_flag               NUMBER(1) DEFAULT 1 NOT NULL CHECK (enabled_flag IN (0, 1)),
  tool_contract_json         CLOB CHECK (tool_contract_json IS JSON),
  updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_work_items (
  work_item_id               VARCHAR2(36) PRIMARY KEY,
  project_id                 VARCHAR2(36) REFERENCES lab_projects(project_id),
  item_name                  VARCHAR2(255) NOT NULL,
  objective                  CLOB NOT NULL,
  kill_condition             CLOB,
  type_name                  VARCHAR2(64) NOT NULL,
  status                     VARCHAR2(64) DEFAULT 'Not Started' NOT NULL,
  verdict                    VARCHAR2(32),
  environment_name           VARCHAR2(32) DEFAULT 'dev' NOT NULL,
  dispatch_via               VARCHAR2(64),
  execution_lane             VARCHAR2(64),
  dispatch_mode              VARCHAR2(32) DEFAULT 'execute' NOT NULL,
  dispatch_block             VARCHAR2(64) DEFAULT 'none' NOT NULL,
  repo_ready                 NUMBER(1) DEFAULT 0 NOT NULL CHECK (repo_ready IN (0, 1)),
  blocked_reason             VARCHAR2(4000),
  escalation_level           VARCHAR2(32) DEFAULT 'Normal' NOT NULL,
  prompt_notes               CLOB,
  prompt_drafts              CLOB,
  outcome                    CLOB,
  findings                   CLOB,
  github_issue_url           VARCHAR2(1024),
  branch_name                VARCHAR2(255),
  repo_url                   VARCHAR2(1024),
  run_id                     VARCHAR2(36),
  cascade_depth              NUMBER DEFAULT 1 NOT NULL,
  retry_count                NUMBER DEFAULT 0 NOT NULL,
  execution_budget           NUMBER,
  error_text                 CLOB,
  metrics_json               CLOB CHECK (metrics_json IS JSON),
  artifacts_json             CLOB CHECK (artifacts_json IS JSON),
  files_changed_json         CLOB CHECK (files_changed_json IS JSON),
  tool_calls_json            CLOB CHECK (tool_calls_json IS JSON),
  writers_room_config_json   CLOB CHECK (writers_room_config_json IS JSON),
  model_name                 VARCHAR2(255),
  duration_ms                NUMBER,
  commit_sha                 VARCHAR2(64),
  pr_url                     VARCHAR2(1024),
  lab_dispatch_requested_at  TIMESTAMP WITH TIME ZONE,
  lab_dispatch_consumed_at   TIMESTAMP WITH TIME ZONE,
  prompt_request_received_at TIMESTAMP WITH TIME ZONE,
  prompt_request_consumed_at TIMESTAMP WITH TIME ZONE,
  incubation_requested_at    TIMESTAMP WITH TIME ZONE,
  return_received_at         TIMESTAMP WITH TIME ZONE,
  return_consumed_at         TIMESTAMP WITH TIME ZONE,
  librarian_request_received_at TIMESTAMP WITH TIME ZONE,
  librarian_request_consumed_at TIMESTAMP WITH TIME ZONE,
  synthesis_completed_at     TIMESTAMP WITH TIME ZONE,
  synthesis_consumed_at      TIMESTAMP WITH TIME ZONE,
  shadow_requested_at        TIMESTAMP WITH TIME ZONE,
  created_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_scene_items (
  scene_item_id                      VARCHAR2(36) PRIMARY KEY,
  work_item_id                       VARCHAR2(36) REFERENCES lab_work_items(work_item_id),
  scene_name                         VARCHAR2(255) NOT NULL,
  season_number                      NUMBER NOT NULL,
  episode_number                     NUMBER,
  task_type                          VARCHAR2(64) NOT NULL,
  creative_brief                     CLOB NOT NULL,
  character_list_json                CLOB CHECK (character_list_json IS JSON),
  prompt_notes                       CLOB,
  revision_pass                      NUMBER DEFAULT 1 NOT NULL,
  pipeline_status                    VARCHAR2(64) DEFAULT 'Not Started' NOT NULL,
  escalation_level                   VARCHAR2(32) DEFAULT 'Normal' NOT NULL,
  blocked_reason                     VARCHAR2(4000),
  source_grounding_requested_at      TIMESTAMP WITH TIME ZONE,
  source_grounding_consumed_at       TIMESTAMP WITH TIME ZONE,
  canon_review_requested_at          TIMESTAMP WITH TIME ZONE,
  canon_review_consumed_at           TIMESTAMP WITH TIME ZONE,
  dramatic_architecture_requested_at TIMESTAMP WITH TIME ZONE,
  dramatic_architecture_consumed_at  TIMESTAMP WITH TIME ZONE,
  human_review_requested_at          TIMESTAMP WITH TIME ZONE,
  scene_revision_requested_at        TIMESTAMP WITH TIME ZONE,
  scene_revision_consumed_at         TIMESTAMP WITH TIME ZONE,
  source_audit_json                  CLOB CHECK (source_audit_json IS JSON),
  provenance_tags_json               CLOB CHECK (provenance_tags_json IS JSON),
  scene_type_classification          VARCHAR2(128),
  governing_voice                    VARCHAR2(128),
  character_clearance_json           CLOB CHECK (character_clearance_json IS JSON),
  motif_clearance_json               CLOB CHECK (motif_clearance_json IS JSON),
  escalation_flags_json              CLOB CHECK (escalation_flags_json IS JSON),
  beat_sheet_json                    CLOB CHECK (beat_sheet_json IS JSON),
  scene_draft                        CLOB,
  stress_test_results_json           CLOB CHECK (stress_test_results_json IS JSON),
  stress_test_score                  NUMBER,
  revision_required                  NUMBER(1) DEFAULT 0 NOT NULL CHECK (revision_required IN (0, 1)),
  created_at                         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at                         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_domain_events (
  event_id                    RAW(16) PRIMARY KEY,
  event_type                  VARCHAR2(128) NOT NULL,
  aggregate_type              VARCHAR2(64) NOT NULL,
  aggregate_id                VARCHAR2(36) NOT NULL,
  payload_json                CLOB CHECK (payload_json IS JSON),
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_outbox_events (
  outbox_id                   NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_type                  VARCHAR2(128) NOT NULL,
  aggregate_type              VARCHAR2(64) NOT NULL,
  aggregate_id                VARCHAR2(36) NOT NULL,
  payload_json                CLOB CHECK (payload_json IS JSON),
  available_at                TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  claimed_at                  TIMESTAMP WITH TIME ZONE,
  delivered_at                TIMESTAMP WITH TIME ZONE,
  delivery_attempts           NUMBER DEFAULT 0 NOT NULL,
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE notion_projection_state (
  notion_object_id            VARCHAR2(64) PRIMARY KEY,
  notion_object_type          VARCHAR2(32) NOT NULL,
  aggregate_type              VARCHAR2(64) NOT NULL,
  aggregate_id                VARCHAR2(36) NOT NULL,
  source_updated_at           TIMESTAMP WITH TIME ZONE,
  projected_at                TIMESTAMP WITH TIME ZONE,
  last_error                  CLOB
);

CREATE TABLE lab_audit_log (
  audit_id                    NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  aggregate_type              VARCHAR2(64) NOT NULL,
  aggregate_id                VARCHAR2(36) NOT NULL,
  transition_name             VARCHAR2(255) NOT NULL,
  actor_name                  VARCHAR2(128) NOT NULL,
  from_status                 VARCHAR2(64),
  to_status                   VARCHAR2(64),
  detail_json                 CLOB CHECK (detail_json IS JSON),
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_telemetry (
  telemetry_id                NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  aggregate_type              VARCHAR2(64) NOT NULL,
  aggregate_id                VARCHAR2(36) NOT NULL,
  metric_name                 VARCHAR2(128) NOT NULL,
  metric_value                NUMBER,
  metric_text                 VARCHAR2(4000),
  observed_at                 TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE lab_evidence_dossier (
  dossier_id                  VARCHAR2(36) PRIMARY KEY,
  work_item_id                VARCHAR2(36) REFERENCES lab_work_items(work_item_id),
  claim_text                  CLOB NOT NULL,
  claim_type                  VARCHAR2(64),
  load_bearing_flag           NUMBER(1) DEFAULT 0 NOT NULL CHECK (load_bearing_flag IN (0, 1)),
  verification_status         VARCHAR2(64) DEFAULT 'Unchecked' NOT NULL,
  notes_text                  CLOB,
  evidence_json               CLOB CHECK (evidence_json IS JSON),
  created_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE OR REPLACE TRIGGER lab_work_items_bu
  BEFORE UPDATE ON lab_work_items
  FOR EACH ROW
BEGIN
  :NEW.updated_at := SYSTIMESTAMP;

  IF :OLD.dispatch_mode IS NULL OR :OLD.dispatch_mode <> :NEW.dispatch_mode THEN
    IF :NEW.lab_dispatch_requested_at IS NULL THEN
      :NEW.lab_dispatch_requested_at := SYSTIMESTAMP;
    END IF;
  END IF;

  IF :OLD.return_received_at IS NULL AND :NEW.return_received_at IS NOT NULL AND :NEW.shadow_requested_at IS NULL THEN
    :NEW.shadow_requested_at := SYSTIMESTAMP;
    IF :NEW.librarian_request_received_at IS NULL THEN
      :NEW.librarian_request_received_at := SYSTIMESTAMP;
    END IF;
  END IF;
END;
/

CREATE OR REPLACE TRIGGER lab_work_items_outbox
  AFTER INSERT OR UPDATE ON lab_work_items
  FOR EACH ROW
BEGIN
  IF INSERTING THEN
    NULL;
  END IF;

  IF :OLD.lab_dispatch_requested_at IS NULL AND :NEW.lab_dispatch_requested_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('dispatch_requested', 'work_item', :NEW.work_item_id,
      JSON_OBJECT('work_item_id' VALUE :NEW.work_item_id, 'status' VALUE :NEW.status));
  END IF;

  IF :OLD.return_received_at IS NULL AND :NEW.return_received_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('return_received', 'work_item', :NEW.work_item_id,
      JSON_OBJECT('work_item_id' VALUE :NEW.work_item_id, 'run_id' VALUE :NEW.run_id, 'status' VALUE :NEW.status));
  END IF;

  IF :OLD.synthesis_completed_at IS NULL AND :NEW.synthesis_completed_at IS NOT NULL THEN
    INSERT INTO lab_outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
    VALUES ('synthesis_completed', 'work_item', :NEW.work_item_id,
      JSON_OBJECT('work_item_id' VALUE :NEW.work_item_id, 'status' VALUE :NEW.status));
  END IF;
END;
/

CREATE OR REPLACE VIEW lab_dispatch_queue_v AS
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
  CASE
    WHEN wi.lab_dispatch_requested_at IS NOT NULL
     AND wi.lab_dispatch_consumed_at IS NULL
     AND wi.return_received_at IS NULL
     AND wi.status IN ('Not Started', 'Prompt Drafted')
    THEN 1
    ELSE 0
  END AS is_dispatchable,
  wi.created_at
FROM lab_work_items wi
LEFT JOIN lab_projects p ON p.project_id = wi.project_id;

INSERT INTO lab_control (parameter_name, flag_value, number_value, text_value)
VALUES ('Pre-Flight Mode', 0, NULL, 'Global stop-the-line gate');

INSERT INTO lab_control (parameter_name, flag_value, number_value, text_value)
VALUES ('Max Cascade Depth', 0, 5, 'Maximum successor depth before automated halt');
