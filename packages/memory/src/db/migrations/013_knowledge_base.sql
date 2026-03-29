-- Migration 013: Knowledge base — document and chunk storage
-- Documents are collections of chunks with shared source metadata.
-- Chunks store pre-split text segments suitable for embedding and retrieval.

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL,            -- URI, file path, or label
  mimeType    TEXT NOT NULL DEFAULT 'text/plain',
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array
  agentId     TEXT,                     -- optional: scoped to specific agent
  chunkCount  INTEGER NOT NULL DEFAULT 0,
  totalChars  INTEGER NOT NULL DEFAULT 0,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          TEXT PRIMARY KEY,
  documentId  TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunkIndex  INTEGER NOT NULL,
  content     TEXT NOT NULL,
  charCount   INTEGER NOT NULL,
  -- Optional embedding stored as JSON array of floats
  embedding   TEXT,
  createdAt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(documentId, chunkIndex);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_agent ON knowledge_documents(agentId);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source ON knowledge_documents(source);
