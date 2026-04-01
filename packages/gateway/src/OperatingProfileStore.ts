import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

/** Raw SQLite row shape for the operating_profiles table. */
interface ProfileRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  is_default: number;
  enabled_providers: string | null;
  enabled_skills: string | null;
  enabled_tools: string | null;
  fallback_chain_id: string | null;
  privacy_mode: string;
  restrictions: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/** Raw SQLite row shape for the active_profiles table. */
interface ActiveProfileRow {
  profile_id: string;
}

export interface OperatingProfile {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault: boolean;
  enabledProviders?: string[];  // undefined = all allowed
  enabledSkills?: string[];     // undefined = all allowed
  enabledTools?: string[];      // undefined = all allowed
  fallbackChainId?: string;
  privacyMode: 'local_only' | 'standard' | 'unrestricted';
  restrictions?: { maxTokensPerRequest?: number; disallowedOperations?: string[] };
  status: 'active' | 'inactive';
  createdAt: number;
  updatedAt: number;
}

export interface CreateProfileInput {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  enabledProviders?: string[];
  enabledSkills?: string[];
  enabledTools?: string[];
  fallbackChainId?: string;
  privacyMode?: 'local_only' | 'standard' | 'unrestricted';
  restrictions?: Record<string, unknown>;
}

export class OperatingProfileStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateProfileInput): OperatingProfile {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO operating_profiles
        (id, name, slug, description, icon, color, is_default, enabled_providers, enabled_skills, enabled_tools, fallback_chain_id, privacy_mode, restrictions, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      input.name,
      input.slug,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? null,
      input.isDefault ? 1 : 0,
      input.enabledProviders ? JSON.stringify(input.enabledProviders) : null,
      input.enabledSkills ? JSON.stringify(input.enabledSkills) : null,
      input.enabledTools ? JSON.stringify(input.enabledTools) : null,
      input.fallbackChainId ?? null,
      input.privacyMode ?? 'standard',
      input.restrictions ? JSON.stringify(input.restrictions) : null,
      now,
      now,
    );
    return this.getById(id)!;
  }

  getById(id: string): OperatingProfile | null {
    const row = this.db.prepare(`SELECT * FROM operating_profiles WHERE id = ?`).get(id) as ProfileRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  getBySlug(slug: string): OperatingProfile | null {
    const row = this.db.prepare(`SELECT * FROM operating_profiles WHERE slug = ?`).get(slug) as ProfileRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  list(activeOnly = false): OperatingProfile[] {
    const sql = activeOnly
      ? `SELECT * FROM operating_profiles WHERE status = 'active' ORDER BY name`
      : `SELECT * FROM operating_profiles ORDER BY name`;
    return (this.db.prepare(sql).all() as ProfileRow[]).map(this.rowToRecord);
  }

  update(id: string, patch: Partial<CreateProfileInput>): OperatingProfile {
    const existing = this.getById(id);
    if (!existing) throw new Error(`OperatingProfile "${id}" not found`);
    const now = Date.now();
    const updated = {
      name: patch.name ?? existing.name,
      slug: patch.slug ?? existing.slug,
      description: patch.description !== undefined ? patch.description : existing.description,
      icon: patch.icon !== undefined ? patch.icon : existing.icon,
      color: patch.color !== undefined ? patch.color : existing.color,
      isDefault: patch.isDefault !== undefined ? patch.isDefault : existing.isDefault,
      enabledProviders: patch.enabledProviders !== undefined ? patch.enabledProviders : existing.enabledProviders,
      enabledSkills: patch.enabledSkills !== undefined ? patch.enabledSkills : existing.enabledSkills,
      enabledTools: patch.enabledTools !== undefined ? patch.enabledTools : existing.enabledTools,
      fallbackChainId: patch.fallbackChainId !== undefined ? patch.fallbackChainId : existing.fallbackChainId,
      privacyMode: patch.privacyMode ?? existing.privacyMode,
      restrictions: patch.restrictions !== undefined ? patch.restrictions : existing.restrictions,
    };
    this.db.prepare(`
      UPDATE operating_profiles
      SET name = ?, slug = ?, description = ?, icon = ?, color = ?, is_default = ?,
          enabled_providers = ?, enabled_skills = ?, enabled_tools = ?,
          fallback_chain_id = ?, privacy_mode = ?, restrictions = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.slug,
      updated.description ?? null,
      updated.icon ?? null,
      updated.color ?? null,
      updated.isDefault ? 1 : 0,
      updated.enabledProviders ? JSON.stringify(updated.enabledProviders) : null,
      updated.enabledSkills ? JSON.stringify(updated.enabledSkills) : null,
      updated.enabledTools ? JSON.stringify(updated.enabledTools) : null,
      updated.fallbackChainId ?? null,
      updated.privacyMode,
      updated.restrictions ? JSON.stringify(updated.restrictions) : null,
      now,
      id,
    );
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM operating_profiles WHERE id = ?`).run(id);
  }

  // ── Active profile management ──────────────────────────────────────────────

  getActive(contextId: string): string | null {
    const row = this.db.prepare(`SELECT profile_id FROM active_profiles WHERE context_id = ?`).get(contextId) as ActiveProfileRow | undefined;
    return row ? row.profile_id : null;
  }

  setActive(contextId: string, profileId: string, contextType = 'agent'): void {
    this.db.prepare(`
      INSERT INTO active_profiles (context_id, context_type, profile_id, activated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(context_id) DO UPDATE SET context_type = excluded.context_type, profile_id = excluded.profile_id, activated_at = excluded.activated_at
    `).run(contextId, contextType, profileId, Date.now());
  }

  clearActive(contextId: string): void {
    this.db.prepare(`DELETE FROM active_profiles WHERE context_id = ?`).run(contextId);
  }

  private rowToRecord(row: ProfileRow): OperatingProfile {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description ?? undefined,
      icon: row.icon ?? undefined,
      color: row.color ?? undefined,
      isDefault: row.is_default === 1,
      enabledProviders: row.enabled_providers ? JSON.parse(row.enabled_providers) : undefined,
      enabledSkills: row.enabled_skills ? JSON.parse(row.enabled_skills) : undefined,
      enabledTools: row.enabled_tools ? JSON.parse(row.enabled_tools) : undefined,
      fallbackChainId: row.fallback_chain_id ?? undefined,
      privacyMode: row.privacy_mode as OperatingProfile['privacyMode'],
      restrictions: row.restrictions ? JSON.parse(row.restrictions) : undefined,
      status: row.status as OperatingProfile['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
