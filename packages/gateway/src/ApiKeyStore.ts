/**
 * ApiKeyStore — named API keys with scoped permissions and revocation.
 *
 * Keys are stored as SHA-256 hashes in a JSON file. The plaintext key is
 * returned only once at creation time and never stored.
 *
 * Key format: kry_<40 random hex chars>
 *
 * The master KRYTHOR_GATEWAY_TOKEN is NOT managed here — it continues to
 * grant all permissions regardless of this store.
 */

import { createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Permission types ─────────────────────────────────────────────────────────

export type ApiKeyPermission =
  | 'chat'          // POST /api/command
  | 'agents:read'   // GET agents
  | 'agents:write'  // create/update/delete agents
  | 'agents:run'    // run agents
  | 'memory:read'
  | 'memory:write'
  | 'models:read'
  | 'models:infer'
  | 'tools:file'
  | 'tools:shell'
  | 'admin';        // all permissions

export const ALL_PERMISSIONS: ApiKeyPermission[] = [
  'chat', 'agents:read', 'agents:write', 'agents:run',
  'memory:read', 'memory:write', 'models:read', 'models:infer',
  'tools:file', 'tools:shell', 'admin',
];

// ── ApiKey record ────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;    // SHA-256 hex hash of the raw key — never expose
  prefix: string;     // First 12 chars of key for display (e.g. kry_abc12345...)
  permissions: ApiKeyPermission[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number; // undefined = never expires
  active: boolean;
  /** Max requests per minute for this key (undefined = no per-key limit). */
  rateLimit?: number;
  /** Max requests per day for this key (undefined = no daily quota). */
  dailyLimit?: number;
}

// Safe subset for API responses — excludes keyHash
export type ApiKeySafe = Omit<ApiKey, 'keyHash'>;

// ── ApiKeyStore ──────────────────────────────────────────────────────────────

export class ApiKeyStore {
  private readonly filePath: string;
  private keys: ApiKey[] = [];

  constructor(configDir: string) {
    this.filePath = join(configDir, 'api-keys.json');
    this.load();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      this.keys = JSON.parse(raw) as ApiKey[];
    } catch {
      this.keys = [];
    }
  }

  private save(): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.keys, null, 2), 'utf8');
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Create a new API key. Returns the plaintext key exactly once.
   * Caller must present it to the user — it cannot be retrieved again.
   */
  create(
    name: string,
    permissions: ApiKeyPermission[],
    expiresAt?: number,
    rateLimit?: number,
    dailyLimit?: number,
  ): { key: string; entry: ApiKey } {
    const rawKey = `kry_${randomBytes(20).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 12);
    const entry: ApiKey = {
      id: randomBytes(8).toString('hex'),
      name,
      keyHash,
      prefix,
      permissions,
      createdAt: Date.now(),
      expiresAt,
      active: true,
      rateLimit,
      dailyLimit,
    };
    this.keys.push(entry);
    this.save();
    return { key: rawKey, entry };
  }

  /**
   * Validate a raw key. Returns the ApiKey record if valid and active,
   * null if not found, inactive, or expired.
   */
  validate(rawKey: string): ApiKey | null {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const entry = this.keys.find(k => k.keyHash === hash);
    if (!entry) return null;
    if (!entry.active) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
    return entry;
  }

  /** Revoke (deactivate) a key by id. */
  revoke(id: string): void {
    const entry = this.keys.find(k => k.id === id);
    if (entry) {
      entry.active = false;
      this.save();
    }
  }

  /** Update name, permissions, expiry, rateLimit, or dailyLimit on an existing key. */
  update(id: string, updates: {
    name?: string;
    permissions?: ApiKeyPermission[];
    expiresAt?: number | null;
    rateLimit?: number | null;
    dailyLimit?: number | null;
  }): ApiKey | null {
    const entry = this.keys.find(k => k.id === id);
    if (!entry) return null;
    if (updates.name !== undefined) entry.name = updates.name;
    if (updates.permissions !== undefined) entry.permissions = updates.permissions;
    if (updates.expiresAt !== undefined) {
      entry.expiresAt = updates.expiresAt === null ? undefined : updates.expiresAt;
    }
    if (updates.rateLimit !== undefined) {
      entry.rateLimit = updates.rateLimit === null ? undefined : updates.rateLimit;
    }
    if (updates.dailyLimit !== undefined) {
      entry.dailyLimit = updates.dailyLimit === null ? undefined : updates.dailyLimit;
    }
    this.save();
    return entry;
  }

  /** List all keys (safe view — no keyHash). */
  list(): ApiKeySafe[] {
    return this.keys.map(({ keyHash: _kh, ...safe }) => safe);
  }

  /** Update lastUsedAt timestamp for a key. */
  touch(id: string): void {
    const entry = this.keys.find(k => k.id === id);
    if (entry) {
      entry.lastUsedAt = Date.now();
      this.save();
    }
  }

  /** Check if a key has a specific permission. 'admin' grants all. */
  hasPermission(key: ApiKey, permission: ApiKeyPermission): boolean {
    if (key.permissions.includes('admin')) return true;
    return key.permissions.includes(permission);
  }
}
