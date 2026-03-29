/**
 * GET  /api/gateway/info          — stable identity and capability manifest.
 * GET  /api/gateway/peers         — list known remote gateway peers.
 * POST /api/gateway/peers         — register a new peer by URL.
 * GET  /api/gateway/peers/:id     — get a single peer.
 * PATCH /api/gateway/peers/:id    — update a peer (name, url, authToken, isEnabled).
 * DELETE /api/gateway/peers/:id   — remove a peer.
 * POST /api/gateway/peers/:id/probe — health-check a peer on demand.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { arch, platform } from 'os';
import { KRYTHOR_VERSION } from '../server.js';
import type { PeerRegistry, Peer } from '../PeerRegistry.js';

/** Mask the authToken in a peer object before sending to the API consumer.
 *  Shows only the last 4 characters — same convention as provider API keys. */
function maskPeer(p: Peer): Record<string, unknown> {
  const { authToken, ...rest } = p;
  return {
    ...rest,
    ...(authToken
      ? { authToken: authToken.length > 4 ? `****${authToken.slice(-4)}` : '****' }
      : {}),
  };
}

const GATEWAY_CAPABILITIES: string[] = [
  'exec',
  'web_search',
  'web_fetch',
  'memory',
  'agents',
  'skills',
  'tools',
  'channels',
  'peers',
];

/** ISO string set once when the module is first imported — approximates gateway startTime. */
const GATEWAY_START_TIME = new Date().toISOString();

/**
 * Load or generate a stable UUID for this gateway installation.
 * Written to <configDir>/gateway-id.json on first call.
 */
export function loadOrCreateGatewayId(configDir: string): string {
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
  peers?: PeerRegistry,
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

  // ── Peer routes ─────────────────────────────────────────────────────────────

  // GET /api/gateway/peers — list all known peers (authToken masked)
  app.get('/api/gateway/peers', async (_req, reply) => {
    if (!peers) return reply.send({ peers: [] });
    return reply.send({
      peers: peers.list().map(p => maskPeer(p)),
    });
  });

  // POST /api/gateway/peers — register a peer by URL
  app.post<{
    Body: { name: string; url: string; authToken?: string; tags?: Record<string, string> };
  }>('/api/gateway/peers', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 128 },
          url:       { type: 'string', minLength: 1, maxLength: 2048 },
          authToken: { type: 'string', maxLength: 256 },
          tags:      { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!peers) return reply.code(503).send({ error: 'Peer registry not initialised' });
    try {
      const peer = peers.add(req.body);
      return reply.code(201).send({
        id:        peer.id,
        name:      peer.name,
        url:       peer.url,
        source:    peer.source,
        isEnabled: peer.isEnabled,
        createdAt: peer.createdAt,
      });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/gateway/peers/:id — get a single peer (authToken masked)
  app.get<{ Params: { id: string } }>('/api/gateway/peers/:id', async (req, reply) => {
    if (!peers) return reply.code(404).send({ error: 'Peer not found' });
    const peer = peers.get(req.params.id);
    if (!peer) return reply.code(404).send({ error: 'Peer not found' });
    return reply.send(maskPeer(peer));
  });

  // PATCH /api/gateway/peers/:id — update a peer
  app.patch<{
    Params: { id: string };
    Body: { name?: string; url?: string; authToken?: string; isEnabled?: boolean; tags?: Record<string, string> };
  }>('/api/gateway/peers/:id', {
    schema: {
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 128 },
          url:       { type: 'string', minLength: 1, maxLength: 2048 },
          authToken: { type: 'string', maxLength: 256 },
          isEnabled: { type: 'boolean' },
          tags:      { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!peers) return reply.code(404).send({ error: 'Peer not found' });
    try {
      const updated = peers.update(req.params.id, req.body);
      return reply.send({ id: updated.id, name: updated.name, url: updated.url, isEnabled: updated.isEnabled });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(msg.includes('not found') ? 404 : 400).send({ error: msg });
    }
  });

  // DELETE /api/gateway/peers/:id — remove a peer
  app.delete<{ Params: { id: string } }>('/api/gateway/peers/:id', async (req, reply) => {
    if (!peers) return reply.code(404).send({ error: 'Peer not found' });
    try {
      peers.remove(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(msg.includes('not found') ? 404 : 500).send({ error: msg });
    }
  });

  // POST /api/gateway/peers/:id/probe — on-demand health check
  app.post<{ Params: { id: string } }>('/api/gateway/peers/:id/probe', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (req, reply) => {
    if (!peers) return reply.code(404).send({ error: 'Peer not found' });
    try {
      const result = await peers.probe(req.params.id);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(msg.includes('not found') ? 404 : 500).send({ error: msg });
    }
  });
}
