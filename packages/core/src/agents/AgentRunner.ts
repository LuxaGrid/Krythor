import { randomUUID } from 'crypto';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { ExecTool } from '../tools/ExecTool.js';
import { WebSearchTool } from '../tools/WebSearchTool.js';
import { WebFetchTool } from '../tools/WebFetchTool.js';
import { FilesystemTool } from '../tools/FilesystemTool.js';
import { browserTool } from '../tools/BrowserTool.js';
import { WorkspaceBootstrapLoader } from '../workspace/WorkspaceBootstrapLoader.js';
import type { ContextEngine } from './ContextEngine.js';
import type {
  AgentDefinition,
  AgentRun,
  AgentMessage,
  RunAgentInput,
  AgentEvent,
} from './types.js';

// ── Minimal guard interface (duck-typed to avoid circular dependency) ──────────
// AgentRunner accepts any object that implements check() — including GuardEngine.

interface GuardVerdict {
  allowed: boolean;
  action: string;
  reason: string;
  warnings: string[];
}

interface GuardContext {
  operation: string;
  source: string;
  sourceId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/** Minimal guard interface — matches GuardEngine.check() signature */
export interface GuardLike {
  check(ctx: GuardContext): GuardVerdict;
}

type EventEmitter = (event: AgentEvent) => void;

// ── Tool-call constants ───────────────────────────────────────────────────────

/** Maximum number of tool-call iterations per run (prevents infinite loops). */
const MAX_TOOL_CALL_ITERATIONS = 3;

/** Maximum number of agent handoffs per run (prevents cycles). */
const MAX_HANDOFFS = 3;

/** Maximum number of sub-agent spawns per run (prevents runaway chains). */
const MAX_SPAWN_AGENT = 2;

/** Regex that finds a JSON tool-call block anywhere in a model response. */
const TOOL_CALL_RE = /\{[\s\S]*?"tool"\s*:\s*"[^"]*"[\s\S]*?\}/;

/** Regex that detects a handoff directive: {"handoff":"<agentId>","message":"<msg>"} */
const HANDOFF_RE  = /\{[\s\S]*?"handoff"\s*:\s*"[^"]*"[\s\S]*?\}/;

// ── Tool-call extraction types ────────────────────────────────────────────────

type ExecCall           = { tool: 'exec';              command: string; args: string[] };
type WebSearchCall      = { tool: 'web_search';        query: string };
type WebFetchCall       = { tool: 'web_fetch';         url: string; maxChars?: number };
type ReadFileCall       = { tool: 'read_file';         path: string };
type WriteFileCall      = { tool: 'write_file';        path: string; content: string };
type EditFileCall       = { tool: 'edit_file';         path: string; old: string; new: string };
type ApplyPatchCall     = { tool: 'apply_patch';       path: string; patch: string };
type GetPageTextCall    = { tool: 'get_page_text';     url: string };
type ShellExecCall      = { tool: 'shell_exec';        command: string; args?: string[]; cwd?: string; timeoutMs?: number };
type ListProcessesCall  = { tool: 'list_processes' };
type CustomCall         = { tool: 'custom';             name: string;   input: string };
type SpawnAgentCall     = { tool: 'spawn_agent';        agentId: string; message: string };
type SessionsListCall   = { tool: 'sessions_list';     limit?: number; agentId?: string; includeArchived?: boolean };
type SessionsHistoryCall = { tool: 'sessions_history'; conversationId: string; limit?: number };
type AnyToolCall        = ExecCall | WebSearchCall | WebFetchCall
  | ReadFileCall | WriteFileCall | EditFileCall | ApplyPatchCall
  | GetPageTextCall
  | ShellExecCall | ListProcessesCall
  | CustomCall | SpawnAgentCall
  | SessionsListCall | SessionsHistoryCall;

/**
 * Attempt to extract a handoff directive from a model response.
 * Format: {"handoff":"<agentId>","message":"<msg>"}
 * Returns { agentId, message } or null.
 */
function extractHandoff(response: string): { agentId: string; message: string } | null {
  const match = response.match(HANDOFF_RE);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof parsed['handoff'] === 'string' && parsed['handoff'].length > 0 &&
        typeof parsed['message'] === 'string') {
      return { agentId: parsed['handoff'] as string, message: parsed['message'] as string };
    }
  } catch { /* malformed JSON — ignore */ }
  return null;
}

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
      const maxChars = typeof parsed['maxChars'] === 'number' && parsed['maxChars'] > 0
        ? parsed['maxChars'] : undefined;
      return { tool: 'web_fetch', url: parsed['url'] as string, maxChars };
    }

    if (tool === 'spawn_agent' &&
        typeof parsed['agentId'] === 'string' && parsed['agentId'].length > 0 &&
        typeof parsed['message'] === 'string') {
      return { tool: 'spawn_agent', agentId: parsed['agentId'] as string, message: parsed['message'] as string };
    }

    if (tool === 'read_file' && typeof parsed['path'] === 'string' && parsed['path'].length > 0) {
      return { tool: 'read_file', path: parsed['path'] as string };
    }

    if (tool === 'write_file' && typeof parsed['path'] === 'string' && parsed['path'].length > 0 &&
        typeof parsed['content'] === 'string') {
      return { tool: 'write_file', path: parsed['path'] as string, content: parsed['content'] as string };
    }

    if (tool === 'edit_file' && typeof parsed['path'] === 'string' && parsed['path'].length > 0 &&
        typeof parsed['old'] === 'string' && typeof parsed['new'] === 'string') {
      return { tool: 'edit_file', path: parsed['path'] as string, old: parsed['old'] as string, new: parsed['new'] as string };
    }

    if (tool === 'apply_patch' && typeof parsed['path'] === 'string' && parsed['path'].length > 0 &&
        typeof parsed['patch'] === 'string') {
      return { tool: 'apply_patch', path: parsed['path'] as string, patch: parsed['patch'] as string };
    }

    if (tool === 'get_page_text' && typeof parsed['url'] === 'string' && parsed['url'].length > 0) {
      return { tool: 'get_page_text', url: parsed['url'] as string };
    }

    if (tool === 'shell_exec' && typeof parsed['command'] === 'string' && parsed['command'].length > 0) {
      const args = Array.isArray(parsed['args'])
        ? (parsed['args'] as unknown[]).filter(a => typeof a === 'string').map(String)
        : undefined;
      const cwd = typeof parsed['cwd'] === 'string' ? parsed['cwd'] : undefined;
      const timeoutMs = typeof parsed['timeoutMs'] === 'number' ? parsed['timeoutMs'] : undefined;
      return { tool: 'shell_exec', command: parsed['command'] as string, args, cwd, timeoutMs };
    }

    if (tool === 'list_processes') {
      return { tool: 'list_processes' };
    }

    if (tool === 'sessions_list') {
      return {
        tool: 'sessions_list',
        limit: typeof parsed['limit'] === 'number' ? parsed['limit'] : undefined,
        agentId: typeof parsed['agentId'] === 'string' ? parsed['agentId'] : undefined,
        includeArchived: typeof parsed['includeArchived'] === 'boolean' ? parsed['includeArchived'] : undefined,
      };
    }

    if (tool === 'sessions_history' && typeof parsed['conversationId'] === 'string' && parsed['conversationId'].length > 0) {
      return {
        tool: 'sessions_history',
        conversationId: parsed['conversationId'] as string,
        limit: typeof parsed['limit'] === 'number' ? parsed['limit'] : undefined,
      };
    }

    // Custom webhook tool — any other tool name with an "input" field
    if (typeof tool === 'string' && tool.length > 0 && typeof parsed['input'] === 'string') {
      return { tool: 'custom', name: tool, input: parsed['input'] as string };
    }
  } catch { /* malformed JSON — ignore */ }
  return null;
}

