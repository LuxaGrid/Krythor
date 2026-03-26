import { spawn, exec } from 'node:child_process';
import { platform } from 'node:os';
import type { GuardEngine } from '@krythor/guard';
import { AccessProfileStore, makeAuditEntry } from './AccessProfileStore.js';
import { logger } from './logger.js';

// ─── ShellToolDispatcher ──────────────────────────────────────────────────────
//
// Bridges the AgentRunner custom-tool-dispatcher hook to the shell permission
// layer.  Handles two tool names:
//
//   shell_exec      — run an arbitrary command (requires standard or full_access)
//   list_processes  — list running OS processes (requires standard or full_access)
//
// Returns null for any tool name that is not a shell tool, allowing the caller
// to chain additional dispatchers.
//

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS     = 300_000; // 5 minutes
const MAX_OUTPUT_BYTES   = 1_048_576; // 1 MB per stream

// ─── Spawn helper ─────────────────────────────────────────────────────────────

interface SpawnResult {
  stdout:     string;
  stderr:     string;
  exitCode:   number | null;
  durationMs: number;
  timedOut:   boolean;
}

function spawnPromise(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startMs = Date.now();

    const child = spawn(command, args, {
      shell:       false,
      cwd:         opts.cwd,
      env:         process.env,
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

interface ProcessInfo {
  pid:  number;
  name: string;
  cmd?: string;
  cpu?: number;
  mem?: number;
}

function listProcesses(): Promise<ProcessInfo[]> {
  return new Promise((resolve) => {
    if (platform() === 'win32') {
      exec(
        'wmic process get ProcessId,Name,CommandLine /format:csv',
        { timeout: 15_000 },
        (err, stdout) => {
          if (err) { resolve([]); return; }
          const lines = stdout.split('\n').filter(l => l.trim().length > 0);
          const procs: ProcessInfo[] = [];
          for (const line of lines.slice(1)) {
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
      exec('ps aux', { timeout: 15_000 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        const procs: ProcessInfo[] = [];
        for (const line of lines.slice(1)) {
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

// ─── ShellToolDispatcher class ────────────────────────────────────────────────

export class ShellToolDispatcher {
  constructor(
    private readonly guard: GuardEngine,
    private readonly accessProfileStore: AccessProfileStore,
  ) {}

  /**
   * Dispatch a shell tool call on behalf of an agent.
   *
   * Returns a JSON string on success/denial, or null if toolName is not a
   * shell tool (allowing the caller to chain other dispatchers).
   */
  async dispatch(agentId: string, toolName: string, input: string): Promise<string | null> {
    if (toolName === 'shell_exec') {
      return this.handleExec(agentId, input);
    }
    if (toolName === 'list_processes') {
      return this.handleListProcesses(agentId);
    }
    return null; // not a shell tool — let another dispatcher handle it
  }

  // ── shell_exec ─────────────────────────────────────────────────────────────

  private async handleExec(agentId: string, input: string): Promise<string> {
    let parsed: { command: string; args?: string[]; cwd?: string; timeoutMs?: number };
    try {
      parsed = JSON.parse(input) as typeof parsed;
    } catch {
      parsed = { command: input };
    }

    const operation = 'shell:exec';
    const profile = this.accessProfileStore.getProfile(agentId);

    // Guard check first
    const verdict = this.guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Blocked by guard policy';
      logger.warn('ShellToolDispatcher: shell_exec denied by guard', { command: parsed.command, agentId });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, parsed.command, profile, false, msg));
      return JSON.stringify({ error: 'GUARD_DENIED', message: msg });
    }

    // Profile check
    if (profile === 'safe') {
      const msg = 'Shell access requires standard or full_access profile';
      logger.warn('ShellToolDispatcher: shell_exec denied (safe profile)', { command: parsed.command, agentId });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, parsed.command, profile, false, msg));
      return JSON.stringify({ error: 'SHELL_DENIED', message: msg });
    }

    const { command, args = [], cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = parsed;
    const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

    logger.info('ShellToolDispatcher: shell_exec start', { command, args, cwd, agentId, timeoutMs: clampedTimeout });

    try {
      const result = await spawnPromise(command, args, { cwd, timeoutMs: clampedTimeout });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, profile, true));
      return JSON.stringify({
        stdout:     result.stdout,
        stderr:     result.stderr,
        exitCode:   result.exitCode,
        durationMs: result.durationMs,
        command,
        profile,
        ...(result.timedOut ? { timedOut: true } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('ShellToolDispatcher: shell_exec failed', { command, agentId, error: msg });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, command, profile, false, msg));
      return JSON.stringify({ error: 'EXEC_FAILED', message: msg });
    }
  }

  // ── list_processes ─────────────────────────────────────────────────────────

  private async handleListProcesses(agentId: string): Promise<string> {
    const operation = 'shell:list_processes';
    const profile = this.accessProfileStore.getProfile(agentId);

    // Guard check first
    const verdict = this.guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Blocked by guard policy';
      logger.warn('ShellToolDispatcher: list_processes denied by guard', { agentId });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, false, msg));
      return JSON.stringify({ error: 'GUARD_DENIED', message: msg });
    }

    // Profile check
    if (profile === 'safe') {
      const msg = 'Process listing requires standard or full_access profile';
      logger.warn('ShellToolDispatcher: list_processes denied (safe profile)', { agentId });
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, false, msg));
      return JSON.stringify({ error: 'SHELL_DENIED', message: msg });
    }

    logger.info('ShellToolDispatcher: list_processes', { agentId });

    try {
      const processes = await listProcesses();
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, true));
      return JSON.stringify({ processes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.accessProfileStore.logAudit(makeAuditEntry(agentId, operation, '', profile, false, msg));
      return JSON.stringify({ error: 'LIST_FAILED', message: msg });
    }
  }
}
