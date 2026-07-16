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

export const h3Migrations: Migration[] = [
  { version: 4, name: 'h3-agent-runs', sql: agentSql },
  { version: 5, name: 'h3-learning-state', sql: learningSql },
  { version: 6, name: 'h3-growth-and-models', sql: growthSql }
]

