/**
 * Tests for doctor command and setup messaging.
 * Validates that diagnostic output is coherent and non-crashing for
 * common system states without actually spawning subprocesses.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Setup doctor — output completeness', () => {
  it('fmt helpers produce non-empty strings', async () => {
    const { fmt } = await import('./Prompt.js');
    expect(fmt.ok('test')).toContain('test');
    expect(fmt.warn('test')).toContain('test');
    expect(fmt.err('test')).toContain('test');
    expect(fmt.dim('test')).toContain('test');
    expect(fmt.head('test')).toContain('test');
  });

  it('SystemProbe returns expected fields', async () => {
    const { probe } = await import('./SystemProbe.js');
    const result = await probe();
    expect(result).toHaveProperty('nodeVersion');
    expect(result).toHaveProperty('nodeVersionOk');
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('configDir');
    expect(result).toHaveProperty('dataDir');
    expect(result).toHaveProperty('hasExistingConfig');
    expect(result).toHaveProperty('gatewayPortFree');
    expect(result).toHaveProperty('ollamaDetected');
  });

  it('SystemProbe nodeVersionOk reflects current Node version (requires 20+)', async () => {
    const { probe } = await import('./SystemProbe.js');
    const result = await probe();
    const major = parseInt(process.versions.node.split('.')[0]!, 10);
    expect(result.nodeVersionOk).toBe(major >= 20);
  });
});

describe('KRYTHOR_DATA_DIR environment variable', () => {
  const originalEnv = process.env['KRYTHOR_DATA_DIR'];

  afterEach(() => {
    // Restore the original env var after each test
    if (originalEnv === undefined) {
      delete process.env['KRYTHOR_DATA_DIR'];
    } else {
      process.env['KRYTHOR_DATA_DIR'] = originalEnv;
    }
  });

  it('SystemProbe uses KRYTHOR_DATA_DIR when set', async () => {
    const customDir = join(tmpdir(), 'krythor-test-data-dir');
    process.env['KRYTHOR_DATA_DIR'] = customDir;
    // Re-import to pick up env change (use dynamic import for isolation)
    const { probe } = await import('./SystemProbe.js');
    const result = await probe();
    expect(result.dataDir).toBe(customDir);
    expect(result.configDir).toBe(join(customDir, 'config'));
  });

  it('SystemProbe uses platform default when KRYTHOR_DATA_DIR is not set', async () => {
    delete process.env['KRYTHOR_DATA_DIR'];
    const { probe } = await import('./SystemProbe.js');
    const result = await probe();
    // Should not be a temp dir
    expect(result.dataDir).not.toContain('krythor-test-data-dir');
    // Should be an absolute path
    expect(result.dataDir.startsWith('/')).toBe(
      process.platform !== 'win32',
    );
  });
});
