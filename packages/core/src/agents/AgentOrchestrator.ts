import { EventEmitter } from 'events';
import { join } from 'path';
import { homedir } from 'os';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import { AgentRegistry } from './AgentRegistry.js';
import { AgentRunner } from './AgentRunner.js';
import type {
  AgentDefinition,
  AgentRun,
  AgentEvent,
  CreateAgentInput,
  UpdateAgentInput,
  RunAgentInput,
} from './types.js';

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor', 'config');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor', 'config');
  }
  return join(homedir(), '.local', 'share', 'krythor', 'config');
}

// ─── AgentOrchestrator ────────────────────────────────────────────────────────
//
// Manages agent lifecycle. Exposes an EventEmitter so the Gateway can forward
// agent events to connected WebSocket clients.
//

/** Maximum number of agent runs that may be in-flight simultaneously. */
const MAX_ACTIVE_RUNS = 10;

export class AgentOrchestrator extends EventEmitter {
  readonly registry: AgentRegistry;
  private runner: AgentRunner;
  private runHistory = new Map<string, AgentRun>(); // runId → run (capped at 500)

  constructor(
    private readonly memory: MemoryEngine | null,
    private readonly models: ModelEngine | null,
    configDir?: string,
  ) {
    super();
    const dir = configDir ?? getConfigDir();
    this.registry = new AgentRegistry(dir);
    this.runner = new AgentRunner(memory, models);
  }

  // ── Agent CRUD ─────────────────────────────────────────────────────────────

  createAgent(input: CreateAgentInput): AgentDefinition {
    return this.registry.create(input);
  }

  updateAgent(id: string, input: UpdateAgentInput): AgentDefinition {
    return this.registry.update(id, input);
  }

  deleteAgent(id: string): void {
    this.registry.delete(id);
  }

  getAgent(id: string): AgentDefinition | null {
    return this.registry.getById(id);
  }

  listAgents(): AgentDefinition[] {
    return this.registry.list();
  }

  // ── Single agent execution ─────────────────────────────────────────────────

  async runAgent(
    agentId: string,
    input: RunAgentInput,
    options?: { contextMessages?: Array<{ role: string; content: string }>; runId?: string },
  ): Promise<AgentRun> {
    if (this.runner.activeRunCount() >= MAX_ACTIVE_RUNS) {
      throw new Error(`Too many concurrent agent runs (max ${MAX_ACTIVE_RUNS}). Wait for a run to finish.`);
    }
    const agent = this.registry.getById(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);

    const emit = (event: AgentEvent): void => {
      this.emit('agent:event', event);
    };

    const mergedInput: RunAgentInput = {
      ...input,
      ...(options?.contextMessages && { contextMessages: options.contextMessages }),
      ...(options?.runId && { runId: options.runId }),
    };

    const run = await this.runner.run(agent, mergedInput, emit);
    this.storeRun(run);
    return run;
  }

  async runAgentStream(
    agentId: string,
    input: RunAgentInput,
    options?: { contextMessages?: Array<{ role: string; content: string }>; runId?: string },
  ): Promise<AgentRun> {
    if (this.runner.activeRunCount() >= MAX_ACTIVE_RUNS) {
      throw new Error(`Too many concurrent agent runs (max ${MAX_ACTIVE_RUNS}). Wait for a run to finish.`);
    }
    const agent = this.registry.getById(agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);

    const emit = (event: AgentEvent): void => {
      this.emit('agent:event', event);
    };

    const mergedInput: RunAgentInput = {
      ...input,
      ...(options?.contextMessages && { contextMessages: options.contextMessages }),
      ...(options?.runId && { runId: options.runId }),
    };

    const run = await this.runner.runStream(agent, mergedInput, emit);
    this.storeRun(run);
    return run;
  }

  // ── Parallel execution ────────────────────────────────────────────────────
  // Run multiple agents concurrently, capped at MAX_PARALLEL concurrent runs
  // to prevent runaway memory/token consumption.

  static readonly MAX_PARALLEL = 5;

  async runAgentsParallel(jobs: Array<{ agentId: string; input: RunAgentInput }>): Promise<AgentRun[]> {
    const results: AgentRun[] = new Array(jobs.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < jobs.length) {
        const i = index++;
        const job = jobs[i]!;
        results[i] = await this.runAgent(job.agentId, job.input);
      }
    };

    const concurrency = Math.min(AgentOrchestrator.MAX_PARALLEL, jobs.length);
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  // ── Sequential execution ──────────────────────────────────────────────────
  // Run agents one after another, passing each output as input to the next.

  async runAgentsSequential(
    agentIds: string[],
    initialInput: string,
  ): Promise<AgentRun[]> {
    const runs: AgentRun[] = [];
    let currentInput = initialInput;

    for (const agentId of agentIds) {
      const run = await this.runAgent(agentId, { input: currentInput });
      runs.push(run);
      if (run.status === 'failed' || run.status === 'stopped') break;
      currentInput = run.output ?? currentInput;
    }

    return runs;
  }

  // ── Run control ────────────────────────────────────────────────────────────

  stopRun(runId: string): boolean {
    return this.runner.stopRun(runId);
  }

  getRun(runId: string): AgentRun | null {
    // Check in-memory first (active/recent runs), then fall back to DB
    const inMem = this.runHistory.get(runId);
    if (inMem) return inMem;
    const persisted = this.memory?.agentRunStore.getById(runId);
    return persisted ? (persisted as unknown as AgentRun) : null;
  }

  listRuns(agentId?: string): AgentRun[] {
    // Prefer DB list (survives restarts); merge with in-memory active runs
    const dbRuns = (this.memory?.agentRunStore.list(agentId) ?? []) as unknown as AgentRun[];
    const inMemActive = Array.from(this.runHistory.values())
      .filter(r => r.status === 'running');
    const dbIds = new Set(dbRuns.map(r => r.id));
    const merged = [...inMemActive.filter(r => !dbIds.has(r.id)), ...dbRuns];
    const filtered = agentId ? merged.filter(r => r.agentId === agentId) : merged;
    return filtered.sort((a, b) => b.startedAt - a.startedAt);
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats(): {
    agentCount: number;
    activeRuns: number;
    totalRuns: number;
  } {
    return {
      agentCount: this.registry.count(),
      activeRuns: this.runner.activeRunCount(),
      totalRuns: this.runHistory.size,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private storeRun(run: AgentRun): void {
    this.runHistory.set(run.id, run);
    // Cap in-memory history at 500 entries (FIFO).
    if (this.runHistory.size > 500) {
      const firstKey = this.runHistory.keys().next().value;
      if (firstKey) this.runHistory.delete(firstKey);
    }
    // Persist to SQLite so history survives restarts.
    if (this.memory) {
      try {
        this.memory.agentRunStore.save({
          id:              run.id,
          agentId:         run.agentId,
          status:          run.status as 'running' | 'completed' | 'failed' | 'stopped',
          input:           run.input,
          output:          run.output,
          modelUsed:       run.modelUsed,
          errorMessage:    run.errorMessage,
          startedAt:       run.startedAt,
          completedAt:     run.completedAt,
          messages:        run.messages,
          memoryIdsUsed:   run.memoryIdsUsed,
          memoryIdsWritten: run.memoryIdsWritten,
        });
      } catch (err) {
        console.warn('[AgentOrchestrator] Failed to persist run to DB:', err instanceof Error ? err.message : err);
      }
    }
  }
}
