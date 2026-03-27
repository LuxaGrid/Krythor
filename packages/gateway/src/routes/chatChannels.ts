// ─── /api/chat-channels routes ────────────────────────────────────────────────
//
// GET    /api/chat-channels/providers    — list all provider metadata
// GET    /api/chat-channels              — list configured channels with live status
// POST   /api/chat-channels              — create / save a channel config
// GET    /api/chat-channels/:id          — get single channel config + status
// PUT    /api/chat-channels/:id          — update credentials / agentId
// DELETE /api/chat-channels/:id          — remove channel config
// POST   /api/chat-channels/:id/test     — test connection
// POST   /api/chat-channels/:id/pair     — generate WhatsApp pairing code
// GET    /api/chat-channels/:id/status   — get live status
//
// DM Pairing routes (via DmPairingStore):
// GET    /api/chat-channels/:id/pairing                    — list pending pairing requests
// POST   /api/chat-channels/:id/pairing/:code/approve      — approve a pairing code
// POST   /api/chat-channels/:id/pairing/:code/deny         — deny a pairing code
// GET    /api/chat-channels/:id/allowlist                  — list approved senders
// POST   /api/chat-channels/:id/allowlist                  — add sender directly
// DELETE /api/chat-channels/:id/allowlist/:senderId        — remove sender
//
// Secret credentials are masked in list / get responses — the actual value is
// replaced with "***" for any field that has secret: true in the provider meta.
//

import type { FastifyInstance } from 'fastify';
import {
  ChatChannelRegistry,
  CHANNEL_PROVIDERS,
} from '../ChatChannelRegistry.js';
import type { ChatChannelConfig, ChannelType } from '../ChatChannelRegistry.js';
import type { InboundChannelManager } from '../InboundChannelManager.js';

// ── Credential masking ────────────────────────────────────────────────────────

function maskCredentials(
  channelId: string,
  credentials: Record<string, string>,
): Record<string, string> {
  const provider = CHANNEL_PROVIDERS.find(p => p.id === channelId);
  if (!provider) return credentials;

  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    const fieldMeta = provider.credentialFields.find(f => f.key === key);
    masked[key] = fieldMeta?.secret && value ? '***' : value;
  }
  return masked;
}

