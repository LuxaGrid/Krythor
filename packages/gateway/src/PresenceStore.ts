// ─── PresenceStore ────────────────────────────────────────────────────────────
//
// Lightweight in-memory registry of connected clients and nodes.
// Each entry is keyed by instanceId (client-generated UUID or the gateway's
// own instanceId). Entries expire after a configurable TTL and the store is
// pruned to a maximum size.
//
// Producers:
//   - Gateway self-entry: upserted at startup with mode = 'gateway'
//   - WS clients: upserted on handshake with mode = 'control' | 'cli'
//   - Node connections: upserted on connect with mode = 'node'
//   - System-event beacons: periodic heartbeats from connected clients
//
// Usage:
//   const store = new PresenceStore({ ttlMs: 5 * 60_000, maxEntries: 200 });
//   store.upsert('client-abc', { host: 'desktop', version: '0.5.0', mode: 'control' });
//   const all = store.list();
//   store.prune(); // remove stale entries
//

export type PresenceMode = 'gateway' | 'control' | 'cli' | 'node' | 'device';

export interface PresenceEntry {
  instanceId: string;
  host?: string;
  ip?: string;
  version?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode: PresenceMode;
  /** Seconds since last user input (set by clients sending beacons). */
  lastInputSeconds?: number;
  /** Reason the client is in a particular state (e.g. 'thinking', 'idle'). */
  reason?: string;
  /** Timestamp of last upsert. */
  ts: number;
}

export interface PresenceStoreOptions {
  /** Entry TTL in ms. Entries not refreshed within this window are pruned. Default: 300 000 (5 min). */
  ttlMs?: number;
  /** Maximum number of entries. Oldest entries are evicted when exceeded. Default: 200. */
  maxEntries?: number;
}

export class PresenceStore {
  private readonly entries = new Map<string, PresenceEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: PresenceStoreOptions = {}) {
    this.ttlMs     = options.ttlMs     ?? 300_000;
    this.maxEntries = options.maxEntries ?? 200;
  }

  /**
   * Upsert (merge) an entry for the given instanceId.
   * Existing fields are preserved unless overridden by the new partial.
   */
  upsert(instanceId: string, partial: Partial<Omit<PresenceEntry, 'instanceId' | 'ts'>>): void {
    const existing = this.entries.get(instanceId);
    const entry: PresenceEntry = {
      mode: 'control',
      ...existing,
      ...partial,
      instanceId,
      ts: Date.now(),
    };
    this.entries.set(instanceId, entry);

    // Evict oldest entry if over capacity
    if (this.entries.size > this.maxEntries) {
      let oldest: string | undefined;
      let oldestTs = Infinity;
      for (const [key, val] of this.entries) {
        if (val.ts < oldestTs) { oldestTs = val.ts; oldest = key; }
      }
      if (oldest) this.entries.delete(oldest);
    }
  }

  /**
   * Remove a specific entry (e.g. on WS disconnect).
   */
  remove(instanceId: string): void {
    this.entries.delete(instanceId);
  }

  /**
   * Return all non-stale entries.
   * Automatically prunes stale entries before returning.
   */
  list(): PresenceEntry[] {
    this.prune();
    return [...this.entries.values()];
  }

  /** Get a single entry by instanceId. Returns undefined if not present or stale. */
  get(instanceId: string): PresenceEntry | undefined {
    const entry = this.entries.get(instanceId);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.entries.delete(instanceId);
      return undefined;
    }
    return entry;
  }

  /** Remove entries older than ttlMs. */
  prune(): number {
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.ts < cutoff) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Total number of entries (including potentially stale ones). */
  get size(): number {
    return this.entries.size;
  }
}
