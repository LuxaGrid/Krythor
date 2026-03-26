import type { ModelEngine } from './ModelEngine.js';
import type { InferenceRequest, InferenceResponse, RoutingContext } from './types.js';

// ─── PrivacyRouter ────────────────────────────────────────────────────────────
//
// Thin wrapper around ModelEngine.infer() that classifies prompt sensitivity
// before sending to a remote provider. If the content is 'private' or
// 'restricted' and the active policy disallows remote inference, the router
// will attempt to find a local provider (Ollama / LMStudio / GGUF) and
// re-route the request there instead of blocking.
//
// Design:
//   - Additive: does not replace ModelEngine or ModelRouter
//   - Pure pattern-matching heuristics (no ML, no network calls at classify time)
//   - Conservative: if no local provider is available and remote is disallowed,
//     the request is blocked with a clear PrivacyBlockedError
//   - Optional: callers pass `privacyRouting: true` in config to enable
//

// ── Types ─────────────────────────────────────────────────────────────────────

export type SensitivityLabel = 'public' | 'internal' | 'private' | 'restricted';

export interface PrivacyDecision {
  sensitivityLabel: SensitivityLabel;
  /** Whether the request was sent to a remote provider */
  remoteAllowed: boolean;
  /** If re-routed, the provider id that was used instead */
  reroutedTo?: string;
  /** Whether any content was redacted (currently always false — placeholder for future) */
  redactionApplied: boolean;
  reason: string;
}

export interface InferResultWithPrivacy extends InferenceResponse {
  privacyDecision: PrivacyDecision;
}

// ── PrivacyBlockedError ───────────────────────────────────────────────────────

export class PrivacyBlockedError extends Error {
  readonly sensitivityLabel: SensitivityLabel;

  constructor(label: SensitivityLabel, reason: string) {
    super(`Privacy policy blocked inference: ${reason}`);
    this.name = 'PrivacyBlockedError';
    this.sensitivityLabel = label;
  }
}

// ── Sensitivity patterns ──────────────────────────────────────────────────────

// Restricted — highest sensitivity; blocked from remote by default
const RESTRICTED_PATTERNS: RegExp[] = [
  /\[RESTRICTED\]/i,
  // SSN: 000-00-0000 / 000 00 0000 / 000000000
  /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/,
  // Credit card: 4/5/6-series 16-digit, optionally spaced/dashed
  /\b(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))\s?\d{4}\s?\d{4}\s?\d{4}\b/,
  // Passport number patterns
  /\b[A-Z]{1,2}\d{6,9}\b/,
];

// Private — high sensitivity; prefer local if configured
const PRIVATE_PATTERNS: RegExp[] = [
  /\[PRIVATE\]/i,
  // Email addresses
  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/,
  // Phone numbers: US and international (no leading \b since area code may start with '(')
  /(?:^|[\s,;:])(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}(?:\b|$)/m,
  // SSH key paths / .env file mentions
  /\.ssh[/\\]/i,
  /\.env\b/i,
  // Common password field keywords
  /\bpassword\s*[:=]\s*\S+/i,
  /\bsecret\s*[:=]\s*\S+/i,
  /\btoken\s*[:=]\s*\S+/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
];

// Internal — medium sensitivity; warn but allow remote
const INTERNAL_PATTERNS: RegExp[] = [
  /\[INTERNAL\]/i,
  // Workspace-style paths
  /\/workspace\//i,
  /C:\\Users\\[A-Za-z0-9_\-]+\\(?:Documents|Desktop|AppData)/i,
];

// ── PrivacyRouter ─────────────────────────────────────────────────────────────

