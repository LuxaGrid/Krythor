/**
 * GET /api/gateway/info  — stable identity and capability manifest.
 * GET /api/gateway/peers — placeholder for future remote gateway mesh.
 *
 * gatewayId is a UUID stored in <configDir>/gateway-id.json and generated
 * exactly once on the first call. This gives the gateway a stable identity
 * across restarts, useful for remote access and future peer discovery.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { arch, platform } from 'os';
import { KRYTHOR_VERSION } from '../server.js';

const GATEWAY_CAPABILITIES: string[] = [
  'exec',
  'web_search',
  'web_fetch',
  'memory',
  'agents',
  'skills',
  'tools',
];

/** ISO string set once when the module is first imported — approximates gateway startTime. */
const GATEWAY_START_TIME = new Date().toISOString();

/**
 * Load or generate a stable UUID for this gateway installation.
 * Written to <configDir>/gateway-id.json on first call.
 */
function loadOrCreateGatewayId(configDir: string): string {
  const idFile = join(configDir, 'gateway-id.json');
  if (existsSync(idFile)) {
    try {
      const raw = JSON.parse(readFileSync(idFile, 'utf-8')) as { gatewayId?: string };
      if (typeof raw.gatewayId === 'string' && raw.gatewayId.length > 0) {
        return raw.gatewayId;
      }
    } catch {
      // Malformed file — regenerate below
    }
  }
  const id = randomUUID();
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(idFile, JSON.stringify({ gatewayId: id }, null, 2), 'utf-8');
  } catch {
    // Non-fatal — id will be ephemeral this run
  }
  return id;
}

export function registerGatewayRoutes(
  app: FastifyInstance,
  configDir: string,
): void {

  // GET /api/gateway/info — stable gateway identity and capability manifest
  app.get('/api/gateway/info', async (_req, reply) => {
    const gatewayId = loadOrCreateGatewayId(configDir);
    return reply.send({
      version:      KRYTHOR_VERSION,
      platform:     platform(),
      arch:         arch(),
      nodeVersion:  process.version,
      gatewayId,
      startTime:    GATEWAY_START_TIME,
      capabilities: GATEWAY_CAPABILITIES,
    });
  });

  // GET /api/gateway/peers — placeholder for future remote gateway mesh
  app.get('/api/gateway/peers', async (_req, reply) => {
    return reply.send({ peers: [] });
  });
}
