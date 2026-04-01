import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export interface SkillVersionRecord {
  id: string;
  skillId: string;
  version: number;
  snapshot: Record<string, unknown>;  // full skill JSON
  priorVersionId?: string;
  createdBy?: string;
  changelogNote?: string;
  createdAt: number;
}

export class SkillVersionStore {
  constructor(private readonly db: Database.Database) {}

  save(record: Omit<SkillVersionRecord, 'id' | 'createdAt'>): SkillVersionRecord {
    const row = { ...record, id: randomUUID(), createdAt: Date.now() };
    this.db.prepare(`
      INSERT INTO skill_versions (id, skill_id, version, snapshot, prior_version_id, created_by, changelog_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.skillId, row.version, JSON.stringify(row.snapshot), row.priorVersionId ?? null, row.createdBy ?? null, row.changelogNote ?? null, row.createdAt);
    return row;
  }

  list(skillId: string): SkillVersionRecord[] {
    return (this.db.prepare(`SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC`).all(skillId) as any[])
      .map(this.rowToRecord);
  }

  getByVersion(skillId: string, version: number): SkillVersionRecord | null {
    const row = this.db.prepare(`SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?`).get(skillId, version) as any;
    return row ? this.rowToRecord(row) : null;
  }

  private rowToRecord(row: any): SkillVersionRecord {
    return {
      id: row.id,
      skillId: row.skill_id,
      version: row.version,
      snapshot: JSON.parse(row.snapshot),
      priorVersionId: row.prior_version_id ?? undefined,
      createdBy: row.created_by ?? undefined,
      changelogNote: row.changelog_note ?? undefined,
      createdAt: row.created_at,
    };
  }
}