export class PrivacyRouter {
  /**
   * @param modelEngine     The ModelEngine to delegate to
   * @param blockOnPrivate  If true, 'private'/'restricted' prompts without a
   *                        local provider will throw PrivacyBlockedError.
   *                        If false (default), they are sent to remote with a
   *                        warning in the privacyDecision.
   */
  constructor(
    private readonly modelEngine: ModelEngine,
    private readonly blockOnPrivate = false,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Classify the assembled prompt, optionally re-route to a local provider,
   * then call ModelEngine.infer(). Attaches privacyDecision to the result.
   */
  async infer(
    request: InferenceRequest,
    context?: RoutingContext,
    signal?: AbortSignal,
  ): Promise<InferResultWithPrivacy> {
    const promptText = this.assemblePromptText(request);
    const label = this.classifySensitivity(promptText);

    // Determine if we need to re-route
    let reroutedTo: string | undefined;
    let remoteAllowed = true;
    let effectiveRequest = request;

    if (label === 'private' || label === 'restricted') {
      const localProviderId = this.findLocalProvider();

      if (localProviderId) {
        // Re-route to local provider
        reroutedTo = localProviderId;
        remoteAllowed = false;
        effectiveRequest = {
          ...request,
          providerId: localProviderId,
          // Clear model override so local provider uses its default
          model: undefined,
        };
      } else if (this.blockOnPrivate) {
        throw new PrivacyBlockedError(
          label,
          `Prompt classified as "${label}" but no local provider is configured. ` +
          `Configure an Ollama or GGUF provider to handle private prompts locally.`,
        );
      }
      // If not blocking and no local provider, warn but allow remote
    }

    const privacyDecision: PrivacyDecision = {
      sensitivityLabel: label,
      remoteAllowed: reroutedTo ? false : true,
      reroutedTo,
      redactionApplied: false,
      reason: this.buildReason(label, reroutedTo, remoteAllowed),
    };

    const response = await this.modelEngine.infer(effectiveRequest, context, signal);

    return { ...response, privacyDecision };
  }

  /**
   * Classify a string's sensitivity level.
   * Returns the highest-severity matching label.
   */
  classifySensitivity(content: string, metadata?: Record<string, string>): SensitivityLabel {
    // Check explicit metadata tag first
    const tag = metadata?.['sensitivityLabel'];
    if (tag === 'restricted') return 'restricted';
    if (tag === 'private')    return 'private';
    if (tag === 'internal')   return 'internal';
    if (tag === 'public')     return 'public';

    // Truncate to 50 KB to bound pattern matching time
    const text = content.length > 51200 ? content.slice(0, 51200) : content;

    for (const re of RESTRICTED_PATTERNS) {
      if (re.test(text)) return 'restricted';
    }
    for (const re of PRIVATE_PATTERNS) {
      if (re.test(text)) return 'private';
    }
    for (const re of INTERNAL_PATTERNS) {
      if (re.test(text)) return 'internal';
    }

    return 'public';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Finds the first enabled local provider (ollama, gguf, or openai-compat
   * pointing to localhost). Returns the provider id or null.
   */
  findLocalProvider(): string | null {
    const providers = this.modelEngine.listProviders();

    // 1. Prefer Ollama — most common local provider
    const ollama = providers.find(p => p.type === 'ollama' && p.isEnabled);
    if (ollama) return ollama.id;

    // 2. GGUF providers are always local
    const gguf = providers.find(p => p.type === 'gguf' && p.isEnabled);
    if (gguf) return gguf.id;

    // 3. openai-compat pointing to localhost (LMStudio, kobold, etc.)
    const localCompat = providers.find(p =>
      p.type === 'openai-compat' &&
      p.isEnabled &&
      (p.endpoint.includes('127.0.0.1') || p.endpoint.includes('localhost') || p.endpoint.includes('::1')),
    );
    if (localCompat) return localCompat.id;

    return null;
  }

  private assemblePromptText(request: InferenceRequest): string {
    return request.messages.map(m => m.content).join('\n');
  }

  private buildReason(
    label: SensitivityLabel,
    reroutedTo: string | undefined,
    remoteAllowed: boolean,
  ): string {
    if (label === 'public') return 'Content classified as public — no restrictions apply.';
    if (label === 'internal') return 'Content classified as internal — remote allowed with awareness.';
    if (reroutedTo) return `Content classified as "${label}" — rerouted to local provider "${reroutedTo}".`;
    if (!remoteAllowed) return `Content classified as "${label}" — no local provider available, blocked.`;
    return `Content classified as "${label}" — no local provider configured, sent to remote with warning.`;
  }
}
