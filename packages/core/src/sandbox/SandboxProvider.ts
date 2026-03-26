// ─── SandboxProvider Interface ────────────────────────────────────────────────
//
// Future-ready abstraction for sandbox execution environments.
// Current behaviour: LocalSandboxProvider wraps existing ExecTool semantics.
// Future providers (Docker, Firecracker, WASM) will implement this interface.
//
// Isolation guarantee: none in LocalSandboxProvider.
// Isolation guarantee: full in future sandbox implementations.
//

// ── Capabilities ──────────────────────────────────────────────────────────────

export interface SandboxCapabilities {
  /** Whether the sandbox can read/write the host filesystem */
  filesystem: boolean;
  /** Whether the sandbox has outbound network access */
  network: boolean;
  /** Whether the sandbox can spawn child processes */
  processExec: boolean;
  /** Whether the sandbox has GPU access */
  gpu: boolean;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface SandboxExecOptions {
  command: string;
  args: string[];
  /** Working directory (host path for local, sandbox path for isolated) */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Optional stdin payload */
  stdin?: string;
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface SandboxProvider {
  /** Unique provider identifier (e.g. 'local', 'docker', 'firecracker') */
  readonly id: string;

  /** Returns what this provider can do */
  getCapabilities(): SandboxCapabilities;

  /**
   * Create a sandbox instance.
   * Returns a sandboxId used for subsequent calls.
   * For LocalSandboxProvider this is a UUID — no actual isolation is created.
   */
  createSandbox(options?: Record<string, unknown>): Promise<string>;

  /**
   * Execute a command in the given sandbox.
   * The sandbox must have been created with createSandbox() first.
   */
  execInSandbox(sandboxId: string, options: SandboxExecOptions): Promise<SandboxExecResult>;

  /**
   * Destroy a sandbox and release its resources.
   * For LocalSandboxProvider this is a no-op.
   */
  destroySandbox(sandboxId: string): Promise<void>;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class SandboxNotFoundError extends Error {
  constructor(sandboxId: string) {
    super(`Sandbox "${sandboxId}" not found`);
    this.name = 'SandboxNotFoundError';
  }
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
    this.name = 'NotImplementedError';
  }
}
