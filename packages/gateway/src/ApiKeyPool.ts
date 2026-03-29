/**
 * ApiKeyPool — per-provider API key rotation.
 *
 * Stores one or more API keys per provider and rotates through them in
 * round-robin order. A key is temporarily skipped when it hits a 429 or 401
 * response — it enters a cooldown period before being re-offered.
 *
 * Keys are stored in the same config JSON as the provider, identified by
 * providerId. The primary key from ProviderConfig is always included.
 *
 * This is NOT a replacement for the main ApiKeyStore — that tracks gateway
 * auth tokens. This handles inference provider key rotation.
 *
 * Usage:
 *   const pool = new ApiKeyPool(configDir);
 *   const key = pool.pick(providerId);
 *   if (!key) throw new Error('No available keys for this provider');
 *   // ... use key ...
 *   pool.reportError(providerId, key, 429); // on rate limit
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface PoolEntry {
  providerId: string;
  keys: string[];
  /** Index of the next key to return (round-robin pointer). */
  nextIndex: number;
  /** Keys currently in cooldown: key → timestamp when cooldown expires. */
  cooldowns: Record<string, number>;
}

export interface ApiKeyPoolStats {
  providerId: string;
  totalKeys: number;
  availableKeys: number;
  coolingDown: Array<{ key: string; expiresAt: number; remainingMs: number }>;
}

const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const AUTH_COOLDOWN_MS = 300_000; // 5 minutes for auth errors

export class ApiKeyPool {
  private readonly filePath: string;
  private pools: Map<string, PoolEntry> = new Map();

  constructor(configDir: string) {
    this.filePath = join(configDir, 'key-pools.json');
    this.load();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const entries = JSON.parse(readFileSync(this.filePath, 'utf8')) as PoolEntry[];
      for (const e of entries) {
        this.pools.set(e.providerId, e);
      }
    } catch { /* start fresh */ }
  }

  private save(): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    const entries = Array.from(this.pools.values());
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf8');
  }

  // ── Key management ────────────────────────────────────────────────────────

  getKeys(providerId: string): string[] {
    return [...(this.pools.get(providerId)?.keys ?? [])];
  }

  setKeys(providerId: string, keys: string[]): void {
    const existing = this.pools.get(providerId);
    const deduped = [...new Set(keys.filter(k => k.trim().length > 0))];
    if (existing) {
      existing.keys = deduped;
      existing.nextIndex = 0;
      existing.cooldowns = {};
    } else {
      this.pools.set(providerId, { providerId, keys: deduped, nextIndex: 0, cooldowns: {} });
    }
    this.save();
  }

  addKey(providerId: string, key: string): void {
    if (!key.trim()) return;
    const existing = this.pools.get(providerId);
    if (existing) {
      if (!existing.keys.includes(key)) {
        existing.keys.push(key);
        this.save();
      }
    } else {
      this.pools.set(providerId, { providerId, keys: [key], nextIndex: 0, cooldowns: {} });
      this.save();
    }
  }

  removeKey(providerId: string, key: string): void {
    const pool = this.pools.get(providerId);
    if (!pool) return;
    pool.keys = pool.keys.filter(k => k !== key);
    delete pool.cooldowns[key];
    if (pool.nextIndex >= pool.keys.length) pool.nextIndex = 0;
    if (pool.keys.length === 0) this.pools.delete(providerId);
    this.save();
  }

  removeProvider(providerId: string): void {
    this.pools.delete(providerId);
    this.save();
  }

  // ── Key selection ─────────────────────────────────────────────────────────

  /**
   * Pick the next available key for a provider using round-robin.
   * Returns undefined when no keys are configured or all are in cooldown.
   */
  pick(providerId: string): string | undefined {
    const pool = this.pools.get(providerId);
    if (!pool || pool.keys.length === 0) return undefined;

    const now = Date.now();
    const available = pool.keys.filter(k => {
      const exp = pool.cooldowns[k];
      return !exp || exp <= now;
    });

    if (available.length === 0) return undefined;

    // Advance the pointer to the next available key
    let idx = pool.nextIndex % pool.keys.length;
    for (let i = 0; i < pool.keys.length; i++) {
      const key = pool.keys[idx]!;
      const exp = pool.cooldowns[key];
      if (!exp || exp <= now) {
        pool.nextIndex = (idx + 1) % pool.keys.length;
        return key;
      }
      idx = (idx + 1) % pool.keys.length;
    }

    return undefined;
  }

  /**
   * Report an error for a specific key, triggering a cooldown.
   * status 429 = rate limit; status 401/403 = auth error.
   */
  reportError(providerId: string, key: string, status: number): void {
    const pool = this.pools.get(providerId);
    if (!pool) return;
    const cooldownMs = (status === 401 || status === 403)
      ? AUTH_COOLDOWN_MS
      : (status === 429 ? RATE_LIMIT_COOLDOWN_MS : DEFAULT_COOLDOWN_MS);
    pool.cooldowns[key] = Date.now() + cooldownMs;
  }

  /** Clear cooldown for a specific key. */
  clearCooldown(providerId: string, key: string): void {
    const pool = this.pools.get(providerId);
    if (!pool) return;
    delete pool.cooldowns[key];
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats(providerId: string): ApiKeyPoolStats | null {
    const pool = this.pools.get(providerId);
    if (!pool) return null;
    const now = Date.now();
    const coolingDown = Object.entries(pool.cooldowns)
      .filter(([, exp]) => exp > now)
      .map(([key, exp]) => ({ key, expiresAt: exp, remainingMs: exp - now }));

    return {
      providerId,
      totalKeys: pool.keys.length,
      availableKeys: pool.keys.length - coolingDown.length,
      coolingDown,
    };
  }

  allStats(): ApiKeyPoolStats[] {
    return Array.from(this.pools.keys()).map(id => this.stats(id)!);
  }

  list(): Array<{ providerId: string; keyCount: number }> {
    return Array.from(this.pools.values()).map(p => ({
      providerId: p.providerId,
      keyCount: p.keys.length,
    }));
  }
}
