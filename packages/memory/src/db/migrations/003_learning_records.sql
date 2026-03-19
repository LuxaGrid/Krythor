-- Migration 003: Self-learning event records
-- Captures structured usage signals for the model recommendation engine.
-- Records are append-only by design; compaction happens via retention rules.

CREATE TABLE IF NOT EXISTS learning_records (
  id              TEXT PRIMARY KEY,
  recorded_at     INTEGER NOT NULL,

  -- Task context
  task_type       TEXT NOT NULL,   -- e.g. 'summarize', 'code', 'draft', 'classify'
  task_text_hash  TEXT,            -- SHA-1 prefix of input for dedup; NOT the raw text

  -- Skill / agent
  skill_id        TEXT,
  agent_id        TEXT,

  -- Model selection
  model_id        TEXT NOT NULL,
  provider_id     TEXT NOT NULL,
  recommended_model_id TEXT,       -- what the recommender suggested (if anything)
  user_accepted_recommendation INTEGER NOT NULL DEFAULT 1, -- 0 = user overrode

  -- Outcome signals
  outcome         TEXT NOT NULL CHECK(outcome IN ('success','failure','stopped')),
  latency_ms      INTEGER,
  estimated_cost  REAL,            -- USD, best effort
  retries         INTEGER NOT NULL DEFAULT 0,
  turn_count      INTEGER,

  -- Meta
  was_pinned_preference INTEGER NOT NULL DEFAULT 0  -- 1 if user had pinned this model for this task type
);

CREATE INDEX IF NOT EXISTS idx_learning_task_type   ON learning_records(task_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_model        ON learning_records(model_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_recorded_at  ON learning_records(recorded_at DESC);
