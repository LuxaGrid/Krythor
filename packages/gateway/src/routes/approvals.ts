import type { FastifyInstance } from 'fastify';
import type { ApprovalManager, ApprovalResponse } from '../ApprovalManager.js';

// ─── Approval Routes ──────────────────────────────────────────────────────────
//
// GET  /api/approvals           — list pending approval requests
// POST /api/approvals/:id/respond — respond to a pending request
//

export function registerApprovalRoutes(app: FastifyInstance, approvalManager: ApprovalManager): void {

  // GET /api/approvals — list pending approval requests
  app.get('/api/approvals', async (_req, reply) => {
    return reply.send({
      approvals: approvalManager.getPending(),
      count: approvalManager.pendingCount(),
    });
  });

  // POST /api/approvals/:id/respond — body: { response: ApprovalResponse }
  app.post<{
    Params: { id: string };
    Body: { response: ApprovalResponse };
  }>('/api/approvals/:id/respond', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['response'],
        properties: {
          response: { type: 'string', enum: ['allow_once', 'allow_for_session', 'deny'] },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params;
    const { response } = req.body;

    try {
      approvalManager.respond(id, response);
      return reply.send({ ok: true, id, response });
    } catch (err) {
      return reply.status(404).send({
        error: 'not_found',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // DELETE /api/approvals/session — clear all session approvals
  app.delete('/api/approvals/session', async (_req, reply) => {
    approvalManager.clearSessionApprovals();
    return reply.send({ ok: true });
  });
}
