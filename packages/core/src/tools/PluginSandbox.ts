/**
 * PluginSandbox — executes a plugin's run() function in an isolated child
 * process via child_process.fork().
 *
 * Each invocation spawns a fresh worker (sandbox-worker.js), sends a 'run'
 * message with the plugin path and input, waits for a 'result' or 'error'
 * reply, then terminates the child. If the child does not respond within
 * timeoutMs, it is killed and an error is returned.
 *
 * Benefits of this isolation model:
 *   - Plugin crashes do not bring down the gateway process
 *   - Plugin memory leaks are contained to the short-lived worker
 *   - Plugin code cannot access the parent's in-memory state
 */

import { fork } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

/** Locate the compiled sandbox-worker.js from the same directory as this file. */
function resolveWorkerPath(): string {
  // tsup builds core as CJS so __dirname is always available here.
  return join(__dirname, 'tools', 'sandbox-worker.js');
}

export interface SandboxRunOptions {
  /** Milliseconds before the child is killed. Default: 30 000 */
  timeoutMs?: number;
}

export class PluginSandbox {
  private readonly workerPath: string;

  constructor() {
    this.workerPath = resolveWorkerPath();
  }

  /**
   * Run the plugin at `pluginPath` in a sandboxed child process.
   *
   * Returns the plugin's output string on success.
   * Throws an error if the plugin errors, times out, or the worker crashes.
   */
  async run(pluginPath: string, input: string, opts: SandboxRunOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!existsSync(this.workerPath)) {
      // Sandbox worker not built yet (e.g. running from source during tests) —
      // fall back to direct require() so the system keeps working.
      return this.runDirect(pluginPath, input);
    }

    return new Promise<string>((resolve, reject) => {
      const child = fork(this.workerPath, [], {
        silent: true,        // Capture stdout/stderr; don't inherit
        execArgv: [],        // No --inspect or other flags from parent
      });

      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Plugin timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('message', (msg: { type: string; output?: string; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        if (msg.type === 'result') {
          resolve(msg.output ?? '');
        } else {
          reject(new Error(msg.message ?? 'Plugin worker returned an error'));
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Plugin sandbox error: ${err.message}`));
      });

      child.on('exit', (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) {
          reject(new Error(`Plugin worker killed by signal ${signal}`));
        } else {
          reject(new Error(`Plugin worker exited unexpectedly with code ${code ?? 'unknown'}`));
        }
      });

      // Send the run command
      child.send({ type: 'run', pluginPath, input });
    });
  }

  /** Fallback: run the plugin directly in-process (no sandbox). */
  private async runDirect(pluginPath: string, input: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const plugin = require(pluginPath) as { run: (input: string) => Promise<string> };
    if (typeof plugin?.run !== 'function') {
      throw new Error('Plugin does not export a run() function');
    }
    return plugin.run(input);
  }
}
