/**
 * SessionDirectiveStore — per-session directive state.
 *
 * Directives (/think, /fast, /verbose, /reasoning, /model) are persisted
 * in memory for the lifetime of the gateway process, keyed by conversationId.
 * They are cleared when a /new or /clear command is issued.
 *
 * This is intentionally in-memory only — directives are session-local hints
 * and do not need to survive a gateway restart.
 */

import type { ThinkingLevel } from '@krythor/models';

export type VerboseLevel = 'off' | 'on' | 'full';
export type ReasoningVisibility = 'off' | 'on' | 'stream';

export interface SessionDirectives {
  /** Thinking depth level for Anthropic models. undefined = not set. */
  thinkingLevel?: ThinkingLevel;
  /** Fast mode — prefer low-latency model routing. */
  fastMode?: boolean;
  /** Verbose level — controls tool-call forwarding to chat. */
  verbose?: VerboseLevel;
  /** Reasoning visibility — controls thinking block forwarding to chat. */
  reasoning?: ReasoningVisibility;
  /** Active model override for this session. */
  modelId?: string;
}

export class SessionDirectiveStore {
  private readonly sessions = new Map<string, SessionDirectives>();

  get(sessionId: string): SessionDirectives {
    return this.sessions.get(sessionId) ?? {};
  }

  set(sessionId: string, patch: Partial<SessionDirectives>): SessionDirectives {
    const current = this.sessions.get(sessionId) ?? {};
    const updated = { ...current, ...patch };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Remove directive fields set to undefined in the patch. */
  unset(sessionId: string, keys: Array<keyof SessionDirectives>): SessionDirectives {
    const current = this.sessions.get(sessionId) ?? {};
    for (const key of keys) delete current[key];
    this.sessions.set(sessionId, current);
    return current;
  }

  /** Return a snapshot of all active sessions (for diagnostics). */
  all(): Record<string, SessionDirectives> {
    return Object.fromEntries(this.sessions.entries());
  }
}
