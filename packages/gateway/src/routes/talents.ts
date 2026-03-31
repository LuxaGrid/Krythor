/**
 * Talent Marketplace routes
 *
 * GET    /api/talents/dashboard              — stats overview
 * GET    /api/talents/outreach/pending       — all pending outreach
 * POST   /api/talents/rank                   — rank talent for a request
 * GET    /api/talents                        — search/list
 * GET    /api/talents/:id                    — get by id
 * POST   /api/talents                        — create
 * PATCH  /api/talents/:id                    — update
 * DELETE /api/talents/:id                    — delete
 * GET    /api/talents/:id/interactions       — list interactions
 * POST   /api/talents/:id/interactions       — add interaction
 * GET    /api/talents/:id/outreach           — list outreach
 * POST   /api/talents/:id/outreach           — create outreach
 * PATCH  /api/talents/:id/outreach/:outreachId — update outreach status
 * GET    /api/marketplace-requests           — list requests
 * POST   /api/marketplace-requests           — create request
 * PATCH  /api/marketplace-requests/:id/resolve — resolve request
 *
 * IMPORTANT: static path segments registered before parameterized ones
 * at the same depth (Fastify radix router constraint).
 */

import type { FastifyInstance } from 'fastify';
import type { MemoryEngine } from '@krythor/memory';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import { MarketplaceRankingEngine } from '../marketplace/MarketplaceRankingEngine.js';
import type { RankInput } from '../marketplace/MarketplaceRankingEngine.js';

