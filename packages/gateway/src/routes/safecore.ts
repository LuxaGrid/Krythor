/**
 * SafeCore routes
 *
 * GET  /api/safecore/dashboard               — stats dashboard
 * GET  /api/safecore/executions              — list executions (filter: mode, resultState, approvalState, promotionState)
 * POST /api/safecore/executions              — create/evaluate new execution
 * GET  /api/safecore/executions/:id          — get execution detail
 * POST /api/safecore/executions/:id/approve  — approve pending execution
 * POST /api/safecore/executions/:id/deny     — deny pending execution
 * POST /api/safecore/executions/:id/complete — mark execution completed
 * POST /api/safecore/executions/:id/promote  — request promotion to host
 * POST /api/safecore/executions/:id/promote/approve  — approve promotion
 * POST /api/safecore/executions/:id/promote/reject   — reject promotion
 * GET  /api/safecore/policies                — list per-mode policies
 * PATCH /api/safecore/policies/:mode         — update policy for a mode
 *
 * IMPORTANT: static routes before parameterized /:id
 */

import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import type { SafeCoreStore, SafeCoreMode } from '@krythor/memory';
import { sendError } from '../errors.js';
import { guardCheck } from '../guardCheck.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import type { SafeCoreEngine } from '../SafeCoreEngine.js';

const VALID_MODES: SafeCoreMode[] = ['READ_ONLY', 'WORKSPACE', 'CONNECTOR_LIMITED', 'ELEVATED_HOST'];

export function registerSafeCoreRoutes(
  app: FastifyInstance,
  store: SafeCoreStore,
  engine: SafeCoreEngine,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {

  // ── Static routes BEFORE /:id ──────────────────────────────────────────

  // GET /api/safecore/dashboard
  app.get('/api/safecore/dashboard', async (_req, reply) => {
    return reply.send(store.getDashboardStats());
  });

  // GET /api/safecore/policies
  app.get('/api/safecore/policies', async (_req, reply) => {
    return reply.send({ policies: store.listPolicies() });
  });

  // GET /api/safecore/executions
  app.get('/api/safecore/executions', async (req, reply) => {
    const q = req.query as Record<string, string>;
    return reply.send({
      executions: store.list({
        mode:            q['mode'] as SafeCoreMode | undefined,
        resultState:     q['resultState'] as never,
        approvalState:   q['approvalState'] as never,
        promotionState:  q['promotionState'] as never,
        agentId:         q['agentId'],
        limit:           q['limit']  ? parseInt(q['limit'])  : undefined,
        offset:          q['offset'] ? parseInt(q['offset']) : undefined,
      }),
    });
  });

  // POST /api/safecore/executions
  app.post('/api/safecore/executions', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:execute', source: 'user' });
    if (!allowed) return;

    const body = req.body as Record<string, unknown>;
    if (!body['requestedAction'] || typeof body['requestedAction'] !== 'string') {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'requestedAction is required');
    }
    const mode = (body['mode'] as SafeCoreMode) ?? 'READ_ONLY';
    if (!VALID_MODES.includes(mode)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', `mode must be one of: ${VALID_MODES.join(', ')}`);
    }

    const result = await engine.evaluate({
      agentId:         body['agentId'] as string | undefined,
      runId:           body['runId'] as string | undefined,
      mode,
      requestedAction: body['requestedAction'] as string,
      filesystemScope: body['filesystemScope'] as never,
      networkScope:    body['networkScope'] as never,
      connectorScope:  body['connectorScope'] as never,
    });

    return reply.code(result.allowed ? 201 : (result.requiresApproval ? 202 : 403)).send(result);
  });

  // PATCH /api/safecore/policies/:mode
  app.patch<{ Params: { mode: string } }>('/api/safecore/policies/:mode', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:execute', source: 'user' });
    if (!allowed) return;

    const { mode } = req.params;
    if (!VALID_MODES.includes(mode as SafeCoreMode)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', `mode must be one of: ${VALID_MODES.join(', ')}`);
    }
    try {
      const updated = store.updatePolicy(mode as SafeCoreMode, req.body as never);
      return reply.send(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 500, 'INTERNAL_ERROR', msg);
    }
  });

  // ── Promotion sub-routes BEFORE /:id/promote (static segments) ────────

  // POST /api/safecore/executions/:id/approve
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/approve', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:execute', source: 'user' });
    if (!allowed) return;
    try {
      const execution = engine.approve(req.params.id, 'user');
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/safecore/executions/:id/deny
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/deny', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:execute', source: 'user' });
    if (!allowed) return;
    const body = req.body as { reason?: string } | null;
    try {
      const execution = engine.deny(req.params.id, 'user', body?.reason);
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/safecore/executions/:id/complete
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/complete', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:execute', source: 'user' });
    if (!allowed) return;
    const body = req.body as Record<string, unknown>;
    try {
      const execution = engine.complete(req.params.id, {
        output:          body['output'] as string | undefined,
        filesTouched:    body['filesTouched'] as string[] | undefined,
        commandsRun:     body['commandsRun'] as never,
        networkAttempts: body['networkAttempts'] as never,
        errorMessage:    body['errorMessage'] as string | undefined,
        success:         body['success'] !== false,
      });
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/safecore/executions/:id/promote
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/promote', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:promote', source: 'user' });
    if (!allowed) return;
    const body = req.body as { promotedBy?: string } | null;
    try {
      const execution = await engine.requestPromotion({ executionId: req.params.id, promotedBy: body?.promotedBy ?? 'user' });
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/safecore/executions/:id/promote/approve
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/promote/approve', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:promote', source: 'user' });
    if (!allowed) return;
    const body = req.body as { promotedBy?: string } | null;
    try {
      const execution = engine.promoteToHost(req.params.id, body?.promotedBy ?? 'user');
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/safecore/executions/:id/promote/reject
  app.post<{ Params: { id: string } }>('/api/safecore/executions/:id/promote/reject', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'safecore:promote', source: 'user' });
    if (!allowed) return;
    const body = req.body as { reason?: string } | null;
    try {
      const execution = engine.rejectPromotion(req.params.id, 'user', body?.reason);
      return reply.send(execution);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // ── Parameterized /:id LAST ────────────────────────────────────────────

  // GET /api/safecore/executions/:id
  app.get<{ Params: { id: string } }>('/api/safecore/executions/:id', async (req, reply) => {
    const execution = store.getById(req.params.id);
    if (!execution) return sendError(reply, 404, 'NOT_FOUND', `SafeCore execution "${req.params.id}" not found`);
    return reply.send(execution);
  });
}
