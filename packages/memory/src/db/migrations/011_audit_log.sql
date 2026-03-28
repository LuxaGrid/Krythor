CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT NOT NULL PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT 'safe',
  allowed INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON audit_log (agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_operation ON audit_log (operation);
