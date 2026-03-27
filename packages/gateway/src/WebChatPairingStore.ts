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
  /** Opaque server-side ID — safe to expose in the list; used for DELETE. */
  id: string;
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
    const id    = randomBytes(8).toString('hex');  // 16 hex chars — safe list ID
    const now = Date.now();
    const entry: WebChatPairingToken = {
      id,
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

  /** List all active (non-expired) tokens (without exposing the raw token values). */
  list(): Array<Omit<WebChatPairingToken, 'token'>> {
    this._gc();
    return Array.from(this.tokens.values()).map(({ token: _token, ...rest }) => rest);
  }

  /** Revoke by the opaque list ID (not the raw token). */
  revokeById(id: string): boolean {
    for (const [token, entry] of this.tokens) {
      if (entry.id === id) {
        this.tokens.delete(token);
        return true;
      }
    }
    return false;
  }

  /** Remove expired tokens. */
  private _gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now > entry.expiresAt) this.tokens.delete(key);
    }
  }
}