// Singleton tool instances — read-only, stateless, safe to share
const webSearchTool  = new WebSearchTool();
const webFetchTool   = new WebFetchTool();
const filesystemTool = new FilesystemTool(); // default allowed root: process.cwd()

// ── Handoff type ─────────────────────────────────────────────────────────────

/**
 * Optional callback supplied by AgentOrchestrator so AgentRunner can dispatch
 * handoffs without a circular dependency.  Returns the response string from the
 * target agent, or null if the target agent does not exist.
 */
export type HandoffResolver = (targetAgentId: string, message: string) => Promise<string | null>;

/**
 * Optional callback for dispatching custom webhook tool calls.
 * Returns the response string or throws on error.
 */
export type CustomToolDispatcher = (toolName: string, input: string, agentId: string) => Promise<string | null>;

/**
 * Optional callback for spawning a sub-agent.
 * Provided by AgentOrchestrator — looks up the agent by ID and runs it.
 * Returns the sub-agent's output string (with appended spawn stats), or null if the agent does not exist.
 * A separate callback (rather than a direct registry reference) avoids circular deps.
 */
export type SpawnAgentResolver = (agentId: string, message: string, parentRunId?: string) => Promise<string | null>;

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

/** NO_REPLY sentinel — when a model response consists solely of this token, suppress the outbound reply. */
export const NO_REPLY = 'NO_REPLY';

