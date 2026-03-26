import { spawn, exec } from 'node:child_process';
import { platform } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';
import { AccessProfileStore, makeAuditEntry } from '../AccessProfileStore.js';

// ─── Shell Tool Routes ─────────────────────────────────────────────────────────
//
// All routes live under /api/tools/shell/.
// Access profile enforcement:
//   safe        — no shell access at all
//   standard    — exec + process list allowed; kill denied
//   full_access — all operations allowed
//

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS     = 300_000; // 5 minutes
const MAX_OUTPUT_BYTES   = 1_048_576; // 1 MB per stream

// ─── Process info type ────────────────────────────────────────────────────────

interface ProcessInfo {
  pid:   number;
  name:  string;
  cmd?:  string;
  cpu?:  number;
  mem?:  number;
}

// ─── Spawn helper ─────────────────────────────────────────────────────────────

interface SpawnResult {
  stdout:     string;
  stderr:     string;
  exitCode:   number | null;
  durationMs: number;
  timedOut:   boolean;
}

function spawnCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startMs = Date.now();

    // Build environment — merge process.env with caller-supplied overrides
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(opts.env ?? {}),
    };

    const child = spawn(command, args, {
      shell: false,
      cwd:   opts.cwd,
      env,
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
        stdoutChunks.push(slice);
        stdoutBytes += slice.length;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - stderrBytes;
      if (remaining > 0) {
        const slice = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
        stderrChunks.push(slice);
        stderrBytes += slice.length;
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout:     Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr:     Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode:   code,
        durationMs: Date.now() - startMs,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout:     '',
        stderr:     err.message,
        exitCode:   null,
        durationMs: Date.now() - startMs,
        timedOut:   false,
      });
    });
  });
}

// ─── Process list helper ──────────────────────────────────────────────────────

function listProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve) => {
    if (platform() === 'win32') {
      // Use wmic — available on all supported Windows versions
      exec(
        'wmic process get ProcessId,Name,CommandLine /format:csv',
        { timeout: 15_000 },
        (err, stdout) => {
          if (err) { resolve([]); return; }
          const lines = stdout.split('\n').filter(l => l.trim().length > 0);
          const procs: ProcessInfo[] = [];
          for (const line of lines.slice(1)) { // skip header
            // CSV columns: Node,CommandLine,Name,ProcessId
            const parts = line.split(',');
            if (parts.length < 4) continue;
            const pidStr = parts[parts.length - 1]?.trim();
            const name   = parts[parts.length - 2]?.trim() ?? '';
            const cmd    = parts.slice(1, parts.length - 2).join(',').trim() || undefined;
            const pid    = parseInt(pidStr ?? '', 10);
            if (!isNaN(pid) && pid > 0) {
              procs.push({ pid, name, cmd });
            }
          }
          resolve(procs);
        },
      );
    } else {
      // Unix: ps aux
      exec('ps aux', { timeout: 15_000 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        const procs: ProcessInfo[] = [];
        for (const line of lines.slice(1)) { // skip header
          const parts = line.trim().split(/\s+/);
          if (parts.length < 11) continue;
          const pid  = parseInt(parts[1] ?? '', 10);
          const cpu  = parseFloat(parts[2] ?? '0');
          const mem  = parseFloat(parts[3] ?? '0');
          const name = parts[10] ?? '';
          const cmd  = parts.slice(10).join(' ') || undefined;
          if (!isNaN(pid) && pid > 0) {
            procs.push({ pid, name, cmd, cpu, mem });
          }
        }
        resolve(procs);
      });
    }
  });
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerShellToolRoutes(
  app: FastifyInstance,
  guard: GuardEngine,
  accessProfileStore: AccessProfileStore,
): void {

  // ── POST /api/tools/shell/exec ──────────────────────────────────────────────
  app.post('/api/tools/shell/exec', {
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command:   { type: 'string', minLength: 1, maxLength: 4096 },
          args:      { type: 'array', items: { type: 'string' }, maxItems: 256 },
          cwd:       { type: 'string', maxLength: 4096 },
          timeoutMs: { type: 'integer', minimum: 1000, maximum: MAX_TIMEOUT_MS },
          env:       { type: 'object', additionalProperties: { type: 'string' } },
          agentId:   { type: 'string', maxLength: 200 },
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
      env?: Record<string, string>;
      agentId?: string;
    };
    const {
      command,
      args = [],
      cwd,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      env,
      agentId = 'user',
    } = body;
    const operation = 'shell:exec';

    // 1. Guard check
    const verdict = guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Guard denied operation';
      logger.warn('Shell tool: exec denied by guard', { command, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, accessProfileStore.getProfile(agentId), false, msg));
      return sendError(reply, 403, 'GUARD_DENIED', msg, 'Adjust your Guard policy in the Guard tab if this is unexpected.');
    }

    // 2. Profile check
    const profile = accessProfileStore.getProfile(agentId);
    if (profile === 'safe') {
      const msg = 'Shell access requires standard or full_access profile';
      logger.warn('Shell tool: exec denied (safe profile)', { command, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, profile, false, msg));
      return sendError(reply, 403, 'SHELL_DENIED', msg, `Current profile: '${profile}'. Update via PUT /api/agents/:id/access-profile.`);
    }

    // standard profile — log that confirmation hooks are future work
    if (profile === 'standard') {
      logger.info('Shell tool: exec (standard profile — confirmation hooks are future work)', { command, agentId });
    }

    // 3. Execute
    const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
    logger.info('Shell tool: exec start', { command, args, cwd, agentId, timeoutMs: clampedTimeout });

    let result: SpawnResult;
    try {
      result = await spawnCommand(command, args, { cwd, env, timeoutMs: clampedTimeout });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      logger.warn('Shell tool: exec spawn error', { command, agentId, error: msg });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, profile, false, msg));
      return sendError(reply, 500, 'EXEC_ERROR', `Failed to spawn command: ${msg}`);
    }

    logger.info('Shell tool: exec complete', { command, agentId, exitCode: result.exitCode, durationMs: result.durationMs });
    accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, profile, true));

    const response: Record<string, unknown> = {
      stdout:     result.stdout,
      stderr:     result.stderr,
      exitCode:   result.exitCode,
      durationMs: result.durationMs,
      command,
      profile,
    };
    if (profile === 'standard') {
      response['confirmationRequired'] = false;
    }
    if (result.timedOut) {
      response['timedOut'] = true;
    }

    return reply.send(response);
  });

  // ── GET /api/tools/shell/processes ─────────────────────────────────────────
  app.get('/api/tools/shell/processes', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const query   = req.query as { agentId?: string };
    const agentId = query.agentId ?? 'user';
    const operation = 'shell:list_processes';

    // 1. Guard check
    const verdict = guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Guard denied operation';
      logger.warn('Shell tool: list_processes denied by guard', { agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', accessProfileStore.getProfile(agentId), false, msg));
      return sendError(reply, 403, 'GUARD_DENIED', msg, 'Adjust your Guard policy in the Guard tab if this is unexpected.');
    }

    // 2. Profile check
    const profile = accessProfileStore.getProfile(agentId);
    if (profile === 'safe') {
      const msg = 'Shell access requires standard or full_access profile';
      logger.warn('Shell tool: list_processes denied (safe profile)', { agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, false, msg));
      return sendError(reply, 403, 'SHELL_DENIED', msg, `Current profile: '${profile}'. Update via PUT /api/agents/:id/access-profile.`);
    }

    // 3. List processes
    logger.info('Shell tool: list_processes', { agentId });
    let processes: ProcessInfo[];
    try {
      processes = await listProcesses();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, false, msg));
      return sendError(reply, 500, 'PROC_LIST_ERROR', `Failed to list processes: ${msg}`);
    }

    accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, true));
    return reply.send({ processes });
  });

  // ── POST /api/tools/shell/kill ──────────────────────────────────────────────
  app.post('/api/tools/shell/kill', {
    schema: {
      body: {
        type: 'object',
        required: ['pid'],
        properties: {
          pid:     { type: 'integer', minimum: 1 },
          signal:  { type: 'string', maxLength: 20 },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as { pid: number; signal?: string; agentId?: string };
    const { pid, signal = 'SIGTERM', agentId = 'user' } = body;
    const operation = 'shell:kill';

    // 1. Guard check
    const verdict = guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Guard denied operation';
      logger.warn('Shell tool: kill denied by guard', { pid, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), accessProfileStore.getProfile(agentId), false, msg));
      return sendError(reply, 403, 'GUARD_DENIED', msg, 'Adjust your Guard policy in the Guard tab if this is unexpected.');
    }

    // 2. Profile check — only full_access may kill processes
    const profile = accessProfileStore.getProfile(agentId);
    if (profile === 'safe' || profile === 'standard') {
      const msg = 'Process termination requires full_access profile';
      logger.warn('Shell tool: kill denied (insufficient profile)', { pid, agentId, profile });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), profile, false, msg));
      return sendError(reply, 403, 'SHELL_DENIED', msg, `Current profile: '${profile}'. Update via PUT /api/agents/:id/access-profile.`);
    }

    // 3. Send signal
    logger.info('Shell tool: kill', { pid, signal, agentId });
    try {
      process.kill(pid, signal as NodeJS.Signals);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ESRCH') {
        accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), profile, false, 'ESRCH: no such process'));
        return sendError(reply, 404, 'NO_SUCH_PROCESS', `No process found with PID ${pid}`);
      }
      if (nodeErr.code === 'EPERM') {
        accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), profile, false, 'EPERM: permission denied'));
        return sendError(reply, 403, 'OS_PERMISSION_DENIED', `OS denied permission to signal PID ${pid}`,
          'The gateway process does not have OS-level permission to signal this process.');
      }
      const msg = nodeErr.message ?? String(err);
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), profile, false, msg));
      return sendError(reply, 500, 'KILL_ERROR', `Failed to signal process: ${msg}`);
    }

    accessProfileStore.logAudit(makeAuditEntry(agentId, operation, String(pid), profile, true));
    return reply.send({ ok: true, pid, signal });
  });
}
