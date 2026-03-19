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
