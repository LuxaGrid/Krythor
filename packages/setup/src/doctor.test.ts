/**
 * Tests for doctor command and setup messaging.
 * Validates that diagnostic output is coherent and non-crashing for
 * common system states without actually spawning subprocesses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('SystemProbe nodeVersionOk reflects current Node version', async () => {
    const { probe } = await import('./SystemProbe.js');
    const result = await probe();
    const major = parseInt(process.versions.node.split('.')[0], 10);
    expect(result.nodeVersionOk).toBe(major >= 18);
  });
});
