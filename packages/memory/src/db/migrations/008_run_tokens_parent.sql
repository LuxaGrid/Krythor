-- Migration 008: add token tracking and parent run linkage to agent_runs
ALTER TABLE agent_runs ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN completion_tokens INTEGER;
ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT;
