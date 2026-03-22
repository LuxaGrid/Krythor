import { createServer, type Server } from 'http';
import { randomBytes, createHash } from 'crypto';
import { URL } from 'url';
import { logger } from './logger.js';

// ─── OAuth Provider Definitions ───────────────────────────────────────────────
//
// Each provider that supports OAuth lists:
//   - authorizationUrl  the /authorize endpoint
//   - tokenUrl          the /token endpoint
//   - scopes            default scope list
//   - clientId          public client ID (safe to ship — PKCE ensures security)
//   - usePKCE           whether to use PKCE (S256) — required for public clients
//   - deviceFlow        whether to use RFC 8628 device flow instead of redirect
//
// For providers without a registered client ID, the user supplies their own
// via the Control UI (Settings → OAuth → Provider Client ID).
//

export interface OAuthProviderDef {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Public client ID. May be overridden by user-supplied value. */
  defaultClientId?: string;
  usePKCE: boolean;
  deviceFlow?: boolean;
  /** URL where the user can register their own OAuth app to get a client ID */
  appRegistrationUrl?: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderDef> = {
  github: {
    name: 'GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user'],
    usePKCE: false, // GitHub doesn't support PKCE yet — uses state nonce only
    deviceFlow: true,
    appRegistrationUrl: 'https://github.com/settings/applications/new',
  },
  google: {
    name: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    usePKCE: true,
    appRegistrationUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  openrouter: {
    name: 'OpenRouter',
    authorizationUrl: 'https://openrouter.ai/auth',
    tokenUrl: 'https://openrouter.ai/api/v1/auth/keys',
    scopes: [],
    usePKCE: true,
    appRegistrationUrl: 'https://openrouter.ai/settings/oauth',
  },
};

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ─── Pending flow state ───────────────────────────────────────────────────────

interface PendingFlow {
  providerId: string;
  providerType: string;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  resolve: (code: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── OAuthManager ─────────────────────────────────────────────────────────────
//
// Manages the local loopback redirect server (RFC 8252) and PKCE flows.
// The loopback server listens on a random available port for the duration of
// one OAuth flow, then closes. Only one flow can be active at a time.
//

export class OAuthManager {
  private server: Server | null = null;
  private pending: PendingFlow | null = null;
  private port = 0;

  /** Start the OAuth authorization code flow for a provider.
   *  Returns the authorization URL to open in the browser. */
  async startFlow(opts: {
    providerId: string;
    providerType: string;
    clientId: string;
    clientSecret?: string;
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    usePKCE: boolean;
  }): Promise<{ authUrl: string; redirectUri: string }> {
    if (this.pending) {
      this.cancelPending('New flow started');
    }

    // Start the loopback server
    this.port = await this.startLoopbackServer();
    const redirectUri = `http://127.0.0.1:${this.port}/oauth/callback`;

    const state = randomBytes(16).toString('hex');
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (opts.usePKCE) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = generateCodeChallenge(codeVerifier);
    }

    const url = new URL(opts.authorizationUrl);
    url.searchParams.set('client_id', opts.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (opts.scopes.length > 0) {
      url.searchParams.set('scope', opts.scopes.join(' '));
    }
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    const authUrl = url.toString();

    // Store pending state — resolved when the callback arrives
    await new Promise<void>((resolveSetup) => {
      const codePromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('OAuth flow timed out after 5 minutes'));
          this.stopServer();
          this.pending = null;
        }, 5 * 60 * 1000);

        this.pending = {
          providerId: opts.providerId,
          providerType: opts.providerType,
          state,
          codeVerifier,
          redirectUri,
          tokenUrl: opts.tokenUrl,
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          resolve,
          reject,
          timer,
        };
        resolveSetup();
      });
      // We don't await codePromise here — it resolves via handleCallback
      void codePromise;
    });

    logger.info('OAuth flow started', { providerId: opts.providerId, redirectUri, port: this.port });
    return { authUrl, redirectUri };
  }

  /** Wait for the authorization code to arrive via the loopback callback.
   *  Returns the raw authorization code. */
  waitForCode(): Promise<string> {
    if (!this.pending) {
      return Promise.reject(new Error('No active OAuth flow'));
    }
    return new Promise<string>((resolve, reject) => {
      const prev = this.pending!;
      // Wrap: re-assign resolve/reject so the callback drives this promise
      clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        reject(new Error('OAuth flow timed out after 5 minutes'));
        this.stopServer();
        this.pending = null;
      }, 5 * 60 * 1000);
      prev.resolve = resolve;
      prev.reject = reject;
      prev.timer = timer;
    });
  }

  /** Exchange an authorization code for tokens. */
  async exchangeCode(code: string, flow: PendingFlow): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType: string;
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId,
    });
    if (flow.clientSecret) body.set('client_secret', flow.clientSecret);
    if (flow.codeVerifier) body.set('code_verifier', flow.codeVerifier);

    const resp = await fetch(flow.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await resp.text();
    let data: Record<string, unknown>;

    // GitHub returns form-encoded; most others return JSON
    if (resp.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) {
      data = Object.fromEntries(new URLSearchParams(text));
    } else {
      try { data = JSON.parse(text); } catch { data = {}; }
    }

    if (!resp.ok || data['error']) {
      throw new Error(
        String(data['error_description'] ?? data['error'] ?? `Token exchange failed: HTTP ${resp.status}`)
      );
    }

    return {
      accessToken:  String(data['access_token'] ?? ''),
      refreshToken: data['refresh_token'] ? String(data['refresh_token']) : undefined,
      expiresIn:    data['expires_in'] ? Number(data['expires_in']) : undefined,
      tokenType:    String(data['token_type'] ?? 'Bearer'),
    };
  }

  /** Refresh an existing OAuth access token using the stored refresh token. */
  async refreshToken(opts: {
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    });
    if (opts.clientSecret) body.set('client_secret', opts.clientSecret);

    const resp = await fetch(opts.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok || data['error']) {
      throw new Error(String(data['error_description'] ?? data['error'] ?? `Refresh failed: HTTP ${resp.status}`));
    }

    return {
      accessToken:  String(data['access_token'] ?? ''),
      refreshToken: data['refresh_token'] ? String(data['refresh_token']) : undefined,
      expiresIn:    data['expires_in'] ? Number(data['expires_in']) : undefined,
    };
  }

  /** Start the GitHub device flow. Returns device_code, user_code, verification_uri. */
  async startDeviceFlow(opts: {
    clientId: string;
    scopes: string[];
  }): Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }> {
    const body = new URLSearchParams({
      client_id: opts.clientId,
      scope: opts.scopes.join(' '),
    });

    const resp = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await resp.json() as Record<string, unknown>;
    if (!resp.ok || data['error']) {
      throw new Error(String(data['error_description'] ?? data['error'] ?? 'Device flow init failed'));
    }

    return {
      deviceCode:      String(data['device_code'] ?? ''),
      userCode:        String(data['user_code'] ?? ''),
      verificationUri: String(data['verification_uri'] ?? 'https://github.com/login/device'),
      expiresIn:       Number(data['expires_in'] ?? 900),
      interval:        Number(data['interval'] ?? 5),
    };
  }

  /** Poll for the device flow token until granted or expired. */
  async pollDeviceFlow(opts: {
    clientId: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
  }): Promise<{ accessToken: string; tokenType: string }> {
    const deadline = Date.now() + opts.expiresIn * 1000;
    let pollInterval = opts.interval * 1000;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));

      const body = new URLSearchParams({
        client_id: opts.clientId,
        device_code: opts.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      const resp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const data = await resp.json() as Record<string, unknown>;
      const error = String(data['error'] ?? '');

      if (data['access_token']) {
        return { accessToken: String(data['access_token']), tokenType: String(data['token_type'] ?? 'Bearer') };
      }
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') { pollInterval += 5000; continue; }
      if (error === 'expired_token') throw new Error('Device code expired — start again');
      if (error === 'access_denied') throw new Error('User denied authorization');
      throw new Error(String(data['error_description'] ?? error ?? 'Device flow polling failed'));
    }
    throw new Error('Device flow timed out');
  }

  getPendingFlow(): PendingFlow | null {
    return this.pending;
  }

  clearPending(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.stopServer();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private cancelPending(reason: string): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(reason));
      this.pending = null;
    }
    this.stopServer();
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  private startLoopbackServer(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1`);

        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code  = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        const flow = this.pending;
        if (!flow) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h2>No active OAuth flow — please try again.</h2>');
          return;
        }

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authorization denied: ${error}</h2><p>You can close this tab.</p>`);
          flow.reject(new Error(`Provider denied authorization: ${error}`));
          this.clearPending();
          return;
        }

        if (state !== flow.state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h2>Invalid state — possible CSRF. Please try again.</h2>');
          flow.reject(new Error('OAuth state mismatch'));
          this.clearPending();
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h2>Missing authorization code.</h2>');
          flow.reject(new Error('No code in callback'));
          this.clearPending();
          return;
        }

        // Success
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html><head><title>Krythor — Connected</title>
<style>body{font-family:system-ui,sans-serif;background:#18181b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:40px;background:#27272a;border-radius:12px;max-width:400px}
h2{color:#4ade80;margin-bottom:8px}p{color:#a1a1aa;font-size:14px}</style></head>
<body><div class="box"><h2>✓ Connected!</h2>
<p>Krythor has been authorized. You can close this tab and return to the app.</p></div></body></html>`);

        clearTimeout(flow.timer);
        flow.resolve(code);
        this.pending = null;
        // Give the response a moment to flush before closing the server
        setTimeout(() => this.stopServer(), 500);
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to bind loopback server'));
          return;
        }
        this.server = server;
        resolve(addr.port);
      });

      server.on('error', reject);
    });
  }
}
