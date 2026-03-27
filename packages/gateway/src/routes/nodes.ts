// ─── Node routes ──────────────────────────────────────────────────────────────
//
// GET  /api/nodes                    — list currently-connected node devices
// POST /api/nodes/:deviceId/invoke   — invoke a command on a connected node
//
// Nodes are WS clients that connected with device.role:'node'. They advertise
// a capabilities list (caps[]) and respond to node.invoke RPC frames.
// The gateway forwards invoke requests over the node's existing WS connection.
//
// Auth: required (standard gateway token).
//

import type { FastifyInstance } from 'fastify';
import { nodeRegistry } from '../ws/NodeRegistry.js';

export function registerNodeRoutes(app: FastifyInstance): void {

  // GET /api/nodes — list currently-connected nodes and their capabilities
  app.get('/api/nodes', async (_req, reply) => {
    return reply.send({ nodes: nodeRegistry.list() });
  });

  // POST /api/nodes/:deviceId/invoke — forward a command to a connected node
  app.post<{
    Params: { deviceId: string };
    Body: { command: string; params?: unknown; timeoutMs?: number };
  }>('/api/nodes/:deviceId/invoke', {
    schema: {
      params: {
        type: 'object',
        required: ['deviceId'],
        properties: {
          deviceId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command:   { type: 'string', minLength: 1 },
          params:    {},
          timeoutMs: { type: 'number', minimum: 1000, maximum: 120_000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { deviceId } = req.params;
    const { command, params, timeoutMs } = req.body;

    const node = nodeRegistry.get(deviceId);
    if (!node) {
      return reply.code(404).send({
        ok: false,
        error: `Node not connected: ${deviceId}`,
        hint: 'The device may be offline or not connected with role:node',
      });
    }

    try {
      const result = await node.invoke(command, params ?? {}, timeoutMs);
      return reply.send({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('timeout');
      return reply.code(isTimeout ? 504 : 502).send({
        ok: false,
        error: message,
        hint: isTimeout
          ? 'The node did not respond in time — increase timeoutMs or check node connectivity'
          : 'The node returned an error',
      });
    }
  });
}
