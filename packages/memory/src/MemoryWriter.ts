import { randomUUID } from 'crypto';
import type { MemoryStore } from './db/MemoryStore.js';
import type { MemoryScorer } from './MemoryScorer.js';
import type {
  MemoryEntry,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryWriteRisk,
} from './types.js';
import { SCOPE_RISK } from './types.js';

// ─── Write result ─────────────────────────────────────────────────────────────

export interface WriteResult {
  entry: MemoryEntry;
  risk: MemoryWriteRisk;
}

// ─── MemoryWriter ─────────────────────────────────────────────────────────────

export class MemoryWriter {
  constructor(
    private readonly store: MemoryStore,
    private readonly scorer: MemoryScorer,
  ) {}

  // Returns the new entry AND its risk level so the caller (Core/Guard) can
  // decide whether to proceed or prompt the user for confirmation.
  //
  // Deduplication: if an existing non-pinned entry in the same scope already
  // has the same normalized title, update its content + importance instead of
  // inserting a duplicate. The updated entry is returned with risk 'low'.
  // Maximum content length stored per entry — prevents individual entries from
  // flooding the agent system prompt context window at retrieval time.
  static readonly MAX_CONTENT_LENGTH = 50_000;

  create(input: CreateMemoryInput): WriteResult {
    const normalizedTitle = input.title.trim().toLowerCase();
    const content = input.content.trim().slice(0, MemoryWriter.MAX_CONTENT_LENGTH);
    const existing = this.store.findByTitle(normalizedTitle, input.scope, input.scope_id ?? null);
    if (existing && !existing.pinned) {
      // Merge: keep higher importance, update content, reset last_used
      const mergedImportance = Math.max(existing.importance, input.importance ?? 0.5);
      this.store.updateEntry(existing.id, { content, importance: mergedImportance });
      const updated = this.store.getEntryById(existing.id)!;
      return { entry: updated, risk: 'SAFE' };
    }

    const now = Date.now();
    const id = randomUUID();

    const entry: MemoryEntry = {
      id,
      title: input.title.trim(),
      content,
      scope: input.scope,
      scope_id: input.scope_id ?? null,
      source: input.source,
      importance: input.importance ?? 0.5,
      pinned: false,
      created_at: now,
      last_used: now,
      access_count: 0,
    };

    this.store.transaction(() => {
      this.store.insertEntry(entry);

      if (input.tags && input.tags.length > 0) {
        for (const tag of input.tags) {
          this.store.insertTag({ id: randomUUID(), memory_id: id, tag: tag.trim().toLowerCase() });
        }
      }

      if (input.source_type || input.source_reference) {
        this.store.insertSource({
          id: randomUUID(),
          memory_id: id,
          source_type: input.source_type ?? 'unknown',
          source_reference: input.source_reference ?? '',
        });
      }
    });

    return { entry, risk: SCOPE_RISK[input.scope] };
  }

  update(id: string, input: UpdateMemoryInput): MemoryEntry {
    this.store.updateEntry(id, {
      title: input.title,
      content: input.content,
      importance: input.importance,
      pinned: input.pinned,
    });

    if (input.tags !== undefined) {
      this.store.deleteTagsForEntry(id);
      for (const tag of input.tags) {
        this.store.insertTag({ id: randomUUID(), memory_id: id, tag: tag.trim().toLowerCase() });
      }
    }

    const updated = this.store.getEntryById(id);
    if (!updated) throw new Error(`Memory entry ${id} not found after update`);
    return updated;
  }

  delete(id: string): void {
    this.store.deleteEntry(id);
  }

  pin(id: string): MemoryEntry {
    this.store.updateEntry(id, { pinned: true });
    const entry = this.store.getEntryById(id);
    if (!entry) throw new Error(`Memory entry ${id} not found`);
    return entry;
  }

  unpin(id: string): MemoryEntry {
    this.store.updateEntry(id, { pinned: false });
    const entry = this.store.getEntryById(id);
    if (!entry) throw new Error(`Memory entry ${id} not found`);
    return entry;
  }

  // Called when a memory is retrieved and used — boosts importance, updates last_used.
  recordUse(memoryId: string, taskId: string | null, reason: string): void {
    const entry = this.store.getEntryById(memoryId);
    if (!entry) return;

    const now = Date.now();
    this.store.touchEntry(memoryId, now);

    const boosted = this.scorer.boostImportance(entry.importance, entry.pinned);
    if (boosted !== entry.importance) {
      this.store.updateImportance(memoryId, boosted);
    }

    this.store.insertUsage({
      id: randomUUID(),
      memory_id: memoryId,
      task_id: taskId,
      timestamp: now,
      reason,
    });
  }

  // Prune entries that exceed maxEntries (non-pinned only, lowest importance first).
  // Returns the number of entries deleted.
  prune(maxEntries: number): number {
    const total = this.store.getAllEntryCount();
    if (total <= maxEntries) return 0;
    const excess = total - maxEntries;
    return this.store.pruneLowestImportance(excess);
  }

  // Run importance decay across all entries. Called periodically (e.g. on startup).
  applyDecay(): number {
    // We do this in a transaction for atomicity. Returns count of updated entries.
    const now = Date.now();
    let updated = 0;

    // Query all non-pinned entries and recompute importance
    const entries = this.store.queryEntries({ pinned: false, limit: 10000 });
    this.store.transaction(() => {
      for (const entry of entries) {
        const decayed = this.scorer.decayImportance(entry, now);
        if (Math.abs(decayed - entry.importance) > 0.001) {
          this.store.updateImportance(entry.id, decayed);
          updated++;
        }
      }
    });

    return updated;
  }
}
