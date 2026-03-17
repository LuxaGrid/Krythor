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
}

export interface RunAgentInput {
  input: string;
  taskId?: string;         // optional task correlation ID
  contextOverride?: string; // inject extra context into system prompt
  modelOverride?: string;  // overrides agent.modelId for this run only
  contextMessages?: Array<{ role: string; content: string }>; // conversation history to prepend
  runId?: string;          // pre-specified run ID for SSE correlation
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
