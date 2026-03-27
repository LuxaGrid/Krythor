import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from './config/atomicWrite.js';
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
      timeoutMs: input.timeoutMs,
      taskProfile: input.taskProfile,
      enabled: input.enabled !== false,      // default true
      userInvocable: input.userInvocable !== false, // default true
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
      ...(input.taskProfile !== undefined && { taskProfile: input.taskProfile }),
      ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs || undefined }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.userInvocable !== undefined && { userInvocable: input.userInvocable }),
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

  list(tags?: string[], includeDisabled = false): Skill[] {
    let all = Array.from(this.skills.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!includeDisabled) all = all.filter(s => s.enabled !== false);
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
          // Backfill fields for skills created before they existed
          if (!Array.isArray(s.permissions)) s.permissions = [];
          if (s.enabled === undefined) s.enabled = true;
          if (s.userInvocable === undefined) s.userInvocable = true;
          this.skills.set(s.id, s);
        }
      }
    } catch (err) {
      console.error(`[SkillRegistry] Failed to parse ${this.configPath} — starting with no skills. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    atomicWriteJSON(this.configPath, Array.from(this.skills.values()));
  }
}
