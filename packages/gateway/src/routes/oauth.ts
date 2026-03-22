import type { FastifyInstance } from 'fastify';
import type { ModelEngine } from '@krythor/models';
import { OAuthManager, OAUTH_PROVIDERS } from '../OAuthManager.js';
import { logger } from '../logger.js';

// ─── /api/oauth routes ────────────────────────────────────────────────────────
//
// POST /api/oauth/start/:providerId
//   Begin an OAuth flow for the named provider.
//   Body: { clientId, clientSecret?, useDeviceFlow? }
//   Returns: { authUrl, redirectUri } for authorization_code flow
//         or { userCode, verificationUri, expiresIn } for device flow
//   The gateway holds the pending state while the user authorizes in browser.
//
// POST /api/oauth/complete/:providerId
//   Manually supply an authorization code (for clients that can't use the
//   loopback redirect — e.g. headless servers). Exchanges code for tokens.
//   Body: { code, redirectUri, clientId, clientSecret?, codeVerifier? }
//
// POST /api/oauth/refresh/:providerId
//   Refresh the stored access token using the stored refresh token.
//   No body required — uses tokens already in providers.json.
//
// DELETE /api/oauth/disconnect/:providerId
//   Clear stored OAuth tokens; revert provider to authMethod: 'none'.
//
// GET /api/oauth/providers
//   List known OAuth-capable provider definitions (names, scopes, reg URLs).
//

const manager = new OAuthManager();

