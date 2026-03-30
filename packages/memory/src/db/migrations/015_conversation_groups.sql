CREATE TABLE conversation_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

ALTER TABLE conversations ADD COLUMN group_id TEXT REFERENCES conversation_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_group ON conversations(group_id);
CREATE INDEX idx_conversation_groups_sort ON conversation_groups(sort_order ASC, created_at ASC);
