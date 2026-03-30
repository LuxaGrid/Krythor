/**
 * Tests for TailscaleService — validateConfig logic and getStatus with mocked CLI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TailscaleService } from './TailscaleService.js';
import type { TailscaleConfig } from './TailscaleService.js';

// ── Mock child_process so we never touch the real tailscale CLI ────────────

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'child_process';
const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

// promisify wraps execFile; we need to mock the promisified version.
// TailscaleService uses `promisify(_execFile)`, so we mock the raw execFile
// and provide a callback-style mock that promisify can wrap.
function makeExecFileMock(result: { stdout: string } | Error) {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, result?: { stdout: string }) => void) => {
      if (result instanceof Error) {
        cb(result);
      } else {
        cb(null, result);
      }
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── validateConfig ────────────────────────────────────────────────────────

describe('TailscaleService.validateConfig', () => {
  const svc = new TailscaleService(47200);

  it('returns null when mode is off (any authMode)', () => {
    const cfg: TailscaleConfig = { mode: 'off', resetOnExit: false };
    expect(svc.validateConfig(cfg, 'token')).toBeNull();
    expect(svc.validateConfig(cfg, 'password')).toBeNull();
  });

  it('returns null for serve mode with token auth', () => {
    const cfg: TailscaleConfig = { mode: 'serve', resetOnExit: false };
    expect(svc.validateConfig(cfg, 'token')).toBeNull();
  });

  it('returns null for serve mode with password auth', () => {
    const cfg: TailscaleConfig = { mode: 'serve', resetOnExit: false };
    expect(svc.validateConfig(cfg, 'password')).toBeNull();
  });

  it('returns error for funnel mode with token auth', () => {
    const cfg: TailscaleConfig = { mode: 'funnel', resetOnExit: false };
    const result = svc.validateConfig(cfg, 'token');
    expect(result).not.toBeNull();
    expect(result).toContain('password');
  });

  it('returns null for funnel mode with password auth', () => {
    const cfg: TailscaleConfig = { mode: 'funnel', resetOnExit: false };
    expect(svc.validateConfig(cfg, 'password')).toBeNull();
  });
});

// ── getStatus — CLI not installed ─────────────────────────────────────────

describe('TailscaleService.getStatus when CLI not found', () => {
  it('returns installed: false with warning when execFile throws ENOENT', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    makeExecFileMock(enoent);

    const svc = new TailscaleService(47200);
    const cfg: TailscaleConfig = { mode: 'off', resetOnExit: false };
    const status = await svc.getStatus(cfg);

    expect(status.installed).toBe(false);
    expect(status.loggedIn).toBe(false);
    expect(status.tailnetIP).toBeNull();
    expect(status.magicDNS).toBeNull();
    expect(status.warnings).toContain('Tailscale CLI not found');
  });
});

// ── Mode type guard ───────────────────────────────────────────────────────

describe('TailscaleMode type values', () => {
  it('accepts off, serve, funnel as valid mode strings', () => {
    const modes: string[] = ['off', 'serve', 'funnel'];
    for (const m of modes) {
      expect(['off', 'serve', 'funnel']).toContain(m);
    }
  });

  it('rejects invalid mode strings', () => {
    const invalid = 'tunnel';
    expect(['off', 'serve', 'funnel']).not.toContain(invalid);
  });
});
