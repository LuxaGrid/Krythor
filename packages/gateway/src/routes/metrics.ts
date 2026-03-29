/**
 * Dashboard metrics routes — ITEM 9
 *
 * GET /api/dashboard/metrics/series  — sliding-window request metrics (sparklines)
 * GET /api/dashboard/metrics/agents  — per-agent run stats sorted by usage
 *
 * Query params:
 *   ?window=60  — number of minutes of history (default: 60, max: 1440)
 */

import type { FastifyInstance } from 'fastify';
import type { MetricsCollector } from '../MetricsCollector.js';

export function registerMetricsRoutes(
  app: FastifyInstance,
  metrics: MetricsCollector,
): void {
  app.get<{ Querystring: { window?: string } }>(
    '/api/dashboard/metrics/series',
    async (req, reply) => {
      // window param is informational only — the collector owns its own window
      void req.query;
      return reply.send(metrics.getSeries());
    },
  );

  // Per-agent run statistics — lifetime counters, sorted by totalRuns desc.
  // Returns an array of AgentRunStats objects (empty if no runs recorded yet).
  app.get('/api/dashboard/metrics/agents', async (_req, reply) => {
    return reply.send(metrics.getAgentStats());
  });
}
