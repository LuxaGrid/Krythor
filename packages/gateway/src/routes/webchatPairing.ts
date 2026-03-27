// ─── Web Chat pairing routes ──────────────────────────────────────────────────
//
// POST /api/webchat/pair          — create a shareable one-time link
// GET  /api/webchat/pair          — list active pairing tokens (prefix only)
// DELETE /api/webchat/pair/:token — revoke a token
// GET  /chat/join?t=<token>       — redeem token and redirect to /chat
//
// The /chat/join endpoint exchanges the one-time token for the full gateway
// auth token (injected into the HTML, same as /chat). It is intentionally
// public (no auth header required) since the pairing token IS the credential.
//

import type { FastifyInstance } from 'fastify';
import type { WebChatPairingStore } from '../WebChatPairingStore.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function registerWebChatPairingRoutes(
  app: FastifyInstance,
  store: WebChatPairingStore,
  getAuthToken: () => string | undefined,
  uiDist: string,
): void {

  // POST /api/webchat/pair — create a shareable link
  app.post<{ Body: { label?: string; ttlHours?: number; oneTimeUse?: boolean } }>('/api/webchat/pair', {
    schema: {
      body: {
        type: 'object',
        properties: {
          label:      { type: 'string', maxLength: 128 },
          ttlHours:   { type: 'number', minimum: 0.1, maximum: 168 }, // max 1 week
          oneTimeUse: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { label, ttlHours, oneTimeUse } = req.body ?? {};
    const entry = store.create({
      label,
      ttlMs:      ttlHours ? Math.round(ttlHours * 3_600_000) : undefined,
      oneTimeUse: oneTimeUse ?? true,
    });
    // Return a shareable URL (loopback — caller knows the port)
    const chatUrl = `/chat/join?t=${entry.token}`;
    return reply.send({
      ok:       true,
      chatUrl,
      expiresAt: entry.expiresAt,
      oneTimeUse: entry.oneTimeUse,
      label:    entry.label,
    });
  });

  // GET /api/webchat/pair — list active tokens (prefixes only, no raw values)
  app.get('/api/webchat/pair', async (_req, reply) => {
    return reply.send({ tokens: store.list() });
  });

  // DELETE /api/webchat/pair/:token — revoke a token
  app.delete<{ Params: { token: string } }>('/api/webchat/pair/:token', async (req, reply) => {
    store.revoke(req.params.token);
    return reply.send({ ok: true });
  });

  // GET /chat/join?t=<token> — PUBLIC (no auth header) — redeem and serve /chat HTML
  app.get<{ Querystring: { t?: string } }>('/chat/join', async (req, reply) => {
    const pairingToken = req.query.t;
    if (!pairingToken) {
      return reply.code(400).send('Missing ?t= pairing token');
    }

    const entry = store.validate(pairingToken);
    if (!entry) {
      return reply.code(403).send('Invalid or expired pairing link');
    }

    // Serve the same /chat HTML but inject the full auth token
    const authToken = getAuthToken();
    const tokenScript = authToken
      ? `window.__KRYTHOR_TOKEN__=${JSON.stringify(authToken)};`
      : 'window.__KRYTHOR_TOKEN__=null;';

    // Try to serve from uiDist/index.html (same as /chat)
    const indexPath = join(uiDist, 'index.html');
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf-8');
      const injected = html.replace('</head>', `<script>${tokenScript}</script></head>`);
      return (reply as unknown as { type: (t: string) => { send: (b: unknown) => void } }).type('text/html').send(injected);
    }

    // Fallback: inline minimal chat page
    const chatHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><script>${tokenScript}</script></head><body><p>Loading chat… <a href="/chat">Open chat</a></p></body></html>`;
    return (reply as unknown as { type: (t: string) => { send: (b: unknown) => void } }).type('text/html').send(chatHtml);
  });
}
