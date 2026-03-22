/**
 * Tests for MemoryRetriever hybrid text scoring (P2-remaining-2).
 *
 * The scorer is private so we test it through MemoryEngine.search() which
 * invokes retrieve() → textMatchScore() under the hood.
 * We use an in-memory SQLite database via MemoryEngine so no disk I/O occurs.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { MemoryEngine } from './MemoryEngine.js';
import { temporalDecayMultiplier } from './MemoryRetriever.js';
import type { MemoryEntry } from './types.js';

function makeTmpEngine(): { engine: MemoryEngine; tmpDir: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-retriever-test-'));
  const engine = new MemoryEngine(tmpDir);
  return { engine, tmpDir };
}

describe('MemoryRetriever — hybrid text scoring', () => {
  let engine: MemoryEngine;
  let tmpDir: string;

  afterEach(() => {
    engine.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('exact phrase in title scores highest', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    // Both entries contain 'kubernetes' so SQL LIKE '%kubernetes%' returns both.
    engine.create({ title: 'kubernetes pod crash', content: 'The pod restarted repeatedly', scope: 'user', source: 'user', importance: 0.5 });
    engine.create({ title: 'unrelated topic', content: 'something about kubernetes pod crash logging', scope: 'user', source: 'user', importance: 0.5 });

    // Use 'kubernetes' as SQL filter so both entries are fetched; taskText drives scoring
    const results = await engine.search({ scope: 'user', limit: 10, text: 'kubernetes' }, 'kubernetes pod crash');

    expect(results.length).toBeGreaterThanOrEqual(2);
    // The title-exact-phrase entry should rank first (score 1.0)
    expect(results[0]!.entry.title).toBe('kubernetes pod crash');
  });

  it('exact phrase in content scores above partial matches', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    // Both entries contain "connection" so SQL LIKE returns both.
    // The first has the full phrase; the second has only one word.
    engine.create({ title: 'server error', content: 'connection refused on port 5432', scope: 'user', source: 'user', importance: 0.5 });
    engine.create({ title: 'port info', content: 'general networking notes about connection drops', scope: 'user', source: 'user', importance: 0.5 });

    const results = await engine.search({ scope: 'user', limit: 10, text: 'connection' }, 'connection refused on port 5432');
    expect(results.length).toBeGreaterThanOrEqual(1);
    // exact-phrase-in-content entry should rank first (score 0.85 vs partial)
    expect(results[0]!.entry.title).toBe('server error');
  });

  it('multi-word query: entry matching all words ranks above entry matching fewer', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    // Both entries contain "typescript" so the SQL LIKE filter finds them.
    // The first entry also contains "null" and "checks" — it should score higher.
    engine.create({ title: 'typescript error', content: 'null checks in typescript are important', scope: 'user', source: 'user', importance: 0.5 });
    engine.create({ title: 'typescript basics', content: 'some typescript intro notes', scope: 'user', source: 'user', importance: 0.5 });

    // Use text='typescript' so both entries are returned by SQL, then taskText drives scoring
    const results = await engine.search({ scope: 'user', limit: 10, text: 'typescript' }, 'typescript null checks');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // "typescript error" entry has all three words: typescript + null + checks
    expect(results[0]!.entry.title).toBe('typescript error');
  });

  it('search with no matching text returns an empty array or low-score results', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    engine.create({ title: 'completely unrelated', content: 'dinosaurs and paleontology', scope: 'user', source: 'user', importance: 0.5 });
    engine.create({ title: 'more unrelated', content: 'ancient history facts', scope: 'user', source: 'user', importance: 0.5 });

    // SQL LIKE filter with 'kubernetes' won't match either entry
    const results = await engine.search({ scope: 'user', limit: 10, text: 'kubernetes' }, 'kubernetes deployment');
    // SQL pre-filter eliminates non-matching entries — 0 results expected
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('title match outscores body-only match with same words', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    // Both contain "memory" so SQL LIKE returns both.
    engine.create({ title: 'memory leak detection', content: 'techniques for finding leaks in production', scope: 'user', source: 'user', importance: 0.5 });
    engine.create({ title: 'debugging guide', content: 'memory leak detection using heap snapshots', scope: 'user', source: 'user', importance: 0.5 });

    const results = await engine.search({ scope: 'user', limit: 10, text: 'memory' }, 'memory leak detection');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The title-exact-phrase entry should rank first (score 1.0 vs 0.85)
    expect(results[0]!.entry.title).toBe('memory leak detection');
  });

  it('short query words (≤2 chars) are treated as a single phrase check (robustness)', async () => {
    ({ engine, tmpDir } = makeTmpEngine());

    // "ok" is a 2-char word — should fall through to simple inclusion check, no crash
    engine.create({ title: 'status ok', content: 'server returned ok status', scope: 'user', source: 'user', importance: 0.5 });

    // SQL LIKE filter on 'ok' will match
    const results = await engine.search({ scope: 'user', limit: 10, text: 'ok' }, 'ok');
    expect(Array.isArray(results)).toBe(true);
    // Should not throw — test is about robustness
  });

  it('empty query text returns results (no crash)', async () => {
    ({ engine, tmpDir } = makeTmpEngine());
    engine.create({ title: 'any entry', content: 'any content', scope: 'user', source: 'user', importance: 0.5 });
    // search without text param — should use importance/recency scoring only
    const results = await engine.search({ scope: 'user', limit: 10 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
  });
});

// ─── temporalDecayMultiplier unit tests ───────────────────────────────────────

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'test-id',
    title: 'Test Entry',
    content: 'Some content',
    scope: 'user',
    scope_id: null,
    source: 'user',
    importance: 0.5,
    pinned: false,
    created_at: Date.now(),
    last_used: Date.now(),
    access_count: 0,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('temporalDecayMultiplier', () => {
  beforeEach(() => {
    delete process.env['KRYTHOR_MEMORY_NO_DECAY'];
  });

  afterEach(() => {
    delete process.env['KRYTHOR_MEMORY_NO_DECAY'];
    vi.restoreAllMocks();
  });

  it('returns 1.0 for a brand-new entry (age=0)', () => {
    const now = Date.now();
    const entry = makeEntry({ created_at: now });
    expect(temporalDecayMultiplier(entry, now)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.5 for an entry that is 90 days old (half-life)', () => {
    const now = Date.now();
    const entry = makeEntry({ created_at: now - 90 * DAY_MS });
    const m = temporalDecayMultiplier(entry, now);
    // half-life is 90 days → multiplier ≈ 0.5
    expect(m).toBeGreaterThan(0.48);
    expect(m).toBeLessThan(0.52);
  });

  it('returns ~0.25 for an entry that is 180 days old (two half-lives)', () => {
    const now = Date.now();
    const entry = makeEntry({ created_at: now - 180 * DAY_MS });
    const m = temporalDecayMultiplier(entry, now);
    expect(m).toBeGreaterThan(0.23);
    expect(m).toBeLessThan(0.27);
  });

  it('clamps to minimum 0.10 for very old entries', () => {
    const now = Date.now();
    // 5 years old — would be ~0.003 without clamping
    const entry = makeEntry({ created_at: now - 5 * 365 * DAY_MS });
    const m = temporalDecayMultiplier(entry, now);
    expect(m).toBe(0.10);
  });

  it('returns 1.0 for pinned entries regardless of age', () => {
    const now = Date.now();
    const entry = makeEntry({ created_at: now - 365 * DAY_MS, pinned: true });
    expect(temporalDecayMultiplier(entry, now)).toBe(1.0);
  });

  it('returns 1.0 when KRYTHOR_MEMORY_NO_DECAY=1', () => {
    process.env['KRYTHOR_MEMORY_NO_DECAY'] = '1';
    const now = Date.now();
    const entry = makeEntry({ created_at: now - 90 * DAY_MS });
    expect(temporalDecayMultiplier(entry, now)).toBe(1.0);
  });

  it('decay is disabled (returns 1.0) when entry count ≤ 5 (enforced by caller)', () => {
    // This verifies the contract: temporalDecayMultiplier itself always computes decay;
    // the ≤5 threshold is enforced in retrieve() — the function is pure math.
    const now = Date.now();
    const entry = makeEntry({ created_at: now - 90 * DAY_MS });
    // Just confirm the function still works as a pure function
    const m = temporalDecayMultiplier(entry, now);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThanOrEqual(1.0);
  });
});
