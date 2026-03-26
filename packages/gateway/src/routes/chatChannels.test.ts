/**
 * Tests for /api/chat-channels routes
 *
 * GET    /api/chat-channels/providers
 * GET    /api/chat-channels
 * POST   /api/chat-channels
 * GET    /api/chat-channels/:id
 * PUT    /api/chat-channels/:id
 * DELETE /api/chat-channels/:id
 * POST   /api/chat-channels/:id/test
 * POST   /api/chat-channels/:id/pair
 * GET    /api/chat-channels/:id/status
 *
 * Pattern matches existing route test files: buildServer() + inject() + authToken.
 * No real network calls are made — testConnection() paths that need network are
 * either skipped or exercised via the discord token-format path (no HTTP needed).
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

let app: Awaited<ReturnType<typeof buildServer>>
let authToken: string
const HOST = `127.0.0.1:${GATEWAY_PORT}`

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor')
  }
  return join(homedir(), '.local', 'share', 'krythor')
}

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'))
  authToken = cfg.token ?? ''
})

// ── GET /api/chat-channels/providers ──────────────────────────────────────────

describe('GET /api/chat-channels/providers', () => {
  it('returns all 3 providers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { providers: Array<{ id: string }> }
    expect(Array.isArray(body.providers)).toBe(true)
    expect(body.providers).toHaveLength(3)
    const ids = body.providers.map(p => p.id)
    expect(ids).toContain('telegram')
    expect(ids).toContain('discord')
    expect(ids).toContain('whatsapp')
  })

  it('each provider has required metadata fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { providers: Array<Record<string, unknown>> }
    for (const p of body.providers) {
      expect(typeof p['id']).toBe('string')
      expect(typeof p['displayName']).toBe('string')
      expect(typeof p['description']).toBe('string')
      expect(Array.isArray(p['credentialFields'])).toBe(true)
      expect(typeof p['requiresPairing']).toBe('boolean')
      expect(typeof p['docsUrl']).toBe('string')
    }
  })
})

// ── GET /api/chat-channels (list) ─────────────────────────────────────────────

describe('GET /api/chat-channels', () => {
  it('returns a channels array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { channels: unknown[] }
    expect(Array.isArray(body.channels)).toBe(true)
  })
})

// ── POST /api/chat-channels — create ─────────────────────────────────────────

describe('POST /api/chat-channels', () => {
  it('creates a telegram channel config and returns 201', async () => {
    // Use a unique display name so tests are isolated from prior runs
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'telegram',
        type: 'telegram',
        displayName: 'Test Telegram Bot',
        enabled: true,
        credentials: { botToken: 'test-token-abc' },
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['id']).toBe('telegram')
    expect(body['type']).toBe('telegram')
    expect(body['displayName']).toBe('Test Telegram Bot')
    expect(body['enabled']).toBe(true)
  })

  it('masks secret credentials in the response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'telegram',
        type: 'telegram',
        displayName: 'Masking Test',
        enabled: true,
        credentials: { botToken: 'super-secret-token-xyz' },
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { credentials: Record<string, string> }
    // botToken is secret: true — must be masked
    expect(body.credentials['botToken']).toBe('***')
  })

  it('returns 400 for an unknown provider id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'slack', type: 'telegram' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'telegram' }), // missing type
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for invalid type enum value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'telegram', type: 'slack' }),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── Full CRUD lifecycle ────────────────────────────────────────────────────────

describe('Chat channels CRUD lifecycle', () => {
  // Use 'discord' as a stable id for lifecycle tests so they don't conflict with
  // other describe blocks (each test run reuses a single shared server instance).
  const CHANNEL_ID = 'discord'

  it('POST creates the channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: CHANNEL_ID,
        type: 'discord',
        displayName: 'CRUD Discord',
        enabled: false,
        credentials: { token: 'tok.en.val', channelId: '9876543210' },
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['id']).toBe(CHANNEL_ID)
  })

  it('GET /api/chat-channels/:id returns the channel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['id']).toBe(CHANNEL_ID)
    expect(body['displayName']).toBe('CRUD Discord')
  })

  it('GET /api/chat-channels/:id includes status field', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['status']).toBe('string')
  })

  it('GET /api/chat-channels/:id masks secret credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { credentials: Record<string, string> }
    // discord 'token' field is secret:true
    expect(body.credentials['token']).toBe('***')
    // channelId is NOT secret — must come through as-is
    expect(body.credentials['channelId']).toBe('9876543210')
  })

  it('PUT /api/chat-channels/:id updates display name and enabled flag', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ displayName: 'Updated Discord', enabled: true }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['displayName']).toBe('Updated Discord')
    expect(body['enabled']).toBe(true)
  })

  it('PUT preserves existing secret when *** is sent back', async () => {
    // First write a known token
    await app.inject({
      method: 'PUT',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ credentials: { token: 'real.tok.en', channelId: '111' } }),
    })

    // Now send *** back — the stored secret should be preserved
    const res = await app.inject({
      method: 'PUT',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ credentials: { token: '***', channelId: '222' } }),
    })
    expect(res.statusCode).toBe(200)
    // We cannot read back the raw token (it is always masked), but we can confirm
    // channelId was updated (not protected) and the call succeeded
    const body = JSON.parse(res.body) as { credentials: Record<string, string> }
    expect(body.credentials['channelId']).toBe('222')
    // token must still be masked, not literal '***'
    expect(body.credentials['token']).toBe('***')
  })

  it('DELETE /api/chat-channels/:id removes the config', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('GET after DELETE returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE again returns 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/chat-channels/${CHANNEL_ID}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── GET /api/chat-channels/:id returns 404 for unknown ────────────────────────

describe('GET /api/chat-channels/:id — unknown channel', () => {
  it('returns 404 for a channel that was never configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/does-not-exist-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── PUT /api/chat-channels/:id — unknown channel ──────────────────────────────

describe('PUT /api/chat-channels/:id — unknown channel', () => {
  it('returns 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/chat-channels/does-not-exist-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ displayName: 'Ghost' }),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── GET /api/chat-channels/:id/status ─────────────────────────────────────────

describe('GET /api/chat-channels/:id/status', () => {
  beforeAll(async () => {
    // Create a telegram channel to check status on
    await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'telegram',
        type: 'telegram',
        displayName: 'Status Test Bot',
        enabled: false,
        credentials: {},
      }),
    })
  })

  it('returns status string for a configured channel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/telegram/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { status: string }
    expect(typeof body.status).toBe('string')
  })

  it("returns 'installed' when channel is disabled", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/telegram/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { status: string }
    // disabled → 'installed'
    expect(body.status).toBe('installed')
  })

  it('returns 404 for unknown channel', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/chat-channels/no-such-channel/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── POST /api/chat-channels/:id/test ──────────────────────────────────────────

describe('POST /api/chat-channels/:id/test', () => {
  it('returns 404 for unconfigured channel', async () => {
    // Delete any lingering config first
    await app.inject({
      method: 'DELETE',
      url: '/api/chat-channels/discord',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/discord/test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns ok/latencyMs shape for discord with valid token format', async () => {
    // Create a discord channel with a valid-format token (three dot-separated segments)
    await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'discord',
        type: 'discord',
        displayName: 'Test Connection Discord',
        enabled: true,
        credentials: { token: 'MTIz.ABCDE.xyz', channelId: '12345678' },
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/discord/test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; latencyMs: number }
    expect(typeof body.ok).toBe('boolean')
    expect(typeof body.latencyMs).toBe('number')
    // Discord token format check is synchronous and should succeed
    expect(body.ok).toBe(true)
  })

  it('returns ok:false for discord with invalid token format', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'discord',
        type: 'discord',
        displayName: 'Bad Token Discord',
        enabled: true,
        credentials: { token: 'notvalidformat', channelId: '12345678' },
      }),
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/discord/test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})

// ── POST /api/chat-channels/:id/pair ──────────────────────────────────────────

describe('POST /api/chat-channels/:id/pair', () => {
  beforeAll(async () => {
    // Set up a whatsapp channel
    await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'whatsapp',
        type: 'whatsapp',
        displayName: 'My WhatsApp',
        enabled: true,
        credentials: {},
      }),
    })
  })

  it('returns a pairing code and expiresAt for whatsapp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/whatsapp/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { code: string; expiresAt: number }
    expect(typeof body.code).toBe('string')
    expect(body.code).toHaveLength(8)
    expect(/^[A-Z2-9]+$/.test(body.code)).toBe(true)
    expect(typeof body.expiresAt).toBe('number')
    expect(body.expiresAt).toBeGreaterThan(Date.now())
  })

  it('returns 404 for unknown channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/no-such-xyz/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when pairing a non-whatsapp channel', async () => {
    // Make sure telegram exists
    await app.inject({
      method: 'POST',
      url: '/api/chat-channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        id: 'telegram',
        type: 'telegram',
        displayName: 'Pair Attempt',
        enabled: true,
        credentials: {},
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat-channels/telegram/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as { error: string }
    expect(body.error).toMatch(/WhatsApp/i)
  })
})
