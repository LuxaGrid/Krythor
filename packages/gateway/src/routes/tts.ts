import type { FastifyInstance } from 'fastify';

export interface TtsProvider {
  synthesize(text: string, options?: { voice?: string; speed?: number }): Promise<Buffer>;
  isAvailable(): boolean;
}

/** Registry slot for an optional TTS provider. Set by server.ts at boot if configured. */
let activeTtsProvider: TtsProvider | null = null;

export function registerTtsProvider(provider: TtsProvider): void {
  activeTtsProvider = provider;
}

export function registerTtsRoute(app: FastifyInstance): void {
  // POST /api/tts  — synthesize text to audio
  app.post<{ Body: { text: string; voice?: string; speed?: number } }>('/api/tts', {
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text:  { type: 'string', minLength: 1, maxLength: 2000 },
          voice: { type: 'string', maxLength: 100 },
          speed: { type: 'number', minimum: 0.25, maximum: 4.0 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!activeTtsProvider || !activeTtsProvider.isAvailable()) {
      return reply.code(503).send({ error: 'TTS_UNAVAILABLE', message: 'No TTS provider is configured. Set a speech_provider in providers.json.' });
    }
    try {
      const audio = await activeTtsProvider.synthesize(req.body.text, {
        voice: req.body.voice,
        speed: req.body.speed,
      });
      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', String(audio.length))
        .send(audio);
    } catch (err) {
      return reply.code(500).send({ error: 'TTS_FAILED', message: err instanceof Error ? err.message : 'Synthesis failed' });
    }
  });

  // GET /api/tts/status  — check if TTS is available
  app.get('/api/tts/status', async (_req, reply) => {
    return reply.send({ available: activeTtsProvider?.isAvailable() ?? false });
  });
}
