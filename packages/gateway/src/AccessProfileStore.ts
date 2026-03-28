import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AuditStore as AuditStoreType } from '@krythor/memory';

// ─── Access Profile Store ─────────────────────────────────────────────────────
//
// Persists per-agent access profiles to <configDir>/access-profiles.json.
// Profiles control what filesystem paths an agent is allowed to access:
//
//   safe         — restricted to process.cwd()/workspace only
//   standard     — workspace + any non-system paths
//   full_access  — unrestricted (all paths allowed)
//
// Audit log is an in-memory ring buffer (last 500 entries) that is also
// appended line-by-line to <configDir>/file-audit.log for off-process tailing.
//

export type AccessProfile = 'safe' | 'standard' | 'full_access';

export interface AuditEntry {
  id: string;
  ts: number;
  agentId: string;
  operation: string;
  path: string;
  profile: AccessProfile;
  allowed: boolean;
  reason?: string;
}

const AUDIT_RING_LIMIT = 500;
const PROFILES_FILE = 'access-profiles.json';
const AUDIT_LOG_FILE = 'file-audit.log';

export class AccessProfileStore {
  private configDir: string;
  private profilesPath: string;
  private auditLogPath: string;
  private profiles: Record<string, AccessProfile> = {};
  private auditRing: AuditEntry[] = [];
  private auditStore?: AuditStoreType;

  constructor(configDir: string, auditStore?: AuditStoreType) {
    this.configDir = configDir;
    this.profilesPath = join(configDir, PROFILES_FILE);
    this.auditLogPath = join(configDir, AUDIT_LOG_FILE);
    this.auditStore = auditStore;
    this._ensureDir();
    this._load();
  }

  // ── Profile operations ───────────────────────────────────────────────────

  /** Returns the access profile for an agent. Defaults to 'safe' if not set. */
  getProfile(agentId: string): AccessProfile {
    return this.profiles[agentId] ?? 'safe';
  }

  /** Sets the access profile for an agent and persists immediately. */
  setProfile(agentId: string, profile: AccessProfile): void {
    this.profiles[agentId] = profile;
    this._persist();
  }

  /** Returns a snapshot of all configured profiles. */
  listProfiles(): Record<string, AccessProfile> {
    return { ...this.profiles };
  }

  // ── Audit log operations ─────────────────────────────────────────────────

  /** Appends an audit entry to the ring buffer, flushes to disk, and persists to SQLite if configured. */
  logAudit(entry: AuditEntry): void {
    this.auditRing.push(entry);
    // Trim to ring limit — remove oldest entries when over capacity
    if (this.auditRing.length > AUDIT_RING_LIMIT) {
      this.auditRing.splice(0, this.auditRing.length - AUDIT_RING_LIMIT);
    }
    // Flush to disk — one JSON line per entry, non-fatal if it fails
    try {
      appendFileSync(this.auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch { /* non-fatal */ }
    // Persist to SQLite if an AuditStore is wired in
    if (this.auditStore) {
      try {
        this.auditStore.insert({
          id:        entry.id,
          agentId:   entry.agentId,
          operation: entry.operation,
          target:    entry.path,
          profile:   entry.profile,
          allowed:   entry.allowed,
          reason:    entry.reason,
          timestamp: entry.ts,
        });
      } catch { /* non-fatal — ring buffer is the fallback */ }
    }
  }

  /** Returns the most recent audit entries (default: all up to ring limit). */
  getAuditLog(limit = AUDIT_RING_LIMIT): AuditEntry[] {
    const n = Math.max(1, Math.min(limit, AUDIT_RING_LIMIT));
    return this.auditRing.slice(-n);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _ensureDir(): void {
    try {
      mkdirSync(this.configDir, { recursive: true });
    } catch { /* already exists or non-fatal */ }
  }

  private _load(): void {
    try {
      const raw = readFileSync(this.profilesPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const validProfiles = new Set<AccessProfile>(['safe', 'standard', 'full_access']);
      for (const [agentId, profile] of Object.entries(parsed)) {
        if (validProfiles.has(profile as AccessProfile)) {
          this.profiles[agentId] = profile as AccessProfile;
        }
      }
    } catch {
      // File not found or malformed — start with empty profiles (defaults to safe)
      this.profiles = {};
    }
  }

  private _persist(): void {
    try {
      writeFileSync(this.profilesPath, JSON.stringify(this.profiles, null, 2) + '\n', 'utf-8');
    } catch { /* non-fatal */ }
  }
}

// ── Audit entry factory ───────────────────────────────────────────────────────

/** Builds a fully-populated AuditEntry. */
export function makeAuditEntry(
  agentId: string,
  operation: string,
  path: string,
  profile: AccessProfile,
  allowed: boolean,
  reason?: string,
): AuditEntry {
  return {
    id:        randomUUID(),
    ts:        Date.now(),
    agentId,
    operation,
    path,
    profile,
    allowed,
    ...(reason !== undefined ? { reason } : {}),
  };
}
