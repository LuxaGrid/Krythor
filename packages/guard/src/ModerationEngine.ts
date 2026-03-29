/**
 * ModerationEngine — content scanning for PII, credentials, and prompt injection.
 *
 * Provides fast, regex-based pattern matching that runs synchronously before
 * content is forwarded to a model or written to memory. Each scanner returns
 * a ModerationResult indicating whether the content should be blocked or warned.
 *
 * Usage:
 *   const mod = new ModerationEngine();
 *   const result = mod.scan(content, { direction: 'inbound' });
 *   if (!result.allowed) throw new Error(result.reason);
 */

export type ModerationDirection = 'inbound' | 'outbound';
export type ModerationCategory = 'pii' | 'credential' | 'prompt-injection' | 'custom';

export interface ModerationPattern {
  id: string;
  name: string;
  category: ModerationCategory;
  /** Regular expression source string (case-insensitive). */
  pattern: string;
  /** 'block' stops processing; 'warn' records a warning but allows through. */
  action: 'block' | 'warn';
  /** Directions this pattern applies to. Defaults to both. */
  directions?: ModerationDirection[];
  enabled: boolean;
}

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
  /** Patterns that matched, for audit logging. */
  matched: Array<{ id: string; name: string; category: ModerationCategory; action: 'block' | 'warn' }>;
}

// ── Built-in patterns ─────────────────────────────────────────────────────────

const BUILTIN_PATTERNS: ModerationPattern[] = [
  // ── PII ──────────────────────────────────────────────────────────────────
  {
    id: 'pii-ssn',
    name: 'US Social Security Number',
    category: 'pii',
    pattern: '\\b\\d{3}[-\\s]?\\d{2}[-\\s]?\\d{4}\\b',
    action: 'warn',
    enabled: true,
  },
  {
    id: 'pii-credit-card',
    name: 'Credit Card Number',
    category: 'pii',
    pattern: '\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b',
    action: 'warn',
    enabled: true,
  },

  // ── Credentials ────────────────────────────────────────────────────────────
  {
    id: 'cred-api-key-generic',
    name: 'Generic API Key Pattern',
    category: 'credential',
    // Matches common API key assignment patterns
    pattern: '(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)\\s*[=:\\s]+[\\w\\-\\.]{20,}',
    action: 'warn',
    directions: ['outbound'],
    enabled: true,
  },
  {
    id: 'cred-aws-key',
    name: 'AWS Access Key',
    category: 'credential',
    pattern: '(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}',
    action: 'warn',
    enabled: true,
  },
  {
    id: 'cred-private-key',
    name: 'Private Key Block',
    category: 'credential',
    pattern: '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    action: 'block',
    directions: ['outbound'],
    enabled: true,
  },
  {
    id: 'cred-password-field',
    name: 'Password Field Assignment',
    category: 'credential',
    pattern: '(?:password|passwd|pwd)\\s*[=:\\s]+[^\\s]{8,}',
    action: 'warn',
    directions: ['outbound'],
    enabled: true,
  },

  // ── Prompt Injection ───────────────────────────────────────────────────────
  {
    id: 'injection-ignore-instructions',
    name: 'Ignore Instructions Attack',
    category: 'prompt-injection',
    pattern: 'ignore\\s+(?:all\\s+)?(?:previous|above|prior|earlier)\\s+instructions?',
    action: 'warn',
    directions: ['inbound'],
    enabled: true,
  },
  {
    id: 'injection-jailbreak-dan',
    name: 'DAN Jailbreak Pattern',
    category: 'prompt-injection',
    pattern: '\\bDAN\\b.{0,50}(?:do anything|no restrictions|no limits)',
    action: 'warn',
    directions: ['inbound'],
    enabled: true,
  },
  {
    id: 'injection-role-override',
    name: 'Role Override Attack',
    category: 'prompt-injection',
    pattern: 'you are now|you must act as|pretend you are|your new instructions are',
    action: 'warn',
    directions: ['inbound'],
    enabled: true,
  },
  {
    id: 'injection-system-override',
    name: 'System Prompt Override',
    category: 'prompt-injection',
    pattern: '(?:new system prompt|override system|forget your system|disregard your system)',
    action: 'warn',
    directions: ['inbound'],
    enabled: true,
  },
];

export class ModerationEngine {
  private readonly patterns: ModerationPattern[];
  private readonly compiled: Map<string, RegExp> = new Map();

  constructor(customPatterns: ModerationPattern[] = []) {
    // Custom patterns are appended after builtins; they can override by matching id
    const mergedMap = new Map<string, ModerationPattern>();
    for (const p of BUILTIN_PATTERNS) mergedMap.set(p.id, p);
    for (const p of customPatterns) mergedMap.set(p.id, p);
    this.patterns = [...mergedMap.values()];

    for (const p of this.patterns) {
      if (p.enabled) {
        try {
          this.compiled.set(p.id, new RegExp(p.pattern, 'i'));
        } catch {
          // Invalid regex in custom pattern — skip silently
        }
      }
    }
  }

  /**
   * Scan content against all enabled patterns.
   * @param content The text to scan.
   * @param options Scan options (direction defaults to 'inbound').
   */
  scan(content: string, options: { direction?: ModerationDirection } = {}): ModerationResult {
    const direction = options.direction ?? 'inbound';
    const warnings: string[] = [];
    const matched: ModerationResult['matched'] = [];

    for (const pattern of this.patterns) {
      if (!pattern.enabled) continue;
      if (pattern.directions && !pattern.directions.includes(direction)) continue;

      const regex = this.compiled.get(pattern.id);
      if (!regex) continue;

      if (regex.test(content)) {
        matched.push({ id: pattern.id, name: pattern.name, category: pattern.category, action: pattern.action });

        if (pattern.action === 'block') {
          return {
            allowed: false,
            reason: `Content blocked by moderation rule: ${pattern.name}`,
            warnings,
            matched,
          };
        }

        warnings.push(`Moderation warning (${pattern.category}): ${pattern.name}`);
      }
    }

    return { allowed: true, warnings, matched };
  }

  /** List all patterns (enabled and disabled). */
  listPatterns(): ModerationPattern[] {
    return [...this.patterns];
  }

  /** Return built-in patterns only. */
  static builtinPatterns(): ModerationPattern[] {
    return [...BUILTIN_PATTERNS];
  }
}
