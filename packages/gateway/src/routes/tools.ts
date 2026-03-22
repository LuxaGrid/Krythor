import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { ExecTool, ExecDeniedError, ExecTimeoutError, WebSearchTool, WebFetchTool, TOOL_REGISTRY } from '@krythor/core';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';
import { validateUrl } from '../validate.js';

// ─── Tools routes ─────────────────────────────────────────────────────────────
//
// GET  /api/tools               — list tool registry (exec + web_search + web_fetch)
// POST /api/tools/exec          — execute a command (guard-checked, allowlist-checked)
// POST /api/tools/web_search    — search the web via DuckDuckGo
// POST /api/tools/web_fetch     — fetch a URL and return plain text
//
// All routes require auth (handled by the global preHandler in server.ts).
//

// Singleton instances for the read-only tools (stateless, safe to share)
const webSearchTool = new WebSearchTool();
const webFetchTool  = new WebFetchTool();

export function registerToolRoutes(
  app: FastifyInstance,
  guard: GuardEngine,
  execTool: ExecTool,
): void {

  // GET /api/tools — full tool registry
  app.get('/api/tools', async (_req, reply) => {
    // Enrich exec entry with the live allowlist from the execTool instance
    const tools = TOOL_REGISTRY.map(entry => {
      if (entry.name === 'exec') {
        return {
          ...entry,
          allowlist:        execTool.getAllowlist(),
          defaultTimeoutMs: 30_000,
          maxTimeoutMs:     300_000,
          endpoint:         'POST /api/tools/exec',
        };
      }
      if (entry.name === 'web_search') {
        return { ...entry, timeoutMs: 5_000, endpoint: 'POST /api/tools/web_search' };
      }
      if (entry.name === 'web_fetch') {
        return { ...entry, timeoutMs: 8_000, maxContentChars: 10_000, endpoint: 'POST /api/tools/web_fetch' };
      }
      return entry;
    });
    return reply.send({ tools });
  });

  // POST /api/tools/exec — execute a command
  app.post('/api/tools/exec', {
    config: {
      // Tighter rate limit — exec is expensive and security-sensitive
      rateLimit: { max: 30, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command:   { type: 'string', minLength: 1, maxLength: 200 },
          args:      {
            type: 'array',
            items: { type: 'string', maxLength: 4096 },
            maxItems: 50,
          },
          cwd:       { type: 'string', minLength: 1, maxLength: 4096 },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
    };

    const { command, args = [], cwd, timeoutMs } = body;

    try {
      const result = await execTool.run(
        command,
        args,
        { cwd, timeoutMs },
        'user',
        req.id,
      );

      logger.info('Exec tool: command completed', {
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        requestId: req.id,
      });

      return reply.send(result);
    } catch (err) {
      if (err instanceof ExecDeniedError) {
        return sendError(reply, 403, 'EXEC_DENIED', err.message,
          'Only commands in the allowlist can be executed. Check GET /api/tools for the list.');
      }
      if (err instanceof ExecTimeoutError) {
        return sendError(reply, 408, 'EXEC_TIMEOUT', err.message,
          `The command exceeded the ${err.timeoutMs}ms timeout. Increase timeoutMs or simplify the command.`);
      }
      const message = err instanceof Error ? err.message : 'Exec failed';
      logger.warn('Exec tool: command failed', { command, error: message, requestId: req.id });
      return sendError(reply, 500, 'EXEC_FAILED', message);
    }
  });

  // POST /api/tools/web_search — search via DuckDuckGo Instant Answer API
  app.post('/api/tools/web_search', {
    config: {
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { query } = req.body as { query: string };

    try {
      const result = await webSearchTool.search(query);
      logger.info('Web search tool: search completed', {
        query,
        resultCount: result.results.length,
        requestId: req.id,
      });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Web search failed';
      logger.warn('Web search tool: search failed', { query, error: message, requestId: req.id });
      return sendError(reply, 502, 'WEB_SEARCH_FAILED', message,
        'The DuckDuckGo API did not respond. Try again shortly.');
    }
  });

  // POST /api/tools/web_fetch — fetch a URL and return plain text
  app.post('/api/tools/web_fetch', {
    config: {
      rateLimit: { max: 30, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', minLength: 7, maxLength: 2048 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { url } = req.body as { url: string };

    // Validate scheme before sending any network request — rejects file://, javascript:, data:, etc.
    const urlErr = validateUrl(url, 'url');
    if (urlErr) {
      return sendError(reply, 400, 'INVALID_URL', urlErr,
        'Only http:// and https:// URLs are supported.');
    }

    try {
      const result = await webFetchTool.fetch(url);

      // SSRF protection blocked the request
      if ('error' in result && result.error === 'SSRF_BLOCKED') {
        logger.warn('Web fetch tool: SSRF blocked', { url, reason: result.reason, requestId: req.id });
        return sendError(reply, 403, 'SSRF_BLOCKED', `Request blocked: ${result.reason}`,
          'Requests to private/loopback/metadata IP ranges are not allowed.');
      }

      const fetchResult = result as import('@krythor/core').WebFetchResult;
      logger.info('Web fetch tool: fetch completed', {
        url,
        contentLength: fetchResult.contentLength,
        truncated: fetchResult.truncated,
        requestId: req.id,
      });
      return reply.send(fetchResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Web fetch failed';
      logger.warn('Web fetch tool: fetch failed', { url, error: message, requestId: req.id });

      // Unsupported scheme is a client error (400), not a gateway error (502)
      if (message.includes('Unsupported URL scheme')) {
        return sendError(reply, 400, 'INVALID_URL', message,
          'Only http:// and https:// URLs are supported.');
      }
      return sendError(reply, 502, 'WEB_FETCH_FAILED', message,
        'The URL could not be fetched. Check the URL or try again shortly.');
    }
  });
}
