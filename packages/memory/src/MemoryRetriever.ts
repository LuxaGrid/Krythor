import type { MemoryStore } from './db/MemoryStore.js';
import type { MemoryScorer } from './MemoryScorer.js';
import type { EmbeddingRegistry } from './embedding/EmbeddingProvider.js';
import { EmbeddingCache } from './embedding/EmbeddingCache.js';
import type {
  MemoryEntry,
  MemoryQuery,
  MemorySearchResult,
  MemoryUsageRecord,
  MemorySource,
} from './types.js';

export interface RetrieveOptions {
  query: MemoryQuery;
  taskText?: string;   // used for semantic similarity if embedding available
}

// ─── Temporal decay ───────────────────────────────────────────────────────────

/**
 * Time-based decay multiplier for a memory entry.
 *
 * Pinned entries are exempt (multiplier = 1.0).
 * The decay follows an exponential half-life: score × 2^(-age / HALF_LIFE_MS).
 * Half-life is 90 days — an entry that is 90 days old retains ~50% of its score;
 * one that is 180 days old retains ~25%.
 *
 * The multiplier is clamped to [0.10, 1.0] so very old entries still appear
 * when they are the only relevant result.
 *
 * Set KRYTHOR_MEMORY_NO_DECAY=1 to disable completely.
 */
const DECAY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days in ms

export function temporalDecayMultiplier(entry: import('./types.js').MemoryEntry, now: number): number {
  if (process.env['KRYTHOR_MEMORY_NO_DECAY'] === '1') return 1.0;
  if (entry.pinned) return 1.0;
  const ageMs = Math.max(0, now - entry.created_at);
  const multiplier = Math.pow(2, -ageMs / DECAY_HALF_LIFE_MS);
  // Clamp: never below 0.10 so old entries can still surface
  return Math.max(0.10, Math.min(1.0, multiplier));
}

// ─── MemoryRetriever ──────────────────────────────────────────────────────────

export class MemoryRetriever {
  readonly cache = new EmbeddingCache();

  constructor(
    private readonly store: MemoryStore,
    private readonly scorer: MemoryScorer,
    private readonly embeddings: EmbeddingRegistry,
  ) {}

  async retrieve(options: RetrieveOptions): Promise<MemorySearchResult[]> {
    const { query, taskText } = options;
    const now = Date.now();

    const entries = this.store.queryEntries({ ...query, limit: (query.limit ?? 20) * 3 });
    if (entries.length === 0) return [];

    // Only use embeddings when a real provider is active — the stub produces
    // char-hash pseudo-vectors that add noise rather than signal to scores.
    const provider = this.embeddings.getActive();
    const isStub = !provider || provider.constructor.name === 'StubEmbeddingProvider';

    let queryVector = null;
    if (!isStub && taskText && provider.isAvailable()) {
      try {
        queryVector = await provider.embed(taskText);
      } catch {
        // Embedding failed — fall through to text-only scoring
      }
    }

    const scored: MemorySearchResult[] = await Promise.all(
      entries.map(async (entry) => {
        let semanticSim = 0;

        if (!isStub && queryVector && provider.isAvailable()) {
          try {
            // Check cache before calling the embedding provider — avoids
            // redundant HTTP calls for entries that were recently embedded.
            let entryVector = this.cache.get(entry.id);
            if (!entryVector) {
              entryVector = await provider.embed(`${entry.title} ${entry.content}`);
              this.cache.set(entry.id, entryVector);
            }
            semanticSim = provider.similarity(queryVector, entryVector!);
          } catch {
            semanticSim = 0;
          }
        }
        // When isStub, semanticSim stays 0 so it doesn't pollute the score

        // Prefer taskText for rich scoring (full phrase passed by the caller);
        // fall back to query.text if taskText is absent.
        const scoringText = taskText ?? query.text;
        const textMatchScore = scoringText
          ? this.textMatchScore(entry, scoringText)
          : 0;

        const rawScore = this.scorer.score(entry, { now, semanticSimilarity: semanticSim, textMatchScore });
        // Apply temporal decay when there are enough results to discriminate.
        // When only a few entries are returned we skip decay to avoid burying
        // the only relevant result.  Threshold: >5 entries before decay kicks in.
        const decay = entries.length > 5 ? temporalDecayMultiplier(entry, now) : 1.0;
        return {
          entry,
          tags: this.store.getTagsForEntry(entry.id),
          score: rawScore * decay,
        };
      })
    );

    // Sort by score descending, then trim to requested limit
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, query.limit ?? 20);
  }

  getById(id: string): MemoryEntry | null {
    return this.store.getEntryById(id);
  }

  getTagsForEntry(id: string): string[] {
    return this.store.getTagsForEntry(id);
  }

  getUsageForEntry(id: string): MemoryUsageRecord[] {
    return this.store.getUsageForEntry(id);
  }

  getSourcesForEntry(id: string): MemorySource[] {
    return this.store.getSourcesForEntry(id);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /**
   * BM25-inspired multi-word text match scorer.
   *
   * Scoring tiers:
   *   1.0  — exact phrase match in title
   *   0.85 — exact phrase match in body
   *   0.55–0.75 — all query words present (proportional to coverage; boost for title hits)
   *   0.10–0.40 — partial word coverage (proportional to fraction of query words matched)
   *   0.00 — no words matched
   *
   * When multiple words are in the query, each is checked independently in title
   * and body. Title hits receive a 1.5× term weight bonus (title is more authoritative).
   * Coverage score = weighted hits / weighted total (0–1), scaled to the tier.
   */
  private textMatchScore(entry: MemoryEntry, text: string): number {
    const needle = text.toLowerCase().trim();
    if (!needle) return 0;

    const titleLower   = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();
    const haystack     = `${titleLower} ${contentLower}`;

    // Tier 1: exact phrase in title
    if (titleLower.includes(needle)) return 1.0;

    // Tier 2: exact phrase in body
    if (contentLower.includes(needle)) return 0.85;

    // Tokenise query into individual words (ignore stop-words of length ≤ 2)
    const words = needle.split(/\s+/).filter(w => w.length > 2);
    if (words.length === 0) {
      // All words were stop-words — fall back to simple inclusion check
      return haystack.includes(needle) ? 0.3 : 0;
    }

    // For each query word, check title (weight 1.5) and body (weight 1.0)
    const TITLE_WEIGHT = 1.5;
    let weightedHits   = 0;
    let weightedTotal  = 0;

    for (const word of words) {
      const inTitle   = titleLower.includes(word);
      const inContent = contentLower.includes(word);

      // A word found anywhere counts as a hit; title hit gets the bonus weight
      if (inTitle) {
        weightedHits  += TITLE_WEIGHT;
        weightedTotal += TITLE_WEIGHT;
      } else if (inContent) {
        weightedHits  += 1.0;
        weightedTotal += 1.0;
      } else {
        weightedTotal += 1.0; // miss
      }
    }

    if (weightedTotal === 0) return 0;
    const coverage = weightedHits / weightedTotal; // 0–1

    // Tier 3: all words matched → high confidence partial phrase
    if (coverage >= 1.0) {
      // Scale 0.55–0.75 based on title ratio for tie-breaking
      const titleHits = words.filter(w => titleLower.includes(w)).length / words.length;
      return 0.55 + titleHits * 0.20;
    }

    // Tier 4: partial word coverage → proportional low score
    // Scale 0.05–0.40 so even 1/5 words gives a small signal
    return 0.05 + coverage * 0.35;
  }
}
