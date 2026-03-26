import type { FastifyInstance } from 'fastify';
import type { AuditLogger } from '../AuditLogger.js';

// ─── Audit Routes ─────────────────────────────────────────────────────────────
//
// GET /api/audit       — query audit events
// GET /api/audit/tail  — last N events
//

export function registerAuditRoutes(app: FastifyInstance, auditLogger: AuditLogger): void {

  // GET /api/audit/tail — last N events (default 50)
  app.get<{
    Querystring: { limit?: string };
  }>('/api/audit/tail', async (req, reply) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
    return reply.send({ events: auditLogger.tail(limit), total: auditLogger.size });
  });

  // GET /api/audit — query audit events with optional filters
  // Query params: limit, agentId, actionType, outcome, from (ISO), to (ISO)
  app.get<{
    Querystring: {
      limit?: string;
      agentId?: string;
      actionType?: string;
      executionOutcome?: string;
      from?: string;
      to?: string;
    };
  }>('/api/audit', async (req, reply) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit ?? '100', 10) || 100));

    // Build filter object for query()
    const filter: Record<string, unknown> = {};
    if (req.query.agentId)           filter['agentId']           = req.query.agentId;
    if (req.query.actionType)        filter['actionType']        = req.query.actionType;
    if (req.query.executionOutcome)  filter['executionOutcome']  = req.query.executionOutcome;

    let events = auditLogger.query(filter);

    // Time range filtering
    const fromMs = req.query.from ? new Date(req.query.from).getTime() : null;
    const toMs   = req.query.to   ? new Date(req.query.to).getTime()   : null;

    if (fromMs !== null && !isNaN(fromMs)) {
      events = events.filter(e => new Date(e.timestamp).getTime() >= fromMs);
    }
    if (toMs !== null && !isNaN(toMs)) {
      events = events.filter(e => new Date(e.timestamp).getTime() <= toMs);
    }

    // Return most recent first, capped at limit
    const paginated = events.slice(-limit).reverse();

    return reply.send({ events: paginated, total: events.length });
  });
}