export class AgentRunner {
  private activeRuns = new Map<string, { run: AgentRun; stop: () => void; controller: AbortController }>();
  private spawnCount = 0; // per-run counter, reset in run()

  constructor(
    private readonly memory: MemoryEngine | null,
    private readonly models: ModelEngine | null,
    private readonly recordLearning?: LearningRecorder,
    private readonly execTool?: ExecTool | null,
    private readonly handoffResolver?: HandoffResolver | null,
    private readonly customToolDispatcher?: CustomToolDispatcher | null,
    private readonly spawnAgentResolver?: SpawnAgentResolver | null,
    private readonly guard?: GuardLike | null,
    /** Global workspace directory — used when agent.workspaceDir is not set. */
    private readonly globalWorkspaceDir?: string | null,
    /** Optional context engine for controlling context window assembly. */
    private readonly contextEngine?: ContextEngine | null,
    /**
     * IANA timezone string for the Current Date & Time section in the system prompt.
     * When set, local time is shown alongside UTC. Example: 'America/New_York'.
     */
    private readonly userTimezone?: string | null,
    /**
     * Preferred time format: 'auto' detects 12/24 from locale, '12' forces AM/PM,
     * '24' forces 24-hour. Defaults to 'auto'.
     */
    private readonly timeFormat?: 'auto' | '12' | '24' | null,
    /**
     * Controls whether a truncation warning block is appended to Project Context
     * when any bootstrap file was truncated.
     * 'off'    — no warning.
     * 'once'   — warn on the first run of each session (treated as 'always' here
     *            since runner has no cross-run session state).
     * 'always' — always append the warning when truncation occurs.
     * Default: 'once'.
     */
    private readonly bootstrapTruncationWarning?: 'off' | 'once' | 'always' | null,
  ) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildBootstrapContext(agent: AgentDefinition, input: RunAgentInput): string {
    const promptMode = input.promptMode ?? 'full';
    if (promptMode === 'none') return '';

    // Resolve workspace directory: run override → agent → global
    const workspaceDir =
      input.workspaceDirOverride ??
      agent.workspaceDir ??
      this.globalWorkspaceDir ??
      null;

    if (!workspaceDir) return '';

    const loader = new WorkspaceBootstrapLoader(workspaceDir);
    const result = loader.load(promptMode);

    // Append truncation warning when any file was truncated and warning mode is enabled.
    // 'once' is treated equivalently to 'always' since AgentRunner has no cross-run
    // session state to track "already warned this session".
    const warnMode = this.bootstrapTruncationWarning ?? 'once';
    if (warnMode !== 'off') {
      const truncated = result.files.filter(f => f.status === 'truncated');
      if (truncated.length > 0) {
        const names = truncated.map(f => f.name).join(', ');
        const warning = `\n\n> **Note:** The following workspace file(s) were truncated to fit the context window: ${names}. Use the \`read_file\` tool to access their full content.`;
        return result.projectContext + warning;
      }
    }

    return result.projectContext;
  }

