const BASE = '/api';

// ── Auth token ──────────────────────────────────────────────────────────────
// The gateway injects the token into index.html at serve time as
// window.__KRYTHOR_TOKEN__. We read it once on module load, persist it to
// localStorage for use across refreshes, and use it for all subsequent API
// calls. setGatewayToken() is kept for callers that need to override at runtime.
let _gatewayToken: string | undefined = (() => {
  // 1. Prefer the value injected into the page at serve time (most secure)
  const injected = (window as unknown as Record<string, unknown>)['__KRYTHOR_TOKEN__'];
  if (typeof injected === 'string' && injected.length > 0) {
    try { localStorage.setItem('krythor_token', injected); } catch { /* private browsing */ }
    return injected;
  }
  // 2. Fall back to localStorage (survives page refresh after first load)
  try {
    const stored = localStorage.getItem('krythor_token');
    if (stored) return stored;
  } catch { /* private browsing */ }
  return undefined;
})();

export function setGatewayToken(token: string | undefined): void {
  _gatewayToken = token;
  try {
    if (token) localStorage.setItem('krythor_token', token);
    else localStorage.removeItem('krythor_token');
  } catch { /* private browsing */ }
}

export function getGatewayToken(): string | undefined {
  return _gatewayToken;
}

async function req<T>(method: string, path: string, body?: unknown, baseOverride?: string): Promise<T> {
  const base = baseOverride ?? BASE;
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (_gatewayToken && base !== '') headers['Authorization'] = `Bearer ${_gatewayToken}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) {
    // Surface structured hint if available
    const msg = data?.hint ? `${data.error}: ${data.hint}` : (data?.error ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return data as T;
}

// ── Health ─────────────────────────────────────────────────────────────────
export const health = () => req<Health>('GET', '/health', undefined, '');

export interface CircuitStat {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureAt: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  avgLatencyMs: number;
}

export interface HeartbeatInsight {
  type:             'heartbeat_insight';
  checkId:          string;
  severity:         'info' | 'warning';
  message:          string;
  actionable:       boolean;
  suggestedAction?: string;
  timestamp:        string;
}

export interface HeartbeatLastRun {
  startedAt:    number;
  completedAt?: number;
  durationMs?:  number;
  checksRan:    string[];
  insights:     HeartbeatInsight[];
  timedOut:     boolean;
  error?:       string;
}

export interface PersistedHeartbeatWarning {
  id:               string;
  recordedAt:       number;
  checkId:          string;
  severity:         'warning';
  message:          string;
  actionable:       boolean;
  suggestedAction?: string;
}

export interface Health {
  status: string;
  version: string;
  nodeVersion?: string;
  timestamp: string;
  firstRun: boolean;
  dataDir?: string;
  configDir?: string;
  memory: { totalEntries: number; embeddingProvider: string; embeddingDegraded?: boolean; semantic?: boolean };
  models: { providerCount: number; modelCount: number; hasDefault: boolean };
  circuits?: Record<string, CircuitStat>;
  guard: { ruleCount: number; enabledRules: number; defaultAction: string };
  agents: { agentCount: number; activeRuns: number; totalRuns: number };
  heartbeat?: {
    enabled:    boolean;
    recentRuns: number;
    lastRun?:   HeartbeatLastRun;
    warnings:   HeartbeatInsight[];
  };
}

// ── App Config ─────────────────────────────────────────────────────────────
export const getAppConfig    = () => req<AppConfig>('GET', '/config');
export const patchAppConfig  = (p: Partial<AppConfig>) => req<AppConfig>('PATCH', '/config', p);

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
}

// ── Command ────────────────────────────────────────────────────────────────
export const runCommand = (input: string, agentId?: string, modelId?: string, conversationId?: string) =>
  req<CommandResult>('POST', '/command', {
    input,
    ...(agentId        && { agentId }),
    ...(modelId        && { modelId }),
    ...(conversationId && { conversationId }),
  });

export interface CommandResult {
  input: string;
  output: string;
  timestamp: string;
  processingTimeMs: number;
  modelUsed?: string;
  agentId?: string;
  runId?: string;
  conversationId?: string;
  status?: string;
  noProvider?: boolean;
  error?: { code: string; error: string; hint: string };
}

// ── Streaming command ──────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'delta'; content: string; runId?: string }
  | { type: 'done'; runId?: string; duration: number; output: string; modelUsed?: string; conversationId?: string; selectionReason?: string | null; fallbackOccurred?: boolean }
  | { type: 'conversation'; conversationId: string; title: string }
  | { type: 'error'; message: string };

export function streamCommand(
  input: string,
  conversationId?: string,
  agentId?: string,
  modelId?: string,
  onEvent?: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const streamHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_gatewayToken) streamHeaders['Authorization'] = `Bearer ${_gatewayToken}`;
  return fetch('/api/command', {
    method: 'POST',
    headers: streamHeaders,
    body: JSON.stringify({
      input,
      stream: true,
      ...(agentId        && { agentId }),
      ...(modelId        && { modelId }),
      ...(conversationId && { conversationId }),
    }),
    signal,
  }).then(async (response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            onEvent?.(event);
          } catch { /* ignore malformed */ }
        }
      }
    }
  });
}

// ── Conversations ──────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  agentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId: string | null;
  providerId: string | null;
  createdAt: number;
}

export const listConversations  = () => req<Conversation[]>('GET', '/conversations');
export const createConversation = (agentId?: string) => req<Conversation>('POST', '/conversations', { agentId });
export const deleteConversation        = (id: string) => req<void>('DELETE', `/conversations/${id}`);
export const updateConversation        = (id: string, title: string) => req<Conversation>('PATCH', `/conversations/${id}`, { title });
export const getMessages               = (id: string) => req<Message[]>('GET', `/conversations/${id}/messages`);
export const deleteLastAssistantMessage = (id: string) => req<void>('DELETE', `/conversations/${id}/messages/last-assistant`);
export const exportConversation = async (id: string, format: 'json' | 'markdown', title: string): Promise<void> => {
  const res = await fetch(`${BASE}/conversations/${id}/export?format=${format}`, {
    headers: _gatewayToken ? { Authorization: `Bearer ${_gatewayToken}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ext = format === 'markdown' ? 'md' : 'json';
  const safeName = title.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || id;
  a.download = `${safeName}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Memory ─────────────────────────────────────────────────────────────────
export const listMemory = (params?: { text?: string; scope?: string; tags?: string; limit?: number; offset?: number }) => {
  const qs = params ? '?' + new URLSearchParams(Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )).toString() : '';
  return req<MemorySearchResult[]>('GET', `/memory${qs}`);
};
export const createMemory = (body: { title: string; content: string; scope: string; tags?: string[]; importance?: number }) =>
  req<{ entry: MemoryEntry }>('POST', '/memory', {
    ...body,
    source: 'user',
    importance: body.importance !== undefined ? body.importance / 100 : undefined,
  }).then(r => r.entry);
export const updateMemory = (id: string, body: { title?: string; content?: string; tags?: string[]; importance?: number }) =>
  req<MemoryEntry>('PATCH', `/memory/${id}`, {
    ...body,
    importance: body.importance !== undefined ? body.importance / 100 : undefined,
  });
export const deleteMemory = (id: string) => req<void>('DELETE', `/memory/${id}`);
export const pinMemory    = (id: string) => req<MemoryEntry>('POST', `/memory/${id}/pin`);
export const unpinMemory  = (id: string) => req<MemoryEntry>('POST', `/memory/${id}/unpin`);
export const memoryStats  = () => req<MemoryStats>('GET', '/memory/stats');
export const pruneMemory     = (maxEntries?: number) => req<{ deleted: number; totalEntries: number }>('POST', '/memory/prune', maxEntries !== undefined ? { maxEntries } : {});
export const summarizeMemory = (scope?: string, batchSize?: number) => req<{ summarized: number; summaryEntryId?: string; totalEntries: number }>('POST', '/memory/summarize', { scope, batchSize });
export const pruneMemoryBulk = (filters: { olderThan?: string; tag?: string; source?: string }) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][])
  );
  return req<{ deleted: number }>('DELETE', `/memory?${qs.toString()}`);
};
export const exportMemory = async (): Promise<void> => {
  const res = await fetch(`${BASE}/memory/export`, {
    headers: _gatewayToken ? { Authorization: `Bearer ${_gatewayToken}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `krythor-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
export const memoryStatsDetailed = () => req<MemoryStatsDetailed>('GET', '/memory/stats');
export const listMemoryTags = () => req<{ tags: string[] }>('GET', '/memory/tags');
export interface MemoryStatsDetailed extends MemoryStats {
  oldest?: string | null;
  newest?: string | null;
  sizeEstimateBytes?: number;
}

export interface MemoryEntry {
  id: string; title: string; content: string; scope: string;
  importance: number; pinned: boolean; created_at: number; last_used: number; access_count: number;
}
export interface MemorySearchResult {
  entry: MemoryEntry;
  tags: string[];
  score: number;
}
export interface MemoryStats { totalEntries: number; embeddingProvider: string; embeddingDegraded?: boolean; semantic?: boolean }

// ── Models ─────────────────────────────────────────────────────────────────
export const listProviders  = () => req<Provider[]>('GET', '/models/providers');
export const addProvider    = (p: Omit<Provider,'id'>) => req<Provider>('POST', '/models/providers', p);
export const updateProvider = (id: string, patch: Partial<Provider>) => req<Provider>('PATCH', `/models/providers/${id}`, patch);
export const deleteProvider = (id: string) => req<void>('DELETE', `/models/providers/${id}`);
export const pingProvider   = (id: string) => req<PingResult>('POST', `/models/providers/${id}/ping`);
export const testProvider   = (id: string) => req<ProviderTestResult>('POST', `/providers/${id}/test`);
export const updateProviderMeta = (id: string, patch: { priority?: number; maxRetries?: number; isEnabled?: boolean; isDefault?: boolean }) =>
  req<ProviderSummary>('POST', `/providers/${id}`, patch);
export const refreshModels  = (id: string) => req<{ models: string[] }>('POST', `/models/providers/${id}/refresh`);
export const listModels     = () => req<ModelInfo[]>('GET', '/models');
export const getProviderCapabilities = () => req<Record<string, ProviderCapabilities>>('GET', '/models/capabilities');
export const discoverLocalModels = () => req<LocalModelDiscovery>('GET', '/local-models');

export interface ProviderTestResult { ok: boolean; latencyMs: number; model?: string; response?: string; error?: string }
export interface ProviderSummary {
  id: string; name: string; type: string; endpoint?: string; authMethod?: string;
  modelCount: number; isDefault?: boolean; isEnabled?: boolean;
  priority?: number; maxRetries?: number; setupHint?: string;
}
export interface LocalModelDiscovery {
  ollama:      { detected: boolean; baseUrl: string; models: string[] };
  lmStudio:    { detected: boolean; baseUrl: string; models: string[] };
  llamaServer: { detected: boolean; baseUrl: string };
}

// Connect a provider using an API key (guided connect flow)
export const connectProviderKey = (providerId: string, apiKey: string) =>
  req<Provider>('PATCH', `/models/providers/${providerId}`, { authMethod: 'api_key', apiKey });

// OAuth routes
export const connectOAuth = (
  providerId: string,
  account: { accountId: string; displayName?: string; accessToken: string; refreshToken?: string; expiresAt?: number },
) => req<Provider>('POST', `/models/providers/${providerId}/oauth/connect`, account);

export const disconnectOAuth = (providerId: string) =>
  req<Provider>('DELETE', `/models/providers/${providerId}/oauth/disconnect`);

export const refreshOAuthTokens = (
  providerId: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: number },
) => req<Provider>('POST', `/models/providers/${providerId}/oauth/refresh`, tokens);

export type AuthMethod = 'api_key' | 'oauth' | 'none';

export interface OAuthAccountMeta {
  /** Non-secret metadata only — tokens are never sent to the UI. */
  accountId:    string;
  displayName?: string;
  expiresAt:    number;
  connectedAt:  string;
}

export interface ProviderCapabilities {
  supportsOAuth:         boolean;
  supportsApiKey:        boolean;
  supportsCustomBaseUrl: boolean;
  supportsModelListing:  boolean;
}

export interface Provider {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  authMethod?: AuthMethod;
  /** Masked API key (last 4 chars only) — set when authMethod === 'api_key'. */
  apiKey?: string;
  /** Non-secret OAuth account metadata — set when authMethod === 'oauth'. */
  oauthAccount?: OAuthAccountMeta;
  isDefault?: boolean;
  isEnabled?: boolean;
  models?: string[];
  /**
   * Onboarding hint from the setup wizard.
   * 'oauth_available' — user skipped auth; UI should show an OAuth connect CTA.
   * Cleared once the provider is fully authenticated.
   */
  setupHint?: string;
}
export interface PingResult { ok: boolean; latencyMs: number; error?: string; lastUnavailableReason?: string }
export interface ModelInfo  { id: string; name: string; providerId: string; badges: string[] }

// ── Agents ────────────────────────────────────────────────────────────────
export const listAgents  = () => req<Agent[]>('GET', '/agents');
export const createAgent = (a: CreateAgentInput) => req<Agent>('POST', '/agents', a);
export const updateAgent = (id: string, patch: Partial<CreateAgentInput>) =>
  req<Agent>('PATCH', `/agents/${id}`, patch);
export const deleteAgent = (id: string) => req<void>('DELETE', `/agents/${id}`);
export const runAgent    = (id: string, input: string) =>
  req<AgentRun>('POST', `/agents/${id}/run`, { input });
export const agentStats  = () => req<AgentStats>('GET', '/agents/stats');
export const stopAgentRun = (runId: string) => req<void>('POST', `/agents/runs/${runId}/stop`);
export interface ParallelRunResult { agentId: string; run: AgentRun }
export const runAgentsParallel = (agentIds: string[], input: string) =>
  req<ParallelRunResult[]>('POST', '/agents/run/parallel', { agentIds, input });
export const runAgentsSequential = (agentIds: string[], input: string) =>
  req<AgentRun[]>('POST', '/agents/run/sequential', { agentIds, input });
export const listRuns    = (agentId?: string) => {
  const qs = agentId ? `?agentId=${agentId}` : '';
  return req<AgentRun[]>('GET', `/agents/runs${qs}`);
};
export const importAgent = (config: Record<string, unknown>) => req<Agent>('POST', '/agents/import', config);
export const exportAgent = async (agent: Agent): Promise<void> => {
  const res = await fetch(`${BASE}/agents/${agent.id}/export`, {
    headers: _gatewayToken ? { Authorization: `Bearer ${_gatewayToken}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `agent-${agent.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export interface Agent {
  id: string; name: string; description: string; systemPrompt: string;
  memoryScope: string; maxTurns: number; tags: string[];
  createdAt: number; updatedAt: number; modelId?: string;
  providerId?: string; temperature?: number; maxTokens?: number;
  allowedTools?: string[]; idleTimeoutMs?: number;
}
export interface CreateAgentInput {
  name: string; systemPrompt: string; description?: string;
  memoryScope?: string; maxTurns?: number; modelId?: string; providerId?: string;
  tags?: string[]; allowedTools?: string[] | null; idleTimeoutMs?: number | null;
}
export interface AgentRun {
  id: string; agentId: string; status: string; input: string;
  output?: string; modelUsed?: string; startedAt: number; completedAt?: number;
  errorMessage?: string; selectionReason?: string; fallbackOccurred?: boolean;
  memoryUsed?: number; memoryIdsUsed?: string[];
}
export interface AgentStats { agentCount: number; activeRuns: number; totalRuns: number }

// ── Guard ─────────────────────────────────────────────────────────────────
export interface GuardDecision {
  ts: number; operation: string; source: string; sourceId?: string; scope?: string;
  allowed: boolean; action: string; ruleId?: string; ruleName?: string;
  reason: string; warnings: string[];
}
export const guardDecisions    = (limit = 100) => req<GuardDecision[]>('GET', `/guard/decisions?limit=${limit}`);
export const guardStats        = () => req<GuardStats>('GET', '/guard/stats');
export const guardRules        = () => req<GuardRule[]>('GET', '/guard/rules');
export const guardCheck        = (ctx: GuardCheckInput) => req<GuardVerdict>('POST', '/guard/check', ctx);
export const createGuardRule   = (r: Omit<GuardRule,'id'>) => req<GuardRule>('POST', '/guard/rules', r);
export const addGuardRule      = createGuardRule; // alias
export const updateGuardRule   = (id: string, patch: Partial<GuardRule>) =>
  req<GuardRule>('PATCH', `/guard/rules/${id}`, patch);
export const deleteGuardRule   = (id: string) => req<void>('DELETE', `/guard/rules/${id}`);
export const setGuardDefault   = (action: 'allow' | 'deny') =>
  req<{ defaultAction: string }>('PATCH', '/guard/policy/default', { action });

export interface GuardStats { ruleCount: number; enabledRules: number; defaultAction: string }
export interface GuardRule {
  id: string; name: string; description: string; enabled: boolean;
  priority: number; condition: Record<string, unknown>; action: string; reason: string;
}
export interface GuardCheckInput {
  operation: string; source: string; scope?: string; content?: string;
}
export interface GuardVerdict {
  allowed: boolean; action: string; ruleId?: string; ruleName?: string;
  reason: string; warnings: string[];
}

// ── Embeddings ────────────────────────────────────────────────────────────────
export const getEmbeddings = () => req<{ active: string; providers: string[] }>('GET', '/models/embeddings');
export const activateEmbedding = (baseUrl: string, model: string) =>
  req<{ active: string }>('POST', '/models/embeddings/activate', { baseUrl, model });
export const deactivateEmbedding = () => req<{ active: string }>('DELETE', '/models/embeddings/active');

// ── Model recommendations ─────────────────────────────────────────────────────

export interface TaskClassification {
  taskType: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

export interface ModelRecommendation {
  modelId:    string;
  providerId: string;
  isLocal:    boolean;
  reason:     string;
  tradeoff?:  string;
  confidence: 'high' | 'medium' | 'low';
}

export interface RecommendationResult {
  classification:   TaskClassification;
  recommendation:   ModelRecommendation | null;
  availableModels:  ModelInfo[];
}

export interface TaskPreference {
  taskType:   string;
  modelId:    string;
  providerId: string;
  preference: 'always_use' | 'ask' | 'auto';
}

export const getRecommendation = (task: string) =>
  req<RecommendationResult>('GET', `/recommend?task=${encodeURIComponent(task)}`);

export const listPreferences = () => req<TaskPreference[]>('GET', '/recommend/preferences');

export const setPreference = (taskType: string, modelId: string, providerId: string, preference: TaskPreference['preference']) =>
  req<TaskPreference>('PUT', `/recommend/preferences/${encodeURIComponent(taskType)}`, { modelId, providerId, preference });

export const clearPreference = (taskType: string) =>
  req<void>('DELETE', `/recommend/preferences/${encodeURIComponent(taskType)}`);

export const reportOverride = (taskType: string, suggestedModelId: string, chosenModelId: string) =>
  req<void>('POST', '/recommend/override', { taskType, suggestedModelId, chosenModelId }).catch(() => {});

// ── Skills ────────────────────────────────────────────────────────────────────
export const listSkills    = () => req<Skill[]>('GET', '/skills');
export const listBuiltinSkills = () => req<BuiltinSkill[]>('GET', '/skills/builtins');
export const createSkill   = (s: CreateSkillInput) => req<Skill>('POST', '/skills', s);
export const updateSkill   = (id: string, patch: Partial<CreateSkillInput>) => req<Skill>('PATCH', `/skills/${id}`, patch);
export const deleteSkill   = (id: string) => req<void>('DELETE', `/skills/${id}`);
export const runSkill      = (id: string, input: string) => req<SkillRunResult>('POST', `/skills/${id}/run`, { input });

export interface BuiltinSkill {
  builtinId: string; name: string; description: string; systemPrompt: string; tags: string[];
}
export interface SkillRunResult {
  skillId: string; output: string; modelUsed?: string; durationMs: number; status: string;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard = () => req<Dashboard>('GET', '/dashboard');

// ── Token history ─────────────────────────────────────────────────────────────
export interface InferenceRecord {
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export const getTokenHistory = () =>
  req<{ history: InferenceRecord[]; windowSize: number }>('GET', '/stats/history');

export interface Dashboard {
  uptime: number;
  version: string;
  providerCount: number;
  modelCount: number;
  agentCount: number;
  memoryEntries: number;
  conversationCount: number;
  totalTokensUsed: number;
  activeWarnings: unknown[];
  lastHeartbeat: unknown | null;
}

export interface SkillTaskProfile {
  taskCategories?: string[];
  costTier?: 'local_preferred' | 'cost_aware' | 'quality_first';
  speedTier?: 'fast' | 'normal' | 'thorough';
  requiresVision?: boolean;
  localOk?: boolean;
  reasoningDepth?: 'shallow' | 'medium' | 'deep';
  privacySensitive?: boolean;
}

export interface Skill {
  id: string; name: string; description: string; systemPrompt: string;
  tags: string[]; modelId?: string; providerId?: string;
  taskProfile?: SkillTaskProfile;
  version: number; runCount: number; lastRunAt?: number;
  createdAt: number; updatedAt: number;
}
export interface CreateSkillInput {
  name: string; description?: string; systemPrompt: string;
  tags?: string[]; modelId?: string; providerId?: string;
  taskProfile?: SkillTaskProfile;
}

// ── Gateway info ──────────────────────────────────────────────────────────────
export interface GatewayInfo {
  version: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  gatewayId: string;
  startTime: string;
  capabilities: string[];
}

export const getGatewayInfo = () => req<GatewayInfo>('GET', '/gateway/info');

// ── Heartbeat history ─────────────────────────────────────────────────────────
export interface ProviderHealthEntry {
  timestamp: string;
  ok: boolean;
  latencyMs: number;
}

export const getHeartbeatHistory = () =>
  req<Record<string, ProviderHealthEntry[]>>('GET', '/heartbeat/history');

// ── Custom webhook tools ──────────────────────────────────────────────────────
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface CustomTool {
  name: string; description: string; type: 'webhook';
  url: string; method: HttpMethod;
  headers?: Record<string, string>;
  bodyTemplate?: string;
}
export const listCustomTools  = () => req<CustomTool[]>('GET', '/tools/custom');
export const createCustomTool = (tool: Omit<CustomTool, 'type'>) =>
  req<CustomTool>('POST', '/tools/custom', { ...tool, type: 'webhook' });
export const deleteCustomTool = (name: string) =>
  req<void>('DELETE', `/tools/custom/${encodeURIComponent(name)}`);

// ── Discord integration ───────────────────────────────────────────────────────
export interface DiscordConfig {
  token: string;       // masked as '***' when reading
  channelId: string;
  agentId: string;
  running: boolean;
}
export const getDiscordConfig  = () => req<DiscordConfig>('GET', '/discord');
export const setDiscordConfig  = (cfg: { token: string; channelId: string; agentId: string }) =>
  req<{ ok: boolean }>('PUT', '/discord', cfg);
export const stopDiscord       = () => req<{ ok: boolean }>('DELETE', '/discord');

// ── Plugins ───────────────────────────────────────────────────────────────────
export interface Plugin { name: string; description: string; file: string }
export const listPlugins = () => req<Plugin[]>('GET', '/plugins');

// ── Config portability ────────────────────────────────────────────────────────
export const exportProviderConfig = () => req<{ providers: unknown[] }>('GET', '/config/export');
export const importProviderConfig = (providers: unknown[]) =>
  req<{ imported: number; updated: number; skipped: number }>('POST', '/config/import', { providers });

// ── Outbound channels (webhooks) ──────────────────────────────────────────────
export type ChannelEvent =
  | 'agent_run_complete' | 'agent_run_failed' | 'memory_saved' | 'memory_deleted'
  | 'conversation_created' | 'conversation_archived' | 'provider_added' | 'provider_removed'
  | 'heartbeat' | 'custom';
export interface Channel {
  id: string; name: string; url: string; events: ChannelEvent[];
  hasSecret: boolean; isEnabled: boolean; headers?: Record<string, string>;
  createdAt: string; updatedAt: string;
  lastDeliveryAt?: string; lastDeliveryStatus?: 'ok' | 'failed';
  lastDeliveryStatusCode?: number; failureCount: number;
}
export interface CreateChannelInput {
  name: string; url: string; events?: ChannelEvent[];
  secret?: string; headers?: Record<string, string>; isEnabled?: boolean;
}
export const listChannels         = () => req<Channel[]>('GET', '/channels');
export const listChannelEvents    = () => req<{ events: ChannelEvent[] }>('GET', '/channels/events');
export const createChannel        = (c: CreateChannelInput) => req<Channel>('POST', '/channels', c);
export const updateChannel        = (id: string, patch: Partial<CreateChannelInput> & { isEnabled?: boolean }) =>
  req<Channel>('PATCH', `/channels/${id}`, patch);
export const deleteChannel        = (id: string) => req<void>('DELETE', `/channels/${id}`);
export const testChannel          = (id: string) => req<{ ok: boolean; statusCode?: number; error?: string }>('POST', `/channels/${id}/test`);

// ── Config file editor ─────────────────────────────────────────────────────────
export interface ConfigFileEntry { key: string; filename: string; exists: boolean }
export const listConfigFiles  = () => req<{ files: ConfigFileEntry[] }>('GET', '/config/files');
export const readConfigFile   = (key: string) => req<{ content: string }>('GET', `/config/files/${key}`);
export const writeConfigFile  = (key: string, content: string) =>
  req<{ ok: boolean }>('PUT', `/config/files/${key}`, { content });
