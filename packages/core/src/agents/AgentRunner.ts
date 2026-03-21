import { randomUUID } from 'crypto';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { ExecTool } from '../tools/ExecTool.js';
import { WebSearchTool } from '../tools/WebSearchTool.js';
import { WebFetchTool } from '../tools/WebFetchTool.js';
import type {
  AgentDefinition,
  AgentRun,
  AgentMessage,
  RunAgentInput,
  AgentEvent,
} from './types.js';

type EventEmitter = (event: AgentEvent) => void;

// ── Tool-call constants ───────────────────────────────────────────────────────

/** Maximum number of tool-call iterations per run (prevents infinite loops). */
const MAX_TOOL_CALL_ITERATIONS = 3;

/** Regex that finds a JSON tool-call block anywhere in a model response. */
const TOOL_CALL_RE = /\{[\s\S]*?"tool"\s*:\s*"(?:exec|web_search|web_fetch)"[\s\S]*?\}/;

// ── Tool-call extraction types ────────────────────────────────────────────────

type ExecCall       = { tool: 'exec';       command: string; args: string[] };
type WebSearchCall  = { tool: 'web_search'; query: string };
type WebFetchCall   = { tool: 'web_fetch';  url: string };
type AnyToolCall    = ExecCall | WebSearchCall | WebFetchCall;

/**
 * Attempt to extract a structured tool call from a model response.
 * Returns null if no valid call is found.
 *
 * Supported formats:
 *   {"tool":"exec","command":"git","args":["status"]}
 *   {"tool":"web_search","query":"latest Node.js release"}
 *   {"tool":"web_fetch","url":"https://example.com"}
 */
function extractToolCall(response: string): AnyToolCall | null {
  const match = response.match(TOOL_CALL_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const tool = parsed['tool'];

    if (tool === 'exec' && typeof parsed['command'] === 'string' && parsed['command'].length > 0) {
      const args = Array.isArray(parsed['args'])
        ? (parsed['args'] as unknown[]).filter(a => typeof a === 'string').map(String)
        : [];
      return { tool: 'exec', command: parsed['command'] as string, args };
    }

    if (tool === 'web_search' && typeof parsed['query'] === 'string' && parsed['query'].length > 0) {
      return { tool: 'web_search', query: parsed['query'] as string };
    }

    if (tool === 'web_fetch' && typeof parsed['url'] === 'string' && parsed['url'].length > 0) {
      return { tool: 'web_fetch', url: parsed['url'] as string };
    }
  } catch { /* malformed JSON — ignore */ }
  return null;
}

// Singleton tool instances — read-only, stateless, safe to share
const webSearchTool = new WebSearchTool();
const webFetchTool  = new WebFetchTool();

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
    private readonly execTool?: ExecTool | null,
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

  /**
   * Execute a single tool-call loop iteration for the `run()` method.
   * Detects exec, web_search, and web_fetch tool calls in the model response,
   * executes the appropriate tool, and appends the result as a user message.
   * Returns true if a tool call was handled (caller should do another model turn).
   */
  private async handleToolCall(
    response: string,
    messages: AgentMessage[],
    agentId: string,
    runId: string,
    emit: EventEmitter,
  ): Promise<boolean> {
    const call = extractToolCall(response);
    if (!call) return false;

    let toolResult: string;

    if (call.tool === 'exec') {
      // When ExecTool is not wired in, treat the tool-call JSON as plain text
      // (backward-compatible: callers that don't provide ExecTool see no change)
      if (!this.execTool) return false;
      {
        try {
          const result = await this.execTool.run(call.command, call.args, {}, 'agent', agentId);
          toolResult = [
            `Tool result for exec "${call.command} ${call.args.join(' ')}":`,
            `Exit code: ${result.exitCode}`,
            result.stdout ? `stdout:\n${result.stdout.slice(0, 4000)}` : '(no stdout)',
            result.stderr ? `stderr:\n${result.stderr.slice(0, 1000)}` : '',
          ].filter(Boolean).join('\n');
        } catch (err) {
          toolResult = `Tool exec failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'web_search') {
      try {
        const result = await webSearchTool.search(call.query);
        if (result.results.length === 0) {
          toolResult = `Web search for "${call.query}" returned no results.`;
        } else {
          toolResult = [
            `Web search results for "${call.query}" (source: duckduckgo):`,
            ...result.results.map((r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
            ),
          ].join('\n\n');
        }
      } catch (err) {
        toolResult = `Tool web_search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (call.tool === 'web_fetch') {
      try {
        const result = await webFetchTool.fetch(call.url);
        toolResult = [
          `Web fetch result for ${call.url}:`,
          result.truncated
            ? `(content truncated at ${result.content.length} chars — original: ${result.contentLength} chars)`
            : `(${result.contentLength} chars)`,
          '',
          result.content,
        ].join('\n');
      } catch (err) {
        toolResult = `Tool web_fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      return false;
    }

    const toolMsg: AgentMessage = {
      role: 'user',
      content: toolResult,
      timestamp: Date.now(),
    };
    messages.push(toolMsg);

    emit({
      type: 'run:turn',
      runId,
      agentId,
      payload: { turn: -1, message: toolMsg },
      timestamp: Date.now(),
    });

    return true;
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

        // ── Tool-call loop ────────────────────────────────────────────────
        // If the model response contains a structured exec call, execute it
        // (capped at MAX_TOOL_CALL_ITERATIONS to prevent runaway loops),
        // then call the model again with the tool result injected.
        let toolIteration = 0;
        while (toolIteration < MAX_TOOL_CALL_ITERATIONS && !stopped) {
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'assistant') break;
          const handled = await this.handleToolCall(
            lastMsg.content,
            messages,
            agent.id,
            runId,
            emit,
          );
          if (!handled) break;

          // Call the model again with the tool result
          const toolTurnSignal = withTimeout(controller.signal, INFERENCE_TIMEOUT_MS);
          const toolResponse = await this.models.infer(
            {
              messages: messages.map(m => ({ role: m.role, content: m.content })),
              model: effectiveModel,
              providerId: agent.providerId,
              temperature: agent.temperature,
              maxTokens: agent.maxTokens,
            },
            { agentModelId: effectiveModel },
            toolTurnSignal.signal,
          );
          toolTurnSignal.clear();

          const toolAssistantMsg: AgentMessage = {
            role: 'assistant',
            content: toolResponse.content,
            timestamp: Date.now(),
          };
          messages.push(toolAssistantMsg);
          run.output = toolResponse.content;
          emit({
            type: 'run:turn',
            runId,
            agentId: agent.id,
            payload: { turn, message: toolAssistantMsg },
            timestamp: Date.now(),
          });
          toolIteration++;
        }
        // ── End tool-call loop ────────────────────────────────────────────

        if (!this.shouldContinue(run.output ?? response.content)) {
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
