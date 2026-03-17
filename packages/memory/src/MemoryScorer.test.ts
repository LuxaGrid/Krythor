import { describe, it, expect } from 'vitest';
import { MemoryScorer } from './MemoryScorer.js';
import type { MemoryEntry } from './types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'test-id',
    title: 'Test Entry',
    content: 'Test content',
    scope: 'session',
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

describe('MemoryScorer', () => {
  const scorer = new MemoryScorer();
  const now = Date.now();

  it('returns a score in [0, 1] for a basic entry', () => {
    const entry = makeEntry({ last_used: now, access_count: 0, importance: 0.5 });
    const score = scorer.score(entry, { now });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('pinned entry scores higher than unpinned with same importance', () => {
    const unpinned = makeEntry({ importance: 0.8, pinned: false, last_used: now });
    const pinned   = makeEntry({ importance: 0.8, pinned: true,  last_used: now });
    const s1 = scorer.score(unpinned, { now });
    const s2 = scorer.score(pinned,   { now });
    expect(s2).toBeGreaterThanOrEqual(s1);
  });

  it('recent entry scores higher than old entry (same importance)', () => {
    const recent = makeEntry({ last_used: now,                 importance: 0.5 });
    const old    = makeEntry({ last_used: now - 60 * 24 * 60 * 60 * 1000, importance: 0.5 }); // 60 days ago
    const sr = scorer.score(recent, { now });
    const so = scorer.score(old,    { now });
    expect(sr).toBeGreaterThan(so);
  });

  it('higher access_count gives higher frequency score', () => {
    const low  = makeEntry({ access_count: 0,  last_used: now });
    const high = makeEntry({ access_count: 50, last_used: now });
    const sl = scorer.score(low,  { now });
    const sh = scorer.score(high, { now });
    expect(sh).toBeGreaterThan(sl);
  });

  it('semantic similarity boosts score', () => {
    const entry = makeEntry({ last_used: now, access_count: 0, importance: 0.5 });
    const withoutSemantic = scorer.score(entry, { now, semanticSimilarity: 0 });
    const withSemantic    = scorer.score(entry, { now, semanticSimilarity: 1 });
    expect(withSemantic).toBeGreaterThan(withoutSemantic);
  });

  it('decayImportance never goes to zero for non-pinned entries', () => {
    const entry = makeEntry({ importance: 0.5, pinned: false, last_used: now - 365 * 24 * 60 * 60 * 1000 });
    const decayed = scorer.decayImportance(entry, now);
    expect(decayed).toBeGreaterThan(0);
  });

  it('decayImportance does not change importance for pinned entries', () => {
    const entry = makeEntry({ importance: 0.7, pinned: true, last_used: now - 100 * 24 * 60 * 60 * 1000 });
    const decayed = scorer.decayImportance(entry, now);
    expect(decayed).toBe(0.7);
  });

  it('boostImportance increases importance but caps at 1', () => {
    const boosted = scorer.boostImportance(0.98, false);
    expect(boosted).toBeLessThanOrEqual(1.0);
    expect(boosted).toBeGreaterThan(0.98);
  });

  it('boostImportance does not change pinned importance', () => {
    const boosted = scorer.boostImportance(0.5, true);
    expect(boosted).toBe(0.5);
  });
});
