import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { MemoryStore } from './db/MemoryStore.js';
import { ConversationStore } from './db/ConversationStore.js';
import { AgentRunStore } from './db/AgentRunStore.js';
import { applySchema } from './db/schema.js';
import { MemoryScorer } from './MemoryScorer.js';
import { MemoryWriter } from './MemoryWriter.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { EmbeddingRegistry } from './embedding/EmbeddingProvider.js';
import type {
  CreateMemoryInput,
  UpdateMemoryInput,
  MemoryQuery,
  MemorySearchResult,
  MemoryEntry,
  MemoryUsageRecord,
  MemorySource,
  EmbeddingProvider,
} from './types.js';
import type { WriteResult } from './MemoryWriter.js';

// ─── MemoryEngine ─────────────────────────────────────────────────────────────
//
// Single entry point for the entire memory subsystem.
// Core and Gateway interact only with this class — they never call Store,
// Writer, or Retriever directly.
//

export class MemoryEngine {
  // Default ceiling — prune lowest-importance non-pinned entries beyond this.
  // Can be adjusted at runtime by calling prune(n) directly.
  static readonly MAX_ENTRIES = 10_000;
  readonly store: MemoryStore;
  readonly convStore: ConversationStore;
  readonly agentRunStore: AgentRunStore;
  readonly writer: MemoryWriter;
  readonly retriever: MemoryRetriever;
  readonly scorer: MemoryScorer;
  readonly embeddings: EmbeddingRegistry;
  readonly db: Database.Database;
  private _decayInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string) {
    // Open ONE shared connection for both MemoryStore and ConversationStore to
    // eliminate WAL contention from two separate writers on the same file.
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'memory.db');
    this.db = new Database(dbPath);
    applySchema(this.db);

    this.store = new MemoryStore(dataDir, this.db);
    this.convStore = new ConversationStore(dataDir, this.db);
    this.agentRunStore = new AgentRunStore(this.db);
    this.scorer = new MemoryScorer();
    this.embeddings = new EmbeddingRegistry();
    this.writer = new MemoryWriter(this.store, this.scorer);
    this.retriever = new MemoryRetriever(this.store, this.scorer, this.embeddings);

    // Apply decay and clear session-scoped memories on startup (non-blocking).
    // Session scope is documented as "cleared on session end" — gateway startup
    // is the appropriate point to enforce this contract.
    setImmediate(() => {
      this.store.clearSessionMemories();
      this.writer.applyDecay();
      this.writer.prune(MemoryEngine.MAX_ENTRIES);
    });

    // Re-apply decay and prune every 24 hours so long-running sessions don't bypass it.
    this._decayInterval = setInterval(() => {
      this.writer.applyDecay();
      this.writer.prune(MemoryEngine.MAX_ENTRIES);
    }, 24 * 60 * 60 * 1000);
  }

  // ── Write operations ───────────────────────────────────────────────────────

  create(input: CreateMemoryInput): WriteResult {
    return this.writer.create(input);
  }

  update(id: string, input: UpdateMemoryInput): MemoryEntry {
    return this.writer.update(id, input);
  }

  delete(id: string): void {
    this.writer.delete(id);
  }

  pin(id: string): MemoryEntry {
    return this.writer.pin(id);
  }

  unpin(id: string): MemoryEntry {
    return this.writer.unpin(id);
  }

  recordUse(memoryId: string, taskId: string | null, reason: string): void {
    this.writer.recordUse(memoryId, taskId, reason);
  }

  // Prune non-pinned entries exceeding maxEntries (lowest importance removed first).
  prune(maxEntries = MemoryEngine.MAX_ENTRIES): number {
    return this.writer.prune(maxEntries);
  }

  // ── Read operations ────────────────────────────────────────────────────────

  async search(query: MemoryQuery, taskText?: string): Promise<MemorySearchResult[]> {
    return this.retriever.retrieve({ query, taskText });
  }

  getById(id: string): MemoryEntry | null {
    return this.retriever.getById(id);
  }

  getTagsForEntry(id: string): string[] {
    return this.retriever.getTagsForEntry(id);
  }

  getUsageForEntry(id: string): MemoryUsageRecord[] {
    return this.retriever.getUsageForEntry(id);
  }

  getSourcesForEntry(id: string): MemorySource[] {
    return this.retriever.getSourcesForEntry(id);
  }

  // ── Embedding provider management ─────────────────────────────────────────

  registerEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddings.register(provider);
  }

  setActiveEmbeddingProvider(name: string): void {
    this.embeddings.setActive(name);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats(): { totalEntries: number; embeddingProvider: string } {
    return {
      totalEntries: this.store.getAllEntryCount(),
      embeddingProvider: this.embeddings.getActive().name,
    };
  }

  // ── Embedding provider access for retriever check ─────────────────────────

  getActiveEmbeddingProvider(): EmbeddingProvider {
    return this.embeddings.getActive();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  close(): void {
    if (this._decayInterval) {
      clearInterval(this._decayInterval);
      this._decayInterval = null;
    }
    // Only close the shared db once — both stores reference the same connection
    this.db.close();
  }
}
