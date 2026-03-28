/**
 * @krythor/core — Config validation utilities
 *
 * Provides runtime schema validation for all persisted config files.
 * No external dependencies — pure TypeScript type guards.
 *
 * Design:
 *   - parse() returns { valid, value, errors } — never throws
 *   - Invalid entries are skipped and logged, not treated as fatal
 *   - Defaults are applied inline so callers always get fully-typed values
 */

export interface ValidationResult<T> {
  /** The parsed and defaulted value (may be partial if some fields were invalid) */
  value: T;
  /** True if all required fields were present and valid */
  valid: boolean;
  /** Human-readable list of field errors, for logging */
  errors: string[];
}

// ── AgentDefinition ──────────────────────────────────────────────────────────

const VALID_MEMORY_SCOPES = ['session', 'agent', 'workspace'] as const;

export interface AgentDefinitionRaw {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId?: string;
  providerId?: string;
  memoryScope: 'session' | 'agent' | 'workspace';
  maxTurns: number;
  temperature?: number;
  maxTokens?: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export function validateAgentDefinition(raw: unknown): ValidationResult<AgentDefinitionRaw | null> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, value: null, errors: ['not an object'] };
  }

  const r = raw as Record<string, unknown>;

  // Required string fields
  if (typeof r['id'] !== 'string' || !r['id']) errors.push('id: required string');
  if (typeof r['name'] !== 'string' || !r['name']) errors.push('name: required string');
  if (typeof r['systemPrompt'] !== 'string') errors.push('systemPrompt: required string');

  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  // Optional / defaulted fields
  const memoryScope = VALID_MEMORY_SCOPES.includes(r['memoryScope'] as typeof VALID_MEMORY_SCOPES[number])
    ? (r['memoryScope'] as 'session' | 'agent' | 'workspace')
    : 'agent';

  if (r['memoryScope'] !== undefined && !VALID_MEMORY_SCOPES.includes(r['memoryScope'] as typeof VALID_MEMORY_SCOPES[number])) {
    errors.push(`memoryScope: invalid value "${r['memoryScope']}" — defaulting to "agent"`);
  }

  const maxTurns = typeof r['maxTurns'] === 'number' && r['maxTurns'] > 0 ? r['maxTurns'] : 10;
  if (r['maxTurns'] !== undefined && maxTurns === 10 && r['maxTurns'] !== 10) {
    errors.push(`maxTurns: invalid value "${r['maxTurns']}" — defaulting to 10`);
  }

  const tags = Array.isArray(r['tags']) ? (r['tags'] as unknown[]).filter(t => typeof t === 'string') as string[] : [];
  const now = Date.now();

  const value: AgentDefinitionRaw = {
    id:           r['id'] as string,
    name:         r['name'] as string,
    description:  typeof r['description'] === 'string' ? r['description'] : '',
    systemPrompt: r['systemPrompt'] as string,
    modelId:      typeof r['modelId'] === 'string' ? r['modelId'] : undefined,
    providerId:   typeof r['providerId'] === 'string' ? r['providerId'] : undefined,
    memoryScope,
    maxTurns,
    temperature:  typeof r['temperature'] === 'number' ? r['temperature'] : undefined,
    maxTokens:    typeof r['maxTokens'] === 'number' ? r['maxTokens'] : undefined,
    tags,
    createdAt:    typeof r['createdAt'] === 'number' ? r['createdAt'] : now,
    updatedAt:    typeof r['updatedAt'] === 'number' ? r['updatedAt'] : now,
  };

  return { valid: errors.length === 0, value, errors };
}

/**
 * Parse a raw JSON value as an agent list.
 * Invalid entries are skipped. Returns the valid subset and a list of errors per entry.
 */
export function parseAgentList(raw: unknown): { agents: AgentDefinitionRaw[]; skipped: number; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { agents: [], skipped: 0, errors: ['agents.json: root value is not an array'] };
  }

  const agents: AgentDefinitionRaw[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < raw.length; i++) {
    const result = validateAgentDefinition(raw[i]);
    if (result.value !== null) {
      agents.push(result.value);
    } else {
      skipped++;
    }
    if (result.errors.length > 0) {
      errors.push(`  [${i}] ${result.errors.join(', ')}`);
    }
  }

  return { agents, skipped, errors };
}

// ── AppConfig ────────────────────────────────────────────────────────────────

