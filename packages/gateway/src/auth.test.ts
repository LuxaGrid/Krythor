/**
 * Tests for auth.ts — token loading and KRYTHOR_GATEWAY_TOKEN env var.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadOrCreateToken, verifyToken } from './auth.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'krythor-auth-test-'));
}

afterEach(() => {
  // Clean up env var after each test
  delete process.env['KRYTHOR_GATEWAY_TOKEN'];
});

describe('loadOrCreateToken — env var override', () => {
  it('returns env var token when KRYTHOR_GATEWAY_TOKEN is set and >= 32 chars', () => {
    const envToken = 'a'.repeat(64);
    process.env['KRYTHOR_GATEWAY_TOKEN'] = envToken;
    const dir = makeTempDir();
    const result = loadOrCreateToken(dir);
    expect(result.token).toBe(envToken);
  });

  it('ignores env var token shorter than 32 chars', () => {
    process.env['KRYTHOR_GATEWAY_TOKEN'] = 'short';
    const dir = makeTempDir();
    const result = loadOrCreateToken(dir);
    // Should fall through to generated token (not the short env var)
    expect(result.token).not.toBe('short');
    expect(result.token.length).toBeGreaterThanOrEqual(32);
  });

  it('env var token takes precedence over app-config.json token', () => {
    const envToken = 'b'.repeat(64);
    process.env['KRYTHOR_GATEWAY_TOKEN'] = envToken;
    const dir = makeTempDir();
    // Pre-write a different token in config
    writeFileSync(join(dir, 'app-config.json'), JSON.stringify({ gatewayToken: 'c'.repeat(64) }));
    const result = loadOrCreateToken(dir);
    expect(result.token).toBe(envToken);
  });

  it('authDisabled wins over KRYTHOR_GATEWAY_TOKEN', () => {
    process.env['KRYTHOR_GATEWAY_TOKEN'] = 'd'.repeat(64);
    const dir = makeTempDir();
    writeFileSync(join(dir, 'app-config.json'), JSON.stringify({ authDisabled: true }));
    const result = loadOrCreateToken(dir);
    expect(result.authDisabled).toBe(true);
    expect(result.token).toBe('');
  });

  it('generates and persists a token on first run when no env var', () => {
    const dir = makeTempDir();
    const result = loadOrCreateToken(dir);
    expect(result.token.length).toBeGreaterThanOrEqual(64); // 32 random bytes = 64 hex chars
    expect((result as { firstRun?: boolean }).firstRun).toBe(true);
  });
});

describe('verifyToken', () => {
  it('returns true for matching tokens', () => {
    expect(verifyToken('abc123', 'abc123')).toBe(true);
  });

  it('returns false for mismatched tokens', () => {
    expect(verifyToken('abc123', 'xyz789')).toBe(false);
  });

  it('returns false when token not supplied', () => {
    expect(verifyToken(undefined, 'expected')).toBe(false);
  });

  it('returns true when expected is empty (auth disabled)', () => {
    expect(verifyToken('anything', '')).toBe(true);
  });
});
