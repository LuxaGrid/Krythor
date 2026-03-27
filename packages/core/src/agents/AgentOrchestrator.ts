import { EventEmitter } from 'events';
import { join } from 'path';
import { homedir } from 'os';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { ExecTool } from '../tools/ExecTool.js';
import { AgentRegistry } from './AgentRegistry.js';
import { AgentRunner } from './AgentRunner.js';
import type { LearningRecorder, HandoffResolver, CustomToolDispatcher, SpawnAgentResolver, GuardLike } from './AgentRunner.js';
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
// Concurrency model:
//   MAX_ACTIVE_RUNS  — simultaneous in-flight runs
//   RUN_QUEUE_DEPTH  — max queued waiters (requests that arrived while at cap)
//   RUN_QUEUE_TIMEOUT_MS — max time a queued request waits before failing
//
// Requests that arrive while at cap are queued (up to RUN_QUEUE_DEPTH).
// When a run slot opens, the oldest queued waiter is resumed.
// When the queue is full, callers get RunQueueFullError (→ 429).
//

/** Maximum number of agent runs that may be in-flight simultaneously. */
const MAX_ACTIVE_RUNS = 10;

/** Maximum number of requests waiting for a run slot. */
const RUN_QUEUE_DEPTH = 50;

/** Maximum time a queued request will wait for a slot (ms). */
const RUN_QUEUE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class RunQueueFullError extends Error {
  constructor() {
    super(`Agent run queue is full (max ${RUN_QUEUE_DEPTH} waiting). Try again later.`);
    this.name = 'RunQueueFullError';
  }
}

/** Interval at which the idle-timeout janitor runs (ms). */
const JANITOR_INTERVAL_MS = 15_000; // 15 seconds

export class AgentOrchestrator extends EventEmitter {
  readonly registry: AgentRegistry;
  private runner: AgentRunner;
  private runHistory = new Map<string, AgentRun>(); // runId → run (capped at 500)