export interface AppConfigRaw {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /**
   * IANA timezone string for the Date/Time section of the agent system prompt.
   * Example: 'America/New_York'. When set, local time is shown alongside UTC.
   */
  userTimezone?: string;
  /**
   * Preferred time format for the system prompt Date/Time section.
   * 'auto' detects from locale, '12' forces AM/PM, '24' forces 24-hour.
   */
  timeFormat?: 'auto' | '12' | '24';
  /**
   * Controls whether a truncation warning is appended to Project Context when
   * any bootstrap file was truncated.
   * 'off' | 'once' (default) | 'always'
   */
  bootstrapTruncationWarning?: 'off' | 'once' | 'always';
  /**
   * Number of days after which inactive conversations are pruned from the database.
   * Default: 90. Set to 0 to disable age-based pruning.
   */
  sessionPruneAfterDays?: number;
  /**
   * Maximum number of conversations to retain in the database.
   * Oldest conversations are pruned first when this limit is exceeded.
   * Default: 0 (disabled — no count cap).
   */
  sessionMaxConversations?: number;
  /**
   * Maximum total disk usage for conversation storage in bytes.
   * When exceeded, oldest conversations are pruned until under budget.
   * Default: 0 (disabled — no disk cap).
   */
  sessionMaxDiskBytes?: number;
  /**
   * Archive a conversation after it reaches this many messages.
   * Archived conversations are excluded from sessions_list by default.
   * Default: 0 (disabled).
   */
  sessionRotateAfterMessages?: number;
  /**
   * Days after which a session is eligible for compaction (summarization of older turns).
   * Default: 0 (disabled).
   */
  sessionCompactAfterDays?: number;
  /**
   * Maximum number of turns per session. Oldest turns trimmed when exceeded.
   * Default: 0 (disabled).
   */
  sessionMaxTurns?: number;
  /**
   * Maximum raw transcript bytes per session. Oldest messages trimmed when exceeded.
   * Default: 0 (disabled).
   */
  sessionMaxTranscriptBytes?: number;
  /**
   * When true, raw transcript is deleted after successful compaction.
   * Default: false.
   */
  sessionDeleteRawAfterSuccess?: boolean;
  /**
   * Heartbeat policy for direct/proactive messages.
   * 'reactive' — respond only when explicitly called (default).
   * 'proactive' — heartbeat may generate unsolicited check-in messages.
   */
  heartbeatDirectPolicy?: 'reactive' | 'proactive';
  /**
   * Whether heartbeat checks use extended thinking by default (when available).
   * Default: false.
   */
  heartbeatThinkingDefault?: boolean;
  /**
   * Patterns (regex strings) that trigger a heartbeat check when mentioned
   * in any incoming message. Case-insensitive. Example: ["urgent", "alert"].
   */
  heartbeatMentionPatterns?: string[];
  /**
   * Phrases that reset the heartbeat timer when received (case-insensitive exact match).
   * Prevents heartbeat from running while the user is actively interacting.
   * Default: [].
   */
  heartbeatResetTriggers?: string[];
  /**
   * Controls how the gateway responds to config file changes on disk.
   * 'hot'     — watch providers.json only and reload without restarting (default).
   * 'hybrid'  — watch providers.json, agents.json, and guard.json.
   * 'restart' — do not watch; log that a restart is required for changes to take effect.
   * 'off'     — disable all config file watching.
   */
  configReloadMode?: 'hot' | 'hybrid' | 'restart' | 'off';
  /**
   * Enable PrivacyRouter — classifies prompt sensitivity and re-routes private/restricted
   * content to a local provider when one is configured.
   * Default: false.
   */
  privacyRoutingEnabled?: boolean;
  /**
   * When privacyRoutingEnabled is true and a prompt is classified as private/restricted
   * but no local provider is available, block the request instead of allowing remote.
   * Default: false.
   */
  privacyBlockOnSensitive?: boolean;
}

