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
  defaultProfile?: 'safe' | 'standard' | 'full_access';
  guardPreset?: 'permissive' | 'balanced' | 'strict';
  privacyMode?: boolean;
  workspacePath?: string;
  httpsEnabled?: boolean;
  httpsCertPath?: string;
  httpsKeyPath?: string;
  httpsSelfSigned?: boolean;
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
  | { type: 'error'; message: string }
  | { type: 'approval_required'; requestId: string; operation: string; riskSummary: string; reason: string; timeoutMs: number }
  | { type: 'approval_granted' };

export function streamCommand(
  input: string,
  conversationId?: string,
  agentId?: string,
  modelId?: string,
  onEvent?: (event: StreamEvent) => void,
  signal?: AbortSignal,
  responseFormat?: ResponseFormat,
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
      ...(responseFormat && { responseFormat }),
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
  archived?: boolean;
  pinned?: boolean;
  isIdle?: boolean;
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

export const listConversations  = (includeArchived = false) =>
  req<Conversation[]>('GET', `/conversations${includeArchived ? '?include_archived=true' : ''}`);
export const createConversation = (agentId?: string) => req<Conversation>('POST', '/conversations', { agentId });
export const deleteConversation        = (id: string) => req<void>('DELETE', `/conversations/${id}`);
export const updateConversation        = (id: string, title: string) => req<Conversation>('PATCH', `/conversations/${id}`, { title });
export const pinConversation           = (id: string, pinned: boolean) => req<Conversation>('PATCH', `/conversations/${id}`, { pinned });
export const archiveConversation       = (id: string, archived: boolean) => req<Conversation>('PATCH', `/conversations/${id}`, { archived });
export const getMessages               = (id: string) => req<Message[]>('GET', `/conversations/${id}/messages`);
export const deleteLastAssistantMessage = (id: string) => req<void>('DELETE', `/conversations/${id}/messages/last-assistant`);
export const getConversationTokenStats = (id: string) =>
  req<{ totalInputTokens: number | null; totalOutputTokens: number | null; messageCount: number }>('GET', `/conversations/${id}/token-stats`);
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
export const semanticSearchMemory = (query: string, limit?: number) => {
  const qs = new URLSearchParams({ q: query, ...(limit ? { limit: String(limit) } : {}) });
  return req<{ results: MemoryEntry[]; semantic: boolean; embeddingProvider: string; query: string; limit: number }>('GET', `/memory/semantic-search?${qs}`);
};
export const compactMemory   = () => req<{ compacted: number; rawPruned: number }>('POST', '/memory/compact', {});
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
export const importMemory = (entries: unknown[]) =>
  req<{ imported: number; skipped: number }>('POST', '/memory/import', { entries });
export const memoryStatsDetailed = () => req<MemoryStatsDetailed>('GET', '/memory/stats');
export const listMemoryTags = () => req<{ tags: string[] }>('GET', '/memory/tags');

export interface JanitorStatus {
  lastRunAt:  number | null;
  nextRunAt:  number | null;
  lastResult: {
    memoryEntriesPruned:  number;
    conversationsPruned:  number;
    learningRecordsPruned: number;
    heartbeatInsightsPruned: number;
    sessionsCompacted:    number;
    rawTranscriptsPruned: number;
    ranAt:                number;
  } | null;
  config: Record<string, unknown>;
}
export const getJanitorStatus = () => req<JanitorStatus>('GET', '/memory/janitor/status');
export const runJanitor = () => req<JanitorStatus['lastResult']>('POST', '/memory/janitor/run');
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
export interface ModelInfo  { id: string; name: string; providerId: string; provider: string; badges: string[] }

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
  promptTokens?: number; completionTokens?: number;
  parentRunId?: string; spawnDepth?: number;
  retryCount?: number;
}
export interface AgentStats { agentCount: number; activeRuns: number; totalRuns: number }

