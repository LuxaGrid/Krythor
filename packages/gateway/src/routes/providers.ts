import type { FastifyInstance } from 'fastify';
import type { ModelEngine } from '@krythor/models';

// ─── /api/providers routes ─────────────────────────────────────────────────────
//
// P3-3: GET /api/providers — list all configured providers with status info.
//        Returns a safe summary that NEVER includes API keys or OAuth tokens.
//        Now also includes priority and maxRetries fields.
//
// P3-2: POST /api/providers/:id/test — live inference test against a provider.
//        Sends a minimal "Say: ok" message and returns latency + response.
//
// ITEM1: POST /api/providers/:id — update priority, maxRetries, isEnabled, isDefault.
//

export function registerProviderRoutes(app: FastifyInstance, models: ModelEngine): void {

  // GET /api/providers — list all configured providers (no secrets)
  app.get('/api/providers', async (_req, reply) => {
    const providers = models.listProviders();
    const modelInfos = models.listModels();

    const result = providers.map(p => {
      const modelCount = modelInfos.filter(m => m.providerId === p.id).length;
      const entry: Record<string, unknown> = {
        id:         p.id,
        name:       p.name,
        type:       p.type,
        endpoint:   p.endpoint,
        authMethod: p.authMethod,
        modelCount,
        isDefault:  p.isDefault,
        isEnabled:  p.isEnabled,
        priority:   p.priority   ?? 0,
        maxRetries: p.maxRetries ?? 2,
      };
      // Only include setupHint when present — it drives UI CTAs
      if (p.setupHint) entry['setupHint'] = p.setupHint;
      return entry;
    });

    return reply.send(result);
  });

  // POST /api/providers/:id — update priority, maxRetries, isEnabled, isDefault (auth required)
  app.post<{ Params: { id: string } }>('/api/providers/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          priority:   { type: 'number' },
          maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
          isEnabled:  { type: 'boolean' },
          isDefault:  { type: 'boolean' },
        },
        additionalProperties: false,
        minProperties: 1,
      },
    },
  }, async (req, reply) => {
    const provider = models.listProviders().find(p => p.id === req.params.id);
    if (!provider) {
      return reply.code(404).send({ error: 'Provider not found' });
    }

    const updates = req.body as {
      priority?:   number;
      maxRetries?: number;
      isEnabled?:  boolean;
      isDefault?:  boolean;
    };

    try {
      const updated = models.updateProvider(req.params.id, updates);
      const modelInfos = models.listModels();
      const modelCount = modelInfos.filter(m => m.providerId === updated.id).length;
      return reply.send({
        id:         updated.id,
        name:       updated.name,
        type:       updated.type,
        endpoint:   updated.endpoint,
        authMethod: updated.authMethod,
        modelCount,
        isDefault:  updated.isDefault,
        isEnabled:  updated.isEnabled,
        priority:   updated.priority   ?? 0,
        maxRetries: updated.maxRetries ?? 2,
        ...(updated.setupHint && { setupHint: updated.setupHint }),
      });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  // POST /api/providers/:id/test — live inference smoke test
  // Sends a minimal message to the provider and returns timing + response.
  // Auth required (wired via server-level auth hook).
  app.post<{ Params: { id: string } }>('/api/providers/:id/test', {
    config: {
      // Rate-limit tightly — this hits external APIs
      rateLimit: { max: 10, timeWindow: 60_000 },
    },
  }, async (req, reply) => {
    const provider = models.listProviders().find(p => p.id === req.params.id);
    if (!provider) {
      return reply.code(404).send({ ok: false, error: 'Provider not found' });
    }
    if (!provider.isEnabled) {
      return reply.code(400).send({ ok: false, error: 'Provider is disabled' });
    }

    const modelList = models.listModels().filter(m => m.providerId === provider.id);
    const testModel = modelList[0]?.id;
    if (!testModel) {
      return reply.code(400).send({ ok: false, error: 'No models available for this provider' });
    }

    const start = Date.now();
    try {
      const response = await models.infer({
        messages: [
          { role: 'user', content: 'Say: ok' },
        ],
        model:      testModel,
        providerId: provider.id,
        maxTokens:  20,
      });
      const latencyMs = Date.now() - start;
      return reply.send({
        ok:        true,
        latencyMs,
        model:     response.model,
        response:  response.content.trim(),
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      return reply.send({
        ok:        false,
        latencyMs,
        error:     err instanceof Error ? err.message : 'Inference failed',
      });
    }
  });
}