  private async buildMemoryContext(agent: AgentDefinition, input: string, runId: string): Promise<{ memoryContext: string; memoryIdsUsed: string[] }> {
    const memoryIdsUsed: string[] = [];
    let memoryContext = '';

    if (this.memory) {
      // Per-agent scope enforcement:
      // - 'agent' scope: strictly isolated — only this agent's own memories (scope_id = agent.id).
      //   User/global memories are NOT included so that agent data stays private to the agent.
      // - 'workspace' / 'session': fetch scoped memories AND global user memories, merged up to 10.
      const agentResults = await this.memory.search(
        { scope: agent.memoryScope, scope_id: agent.id, limit: 8 },
        input,
      );

      let allResults = agentResults;

      if (agent.memoryScope !== 'agent') {
        // Non-isolated scopes include global user memories as additional context.
        const userResults = await this.memory.search({ scope: 'user', limit: 4 }, input);
        allResults = [...agentResults, ...userResults].slice(0, 10);
      }

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
    bootstrapContext?: string,
  ): AgentMessage[] {
    // ── Date/Time section ──────────────────────────────────────────────────
    const now = new Date();
    const dateTimeLines = ['\n\n## Date / Time'];
    if (this.userTimezone) {
      try {
        // Determine hour-cycle from timeFormat setting
        const hourCycle =
          this.timeFormat === '12' ? 'h12' :
          this.timeFormat === '24' ? 'h23' :
          undefined; // 'auto' — let Intl decide from locale
        const localDateStr = now.toLocaleDateString('en-US', {
          timeZone: this.userTimezone,
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        });
        const localTimeStr = now.toLocaleTimeString('en-US', {
          timeZone: this.userTimezone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle,
        });
        dateTimeLines.push(`${localDateStr}, ${localTimeStr} (${this.userTimezone})`);
      } catch {
        // Invalid timezone — fall back to UTC only
        dateTimeLines.push(`Today is ${now.toISOString().slice(0, 10)}, ${now.toUTCString().slice(17, 22)} UTC.`);
      }
    } else {
      dateTimeLines.push(`Today is ${now.toISOString().slice(0, 10)}, ${now.toUTCString().slice(17, 22)} UTC.`);
    }
    const dateTimeSection = dateTimeLines.join('\n');

    // ── Runtime metadata section ───────────────────────────────────────────
    const runtimeLines = ['\n\n## Runtime', `Agent ID: ${agent.id}`];
    if (input.runId) runtimeLines.push(`Run ID: ${input.runId}`);
    const runtimeSection = runtimeLines.join('\n');

    const systemPrompt = [
      agent.systemPrompt,
      input.contextOverride ? `\nAdditional context:\n${input.contextOverride}` : '',
      memoryContext,
      dateTimeSection,
      runtimeSection,
      bootstrapContext ? `\n\n${bootstrapContext}` : '',
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
    allowedTools?: string[],
    deniedTools?: string[],
    allowedAgentTargets?: string[],
  ): Promise<boolean> {
    const call = extractToolCall(response);
    if (!call) return false;

    const effectiveToolName = call.tool === 'custom' ? call.name : call.tool;

    // Check deniedTools first — explicit deny overrides allowlist
    if (deniedTools && deniedTools.length > 0 && deniedTools.includes(effectiveToolName)) {
      const toolResult = `Tool "${effectiveToolName}" is not permitted for this agent (denied by policy).`;
      const toolMsg: AgentMessage = { role: 'user', content: toolResult, timestamp: Date.now() };
      messages.push(toolMsg);
      emit({ type: 'run:turn', runId, agentId, payload: { turn: -1, message: toolMsg }, timestamp: Date.now() });
      return true;
    }

    // Check allowedTools — when set, only listed tools are permitted
    if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(effectiveToolName)) {
      const toolResult = `Tool "${effectiveToolName}" is not allowed for this agent. Allowed tools: ${allowedTools.join(', ')}.`;
      const toolMsg: AgentMessage = { role: 'user', content: toolResult, timestamp: Date.now() };
      messages.push(toolMsg);
      emit({ type: 'run:turn', runId, agentId, payload: { turn: -1, message: toolMsg }, timestamp: Date.now() });
      return true; // handled (let the model see the denial and respond)
    }

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
      // Guard check — network:search
      if (this.guard) {
        const verdict = this.guard.check({
          operation: 'network:search',
          source: 'agent',
          sourceId: agentId,
          content: call.query,
        });
        if (!verdict.allowed) {
          toolResult = `Tool web_search blocked by policy: ${verdict.reason}`;
          const toolMsg: AgentMessage = { role: 'user', content: toolResult, timestamp: Date.now() };
          messages.push(toolMsg);
          emit({ type: 'run:turn', runId, agentId, payload: { turn: -1, message: toolMsg }, timestamp: Date.now() });
          return true;
        }
      }
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
      // Guard check — network:fetch
      if (this.guard) {
        const verdict = this.guard.check({
          operation: 'network:fetch',
          source: 'agent',
          sourceId: agentId,
          metadata: { url: call.url },
        });
        if (!verdict.allowed) {
          toolResult = `Tool web_fetch blocked by policy: ${verdict.reason}`;
          const toolMsg: AgentMessage = { role: 'user', content: toolResult, timestamp: Date.now() };
          messages.push(toolMsg);
          emit({ type: 'run:turn', runId, agentId, payload: { turn: -1, message: toolMsg }, timestamp: Date.now() });
          return true;
        }
      }
      try {
        const result = await webFetchTool.fetch(call.url, call.maxChars);
        if ('error' in result && result.error === 'SSRF_BLOCKED') {
          toolResult = `Tool web_fetch blocked (SSRF protection): ${result.reason}`;
        } else {
          const fetchResult = result as import('../tools/WebFetchTool.js').WebFetchResult;
          toolResult = [
            `Web fetch result for ${call.url}:`,
            fetchResult.truncated
              ? `(content truncated at ${fetchResult.content.length} chars — original: ${fetchResult.contentLength} chars)`
              : `(${fetchResult.contentLength} chars)`,
            '',
            fetchResult.content,
          ].join('\n');
        }
      } catch (err) {
        toolResult = `Tool web_fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (call.tool === 'get_page_text') {
      try {
        const result = await browserTool.getPageText(call.url);
        if (!result.ok) {
          toolResult = `Tool get_page_text failed: ${result.error}`;
        } else {
          toolResult = [
            `Page text from ${call.url} (source: ${result.source}):`,
            result.text ?? '(empty)',
          ].join('\n');
        }
      } catch (err) {
        toolResult = `Tool get_page_text failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (call.tool === 'read_file' || call.tool === 'write_file' || call.tool === 'edit_file' || call.tool === 'apply_patch') {
      const fsResult = filesystemTool.dispatch(call as import('../tools/FilesystemTool.js').FsCall);
      toolResult = fsResult.ok
        ? `Tool ${call.tool} succeeded:\n${fsResult.output}`
        : `Tool ${call.tool} failed: ${fsResult.output}`;
    } else if (call.tool === 'spawn_agent') {
      if (allowedAgentTargets !== undefined && allowedAgentTargets.length === 0) {
        toolResult = `spawn_agent: delegation to other agents is disabled for this agent.`;
      } else if (allowedAgentTargets && allowedAgentTargets.length > 0 && !allowedAgentTargets.includes(call.agentId)) {
        toolResult = `spawn_agent: agent "${call.agentId}" is not in this agent's allowed delegation targets.`;
      } else if (!this.spawnAgentResolver) {
        toolResult = `Tool "spawn_agent" called but no spawn resolver is configured.`;
      } else if (this.spawnCount >= MAX_SPAWN_AGENT) {
        toolResult = `Tool "spawn_agent" cap reached (max ${MAX_SPAWN_AGENT} spawns per run). Cannot spawn agent "${call.agentId}".`;
      } else {
        this.spawnCount++;
        try {
          const result = await this.spawnAgentResolver(call.agentId, call.message, runId);
          if (result === null) {
            toolResult = `spawn_agent: agent "${call.agentId}" not found.`;
          } else {
            toolResult = `Spawned agent "${call.agentId}" response:\n${result}`;
          }
        } catch (err) {
          toolResult = `spawn_agent "${call.agentId}" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'shell_exec') {
      if (!this.customToolDispatcher) {
        toolResult = `Tool "shell_exec" called but no shell tool dispatcher is configured.`;
      } else {
        try {
          const input = JSON.stringify({ command: call.command, args: call.args, cwd: call.cwd, timeoutMs: call.timeoutMs });
          const result = await this.customToolDispatcher('shell_exec', input, agentId);
          if (result === null) {
            toolResult = `Tool "shell_exec" is not available.`;
          } else {
            toolResult = `Tool result for shell_exec:\n${result}`;
          }
        } catch (err) {
          toolResult = `Tool "shell_exec" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'list_processes') {
      if (!this.customToolDispatcher) {
        toolResult = `Tool "list_processes" called but no shell tool dispatcher is configured.`;
      } else {
        try {
          const result = await this.customToolDispatcher('list_processes', '{}', agentId);
          if (result === null) {
            toolResult = `Tool "list_processes" is not available.`;
          } else {
            toolResult = `Tool result for list_processes:\n${result}`;
          }
        } catch (err) {
          toolResult = `Tool "list_processes" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'sessions_list') {
      if (!this.customToolDispatcher) {
        toolResult = 'Tool "sessions_list" is not available in this configuration.';
      } else {
        try {
          const params = JSON.stringify({
            limit:           call.limit,
            agentId:         call.agentId,
            includeArchived: call.includeArchived,
          });
          const result = await this.customToolDispatcher('sessions_list', params, agentId);
          if (result === null) {
            toolResult = 'Tool "sessions_list" is not available.';
          } else {
            toolResult = `Tool result for sessions_list:\n${result}`;
          }
        } catch (err) {
          toolResult = `Tool "sessions_list" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'sessions_history') {
      if (!this.customToolDispatcher) {
        toolResult = 'Tool "sessions_history" is not available in this configuration.';
      } else {
        try {
          const params = JSON.stringify({
            conversationId: call.conversationId,
            limit:          call.limit,
          });
          const result = await this.customToolDispatcher('sessions_history', params, agentId);
          if (result === null) {
            toolResult = 'Tool "sessions_history" is not available.';
          } else {
            toolResult = `Tool result for sessions_history:\n${result}`;
          }
        } catch (err) {
          toolResult = `Tool "sessions_history" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    } else if (call.tool === 'custom') {
      // Guard check — webhook:call (custom tools are typically webhook-backed)
      if (this.guard) {
        const verdict = this.guard.check({
          operation: 'webhook:call',
          source: 'agent',
          sourceId: agentId,
          metadata: { toolName: call.name },
        });
        if (!verdict.allowed) {
          toolResult = `Tool "${call.name}" blocked by policy: ${verdict.reason}`;
          const toolMsg: AgentMessage = { role: 'user', content: toolResult, timestamp: Date.now() };
          messages.push(toolMsg);
          emit({ type: 'run:turn', runId, agentId, payload: { turn: -1, message: toolMsg }, timestamp: Date.now() });
          return true;
        }
      }
      if (!this.customToolDispatcher) {
        toolResult = `Tool "${call.name}" called but no custom tool dispatcher is configured.`;
      } else {
        try {
          const result = await this.customToolDispatcher(call.name, call.input, agentId);
          if (result === null) {
            toolResult = `Tool "${call.name}" is not registered as a custom tool.`;
          } else {
            toolResult = `Tool result for "${call.name}":\n${result}`;
          }
        } catch (err) {
          toolResult = `Tool "${call.name}" failed: ${err instanceof Error ? err.message : String(err)}`;
        }
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
    // Reset per-run spawn counter at the start of every top-level run.
    this.spawnCount = 0;
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
      ...(input.requestId  && { requestId:  input.requestId }),
      ...(input.parentRunId && { parentRunId: input.parentRunId }),
    };

    this.activeRuns.set(runId, { run, stop: stopFn, controller });

    emit({ type: 'run:started', runId, agentId: agent.id, timestamp: Date.now() });

    try {
      const { memoryContext, memoryIdsUsed } = await this.buildMemoryContext(agent, input.input, runId);
      run.memoryIdsUsed = memoryIdsUsed;

      const bootstrapContext = this.buildBootstrapContext(agent, input);
      const messages = this.buildMessages(agent, input, memoryContext, input.contextMessages, bootstrapContext);
      run.messages = messages;

      // Conversation loop
      if (!this.models || this.models.stats().providerCount === 0) {
        throw new Error('No model provider configured. Add a provider in the Models tab.');
      }

      let turn = 0;
      while (turn < agent.maxTurns && !stopped) {

        const effectiveModel = input.modelOverride ?? agent.modelId;
        const turnSignal = withTimeout(controller.signal, INFERENCE_TIMEOUT_MS);
        // Assemble context window (ContextEngine may trim or reorder messages)
        const assembled = this.contextEngine ? this.contextEngine.assemble(messages) : messages;
        const response = await this.models.infer(
          {
            messages: assembled.map(m => ({ role: m.role, content: m.content })),
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
        // Post-turn hook
        this.contextEngine?.afterTurn(messages, response.content);
        run.modelUsed = `${response.providerId}/${response.model}`;
        if (response.selectionReason)                    run.selectionReason  = response.selectionReason;
        if (response.fallbackOccurred)                   run.fallbackOccurred = response.fallbackOccurred;
        if (typeof response.retryCount === 'number')     run.retryCount       = response.retryCount;
        if (typeof response.promptTokens === 'number')     run.promptTokens     = (run.promptTokens     ?? 0) + response.promptTokens;
        if (typeof response.completionTokens === 'number') run.completionTokens = (run.completionTokens ?? 0) + response.completionTokens;

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
            agent.allowedTools,
            agent.deniedTools,
            agent.allowedAgentTargets,
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

          if (typeof toolResponse.promptTokens === 'number')     run.promptTokens     = (run.promptTokens     ?? 0) + toolResponse.promptTokens;
          if (typeof toolResponse.completionTokens === 'number') run.completionTokens = (run.completionTokens ?? 0) + toolResponse.completionTokens;
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

        // ── Handoff detection ─────────────────────────────────────────────
        // If the model response contains a handoff directive and a resolver is
        // available, dispatch the message to the target agent and return its
        // response as the final output.  Capped at MAX_HANDOFFS per run.
        let handoffCount = 0;
        let currentOutput = run.output ?? response.content;
        while (handoffCount < MAX_HANDOFFS && this.handoffResolver && !stopped) {
          const handoff = extractHandoff(currentOutput);
          if (!handoff) break;
          // Enforce allowedAgentTargets for handoffs
          if (agent.allowedAgentTargets !== undefined && agent.allowedAgentTargets.length === 0) {
            currentOutput = `Handoff to agent "${handoff.agentId}" denied: delegation is disabled for this agent.`;
            run.output = currentOutput;
            handoffCount++;
            break;
          }
          if (agent.allowedAgentTargets && agent.allowedAgentTargets.length > 0 && !agent.allowedAgentTargets.includes(handoff.agentId)) {
            currentOutput = `Handoff to agent "${handoff.agentId}" denied: not in this agent's allowed delegation targets.`;
            run.output = currentOutput;
            handoffCount++;
            break;
          }
          const handoffResult = await this.handoffResolver(handoff.agentId, handoff.message);
          if (handoffResult === null) {
            // Target agent not found — treat as a normal response
            currentOutput = `Handoff to agent "${handoff.agentId}" failed: agent not found.`;
          } else {
            currentOutput = handoffResult;
          }
          run.output = currentOutput;
          handoffCount++;
        }
        // ── End handoff detection ─────────────────────────────────────────

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

        // Filter NO_REPLY sentinel — suppress output when the model signals silence
        if (run.output?.trim() === NO_REPLY) run.output = undefined;

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
      ...(input.requestId  && { requestId:  input.requestId }),
      ...(input.parentRunId && { parentRunId: input.parentRunId }),
    };

    this.activeRuns.set(runId, { run, stop: stopFn, controller });
    emit({ type: 'run:started', runId, agentId: agent.id, timestamp: Date.now() });

    try {
      const { memoryContext, memoryIdsUsed } = await this.buildMemoryContext(agent, input.input, runId);
      run.memoryIdsUsed = memoryIdsUsed;

      const bootstrapContext = this.buildBootstrapContext(agent, input);
      const messages = this.buildMessages(agent, input, memoryContext, input.contextMessages, bootstrapContext);
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
          // Assemble context window for this turn
          const assembledStream = this.contextEngine ? this.contextEngine.assemble(messages) : messages;

          for await (const chunk of this.models.inferStream(
            {
              messages: assembledStream.map(m => ({ role: m.role, content: m.content })),
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
              if (typeof chunk.promptTokens === 'number')     run.promptTokens     = (run.promptTokens     ?? 0) + chunk.promptTokens;
              if (typeof chunk.completionTokens === 'number') run.completionTokens = (run.completionTokens ?? 0) + chunk.completionTokens;
            }
          }
          streamSignal.clear();

          const assistantMsg: AgentMessage = { role: 'assistant', content: fullContent, timestamp: Date.now() };
          messages.push(assistantMsg);
          // Post-turn hook
          this.contextEngine?.afterTurn(messages, fullContent);
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

        // Filter NO_REPLY sentinel — suppress output when the model signals silence
        if (run.output?.trim() === NO_REPLY) run.output = undefined;

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