export function parseAppConfig(raw: unknown): ValidationResult<AppConfigRaw> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, value: {}, errors: ['app-config.json: root value is not an object'] };
  }

  const r = raw as Record<string, unknown>;
  const value: AppConfigRaw = {};

  if ('selectedAgentId' in r) {
    if (r['selectedAgentId'] === null || r['selectedAgentId'] === undefined) {
      // null means "cleared" — omit from value
    } else if (typeof r['selectedAgentId'] === 'string') {
      value.selectedAgentId = r['selectedAgentId'];
    } else {
      errors.push(`selectedAgentId: expected string, got ${typeof r['selectedAgentId']}`);
    }
  }

  if ('selectedModel' in r) {
    if (r['selectedModel'] === null || r['selectedModel'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['selectedModel'] === 'string') {
      value.selectedModel = r['selectedModel'];
    } else {
      errors.push(`selectedModel: expected string, got ${typeof r['selectedModel']}`);
    }
  }

  if ('onboardingComplete' in r) {
    if (typeof r['onboardingComplete'] === 'boolean') {
      value.onboardingComplete = r['onboardingComplete'];
    } else {
      errors.push(`onboardingComplete: expected boolean, got ${typeof r['onboardingComplete']}`);
    }
  }

  if ('logLevel' in r) {
    const validLevels = ['debug', 'info', 'warn', 'error'];
    if (validLevels.includes(r['logLevel'] as string)) {
      value.logLevel = r['logLevel'] as AppConfigRaw['logLevel'];
    } else {
      errors.push(`logLevel: expected one of ${validLevels.join(', ')}, got ${String(r['logLevel'])}`);
    }
  }

  if ('userTimezone' in r) {
    if (r['userTimezone'] === null || r['userTimezone'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['userTimezone'] === 'string') {
      value.userTimezone = r['userTimezone'];
    } else {
      errors.push(`userTimezone: expected string, got ${typeof r['userTimezone']}`);
    }
  }

  if ('timeFormat' in r) {
    const validFormats = ['auto', '12', '24'];
    if (r['timeFormat'] === null || r['timeFormat'] === undefined) {
      // null means "cleared" — omit
    } else if (validFormats.includes(r['timeFormat'] as string)) {
      value.timeFormat = r['timeFormat'] as AppConfigRaw['timeFormat'];
    } else {
      errors.push(`timeFormat: expected one of ${validFormats.join(', ')}, got ${String(r['timeFormat'])}`);
    }
  }

  if ('bootstrapTruncationWarning' in r) {
    const validModes = ['off', 'once', 'always'];
    if (r['bootstrapTruncationWarning'] === null || r['bootstrapTruncationWarning'] === undefined) {
      // null means "cleared" — omit
    } else if (validModes.includes(r['bootstrapTruncationWarning'] as string)) {
      value.bootstrapTruncationWarning = r['bootstrapTruncationWarning'] as AppConfigRaw['bootstrapTruncationWarning'];
    } else {
      errors.push(`bootstrapTruncationWarning: expected one of ${validModes.join(', ')}, got ${String(r['bootstrapTruncationWarning'])}`);
    }
  }

  if ('sessionPruneAfterDays' in r) {
    if (r['sessionPruneAfterDays'] === null || r['sessionPruneAfterDays'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionPruneAfterDays'] === 'number' && r['sessionPruneAfterDays'] >= 0) {
      value.sessionPruneAfterDays = r['sessionPruneAfterDays'];
    } else {
      errors.push(`sessionPruneAfterDays: expected non-negative number, got ${String(r['sessionPruneAfterDays'])}`);
    }
  }

  if ('sessionMaxConversations' in r) {
    if (r['sessionMaxConversations'] === null || r['sessionMaxConversations'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionMaxConversations'] === 'number' && r['sessionMaxConversations'] >= 0) {
      value.sessionMaxConversations = r['sessionMaxConversations'];
    } else {
      errors.push(`sessionMaxConversations: expected non-negative number, got ${String(r['sessionMaxConversations'])}`);
    }
  }

  if ('sessionMaxDiskBytes' in r) {
    if (r['sessionMaxDiskBytes'] === null || r['sessionMaxDiskBytes'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionMaxDiskBytes'] === 'number' && r['sessionMaxDiskBytes'] >= 0) {
      value.sessionMaxDiskBytes = r['sessionMaxDiskBytes'];
    } else {
      errors.push(`sessionMaxDiskBytes: expected non-negative number, got ${String(r['sessionMaxDiskBytes'])}`);
    }
  }

  if ('sessionRotateAfterMessages' in r) {
    if (r['sessionRotateAfterMessages'] === null || r['sessionRotateAfterMessages'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionRotateAfterMessages'] === 'number' && r['sessionRotateAfterMessages'] >= 0) {
      value.sessionRotateAfterMessages = r['sessionRotateAfterMessages'];
    } else {
      errors.push(`sessionRotateAfterMessages: expected non-negative number, got ${String(r['sessionRotateAfterMessages'])}`);
    }
  }

  if ('sessionCompactAfterDays' in r) {
    if (r['sessionCompactAfterDays'] === null || r['sessionCompactAfterDays'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionCompactAfterDays'] === 'number' && r['sessionCompactAfterDays'] >= 0) {
      value.sessionCompactAfterDays = r['sessionCompactAfterDays'];
    } else {
      errors.push(`sessionCompactAfterDays: expected non-negative number, got ${String(r['sessionCompactAfterDays'])}`);
    }
  }

  if ('sessionMaxTurns' in r) {
    if (r['sessionMaxTurns'] === null || r['sessionMaxTurns'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionMaxTurns'] === 'number' && r['sessionMaxTurns'] >= 0) {
      value.sessionMaxTurns = r['sessionMaxTurns'];
    } else {
      errors.push(`sessionMaxTurns: expected non-negative number, got ${String(r['sessionMaxTurns'])}`);
    }
  }

  if ('sessionMaxTranscriptBytes' in r) {
    if (r['sessionMaxTranscriptBytes'] === null || r['sessionMaxTranscriptBytes'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionMaxTranscriptBytes'] === 'number' && r['sessionMaxTranscriptBytes'] >= 0) {
      value.sessionMaxTranscriptBytes = r['sessionMaxTranscriptBytes'];
    } else {
      errors.push(`sessionMaxTranscriptBytes: expected non-negative number, got ${String(r['sessionMaxTranscriptBytes'])}`);
    }
  }

  if ('sessionDeleteRawAfterSuccess' in r) {
    if (r['sessionDeleteRawAfterSuccess'] === null || r['sessionDeleteRawAfterSuccess'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['sessionDeleteRawAfterSuccess'] === 'boolean') {
      value.sessionDeleteRawAfterSuccess = r['sessionDeleteRawAfterSuccess'];
    } else {
      errors.push(`sessionDeleteRawAfterSuccess: expected boolean, got ${typeof r['sessionDeleteRawAfterSuccess']}`);
    }
  }

  if ('heartbeatDirectPolicy' in r) {
    const validPolicies = ['reactive', 'proactive'];
    if (r['heartbeatDirectPolicy'] === null || r['heartbeatDirectPolicy'] === undefined) {
      // null means "cleared" — omit
    } else if (validPolicies.includes(r['heartbeatDirectPolicy'] as string)) {
      value.heartbeatDirectPolicy = r['heartbeatDirectPolicy'] as AppConfigRaw['heartbeatDirectPolicy'];
    } else {
      errors.push(`heartbeatDirectPolicy: expected one of ${validPolicies.join(', ')}, got ${String(r['heartbeatDirectPolicy'])}`);
    }
  }

  if ('heartbeatThinkingDefault' in r) {
    if (r['heartbeatThinkingDefault'] === null || r['heartbeatThinkingDefault'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['heartbeatThinkingDefault'] === 'boolean') {
      value.heartbeatThinkingDefault = r['heartbeatThinkingDefault'];
    } else {
      errors.push(`heartbeatThinkingDefault: expected boolean, got ${typeof r['heartbeatThinkingDefault']}`);
    }
  }

  if ('heartbeatMentionPatterns' in r) {
    if (r['heartbeatMentionPatterns'] === null || r['heartbeatMentionPatterns'] === undefined) {
      // null means "cleared" — omit
    } else if (Array.isArray(r['heartbeatMentionPatterns'])) {
      const patterns = (r['heartbeatMentionPatterns'] as unknown[]).filter(p => typeof p === 'string') as string[];
      value.heartbeatMentionPatterns = patterns;
    } else {
      errors.push(`heartbeatMentionPatterns: expected array of strings`);
    }
  }

  if ('heartbeatResetTriggers' in r) {
    if (r['heartbeatResetTriggers'] === null || r['heartbeatResetTriggers'] === undefined) {
      // null means "cleared" — omit
    } else if (Array.isArray(r['heartbeatResetTriggers'])) {
      const triggers = (r['heartbeatResetTriggers'] as unknown[]).filter(t => typeof t === 'string') as string[];
      value.heartbeatResetTriggers = triggers;
    } else {
      errors.push(`heartbeatResetTriggers: expected array of strings`);
    }
  }

  if ('configReloadMode' in r) {
    const validModes = ['hot', 'hybrid', 'restart', 'off'];
    if (r['configReloadMode'] === null || r['configReloadMode'] === undefined) {
      // null means "cleared" — omit
    } else if (validModes.includes(r['configReloadMode'] as string)) {
      value.configReloadMode = r['configReloadMode'] as AppConfigRaw['configReloadMode'];
    } else {
      errors.push(`configReloadMode: expected one of ${validModes.join(', ')}, got ${String(r['configReloadMode'])}`);
    }
  }

  if ('privacyRoutingEnabled' in r) {
    if (r['privacyRoutingEnabled'] === null || r['privacyRoutingEnabled'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['privacyRoutingEnabled'] === 'boolean') {
      value.privacyRoutingEnabled = r['privacyRoutingEnabled'];
    } else {
      errors.push(`privacyRoutingEnabled: expected boolean, got ${typeof r['privacyRoutingEnabled']}`);
    }
  }

  if ('privacyBlockOnSensitive' in r) {
    if (r['privacyBlockOnSensitive'] === null || r['privacyBlockOnSensitive'] === undefined) {
      // null means "cleared" — omit
    } else if (typeof r['privacyBlockOnSensitive'] === 'boolean') {
      value.privacyBlockOnSensitive = r['privacyBlockOnSensitive'];
    } else {
      errors.push(`privacyBlockOnSensitive: expected boolean, got ${typeof r['privacyBlockOnSensitive']}`);
    }
  }

  return { valid: errors.length === 0, value, errors };
}

// ── ProviderConfig ────────────────────────────────────────────────────────────

const VALID_PROVIDER_TYPES = ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf'] as const;

export interface ProviderConfigRaw {
  id: string;
  name: string;
  type: 'ollama' | 'openai' | 'anthropic' | 'openai-compat' | 'gguf';
  endpoint: string;
  apiKey?: string;
  isDefault: boolean;
  isEnabled: boolean;
  models: string[];
}

export function validateProviderConfig(raw: unknown): ValidationResult<ProviderConfigRaw | null> {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, value: null, errors: ['not an object'] };
  }

  const r = raw as Record<string, unknown>;

  if (typeof r['id'] !== 'string' || !r['id']) errors.push('id: required string');
  if (typeof r['name'] !== 'string' || !r['name']) errors.push('name: required string');
  if (!VALID_PROVIDER_TYPES.includes(r['type'] as typeof VALID_PROVIDER_TYPES[number])) {
    errors.push(`type: invalid value "${r['type']}" — must be one of ${VALID_PROVIDER_TYPES.join(', ')}`);
  }
  if (typeof r['endpoint'] !== 'string' || !r['endpoint']) errors.push('endpoint: required string');

  if (errors.filter(e => !e.includes('defaulting')).length > 0) {
    return { valid: false, value: null, errors };
  }

  const value: ProviderConfigRaw = {
    id:        r['id'] as string,
    name:      r['name'] as string,
    type:      r['type'] as ProviderConfigRaw['type'],
    endpoint:  r['endpoint'] as string,
    apiKey:    typeof r['apiKey'] === 'string' ? r['apiKey'] : undefined,
    isDefault: typeof r['isDefault'] === 'boolean' ? r['isDefault'] : false,
    isEnabled: typeof r['isEnabled'] === 'boolean' ? r['isEnabled'] : true,
    models:    Array.isArray(r['models']) ? (r['models'] as unknown[]).filter(m => typeof m === 'string') as string[] : [],
  };

  return { valid: errors.length === 0, value, errors };
}

export function parseProviderList(raw: unknown): { providers: ProviderConfigRaw[]; skipped: number; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { providers: [], skipped: 0, errors: ['providers.json: root value is not an array'] };
  }

  const providers: ProviderConfigRaw[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < raw.length; i++) {
    const result = validateProviderConfig(raw[i]);
    if (result.value !== null) {
      providers.push(result.value);
    } else {
      skipped++;
    }
    if (result.errors.length > 0) {
      errors.push(`  [${i}] ${result.errors.join(', ')}`);
    }
  }

  return { providers, skipped, errors };
}
