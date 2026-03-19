/**
 * @krythor/models — Provider config validation
 *
 * Runtime validation for providers.json entries.
 * Invalid providers are skipped at load time — startup never fails due to
 * a single bad provider entry.
 *
 * See packages/core/src/config/validate.ts for the shared validation pattern.
 */

import type { ProviderConfig, ProviderType } from '../types.js';

const VALID_PROVIDER_TYPES: ProviderType[] = ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf'];

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

  const value: ProviderConfig = {
    id:        r['id'] as string,
    name:      r['name'] as string,
    type:      r['type'] as ProviderType,
    endpoint:  r['endpoint'] as string,
    apiKey:    typeof r['apiKey'] === 'string' ? r['apiKey'] : undefined,
    isDefault: typeof r['isDefault'] === 'boolean' ? r['isDefault'] : false,
    isEnabled: typeof r['isEnabled'] === 'boolean' ? r['isEnabled'] : true,
    models:    Array.isArray(r['models'])
      ? (r['models'] as unknown[]).filter(m => typeof m === 'string') as string[]
      : [],
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
