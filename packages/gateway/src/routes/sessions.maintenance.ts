/**
 * Session management routes — extends the basic maintenance in conversations.ts.
 *
 * GET  /api/sessions/list               — list sessions with age metadata
 * GET  /api/sessions/stale              — preview stale sessions (dry-run)
 * POST /api/sessions/prune              — delete stale sessions by age
 * POST /api/sessions/delete             — delete a specific session by key
 *
 * "Stale" = session last updated more than `staleDays` days ago (default 30).
 */

import type { FastifyInstance } from 'fastify';
import type { MemoryEngine } from '@krythor/memory';

export function registerSessionMaintenanceRoutes(
  app: FastifyInstance,
  memory: MemoryEngine,
): void {
  const DEFAULT_STALE_DAYS = 30;

  // GET /api/sessions/list — list all sessions with age metadata
  app.get<{ Querystring: { limit?: string; agentId?: string; activeMinutes?: string } }>(
    '/api/sessions/list',
    async (req, reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? '200', 10) || 200, 1000);
      const activeMinutes = req.query.activeMinutes ? parseInt(req.query.activeMinutes, 10) : undefined;
      const { agentId } = req.query;

      const entries = memory.sessionStore.list({
        agentId,
        limit,
        activeMinutes: activeMinutes && !isNaN(activeMinutes) ? activeMinutes : undefined,
      });
      const now = Date.now();
      return reply.send(entries.map(e => ({
        ...e,
        ageMs: now - e.updatedAt,
        idleDays: Math.floor((now - e.updatedAt) / 86_400_000),
      })));
    },
  );

  // GET /api/sessions/stale — preview what would be pruned (dry-run)
  app.get<{ Querystring: { staleDays?: string } }>(
    '/api/sessions/stale',
    async (req, reply) => {
      const staleDays = Math.max(1, parseInt(req.query.staleDays ?? String(DEFAULT_STALE_DAYS), 10) || DEFAULT_STALE_DAYS);
      const cutoffMs = staleDays * 86_400_000;
      const now = Date.now();

      const all = memory.sessionStore.list({ limit: 10_000 });
      const stale = all.filter(e => (now - e.updatedAt) >= cutoffMs);

      return reply.send({
        dryRun: true,
        staleDays,
        totalSessions: all.length,
        staleSessions: stale.length,
        wouldDelete: stale.map(e => ({
          sessionKey: e.sessionKey,
          agentId: e.agentId,
          channel: e.channel,
          chatType: e.chatType,
          idleDays: Math.floor((now - e.updatedAt) / 86_400_000),
          lastActiveAt: e.updatedAt,
        })),
      });
    },
  );

  // POST /api/sessions/prune — delete stale sessions by age
  app.post<{ Body: { staleDays?: number; dryRun?: boolean } }>(
    '/api/sessions/prune',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            staleDays: { type: 'number', minimum: 1, maximum: 3650 },
            dryRun:    { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const staleDays = Math.max(1, req.body?.staleDays ?? DEFAULT_STALE_DAYS);
      const dryRun    = req.body?.dryRun ?? false;
      const cutoffMs  = staleDays * 86_400_000;
      const now       = Date.now();

      const all = memory.sessionStore.list({ limit: 10_000 });
      const stale = all.filter(e => (now - e.updatedAt) >= cutoffMs);

      if (!dryRun) {
        for (const e of stale) {
          memory.sessionStore.delete(e.sessionKey);
        }
      }

      return reply.send({
        dryRun,
        staleDays,
        totalSessions: all.length,
        pruned: stale.length,
        remaining: all.length - (dryRun ? 0 : stale.length),
        deletedKeys: stale.map(e => e.sessionKey),
      });
    },
  );

  // POST /api/sessions/delete — delete a session by key
  app.post<{ Body: { sessionKey: string } }>(
    '/api/sessions/delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sessionKey'],
          properties: {
            sessionKey: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { sessionKey } = req.body;
      const existing = memory.sessionStore.getByKey(sessionKey);
      if (!existing) return reply.code(404).send({ error: 'Session not found' });
      memory.sessionStore.delete(sessionKey);
      return reply.send({ ok: true, deleted: sessionKey });
    },
  );
}
