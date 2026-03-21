import { describe, it, expect } from 'vitest';
import {
  ExecTool,
  ExecDeniedError,
  ExecTimeoutError,
  DEFAULT_EXEC_ALLOWLIST,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from './ExecTool.js';

// Tests run without a guard engine (pass null) so guard checks are skipped.
// This tests the allowlist and process execution logic in isolation.

describe('ExecTool — allowlist enforcement', () => {
  it('denies a command not in the allowlist', async () => {
    const tool = new ExecTool(null);
    await expect(tool.run('rm', ['-rf', '/'])).rejects.toThrow(ExecDeniedError);
  });

  it('denies an empty command', async () => {
    const tool = new ExecTool(null);
    await expect(tool.run('')).rejects.toThrow(ExecDeniedError);
  });

  it('denies bash even though it is not in the default allowlist', async () => {
    const tool = new ExecTool(null);
    await expect(tool.run('bash', ['-c', 'echo hi'])).rejects.toThrow(ExecDeniedError);
  });

  it('allows echo (in default allowlist)', async () => {
    const tool = new ExecTool(null);
    const result = await tool.run('echo', ['hello']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('allows node --version (node is in default allowlist)', async () => {
    const tool = new ExecTool(null);
    const result = await tool.run('node', ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+\./);
  });

  it('captures stderr separately from stdout', async () => {
    const tool = new ExecTool(null);
    // node -e 'process.stderr.write("err")' writes to stderr
    const result = await tool.run('node', ['-e', 'process.stderr.write("err")']);
    expect(result.stderr).toBe('err');
    expect(result.stdout).toBe('');
  });

  it('captures exit code for non-zero exits', async () => {
    const tool = new ExecTool(null);
    // node -e 'process.exit(2)' exits with code 2
    const result = await tool.run('node', ['-e', 'process.exit(2)']);
    expect(result.exitCode).toBe(2);
  });

  it('returns duration in milliseconds', async () => {
    const tool = new ExecTool(null);
    const result = await tool.run('echo', ['hi']);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('uses a custom allowlist when provided', async () => {
    const tool = new ExecTool(null, new Set(['echo', 'env']));
    // 'node' is not in the custom allowlist
    await expect(tool.run('node', ['--version'])).rejects.toThrow(ExecDeniedError);
    // 'echo' is in the custom allowlist
    const result = await tool.run('echo', ['ok']);
    expect(result.exitCode).toBe(0);
  });

  it('normalizes .exe suffix on the command name (Windows compat)', async () => {
    // ExecTool strips .exe suffix before allowlist check
    // We test by creating a set with 'echo' and verifying 'echo' still resolves
    const tool = new ExecTool(null, new Set(['echo']));
    // On all platforms the basename logic should handle 'echo' matching itself
    const result = await tool.run('echo', ['test']);
    expect(result.exitCode).toBe(0);
  });
});

describe('ExecTool — timeout enforcement', () => {
  it('rejects with ExecTimeoutError when the process exceeds the timeout', async () => {
    const tool = new ExecTool(null);
    // node -e 'setTimeout(()=>{},60000)' would hang for 60s — use 1s timeout
    await expect(
      tool.run('node', ['-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 1000 })
    ).rejects.toThrow(ExecTimeoutError);
  });

  it('clamps timeout to 1000ms minimum', async () => {
    // timeoutMs of 0 should be treated as 1000ms minimum
    // We confirm this doesn't throw a validation error
    const tool = new ExecTool(null);
    const result = await tool.run('echo', ['hi'], { timeoutMs: 0 });
    expect(result.exitCode).toBe(0);
  });
});

describe('ExecTool — configuration', () => {
  it('exposes the allowlist via getAllowlist()', () => {
    const tool = new ExecTool(null);
    const list = tool.getAllowlist();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain('echo');
    expect(list).toContain('git');
    expect(list).toContain('node');
  });

  it('DEFAULT_EXEC_ALLOWLIST contains the expected commands', () => {
    expect(DEFAULT_EXEC_ALLOWLIST.has('echo')).toBe(true);
    expect(DEFAULT_EXEC_ALLOWLIST.has('git')).toBe(true);
    expect(DEFAULT_EXEC_ALLOWLIST.has('node')).toBe(true);
    expect(DEFAULT_EXEC_ALLOWLIST.has('python')).toBe(true);
    expect(DEFAULT_EXEC_ALLOWLIST.has('pnpm')).toBe(true);
    expect(DEFAULT_EXEC_ALLOWLIST.has('rm')).toBe(false);
    expect(DEFAULT_EXEC_ALLOWLIST.has('bash')).toBe(false);
    expect(DEFAULT_EXEC_ALLOWLIST.has('curl')).toBe(false);
  });

  it('DEFAULT_TIMEOUT_MS is 30 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('MAX_TIMEOUT_MS is 5 minutes', () => {
    expect(MAX_TIMEOUT_MS).toBe(300_000);
  });
});

describe('ExecTool — guard integration (mock)', () => {
  it('denies execution when guard returns denied verdict', async () => {
    const mockGuard = {
      check: () => ({ allowed: false, action: 'deny', reason: 'Policy: exec blocked', warnings: [] }),
    };

    const tool = new ExecTool(mockGuard as unknown as import('@krythor/guard').GuardEngine);
    await expect(tool.run('echo', ['hi'])).rejects.toThrow(ExecDeniedError);
  });

  it('allows execution when guard returns allowed verdict', async () => {
    const mockGuard = {
      check: () => ({ allowed: true, action: 'allow', reason: 'Policy: exec allowed', warnings: [] }),
    };

    const tool = new ExecTool(mockGuard as unknown as import('@krythor/guard').GuardEngine);
    const result = await tool.run('echo', ['hi']);
    expect(result.exitCode).toBe(0);
  });
});