  // Queue of resolve functions waiting for a run slot
  private readonly waitQueue: Array<{ resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  // Background janitor — stops runs that exceed their agent's idleTimeoutMs
  private janitorTimer: ReturnType<typeof setInterval> | null = null;

  private handoffResolver: HandoffResolver | null = null;
  private customToolDispatcher: CustomToolDispatcher | null = null;
  private spawnAgentResolver: SpawnAgentResolver | null = null;
  private guardInstance: GuardLike | null = null;

  private globalWorkspaceDir: string | null = null;
  private recordLearning?: LearningRecorder;
  private execToolInstance: ExecTool | null = null;

  constructor(
    private readonly memory: MemoryEngine | null,
    private readonly models: ModelEngine | null,
    configDir?: string,
    recordLearning?: LearningRecorder,
    execTool?: ExecTool | null,
  ) {
    super();
    this.recordLearning = recordLearning;
    this.execToolInstance = execTool ?? null;
    const dir = configDir ?? getConfigDir();
    this.registry = new AgentRegistry(dir);
    this.runner = new AgentRunner(memory, models, recordLearning, execTool ?? null, null, null, null, null, null);
    // Wire the handoff resolver — dispatches {"handoff":"<id>","message":"..."} to another agent
    this.handoffResolver = async (targetAgentId: string, message: string): Promise<string | null> => {
      const agent = this.registry.getById(targetAgentId);
      if (!agent) return null;
      const run = await this.runner.run(agent, { input: message }, (evt) => this.emit('agent:event', evt));
      return run.output ?? null;
    };
    // Wire the spawn-agent resolver — dispatches {"tool":"spawn_agent","agentId":"<id>","message":"..."}
    this.spawnAgentResolver = async (targetAgentId: string, message: string): Promise<string | null> => {
      const agent = this.registry.getById(targetAgentId);
      if (!agent) return null;
      const run = await this.runner.run(agent, { input: message }, (evt) => this.emit('agent:event', evt));
      return run.output ?? null;
    };
    this.rebuildRunner();
    this.startJanitor();
  }

  // ── Idle-timeout janitor ──────────────────────────────────────────────────

  private startJanitor(): void {
    this.janitorTimer = setInterval(() => {
      const now = Date.now();
      for (const [runId, run] of this.runHistory) {
        if (run.status !== 'running') continue;
        const agent = this.registry.getById(run.agentId);
        if (!agent?.idleTimeoutMs) continue;
        if (now - run.startedAt > agent.idleTimeoutMs) {
          this.runner.stopRun(runId);
          this.emit('agent:event', {
            type:      'run:stopped',
            runId,
            agentId:   run.agentId,
            payload:   { reason: 'idle_timeout', idleTimeoutMs: agent.idleTimeoutMs },
            timestamp: now,
          });
        }
      }
    }, JANITOR_INTERVAL_MS);
    // unref so the timer doesn't keep the process alive unnecessarily
    if (this.janitorTimer.unref) this.janitorTimer.unref();
  }

  /** Stop the background janitor. Call on graceful shutdown. */
  destroy(): void {
    if (this.janitorTimer) {
      clearInterval(this.janitorTimer);
      this.janitorTimer = null;
    }
  }

  /** Set the global workspace directory. Passed to AgentRunner for bootstrap injection. */
  setWorkspaceDir(dir: string): void {
    this.globalWorkspaceDir = dir;
    this.rebuildRunner();
  }

  /** Rebuild runner with all current wired dependencies. */
  private rebuildRunner(): void {
    this.runner = new AgentRunner(
      this.memory,
      this.models,
      this.recordLearning,
      this.execToolInstance,
      this.handoffResolver,
      this.customToolDispatcher,
      this.spawnAgentResolver,
      this.guardInstance,
      this.globalWorkspaceDir,
    );
  }

  /**
   * Wire in an ExecTool after construction (called from server.ts after both
   * orchestrator and execTool are initialized). Replaces the runner instance
   * so subsequent runs have access to exec capabilities.
   */
  setExecTool(execTool: ExecTool): void {
    this.execToolInstance = execTool;
    this.rebuildRunner();
  }

  /**
   * Wire in a GuardLike after construction.
   * When set, agent tool calls for web_search, web_fetch, and webhook:call
   * will be checked against the guard policy before execution.
   */
  setGuard(guard: GuardLike): void {
    this.guardInstance = guard;
    this.rebuildRunner();
  }

  /**
   * Wire in a CustomToolDispatcher after construction (called from server.ts
   * after both orchestrator and CustomToolStore are initialized).
   */
  setCustomToolDispatcher(dispatcher: CustomToolDispatcher): void {
    this.customToolDispatcher = dispatcher;
    this.rebuildRunner();
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
    await this.acquireSlot();
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

    let run: AgentRun;
    try {
      run = await this.runner.run(agent, mergedInput, emit);
    } finally {
      this.releaseSlot();
    }
    this.storeRun(run);
    return run;
  }

  async runAgentStream(
    agentId: string,
    input: RunAgentInput,
    options?: { contextMessages?: Array<{ role: string; content: string }>; runId?: string },
  ): Promise<AgentRun> {
    await this.acquireSlot();
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

    let run: AgentRun;
    try {
      run = await this.runner.runStream(agent, mergedInput, emit);
    } finally {
      this.releaseSlot();
    }
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
    queuedRuns: number;
    totalRuns: number;
  } {
    return {
      agentCount: this.registry.count(),
      activeRuns: this.runner.activeRunCount(),
      queuedRuns: this.waitQueue.length,
      totalRuns: this.runHistory.size,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Acquire a run slot. If at capacity, waits in the queue.
   * Throws RunQueueFullError if the queue is also full.
   */
  private async acquireSlot(): Promise<void> {
    if (this.runner.activeRunCount() < MAX_ACTIVE_RUNS) return; // slot available immediately

    if (this.waitQueue.length >= RUN_QUEUE_DEPTH) {
      throw new RunQueueFullError();
    }

    // Enqueue and wait
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex(e => e.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`Agent run queued too long (>${RUN_QUEUE_TIMEOUT_MS / 1000}s). Try again.`));
      }, RUN_QUEUE_TIMEOUT_MS);
      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  /** Release a run slot and wake the next queued waiter, if any. */
  private releaseSlot(): void {
    const next = this.waitQueue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }

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
