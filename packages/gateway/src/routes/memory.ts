import type { FastifyInstance } from 'fastify';
import type { MemoryEngine, CreateMemoryInput, UpdateMemoryInput, MemoryScope } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import { createHash } from 'crypto';

export function registerMemoryRoutes(app: FastifyInstance, memory: MemoryEngine, models?: ModelEngine, guard?: GuardEngine, emit?: (event: string, data: Record<string, unknown>) => void): void {

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

  // GET /api/memory/search — paginated search with total count envelope
  // Returns { results, total, page, limit } for consistent pagination support.
  // Supports the same query params as GET /api/memory plus explicit page/limit.
  app.get('/api/memory/search', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const q = req.query as Record<string, string>;
    const page  = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(q.limit, 10) || 20), 200);
    const offset = (page - 1) * limit;

    // Fetch all matching entries (for total count), then slice for page
    // We fetch up to offset+limit items to avoid full-table count on large DBs,
    // but we also need the total — use a separate count query.
    const all = await memory.search({
      text:          q.q || q.text,
      scope:         q.scope as MemoryScope | undefined,
      scope_id:      q.scope_id,
      tags:          q.tags ? q.tags.split(',').map(t => t.trim()) : undefined,
      pinned:        q.pinned === 'true' ? true : q.pinned === 'false' ? false : undefined,
      minImportance: q.minImportance ? (parseFloat(q.minImportance) || undefined) : undefined,
      limit:         10_000, // fetch all matches to get accurate total
      offset:        0,
    }, q.q || q.text);

    const total = all.length;
    const results = all.slice(offset, offset + limit);

    return reply.send({ results, total, page, limit });
  });

  // GET /api/memory/stats — total entries, oldest/newest date, size estimate
  app.get('/api/memory/stats', async (_req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const base = memory.stats();
    // Retrieve all entries for date range + size estimate (low overhead — metadata only)
    const all = memory.store.queryEntries({ limit: 1_000_000 });
    const oldest = all.length > 0
      ? new Date(Math.min(...all.map(e => e.created_at))).toISOString()
      : null;
    const newest = all.length > 0
      ? new Date(Math.max(...all.map(e => e.created_at))).toISOString()
      : null;
    // Size estimate: sum of title + content byte lengths
    const sizeBytes = all.reduce((sum, e) => sum + Buffer.byteLength(e.title + e.content, 'utf-8'), 0);
    return reply.send({
      ...base,
      oldest,
      newest,
      sizeEstimateBytes: sizeBytes,
    });
  });

  // GET /api/memory/tags — returns unique tags across all memory entries (auth required)
  // Used by the Memory tab UI to populate the tag filter dropdown.
  app.get('/api/memory/tags', async (_req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const all = memory.store.queryEntries({ limit: 1_000_000 });
    const tagSet = new Set<string>();
    for (const entry of all) {
      const tags = memory.store.getTagsForEntry(entry.id);
      for (const tag of tags) tagSet.add(tag);
    }
    const tags = Array.from(tagSet).sort();
    return reply.send({ tags });
  });

  // GET /api/memory/export — export all entries as JSON array (auth required)
  app.get('/api/memory/export', async (_req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const all = memory.store.queryEntries({ limit: 1_000_000 });
    const exported = all.map(e => ({
      id:        e.id,
      content:   e.content,
      tags:      memory.store.getTagsForEntry(e.id),
      source:    e.source,
      createdAt: new Date(e.created_at).toISOString(),
      updatedAt: new Date(e.last_used).toISOString(),
      // Extra fields preserved for round-trip fidelity
      title:       e.title,
      scope:       e.scope,
      scope_id:    e.scope_id,
      importance:  e.importance,
      pinned:      e.pinned,
    }));
    return reply
      .header('Content-Disposition', 'attachment; filename="krythor-memory-export.json"')
      .send(exported);
  });

  // POST /api/memory/import — import memory entries, no duplicates by content hash (auth required)
  app.post('/api/memory/import', {
    config: { rateLimit: { max: 5, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'array',
        items: {
          type: 'object',
          required: ['content', 'source'],
          properties: {
            id:        { type: 'string' },
            content:   { type: 'string', minLength: 1, maxLength: 500000 },
            tags:      { type: 'array', items: { type: 'string' } },
            source:    { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            title:     { type: 'string' },
            scope:     { type: 'string', enum: ['session', 'user', 'agent', 'workspace', 'skill'] },
            scope_id:  { type: 'string' },
            importance:{ type: 'number', minimum: 0, maximum: 1 },
            pinned:    { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
  }, async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:write', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }

    const items = req.body as Array<{
      id?: string;
      content: string;
      tags?: string[];
      source: string;
      createdAt?: string;
      updatedAt?: string;
      title?: string;
      scope?: string;
      scope_id?: string;
      importance?: number;
      pinned?: boolean;
    }>;

    // Build content-hash set from existing entries to detect duplicates
    const existingEntries = memory.store.queryEntries({ limit: 1_000_000 });
    const existingHashes = new Set(
      existingEntries.map(e => createHash('sha256').update(e.content).digest('hex'))
    );

    let imported = 0;
    let skipped = 0;

    for (const item of items) {
      const contentHash = createHash('sha256').update(item.content).digest('hex');
      if (existingHashes.has(contentHash)) {
        skipped++;
        continue;
      }
      existingHashes.add(contentHash); // prevent duplicates within the import batch too
      try {
        memory.create({
          title:      item.title ?? item.content.slice(0, 80),
          content:    item.content,
          scope:      (item.scope as MemoryScope) ?? 'user',
          scope_id:   item.scope_id,
          source:     item.source,
          importance: item.importance ?? 0.5,
          tags:       item.tags ?? [],
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return reply.send({ imported, skipped, total: items.length });
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
    emit?.('memory_saved', { id: result.entry.id, scope: result.entry.scope, source: result.entry.source });
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

  // DELETE /api/memory — bulk delete with query params: olderThan=<ISO date>, tag=<string>, source=<string>
  // At least one filter is required to prevent accidental full wipes.
  app.delete('/api/memory', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'memory:write', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }

    const q = req.query as Record<string, string>;
    const { olderThan, tag, source } = q;

    if (!olderThan && !tag && !source) {
      return reply.code(400).send({
        error: 'MISSING_FILTER',
        message: 'At least one filter is required: olderThan, tag, or source',
      });
    }

    // Parse olderThan as ISO date → ms timestamp
    let olderThanMs: number | undefined;
    if (olderThan) {
      const ts = Date.parse(olderThan);
      if (isNaN(ts)) {
        return reply.code(400).send({ error: 'INVALID_DATE', message: 'olderThan must be a valid ISO date string' });
      }
      olderThanMs = ts;
    }

    // Query candidates matching the filters
    const candidates = memory.store.queryEntries({
      ...(tag    && { tags: [tag] }),
      limit: 1_000_000,
    });

    let deleted = 0;
    for (const entry of candidates) {
      const matchesOlderThan = olderThanMs ? entry.created_at < olderThanMs : true;
      const matchesSource    = source      ? entry.source === source         : true;
      if (matchesOlderThan && matchesSource) {
        memory.delete(entry.id);
        deleted++;
      }
    }

    return reply.send({ deleted });
  });

  // DELETE /api/memory/:id
  app.delete<{ Params: { id: string } }>('/api/memory/:id', async (req, reply) => {
    const existing = memory.getById(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    memory.delete(req.params.id);
    emit?.('memory_deleted', { id: req.params.id });
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
