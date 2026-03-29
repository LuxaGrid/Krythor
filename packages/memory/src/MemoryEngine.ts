import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { MemoryStore } from './db/MemoryStore.js';
import { ConversationStore } from './db/ConversationStore.js';
import { AgentRunStore } from './db/AgentRunStore.js';
import { LearningRecordStore } from './db/LearningRecordStore.js';
import { applySchema } from './db/schema.js';
import { MemoryScorer } from './MemoryScorer.js';
import { MemoryWriter } from './MemoryWriter.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { EmbeddingRegistry } from './embedding/EmbeddingProvider.js';
import { DbJanitor } from './db/DbJanitor.js';
import type { JanitorResult, LogFn, DbJanitorConfig } from './db/DbJanitor.js';
import { HeartbeatInsightStore } from './db/HeartbeatInsightStore.js';
import { SessionStore } from './db/SessionStore.js';
import { KnowledgeStore } from './db/KnowledgeStore.js';
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
  readonly learningStore: LearningRecordStore;
  readonly writer: MemoryWriter;
  readonly retriever: MemoryRetriever;
  readonly scorer: MemoryScorer;
  readonly embeddings: EmbeddingRegistry;
  readonly db: Database.Database;
  readonly janitor: DbJanitor;
  readonly heartbeatInsightStore: HeartbeatInsightStore;
  readonly sessionStore: SessionStore;
  readonly knowledgeStore: KnowledgeStore;
  /** Directory containing memory.db and any .bak backup files. */
  readonly dbDir: string;
  private _decayInterval: ReturnType<typeof setInterval> | null = null;
  private _startupImmediate: ReturnType<typeof setImmediate> | null = null;

  constructor(dataDir: string, logFn?: LogFn) {
    // Open ONE shared connection for both MemoryStore and ConversationStore to
    // eliminate WAL contention from two separate writers on the same file.
    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'memory.db');
    this.dbDir = dataDir;
    this.db = new Database(dbPath);
    applySchema(this.db, dbPath);

    this.store = new MemoryStore(dataDir, this.db);
    this.convStore = new ConversationStore(dataDir, this.db);
    this.agentRunStore = new AgentRunStore(this.db);
    this.learningStore = new LearningRecordStore(this.db);
    this.scorer = new MemoryScorer();
    this.embeddings = new EmbeddingRegistry();
    this.writer = new MemoryWriter(this.store, this.scorer);
    this.retriever = new MemoryRetriever(this.store, this.scorer, this.embeddings);
    this.janitor = new DbJanitor(this.db, logFn);
    this.heartbeatInsightStore = new HeartbeatInsightStore(this.db);
    this.sessionStore = new SessionStore(this.db);
    this.knowledgeStore = new KnowledgeStore(this.db);

    // Apply decay, clear session-scoped memories, and run retention janitor on
    // startup (non-blocking). Session scope is documented as "cleared on session
    // end" — gateway startup is the appropriate point to enforce this contract.
    this._startupImmediate = setImmediate(() => {
      this._startupImmediate = null;
      this.store.clearSessionMemories();
      this.writer.applyDecay();
      this.writer.prune(MemoryEngine.MAX_ENTRIES);
      this.janitor.run();
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
    const result = this.writer.update(id, input);
    // Invalidate cached embedding — content may have changed
    this.retriever.cache.invalidate(id);
    return result;
  }

  delete(id: string): void {
    this.writer.delete(id);
    this.retriever.cache.invalidate(id);
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

  // Run the full retention janitor — safe to call from heartbeat or on demand.
  runJanitor(): JanitorResult {
    return this.janitor.run();
  }

  /**
   * Update janitor retention config (e.g. after user changes app-config.json).
   * Changes take effect on the next janitor run.
   */
  setJanitorConfig(config: DbJanitorConfig): void {
    this.janitor.setConfig(config);
  }

  /**
   * Run compaction pass only — summarize older sessions without a full janitor run.
   * Safe to call on demand from maintenance windows or the heartbeat.
   */
  compactSessions(): { compacted: number; rawPruned: number } {
    return this.janitor.compact();
  }

  /**
   * Dry-run maintenance estimate — returns what would be pruned without mutating.
   */
  dryRunMaintenance(): { wouldPruneByAge: number; wouldPruneByCount: number; currentCount: number } {
    return this.janitor.dryRunConversations();
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

  stats(): { totalEntries: number; entryCount: number; embeddingProvider: string; embeddingDegraded: boolean } {
    const count = this.store.getAllEntryCount();
    return {
      totalEntries: count,
      entryCount:   count,
      embeddingProvider: this.embeddings.getActive().name,
      embeddingDegraded: this.embeddingStatus().degraded,
    };
  }

  // ── Embedding provider access for retriever check ─────────────────────────

  getActiveEmbeddingProvider(): EmbeddingProvider {
    return this.embeddings.getActive();
  }

  /**
   * Returns whether the active embedding provider is semantically capable
   * (i.e. NOT the stub/hash-based fallback).
   * Used to surface degraded search status to the UI without spamming.
   */
  embeddingStatus(): { semantic: boolean; providerName: string; degraded: boolean } {
    const provider = this.embeddings.getActive();
    const isSemantic = provider.name !== 'stub' && provider.isAvailable();
    return {
      semantic:     isSemantic,
      providerName: provider.name,
      degraded:     !isSemantic,
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  close(): void {
    if (this._startupImmediate) {
      clearImmediate(this._startupImmediate);
      this._startupImmediate = null;
    }
    if (this._decayInterval) {
      clearInterval(this._decayInterval);
      this._decayInterval = null;
    }
    // Only close the shared db once — both stores reference the same connection
    this.db.close();
  }
}
