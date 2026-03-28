/**
 * Dashboard metrics routes — ITEM 9
 *
 * GET /api/dashboard/metrics/series — returns sliding-window request metrics
 *   as time-series samples suitable for rendering sparklines / trend charts.
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
}
