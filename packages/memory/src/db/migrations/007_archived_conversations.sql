-- Migration 007: Add archived column to conversations
-- Used by the session idle cleanup job (ITEM B).
-- Archived conversations are hidden from the default list but never deleted.
-- archived = 1 means the conversation has been archived by the cleanup job.
-- pinned conversations are never archived.

ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- Index for efficient cleanup queries:
-- "WHERE archived = 0 AND updated_at < X AND pinned = 0"
CREATE INDEX IF NOT EXISTS idx_conversations_archive_lookup
  ON conversations (archived, updated_at, pinned);
