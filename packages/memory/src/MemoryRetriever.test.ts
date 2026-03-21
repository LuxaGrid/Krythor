/**
 * Tests for MemoryRetriever hybrid text scoring (P2-remaining-2).
 *
 * The scorer is private so we test it through MemoryEngine.search() which
 * invokes retrieve() → textMatchScore() under the hood.
 * We use an in-memory SQLite database via MemoryEngine so no disk I/O occurs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { MemoryEngine } from './MemoryEngine.js';

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
