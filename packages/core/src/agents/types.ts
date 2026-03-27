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
  idleTimeoutMs?: number;
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
  idleTimeoutMs?: number | null;
}

export interface RunAgentInput {
  input: string;
  taskId?: string;         // optional task correlation ID
  contextOverride?: string; // inject extra context into system prompt
  modelOverride?: string;  // overrides agent.modelId for this run only
  contextMessages?: Array<{ role: string; content: string }>; // conversation history to prepend
  runId?: string;          // pre-specified run ID for SSE correlation
  requestId?: string;      // HTTP requestId for end-to-end log correlation
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
