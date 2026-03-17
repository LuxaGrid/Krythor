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
}

/** Load or generate the gateway auth token. */
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

  if (typeof cfg['gatewayToken'] === 'string' && cfg['gatewayToken'].length >= 32) {
    return { token: cfg['gatewayToken'] as string };
  }

  // First start — generate and persist a new token.
  const token = randomBytes(32).toString('hex');
  cfg['gatewayToken'] = token;
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
  return { token, firstRun: true } as AuthConfig & { firstRun?: boolean };
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
