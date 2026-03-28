import type { FastifyInstance } from 'fastify';
import { MediaHandler, mediaHandler } from '../MediaHandler.js';

export function registerMediaRoute(app: FastifyInstance): void {
  // POST /api/media/analyze — analyze an uploaded media file
  app.post<{ Body: { data: string; filename: string; mimeType: string } }>('/api/media/analyze', {
    schema: {
      body: {
        type: 'object', required: ['data', 'filename', 'mimeType'],
        properties: {
          data:     { type: 'string', maxLength: 10_000_000 }, // base64
          filename: { type: 'string', maxLength: 500 },
          mimeType: { type: 'string', maxLength: 100 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    try {
      const buffer = Buffer.from(req.body.data, 'base64');
      const type = MediaHandler.detectType(req.body.mimeType);
      const result = await mediaHandler.handle({
        type, filename: req.body.filename, mimeType: req.body.mimeType, data: buffer,
      });
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Analysis failed' });
    }
  });
}
