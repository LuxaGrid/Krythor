// ─── WebChat message route ────────────────────────────────────────────────────
//
// POST /api/webchat/message
//
// Handles messages from the /chat web UI routed through a configured webchat
// channel.  Applies the channel's policies, rate limiting, and session history
// before dispatching to the agent.
//
// If no webchat channel is active the request falls through gracefully (callers
// should use the generic /api/command instead).
//
// Request body:
//   { text: string; clientId: string; conversationId?: string }
//
// Response:
//   { ok: true; output: string; conversationId?: string; isReset?: boolean }
//   { ok: false; error: string }
//

import type { FastifyInstance } from 'fastify';
import type { InboundChannelManager } from '../InboundChannelManager.js';

export function registerWebChatMessageRoute(
  app: FastifyInstance,
  channelManager: InboundChannelManager,
): void {
  app.post<{
    Body: { text: string; clientId: string; conversationId?: string };
  }>('/api/webchat/message', {
    schema: {
      body: {
        type: 'object',
        required: ['text', 'clientId'],
        properties: {
          text:           { type: 'string', minLength: 1, maxLength: 32_768 },
          clientId:       { type: 'string', minLength: 1, maxLength: 256 },
          conversationId: { type: 'string', maxLength: 256 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { text, clientId, conversationId } = req.body;

    const inbound = channelManager.getWebChatInbound();
    if (!inbound) {
      return reply.code(503).send({
        ok: false,
        error: 'No webchat channel is configured or active. Use /api/command instead.',
      });
    }

    const result = await inbound.handleMessage(clientId, text, conversationId);
    return reply.send({
      ok:             true,
      output:         result.output,
      conversationId: result.conversationId,
      isReset:        result.isReset,
    });
  });

  // GET /api/webchat/status — check if a webchat channel is active and return its config
  app.get('/api/webchat/status', async (_req, reply) => {
    const inbound = channelManager.getWebChatInbound();
    if (!inbound) {
      return reply.send({ active: false });
    }
    const cfg = inbound.getConfig();
    return reply.send({
      active:  true,
      agentId: cfg?.agentId,
    });
  });
}
