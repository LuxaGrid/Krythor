import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { AgentDefinition, CreateAgentInput, UpdateAgentInput } from './types.js';

export class AgentRegistry {
  private configPath: string;
  private agents = new Map<string, AgentDefinition>();

  constructor(configDir: string) {
    this.configPath = join(configDir, 'agents.json');
    mkdirSync(configDir, { recursive: true });
    this.load();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  create(input: CreateAgentInput): AgentDefinition {
    const now = Date.now();
    const agent: AgentDefinition = {
      id: randomUUID(),
      name: input.name.trim(),
      description: (input.description ?? '').trim(),
      systemPrompt: input.systemPrompt.trim(),
      modelId: input.modelId,
      providerId: input.providerId,
      memoryScope: input.memoryScope ?? 'agent',
      maxTurns: input.maxTurns ?? 10,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    this.save();
    return agent;
  }

  update(id: string, input: UpdateAgentInput): AgentDefinition {
    const existing = this.agents.get(id);
    if (!existing) throw new Error(`Agent "${id}" not found`);

    const updated: AgentDefinition = {
      ...existing,
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.systemPrompt !== undefined && { systemPrompt: input.systemPrompt.trim() }),
      ...(input.modelId !== undefined && { modelId: input.modelId }),
      ...(input.providerId !== undefined && { providerId: input.providerId }),
      ...(input.memoryScope !== undefined && { memoryScope: input.memoryScope }),
      ...(input.maxTurns !== undefined && { maxTurns: input.maxTurns }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.tags !== undefined && { tags: input.tags }),
      updatedAt: Date.now(),
    };

    this.agents.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): void {
    if (!this.agents.has(id)) throw new Error(`Agent "${id}" not found`);
    this.agents.delete(id);
    this.save();
  }

  getById(id: string): AgentDefinition | null {
    return this.agents.get(id) ?? null;
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  count(): number {
    return this.agents.size;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const list = JSON.parse(raw) as AgentDefinition[];
      for (const agent of list) {
        this.agents.set(agent.id, agent);
      }
    } catch (err) {
      console.error(`[AgentRegistry] Failed to parse ${this.configPath} — starting with no agents. Error: ${err instanceof Error ? err.message : String(err)}`);
      this.agents.clear();
    }
  }

  private save(): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(this.list(), null, 2), 'utf-8');
  }
}
