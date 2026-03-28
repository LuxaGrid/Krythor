import type { FastifyInstance } from 'fastify';

export interface ImageGenProvider {
  generate(prompt: string, options?: { size?: string; model?: string }): Promise<{ url?: string; b64?: string; revisedPrompt?: string }>;
  isAvailable(): boolean;
  providerName(): string;
}

/** Module-level slot — set at boot by server.ts if an image provider is configured. */
let activeImageProvider: ImageGenProvider | null = null;

export function registerImageGenProvider(provider: ImageGenProvider): void {
  activeImageProvider = provider;
}

export function getActiveImageProvider(): ImageGenProvider | null {
  return activeImageProvider;
}

export function registerImageGenRoute(app: FastifyInstance): void {
  // POST /api/image/generate
  app.post<{ Body: { prompt: string; size?: string; model?: string } }>('/api/image/generate', {
    schema: {
      body: {
        type: 'object', required: ['prompt'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 1000 },
          size:   { type: 'string', enum: ['256x256', '512x512', '1024x1024', '1024x1792'] },
          model:  { type: 'string', maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!activeImageProvider || !activeImageProvider.isAvailable()) {
      return reply.code(503).send({ error: 'IMAGE_PROVIDER_UNAVAILABLE', message: 'No image generation provider is configured. Add an image_provider in providers.json.' });
    }
    try {
      const result = await activeImageProvider.generate(req.body.prompt, {
        size:  req.body.size,
        model: req.body.model,
      });
      return reply.send({ ok: true, ...result, provider: activeImageProvider.providerName() });
    } catch (err) {
      return reply.code(500).send({ error: 'IMAGE_GEN_FAILED', message: err instanceof Error ? err.message : 'Generation failed' });
    }
  });

  // GET /api/image/status
  app.get('/api/image/status', async (_req, reply) => {
    return reply.send({
      available: activeImageProvider?.isAvailable() ?? false,
      provider:  activeImageProvider?.providerName() ?? null,
    });
  });
}
