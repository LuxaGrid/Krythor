/**
 * GET /api/tailscale/status — returns current Tailscale networking status.
 *
 * Reports whether the CLI is installed and logged in, the tailnet IP and
 * MagicDNS hostname, the active mode, and any warnings.
 * Protected by the normal gateway auth preHandler (same as all /api/* routes).
 */

import type { FastifyInstance } from 'fastify';
import { TailscaleService } from '../TailscaleService.js';
import type { TailscaleConfig } from '../TailscaleService.js';

export function registerTailscaleRoutes(
  app: FastifyInstance,
  service: TailscaleService,
  getConfig: () => TailscaleConfig,
): void {
  app.get('/api/tailscale/status', async (_req, reply) => {
    const config = getConfig();
    const status = await service.getStatus(config);
    return reply.send(status);
  });
}
