// ─── AgentAuthProfileStore ────────────────────────────────────────────────────
//
// Persists per-agent OAuth/token credential profiles to:
//   <baseDir>/agents/<agentId>/auth-profiles.json
//
// A profile stores the tokens an agent has obtained for a named external
// service (e.g. 'github', 'google', 'notion'). The store handles read/write
// of the JSON file and token expiry checks.
//
// Tokens are stored as-is — the caller is responsible for PKCE exchange and
// refresh logic (see OAuthManager in gateway).
//

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthProfile {
  /** Logical name for this credential (e.g. 'github', 'notion', 'google'). */
  name: string;
  /** OAuth access token. */
  accessToken: string;
  /** OAuth refresh token (optional — not all flows issue one). */
  refreshToken?: string;
  /** Unix seconds timestamp when the access token expires (0 = no expiry). */
  expiresAt: number;
  /** Human-readable label for the connected account. */
  displayName?: string;
  /** When this profile was created/updated (ISO string). */
  connectedAt: string;
  /** Arbitrary extra metadata (scopes, endpoint, etc.). */
  meta?: Record<string, unknown>;
}

export interface AgentAuthProfiles {
  agentId: string;
  profiles: AuthProfile[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class AgentAuthProfileStore {
  constructor(private readonly baseDir: string) {}

  private filePath(agentId: string): string {
    return join(this.baseDir, 'agents', agentId, 'auth-profiles.json');
  }

  private ensureDir(agentId: string): void {
    mkdirSync(join(this.baseDir, 'agents', agentId), { recursive: true });
  }

  /** Load all profiles for an agent. Returns empty list if file missing. */
  load(agentId: string): AgentAuthProfiles {
    const filePath = this.filePath(agentId);
    if (!existsSync(filePath)) {
      return { agentId, profiles: [] };
    }
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { agentId?: string; profiles?: AuthProfile[] };
      return {
        agentId,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      };
    } catch {
      return { agentId, profiles: [] };
    }
  }

  /** Get a single profile by name. Returns null if not found. */
  get(agentId: string, name: string): AuthProfile | null {
    const { profiles } = this.load(agentId);
    return profiles.find(p => p.name === name) ?? null;
  }

  /** True if the profile exists and has a non-expired access token. */
  isValid(agentId: string, name: string): boolean {
    const profile = this.get(agentId, name);
    if (!profile) return false;
    if (profile.expiresAt === 0) return true; // no expiry
    return Math.floor(Date.now() / 1000) < profile.expiresAt;
  }

  /** Upsert a profile (add or replace by name). */
  upsert(agentId: string, profile: AuthProfile): void {
    this.ensureDir(agentId);
    const existing = this.load(agentId);
    const idx = existing.profiles.findIndex(p => p.name === profile.name);
    if (idx >= 0) {
      existing.profiles[idx] = profile;
    } else {
      existing.profiles.push(profile);
    }
    writeFileSync(this.filePath(agentId), JSON.stringify(existing, null, 2), 'utf-8');
  }

  /** Remove a profile by name. No-op if not found. */
  remove(agentId: string, name: string): void {
    const existing = this.load(agentId);
    const filtered = existing.profiles.filter(p => p.name !== name);
    if (filtered.length === existing.profiles.length) return; // nothing removed
    this.ensureDir(agentId);
    writeFileSync(this.filePath(agentId), JSON.stringify({ agentId, profiles: filtered }, null, 2), 'utf-8');
  }

  /** Remove all profiles for an agent. */
  clear(agentId: string): void {
    this.ensureDir(agentId);
    writeFileSync(this.filePath(agentId), JSON.stringify({ agentId, profiles: [] }, null, 2), 'utf-8');
  }
}
