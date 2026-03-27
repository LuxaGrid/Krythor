/**
 * Input validation helpers for gateway route handlers.
 *
 * All validators return a string (error message) when invalid, or undefined when valid.
 * This keeps validation logic reusable and testable without coupling to Fastify reply objects.
 *
 * Field length limits (conservative safety margins):
 *   name           ≤ 100 chars
 *   description    ≤ 500 chars
 *   systemPrompt   ≤ 10,000 chars
 *   endpoint       ≤ 500 chars
 *   tag            ≤ 100 chars per tag
 *   source         ≤ 200 chars
 *   apiKey         ≤ 500 chars
 */

export const MAX_NAME_LEN         = 100;
export const MAX_DESCRIPTION_LEN  = 500;
export const MAX_SYSTEM_PROMPT_LEN = 10_000;
export const MAX_ENDPOINT_LEN     = 500;
export const MAX_TAG_LEN          = 100;
export const MAX_SOURCE_LEN       = 200;
export const MAX_API_KEY_LEN      = 500;

/** Allowed URL schemes for endpoint and web_fetch fields. */
const ALLOWED_SCHEMES = ['http:', 'https:'];

/**
 * Trim a string and verify it does not exceed maxLen.
 * Returns the trimmed value, or an error string.
 */
export function validateString(
  value: unknown,
  fieldName: string,
  maxLen: number,
  required = false,
): { value: string; error?: string } {
  if (value === undefined || value === null) {
    if (required) return { value: '', error: `${fieldName} is required` };
    return { value: '' };
  }
  if (typeof value !== 'string') {
    return { value: '', error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    return { value: '', error: `${fieldName} must not be blank` };
  }
  if (trimmed.length > maxLen) {
    return { value: trimmed, error: `${fieldName} must be ≤ ${maxLen} characters (got ${trimmed.length})` };
  }
  return { value: trimmed };
}

/**
 * Validate a URL string for use as a provider endpoint or web_fetch target.
 * - Must start with http:// or https://
 * - Must parse as a valid URL
 * - Explicitly rejects file://, javascript:, data:, and other schemes
 *
 * Returns error string if invalid, undefined if valid.
 */
export function validateUrl(value: string, fieldName = 'endpoint'): string | undefined {
  if (!value) return undefined; // empty is OK — callers check required separately

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${fieldName} is not a valid URL`;
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return `${fieldName} must use http:// or https:// (got ${parsed.protocol})`;
  }

  return undefined;
}

/**
 * Validate an array of tag strings.
 * - Each tag must be a string ≤ MAX_TAG_LEN chars
 * - Returns trimmed tags array, or an error string
 */
export function validateTags(
  tags: unknown,
): { value: string[]; error?: string } {
  if (tags === undefined || tags === null) return { value: [] };
  if (!Array.isArray(tags)) return { value: [], error: 'tags must be an array' };

  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { value: [], error: 'each tag must be a string' };
    }
    const trimmed = tag.trim();
    if (trimmed.length > MAX_TAG_LEN) {
      return { value: [], error: `tag "${trimmed.slice(0, 20)}…" exceeds ${MAX_TAG_LEN} character limit` };
    }
    if (trimmed.length > 0) result.push(trimmed);
  }
  return { value: result };
}

/**
 * Sanitize a full provider/agent input object.
 * Returns an object with trimmed fields and a list of validation errors.
 *
 * Does not throw — callers decide how to surface errors.
 */
export interface SanitizedProviderInput {
  name?: string;
  description?: string;
  endpoint?: string;
  apiKey?: string;
  errors: string[];
}

export function sanitizeProviderInput(raw: Record<string, unknown>): SanitizedProviderInput {
  const errors: string[] = [];

  const name = raw['name'] !== undefined
    ? validateString(raw['name'], 'name', MAX_NAME_LEN, false)
    : undefined;
  if (name?.error) errors.push(name.error);

  const description = raw['description'] !== undefined
    ? validateString(raw['description'], 'description', MAX_DESCRIPTION_LEN, false)
    : undefined;
  if (description?.error) errors.push(description.error);

  const endpoint = raw['endpoint'] !== undefined
    ? validateString(raw['endpoint'], 'endpoint', MAX_ENDPOINT_LEN, false)
    : undefined;
  if (endpoint?.error) errors.push(endpoint.error);

  if (endpoint && !endpoint.error && endpoint.value) {
    const urlError = validateUrl(endpoint.value, 'endpoint');
    if (urlError) errors.push(urlError);
  }

  const apiKey = raw['apiKey'] !== undefined
    ? validateString(raw['apiKey'], 'apiKey', MAX_API_KEY_LEN, false)
    : undefined;
  if (apiKey?.error) errors.push(apiKey.error);

  return {
    ...(name        && !name.error        && { name: name.value }),
    ...(description && !description.error && { description: description.value }),
    ...(endpoint    && !endpoint.error    && { endpoint: endpoint.value }),
    ...(apiKey      && !apiKey.error      && { apiKey: apiKey.value }),
    errors,
  };
}

export interface SanitizedAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  errors: string[];
}

export function sanitizeAgentInput(raw: Record<string, unknown>): SanitizedAgentInput {
  const errors: string[] = [];

  const name = raw['name'] !== undefined
    ? validateString(raw['name'], 'name', MAX_NAME_LEN, false)
    : undefined;
  if (name?.error) errors.push(name.error);

  const description = raw['description'] !== undefined
    ? validateString(raw['description'], 'description', MAX_DESCRIPTION_LEN, false)
    : undefined;
  if (description?.error) errors.push(description.error);

  const systemPrompt = raw['systemPrompt'] !== undefined
    ? validateString(raw['systemPrompt'], 'systemPrompt', MAX_SYSTEM_PROMPT_LEN, false)
    : undefined;
  if (systemPrompt?.error) errors.push(systemPrompt.error);

  return {
    ...(name         && !name.error         && { name: name.value }),
    ...(description  && !description.error  && { description: description.value }),
    ...(systemPrompt && !systemPrompt.error && { systemPrompt: systemPrompt.value }),
    errors,
  };
}
