-- Migration 002: Agent run history
-- Persists completed agent runs so the UI can display history across restarts.
-- Messages are stored as a JSON blob to avoid schema churn as AgentMessage evolves.

CREATE TABLE IF NOT EXISTS agent_runs (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  status              TEXT NOT NULL CHECK(status IN ('running','completed','failed','stopped')),
  input               TEXT NOT NULL,
  output              TEXT,
  model_used          TEXT,
  error_message       TEXT,
  started_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  messages_json       TEXT NOT NULL DEFAULT '[]',
  memory_ids_used     TEXT NOT NULL DEFAULT '[]',
  memory_ids_written  TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id    ON agent_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at  ON agent_runs(started_at DESC);
