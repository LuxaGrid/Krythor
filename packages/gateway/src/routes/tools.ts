import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { ExecTool, ExecDeniedError, ExecTimeoutError } from '@krythor/core';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';

// ─── Tools routes ─────────────────────────────────────────────────────────────
//
// GET  /api/tools          — list available tool info (exec tool + allowlist)
// POST /api/tools/exec     — execute a command (guard-checked, allowlist-checked)
//
// All routes require auth (handled by the global preHandler in server.ts).
//

export function registerToolRoutes(
  app: FastifyInstance,
  guard: GuardEngine,
  execTool: ExecTool,
): void {

  // GET /api/tools — describe available tools
  app.get('/api/tools', async (_req, reply) => {
    return reply.send({
      tools: [
        {
          name: 'exec',
          description: 'Execute a local command. Commands must be in the allowlist.',
          allowlist: execTool.getAllowlist(),
          defaultTimeoutMs: 30_000,
          maxTimeoutMs: 300_000,
          endpoint: 'POST /api/tools/exec',
        },
      ],
    });
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
}
