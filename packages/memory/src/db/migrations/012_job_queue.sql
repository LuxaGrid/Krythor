-- Migration 012: Persistent job queue
-- Backs agent runs, cron jobs, and delegations with SQLite so they survive
-- gateway restarts.

CREATE TABLE IF NOT EXISTS job_queue (
  id           TEXT    NOT NULL PRIMARY KEY,
  type         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  agent_id     TEXT    NOT NULL,
  input        TEXT    NOT NULL,
  output       TEXT,
  error        TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  completed_at INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after    INTEGER NOT NULL DEFAULT 0,
  metadata     TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue (status, run_after);
CREATE INDEX IF NOT EXISTS idx_job_queue_agent  ON job_queue (agent_id);
