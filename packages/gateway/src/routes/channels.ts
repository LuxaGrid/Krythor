import type { FastifyInstance } from 'fastify';
import { ChannelManager, ALL_CHANNEL_EVENTS } from '../ChannelManager.js';
import type { ChannelEvent } from '../ChannelManager.js';

// ─── /api/channels routes ─────────────────────────────────────────────────────
//
// GET    /api/channels              — list all configured outbound channels
// POST   /api/channels              — create a new channel (webhook)
// GET    /api/channels/:id          — get a single channel
// PATCH  /api/channels/:id          — update a channel (url, events, enabled…)
// DELETE /api/channels/:id          — delete a channel
// POST   /api/channels/:id/test     — send a test delivery
// GET    /api/channels/events       — list all supported event types
//

export function registerChannelRoutes(app: FastifyInstance, channels: ChannelManager): void {

  // GET /api/channels/events — list all supported event types
  app.get('/api/channels/events', async (_req, reply) => {
    return reply.send({ events: ALL_CHANNEL_EVENTS });
  });

  // GET /api/channels — list all channels (no secrets in response)
  app.get('/api/channels', async (_req, reply) => {
    const list = channels.list().map(ch => ({
      id:                     ch.id,
      name:                   ch.name,
      url:                    ch.url,
      events:                 ch.events,
      hasSecret:              !!ch.secret,
      isEnabled:              ch.isEnabled,
      createdAt:              ch.createdAt,
      updatedAt:              ch.updatedAt,
      lastDeliveryAt:         ch.lastDeliveryAt,
      lastDeliveryStatus:     ch.lastDeliveryStatus,
      lastDeliveryStatusCode: ch.lastDeliveryStatusCode,
      failureCount:           ch.failureCount,
    }));
    return reply.send(list);
  });

  // POST /api/channels — create a new channel
  app.post<{
    Body: {
      name: string;
      url: string;
      events?: ChannelEvent[];
      secret?: string;
      headers?: Record<string, string>;
      retryPolicy?: import('../ChannelManager.js').ChannelRetryPolicy;
      isEnabled?: boolean;
    };
  }>('/api/channels', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 128 },
          url:       { type: 'string', minLength: 1, maxLength: 2048 },
          events:    { type: 'array', items: { type: 'string' }, maxItems: 20 },
          secret:      { type: 'string', maxLength: 256 },
          headers:     { type: 'object', additionalProperties: { type: 'string' } },
          retryPolicy: {
            type: 'object',
            properties: {
              maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
              minDelayMs: { type: 'integer', minimum: 100, maximum: 60_000 },
              maxDelayMs: { type: 'integer', minimum: 100, maximum: 300_000 },
              jitter:     { type: 'boolean' },
            },
            additionalProperties: false,
          },
          isEnabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { name, url, events = [], secret, headers, retryPolicy, isEnabled = true } = req.body;

    // Validate URL scheme — only http/https
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return reply.code(400).send({ error: 'Channel URL must use http or https' });
      }
    } catch {
      return reply.code(400).send({ error: 'Invalid channel URL' });
    }

    // Validate event names
    const invalid = events.filter(e => !ALL_CHANNEL_EVENTS.includes(e as ChannelEvent));
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Unknown event types: ${invalid.join(', ')}. Valid: ${ALL_CHANNEL_EVENTS.join(', ')}` });
    }

    const channel = channels.add({ name, url, events: events as ChannelEvent[], secret, headers, retryPolicy, isEnabled });
    return reply.code(201).send({
      id:        channel.id,
      name:      channel.name,
      url:       channel.url,
      events:    channel.events,
      hasSecret: !!channel.secret,
      isEnabled: channel.isEnabled,
      createdAt: channel.createdAt,
    });
  });

  // GET /api/channels/:id — get a single channel
  app.get<{ Params: { id: string } }>('/api/channels/:id', async (req, reply) => {
    const channel = channels.get(req.params.id);
    if (!channel) return reply.code(404).send({ error: 'Channel not found' });
    return reply.send({
      id:                     channel.id,
      name:                   channel.name,
      url:                    channel.url,
      events:                 channel.events,
      hasSecret:              !!channel.secret,
      headers:                channel.headers,
      isEnabled:              channel.isEnabled,
      createdAt:              channel.createdAt,
      updatedAt:              channel.updatedAt,
      lastDeliveryAt:         channel.lastDeliveryAt,
      lastDeliveryStatus:     channel.lastDeliveryStatus,
      lastDeliveryStatusCode: channel.lastDeliveryStatusCode,
      failureCount:           channel.failureCount,
    });
  });

  // PATCH /api/channels/:id — update a channel
  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      url?: string;
      events?: ChannelEvent[];
      secret?: string;
      headers?: Record<string, string>;
      isEnabled?: boolean;
    };
  }>('/api/channels/:id', {
    schema: {
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          name:      { type: 'string', minLength: 1, maxLength: 128 },
          url:       { type: 'string', minLength: 1, maxLength: 2048 },
          events:    { type: 'array', items: { type: 'string' }, maxItems: 20 },
          secret:      { type: 'string', maxLength: 256 },
          headers:     { type: 'object', additionalProperties: { type: 'string' } },
          retryPolicy: {
            type: 'object',
            properties: {
              maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
              minDelayMs: { type: 'integer', minimum: 100, maximum: 60_000 },
              maxDelayMs: { type: 'integer', minimum: 100, maximum: 300_000 },
              jitter:     { type: 'boolean' },
            },
            additionalProperties: false,
          },
          isEnabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { url, events } = req.body;

    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return reply.code(400).send({ error: 'Channel URL must use http or https' });
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid channel URL' });
      }
    }

    if (events) {
      const invalid = events.filter(e => !ALL_CHANNEL_EVENTS.includes(e as ChannelEvent));
      if (invalid.length > 0) {
        return reply.code(400).send({ error: `Unknown event types: ${invalid.join(', ')}` });
      }
    }

    try {
      const updated = channels.update(req.params.id, req.body as Parameters<typeof channels.update>[1]);
      return reply.send({
        id:        updated.id,
        name:      updated.name,
        url:       updated.url,
        events:    updated.events,
        hasSecret: !!updated.secret,
        isEnabled: updated.isEnabled,
        updatedAt: updated.updatedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });

  // DELETE /api/channels/:id — delete a channel
  app.delete<{ Params: { id: string } }>('/api/channels/:id', async (req, reply) => {
    try {
      channels.remove(req.params.id);
      return reply.send({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /api/channels/:id/test — send a test delivery
  app.post<{ Params: { id: string } }>('/api/channels/:id/test', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (req, reply) => {
    try {
      const result = await channels.test(req.params.id);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });
}
