import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import type {
  SandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
} from './SandboxProvider.js';
import { SandboxNotFoundError } from './SandboxProvider.js';

// ─── LocalSandboxProvider ─────────────────────────────────────────────────────
//
// Implements SandboxProvider by delegating directly to the host environment.
// Provides NO actual isolation — createSandbox() returns a UUID, execInSandbox()
// runs the process on the host, destroySandbox() is a no-op.
//
// This exists to satisfy the SandboxProvider interface while the system
// remains feature-compatible with future isolated providers.
//
// Switch to DockerSandboxProvider or FirecrackerSandboxProvider when stronger
// isolation is needed.
//

const DEFAULT_TIMEOUT_MS = 30_000;

export class LocalSandboxProvider implements SandboxProvider {
  readonly id = 'local';

  private activeSandboxes = new Set<string>();

  getCapabilities(): SandboxCapabilities {
    return {
      filesystem: true,
      network: true,
      processExec: true,
      gpu: false,
    };
  }

  async createSandbox(_options?: Record<string, unknown>): Promise<string> {
    const sandboxId = randomUUID();
    this.activeSandboxes.add(sandboxId);
    return sandboxId;
  }

  async execInSandbox(sandboxId: string, options: SandboxExecOptions): Promise<SandboxExecResult> {
    if (!this.activeSandboxes.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }

    return new Promise<SandboxExecResult>((resolve) => {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timedOut = false;

      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write stdin if provided
      if (options.stdin && child.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after 2s if SIGTERM didn't work
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 2000);
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: timedOut ? -1 : (code ?? -1),
          timedOut,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + `\nProcess error: ${err.message}`,
          exitCode: -1,
          timedOut: false,
        });
      });
    });
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    // Local provider: no resources to release — just remove from tracking set
    this.activeSandboxes.delete(sandboxId);
  }

  /** Returns the count of active (tracked) sandbox instances */
  get activeCount(): number {
    return this.activeSandboxes.size;
  }
}
