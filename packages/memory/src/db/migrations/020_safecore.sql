-- SafeCore execution records: one row per contained execution attempt
CREATE TABLE IF NOT EXISTS safecore_executions (
  id                TEXT PRIMARY KEY,
  run_id            TEXT,               -- linked agent run id (nullable)
  agent_id          TEXT,
  mode              TEXT NOT NULL,      -- READ_ONLY | WORKSPACE | CONNECTOR_LIMITED | ELEVATED_HOST
  requested_action  TEXT NOT NULL,      -- what the agent/user requested
  approved_action   TEXT,               -- what was ultimately approved (may differ)
  policy_result     TEXT NOT NULL,      -- allow | deny | warn | require-approval
  policy_reason     TEXT,
  filesystem_scope  TEXT,               -- JSON: { allowedPaths: string[], workspaceDir?: string }
  network_scope     TEXT,               -- JSON: { allowedHosts: string[], blockedHosts: string[] }
  connector_scope   TEXT,               -- JSON: { allowedConnectors: string[] }
  approval_state    TEXT NOT NULL DEFAULT 'none', -- none | pending | approved | denied
  promotion_state   TEXT NOT NULL DEFAULT 'none', -- none | pending | approved | promoted | rejected
  promoted_at       INTEGER,
  promoted_by       TEXT,
  result_state      TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed | blocked | promoted
  output            TEXT,               -- captured output/result (truncated to 10KB)
  files_touched     TEXT,               -- JSON array of file paths
  commands_run      TEXT,               -- JSON array of {cmd, args, exitCode}
  network_attempts  TEXT,               -- JSON array of {url, blocked: bool}
  error_message     TEXT,
  started_at        INTEGER NOT NULL,
  completed_at      INTEGER,
  retained_until    INTEGER,            -- null = use default retention; epoch ms for custom
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_safecore_mode        ON safecore_executions(mode);
CREATE INDEX IF NOT EXISTS idx_safecore_result      ON safecore_executions(result_state);
CREATE INDEX IF NOT EXISTS idx_safecore_approval    ON safecore_executions(approval_state);
CREATE INDEX IF NOT EXISTS idx_safecore_promotion   ON safecore_executions(promotion_state);
CREATE INDEX IF NOT EXISTS idx_safecore_agent       ON safecore_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_safecore_created_at  ON safecore_executions(created_at);

-- SafeCore policy configuration (one row per mode)
CREATE TABLE IF NOT EXISTS safecore_policies (
  mode                    TEXT PRIMARY KEY,
  enabled                 INTEGER NOT NULL DEFAULT 1,
  require_approval        INTEGER NOT NULL DEFAULT 0,
  require_promotion_approval INTEGER NOT NULL DEFAULT 1,
  allowed_paths           TEXT,   -- JSON string[]
  blocked_commands        TEXT,   -- JSON string[]
  allowed_hosts           TEXT,   -- JSON string[]
  blocked_hosts           TEXT,   -- JSON string[]
  allowed_connectors      TEXT,   -- JSON string[]
  retention_days          INTEGER NOT NULL DEFAULT 30,
  ephemeral               INTEGER NOT NULL DEFAULT 0,
  updated_at              INTEGER NOT NULL
);

-- Seed default policies for each mode
INSERT OR IGNORE INTO safecore_policies (mode, enabled, require_approval, require_promotion_approval, allowed_paths, blocked_commands, allowed_hosts, blocked_hosts, allowed_connectors, retention_days, ephemeral, updated_at)
VALUES
  ('READ_ONLY',          1, 0, 1, '[]', '["rm","del","format","mkfs","dd","truncate"]', '[]', '[]', '[]', 30, 0, strftime('%s','now') * 1000),
  ('WORKSPACE',          1, 0, 1, '[]', '["rm -rf /","format","mkfs","dd"]',           '[]', '[]', '[]', 30, 0, strftime('%s','now') * 1000),
  ('CONNECTOR_LIMITED',  1, 1, 1, '[]', '["rm","del","format","mkfs"]',               '[]', '[]', '[]', 30, 0, strftime('%s','now') * 1000),
  ('ELEVATED_HOST',      1, 1, 1, '[]', '[]',                                          '[]', '[]', '[]', 90, 0, strftime('%s','now') * 1000);
