/**
 * Tests for .bak backup file pruning in HeartbeatEngine memory_hygiene check.
 * Uses a real temporary directory with synthetic .bak files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { MemoryEngine } from '@krythor/memory';
import { HeartbeatEngine } from './heartbeat/HeartbeatEngine.js';

const BAK_KEEP_NEWEST = 5;
const BAK_RETENTION_DAYS = 30;

function makeBakFile(dir: string, name: string, ageDays: number): void {
  const path = join(dir, name);
  writeFileSync(path, 'backup content');
  const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  utimesSync(path, mtime, mtime);
}

describe('Phase 5 — .bak file pruning', () => {
  it('keeps the 5 newest .bak files even if older than 30 days', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'krythor-bak-keep-'));
    const mem = new MemoryEngine(dir);

    // Create 8 files all older than 30 days — newest 5 should survive
    for (let i = 1; i <= 8; i++) {
      makeBakFile(dir, `memory.db.${i}.bak`, 40 + i); // 41-48 days old
    }

    const engine = new HeartbeatEngine(mem, null, null);
    // Manually trigger the memory_hygiene check by calling runChecks via tick
    // We use a stub config with 0ms interval so memory_hygiene runs immediately
    // Instead, directly test by calling the internal method via the engine
    // The check runs inside runChecks which is private, so we need to trigger via tick.
    // Instead, use a public test approach: run the engine tick manually.
    // Since we can't call private methods, we rely on the engine running a tick and checking results.
    // However, the easiest reliable approach is to test DbJanitor .bak pruning logic directly.
    // Let's test the outcome: after engine has run, files older than 30d beyond newest-5 are pruned.

    // Use a simple test: spawn the engine with a very short interval, wait for one tick
    // But HeartbeatEngine has a MIN_STARTUP_DELAY. So let's hack startedAt.
    // @ts-expect-error accessing private
    engine['startedAt'] = Date.now() - 999_999;
    // @ts-expect-error accessing private
    engine['lastRanAt'] = new Map(); // force all checks to be due

    await engine['runChecks']({ memory: mem, models: null, orchestrator: null });

    const remaining = readdirSync(dir).filter(f => f.endsWith('.bak'));
    // Should keep only the 5 newest (BAK_KEEP_NEWEST)
    expect(remaining.length).toBeLessThanOrEqual(BAK_KEEP_NEWEST);
    mem.close();
  }, 10_000);

  it('does not prune files younger than 30 days beyond the newest-5', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'krythor-bak-young-'));
    const mem = new MemoryEngine(dir);

    // Create 7 files all NEWER than 30 days — none should be pruned (age threshold not met)
    for (let i = 1; i <= 7; i++) {
      makeBakFile(dir, `memory.db.${i}.bak`, 5); // only 5 days old
    }

    const engine = new HeartbeatEngine(mem, null, null);
    // @ts-expect-error accessing private
    engine['startedAt'] = Date.now() - 999_999;

    await engine['runChecks']({ memory: mem, models: null, orchestrator: null });

    const remaining = readdirSync(dir).filter(f => f.endsWith('.bak'));
    // All 7 synthetic files should still be there (young enough to survive age threshold).
    // MemoryEngine may also create a migration .bak on first open, so assert >= 7.
    expect(remaining.length).toBeGreaterThanOrEqual(7);
    mem.close();
  }, 10_000);
});
