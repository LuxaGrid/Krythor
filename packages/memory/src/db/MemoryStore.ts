import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { applySchema } from './schema.js';
import type {
  MemoryEntry,
  MemoryTag,
  MemoryUsageRecord,
  MemorySource,
  MemoryQuery,
} from '../types.js';

// ─── Row types (raw SQLite rows) ──────────────────────────────────────────────

interface EntryRow {
  id: string;
  title: string;
  content: string;
  scope: string;
  scope_id: string | null;
  source: string;
  importance: number;
  pinned: number;
  created_at: number;
  last_used: number;
  access_count: number;
}

function rowToEntry(row: EntryRow): MemoryEntry {
  return {
    ...row,
    scope: row.scope as MemoryEntry['scope'],
    pinned: row.pinned === 1,
  };
}

// ─── MemoryStore ──────────────────────────────────────────────────────────────

export class MemoryStore {
  private db: Database.Database;

  /**
   * @param dataDir - path to the data directory; a new connection is opened here
   * @param sharedDb - optional pre-existing Database instance to reuse (avoids WAL contention)
   */
  constructor(dataDir: string, sharedDb?: Database.Database) {
    if (sharedDb) {
      this.db = sharedDb;
    } else {
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, 'memory.db');
      this.db = new Database(dbPath);
      applySchema(this.db);
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Entries ────────────────────────────────────────────────────────────────

  insertEntry(entry: MemoryEntry): void {
    this.db.prepare(`
      INSERT INTO memory_entries
        (id, title, content, scope, scope_id, source, importance, pinned, created_at, last_used, access_count)
      VALUES
        (@id, @title, @content, @scope, @scope_id, @source, @importance, @pinned, @created_at, @last_used, @access_count)
    `).run({ ...entry, pinned: entry.pinned ? 1 : 0 });
  }

  updateEntry(id: string, fields: Partial<Pick<MemoryEntry, 'title' | 'content' | 'importance' | 'pinned'>>): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.title !== undefined)      { sets.push('title = @title');           params.title = fields.title; }
    if (fields.content !== undefined)    { sets.push('content = @content');       params.content = fields.content; }
    if (fields.importance !== undefined) { sets.push('importance = @importance'); params.importance = fields.importance; }
    if (fields.pinned !== undefined)     { sets.push('pinned = @pinned');         params.pinned = fields.pinned ? 1 : 0; }

