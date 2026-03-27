// ─── WebChatPairingStore ──────────────────────────────────────────────────────
//
// Issues short-lived one-time tokens that grant access to the /chat page.
// Useful for sharing the chat UI with others without exposing the main
// gateway auth token.
//
// Tokens are stored in-memory only (no disk persistence) — they expire
// automatically and are consumed on first use.
//

import { randomBytes } from 'crypto';

export interface WebChatPairingToken {
  token: string;
  label?: string;
  createdAt: number;
  expiresAt: number;
  /** If set, this token can only be used once. After first use it is removed. */
  oneTimeUse: boolean;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WebChatPairingStore {
  private readonly tokens = new Map<string, WebChatPairingToken>();

  /** Generate a new pairing token. */
  create(opts?: { label?: string; ttlMs?: number; oneTimeUse?: boolean }): WebChatPairingToken {
    const token = randomBytes(24).toString('hex'); // 48 hex chars
    const now = Date.now();
    const entry: WebChatPairingToken = {
      token,
      label:     opts?.label,
      createdAt: now,
      expiresAt: now + (opts?.ttlMs ?? DEFAULT_TTL_MS),
      oneTimeUse: opts?.oneTimeUse ?? true,
    };
    this.tokens.set(token, entry);
    this._gc();
    return entry;
  }

  /**
   * Validate a token. Returns the entry if valid, null otherwise.
   * Consumes the token if oneTimeUse is true.
   */
  validate(token: string): WebChatPairingToken | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    if (entry.oneTimeUse) {
      this.tokens.delete(token);
    }
    return entry;
  }

  /** Check if a token is valid without consuming it. */
  peek(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  /** Explicitly revoke a token. */
  revoke(token: string): void {
    this.tokens.delete(token);
  }

  /** List all active (non-expired) tokens (without exposing the token values). */
  list(): Array<Omit<WebChatPairingToken, 'token'> & { id: string }> {
    this._gc();
    return Array.from(this.tokens.values()).map(({ token, ...rest }) => ({
      id: token.slice(0, 8) + '…', // show prefix only
      ...rest,
    }));
  }

  /** Remove expired tokens. */
  private _gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now > entry.expiresAt) this.tokens.delete(key);
    }
  }
}
