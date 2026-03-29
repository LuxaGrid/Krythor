/**
 * Shared-secret token authentication for Krythor Gateway.
 *
 * On first start a 32-byte random hex token is generated and written to
 * app-config.json.  Every subsequent request to /api/* or /ws/* must supply
 * the token via:
 *   - HTTP:       Authorization: Bearer <token>
 *   - WebSocket:  ?token=<token>  (query param, because WS clients cannot
 *                 set arbitrary headers in browser environments)
 *
 * /health is intentionally left public so the UI status-bar can poll it
 * before the token has been loaded into memory.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface AuthConfig {
  token: string;
  /** When true the user has opted out of auth entirely (not recommended). */
  authDisabled?: boolean;
  /**
   * When true, requests that carry a `Tailscale-User-Login` header (injected by
   * Tailscale Serve / tailscaled) are accepted without a bearer token.
   * Only enable this when the gateway is exclusively reachable via Tailscale Serve,
   * otherwise the header could be spoofed by any direct HTTP client.
   */
  allowTailscale?: boolean;
}

/** Load or generate the gateway auth token.
 *
 * Token resolution order (highest priority first):
 *   1. KRYTHOR_GATEWAY_TOKEN env var — overrides everything; useful for
 *      containers, scripts, and headless deployments where writing config
 *      files is inconvenient.
 *   2. app-config.json gatewayToken field — the normal persistent token.
 *   3. Generated — a fresh 32-byte random token written to app-config.json
 *      on first start.
 *
 * Note: authDisabled (from app-config.json) always wins over env-var tokens.
 */
export function loadOrCreateToken(configDir: string): AuthConfig {
  const path = join(configDir, 'app-config.json');
  let cfg: Record<string, unknown> = {};

  if (existsSync(path)) {
    try {
      cfg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      console.error(`[auth] Failed to parse ${path} — regenerating token. Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (cfg['authDisabled'] === true) {
    return { token: '', authDisabled: true };
  }

  const authSub = cfg['auth'] as Record<string, unknown> | undefined;
  const allowTailscale = cfg['allowTailscale'] === true || authSub?.['allowTailscale'] === true;

  // KRYTHOR_GATEWAY_TOKEN env var — highest priority (does not persist to disk)
  const envToken = process.env['KRYTHOR_GATEWAY_TOKEN'];
  if (typeof envToken === 'string' && envToken.length >= 32) {
    return { token: envToken, ...(allowTailscale && { allowTailscale }) };
  }

  if (typeof cfg['gatewayToken'] === 'string' && cfg['gatewayToken'].length >= 32) {
    return { token: cfg['gatewayToken'] as string, ...(allowTailscale && { allowTailscale }) };
  }

  // First start — generate and persist a new token.
  const token = randomBytes(32).toString('hex');
  cfg['gatewayToken'] = token;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  return { token, firstRun: true, allowTailscale } as AuthConfig & { firstRun?: boolean };
}

/** Verify a bearer token string against the expected value. */
export function verifyToken(supplied: string | undefined, expected: string): boolean {
  if (!expected) return true; // auth disabled
  if (!supplied) return false;
  // Constant-time comparison — both buffers must be the same length.
  // Pad both to max(supplied.length, expected.length) so timingSafeEqual
  // receives equal-length inputs and we avoid early-exit on length mismatch.
  const len = Math.max(supplied.length, expected.length);
  const a = Buffer.from(supplied.padEnd(len));
  const b = Buffer.from(expected.padEnd(len));
  return timingSafeEqual(a, b);
}