export function registerOAuthRoutes(app: FastifyInstance, models: ModelEngine): void {

  // GET /api/oauth/providers — list supported OAuth provider definitions
  app.get('/api/oauth/providers', async (_req, reply) => {
    const defs = Object.entries(OAUTH_PROVIDERS).map(([key, def]) => ({
      key,
      name:                def.name,
      scopes:              def.scopes,
      usePKCE:             def.usePKCE,
      deviceFlow:          def.deviceFlow ?? false,
      appRegistrationUrl:  def.appRegistrationUrl,
    }));
    return reply.send(defs);
  });

  // POST /api/oauth/start/:providerId — begin authorization code or device flow
  app.post<{
    Params: { providerId: string };
    Body: { clientId: string; clientSecret?: string; useDeviceFlow?: boolean; oauthProviderKey?: string };
  }>('/api/oauth/start/:providerId', {
    schema: {
      body: {
        type: 'object',
        required: ['clientId'],
        properties: {
          clientId:         { type: 'string', minLength: 1, maxLength: 256 },
          clientSecret:     { type: 'string', maxLength: 512 },
          useDeviceFlow:    { type: 'boolean' },
          oauthProviderKey: { type: 'string', maxLength: 64 },
        },
        additionalProperties: false,
      },
    },
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const { providerId } = req.params;
    const { clientId, clientSecret, useDeviceFlow, oauthProviderKey } = req.body;

    const provider = models.listProviders().find(p => p.id === providerId);
    if (!provider) {
      return reply.code(404).send({ error: 'Provider not found' });
    }

    // Resolve OAuth provider definition (e.g. 'github', 'google', 'openrouter')
    // Fall back to a generic PKCE flow if not in the known list.
    const oauthKey = oauthProviderKey ?? provider.type;
    const def = OAUTH_PROVIDERS[oauthKey];

    // Device flow (GitHub)
    if (useDeviceFlow || def?.deviceFlow) {
      if (!def) {
        return reply.code(400).send({ error: 'Device flow not supported for this provider — use authorization_code flow' });
      }
      try {
        const result = await manager.startDeviceFlow({ clientId, scopes: def.scopes });

        // Poll in background — when complete, store tokens
        void (async () => {
          try {
            const tokens = await manager.pollDeviceFlow({
              clientId,
              deviceCode: result.deviceCode,
              interval:   result.interval,
              expiresIn:  result.expiresIn,
            });
            models.connectOAuth(providerId, {
              accountId:    'github-device',
              displayName:  'GitHub (device flow)',
              accessToken:  tokens.accessToken,
              expiresAt:    0, // GitHub tokens don't expire
              connectedAt:  new Date().toISOString(),
            });
            logger.info('OAuth device flow complete', { providerId });
          } catch (err) {
            logger.warn('OAuth device flow failed', { providerId, error: String(err) });
          }
        })();

        return reply.send({
          flow:            'device',
          userCode:        result.userCode,
          verificationUri: result.verificationUri,
          expiresIn:       result.expiresIn,
          message:         `Go to ${result.verificationUri} and enter code: ${result.userCode}`,
        });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : 'Device flow failed' });
      }
    }

    // Authorization code flow (all others)
    const authorizationUrl = def?.authorizationUrl ?? `${provider.endpoint}/oauth/authorize`;
    const tokenUrl         = def?.tokenUrl         ?? `${provider.endpoint}/oauth/token`;
    const scopes           = def?.scopes           ?? [];
    const usePKCE          = def?.usePKCE          ?? true;

    try {
      const { authUrl, redirectUri } = await manager.startFlow({
        providerId,
        providerType: oauthKey,
        clientId,
        clientSecret,
        authorizationUrl,
        tokenUrl,
        scopes,
        usePKCE,
      });

      // Wait for callback in background — when code arrives, exchange and store
      void (async () => {
        try {
          const code = await manager.waitForCode();
          const flow = manager.getPendingFlow();
          if (!flow) return;

          const tokens = await manager.exchangeCode(code, flow as Parameters<typeof manager.exchangeCode>[1]);
          manager.clearPending();

          const expiresAt = tokens.expiresIn
            ? Math.floor(Date.now() / 1000) + tokens.expiresIn
            : 0;

          models.connectOAuth(providerId, {
            accountId:    `${oauthKey}-oauth`,
            displayName:  def?.name ?? oauthKey,
            accessToken:  tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt,
            connectedAt:  new Date().toISOString(),
          });
          logger.info('OAuth authorization code flow complete', { providerId });
        } catch (err) {
          manager.clearPending();
          logger.warn('OAuth code exchange failed', { providerId, error: String(err) });
        }
      })();

      return reply.send({
        flow:        'authorization_code',
        authUrl,
        redirectUri,
        message:     'Open authUrl in a browser. The gateway will capture the callback automatically.',
      });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to start OAuth flow' });
    }
  });

  // POST /api/oauth/complete/:providerId — manual code exchange (headless servers)
  app.post<{
    Params: { providerId: string };
    Body: { code: string; redirectUri: string; clientId: string; clientSecret?: string; codeVerifier?: string; tokenUrl?: string };
  }>('/api/oauth/complete/:providerId', {
    schema: {
      body: {
        type: 'object',
        required: ['code', 'redirectUri', 'clientId'],
        properties: {
          code:         { type: 'string', minLength: 1, maxLength: 2048 },
          redirectUri:  { type: 'string', minLength: 1, maxLength: 512 },
          clientId:     { type: 'string', minLength: 1, maxLength: 256 },
          clientSecret: { type: 'string', maxLength: 512 },
          codeVerifier: { type: 'string', maxLength: 256 },
          tokenUrl:     { type: 'string', maxLength: 512 },
        },
        additionalProperties: false,
      },
    },
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const { providerId } = req.params;
    const { code, redirectUri, clientId, clientSecret, codeVerifier, tokenUrl } = req.body;

    const provider = models.listProviders().find(p => p.id === providerId);
    if (!provider) return reply.code(404).send({ error: 'Provider not found' });

    const def = OAUTH_PROVIDERS[provider.type] ?? OAUTH_PROVIDERS['openrouter'];
    const resolvedTokenUrl = tokenUrl ?? def?.tokenUrl ?? `${provider.endpoint}/oauth/token`;

    try {
      const tokens = await manager.exchangeCode(code, {
        providerId,
        providerType: provider.type,
        state: '',
        codeVerifier,
        redirectUri,
        tokenUrl: resolvedTokenUrl,
        clientId,
        clientSecret,
        resolve: () => {},
        reject: () => {},
        timer: setTimeout(() => {}, 0),
      });

      const expiresAt = tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : 0;

      const updated = models.connectOAuth(providerId, {
        accountId:    `${provider.type}-oauth`,
        displayName:  def?.name ?? provider.type,
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
        connectedAt:  new Date().toISOString(),
      });

      return reply.send({
        ok:          true,
        providerId:  updated.id,
        authMethod:  updated.authMethod,
        displayName: updated.oauthAccount?.displayName,
        expiresAt,
      });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Code exchange failed' });
    }
  });

  // POST /api/oauth/refresh/:providerId — refresh stored access token
  app.post<{ Params: { providerId: string }; Body: { clientId: string; clientSecret?: string; tokenUrl?: string } }>(
    '/api/oauth/refresh/:providerId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['clientId'],
          properties: {
            clientId:     { type: 'string', minLength: 1, maxLength: 256 },
            clientSecret: { type: 'string', maxLength: 512 },
            tokenUrl:     { type: 'string', maxLength: 512 },
          },
          additionalProperties: false,
        },
      },
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    },
    async (req, reply) => {
      const { providerId } = req.params;
      const { clientId, clientSecret, tokenUrl } = req.body;

      const provider = models.listProviders().find(p => p.id === providerId);
      if (!provider) return reply.code(404).send({ error: 'Provider not found' });
      if (provider.authMethod !== 'oauth' || !provider.oauthAccount?.refreshToken) {
        return reply.code(400).send({ error: 'Provider has no stored refresh token' });
      }

      const def = OAUTH_PROVIDERS[provider.type];
      const resolvedTokenUrl = tokenUrl ?? def?.tokenUrl ?? `${provider.endpoint}/oauth/token`;

      try {
        const tokens = await manager.refreshToken({
          tokenUrl:     resolvedTokenUrl,
          clientId,
          clientSecret,
          refreshToken: provider.oauthAccount.refreshToken,
        });

        const expiresAt = tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : 0;

        models.connectOAuth(providerId, {
          ...provider.oauthAccount,
          accessToken:  tokens.accessToken,
          refreshToken: tokens.refreshToken ?? provider.oauthAccount.refreshToken,
          expiresAt,
          connectedAt:  provider.oauthAccount.connectedAt,
        });

        return reply.send({ ok: true, expiresAt });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Token refresh failed' });
      }
    },
  );

  // DELETE /api/oauth/disconnect/:providerId — clear OAuth tokens
  app.delete<{ Params: { providerId: string } }>('/api/oauth/disconnect/:providerId', async (req, reply) => {
    const { providerId } = req.params;
    const provider = models.listProviders().find(p => p.id === providerId);
    if (!provider) return reply.code(404).send({ error: 'Provider not found' });

    try {
      models.disconnectOAuth(providerId);
      logger.info('OAuth disconnected', { providerId });
      return reply.send({ ok: true, providerId, authMethod: 'none' });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Disconnect failed' });
    }
  });
}
