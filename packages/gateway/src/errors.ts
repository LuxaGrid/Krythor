import type { FastifyInstance, FastifyReply, FastifyError } from 'fastify';

// ─── API Error Envelope ───────────────────────────────────────────────────────
//
// Every error response from every route must use this shape.
// { code, message, hint?, requestId? }
//
// Use sendError() in route handlers instead of reply.send({ error: ... }).
// The global error handler catches unhandled throws and formats them here too.
//

export interface ApiError {
  code: string;
  message: string;
  hint?: string;
  requestId?: string;
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  hint?: string,
): ReturnType<FastifyReply['send']> {
  const requestId = reply.request?.id as string | undefined;
  const body: ApiError = { code, message, ...(hint && { hint }), ...(requestId && { requestId }) };
  return reply.code(statusCode).send(body);
}

// Classify an unknown error thrown during command/agent execution into a
// structured error code. Kept here so every route can reuse it.
export function classifyError(err: unknown): { code: string; message: string; hint: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ECONNREFUSED') && (msg.includes('127.0.0.1') || msg.includes('localhost'))) {
    // Local connection refused — could be GGUF llama-server or Ollama not running
    return {
      code: 'LOCAL_SERVER_UNAVAILABLE',
      message: 'Local AI server is not running',
      hint: 'If using GGUF: start llama-server first (e.g. llama-server --model model.gguf --port 8080). If using Ollama: run "ollama serve".',
    };
  }
  if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('timeout')) {
    return { code: 'MODEL_UNAVAILABLE', message: 'AI provider is unreachable', hint: 'Check the Models tab and ping your provider to verify it is running.' };
  }
  if (msg.toLowerCase().includes('no provider') || msg.includes('providerCount')) {
    return { code: 'NO_PROVIDER', message: 'No AI provider configured', hint: 'Go to the Models tab and add a provider.' };
  }
  if (msg.toLowerCase().includes('not found') && msg.toLowerCase().includes('agent')) {
    return { code: 'AGENT_NOT_FOUND', message: 'Agent not found', hint: 'The selected agent may have been deleted. Go to the Agents tab.' };
  }
  if (msg.toLowerCase().includes('guard') || msg.toLowerCase().includes('denied')) {
    return { code: 'GUARD_DENIED', message: 'Action denied by security policy', hint: 'Adjust your Guard policy in the Guard tab if this is unexpected.' };
  }
  return { code: 'INTERNAL_ERROR', message: 'Something went wrong', hint: msg };
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
//
// Catches any unhandled throw from a route handler and formats it as ApiError.
// Register this immediately after Fastify() is created in server.ts.
//

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const statusCode = err.statusCode ?? 500;
    // Fastify validation errors (400) have a structured message already
    if (statusCode === 400 && err.validation) {
      const body: ApiError = {
        code: 'VALIDATION_ERROR',
        message: err.message,
        hint: 'Check the request body against the API schema.',
        requestId: req.id,
      };
      return reply.code(400).send(body);
    }
    if (statusCode === 429) {
      const body: ApiError = {
        code: 'RATE_LIMITED',
        message: 'Too many requests — slow down',
        requestId: req.id,
      };
      return reply.code(429).send(body);
    }
    const { code, message, hint } = classifyError(err);
    const body: ApiError = { code, message, hint, requestId: req.id };
    return reply.code(statusCode >= 400 ? statusCode : 500).send(body);
  });
}
