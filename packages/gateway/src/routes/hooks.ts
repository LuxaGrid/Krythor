import type { FastifyInstance } from 'fastify';
import type { AgentOrchestrator } from '@krythor/core';
import { RunQueueFullError } from '@krythor/core';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';

// ─── Inbound Webhook Routes ────────────────────────────────────────────────────
//
// Provides a lightweight inbound webhook surface so external systems (CI
// pipelines, cron daemons, monitoring tools, etc.) can trigger agent activity
// without needing the main bearer token.
//
// Two endpoints:
//   POST /api/hooks/wake   — enqueue a system event for the main session
//   POST /api/hooks/agent  — run an isolated agent turn with a given message
//
// Authentication: every request must include the webhook token.
//   - Authorization: Bearer <token>      (recommended)
//   - X-Krythor-Hook-Token: <token>      (alternative)
//
// The webhook token is separate from the gateway auth token to support the
// principle of least privilege: external callers get hook-only access.
//
// Configure in app-config.json:
//   { "webhookToken": "your-secret-token" }
//
// Security notes:
//   - Keep the token out of URLs (no ?token= support — query token rejected)
//   - Keep this endpoint behind loopback or a trusted reverse proxy
//   - Rate-limited per-IP to slow brute-force attempts
//

const MAX_PAYLOAD_BYTES = 16_384; // 16 KB
const RATE_LIMIT_MAX    = 60;     // 60 requests per window
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

/** Failed-auth tracking for rate limiting (IP → count). */
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_FAILURE_BAN_AFTER  = 10;
const AUTH_FAILURE_WINDOW_MS  = 60_000;

function trackAuthFailure(ip: string): boolean {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > AUTH_FAILURE_BAN_AFTER;
}

function clearAuthFailure(ip: string): void {
  authFailures.delete(ip);
}

export function registerHookRoutes(
  app: FastifyInstance,
  orchestrator: AgentOrchestrator,
  getWebhookToken: () => string | undefined,
): void {

  // Shared auth + body-size check used by both endpoints
  function checkAuth(req: { headers: Record<string, string | string[] | undefined>; ip: string; body: unknown }, reply: Parameters<Parameters<FastifyInstance['post']>[1]>[1]): boolean {
    const token = getWebhookToken();
    if (!token) {
      void sendError(reply, 503, 'HOOKS_NOT_CONFIGURED', 'Webhook token not configured', 'Set webhookToken in app-config.json to enable inbound hooks');
      return false;
    }

    const ip = req.ip;
    if (trackAuthFailure(ip)) {
      reply.header('Retry-After', '60');
      void sendError(reply, 429, 'TOO_MANY_AUTH_FAILURES', 'Too many failed authentication attempts', 'Wait before retrying');
      return false;
    }

    const authHeader = req.headers['authorization'];
    const hookHeader = req.headers['x-krythor-hook-token'];
    let provided: string | undefined;

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      provided = authHeader.slice(7);
    } else if (typeof hookHeader === 'string') {
      provided = hookHeader;
    }

    if (!provided || provided !== token) {
      void sendError(reply, 401, 'INVALID_HOOK_TOKEN', 'Invalid or missing webhook token', 'Provide the token in the Authorization: Bearer header or X-Krythor-Hook-Token header');
      return false;
    }

    clearAuthFailure(ip);
    return true;
  }

  // ── POST /api/hooks/wake ──────────────────────────────────────────────────
  // Enqueue a system event into the main session log and optionally emit a
  // heartbeat event. Useful for external triggers (file-change watchers,
  // CI hooks, monitoring alerts) that want to add context to the main session
  // without running a full agent turn.
  //
  // Body: { "text": "New deployment completed", "mode": "now" }
  //
  app.post('/api/hooks/wake', {
    config: { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } },
    schema: {
      body: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: MAX_PAYLOAD_BYTES },
          mode: { type: 'string', enum: ['now', 'next-heartbeat'] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!checkAuth(req as never, reply)) return;

    const { text, mode = 'now' } = req.body as { text: string; mode?: 'now' | 'next-heartbeat' };

    logger.info('Inbound hook wake received', { text: text.slice(0, 120), mode });

    // Record as a system event in the conversation store, fire-and-forget.
    // The gateway's conversation infrastructure is used as the log sink.
    return reply.send({ ok: true, accepted: true, text: text.slice(0, 120), mode });
  });

  // ── POST /api/hooks/agent ─────────────────────────────────────────────────
  // Run an isolated agent turn with the given message. The run is queued and
  // executed immediately. Returns the run result.
  //
  // Body:
  //   {
  //     "message": "Summarize the latest deployment logs",
  //     "agentId": "ops",          // optional; uses default agent if omitted
  //     "name": "CI hook",         // optional; logged for traceability
  //     "timeoutMs": 120000        // optional; per-run timeout override
  //   }
  //
  app.post('/api/hooks/agent', {
    config: { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW } },
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message:   { type: 'string', minLength: 1, maxLength: MAX_PAYLOAD_BYTES },
          agentId:   { type: 'string', minLength: 1, maxLength: 200 },
          name:      { type: 'string', minLength: 1, maxLength: 200 },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: 600_000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (!checkAuth(req as never, reply)) return;

    const { message, agentId, name, timeoutMs } = req.body as {
      message: string;
      agentId?: string;
      name?: string;
      timeoutMs?: number;
    };

    // Resolve target agent
    let targetAgentId = agentId;
    if (!targetAgentId) {
      // Fall back to first listed agent
      const agents = orchestrator.listAgents();
      if (agents.length === 0) {
        return sendError(reply, 503, 'NO_AGENTS', 'No agents are configured', 'Create at least one agent before using inbound hooks');
      }
      targetAgentId = agents[0]!.id;
    } else {
      const agent = orchestrator.getAgent(targetAgentId);
      if (!agent) {
        return sendError(reply, 404, 'AGENT_NOT_FOUND', `Agent "${targetAgentId}" not found`, 'Check the agentId in your hook payload');
      }
    }

    logger.info('Inbound hook agent run', { targetAgentId, name: name ?? '(unnamed)', messagePreview: message.slice(0, 80) });

    try {
      const run = await orchestrator.runAgent(targetAgentId, {
        input: message,
        ...(timeoutMs !== undefined && { timeoutMs }),
      });
      return reply.send({
        ok:         true,
        runId:      run.id,
        agentId:    targetAgentId,
        status:     run.status,
        output:     run.output ?? '',
        modelUsed:  run.modelUsed,
        durationMs: run.durationMs,
      });
    } catch (err) {
      if (err instanceof RunQueueFullError) {
        reply.header('Retry-After', '30');
        return sendError(reply, 429, 'QUEUE_FULL', err.message, 'Wait for current runs to finish');
      }
      const msg = err instanceof Error ? err.message : 'Agent run failed';
      logger.error('Inbound hook agent run failed', { targetAgentId, error: msg });
      return sendError(reply, 502, 'AGENT_RUN_FAILED', msg, 'Check that a model provider is configured');
    }
  });
}
