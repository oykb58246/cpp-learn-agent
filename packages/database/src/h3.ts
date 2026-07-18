import type { Migration } from './index'

const agentSql = `
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, source TEXT NOT NULL, mode TEXT NOT NULL,
  message TEXT NOT NULL, project_id TEXT, active_file TEXT, status TEXT NOT NULL, intent TEXT,
  plan_summary TEXT, response TEXT, validation_summary TEXT, error_code TEXT, error_message TEXT,
  steps_json TEXT NOT NULL, pending_approval_json TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_steps (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, id TEXT NOT NULL,
  sequence INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL,
  tool_name TEXT, summary TEXT, started_at TEXT, finished_at TEXT,
  PRIMARY KEY(run_id, id)
);
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL,
  summary TEXT NOT NULL, occurred_at TEXT NOT NULL, step_id TEXT, data_json TEXT,
  UNIQUE(run_id, sequence)
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL, tool_name TEXT NOT NULL, risk TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL, parameter_summary_json TEXT NOT NULL, side_effects_json TEXT NOT NULL,
  status TEXT NOT NULL, decision_reason TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL, server_name TEXT NOT NULL, tool_name TEXT NOT NULL, risk TEXT NOT NULL,
  parameter_summary_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, duration_ms INTEGER, error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_updated ON agent_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_run ON timeline_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals(run_id, created_at);
`

const learningSql = `
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
  difficulty INTEGER NOT NULL, prerequisites_json TEXT NOT NULL, tags_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_edges (
  prerequisite_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY(prerequisite_id, concept_id)
);
CREATE TABLE IF NOT EXISTS learner_knowledge (
  user_id TEXT NOT NULL, concept_id TEXT NOT NULL REFERENCES knowledge_nodes(id), status TEXT NOT NULL,
  confidence REAL NOT NULL, verified_at TEXT, last_evidence_id TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, concept_id)
);
CREATE TABLE IF NOT EXISTS error_book_entries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, relative_path TEXT, category TEXT NOT NULL,
  title TEXT NOT NULL, evidence TEXT NOT NULL, concept_ids_json TEXT NOT NULL, status TEXT NOT NULL,
  occurrences INTEGER NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  resolved_at TEXT, next_review_at TEXT
);
CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, error_book_entry_id TEXT REFERENCES error_book_entries(id),
  concept_id TEXT NOT NULL, prompt TEXT NOT NULL, expected_evidence TEXT NOT NULL,
  interval_index INTEGER NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_learner_knowledge_user ON learner_knowledge(user_id, status);
CREATE INDEX IF NOT EXISTS idx_error_book_user ON error_book_entries(user_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_items(user_id, status, due_at);
`

const growthSql = `
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY, source_event_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, type TEXT NOT NULL,
  concept_ids_json TEXT NOT NULL, xp INTEGER NOT NULL, evidence_json TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learner_progress (
  user_id TEXT PRIMARY KEY, xp INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS achievement_definitions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, icon TEXT NOT NULL,
  rule_json TEXT NOT NULL, xp_reward INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS learner_achievements (
  user_id TEXT NOT NULL, achievement_id TEXT NOT NULL REFERENCES achievement_definitions(id),
  source_event_id TEXT NOT NULL, unlocked_at TEXT NOT NULL,
  PRIMARY KEY(user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL,
  enabled INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, api_key_configured INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_events_user ON learning_events(user_id, occurred_at DESC);
`

const approvalDiffSql = `
ALTER TABLE approvals ADD COLUMN diff_text TEXT;
`

const assistantBackgroundSql = `
CREATE TABLE IF NOT EXISTS background_profiles (
  user_id TEXT PRIMARY KEY,
  onboarding_completed INTEGER NOT NULL,
  starting_point TEXT NOT NULL,
  studied_concept_ids_json TEXT NOT NULL,
  focus_concept_ids_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const conversationsAndDiagnosticsSql = `
CREATE TABLE IF NOT EXISTS diagnostic_incidents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL, target_key TEXT NOT NULL, operation TEXT NOT NULL,
  failure_kinds_json TEXT NOT NULL, status TEXT NOT NULL, acknowledged_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS diagnostic_groups (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES diagnostic_incidents(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL, source TEXT NOT NULL, code TEXT, failure_kind TEXT NOT NULL,
  severity TEXT NOT NULL, title TEXT NOT NULL, normalized_template TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnostic_occurrences (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES diagnostic_groups(id) ON DELETE CASCADE,
  file TEXT, line INTEGER, column_number INTEGER, end_line INTEGER, end_column INTEGER,
  raw_message TEXT NOT NULL, normalized_message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
  diagnostic_snapshot_json TEXT, error_code TEXT, error_message TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS project_conversation_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_diagnostic_active_target
  ON diagnostic_incidents(project_id, target_key, operation) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_diagnostic_project ON diagnostic_incidents(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostic_group_incident ON diagnostic_groups(incident_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_diagnostic_occurrence_group ON diagnostic_occurrences(group_id, file, line);
CREATE INDEX IF NOT EXISTS idx_conversation_project ON agent_conversations(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_conversation ON agent_messages(conversation_id, created_at, id);
`

const stableConversationMessageOrderSql = `
ALTER TABLE agent_messages ADD COLUMN sequence_number INTEGER;
UPDATE agent_messages SET sequence_number = rowid WHERE sequence_number IS NULL;
CREATE UNIQUE INDEX idx_message_sequence ON agent_messages(conversation_id, sequence_number);
`

const linkedAgentConversationSql = `
ALTER TABLE agent_runs ADD COLUMN conversation_id TEXT;
ALTER TABLE agent_runs ADD COLUMN assistant_message_id TEXT;
CREATE INDEX idx_agent_runs_conversation ON agent_runs(conversation_id, updated_at DESC);
`

const openAiAgentSessionsSql = `
ALTER TABLE agent_runs ADD COLUMN pending_clarification_json TEXT;
CREATE TABLE IF NOT EXISTS agent_model_sessions (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_agent_model_sessions_updated ON agent_model_sessions(updated_at DESC);
`

export const h3Migrations: Migration[] = [
  { version: 4, name: 'h3-agent-runs', sql: agentSql },
  { version: 5, name: 'h3-learning-state', sql: learningSql },
  { version: 6, name: 'h3-growth-and-models', sql: growthSql },
  { version: 7, name: 'h3-approval-diff', sql: approvalDiffSql },
  { version: 8, name: 'assistant-background-profile', sql: assistantBackgroundSql },
  { version: 9, name: 'agent-conversations-and-diagnostics', sql: conversationsAndDiagnosticsSql },
  { version: 10, name: 'stable-conversation-message-order', sql: stableConversationMessageOrderSql },
  { version: 11, name: 'linked-agent-conversations', sql: linkedAgentConversationSql },
  { version: 12, name: 'openai-agent-sessions', sql: openAiAgentSessionsSql }
]
