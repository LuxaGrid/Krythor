import type { FastifyInstance } from 'fastify';
import type { ModelEngine, ProviderConfig, InferenceRequest, OAuthAccount } from '@krythor/models';
import { getCapabilities, PROVIDER_CAPABILITIES } from '@krythor/models';
import type { MemoryEngine } from '@krythor/memory';
import type { GuardEngine } from '@krythor/guard';
import { OllamaEmbeddingProvider } from '@krythor/memory';

/**
 * Validate a provider endpoint URL.
 * - Must be http:// or https://
 * - Must not target cloud metadata services (169.254.169.254, etc.)
 * - Returns an error string if invalid, null if ok.
 */
function validateEndpointUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'endpoint must be a valid URL (e.g. http://localhost:11434)';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'endpoint must use http or https';
  }
  // Block cloud metadata services — common SSRF targets
  const blocked = ['169.254.169.254', 'metadata.google.internal', 'metadata.internal'];
  if (blocked.includes(url.hostname)) {
    return 'endpoint hostname is not allowed';
  }
  return null;
}

/** Mask secrets in a provider config before sending to the UI. */
function maskProviderConfig(p: ProviderConfig): unknown {
  const masked: Record<string, unknown> = { ...p };

  // Mask API key — show only last 4 chars
  if (p.apiKey) {
    masked['apiKey'] = p.apiKey.length > 4 ? `****${p.apiKey.slice(-4)}` : '****';
  }

  // Mask OAuth tokens entirely — only expose non-secret metadata
  if (p.oauthAccount) {
    masked['oauthAccount'] = {
      accountId:   p.oauthAccount.accountId,
      displayName: p.oauthAccount.displayName,
      expiresAt:   p.oauthAccount.expiresAt,
      connectedAt: p.oauthAccount.connectedAt,
      // accessToken and refreshToken intentionally omitted
    };
  }

  return masked;
}

