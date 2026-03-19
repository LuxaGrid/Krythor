import { randomUUID } from 'crypto';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type {
  AgentDefinition,
  AgentRun,
  AgentMessage,
  RunAgentInput,
  AgentEvent,
} from './types.js';

type EventEmitter = (event: AgentEvent) => void;

/**
 * Optional callback invoked after each completed or failed run.
 * Injected from the gateway so @krythor/core does not depend on
 * @krythor/memory's LearningRecordStore directly.
 */
export interface LearningSignal {
  taskType:                   string;
  agentId:                    string;
  modelId:                    string;
  providerId:                 string;
  outcome:                    'success' | 'failure' | 'stopped';
  latencyMs:                  number;
  retries:                    number;
  turnCount:                  number;
  userAcceptedRecommendation: boolean;
  recommendedModelId?:        string;
  wasPinnedPreference:        boolean;
}

export type LearningRecorder = (signal: LearningSignal) => void;

/** Default per-turn inference timeout in ms (60 seconds). */
const INFERENCE_TIMEOUT_MS = 60_000;

/**
 * Combine a parent AbortSignal with a per-turn timeout.
 * Aborts whichever fires first and clears the timer to avoid leaks.
 */
function withTimeout(parent: AbortSignal, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Inference timeout after ${ms}ms`)), ms);
  const onParent = () => controller.abort(parent.reason);
  parent.addEventListener('abort', onParent, { once: true });
  const clear = () => {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParent);
  };
  controller.signal.addEventListener('abort', clear, { once: true });
  return { signal: controller.signal, clear };
}

// ─── AgentRunner ──────────────────────────────────────────────────────────────
//
// Executes a single agent run:
//   1. Builds system prompt (definition + memory context)
//   2. Runs conversation turns until completion or maxTurns
//   3. Writes agent memory on completion
//   4. Emits events for streaming
//

export class AgentRunner {
  private activeRuns = new Map<string, { run: AgentRun; stop: () => void; controller: AbortController }>();

  constructor(
    private readonly memory: MemoryEngine | null,
    private readonly models: ModelEngine | null,
    private readonly recordLearning?: LearningRecorder,
  ) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  private async buildMemoryContext(agent: AgentDefinition, input: string, runId: string): Promise<{ memoryContext: string; memoryIdsUsed: string[] }> {
    const memoryIdsUsed: string[] = [];
    let memoryContext = '';

    if (this.memory) {
      const results = await this.memory.search(
        { scope: agent.memoryScope === 'agent' ? 'agent' : agent.memoryScope, scope_id: agent.id, limit: 8 },
        input,
      );
      const userResults = await this.memory.search({ scope: 'user', limit: 4 }, input);
      const allResults = [...results, ...userResults].slice(0, 10);

      for (const r of allResults) {
        memoryIdsUsed.push(r.entry.id);
        this.memory.recordUse(r.entry.id, runId, `agent:${agent.name}`);
      }

      if (allResults.length > 0) {
        // Cap each entry's content contribution to avoid blowing out the context window.
        // 500 chars per entry × 10 entries = ~5 KB max memory injection.
        memoryContext = '\n\nRelevant memory context:\n' +
          allResults.map(r => `[${r.entry.scope}] ${r.entry.title}: ${r.entry.content.slice(0, 500)}`).join('\n');
      }
    }

    return { memoryContext, memoryIdsUsed };
  }

  private buildMessages(
    agent: AgentDefinition,
    input: RunAgentInput,
    memoryContext: string,
    contextMessages?: Array<{ role: string; content: string }>,
  ): AgentMessage[] {
    const systemPrompt = [
      agent.systemPrompt,
      input.contextOverride ? `\nAdditional context:\n${input.contextOverride}` : '',
      memoryContext,
    ].join('');

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt, timestamp: Date.now() },
    ];

    // Prepend conversation history if provided
    if (contextMessages && contextMessages.length > 0) {
      for (const cm of contextMessages) {
        if (cm.role === 'user' || cm.role === 'assistant' || cm.role === 'system') {
          messages.push({ role: cm.role as 'user' | 'assistant' | 'system', content: cm.content, timestamp: Date.now() });
        }
      }
    }

    // Current user message
    messages.push({ role: 'user', content: input.input, timestamp: Date.now() });

    return messages;
  }

  private shouldContinue(response: string): boolean {
    // Only continue when the model explicitly signals it via [CONTINUE].
    // Previously this also triggered on responses ending in "?" — but that
    // fires on almost every conversational reply, burning through maxTurns
    // and generating unwanted follow-up turns.
    return response.includes('[CONTINUE]');
  }

  private async writeAgentMemory(agent: AgentDefinition, input: RunAgentInput, run: AgentRun): Promise<string | null> {
    if (!this.memory || !run.output) return null;
    const memEntry = this.memory.create({
      title: `Agent ${agent.name}: ${input.input.substring(0, 60)}`,
      content: run.output,
      scope: agent.memoryScope,
      scope_id: agent.id,
      source: 'agent',
      importance: 0.5,
      tags: ['agent-run', agent.name.toLowerCase().replace(/\s+/g, '-'), ...agent.tags],
      source_type: 'agent_output',
      source_reference: run.id,
    });
    return memEntry.entry.id;
  }

  // ── run() ──────────────────────────────────────────────────────────────────

  async run(
    agent: AgentDefinition,
    input: RunAgentInput,
    emit: EventEmitter,
  ): Promise<AgentRun> {
    const runId = input.runId ?? randomUUID();
    const now = Date.now();
    const controller = new AbortController();

    let stopped = false;
    const stopFn = (): void => {
      stopped = true;
      controller.abort();
    };

    const run: AgentRun = {
      id: runId,
      agentId: agent.id,
      status: 'running',
      input: input.input,
      messages: [],
      startedAt: now,
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      ...(input.requestId && { requestId: input.requestId }),
    };

    this.activeRuns.set(runId, { run, stop: stopFn, controller });

    emit({ type: 'run:started', runId, agentId: agent.id, timestamp: Date.now() });

    try {
      const { memoryContext, memoryIdsUsed } = await this.buildMemoryContext(agent, input.input, runId);
      run.memoryIdsUsed = memoryIdsUsed;

      const messages = this.buildMessages(agent, input, memoryContext, input.contextMessages);
      run.messages = messages;

      // Conversation loop
      if (!this.models || this.models.stats().providerCount === 0) {
        throw new Error('No model provider configured. Add a provider in the Models tab.');
      }

      let turn = 0;
      while (turn < agent.maxTurns && !stopped) {

        const effectiveModel = input.modelOverride ?? agent.modelId;
        const turnSignal = withTimeout(controller.signal, INFERENCE_TIMEOUT_MS);
        const response = await this.models.infer(
          {
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            model: effectiveModel,
            providerId: agent.providerId,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
          },
          {
            agentModelId: effectiveModel,
          },
          turnSignal.signal,
        );
        turnSignal.clear();

        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        };
        messages.push(assistantMsg);
        run.modelUsed = `${response.providerId}/${response.model}`;
        if (response.selectionReason)                    run.selectionReason  = response.selectionReason;
        if (response.fallbackOccurred)                   run.fallbackOccurred = response.fallbackOccurred;
        if (typeof response.retryCount === 'number')     run.retryCount       = response.retryCount;

        emit({
          type: 'run:turn',
          runId,
          agentId: agent.id,
          payload: { turn, message: assistantMsg },
          timestamp: Date.now(),
        });

        run.output = response.content;
        turn++;

        if (!this.shouldContinue(response.content)) {
          break;
        }

        messages.push({
          role: 'user',
          content: '[Please continue]',
          timestamp: Date.now(),
        });
      }

      if (stopped) {
        run.status = 'stopped';
        run.completedAt = Date.now();
        emit({ type: 'run:stopped', runId, agentId: agent.id, timestamp: Date.now() });
        this.emitLearning(agent, run, input, 'stopped', turn, now);
      } else {
        run.status = 'completed';
        run.completedAt = Date.now();

        const memId = await this.writeAgentMemory(agent, input, run);
        if (memId) run.memoryIdsWritten.push(memId);

        emit({
          type: 'run:completed',
          runId,
          agentId: agent.id,
          payload: { output: run.output, modelUsed: run.modelUsed },
          timestamp: Date.now(),
        });
        this.emitLearning(agent, run, input, 'success', turn, now);
      }
    } catch (err) {
      run.status = 'failed';
      run.completedAt = Date.now();
      run.errorMessage = err instanceof Error ? err.message : 'Unknown error';
      emit({
        type: 'run:failed',
        runId,
        agentId: agent.id,
        payload: { error: run.errorMessage },
        timestamp: Date.now(),
      });
      this.emitLearning(agent, run, input, 'failure', 0, now);
    } finally {
      this.activeRuns.delete(runId);
    }

    return run;
  }

  // ── runStream() ────────────────────────────────────────────────────────────

  async runStream(
    agent: AgentDefinition,
    input: RunAgentInput,
    emit: EventEmitter,
  ): Promise<AgentRun> {
    const runId = input.runId ?? randomUUID();
    const now = Date.now();
    const controller = new AbortController();

    let stopped = false;
    const stopFn = (): void => {
      stopped = true;
      controller.abort();
    };

    const run: AgentRun = {
      id: runId,
      agentId: agent.id,
      status: 'running',
      input: input.input,
      messages: [],
      startedAt: now,
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      ...(input.requestId && { requestId: input.requestId }),
    };

    this.activeRuns.set(runId, { run, stop: stopFn, controller });
    emit({ type: 'run:started', runId, agentId: agent.id, timestamp: Date.now() });

    try {
      const { memoryContext, memoryIdsUsed } = await this.buildMemoryContext(agent, input.input, runId);
      run.memoryIdsUsed = memoryIdsUsed;

      const messages = this.buildMessages(agent, input, memoryContext, input.contextMessages);
      run.messages = messages;

      let streamTurnCount = 0;
      if (!this.models || this.models.stats().providerCount === 0) {
        throw new Error('No model provider configured. Add a provider in the Models tab.');
      } else {
        let turn = 0;

        while (turn < agent.maxTurns && !stopped) {
          const effectiveModel = input.modelOverride ?? agent.modelId;
          let fullContent = '';
          const streamSignal = withTimeout(controller.signal, INFERENCE_TIMEOUT_MS);

          for await (const chunk of this.models.inferStream(
            {
              messages: messages.map(m => ({ role: m.role, content: m.content })),
              model: effectiveModel,
              providerId: agent.providerId,
              temperature: agent.temperature,
              maxTokens: agent.maxTokens,
            },
            { agentModelId: effectiveModel },
            streamSignal.signal,
          )) {
            if (stopped) { streamSignal.clear(); break; }
            fullContent += chunk.delta;
            emit({
              type: 'run:stream:chunk',
              runId,
              agentId: agent.id,
              payload: { delta: chunk.delta, done: chunk.done },
              timestamp: Date.now(),
            });
            if (chunk.model)             run.modelUsed       = chunk.model;
            if (chunk.done) {
              if (chunk.selectionReason)               run.selectionReason  = chunk.selectionReason;
              if (chunk.fallbackOccurred)              run.fallbackOccurred = chunk.fallbackOccurred;
              if (typeof chunk.retryCount === 'number') run.retryCount      = chunk.retryCount;
            }
          }
          streamSignal.clear();

          const assistantMsg: AgentMessage = { role: 'assistant', content: fullContent, timestamp: Date.now() };
          messages.push(assistantMsg);
          run.output = fullContent;

          emit({ type: 'run:turn', runId, agentId: agent.id, payload: { turn, message: assistantMsg }, timestamp: Date.now() });

          turn++;
          streamTurnCount = turn;

          if (stopped || !this.shouldContinue(fullContent)) {
            break;
          }

          // Multi-turn: add a follow-up user message and continue
          messages.push({
            role: 'user',
            content: '[Please continue]',
            timestamp: Date.now(),
          });
        }
      }

      if (stopped) {
        run.status = 'stopped';
        run.completedAt = Date.now();
        emit({ type: 'run:stopped', runId, agentId: agent.id, timestamp: Date.now() });
        this.emitLearning(agent, run, input, 'stopped', streamTurnCount, now);
      } else {
        run.status = 'completed';
        run.completedAt = Date.now();

        const memId = await this.writeAgentMemory(agent, input, run);
        if (memId) run.memoryIdsWritten.push(memId);

        emit({
          type: 'run:completed',
          runId,
          agentId: agent.id,
          payload: { output: run.output, modelUsed: run.modelUsed },
          timestamp: Date.now(),
        });
        this.emitLearning(agent, run, input, 'success', streamTurnCount, now);
      }
    } catch (err) {
      run.status = 'failed';
      run.completedAt = Date.now();
      run.errorMessage = err instanceof Error ? err.message : 'Unknown error';
      emit({
        type: 'run:failed',
        runId,
        agentId: agent.id,
        payload: { error: run.errorMessage },
        timestamp: Date.now(),
      });
      this.emitLearning(agent, run, input, 'failure', 0, now);
    } finally {
      this.activeRuns.delete(runId);
    }

    return run;
  }

  private emitLearning(
    agent: AgentDefinition,
    run: AgentRun,
    input: RunAgentInput,
    outcome: 'success' | 'failure' | 'stopped',
    turnCount: number,
    startedAt: number,
  ): void {
    if (!this.recordLearning || !run.modelUsed) return;
    const [providerId, modelId] = run.modelUsed.split('/') as [string, string?];
    if (!modelId) return;

    try {
      this.recordLearning({
        taskType: 'agent_run',
        agentId: agent.id,
        modelId,
        providerId,
        outcome,
        latencyMs: (run.completedAt ?? Date.now()) - startedAt,
        retries: 0,
        turnCount,
        userAcceptedRecommendation: !input.modelOverride,
        recommendedModelId: undefined,
        wasPinnedPreference: !!agent.modelId && !input.modelOverride,
      });
    } catch { /* learning record failures must never crash a run */ }
  }

  stopRun(runId: string): boolean {
    const entry = this.activeRuns.get(runId);
    if (!entry) return false;
    entry.stop();
    return true;
  }

  activeRunCount(): number {
    return this.activeRuns.size;
  }
}