    if (sets.length === 0) return;
    this.db.prepare(`UPDATE memory_entries SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  touchEntry(id: string, now: number): void {
    this.db.prepare(`
      UPDATE memory_entries
      SET last_used = @now, access_count = access_count + 1
      WHERE id = @id
    `).run({ id, now });
  }

  updateImportance(id: string, importance: number): void {
    this.db.prepare(`UPDATE memory_entries SET importance = @importance WHERE id = @id`)
      .run({ id, importance: Math.max(0, Math.min(1, importance)) });
  }

  deleteEntry(id: string): void {
    // CASCADE deletes tags, usage, sources
    this.db.prepare(`DELETE FROM memory_entries WHERE id = @id`).run({ id });
  }

  getEntryById(id: string): MemoryEntry | null {
    const row = this.db.prepare(`SELECT * FROM memory_entries WHERE id = @id`).get({ id }) as EntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  // Find a non-deleted entry by normalized (lowercased) title within the same scope.
  // Used for deduplication — returns the first match or null.
  findByTitle(normalizedTitle: string, scope: string, scopeId: string | null): MemoryEntry | null {
    const row = scopeId !== null
      ? this.db.prepare(`
          SELECT * FROM memory_entries
          WHERE LOWER(title) = @title AND scope = @scope AND scope_id = @scopeId
          LIMIT 1
        `).get({ title: normalizedTitle, scope, scopeId }) as EntryRow | undefined
      : this.db.prepare(`
          SELECT * FROM memory_entries
          WHERE LOWER(title) = @title AND scope = @scope AND scope_id IS NULL
          LIMIT 1
        `).get({ title: normalizedTitle, scope }) as EntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  queryEntries(query: MemoryQuery): MemoryEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.scope) {
      conditions.push('e.scope = @scope');
      params.scope = query.scope;
    }
    if (query.scope_id !== undefined) {
      conditions.push('e.scope_id = @scope_id');
      params.scope_id = query.scope_id;
    }
    if (query.pinned !== undefined) {
      conditions.push('e.pinned = @pinned');
      params.pinned = query.pinned ? 1 : 0;
    }
    if (query.minImportance !== undefined) {
      conditions.push('e.importance >= @minImportance');
      params.minImportance = query.minImportance;
    }
    if (query.text) {
      conditions.push(`(e.title LIKE @text OR e.content LIKE @text)`);
      params.text = `%${query.text}%`;
    }
    if (query.tags && query.tags.length > 0) {
      // entries that have ALL requested tags
      const tagConditions = query.tags.map((t, i) => {
        params[`tag${i}`] = t;
        return `EXISTS (SELECT 1 FROM memory_tags mt WHERE mt.memory_id = e.id AND mt.tag = @tag${i})`;
      });
      conditions.push(`(${tagConditions.join(' AND ')})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT e.* FROM memory_entries e
      ${where}
      ORDER BY e.pinned DESC, e.importance DESC, e.last_used DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset }) as EntryRow[];

    return rows.map(rowToEntry);
  }

  // ── Tags ───────────────────────────────────────────────────────────────────

  insertTag(tag: MemoryTag): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_tags (id, memory_id, tag) VALUES (@id, @memory_id, @tag)
    `).run(tag);
  }

  deleteTagsForEntry(memoryId: string): void {
    this.db.prepare(`DELETE FROM memory_tags WHERE memory_id = @memoryId`).run({ memoryId });
  }

  getTagsForEntry(memoryId: string): string[] {
    const rows = this.db.prepare(`SELECT tag FROM memory_tags WHERE memory_id = @memoryId ORDER BY tag`)
      .all({ memoryId }) as Array<{ tag: string }>;
    return rows.map(r => r.tag);
  }

  // ── Usage ──────────────────────────────────────────────────────────────────

  insertUsage(usage: MemoryUsageRecord): void {
    this.db.prepare(`
      INSERT INTO memory_usage (id, memory_id, task_id, timestamp, reason)
      VALUES (@id, @memory_id, @task_id, @timestamp, @reason)
    `).run(usage);
  }

  getUsageForEntry(memoryId: string, limit = 50): MemoryUsageRecord[] {
    return this.db.prepare(`
      SELECT * FROM memory_usage WHERE memory_id = @memoryId ORDER BY timestamp DESC LIMIT @limit
    `).all({ memoryId, limit }) as MemoryUsageRecord[];
  }

  // ── Sources ────────────────────────────────────────────────────────────────

  insertSource(source: MemorySource): void {
    this.db.prepare(`
      INSERT INTO memory_sources (id, memory_id, source_type, source_reference)
      VALUES (@id, @memory_id, @source_type, @source_reference)
    `).run(source);
  }

  getSourcesForEntry(memoryId: string): MemorySource[] {
    return this.db.prepare(`SELECT * FROM memory_sources WHERE memory_id = @memoryId`)
      .all({ memoryId }) as MemorySource[];
  }

  // ── Bulk ───────────────────────────────────────────────────────────────────

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  getAllEntryCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM memory_entries`).get() as { c: number };
    return row.c;
  }

  clearSessionMemories(): number {
    const stmt = this.db.prepare(`DELETE FROM memory_entries WHERE scope = 'session'`);
    const result = stmt.run();
    return result.changes;
  }

  // Delete the N lowest-importance non-pinned entries (by importance ASC, then last_used ASC).
  // Returns the count of deleted entries.
  pruneLowestImportance(count: number): number {
    if (count <= 0) return 0;
    const result = this.db.prepare(`
      DELETE FROM memory_entries
      WHERE id IN (
        SELECT id FROM memory_entries
        WHERE pinned = 0
        ORDER BY importance ASC, last_used ASC
        LIMIT @count
      )
    `).run({ count });
    return result.changes;
  }

  // Return exact count of non-pinned entries (used to decide if pruning is needed)
  getUnpinnedEntryCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM memory_entries WHERE pinned = 0`).get() as { c: number };
    return row.c;
  }
}
