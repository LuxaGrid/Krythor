// ─── EmbeddingCache ───────────────────────────────────────────────────────────
//
// In-memory LRU-style cache for embedding vectors.
// Avoids redundant provider calls when the same entry is retrieved in multiple
// consecutive searches (common in agent multi-turn conversations).
//
// Cache key: entry ID (stable, unique per memory entry).
// Invalidation: explicit eviction on entry update or delete.
// TTL: entries older than TTL_MS are treated as stale (belt-and-suspenders).
// Capacity: evicts oldest entry when MAX_SIZE is exceeded.
//

import type { EmbeddingVector } from '../types.js';

const MAX_SIZE  = 2_000;
const TTL_MS    = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  vector: EmbeddingVector;
  cachedAt: number;
}

export class EmbeddingCache {
  private readonly store = new Map<string, CacheEntry>();

  get(id: string): EmbeddingVector | null {
    const entry = this.store.get(id);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      this.store.delete(id);
      return null;
    }
    return entry.vector;
  }

  set(id: string, vector: EmbeddingVector): void {
    // Evict oldest entry when at capacity
    if (this.store.size >= MAX_SIZE && !this.store.has(id)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(id, { vector, cachedAt: Date.now() });
  }

  invalidate(id: string): void {
    this.store.delete(id);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number { return this.store.size; }
}
