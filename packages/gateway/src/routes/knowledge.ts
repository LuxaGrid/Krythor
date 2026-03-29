/**
 * Knowledge base routes — document ingestion, chunk management, and search.
 *
 * POST   /api/knowledge/documents              — ingest a new document (auto-chunks)
 * GET    /api/knowledge/documents              — list all documents
 * GET    /api/knowledge/documents/:id          — get document metadata
 * DELETE /api/knowledge/documents/:id          — delete document (and chunks)
 * GET    /api/knowledge/documents/:id/chunks   — list chunks for document
 * POST   /api/knowledge/search                 — search chunks by text
 *
 * Text is split into chunks using a character-based sliding window.
 * Default chunk size: 512 chars with 64-char overlap.
 */

import type { FastifyInstance } from 'fastify';
import type { MemoryEngine } from '@krythor/memory';

const DEFAULT_CHUNK_SIZE    = 512;
const DEFAULT_CHUNK_OVERLAP = 64;
const MAX_INGEST_CHARS      = 500_000; // 500KB text limit per document

/**
 * Split text into overlapping chunks.
 */
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function registerKnowledgeRoutes(
  app: FastifyInstance,
  memory: MemoryEngine,
): void {
  const store = memory.knowledgeStore;

  // POST /api/knowledge/documents — ingest text document
  app.post('/api/knowledge/documents', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title:       { type: 'string', minLength: 1, maxLength: 500 },
          content:     { type: 'string', minLength: 1, maxLength: MAX_INGEST_CHARS },
          source:      { type: 'string', maxLength: 1000 },
          mimeType:    { type: 'string', maxLength: 100 },
          tags:        { type: 'array', items: { type: 'string' }, maxItems: 50 },
          agentId:     { type: 'string' },
          chunkSize:   { type: 'number', minimum: 64, maximum: 8192 },
          chunkOverlap: { type: 'number', minimum: 0, maximum: 512 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      title: string;
      content: string;
      source?: string;
      mimeType?: string;
      tags?: string[];
      agentId?: string;
      chunkSize?: number;
      chunkOverlap?: number;
    };

    const chunkSize    = body.chunkSize    ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = body.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

    const doc = store.createDocument({
      title:    body.title,
      source:   body.source ?? 'manual',
      mimeType: body.mimeType ?? 'text/plain',
      tags:     body.tags,
      agentId:  body.agentId,
    });

    const textChunks = chunkText(body.content, chunkSize, chunkOverlap);
    const chunks = store.addChunks(doc.id, textChunks.map(c => ({ content: c })));

    return reply.code(201).send({
      document: store.getDocument(doc.id),
      chunkCount: chunks.length,
    });
  });

  // GET /api/knowledge/documents
  app.get<{ Querystring: { agentId?: string; limit?: string } }>(
    '/api/knowledge/documents',
    async (req, reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 1000);
      return reply.send(store.listDocuments({ agentId: req.query.agentId, limit }));
    },
  );

  // GET /api/knowledge/documents/:id
  app.get<{ Params: { id: string } }>('/api/knowledge/documents/:id', async (req, reply) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return reply.code(404).send({ error: 'Document not found' });
    return reply.send(doc);
  });

  // DELETE /api/knowledge/documents/:id
  app.delete<{ Params: { id: string } }>('/api/knowledge/documents/:id', async (req, reply) => {
    if (!store.getDocument(req.params.id)) {
      return reply.code(404).send({ error: 'Document not found' });
    }
    store.deleteDocument(req.params.id);
    return reply.send({ ok: true });
  });

  // GET /api/knowledge/documents/:id/chunks
  app.get<{ Params: { id: string } }>('/api/knowledge/documents/:id/chunks', async (req, reply) => {
    if (!store.getDocument(req.params.id)) {
      return reply.code(404).send({ error: 'Document not found' });
    }
    return reply.send(store.listChunks(req.params.id));
  });

  // POST /api/knowledge/search
  app.post('/api/knowledge/search', {
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query:      { type: 'string', minLength: 1, maxLength: 1000 },
          documentId: { type: 'string' },
          agentId:    { type: 'string' },
          limit:      { type: 'number', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { query, documentId, agentId, limit } = req.body as {
      query: string;
      documentId?: string;
      agentId?: string;
      limit?: number;
    };
    const results = store.searchChunks({ query, documentId, agentId, limit });
    return reply.send({ query, results, count: results.length });
  });
}