function sanitiseConfig(config: ChatChannelConfig): Record<string, unknown> {
  return {
    id:                config.id,
    type:              config.type,
    displayName:       config.displayName,
    enabled:           config.enabled,
    credentials:       maskCredentials(config.id, config.credentials),
    agentId:           config.agentId,
    pairingCode:       config.pairingCode,
    pairingExpiry:     config.pairingExpiry,
    lastHealthCheck:   config.lastHealthCheck,
    lastHealthStatus:  config.lastHealthStatus,
    lastError:         config.lastError,
    connectedAt:       config.connectedAt,
  };
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerChatChannelRoutes(
  app: FastifyInstance,
  registry: ChatChannelRegistry,
  inboundMgr?: InboundChannelManager,
): void {
  // Convenience accessor — null-safe; routes that require it will 503 if absent
  const pairingStore = () => inboundMgr?.getPairingStore() ?? null;

  // GET /api/chat-channels/providers — list all provider metadata
  // This must be registered BEFORE the /:id route to avoid the param
  // capturing the literal string "providers".
  app.get('/api/chat-channels/providers', async (_req, reply) => {
    return reply.send({ providers: registry.listProviders() });
  });

  // GET /api/chat-channels — list configured channels with live status
  app.get('/api/chat-channels', async (_req, reply) => {
    const channels = registry.listConfigs().map(config => ({
      ...sanitiseConfig(config),
      status: registry.getStatus(config.id),
      providerMeta: registry.getProvider(config.id),
    }));
    return reply.send({ channels });
  });

  // POST /api/chat-channels — create / save a channel config
  app.post<{
    Body: {
      id: string;
      type: ChannelType;
      displayName?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      agentId?: string;
    };
  }>('/api/chat-channels', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id:          { type: 'string', minLength: 1, maxLength: 64 },
          type:        { type: 'string', enum: ['telegram', 'discord', 'whatsapp'] },
          displayName: { type: 'string', maxLength: 128 },
          enabled:     { type: 'boolean' },
          credentials: { type: 'object', additionalProperties: { type: 'string' } },
          agentId:     { type: 'string', maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id, type, displayName, enabled = true, credentials = {}, agentId } = req.body;

    const provider = registry.getProvider(id);
    if (!provider) {
      return reply.code(400).send({ error: `Unknown channel provider: ${id}` });
    }

    const config: ChatChannelConfig = {
      id,
      type,
      displayName: displayName ?? provider.displayName,
      enabled,
      credentials,
      ...(agentId !== undefined && { agentId }),
    };

    registry.saveConfig(config);
    return reply.code(201).send(sanitiseConfig(registry.getConfig(id)!));
  });

  // GET /api/chat-channels/:id — get single channel config + status
  app.get<{ Params: { id: string } }>('/api/chat-channels/:id', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });
    return reply.send({
      ...sanitiseConfig(config),
      status: registry.getStatus(config.id),
      providerMeta: registry.getProvider(config.id),
    });
  });

  // PUT /api/chat-channels/:id — update credentials / agentId / enabled
  app.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      agentId?: string;
    };
  }>('/api/chat-channels/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', maxLength: 128 },
          enabled:     { type: 'boolean' },
          credentials: { type: 'object', additionalProperties: { type: 'string' } },
          agentId:     { type: 'string', maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const existing = registry.getConfig(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Channel not found' });

    const { displayName, enabled, credentials, agentId } = req.body;

    // Merge credentials — incoming secret fields that are '***' keep the stored value
    let mergedCredentials = { ...existing.credentials };
    if (credentials) {
      for (const [key, value] of Object.entries(credentials)) {
        // If the caller sent back the masked placeholder, keep the original secret
        if (value === '***') continue;
        mergedCredentials[key] = value;
      }
    }

    const updated: ChatChannelConfig = {
      ...existing,
      ...(displayName !== undefined && { displayName }),
      ...(enabled !== undefined && { enabled }),
      credentials: mergedCredentials,
      ...(agentId !== undefined && { agentId }),
    };

    registry.saveConfig(updated);
    return reply.send(sanitiseConfig(registry.getConfig(req.params.id)!));
  });

  // DELETE /api/chat-channels/:id — remove channel config
  app.delete<{ Params: { id: string } }>('/api/chat-channels/:id', async (req, reply) => {
    const existing = registry.getConfig(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Channel not found' });
    registry.deleteConfig(req.params.id);
    return reply.code(200).send({ ok: true });
  });

  // POST /api/chat-channels/:id/test — test connection
  app.post<{ Params: { id: string } }>('/api/chat-channels/:id/test', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });

    const result = await registry.testConnection(req.params.id);
    return reply.send(result);
  });

  // POST /api/chat-channels/:id/pair — generate WhatsApp pairing code
  app.post<{ Params: { id: string } }>('/api/chat-channels/:id/pair', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });
    if (config.type !== 'whatsapp') {
      return reply.code(400).send({ error: 'Pairing is only supported for WhatsApp channels' });
    }

    try {
      const result = await registry.generatePairingCode(req.params.id);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: msg });
    }
  });

  // GET /api/chat-channels/:id/status — get live status
  app.get<{ Params: { id: string } }>('/api/chat-channels/:id/status', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });
    return reply.send({
      status: registry.getStatus(req.params.id),
      lastError: config.lastError,
    });
  });

  // POST /api/chat-channels/:id/restart — restart a running inbound channel
  app.post<{ Params: { id: string } }>('/api/chat-channels/:id/restart', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });

    if (!inboundMgr) {
      return reply.code(503).send({ ok: false, error: 'InboundChannelManager not available' });
    }

    const result = await inboundMgr.restartChannel(req.params.id);
    return reply.send(result);
  });

  // ── DM Pairing routes ─────────────────────────────────────────────────────

  // GET /api/chat-channels/:id/pairing — list pending pairing requests
  app.get<{ Params: { id: string } }>('/api/chat-channels/:id/pairing', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });

    const store = pairingStore();
    if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

    const pending = store.listPending(req.params.id);
    return reply.send({ pending });
  });

  // POST /api/chat-channels/:id/pairing/:code/approve — approve a pairing code
  app.post<{ Params: { id: string; code: string } }>(
    '/api/chat-channels/:id/pairing/:code/approve',
    async (req, reply) => {
      const config = registry.getConfig(req.params.id);
      if (!config) return reply.code(404).send({ error: 'Channel not found' });

      const store = pairingStore();
      if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

      const result = store.approvePairing(req.params.id, req.params.code);
      if (!result.ok) return reply.code(400).send(result);
      return reply.send(result);
    },
  );

  // POST /api/chat-channels/:id/pairing/:code/deny — deny a pairing code
  app.post<{ Params: { id: string; code: string } }>(
    '/api/chat-channels/:id/pairing/:code/deny',
    async (req, reply) => {
      const config = registry.getConfig(req.params.id);
      if (!config) return reply.code(404).send({ error: 'Channel not found' });

      const store = pairingStore();
      if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

      const result = store.denyPairing(req.params.id, req.params.code);
      if (!result.ok) return reply.code(400).send(result);
      return reply.send(result);
    },
  );

  // GET /api/chat-channels/:id/allowlist — list approved senders
  app.get<{ Params: { id: string } }>('/api/chat-channels/:id/allowlist', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });

    const store = pairingStore();
    if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

    const allowlist = store.listAllowlist(req.params.id);
    return reply.send({ allowlist });
  });

  // POST /api/chat-channels/:id/allowlist — add a sender directly
  app.post<{
    Params: { id: string };
    Body: { senderId: string };
  }>('/api/chat-channels/:id/allowlist', {
    schema: {
      body: {
        type: 'object',
        required: ['senderId'],
        properties: {
          senderId: { type: 'string', minLength: 1, maxLength: 256 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });

    const store = pairingStore();
    if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

    store.addToAllowlist(req.params.id, req.body.senderId);
    return reply.code(201).send({ ok: true, senderId: req.body.senderId });
  });

  // DELETE /api/chat-channels/:id/allowlist/:senderId — remove a sender
  app.delete<{ Params: { id: string; senderId: string } }>(
    '/api/chat-channels/:id/allowlist/:senderId',
    async (req, reply) => {
      const config = registry.getConfig(req.params.id);
      if (!config) return reply.code(404).send({ error: 'Channel not found' });

      const store = pairingStore();
      if (!store) return reply.code(503).send({ error: 'Pairing store not available' });

      store.removeFromAllowlist(req.params.id, req.params.senderId);
      return reply.send({ ok: true });
    },
  );

  // ── Group allowlist routes ─────────────────────────────────────────────────
  // Groups are stored in ChatChannelConfig.groups as:
  //   { [groupId]: { requireMention?: boolean } }

  // GET /api/chat-channels/:id/groups — list allowed groups
  app.get<{ Params: { id: string } }>('/api/chat-channels/:id/groups', async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });
    const groups = config.groups ?? {};
    return reply.send({
      groups: Object.entries(groups).map(([groupId, cfg]) => ({
        groupId,
        requireMention: cfg.requireMention ?? false,
      })),
    });
  });

  // POST /api/chat-channels/:id/groups — add or update a group
  app.post<{
    Params: { id: string };
    Body: { groupId: string; requireMention?: boolean };
  }>('/api/chat-channels/:id/groups', {
    schema: {
      body: {
        type: 'object',
        required: ['groupId'],
        properties: {
          groupId:        { type: 'string', minLength: 1, maxLength: 256 },
          requireMention: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const config = registry.getConfig(req.params.id);
    if (!config) return reply.code(404).send({ error: 'Channel not found' });
    const { groupId, requireMention } = req.body;
    registry.saveConfig({
      ...config,
      groups: {
        ...(config.groups ?? {}),
        [groupId]: { requireMention: requireMention ?? false },
      },
    });
    return reply.code(201).send({ ok: true, groupId, requireMention: requireMention ?? false });
  });

  // DELETE /api/chat-channels/:id/groups/:groupId — remove a group
  app.delete<{ Params: { id: string; groupId: string } }>(
    '/api/chat-channels/:id/groups/:groupId',
    async (req, reply) => {
      const config = registry.getConfig(req.params.id);
      if (!config) return reply.code(404).send({ error: 'Channel not found' });
      const groups = { ...(config.groups ?? {}) };
      delete groups[req.params.groupId];
      registry.saveConfig({ ...config, groups });
      return reply.send({ ok: true });
    },
  );
}
