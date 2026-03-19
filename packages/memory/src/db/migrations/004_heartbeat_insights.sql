-- Migration 004: Heartbeat insight persistence
-- Stores warning-severity heartbeat insights across restarts.
-- Retention is enforced by DbJanitor (24h window, 500-row ceiling).

CREATE TABLE IF NOT EXISTS heartbeat_insights (
  id           TEXT PRIMARY KEY,
  recorded_at  INTEGER NOT NULL,
  check_id     TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK(severity IN ('info', 'warning')),
  message      TEXT NOT NULL,
  actionable   INTEGER NOT NULL DEFAULT 0,
  suggested_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_hb_insights_recorded_at ON heartbeat_insights(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_hb_insights_severity    ON heartbeat_insights(severity, recorded_at DESC);
