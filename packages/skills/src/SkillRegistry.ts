import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { Skill, CreateSkillInput, UpdateSkillInput, SkillPermission } from './types.js';

// ─── SkillRegistry ────────────────────────────────────────────────────────────
//
// Persists skills as JSON — same pattern as AgentRegistry.
// Skills are user-created prompt libraries with optional model assignments.
//

export class SkillRegistry {
  private configPath: string;
  private skills: Map<string, Skill> = new Map();

  constructor(configDir: string) {
    this.configPath = join(configDir, 'skills.json');
    mkdirSync(configDir, { recursive: true });
    this.load();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  create(input: CreateSkillInput): Skill {
    const now = Date.now();
    const skill: Skill = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      systemPrompt: input.systemPrompt,
      tags: input.tags ?? [],
      permissions: input.permissions ?? [],
      modelId: input.modelId,
      providerId: input.providerId,
      version: 1,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.skills.set(skill.id, skill);
    this.save();
    return skill;
  }

  update(id: string, input: UpdateSkillInput): Skill {
    const existing = this.skills.get(id);
    if (!existing) throw new Error(`Skill "${id}" not found`);
    const updated: Skill = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.permissions !== undefined && { permissions: input.permissions }),
      ...(input.modelId !== undefined && { modelId: input.modelId || undefined }),
      ...(input.providerId !== undefined && { providerId: input.providerId || undefined }),
      version: (existing.version ?? 1) + 1,
      updatedAt: Date.now(),
    };
    this.skills.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): void {
    if (!this.skills.has(id)) throw new Error(`Skill "${id}" not found`);
    this.skills.delete(id);
    this.save();
  }

  // Record that a skill was executed — increments runCount and sets lastRunAt.
  recordRun(id: string): void {
    const skill = this.skills.get(id);
    if (!skill) return;
    this.skills.set(id, { ...skill, runCount: (skill.runCount ?? 0) + 1, lastRunAt: Date.now() });
    this.save();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getById(id: string): Skill | null {
    return this.skills.get(id) ?? null;
  }

  list(tags?: string[]): Skill[] {
    const all = Array.from(this.skills.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!tags || tags.length === 0) return all;
    return all.filter(s => tags.every(t => s.tags.includes(t)));
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const s of parsed as Skill[]) {
          // Backfill permissions for skills created before this field existed
          if (!Array.isArray(s.permissions)) s.permissions = [];
          this.skills.set(s.id, s);
        }
      }
    } catch (err) {
      console.error(`[SkillRegistry] Failed to parse ${this.configPath} — starting with no skills. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    const data = Array.from(this.skills.values());
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
