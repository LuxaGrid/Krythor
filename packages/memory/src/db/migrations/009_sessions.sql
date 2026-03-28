-- ─── Migration 009: session key store ───────────────────────────────────────
--
-- Introduces a sessions table that maps structured session keys
-- (e.g. agent:<agentId>:telegram:direct:<peerId>) to conversation IDs.
-- This enables dmScope isolation, identityLinks, and channel routing
-- without breaking the existing conversations/messages tables.
--

CREATE TABLE IF NOT EXISTS sessions (
  session_key     TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id        TEXT,
  channel         TEXT,
  chat_type       TEXT,   -- 'direct' | 'group' | 'channel' | 'cron' | 'hook' | 'node' | 'main'
  peer_id         TEXT,
  account_id      TEXT,
  display_name    TEXT,
  last_channel    TEXT,
  last_to         TEXT,
  send_policy     TEXT,   -- null | 'allow' | 'deny'
  model_override  TEXT,
  origin_label    TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_conversation ON sessions (conversation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent        ON sessions (agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated      ON sessions (updated_at DESC);
