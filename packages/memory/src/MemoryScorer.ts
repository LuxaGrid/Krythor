import type { MemoryEntry } from './types.js';

// ─── Scoring weights ──────────────────────────────────────────────────────────

const WEIGHT_IMPORTANCE  = 0.40;
const WEIGHT_RECENCY     = 0.30;
const WEIGHT_FREQUENCY   = 0.15;
const WEIGHT_SEMANTIC    = 0.15;

// Decay half-life: importance decays by 50% after this many milliseconds of no use.
const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── MemoryScorer ─────────────────────────────────────────────────────────────

export class MemoryScorer {

  // Compute a relevance score in [0, 1] for a single entry given a query context.
  score(entry: MemoryEntry, options: {
    now: number;
    semanticSimilarity?: number;  // 0–1 from embedding provider, optional
    textMatchScore?: number;      // 0–1 from text search, optional
  }): number {
    const { now, semanticSimilarity = 0, textMatchScore = 0 } = options;

    const importanceScore = entry.pinned ? 1.0 : entry.importance;

    const recencyScore = this.recencyScore(entry.last_used, now);

    const frequencyScore = this.frequencyScore(entry.access_count);

    const contentScore = Math.max(semanticSimilarity, textMatchScore);

    return (
      importanceScore  * WEIGHT_IMPORTANCE +
      recencyScore     * WEIGHT_RECENCY +
      frequencyScore   * WEIGHT_FREQUENCY +
      contentScore     * WEIGHT_SEMANTIC
    );
  }

  // Apply time-based importance decay. Returns new importance value.
  decayImportance(entry: MemoryEntry, now: number): number {
    if (entry.pinned) return entry.importance; // pinned entries never decay

    const ageMs = now - entry.last_used;
    if (ageMs <= 0) return entry.importance;

    // Exponential decay: importance * 0.5^(age / half_life)
    const decayed = entry.importance * Math.pow(0.5, ageMs / DECAY_HALF_LIFE_MS);
    return Math.max(0.01, decayed); // never fully drop to zero
  }

  // Boost importance when an entry is used (called by MemoryWriter on each retrieval use).
  boostImportance(current: number, isPinned: boolean): number {
    if (isPinned) return current;
    return Math.min(1.0, current + 0.05);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private recencyScore(lastUsed: number, now: number): number {
    const ageMs = Math.max(0, now - lastUsed);
    // Score = 1 at age 0, decays toward 0 over 90 days
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    return Math.exp(-ageMs / ninetyDaysMs);
  }

  private frequencyScore(accessCount: number): number {
    // Asymptotic: score approaches 1 as access count grows, saturates around 50
    return 1 - Math.exp(-accessCount / 10);
  }
}
