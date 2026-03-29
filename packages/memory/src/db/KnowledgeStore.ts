/**
 * KnowledgeStore — document and chunk storage for RAG workflows.
 *
 * Documents are split into chunks by the caller (DocumentIngester).
 * This store handles persistence, retrieval, and deletion only.
 *
 * Text search uses SQLite FTS-style LIKE queries. Vector search
 * is handled by the EmbeddingCache layer when embeddings are present.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface KnowledgeDocument {
  id: string;
  title: string;
  source: string;
  mimeType: string;
  tags: string[];
  agentId?: string;
  chunkCount: number;
  totalChars: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  charCount: number;
  embedding?: number[];
  createdAt: number;
}

export interface CreateDocumentInput {
  title: string;
  source: string;
  mimeType?: string;
  tags?: string[];
  agentId?: string;
}

export interface CreateChunkInput {
  content: string;
  embedding?: number[];
}

export interface SearchChunksOptions {
  query: string;
  documentId?: string;
  agentId?: string;
  limit?: number;
}

export class KnowledgeStore {
  constructor(private readonly db: Database.Database) {}

  // ── Documents ─────────────────────────────────────────────────────────────

  getDocument(id: string): KnowledgeDocument | null {
    const row = this.db.prepare(
      'SELECT * FROM knowledge_documents WHERE id = ?'
    ).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToDoc(row);
  }

  listDocuments(opts: { agentId?: string; limit?: number } = {}): KnowledgeDocument[] {
    const limit = Math.min(opts.limit ?? 100, 1000);
    const rows = opts.agentId
      ? this.db.prepare('SELECT * FROM knowledge_documents WHERE agentId = ? ORDER BY createdAt DESC LIMIT ?').all(opts.agentId, limit)
      : this.db.prepare('SELECT * FROM knowledge_documents ORDER BY createdAt DESC LIMIT ?').all(limit);
    return (rows as Record<string, unknown>[]).map(r => this.rowToDoc(r));
  }

  createDocument(input: CreateDocumentInput): KnowledgeDocument {
    const now = Date.now();
    const doc: KnowledgeDocument = {
      id: randomUUID(),
      title: input.title,
      source: input.source,
      mimeType: input.mimeType ?? 'text/plain',
      tags: input.tags ?? [],
      agentId: input.agentId,
      chunkCount: 0,
      totalChars: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO knowledge_documents (id, title, source, mimeType, tags, agentId, chunkCount, totalChars, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(doc.id, doc.title, doc.source, doc.mimeType, JSON.stringify(doc.tags), doc.agentId ?? null, now, now);
    return doc;
  }

  deleteDocument(id: string): void {
    // Chunks are deleted via ON DELETE CASCADE
    this.db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(id);
  }

  // ── Chunks ────────────────────────────────────────────────────────────────

  getChunk(id: string): KnowledgeChunk | null {
    const row = this.db.prepare('SELECT * FROM knowledge_chunks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToChunk(row);
  }

  listChunks(documentId: string): KnowledgeChunk[] {
    const rows = this.db.prepare(
      'SELECT * FROM knowledge_chunks WHERE documentId = ? ORDER BY chunkIndex ASC'
    ).all(documentId) as Record<string, unknown>[];
    return rows.map(r => this.rowToChunk(r));
  }

  addChunks(documentId: string, chunks: CreateChunkInput[]): KnowledgeChunk[] {
    const doc = this.getDocument(documentId);
    if (!doc) throw new Error(`Document "${documentId}" not found`);

    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_chunks (id, documentId, chunkIndex, content, charCount, embedding, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const results: KnowledgeChunk[] = [];
    let startIndex = doc.chunkCount;
    let totalNewChars = 0;

    const insertMany = this.db.transaction((items: CreateChunkInput[]) => {
      for (const chunk of items) {
        const id = randomUUID();
        const embeddingJson = chunk.embedding ? JSON.stringify(chunk.embedding) : null;
        stmt.run(id, documentId, startIndex, chunk.content, chunk.content.length, embeddingJson, now);
        results.push({
          id,
          documentId,
          chunkIndex: startIndex,
          content: chunk.content,
          charCount: chunk.content.length,
          embedding: chunk.embedding,
          createdAt: now,
        });
        totalNewChars += chunk.content.length;
        startIndex++;
      }
    });

    insertMany(chunks);

    // Update document metadata
    this.db.prepare(`
      UPDATE knowledge_documents SET chunkCount = ?, totalChars = ?, updatedAt = ? WHERE id = ?
    `).run(startIndex, doc.totalChars + totalNewChars, now, documentId);

    return results;
  }

  /**
   * Simple text search across chunks using LIKE.
   * Returns up to `limit` chunks whose content contains the query (case-insensitive).
   */
  searchChunks(opts: SearchChunksOptions): KnowledgeChunk[] {
    const limit = Math.min(opts.limit ?? 10, 100);
    const q = `%${opts.query}%`;

    let rows: Record<string, unknown>[];
    if (opts.documentId) {
      rows = this.db.prepare(
        'SELECT kc.* FROM knowledge_chunks kc WHERE kc.documentId = ? AND kc.content LIKE ? ORDER BY kc.chunkIndex ASC LIMIT ?'
      ).all(opts.documentId, q, limit) as Record<string, unknown>[];
    } else if (opts.agentId) {
      rows = this.db.prepare(`
        SELECT kc.* FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.documentId
        WHERE kd.agentId = ? AND kc.content LIKE ?
        ORDER BY kc.createdAt DESC LIMIT ?
      `).all(opts.agentId, q, limit) as Record<string, unknown>[];
    } else {
      rows = this.db.prepare(
        'SELECT * FROM knowledge_chunks WHERE content LIKE ? ORDER BY createdAt DESC LIMIT ?'
      ).all(q, limit) as Record<string, unknown>[];
    }

    return rows.map(r => this.rowToChunk(r));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private rowToDoc(row: Record<string, unknown>): KnowledgeDocument {
    return {
      id:         row['id'] as string,
      title:      row['title'] as string,
      source:     row['source'] as string,
      mimeType:   row['mimeType'] as string,
      tags:       JSON.parse(row['tags'] as string ?? '[]') as string[],
      agentId:    row['agentId'] as string | undefined,
      chunkCount: row['chunkCount'] as number,
      totalChars: row['totalChars'] as number,
      createdAt:  row['createdAt'] as number,
      updatedAt:  row['updatedAt'] as number,
    };
  }

  private rowToChunk(row: Record<string, unknown>): KnowledgeChunk {
    const embeddingRaw = row['embedding'] as string | null;
    return {
      id:          row['id'] as string,
      documentId:  row['documentId'] as string,
      chunkIndex:  row['chunkIndex'] as number,
      content:     row['content'] as string,
      charCount:   row['charCount'] as number,
      embedding:   embeddingRaw ? JSON.parse(embeddingRaw) as number[] : undefined,
      createdAt:   row['createdAt'] as number,
    };
  }
}
