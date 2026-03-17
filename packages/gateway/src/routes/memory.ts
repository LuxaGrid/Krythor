import type { FastifyInstance } from 'fastify';
import type { MemoryEngine, CreateMemoryInput, UpdateMemoryInput, MemoryScope } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';

export function registerMemoryRoutes(app: FastifyInstance, memory: MemoryEngine, models?: ModelEngine, guard?: GuardEngine): void {

  // GET /api/memory — list / search entries
  app.get('/api/memory', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const q = req.query as Record<string, string>;
    const results = await memory.search({
      text: q.text,
      scope: q.scope as MemoryScope | undefined,
      scope_id: q.scope_id,
      tags: q.tags ? q.tags.split(',').map(t => t.trim()) : undefined,
      pinned: q.pinned === 'true' ? true : q.pinned === 'false' ? false : undefined,
      minImportance: q.minImportance ? (parseFloat(q.minImportance) || undefined) : undefined,
      limit: Math.min(Math.max(1, parseInt(q.limit, 10) || 20), 500),
      offset: Math.max(0, parseInt(q.offset, 10) || 0),
    }, q.text);

    return reply.send(results);
  });

  // GET /api/memory/stats
  app.get('/api/memory/stats', async (_req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    return reply.send(memory.stats());
  });

  // GET /api/memory/:id
  app.get<{ Params: { id: string } }>('/api/memory/:id', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const entry = memory.getById(req.params.id);
    if (!entry) return reply.code(404).send({ error: 'Not found' });

    return reply.send({
      entry,
      tags: memory.getTagsForEntry(req.params.id),
      usage: memory.getUsageForEntry(req.params.id),
      sources: memory.getSourcesForEntry(req.params.id),
    });
  });

  // POST /api/memory — create entry
  app.post('/api/memory', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'content', 'scope', 'source'],
        properties: {
          title:            { type: 'string', minLength: 1, maxLength: 500 },
          content:          { type: 'string', minLength: 1, maxLength: 500000 },
          scope:            { type: 'string', enum: ['session','user','agent','workspace','skill'] },
          scope_id:         { type: 'string' },
          source:           { type: 'string' },
          importance:       { type: 'number', minimum: 0, maximum: 1 },
          tags:             { type: 'array', items: { type: 'string' } },
          source_type:      { type: 'string' },
          source_reference: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const result = memory.create(req.body as CreateMemoryInput);
    return reply.code(201).send({ entry: result.entry, risk: result.risk });
  });

  // PATCH /api/memory/:id — update entry
  app.patch<{ Params: { id: string } }>('/api/memory/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title:      { type: 'string', minLength: 1, maxLength: 500 },
          content:    { type: 'string', minLength: 1, maxLength: 500000 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          pinned:     { type: 'boolean' },
          tags:       { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const existing = memory.getById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const updated = memory.update(req.params.id, req.body as UpdateMemoryInput);
    return reply.send(updated);
  });

  // DELETE /api/memory/:id
  app.delete<{ Params: { id: string } }>('/api/memory/:id', async (req, reply) => {
    const existing = memory.getById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    memory.delete(req.params.id);
    return reply.code(204).send();
  });

  // POST /api/memory/prune — manually prune lowest-importance entries
  app.post('/api/memory/prune', {
    schema: {
      body: {
        type: 'object',
        properties: {
          maxEntries: { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { maxEntries } = (req.body ?? {}) as { maxEntries?: number };
    const deleted = memory.prune(maxEntries ?? 10_000);
    return reply.send({ deleted, totalEntries: memory.stats().totalEntries });
  });

  // POST /api/memory/summarize — consolidate lowest-importance entries in a scope into one
  // Requires a model provider to be configured. Summarizes up to `batchSize` entries at a time.
  app.post('/api/memory/summarize', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'object',
        properties: {
          scope:     { type: 'string', enum: ['user', 'agent', 'workspace', 'skill'] },
          batchSize: { type: 'number', minimum: 2, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!models) return sendError(reply, 503, 'NO_MODEL', 'Model engine not available');

    const { scope = 'user', batchSize = 10 } = (req.body ?? {}) as { scope?: string; batchSize?: number };

    // Retrieve the lowest-importance, non-pinned entries in this scope
    const candidates = await memory.search({
      scope: scope as MemoryScope,
      pinned: false,
      limit: batchSize,
    });

    if (candidates.length < 2) {
      return reply.send({ summarized: 0, message: 'Not enough entries to summarize' });
    }

    // Build a compact representation for the model
    const entryList = candidates.map((r, i) =>
      `[${i + 1}] ${r.entry.title}: ${r.entry.content.slice(0, 300)}`
    ).join('\n\n');

    const systemPrompt = `You are a memory consolidation assistant. You will receive several related memory entries and must produce a single consolidated summary that preserves all important information. Return ONLY the summary as plain text — no preamble, no lists, no markdown.`;

    const userMessage = `Consolidate these ${candidates.length} memory entries into one concise summary (2-4 sentences max):\n\n${entryList}`;

    try {
      const response = await models.infer({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
      });

      // Create summary entry with the highest importance of the source entries
      const maxImportance = Math.max(...candidates.map(r => r.entry.importance));
      const summarizedTitle = `Summary: ${scope} memories (${new Date().toLocaleDateString()})`;
      const { entry: summaryEntry } = memory.create({
        title:     summarizedTitle,
        content:   response.content.trim(),
        scope:     scope as MemoryScope,
        source:    'system:summarizer',
        importance: Math.min(maxImportance + 0.1, 1.0),
        tags:      ['summarized'],
        source_type: 'summary',
      });

      // Delete the source entries that were summarized
      for (const r of candidates) {
        memory.delete(r.entry.id);
      }

      return reply.send({
        summarized: candidates.length,
        summaryEntryId: summaryEntry.id,
        totalEntries: memory.stats().totalEntries,
      });
    } catch (err) {
      return sendError(reply, 502, 'SUMMARIZE_FAILED', err instanceof Error ? err.message : 'Summarization failed');
    }
  });

  // POST /api/memory/:id/pin
  app.post<{ Params: { id: string } }>('/api/memory/:id/pin', async (req, reply) => {
    const existing = memory.getById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    return reply.send(memory.pin(req.params.id));
  });

  // POST /api/memory/:id/unpin
  app.post<{ Params: { id: string } }>('/api/memory/:id/unpin', async (req, reply) => {
    const existing = memory.getById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    return reply.send(memory.unpin(req.params.id));
  });
}
