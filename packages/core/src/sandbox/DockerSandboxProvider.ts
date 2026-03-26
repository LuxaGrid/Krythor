import type {
  SandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
} from './SandboxProvider.js';
import { NotImplementedError } from './SandboxProvider.js';

// ─── DockerSandboxProvider ─────────────────────────────────────────────────────
//
// Stub implementation of SandboxProvider for Docker-based isolation.
// All methods throw NotImplementedError until Docker integration is built.
//
// Enable by setting KRYTHOR_SANDBOX=docker in the environment.
// When enabled, the gateway will instantiate this provider instead of
// LocalSandboxProvider.
//
// Future implementation notes:
//   - createSandbox()     → docker run --rm -d <image> (returns container ID)
//   - execInSandbox()     → docker exec <containerId> <command>
//   - destroySandbox()    → docker rm -f <containerId>
//   - Network isolation:  → --network none or dedicated bridge
//   - Filesystem:         → --mount type=tmpfs,dst=/workspace
//   - Resource limits:    → --memory, --cpus flags from options
//

export class DockerSandboxProvider implements SandboxProvider {
  readonly id = 'docker';

  /** Returns projected capabilities once Docker integration is implemented */
  getCapabilities(): SandboxCapabilities {
    return {
      filesystem: true,
      network: false,   // docker sandbox will default to no outbound network
      processExec: true,
      gpu: false,
    };
  }

  async createSandbox(_options?: Record<string, unknown>): Promise<string> {
    throw new NotImplementedError('Docker sandbox not yet implemented');
  }

  async execInSandbox(_sandboxId: string, _options: SandboxExecOptions): Promise<SandboxExecResult> {
    throw new NotImplementedError('Docker sandbox not yet implemented');
  }

  async destroySandbox(_sandboxId: string): Promise<void> {
    throw new NotImplementedError('Docker sandbox not yet implemented');
  }
}

// ── Factory helper ─────────────────────────────────────────────────────────────

/**
 * Returns the appropriate SandboxProvider based on the KRYTHOR_SANDBOX env var.
 * Defaults to LocalSandboxProvider if the var is unset or unrecognised.
 */
export function createSandboxProvider(): SandboxProvider {
  const mode = process.env['KRYTHOR_SANDBOX'] ?? 'local';
  if (mode === 'docker') {
    return new DockerSandboxProvider();
  }
  // Defer import to avoid circular reference during tree-shaking
  const { LocalSandboxProvider } = require('./LocalSandboxProvider.js') as typeof import('./LocalSandboxProvider.js');
  return new LocalSandboxProvider();
}
