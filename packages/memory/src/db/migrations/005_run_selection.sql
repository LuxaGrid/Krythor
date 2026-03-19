-- Migration 005: add selectionReason, fallbackOccurred, retryCount to agent_runs
ALTER TABLE agent_runs ADD COLUMN selection_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN fallback_occurred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
