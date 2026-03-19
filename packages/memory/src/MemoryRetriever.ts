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

        const textMatchScore = query.text
          ? this.textMatchScore(entry, query.text)
          : 0;

        return {
          entry,
          tags: this.store.getTagsForEntry(entry.id),
          score: this.scorer.score(entry, { now, semanticSimilarity: semanticSim, textMatchScore }),
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

  private textMatchScore(entry: MemoryEntry, text: string): number {
    const needle = text.toLowerCase();
    const haystack = `${entry.title} ${entry.content}`.toLowerCase();

    if (entry.title.toLowerCase().includes(needle)) return 1.0;
    if (haystack.includes(needle)) return 0.6;

    // Word-level partial match
    const words = needle.split(/\s+/).filter(Boolean);
    const matches = words.filter(w => haystack.includes(w)).length;
    return words.length > 0 ? matches / words.length * 0.4 : 0;
  }
}
