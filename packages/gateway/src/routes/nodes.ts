// ─── Node routes ──────────────────────────────────────────────────────────────
//
// GET  /api/nodes                    — list currently-connected node devices
//   ?capability=<cap>               — filter to nodes advertising this capability
// POST /api/nodes/:deviceId/invoke   — invoke a command on a connected node
// POST /api/nodes/batch              — invoke commands on multiple nodes in parallel
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
  // Query: ?capability=<cap>  — filter to nodes that include this capability string
  app.get<{ Querystring: { capability?: string } }>('/api/nodes', async (req, reply) => {
    const { capability } = req.query as { capability?: string };
    let nodes = nodeRegistry.list();
    if (capability) {
      nodes = nodes.filter(n => n.caps.some(c =>
        c === capability || c.startsWith(capability.replace(/\*$/, ''))
      ));
    }
    return reply.send({ nodes });
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

  // POST /api/nodes/batch — invoke commands on multiple nodes in parallel
  // Request body: { invocations: [{ deviceId, command, params?, timeoutMs? }] }
  // Response: { results: [{ deviceId, command, ok, result?, error? }] }
  app.post<{
    Body: {
      invocations: Array<{ deviceId: string; command: string; params?: unknown; timeoutMs?: number }>;
    };
  }>('/api/nodes/batch', {
    schema: {
      body: {
        type: 'object',
        required: ['invocations'],
        properties: {
          invocations: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              required: ['deviceId', 'command'],
              properties: {
                deviceId:  { type: 'string' },
                command:   { type: 'string', minLength: 1 },
                params:    {},
                timeoutMs: { type: 'number', minimum: 1000, maximum: 120_000 },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { invocations } = req.body;

    const results = await Promise.allSettled(
      invocations.map(async inv => {
        const node = nodeRegistry.get(inv.deviceId);
        if (!node) {
          return { deviceId: inv.deviceId, command: inv.command, ok: false, error: `Node not connected: ${inv.deviceId}` };
        }
        try {
          const result = await node.invoke(inv.command, inv.params ?? {}, inv.timeoutMs);
          return { deviceId: inv.deviceId, command: inv.command, ok: true, result };
        } catch (err) {
          return { deviceId: inv.deviceId, command: inv.command, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );

    return reply.send({
      results: results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, error: 'Unexpected batch error' }),
    });
  });
}
