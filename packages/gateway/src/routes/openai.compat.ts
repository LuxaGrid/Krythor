// ─── OpenAI-compatible /v1/chat/completions endpoint ─────────────────────────
//
// Allows OpenAI SDK users and tools (Continue, Cursor, etc.) to point their
// baseURL at Krythor and use it as an OpenAI-compatible backend.
//
// POST /v1/chat/completions
//   - Auth: Bearer token (optional — skipped if no token is configured)
//   - Body: OpenAI chat format
//   - Streams: SSE in OpenAI format if stream=true
//
// Non-stream response:
//   { id, object: 'chat.completion', created, model, choices: [...], usage: {...} }
//
// Stream response (SSE):
//   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}
//   data: [DONE]
//

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ModelEngine } from '@krythor/models';
import { randomUUID } from 'crypto';
import { verifyToken } from '../auth.js';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model?: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Krythor extension: enable extended thinking (Anthropic models only). */
  thinking?: { enabled: boolean; budget_tokens?: number; level?: string };
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop';
  }>;
  usage: OpenAIUsage;
}

export function registerOpenAICompatRoutes(
  app: FastifyInstance,
  models: ModelEngine,
  getToken: () => string,
  authDisabled: boolean,
): void {

  // GET /v1/models — list available models in OpenAI format
  app.get('/v1/models', async (_req, reply) => {
    const modelList = models.listModels().map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.providerId,
    }));
    return reply.send({ object: 'list', data: modelList });
  });

  // POST /v1/chat/completions
  app.post<{ Body: OpenAIChatRequest }>('/v1/chat/completions', {
    config: {
      // Tighter rate limit for inference
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    // Don't use Fastify's schema-level auth — we implement flexible auth below
  }, async (req: FastifyRequest<{ Body: OpenAIChatRequest }>, reply: FastifyReply) => {
    // ── Auth — Bearer token or skip if auth is disabled ─────────────────────
    if (!authDisabled) {
      const authHeader = (req.headers['authorization'] as string | undefined) ?? '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

      // If a token is configured and the caller provided one, verify it.
      // If no token is configured (empty string), allow all requests.
      const expectedToken = getToken();
      if (expectedToken && !verifyToken(bearerToken, expectedToken)) {
        return reply.code(401).send({
          error: {
            message: 'Unauthorized — invalid or missing Bearer token',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
      }
    }

    const body = req.body as OpenAIChatRequest;

    // Validate required fields
    if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return reply.code(400).send({
        error: {
          message: 'messages is required and must be a non-empty array',
          type: 'invalid_request_error',
          param: 'messages',
        },
      });
    }

    // Validate message format
    for (const msg of body.messages) {
      if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
        return reply.code(400).send({
          error: {
            message: `Invalid role: ${msg.role}. Must be one of: system, user, assistant`,
            type: 'invalid_request_error',
            param: 'messages[].role',
          },
        });
      }
      if (typeof msg.content !== 'string') {
        return reply.code(400).send({
          error: {
            message: 'Each message must have a string content field',
            type: 'invalid_request_error',
            param: 'messages[].content',
          },
        });
      }
    }

    // Build inference request
    const requestedModel = body.model ?? undefined;

    // Validate model exists (if explicitly requested)
    if (requestedModel) {
      const allModels = models.listModels();
      const found = allModels.find(m => m.id === requestedModel);
      if (!found) {
        return reply.code(404).send({
          error: {
            message: `Model '${requestedModel}' not found. Use GET /v1/models to list available models.`,
            type: 'invalid_request_error',
            param: 'model',
            code: 'model_not_found',
          },
        });
      }
    }

    const inferRequest = {
      messages: body.messages,
      model:       requestedModel,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      maxTokens:   typeof body.max_tokens  === 'number' ? body.max_tokens  : undefined,
      stream:      body.stream === true,
      ...(body.thinking?.enabled && {
        thinking: {
          enabled: true,
          ...(body.thinking.level && { level: body.thinking.level as import('@krythor/models').ThinkingLevel }),
          ...(body.thinking.budget_tokens !== undefined && { budgetTokens: body.thinking.budget_tokens }),
        },
      }),
    };

    const completionId = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 28)}`;
    const created = Math.floor(Date.now() / 1000);

    // ── Streaming response ────────────────────────────────────────────────────
    if (body.stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let modelUsed = requestedModel ?? 'unknown';
      let hasError = false;

      try {
        for await (const chunk of models.inferStream(inferRequest)) {
          if (chunk.model) modelUsed = chunk.model;

          if (!chunk.done) {
            const ssePayload = JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: modelUsed,
              choices: [{
                index: 0,
                delta: { content: chunk.delta },
                finish_reason: null,
              }],
            });
            reply.raw.write(`data: ${ssePayload}\n\n`);
          } else {
            // Final chunk — send finish_reason: 'stop'
            const finalPayload = JSON.stringify({
              id: completionId,
              object: 'chat.completion.chunk',
              created,
              model: modelUsed,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop',
              }],
            });
            reply.raw.write(`data: ${finalPayload}\n\n`);
            reply.raw.write('data: [DONE]\n\n');
          }
        }
      } catch (err) {
        hasError = true;
        const message = err instanceof Error ? err.message : 'Inference failed';
        const errPayload = JSON.stringify({
          error: {
            message,
            type: 'server_error',
          },
        });
        reply.raw.write(`data: ${errPayload}\n\n`);
      }

      if (!hasError) {
        // Ensure [DONE] is always sent even if the stream ended without a done chunk
      }
      reply.raw.end();
      return reply;
    }

    // ── Non-streaming response ────────────────────────────────────────────────
    try {
      const response = await models.infer(inferRequest);

      const usage: OpenAIUsage = {
        prompt_tokens:     response.promptTokens     ?? 0,
        completion_tokens: response.completionTokens ?? 0,
        total_tokens:      (response.promptTokens ?? 0) + (response.completionTokens ?? 0),
      };

      const openAIResponse: OpenAIChatResponse = {
        id:      completionId,
        object:  'chat.completion',
        created,
        model:   response.model,
        choices: [{
          index:         0,
          message:       { role: 'assistant', content: response.content },
          finish_reason: 'stop',
        }],
        usage,
      };

      return reply.send(openAIResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Inference failed';
      return reply.code(503).send({
        error: {
          message,
          type: 'server_error',
        },
      });
    }
  });
}
