/**
 * Fallback Chain routes
 *
 * GET    /api/fallback-chains       — list all chains
 * POST   /api/fallback-chains       — create chain
 * GET    /api/fallback-chains/:id   — get chain
 * PATCH  /api/fallback-chains/:id   — update chain
 * DELETE /api/fallback-chains/:id   — delete chain
 */

import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import type { FallbackChainStore, CreateFallbackChainInput, FallbackChain } from '@krythor/models';

export function registerFallbackChainRoutes(
  app: FastifyInstance,
  fallbackChainStore: FallbackChainStore,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {
  // GET /api/fallback-chains
  app.get('/api/fallback-chains', async (req, reply) => {
    const query = req.query as { taskType?: string; agentId?: string; skillId?: string };
    const chains = fallbackChainStore.list(
      query.taskType || query.agentId || query.skillId
        ? { taskType: query.taskType, agentId: query.agentId, skillId: query.skillId }
        : undefined,
    );
    return reply.send({ chains });
  });

  // POST /api/fallback-chains
  app.post('/api/fallback-chains', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const body = req.body as Partial<CreateFallbackChainInput>;
    if (!body.name || !body.providers || !Array.isArray(body.providers) || body.providers.length === 0) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'name and providers (non-empty array) are required');
    }
    const chain = fallbackChainStore.create(body as CreateFallbackChainInput);
    return reply.code(201).send(chain);
  });

  // GET /api/fallback-chains/:id
  app.get('/api/fallback-chains/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const chain = fallbackChainStore.getById(id);
    if (!chain) return sendError(reply, 404, 'NOT_FOUND', `FallbackChain "${id}" not found`);
    return reply.send(chain);
  });

  // PATCH /api/fallback-chains/:id
  app.patch('/api/fallback-chains/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const body = req.body as Partial<Pick<FallbackChain, 'name' | 'description' | 'providers' | 'taskType' | 'agentId' | 'skillId'>>;
    if (body.providers !== undefined && (!Array.isArray(body.providers) || body.providers.length === 0)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'providers must be a non-empty array');
    }
    try {
      const updated = fallbackChainStore.update(id, body);
      return reply.send(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 500, 'INTERNAL_ERROR', msg);
    }
  });

  // DELETE /api/fallback-chains/:id
  app.delete('/api/fallback-chains/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const existing = fallbackChainStore.getById(id);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', `FallbackChain "${id}" not found`);
    fallbackChainStore.delete(id);
    return reply.code(204).send();
  });
}
