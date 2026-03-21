-- Migration 006: conversation name + pinned support
-- Adds optional `name` column and `pinned` boolean column to conversations.
-- name:   user-defined display name (NULL = use auto-generated title)
-- pinned: when true, conversation appears first in listings

ALTER TABLE conversations ADD COLUMN name   TEXT;
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(pinned DESC, updated_at DESC);
