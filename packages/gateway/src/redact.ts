// ─── Secret Redaction ─────────────────────────────────────────────────────────
//
// Ensures API keys, tokens, and secrets never appear in log output.
// Used by DiskLogger to sanitize all data before writing to disk.
//

// Key names that indicate a secret value
const SECRET_KEY_RE = /api.?key|api.?token|token|secret|password|authorization|auth|credential|bearer/i;

// Common API key value patterns — must be specific enough to avoid false positives
// on normal content (UUIDs, base64 data, model identifiers, etc.)
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/g,          // OpenAI-style keys (sk-...)
  /ant-[A-Za-z0-9_-]{20,}/g,       // Anthropic keys (ant-...)
  /Bearer\s+[A-Za-z0-9\-._~+/]{16,}/gi, // Explicit Bearer tokens
];

function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSecrets(value);
      }
    }
    return result;
  }

  return obj;
}

// Redact secrets from an error message string
export function redactErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redactString(msg);
}
