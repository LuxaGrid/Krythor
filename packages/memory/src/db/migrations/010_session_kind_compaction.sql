-- ─── Migration 010: session kind classification and compaction scaffolding ──────
--
-- sessions.kind                        — lifecycle classification for per-kind retention
-- conversations.compacted_at           — when compaction last ran (NULL = never)
-- conversations.compact_summary        — short summary written at compaction time
-- conversations.transcript_pruned_at   — when raw transcript was trimmed post-compaction
-- agent_runs.session_kind              — mirrors sessions.kind for per-kind retention queries
--
-- valid kind values: 'interactive' | 'agent_run' | 'cron_run' | 'tool_run' | 'debug' | 'temporary'
-- Default is 'interactive' so all rows written before this migration read back safely.

ALTER TABLE sessions       ADD COLUMN kind                 TEXT NOT NULL DEFAULT 'interactive';
ALTER TABLE conversations  ADD COLUMN compacted_at         INTEGER;
ALTER TABLE conversations  ADD COLUMN compact_summary      TEXT;
ALTER TABLE conversations  ADD COLUMN transcript_pruned_at INTEGER;
ALTER TABLE agent_runs     ADD COLUMN session_kind         TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_kind           ON sessions      (kind);
CREATE INDEX IF NOT EXISTS idx_conversations_compacted ON conversations (compacted_at);
