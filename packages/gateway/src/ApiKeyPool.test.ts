import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ApiKeyPool } from './ApiKeyPool.js';

let tmpDir: string;
let pool: ApiKeyPool;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-keypooltest-'));
  pool = new ApiKeyPool(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ApiKeyPool', () => {
  describe('addKey / getKeys', () => {
    it('adds keys and returns them', () => {
      pool.addKey('openai', 'sk-aaaaaa1111111111');
      pool.addKey('openai', 'sk-bbbbbb2222222222');
      expect(pool.getKeys('openai')).toEqual(['sk-aaaaaa1111111111', 'sk-bbbbbb2222222222']);
    });

    it('does not add duplicate keys', () => {
      pool.addKey('openai', 'sk-aaaaaa1111111111');
      pool.addKey('openai', 'sk-aaaaaa1111111111');
      expect(pool.getKeys('openai')).toHaveLength(1);
    });

    it('returns empty array for unknown provider', () => {
      expect(pool.getKeys('unknown')).toEqual([]);
    });

    it('ignores blank keys', () => {
      pool.addKey('openai', '   ');
      expect(pool.getKeys('openai')).toHaveLength(0);
    });
  });

  describe('setKeys', () => {
    it('replaces existing keys', () => {
      pool.addKey('openai', 'sk-old1');
      pool.setKeys('openai', ['sk-new1', 'sk-new2']);
      expect(pool.getKeys('openai')).toEqual(['sk-new1', 'sk-new2']);
    });

    it('deduplicates on set', () => {
      pool.setKeys('openai', ['sk-a', 'sk-a', 'sk-b']);
      expect(pool.getKeys('openai')).toHaveLength(2);
    });

    it('filters blank keys on set', () => {
      pool.setKeys('openai', ['  ', 'sk-valid', '']);
      expect(pool.getKeys('openai')).toEqual(['sk-valid']);
    });
  });

  describe('removeKey', () => {
    it('removes a specific key', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b', 'sk-c']);
      pool.removeKey('openai', 'sk-b');
      expect(pool.getKeys('openai')).toEqual(['sk-a', 'sk-c']);
    });

    it('removes provider when last key is removed', () => {
      pool.addKey('openai', 'sk-only');
      pool.removeKey('openai', 'sk-only');
      expect(pool.getKeys('openai')).toHaveLength(0);
      expect(pool.stats('openai')).toBeNull();
    });

    it('is a no-op for unknown provider', () => {
      expect(() => pool.removeKey('nope', 'sk-x')).not.toThrow();
    });
  });

  describe('removeProvider', () => {
    it('removes all keys for provider', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      pool.removeProvider('openai');
      expect(pool.getKeys('openai')).toHaveLength(0);
    });
  });

  describe('pick', () => {
    it('returns undefined when no keys', () => {
      expect(pool.pick('openai')).toBeUndefined();
    });

    it('returns the only key when one is set', () => {
      pool.addKey('openai', 'sk-only');
      expect(pool.pick('openai')).toBe('sk-only');
    });

    it('round-robins through keys', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b', 'sk-c']);
      const results = [pool.pick('openai'), pool.pick('openai'), pool.pick('openai')];
      expect(results).toEqual(['sk-a', 'sk-b', 'sk-c']);
    });

    it('wraps around after last key', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      pool.pick('openai'); // a
      pool.pick('openai'); // b
      expect(pool.pick('openai')).toBe('sk-a'); // wraps
    });

    it('skips cooled-down keys', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      pool.reportError('openai', 'sk-a', 429);
      // sk-a is on cooldown; should always return sk-b
      expect(pool.pick('openai')).toBe('sk-b');
    });

    it('returns undefined when all keys are on cooldown', () => {
      pool.addKey('openai', 'sk-a');
      pool.reportError('openai', 'sk-a', 429);
      expect(pool.pick('openai')).toBeUndefined();
    });
  });

  describe('reportError', () => {
    it('applies 429 cooldown', () => {
      pool.addKey('openai', 'sk-a');
      pool.reportError('openai', 'sk-a', 429);
      const s = pool.stats('openai')!;
      expect(s.coolingDown).toHaveLength(1);
      expect(s.coolingDown[0]!.remainingMs).toBeGreaterThan(55_000);
    });

    it('applies longer cooldown for 401', () => {
      pool.addKey('openai', 'sk-a');
      pool.reportError('openai', 'sk-a', 401);
      const s = pool.stats('openai')!;
      expect(s.coolingDown[0]!.remainingMs).toBeGreaterThan(290_000);
    });

    it('applies longer cooldown for 403', () => {
      pool.addKey('openai', 'sk-a');
      pool.reportError('openai', 'sk-a', 403);
      const s = pool.stats('openai')!;
      expect(s.coolingDown[0]!.remainingMs).toBeGreaterThan(290_000);
    });

    it('is a no-op for unknown provider', () => {
      expect(() => pool.reportError('nope', 'sk-x', 429)).not.toThrow();
    });
  });

  describe('clearCooldown', () => {
    it('clears an active cooldown', () => {
      pool.addKey('openai', 'sk-a');
      pool.reportError('openai', 'sk-a', 429);
      pool.clearCooldown('openai', 'sk-a');
      const s = pool.stats('openai')!;
      expect(s.coolingDown).toHaveLength(0);
    });
  });

  describe('stats', () => {
    it('returns null for unknown provider', () => {
      expect(pool.stats('nope')).toBeNull();
    });

    it('returns correct totals', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      const s = pool.stats('openai')!;
      expect(s.totalKeys).toBe(2);
      expect(s.availableKeys).toBe(2);
      expect(s.coolingDown).toHaveLength(0);
    });

    it('tracks available vs cooling down', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      pool.reportError('openai', 'sk-a', 429);
      const s = pool.stats('openai')!;
      expect(s.totalKeys).toBe(2);
      expect(s.availableKeys).toBe(1);
      expect(s.coolingDown).toHaveLength(1);
    });
  });

  describe('allStats', () => {
    it('returns stats for all providers', () => {
      pool.addKey('openai', 'sk-a');
      pool.addKey('anthropic', 'sk-b');
      const all = pool.allStats();
      expect(all).toHaveLength(2);
      expect(all.map(s => s.providerId).sort()).toEqual(['anthropic', 'openai']);
    });
  });

  describe('list', () => {
    it('returns provider id and key count', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b', 'sk-c']);
      const l = pool.list();
      expect(l).toEqual([{ providerId: 'openai', keyCount: 3 }]);
    });
  });

  describe('persistence', () => {
    it('loads keys from disk on construction', () => {
      pool.addKey('openai', 'sk-persist');
      const pool2 = new ApiKeyPool(tmpDir);
      expect(pool2.getKeys('openai')).toEqual(['sk-persist']);
    });

    it('persists key removal', () => {
      pool.setKeys('openai', ['sk-a', 'sk-b']);
      pool.removeKey('openai', 'sk-a');
      const pool2 = new ApiKeyPool(tmpDir);
      expect(pool2.getKeys('openai')).toEqual(['sk-b']);
    });
  });
});