export async function getAgentAccessProfile(id: string): Promise<{ agentId: string; profile: string }> {
  const r = await fetch(`${BASE}/agents/${id}/access-profile`, {
    headers: _gatewayToken ? { Authorization: `Bearer ${_gatewayToken}` } : {},
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ agentId: string; profile: string }>;
}

export async function setAgentAccessProfile(id: string, profile: string): Promise<void> {
  const r = await fetch(`${BASE}/agents/${id}/access-profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...((_gatewayToken) ? { Authorization: `Bearer ${_gatewayToken}` } : {}),
    },
    body: JSON.stringify({ profile }),
  });
  if (!r.ok) throw new Error(await r.text());
}

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
export interface InferenceMessage { role: 'user' | 'assistant' | 'system'; content: string }
export interface InferenceResponse { content: string; model?: string; providerId?: string; tokensUsed?: number }
export interface ResponseFormat {
  type: 'json_object' | 'json_schema';
  schema?: Record<string, unknown>;
  name?: string;
}
export const directInfer = (messages: InferenceMessage[], opts?: { model?: string; providerId?: string; temperature?: number; maxTokens?: number; responseFormat?: ResponseFormat }) =>
  req<InferenceResponse>('POST', '/models/infer', { messages, ...opts });
export const listModelPreferences = () => req<TaskPreference[]>('GET', '/recommend/preferences');
export const clearModelPreference = (taskType: string) =>
  req<void>('DELETE', `/recommend/preferences/${encodeURIComponent(taskType)}`);
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

// ── Real-time metrics series ───────────────────────────────────────────────────
export interface MetricSample {
  ts:          number;   // epoch seconds (minute bucket)
  requests:    number;
  errors:      number;
  latencySum:  number;
}

export interface MetricsSeries {
  windowMinutes: number;
  samples: MetricSample[];
  totals: {
    requests:     number;
    errors:       number;
    avgLatencyMs: number;
    errorRate:    number;
  };
}

export const getMetricsSeries = () =>
  req<MetricsSeries>('GET', '/dashboard/metrics/series');

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

// ── Gateway Peers ─────────────────────────────────────────────────────────────

export interface GatewayPeer {
  id: string;
  name: string;
  url: string;
  gatewayId?: string;
  version?: string;
  platform?: string;
  capabilities?: string[];
  source: 'manual' | 'mdns' | 'auto';
  authToken?: string;
  tags?: Record<string, string>;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastHealthAt?: string;
  healthy?: boolean;
  latencyMs?: number;
}

export const listPeers = () => req<{ peers: GatewayPeer[] }>('GET', '/gateway/peers');
export const getPeer = (id: string) => req<GatewayPeer>('GET', `/gateway/peers/${encodeURIComponent(id)}`);
export const createPeer = (input: { name: string; url: string; authToken?: string; tags?: Record<string, string> }) =>
  req<GatewayPeer>('POST', '/gateway/peers', input);
export const updatePeer = (id: string, patch: { name?: string; url?: string; authToken?: string; isEnabled?: boolean; tags?: Record<string, string> }) =>
  req<GatewayPeer>('PATCH', `/gateway/peers/${encodeURIComponent(id)}`, patch);
export const deletePeer = (id: string) => req<{ ok: boolean }>('DELETE', `/gateway/peers/${encodeURIComponent(id)}`);
export const probePeer = (id: string) => req<{ healthy: boolean; latencyMs: number; info?: Record<string, unknown> }>('POST', `/gateway/peers/${encodeURIComponent(id)}/probe`);

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

export const exportFullConfig = () => req<Record<string, unknown>>('GET', '/config/export/full');
export const importFullConfig = (payload: Record<string, unknown>, dryRun = false) =>
  req<{ imported: Record<string, number>; skipped: string[]; errors: string[]; dryRun: boolean }>(
    'POST', `/config/import/full?dryRun=${dryRun}`, payload,
  );

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

// ── Chat Channels (inbound bot channels) ──────────────────────────────────────
//
// These are INBOUND channels — Telegram, Discord, WhatsApp bots that users
// chat through. This is separate from the outbound webhook channels above.

export interface ChatChannelProviderMeta {
  id: string;
  type: string;
  displayName: string;
  description: string;
  installStrategy: string;
  credentialFields: Array<{
    key: string;
    label: string;
    hint: string;
    secret: boolean;
    required: boolean;
  }>;
  requiresPairing: boolean;
  docsUrl: string;
}

export interface ChatChannelConfig {
  id: string;
  type: string;
  displayName?: string;
  enabled: boolean;
  credentials: Record<string, string>;
  agentId?: string;
  pairingCode?: string;
  pairingExpiry?: number;
  lastHealthCheck?: number;
  lastHealthStatus?: 'ok' | 'error';
  lastError?: string;
  connectedAt?: number;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
}

export type ChatChannelStatus =
  | 'not_installed'
  | 'installed'
  | 'credentials_missing'
  | 'awaiting_pairing'
  | 'connected'
  | 'error';

export interface ChatChannelWithStatus extends ChatChannelConfig {
  status: ChatChannelStatus;
  providerMeta?: ChatChannelProviderMeta;
}

export const listChatChannelProviders = () =>
  req<{ providers: ChatChannelProviderMeta[] }>('GET', '/chat-channels/providers');

export const listChatChannels = () =>
  req<{ channels: ChatChannelWithStatus[] }>('GET', '/chat-channels');

export const saveChatChannel = (config: Partial<ChatChannelConfig> & { id: string; type: string }) =>
  req<ChatChannelConfig>('POST', '/chat-channels', config);

export const updateChatChannel = (id: string, update: Partial<ChatChannelConfig>) =>
  req<ChatChannelConfig>('PUT', `/chat-channels/${id}`, update);

export const deleteChatChannel = (id: string) =>
  req<void>('DELETE', `/chat-channels/${id}`);

export const testChatChannel = (id: string) =>
  req<{ ok: boolean; latencyMs: number; error?: string }>('POST', `/chat-channels/${id}/test`);

export const getChatChannelStatus = (id: string) =>
  req<{ status: ChatChannelStatus; lastError?: string }>('GET', `/chat-channels/${id}/status`);

export const getChatChannelPairingCode = (id: string) =>
  req<{ code: string; expiresAt: number }>('POST', `/chat-channels/${id}/pair`);

// Pairing
export const listPendingPairings = (id: string) =>
  req<{ pending: Array<{ code: string; senderId: string; senderName?: string; requestedAt: number; expiresAt: number; channel: string }> }>('GET', `/chat-channels/${id}/pairing`);

export const approvePairing = (id: string, code: string) =>
  req<{ ok: boolean; senderId?: string }>('POST', `/chat-channels/${id}/pairing/${code}/approve`);

export const denyPairing = (id: string, code: string) =>
  req<{ ok: boolean }>('POST', `/chat-channels/${id}/pairing/${code}/deny`);

export const listAllowlist = (id: string) =>
  req<{ allowlist: string[] }>('GET', `/chat-channels/${id}/allowlist`);

export const addToAllowlist = (id: string, senderId: string) =>
  req<{ ok: boolean }>('POST', `/chat-channels/${id}/allowlist`, { senderId });

export const removeFromAllowlist = (id: string, senderId: string) =>
  req<{ ok: boolean }>('DELETE', `/chat-channels/${id}/allowlist/${senderId}`);

// Group allowlist
export interface GroupEntry { groupId: string; requireMention: boolean }
export const listGroupAllowlist = (id: string) =>
  req<{ groups: GroupEntry[] }>('GET', `/chat-channels/${id}/groups`);
export const addGroupToAllowlist = (id: string, groupId: string, requireMention = false) =>
  req<{ ok: boolean; groupId: string; requireMention: boolean }>('POST', `/chat-channels/${id}/groups`, { groupId, requireMention });
export const removeGroupFromAllowlist = (id: string, groupId: string) =>
  req<{ ok: boolean }>('DELETE', `/chat-channels/${id}/groups/${encodeURIComponent(groupId)}`);

// ── Config file editor ─────────────────────────────────────────────────────────
export interface ConfigFileEntry { key: string; filename: string; exists: boolean }
export const listConfigFiles  = () => req<{ files: ConfigFileEntry[] }>('GET', '/config/files');
export const readConfigFile   = (key: string) => req<{ content: string }>('GET', `/config/files/${key}`);
export const writeConfigFile  = (key: string, content: string) =>
  req<{ ok: boolean }>('PUT', `/config/files/${key}`, { content });

// ── Shell tools ───────────────────────────────────────────────────────────────

export interface ShellExecResult {
  stdout:     string;
  stderr:     string;
  exitCode:   number | null;
  durationMs: number;
  command:    string;
  profile:    string;
  confirmationRequired?: boolean;
  timedOut?: boolean;
}

export interface ProcessInfo {
  pid:  number;
  name: string;
  cmd?: string;
  cpu?: number;
  mem?: number;
}

export async function shellExec(payload: {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  agentId?: string;
}): Promise<ShellExecResult> {
  const r = await fetch(`${BASE}/tools/shell/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...((_gatewayToken) ? { Authorization: `Bearer ${_gatewayToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<ShellExecResult>;
}

export async function listProcesses(agentId?: string): Promise<{ processes: ProcessInfo[] }> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const r = await fetch(`${BASE}/tools/shell/processes${qs}`, {
    headers: _gatewayToken ? { Authorization: `Bearer ${_gatewayToken}` } : {},
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ processes: ProcessInfo[] }>;
}

export async function killProcess(pid: number, signal?: string, agentId?: string): Promise<{ ok: boolean; pid: number; signal: string }> {
  const r = await fetch(`${BASE}/tools/shell/kill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...((_gatewayToken) ? { Authorization: `Bearer ${_gatewayToken}` } : {}),
    },
    body: JSON.stringify({ pid, signal, agentId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<{ ok: boolean; pid: number; signal: string }>;
}

// ── File tools ─────────────────────────────────────────────────────────────────

export interface FileStatResult {
  path: string; exists: boolean; isFile?: boolean; isDirectory?: boolean;
  size?: number; mtime?: string; ctime?: string;
}
export interface FileDirEntry {
  name: string; path: string; isFile: boolean; isDirectory: boolean; size?: number; mtime?: string;
}
export interface FileListResult { path: string; entries: FileDirEntry[]; }
export interface FileReadResult { path: string; content: string; size: number; encoding: string; }
export interface FileWriteResult { path: string; written: number; }

export async function fileStat(path: string, agentId?: string): Promise<FileStatResult> {
  return req<FileStatResult>('POST', '/tools/files/stat', { path, ...(agentId && { agentId }) });
}

export async function fileList(path: string, agentId?: string): Promise<FileListResult> {
  return req<FileListResult>('POST', '/tools/files/list', { path, ...(agentId && { agentId }) });
}

export async function fileRead(path: string, agentId?: string): Promise<FileReadResult> {
  return req<FileReadResult>('POST', '/tools/files/read', { path, ...(agentId && { agentId }) });
}

export async function fileWrite(path: string, content: string, agentId?: string): Promise<FileWriteResult> {
  return req<FileWriteResult>('POST', '/tools/files/write', { path, content, ...(agentId && { agentId }) });
}

export async function fileMkdir(path: string, agentId?: string): Promise<{ path: string }> {
  return req<{ path: string }>('POST', '/tools/files/mkdir', { path, ...(agentId && { agentId }) });
}

export async function fileDelete(path: string, recursive?: boolean, agentId?: string): Promise<{ path: string }> {
  return req<{ path: string }>('POST', '/tools/files/delete', { path, ...(recursive !== undefined && { recursive }), ...(agentId && { agentId }) });
}

// ── Workspace ──────────────────────────────────────────────────────────────

export interface WorkspaceFileStatus {
  name: string;
  status: 'ok' | 'missing' | 'blank' | 'truncated';
  rawChars: number;
  injectedChars: number;
}

export interface WorkspaceStatus {
  dir: string;
  exists: boolean;
  files: WorkspaceFileStatus[];
  totalRawChars: number;
  totalInjectedChars: number;
}

export async function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  return req<WorkspaceStatus>('GET', '/workspace');
}

export async function initWorkspace(skipBootstrap?: boolean): Promise<{ ok: boolean; dir: string; files: { name: string; status: string }[] }> {
  return req('POST', '/workspace/init', { skipBootstrap: skipBootstrap ?? false });
}

export async function getWorkspaceFile(name: string): Promise<{ name: string; content: string; sizeBytes: number; updatedAt: number }> {
  return req('GET', `/workspace/file/${encodeURIComponent(name)}`);
}

export async function putWorkspaceFile(name: string, content: string): Promise<{ ok: boolean; name: string; sizeBytes: number }> {
  return req('PUT', `/workspace/file/${encodeURIComponent(name)}`, { content });
}

// ── Devices ────────────────────────────────────────────────────────────────

export interface PairedDevice {
  deviceId: string;
  platform: string;
  deviceFamily: string;
  role: 'client' | 'node';
  caps?: string[];
  status: 'approved' | 'pending' | 'denied' | 'revoked';
  label?: string;
  requestedAt: number;
  approvedAt?: number;
  deniedAt?: number;
  revokedAt?: number;
  connectionCount?: number;
  gracePeriodExpiresAt?: number;
  lastSeenAt?: number;
}

export async function listDevices(): Promise<{ devices: PairedDevice[] }> {
  return req('GET', '/devices');
}

export async function listPendingDevices(): Promise<{ devices: PairedDevice[] }> {
  return req('GET', '/devices/pending');
}

export async function approveDevice(id: string, label?: string): Promise<{ ok: boolean; device: PairedDevice }> {
  return req('POST', `/devices/${encodeURIComponent(id)}/approve`, { label });
}

export async function denyDevice(id: string): Promise<{ ok: boolean; device: PairedDevice }> {
  return req('POST', `/devices/${encodeURIComponent(id)}/deny`);
}

export async function removeDevice(id: string): Promise<{ ok: boolean }> {
  return req('DELETE', `/devices/${encodeURIComponent(id)}`);
}

export async function updateDeviceLabel(id: string, label: string): Promise<{ ok: boolean; device: PairedDevice }> {
  return req('PATCH', `/devices/${encodeURIComponent(id)}`, { label });
}

export async function revokeDevice(id: string): Promise<{ ok: boolean; device: PairedDevice }> {
  return req('POST', `/devices/${encodeURIComponent(id)}/revoke`);
}

export async function setDeviceGracePeriod(id: string, durationMs?: number): Promise<{ ok: boolean; device: PairedDevice }> {
  return req('POST', `/devices/${encodeURIComponent(id)}/grace`, durationMs !== undefined ? { durationMs } : {});
}

// ── Nodes ───────────────────────────────────────────────────────────────────

export interface ConnectedNode {
  deviceId: string;
  caps: string[];
  connectedAt: number;
}

export async function listNodes(): Promise<{ nodes: ConnectedNode[] }> {
  return req('GET', '/nodes');
}

export async function invokeNode(
  deviceId: string,
  command: string,
  params?: unknown,
  timeoutMs?: number,
): Promise<{ ok: boolean; result: unknown }> {
  return req('POST', `/nodes/${encodeURIComponent(deviceId)}/invoke`, { command, params, timeoutMs });
}

// ── Web Chat Pairing ─────────────────────────────────────────────────────────

export interface WebChatPairingEntry {
  id: string;
  label?: string;
  createdAt: number;
  expiresAt: number;
  oneTimeUse: boolean;
}

export interface WebChatPairingCreated extends WebChatPairingEntry {
  chatUrl: string;
}

export async function listWebChatPairings(): Promise<{ tokens: WebChatPairingEntry[] }> {
  return req('GET', '/webchat/pair');
}

export async function createWebChatPairing(opts?: {
  label?: string;
  ttlHours?: number;
  oneTimeUse?: boolean;
}): Promise<WebChatPairingCreated> {
  return req('POST', '/webchat/pair', opts ?? {});
}

export async function revokeWebChatPairing(id: string): Promise<{ ok: boolean }> {
  return req('DELETE', `/webchat/pair/${encodeURIComponent(id)}`);
}

// ── Cron Jobs ─────────────────────────────────────────────────────────────────

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string; tz?: string };

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  schedule: CronSchedule;
  agentId?: string;
  message: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  lastRunAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  runCount: number;
  nextRunAt?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCronJobInput {
  name: string;
  description?: string;
  schedule: CronSchedule;
  agentId?: string;
  message: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
}

export const listCronJobs = () => req<CronJob[]>('GET', '/cron');
export const getCronJob = (id: string) => req<CronJob>('GET', `/cron/${encodeURIComponent(id)}`);
export const createCronJob = (input: CreateCronJobInput) => req<CronJob>('POST', '/cron', input);
export const updateCronJob = (id: string, patch: Partial<CreateCronJobInput>) => req<CronJob>('PATCH', `/cron/${encodeURIComponent(id)}`, patch);
export const deleteCronJob = (id: string) => req<{ ok: boolean }>('DELETE', `/cron/${encodeURIComponent(id)}`);
export const runCronJobNow = (id: string) => req<{ ok: boolean; runId?: string }>('POST', `/cron/${encodeURIComponent(id)}/run`);


// ── Approvals ──────────────────────────────────────────────────────────────

export type ApprovalResponse = 'allow_once' | 'allow_for_session' | 'deny';

export const respondApproval = (id: string, response: ApprovalResponse) =>
  req<{ ok: boolean }>('POST', `/approvals/${encodeURIComponent(id)}/respond`, { response });

// ── API Key management ──────────────────────────────────────────────────────

export type ApiKeyPermission =
  | 'chat' | 'agents:read' | 'agents:write' | 'agents:run'
  | 'memory:read' | 'memory:write' | 'models:read' | 'models:infer'
  | 'tools:file' | 'tools:shell' | 'admin';

export interface ApiKeySafe {
  id: string;
  name: string;
  prefix: string;
  permissions: ApiKeyPermission[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  active: boolean;
}

export interface ApiKeyCreated {
  key: string;       // plaintext — shown once
  entry: ApiKeySafe;
}

export const listApiKeys = () =>
  req<{ keys: ApiKeySafe[] }>('GET', '/auth/keys');

export const createApiKey = (name: string, permissions: ApiKeyPermission[], expiresAt?: number) =>
  req<ApiKeyCreated>('POST', '/auth/keys', { name, permissions, ...(expiresAt ? { expiresAt } : {}) });

export const revokeApiKey = (id: string) =>
  req<void>('DELETE', `/auth/keys/${encodeURIComponent(id)}`);

export const updateApiKey = (id: string, updates: { name?: string; permissions?: ApiKeyPermission[]; expiresAt?: number | null }) =>
  req<ApiKeySafe>('PATCH', `/auth/keys/${encodeURIComponent(id)}`, updates);

// ── Job Queue ───────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobEntry {
  id: string;
  type: 'agent_run' | 'cron_run' | 'delegation';
  status: JobStatus;
  agentId: string;
  input: string;
  output?: string;
  error?: string;
  priority: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
}

export const listJobs = (opts?: { status?: string; agentId?: string; limit?: number }) => {
  const params = new URLSearchParams();
  if (opts?.status)  params.set('status', opts.status);
  if (opts?.agentId) params.set('agentId', opts.agentId);
  if (opts?.limit)   params.set('limit', String(opts.limit));
  const qs = params.toString();
  return req<{ jobs: JobEntry[]; pending: number }>('GET', `/jobs${qs ? `?${qs}` : ''}`);
};

export const cancelJob = (id: string) =>
  req<void>('DELETE', `/jobs/${encodeURIComponent(id)}`);

// ── Update Check ─────────────────────────────────────────────────────────────

export interface UpdateInfo {
  currentVersion: string;
  channel: 'stable' | 'beta' | 'dev';
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  publishedAt: string | null;
  releaseUrl: string | null;
}

export const checkForUpdate = (channel?: 'stable' | 'beta' | 'dev') => {
  const qs = channel && channel !== 'stable' ? `?channel=${channel}` : '';
  return req<UpdateInfo>('GET', `/update/check${qs}`);
};

// ── Standing Orders ───────────────────────────────────────────────────────────

export interface StandingOrder {
  id: string;
  name: string;
  description?: string;
  scope: string;
  triggers: string[];
  approvalGates?: string[];
  escalation?: string;
  executionSteps?: string[];
  cronJobId?: string;
  enabled: boolean;
  runCount: number;
  failureCount: number;
  lastRunAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStandingOrderInput {
  name: string;
  description?: string;
  scope: string;
  triggers: string[];
  approvalGates?: string[];
  escalation?: string;
  executionSteps?: string[];
  cronJobId?: string;
  enabled?: boolean;
}

export const listStandingOrders = () => req<{ orders: StandingOrder[] }>('GET', '/standing-orders');
export const getStandingOrder = (id: string) => req<StandingOrder>('GET', `/standing-orders/${encodeURIComponent(id)}`);
export const createStandingOrder = (input: CreateStandingOrderInput) => req<StandingOrder>('POST', '/standing-orders', input);
export const updateStandingOrder = (id: string, patch: Partial<CreateStandingOrderInput> & { enabled?: boolean }) =>
  req<StandingOrder>('PATCH', `/standing-orders/${encodeURIComponent(id)}`, patch);
export const deleteStandingOrder = (id: string) => req<{ ok: boolean }>('DELETE', `/standing-orders/${encodeURIComponent(id)}`);
export const runStandingOrderNow = (id: string) => req<{ ok: boolean; runId?: string }>('POST', `/standing-orders/${encodeURIComponent(id)}/run`);
export const getStandingOrderPrompt = (id: string) => req<{ prompt: string }>('GET', `/standing-orders/${encodeURIComponent(id)}/prompt`);
