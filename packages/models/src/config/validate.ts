/**
 * @krythor/models — Provider config validation
 *
 * Runtime validation for providers.json entries.
 * Invalid providers are skipped at load time — startup never fails due to
 * a single bad provider entry.
 *
 * See packages/core/src/config/validate.ts for the shared validation pattern.
 */

import type { ProviderConfig, ProviderType, AuthMethod, OAuthAccount } from '../types.js';

const VALID_PROVIDER_TYPES: ProviderType[] = ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf', 'claude-agent-sdk'];
const VALID_AUTH_METHODS: AuthMethod[] = ['api_key', 'oauth', 'none'];

export interface ProviderValidationResult {
  value: ProviderConfig | null;
  valid: boolean;
  errors: string[];
}

export function validateProviderConfig(raw: unknown): ProviderValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, value: null, errors: ['not an object'] };
  }

  const r = raw as Record<string, unknown>;

  if (typeof r['id'] !== 'string' || !r['id'])       errors.push('id: required string');
  if (typeof r['name'] !== 'string' || !r['name'])   errors.push('name: required string');
  if (typeof r['endpoint'] !== 'string' || !r['endpoint']) errors.push('endpoint: required string');
  if (!VALID_PROVIDER_TYPES.includes(r['type'] as ProviderType)) {
    errors.push(`type: "${r['type']}" is not a valid provider type (${VALID_PROVIDER_TYPES.join(', ')})`);
  }

  // Any required field missing → reject entirely
  if (errors.length > 0) {
    return { valid: false, value: null, errors };
  }

  // Resolve authMethod: honour stored value or infer from legacy shape
  const rawAuthMethod = r['authMethod'];
  const authMethod: AuthMethod = VALID_AUTH_METHODS.includes(rawAuthMethod as AuthMethod)
    ? (rawAuthMethod as AuthMethod)
    : (typeof r['apiKey'] === 'string' ? 'api_key' : 'none');

  // Parse oauthAccount if present
  let oauthAccount: OAuthAccount | undefined;
  if (r['oauthAccount'] && typeof r['oauthAccount'] === 'object' && !Array.isArray(r['oauthAccount'])) {
    const oa = r['oauthAccount'] as Record<string, unknown>;
    if (typeof oa['accountId'] === 'string' && typeof oa['accessToken'] === 'string') {
      oauthAccount = {
        accountId:    oa['accountId'],
        displayName:  typeof oa['displayName'] === 'string' ? oa['displayName'] : undefined,
        accessToken:  oa['accessToken'],
        refreshToken: typeof oa['refreshToken'] === 'string' ? oa['refreshToken'] : undefined,
        expiresAt:    typeof oa['expiresAt'] === 'number' ? oa['expiresAt'] : 0,
        connectedAt:  typeof oa['connectedAt'] === 'string' ? oa['connectedAt'] : new Date().toISOString(),
      };
    }
  }

  const value: ProviderConfig = {
    id:           r['id'] as string,
    name:         r['name'] as string,
    type:         r['type'] as ProviderType,
    endpoint:     r['endpoint'] as string,
    authMethod,
    apiKey:       typeof r['apiKey'] === 'string' ? r['apiKey'] : undefined,
    oauthAccount,
    isDefault:    typeof r['isDefault'] === 'boolean' ? r['isDefault'] : false,
    isEnabled:    typeof r['isEnabled'] === 'boolean' ? r['isEnabled'] : true,
    models:       Array.isArray(r['models'])
      ? (r['models'] as unknown[]).filter(m => typeof m === 'string') as string[]
      : [],
    priority:     typeof r['priority'] === 'number' ? r['priority'] : 0,
    maxRetries:   typeof r['maxRetries'] === 'number' ? Math.max(0, Math.round(r['maxRetries'])) : 2,
    setupHint:    typeof r['setupHint'] === 'string' ? r['setupHint'] : undefined,
  };

  return { valid: true, value, errors: [] };
}

export function parseProviderList(raw: unknown): {
  providers: ProviderConfig[];
  skipped: number;
  errors: string[];
} {
  // Handle both storage formats:
  //   - wrapped: { version: "1", providers: [...] }  (written by Installer)
  //   - flat:    [...]                               (written by ModelRegistry.save)
  let list: unknown;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (
    raw && typeof raw === 'object' &&
    'providers' in (raw as object) &&
    Array.isArray((raw as { providers: unknown }).providers)
  ) {
    list = (raw as { providers: unknown }).providers;
  } else {
    return { providers: [], skipped: 0, errors: ['providers.json: unrecognised format (expected array or { providers: [...] })'] };
  }

  const arr = list as unknown[];
  const providers: ProviderConfig[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < arr.length; i++) {
    const result = validateProviderConfig(arr[i]);
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