export function registerTalentRoutes(
  app: FastifyInstance,
  memory: MemoryEngine,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {
  const store = memory.talentStore;
  const engine = new MarketplaceRankingEngine();

  // ── Static routes BEFORE /:id ──────────────────────────────────────────

  // GET /api/talents/dashboard
  app.get('/api/talents/dashboard', async (_req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const now = Date.now();
    const thirtyDaysAgo  = now - 30  * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo  = now - 90  * 24 * 60 * 60 * 1000;

    const all       = store.search({ limit: 1000 });
    const active    = all.filter(t => t.status === 'active');
    const preferred = all.filter(t => t.preferred);
    const recentlyUsed = all.filter(t =>
      t.lastUsedAt !== undefined && t.lastUsedAt >= thirtyDaysAgo
    );
    const recentlyContacted = all.filter(t =>
      t.lastContactedAt !== undefined && t.lastContactedAt >= ninetyDaysAgo
    );
    const pending = store.listPendingOutreach();

    return reply.send({
      totalActive:        active.length,
      totalProfiles:      all.length,
      preferredCount:     preferred.length,
      recentlyUsedCount:  recentlyUsed.length,
      recentlyContactedCount: recentlyContacted.length,
      pendingOutreachCount: pending.length,
    });
  });

  // GET /api/talents/outreach/pending — BEFORE /:id
  app.get('/api/talents/outreach/pending', async (_req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const items = store.listPendingOutreach();
    return reply.send(items);
  });

  // POST /api/talents/rank — BEFORE /:id
  app.post('/api/talents/rank', async (req, reply) => {
    const body = req.body as RankInput;
    if (!body || typeof body.query !== 'string') {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'query is required');
    }

    const filter: Record<string, unknown> = {};
    if (body.category) filter['category'] = body.category;

    const candidates = store.search({ limit: 500 });
    const results    = engine.rank(candidates, body);
    return reply.send(results);
  });

  // ── CRUD routes ────────────────────────────────────────────────────────

  // GET /api/talents
  app.get('/api/talents', async (req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const q = req.query as Record<string, string>;
    const results = store.search({
      query:    q['keywords'] ?? q['query'],
      category: q['category'],
      state:    q['state'],
      city:     q['city'],
      status:   q['status'] as import('@krythor/memory').TalentStatus | undefined,
      preferred: q['preferred'] === 'true' ? true : q['preferred'] === 'false' ? false : undefined,
      tags:     q['tags'] ? q['tags'].split(',').map(t => t.trim()).filter(Boolean) : undefined,
      limit:    q['limit']  ? Math.min(parseInt(q['limit'],  10), 1000) : 100,
      offset:   q['offset'] ? parseInt(q['offset'], 10) : 0,
    });
    return reply.send(results);
  });

  // GET /api/talents/:id
  app.get<{ Params: { id: string } }>('/api/talents/:id', async (req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const talent = store.getById(req.params.id);
    if (!talent) return sendError(reply, 404, 'TALENT_NOT_FOUND', `Talent "${req.params.id}" not found`);
    return reply.send(talent);
  });

  // POST /api/talents
  app.post('/api/talents', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'memory:write', source: 'user' });
    if (!allowed) return;
    try {
      const talent = store.create(req.body as import('@krythor/memory').CreateTalentInput);
      return reply.code(201).send(talent);
    } catch (err) {
      return sendError(reply, 400, 'TALENT_CREATE_FAILED', err instanceof Error ? err.message : 'Create failed');
    }
  });

  // PATCH /api/talents/:id
  app.patch<{ Params: { id: string } }>('/api/talents/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'memory:write', source: 'user' });
    if (!allowed) return;
    try {
      const talent = store.update(req.params.id, req.body as import('@krythor/memory').UpdateTalentInput);
      return reply.send(talent);
    } catch (err) {
      return sendError(reply, 404, 'TALENT_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // DELETE /api/talents/:id
  app.delete<{ Params: { id: string } }>('/api/talents/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'memory:write', source: 'user' });
    if (!allowed) return;
    try {
      store.delete(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, 404, 'TALENT_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // ── Interactions ──────────────────────────────────────────────────────

  // GET /api/talents/:id/interactions
  app.get<{ Params: { id: string } }>('/api/talents/:id/interactions', async (req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const talent = store.getById(req.params.id);
    if (!talent) return sendError(reply, 404, 'TALENT_NOT_FOUND', `Talent "${req.params.id}" not found`);
    const q = req.query as Record<string, string>;
    const limit = q['limit'] ? Math.min(parseInt(q['limit'], 10), 1000) : 100;
    const items = store.listInteractions(req.params.id, limit);
    return reply.send(items);
  });

  // POST /api/talents/:id/interactions
  app.post<{ Params: { id: string } }>('/api/talents/:id/interactions', async (req, reply) => {
    const talent = store.getById(req.params.id);
    if (!talent) return sendError(reply, 404, 'TALENT_NOT_FOUND', `Talent "${req.params.id}" not found`);
    try {
      const interaction = store.addInteraction(req.params.id, req.body as Omit<import('@krythor/memory').TalentInteraction, 'id' | 'createdAt'>);
      return reply.code(201).send(interaction);
    } catch (err) {
      return sendError(reply, 400, 'INTERACTION_FAILED', err instanceof Error ? err.message : 'Failed to add interaction');
    }
  });

  // ── Outreach ──────────────────────────────────────────────────────────

  // GET /api/talents/:id/outreach
  app.get<{ Params: { id: string } }>('/api/talents/:id/outreach', async (req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const talent = store.getById(req.params.id);
    if (!talent) return sendError(reply, 404, 'TALENT_NOT_FOUND', `Talent "${req.params.id}" not found`);
    const items = store.listOutreach(req.params.id);
    return reply.send(items);
  });

  // POST /api/talents/:id/outreach
  app.post<{ Params: { id: string } }>('/api/talents/:id/outreach', async (req, reply) => {
    const talent = store.getById(req.params.id);
    if (!talent) return sendError(reply, 404, 'TALENT_NOT_FOUND', `Talent "${req.params.id}" not found`);

    const body = req.body as Omit<import('@krythor/memory').TalentOutreach, 'id' | 'createdAt'>;

    // Guard check when attempting to immediately send
    if (body.status === 'sent') {
      const allowed = await guardCheck({
        guard,
        approvalManager,
        reply,
        operation: 'memory:write',
        source: 'user',
        actionSummary: `Send outreach to talent "${talent.displayName}" via ${body.channel ?? 'unknown channel'}`,
      });
      if (!allowed) return;
    }

    try {
      const outreach = store.addOutreach(req.params.id, body);
      return reply.code(201).send(outreach);
    } catch (err) {
      return sendError(reply, 400, 'OUTREACH_FAILED', err instanceof Error ? err.message : 'Failed to create outreach');
    }
  });

  // PATCH /api/talents/:id/outreach/:outreachId
  app.patch<{ Params: { id: string; outreachId: string } }>('/api/talents/:id/outreach/:outreachId', async (req, reply) => {
    try {
      const updated = store.updateOutreach(req.params.outreachId, req.body as Partial<Pick<import('@krythor/memory').TalentOutreach, 'status' | 'approvalId' | 'approvedBy' | 'sentAt'>>);
      return reply.send(updated);
    } catch (err) {
      return sendError(reply, 404, 'OUTREACH_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // ── Marketplace requests ──────────────────────────────────────────────

  // GET /api/marketplace-requests
  app.get('/api/marketplace-requests', async (req, reply) => {
    const verdict = await guardCheck({ guard, approvalManager, reply, operation: 'memory:read', source: 'user' });
    if (verdict === false) return;
    const q = req.query as Record<string, string>;
    const limit = q['limit'] ? Math.min(parseInt(q['limit'], 10), 1000) : 50;
    const requests = store.listRequests(limit);
    return reply.send(requests);
  });

  // POST /api/marketplace-requests
  app.post('/api/marketplace-requests', async (req, reply) => {
    try {
      const request = store.createRequest(req.body as Omit<import('@krythor/memory').MarketplaceRequest, 'id' | 'createdAt'>);
      return reply.code(201).send(request);
    } catch (err) {
      return sendError(reply, 400, 'REQUEST_FAILED', err instanceof Error ? err.message : 'Failed to create request');
    }
  });

  // PATCH /api/marketplace-requests/:id/resolve
  app.patch<{ Params: { id: string } }>('/api/marketplace-requests/:id/resolve', async (req, reply) => {
    const body = req.body as { talentId?: string };
    if (!body?.talentId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'talentId is required');
    }
    try {
      store.resolveRequest(req.params.id, body.talentId);
      return reply.send({ ok: true });
    } catch (err) {
      return sendError(reply, 404, 'REQUEST_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });
}