export function registerModelRoutes(
  app: FastifyInstance,
  models: ModelEngine,
  memory?: MemoryEngine,
  guard?: GuardEngine,
): void {

  // GET /api/models — list all models across all providers (with badges)
  app.get('/api/models', async (_req, reply) => {
    return reply.send(models.listModels());
  });

  // GET /api/models/stats
  app.get('/api/models/stats', async (_req, reply) => {
    return reply.send(models.stats());
  });

  // GET /api/models/capabilities — provider type capability flags
  // UI derives all auth-related behaviour from this endpoint; no hardcoded conditionals.
  app.get('/api/models/capabilities', async (_req, reply) => {
    return reply.send(PROVIDER_CAPABILITIES);
  });

  // GET /api/models/providers — list all provider configs
  // Secrets are masked: only last 4 chars of API keys, no OAuth tokens.
  app.get('/api/models/providers', async (_req, reply) => {
    const providers = models.listProviders().map(maskProviderConfig);
    return reply.send(providers);
  });

  // POST /api/models/providers — add a provider
  app.post('/api/models/providers', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'endpoint'],
        properties: {
          name:       { type: 'string', minLength: 1 },
          type:       { type: 'string', enum: ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf'] },
          endpoint:   { type: 'string', minLength: 1 },
          authMethod: { type: 'string', enum: ['api_key', 'oauth', 'none'] },
          apiKey:     { type: 'string' },
          isDefault:  { type: 'boolean' },
          isEnabled:  { type: 'boolean' },
          models:     { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as Omit<ProviderConfig, 'id'>;
    const endpointErr = validateEndpointUrl(body.endpoint);
    if (endpointErr) return reply.code(400).send({ error: endpointErr });

    // Validate: if authMethod=api_key, must have apiKey
    const caps = getCapabilities(body.type);
    if (body.authMethod === 'api_key' && !body.apiKey) {
      if (caps.supportsApiKey) {
        return reply.code(400).send({ error: 'apiKey is required when authMethod is api_key' });
      }
    }

    const config = models.addProvider({
      name:       body.name,
      type:       body.type,
      endpoint:   body.endpoint.replace(/\/$/, ''),
      authMethod: body.authMethod ?? (body.apiKey ? 'api_key' : 'none'),
      apiKey:     body.apiKey,
      isDefault:  body.isDefault ?? false,
      isEnabled:  body.isEnabled ?? true,
      models:     body.models ?? [],
    });

    // If the new provider is Ollama, wire it as the embedding provider
    if (config.type === 'ollama' && config.isEnabled && memory) {
      const ep = new OllamaEmbeddingProvider(config.endpoint, 'nomic-embed-text');
      memory.registerEmbeddingProvider(ep);
      memory.setActiveEmbeddingProvider(ep.name);
    }
    return reply.code(201).send(maskProviderConfig(config));
  });

  // PATCH /api/models/providers/:id — update a provider
  app.patch<{ Params: { id: string } }>('/api/models/providers/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:       { type: 'string', minLength: 1 },
          endpoint:   { type: 'string', minLength: 1 },
          authMethod: { type: 'string', enum: ['api_key', 'oauth', 'none'] },
          apiKey:     { type: 'string' },
          isDefault:  { type: 'boolean' },
          isEnabled:  { type: 'boolean' },
          models:     { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as Partial<Omit<ProviderConfig, 'id'>>;
    if (body.endpoint) {
      const endpointErr = validateEndpointUrl(body.endpoint);
      if (endpointErr) return reply.code(400).send({ error: endpointErr });
    }
    try {
      const updated = models.updateProvider(req.params.id, body);
      if (updated.type === 'ollama' && updated.isEnabled && memory) {
        const ep = new OllamaEmbeddingProvider(updated.endpoint, 'nomic-embed-text');
        memory.registerEmbeddingProvider(ep);
        memory.setActiveEmbeddingProvider(ep.name);
      }
      return reply.send(maskProviderConfig(updated));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Not found';
      return reply.code(404).send({ error: msg });
    }
  });

  // DELETE /api/models/providers/:id
  app.delete<{ Params: { id: string } }>('/api/models/providers/:id', async (req, reply) => {
    try {
      models.removeProvider(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Not found';
      return reply.code(404).send({ error: msg });
    }
  });

  // ── OAuth routes ───────────────────────────────────────────────────────────

  // POST /api/models/providers/:id/oauth/connect
  // Stores OAuth account credentials for a provider (tokens must be obtained
  // via the desktop callback flow and passed in by the UI).
  app.post<{ Params: { id: string } }>('/api/models/providers/:id/oauth/connect', {
    schema: {
      body: {
        type: 'object',
        required: ['accountId', 'accessToken'],
        properties: {
          accountId:    { type: 'string', minLength: 1 },
          displayName:  { type: 'string' },
          accessToken:  { type: 'string', minLength: 1 },
          refreshToken: { type: 'string' },
          expiresAt:    { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      accountId: string;
      displayName?: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    };
    try {
      const account: OAuthAccount = {
        accountId:    body.accountId,
        displayName:  body.displayName,
        accessToken:  body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt:    body.expiresAt ?? 0,
        connectedAt:  new Date().toISOString(),
      };
      const updated = models.connectOAuth(req.params.id, account);
      return reply.send(maskProviderConfig(updated));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Not found';
      return reply.code(404).send({ error: msg });
    }
  });

  // DELETE /api/models/providers/:id/oauth/disconnect
  // Revokes stored OAuth credentials and reverts authMethod to 'none'.
  app.delete<{ Params: { id: string } }>('/api/models/providers/:id/oauth/disconnect', async (req, reply) => {
    try {
      const updated = models.disconnectOAuth(req.params.id);
      return reply.send(maskProviderConfig(updated));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Not found';
      return reply.code(404).send({ error: msg });
    }
  });

  // POST /api/models/providers/:id/oauth/refresh
  // Update OAuth tokens after a token refresh (called by the UI after completing
  // a refresh flow). Only updates token fields — preserves all other account metadata.
  app.post<{ Params: { id: string } }>('/api/models/providers/:id/oauth/refresh', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken'],
        properties: {
          accessToken:  { type: 'string', minLength: 1 },
          refreshToken: { type: 'string' },
          expiresAt:    { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as { accessToken: string; refreshToken?: string; expiresAt?: number };
    try {
      const updated = models.refreshOAuthTokens(
        req.params.id,
        body.accessToken,
        body.refreshToken,
        body.expiresAt,
      );
      return reply.send(maskProviderConfig(updated));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Not found';
      return reply.code(404).send({ error: msg });
    }
  });

  // ── Existing provider utility routes ──────────────────────────────────────

  // POST /api/models/providers/:id/refresh — re-query available models from provider
  app.post<{ Params: { id: string } }>('/api/models/providers/:id/refresh', async (req, reply) => {
    try {
      const modelList = await models.refreshModels(req.params.id);
      return reply.send({ models: modelList });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /api/models/providers/:id/ping — check if provider is reachable
  app.post<{ Params: { id: string } }>('/api/models/providers/:id/ping', async (req, reply) => {
    const start = Date.now();
    try {
      const result = await models.checkAvailability(req.params.id);
      return reply.send({ ...result, latencyMs: Date.now() - start });
    } catch (err) {
      return reply.send({ ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : 'Ping failed' });
    }
  });

  // GET /api/models/embeddings — list available embedding providers
  app.get('/api/models/embeddings', async (_req, reply) => {
    if (!memory) return reply.code(503).send({ error: 'Memory engine not available' });
    return reply.send({
      active: memory.embeddings.getActive().name,
      providers: memory.embeddings.list(),
    });
  });

  // POST /api/models/embeddings/activate — switch active embedding provider
  app.post('/api/models/embeddings/activate', {
    schema: {
      body: {
        type: 'object',
        required: ['baseUrl', 'model'],
        properties: {
          baseUrl: { type: 'string', minLength: 1 },
          model:   { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!memory) return reply.code(503).send({ error: 'Memory engine not available' });
    const { baseUrl, model } = req.body as { baseUrl: string; model: string };
    const endpointErr = validateEndpointUrl(baseUrl);
    if (endpointErr) return reply.code(400).send({ error: endpointErr });
    const provider = new OllamaEmbeddingProvider(baseUrl, model);
    memory.registerEmbeddingProvider(provider);
    memory.setActiveEmbeddingProvider(provider.name);
    return reply.send({ active: provider.name });
  });

  // DELETE /api/models/embeddings/active — revert to stub (disable real embeddings)
  app.delete('/api/models/embeddings/active', async (_req, reply) => {
    if (!memory) return reply.code(503).send({ error: 'Memory engine not available' });
    memory.setActiveEmbeddingProvider('stub');
    return reply.send({ active: 'stub' });
  });

  // POST /api/models/infer — direct inference (for testing)
  app.post('/api/models/infer', {
    schema: {
      body: {
        type: 'object',
        required: ['messages'],
        properties: {
          messages:    { type: 'array' },
          model:       { type: 'string' },
          providerId:  { type: 'string' },
          temperature: { type: 'number' },
          maxTokens:   { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'model:infer', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    try {
      const response = await models.infer(req.body as InferenceRequest);
      return reply.send(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Inference failed';
      return reply.code(500).send({ error: msg });
    }
  });
}
