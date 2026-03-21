import { spawn } from 'child_process';
import type { GuardEngine } from '@krythor/guard';

// ─── ExecTool ─────────────────────────────────────────────────────────────────
//
// Safe local command execution for agents and API callers.
// Commands must be in the allowlist before they are executed.
// All executions are checked against the guard engine first.
//
// Design principles:
// - Deny by default: commands not in the allowlist are rejected without execution.
// - Guard-engine aware: the 'command:execute' operation is checked via GuardEngine.
// - Hard timeout: 30 seconds by default (configurable up to MAX_TIMEOUT_MS).
// - Capture stdout/stderr separately; never merge them.
// - No shell expansion: args are passed as a list, never via shell interpolation.
// - No working directory traversal: cwd must be an absolute path (not validated
//   for sandbox — this is a process-level isolation, not a container sandbox).
//

export const DEFAULT_EXEC_ALLOWLIST: ReadonlySet<string> = new Set([
  'ls',
  'pwd',
  'echo',
  'cat',
  'grep',
  'find',
  'git',
  'node',
  'python',
  'python3',
  'npm',
  'pnpm',
]);

/** Maximum timeout any caller can request (5 minutes). */
export const MAX_TIMEOUT_MS = 300_000;

/** Default per-execution timeout if none is specified. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecOptions {
  /** Working directory for the process. Defaults to process.cwd(). */
  cwd?: string;
  /** Timeout in milliseconds. Min: 1000. Max: MAX_TIMEOUT_MS. Default: DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Environment variables merged into the child process environment. */
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** True when the process was killed due to timeout. */
  timedOut: boolean;
}

export class ExecDeniedError extends Error {
  constructor(public readonly command: string, reason: string) {
    super(`Exec denied for "${command}": ${reason}`);
    this.name = 'ExecDeniedError';
  }
}

export class ExecTimeoutError extends Error {
  constructor(public readonly command: string, public readonly timeoutMs: number) {
    super(`Exec of "${command}" timed out after ${timeoutMs}ms`);
    this.name = 'ExecTimeoutError';
  }
}

// ─── ExecTool class ───────────────────────────────────────────────────────────

export class ExecTool {
  private readonly allowlist: ReadonlySet<string>;

  constructor(
    private readonly guard: GuardEngine | null,
    allowlist?: ReadonlySet<string>,
  ) {
    this.allowlist = allowlist ?? DEFAULT_EXEC_ALLOWLIST;
  }

  /**
   * Execute `command` with `args` in a child process.
   *
   * Before execution:
   * 1. The command basename is checked against the allowlist.
   * 2. The guard engine is called with operation 'command:execute'.
   *
   * Both checks must pass before spawn() is called.
   */
  async run(
    command: string,
    args: string[] = [],
    options: ExecOptions = {},
    source = 'user',
    sourceId?: string,
  ): Promise<ExecResult> {
    // ── Validate and normalize command ──────────────────────────────────────
    if (!command || typeof command !== 'string') {
      throw new ExecDeniedError(command, 'command must be a non-empty string');
    }

    // Extract the basename so "git" and "/usr/bin/git" both match "git"
    const parts = command.replace(/\\/g, '/').split('/');
    const basename = parts[parts.length - 1] ?? command;
    // Strip .exe suffix on Windows so "node.exe" matches "node"
    const normalizedBasename = basename.replace(/\.exe$/i, '').toLowerCase();

    if (!this.allowlist.has(normalizedBasename)) {
      throw new ExecDeniedError(command,
        `"${normalizedBasename}" is not in the exec allowlist. ` +
        `Allowed: ${Array.from(this.allowlist).join(', ')}.`
      );
    }

    // ── Guard engine check ──────────────────────────────────────────────────
    if (this.guard) {
      const verdict = this.guard.check({
        operation: 'command:execute',
        source,
        sourceId,
        content: `${command} ${args.join(' ')}`.trim(),
      });
      if (!verdict.allowed) {
        throw new ExecDeniedError(command, verdict.reason);
      }
    }

    // ── Clamp timeout ───────────────────────────────────────────────────────
    const timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000),
      MAX_TIMEOUT_MS,
    );

    // ── Spawn ───────────────────────────────────────────────────────────────
    return new Promise<ExecResult>((resolve, reject) => {
      const start = Date.now();
      let timedOut = false;

      const child = spawn(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...(options.env ?? {}) } as NodeJS.ProcessEnv,
        // Never use 'shell: true' — shell injection risk
        shell: false,
        // Pipe stdout/stderr for capture; inherit stdin from /dev/null effectively
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // SIGKILL after 2s if SIGTERM is ignored
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
        }, 2000);
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const exitCode = code ?? (timedOut ? 124 : 1);

        if (timedOut) {
          reject(new ExecTimeoutError(command, timeoutMs));
          return;
        }

        resolve({ stdout, stderr, exitCode, durationMs, timedOut: false });
      });
    });
  }

  /** Returns the current allowlist for inspection. */
  getAllowlist(): string[] {
    return Array.from(this.allowlist);
  }
}
