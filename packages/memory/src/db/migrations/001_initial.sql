-- Migration 001: Initial schema
-- This is the baseline schema extracted from the original applySchema() call.
-- All tables use CREATE TABLE IF NOT EXISTS so this is safe to re-run.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS memory_entries (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK(scope IN ('session','user','agent','workspace','skill')),
  scope_id     TEXT,
  source       TEXT NOT NULL,
  importance   REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_used    INTEGER NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS memory_tags (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  UNIQUE(memory_id, tag)
);

CREATE TABLE IF NOT EXISTS memory_usage (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  task_id     TEXT,
  timestamp   INTEGER NOT NULL,
  reason      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS memory_sources (
  id                TEXT PRIMARY KEY,
  memory_id         TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,
  source_reference  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_entries_scope      ON memory_entries(scope);
CREATE INDEX IF NOT EXISTS idx_entries_scope_id   ON memory_entries(scope_id);
CREATE INDEX IF NOT EXISTS idx_entries_last_used  ON memory_entries(last_used DESC);
CREATE INDEX IF NOT EXISTS idx_entries_importance ON memory_entries(importance DESC);
CREATE INDEX IF NOT EXISTS idx_entries_pinned     ON memory_entries(pinned);
CREATE INDEX IF NOT EXISTS idx_tags_memory_id     ON memory_tags(memory_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag           ON memory_tags(tag);
CREATE INDEX IF NOT EXISTS idx_usage_memory_id    ON memory_usage(memory_id);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT 'New Chat',
  agent_id   TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  model_id        TEXT,
  provider_id     TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS guard_decisions (
  id         TEXT PRIMARY KEY,
  timestamp  INTEGER NOT NULL,
  operation  TEXT NOT NULL,
  source     TEXT,
  scope      TEXT,
  allowed    INTEGER NOT NULL,
  action     TEXT NOT NULL,
  rule_id    TEXT,
  rule_name  TEXT,
  reason     TEXT,
  warnings   TEXT
);

CREATE INDEX IF NOT EXISTS idx_guard_decisions_timestamp ON guard_decisions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_guard_decisions_operation ON guard_decisions(operation);
