-- Migration 014: Per-message token tracking
-- Adds optional input_tokens and output_tokens columns to messages.
-- input_tokens: number of tokens in the prompt/input for this turn
-- output_tokens: number of tokens in the completion/output for this turn
-- Both are nullable (NULL = not tracked / not available from provider).

ALTER TABLE messages ADD COLUMN input_tokens  INTEGER;
ALTER TABLE messages ADD COLUMN output_tokens INTEGER;

-- Aggregate token totals per conversation for fast stats queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_tokens
  ON messages(conversation_id)
  WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL;
