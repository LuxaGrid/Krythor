import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AgentDefinition, CreateAgentInput, UpdateAgentInput } from './types.js';
import { parseAgentList } from '../config/validate.js';
import { atomicWriteJSON } from '../config/atomicWrite.js';

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
      ...(input.allowedTools !== undefined && { allowedTools: input.allowedTools }),
      ...(input.idleTimeoutMs !== undefined && { idleTimeoutMs: input.idleTimeoutMs }),
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
      ...(input.allowedTools !== undefined && { allowedTools: input.allowedTools === null ? undefined : input.allowedTools }),
      ...(input.idleTimeoutMs !== undefined && { idleTimeoutMs: input.idleTimeoutMs === null ? undefined : input.idleTimeoutMs }),
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
      const parsed = JSON.parse(raw) as unknown;
      const { agents, skipped, errors } = parseAgentList(parsed);

      for (const agent of agents) {
        this.agents.set(agent.id, agent as AgentDefinition);
      }

      if (errors.length > 0) {
        console.error(`[AgentRegistry] Validation warnings in ${this.configPath}:\n${errors.join('\n')}`);
      }
      if (skipped > 0) {
        console.error(`[AgentRegistry] Skipped ${skipped} invalid agent(s) from ${this.configPath}`);
      }
    } catch (err) {
      console.error(`[AgentRegistry] Failed to parse ${this.configPath} — starting with no agents. Error: ${err instanceof Error ? err.message : String(err)}`);
      this.agents.clear();
    }
  }

  private save(): void {
    atomicWriteJSON(this.configPath, this.list());
  }
}
