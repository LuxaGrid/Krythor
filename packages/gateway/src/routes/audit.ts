import type { FastifyInstance } from 'fastify';
import type { AuditLogger } from '../AuditLogger.js';
import type { AuditStore } from '@krythor/memory';
import type { AccessProfileStore } from '../AccessProfileStore.js';

// ─── Audit Routes ─────────────────────────────────────────────────────────────
//
// GET /api/audit       — query high-level audit events (AuditLogger)
// GET /api/audit/tail  — last N events (AuditLogger)
// GET /api/audit/log   — query access-profile audit entries (AuditStore / SQLite)
//

export function registerAuditRoutes(
  app: FastifyInstance,
  auditLogger: AuditLogger,
  auditStore?: AuditStore,
  accessProfileStore?: AccessProfileStore,
): void {

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

  // GET /api/audit/log — access-profile audit entries from SQLite (or in-memory fallback)
  // Query params: limit, offset, agentId, operation, since (Unix ms timestamp)
  app.get<{
    Querystring: {
      limit?:     string;
      offset?:    string;
      agentId?:   string;
      operation?: string;
      since?:     string;
    };
  }>('/api/audit/log', async (req, reply) => {
    const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit  ?? '50',  10) || 50));
    const offset = Math.max(0,              parseInt(req.query.offset  ?? '0',   10) || 0);
    const since  = req.query.since ? parseInt(req.query.since, 10) || undefined : undefined;

    if (auditStore) {
      // Primary path: query persistent SQLite store
      const entries = auditStore.query({
        agentId:   req.query.agentId,
        operation: req.query.operation,
        limit,
        offset,
        since,
      });
      return reply.send({ entries, source: 'sqlite' });
    }

    // Fallback path: query in-memory ring buffer from AccessProfileStore
    if (accessProfileStore) {
      let entries = accessProfileStore.getAuditLog(limit);
      if (req.query.agentId) {
        entries = entries.filter(e => e.agentId === req.query.agentId);
      }
      if (req.query.operation) {
        entries = entries.filter(e => e.operation === req.query.operation);
      }
      if (since !== undefined) {
        entries = entries.filter(e => e.ts >= since);
      }
      // Convert to the common AuditEntry shape
      const mapped = entries.slice(offset, offset + limit).map(e => ({
        id:        e.id,
        agentId:   e.agentId,
        operation: e.operation,
        target:    e.path,
        profile:   e.profile,
        allowed:   e.allowed,
        reason:    e.reason,
        timestamp: e.ts,
      }));
      return reply.send({ entries: mapped, source: 'memory' });
    }

    return reply.send({ entries: [], source: 'unavailable' });
  });
}
