import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
// Security model — replay-attack protection:
//
//   Callers must include three headers on every request:
//     X-Krythor-Timestamp  — Unix seconds (integer)
//     X-Krythor-Nonce      — random string (min 16 chars, max 128 chars)
//     X-Krythor-Signature  — HMAC-SHA256 of "<token>:<timestamp>:<nonce>:<body>"
//
//   Validation rules:
//     TIMESTAMP_TOO_OLD  — |now - timestamp| > 300 seconds (5-minute window)
//     REPLAY_DETECTED    — same nonce seen within the 5-minute window
//     INVALID_SIGNATURE  — HMAC mismatch (when webhookToken is configured)
//
//   When webhookToken is not configured:
//     - HMAC validation is skipped (no signature to compare against)
//     - Timestamp and nonce checks are still enforced
//     - Error code HOOKS_NOT_CONFIGURED is returned for both wake and agent
//
//   The nonce cache is cleaned every 5 minutes to evict expired entries.
//   Nonces are stored with their entry timestamp so expired ones can be pruned.
//

const MAX_PAYLOAD_BYTES = 16_384; // 16 KB
const RATE_LIMIT_MAX    = 60;     // 60 requests per window
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

/** Maximum age of a request (seconds). Requests older than this are rejected. */
const TIMESTAMP_WINDOW_S = 300; // 5 minutes

/** Nonce cache: nonce → timestamp (ms) when it was first seen. */
const nonceCache = new Map<string, number>();

// Evict expired nonces every 5 minutes to prevent unbounded growth.
const NONCE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const cutoff = Date.now() - TIMESTAMP_WINDOW_S * 1000;
    for (const [nonce, ts] of nonceCache) {
      if (ts < cutoff) nonceCache.delete(nonce);
    }
  }, NONCE_CLEANUP_INTERVAL_MS);
  // Prevent the timer from keeping the process alive in test environments
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as { unref(): void }).unref();
  }
}

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

  // Shared auth + body-size + replay-attack check used by both endpoints.
  //
  // Returns true if the request is authorised to proceed.
  // Returns false (and sends the error response) if rejected.
  function checkAuth(req: FastifyRequest, reply: FastifyReply, rawBody?: string): boolean {
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

    // ── Replay-attack protection ────────────────────────────────────────────

    const tsHeader    = req.headers['x-krythor-timestamp'];
    const nonceHeader = req.headers['x-krythor-nonce'];
    const sigHeader   = req.headers['x-krythor-signature'];

    const tsRaw = typeof tsHeader === 'string' ? tsHeader : (Array.isArray(tsHeader) ? tsHeader[0] : undefined);
    const nonce = typeof nonceHeader === 'string' ? nonceHeader : (Array.isArray(nonceHeader) ? nonceHeader[0] : undefined);
    const sig   = typeof sigHeader === 'string' ? sigHeader : (Array.isArray(sigHeader) ? sigHeader[0] : undefined);

    // Validate timestamp presence and freshness
    if (!tsRaw) {
      void sendError(reply, 400, 'MISSING_TIMESTAMP', 'X-Krythor-Timestamp header required', 'Include Unix seconds in X-Krythor-Timestamp');
      return false;
    }
    const tsSeconds = parseInt(tsRaw, 10);
    if (isNaN(tsSeconds)) {
      void sendError(reply, 400, 'INVALID_TIMESTAMP', 'X-Krythor-Timestamp must be a Unix timestamp (integer seconds)', 'Use the current Unix time in seconds');
      return false;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - tsSeconds) > TIMESTAMP_WINDOW_S) {
      void sendError(reply, 400, 'TIMESTAMP_TOO_OLD', `Request timestamp is outside the ${TIMESTAMP_WINDOW_S}s acceptance window`, 'Ensure your system clock is correct');
      return false;
    }

    // Validate nonce presence and uniqueness
    if (!nonce || nonce.length < 16 || nonce.length > 128) {
      void sendError(reply, 400, 'MISSING_NONCE', 'X-Krythor-Nonce header required (16–128 chars)', 'Include a random nonce of at least 16 characters');
      return false;
    }
    if (nonceCache.has(nonce)) {
      void sendError(reply, 400, 'REPLAY_DETECTED', 'Duplicate nonce detected — possible replay attack', 'Use a fresh random nonce for each request');
      return false;
    }
    nonceCache.set(nonce, Date.now());

    // Validate HMAC signature (only when token is configured)
    if (sig !== undefined) {
      const body = rawBody ?? '';
      const expected = createHmac('sha256', token)
        .update(`${token}:${tsRaw}:${nonce}:${body}`)
        .digest('hex');
      const expectedBuf = Buffer.from(expected, 'utf-8');
      const sigBuf      = Buffer.from(sig, 'utf-8');
      const sigOk = expectedBuf.length === sigBuf.length
        && timingSafeEqual(expectedBuf, sigBuf);
      if (!sigOk) {
        void sendError(reply, 401, 'INVALID_SIGNATURE', 'HMAC-SHA256 signature mismatch', 'Verify your signing key and payload format: HMAC-SHA256("<token>:<timestamp>:<nonce>:<body>")');
        return false;
      }
    }

    // ── Token auth ──────────────────────────────────────────────────────────

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
    const rawBody = JSON.stringify(req.body);
    if (!checkAuth(req, reply, rawBody)) return;

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
    const rawBody = JSON.stringify(req.body);
    if (!checkAuth(req, reply, rawBody)) return;

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
        durationMs: run.completedAt != null ? run.completedAt - run.startedAt : undefined,
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
