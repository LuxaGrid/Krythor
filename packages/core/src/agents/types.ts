// ─── Agent definition ─────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId?: string;        // agent-specific model override (null = use global default)
  providerId?: string;     // agent-specific provider override
  memoryScope: 'session' | 'agent' | 'workspace';
  maxTurns: number;        // max conversation turns per run (default 10)
  temperature?: number;
  maxTokens?: number;
  tags: string[];
  /**
   * Optional allowlist of tool names this agent is permitted to call.
   * When undefined or empty, all tools are allowed (default behaviour).
   * Example: ["web_search", "web_fetch"]
   */
  allowedTools?: string[];
  /**
   * Optional denylist of tool names this agent is never permitted to call,
   * regardless of allowedTools. Evaluated after allowedTools — a tool that
   * appears in both lists is denied. When undefined or empty, no extra tools
   * are denied beyond the allowedTools restriction (if any).
   * Example: ["write_file", "apply_patch"]
   */
  deniedTools?: string[];
  /**
   * Optional allowlist of agent IDs this agent may delegate to via handoff
   * or spawn_agent. When undefined or empty, any registered agent may be
   * targeted (default behaviour). Set to [] to disable all delegation.
   * Example: ["summariser", "coder"]
   */
  allowedAgentTargets?: string[];
  /**
   * Optional idle timeout in milliseconds. If a run is still active after this
   * duration it is automatically stopped by the orchestrator janitor.
   * Default: undefined (no timeout). Example: 300000 (5 minutes).
   */
  idleTimeoutMs?: number;
  /**
   * Optional workspace directory for this agent.
   * When set, bootstrap files are loaded from this directory and injected into
   * the system prompt. When unset, the global workspace is used (if configured).
   */
  workspaceDir?: string;
  /**
   * When true, skip creating BOOTSTRAP.md for a new workspace (pre-seeded workspaces).
   */
  skipBootstrap?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Agent run ────────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: AgentStatus;
  input: string;
  messages: AgentMessage[];
  output?: string;
  modelUsed?: string;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  memoryIdsUsed: string[];
  memoryIdsWritten: string[];
  requestId?: string;          // HTTP requestId for end-to-end log correlation
  selectionReason?: string;    // why this model/provider was selected
  fallbackOccurred?: boolean;  // true if a fallback provider was used
  retryCount?: number;         // number of inference retry attempts (0 = first attempt succeeded)
  promptTokens?: number;       // total prompt/input tokens across all inference turns
  completionTokens?: number;   // total completion/output tokens across all inference turns
  parentRunId?: string;        // run ID of the parent that spawned or handed off to this run
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt: string;
  modelId?: string;
  providerId?: string;
  memoryScope?: AgentDefinition['memoryScope'];
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  tags?: string[];
  allowedTools?: string[];
  deniedTools?: string[];
  allowedAgentTargets?: string[];
  idleTimeoutMs?: number;
  workspaceDir?: string;
  skipBootstrap?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  providerId?: string;
  memoryScope?: AgentDefinition['memoryScope'];
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
  tags?: string[];
  allowedTools?: string[] | null;
  deniedTools?: string[] | null;
  allowedAgentTargets?: string[] | null;
  idleTimeoutMs?: number | null;
  workspaceDir?: string | null;
  skipBootstrap?: boolean;
}

export interface RunAgentInput {
  input: string;
  taskId?: string;         // optional task correlation ID
  contextOverride?: string; // inject extra context into system prompt
  modelOverride?: string;  // overrides agent.modelId for this run only
  contextMessages?: Array<{ role: string; content: string }>; // conversation history to prepend
  runId?: string;          // pre-specified run ID for SSE correlation
  requestId?: string;      // HTTP requestId for end-to-end log correlation
  parentRunId?: string;    // run ID of the spawning parent (set by orchestrator on spawn/handoff)
  /**
   * Controls which system prompt sections and bootstrap files are injected.
   * 'full'    — all sections + all workspace files (default)
   * 'minimal' — sub-agent mode: only AGENTS.md + TOOLS.md, fewer prompt sections
   * 'none'    — bare system prompt (agent.systemPrompt only)
   */
  promptMode?: 'full' | 'minimal' | 'none';
  /**
   * Override the workspace directory for this specific run.
   * Falls back to agent.workspaceDir, then the global workspace.
   */
  workspaceDirOverride?: string;
}

// ─── Events (for streaming to UI via WebSocket) ───────────────────────────────

export type AgentEventType =
  | 'run:started'
  | 'run:turn'
  | 'run:stream:chunk'
  | 'run:spawn_announced'
  | 'run:completed'
  | 'run:failed'
  | 'run:stopped';

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  agentId: string;
  payload?: unknown;
  timestamp: number;
}
