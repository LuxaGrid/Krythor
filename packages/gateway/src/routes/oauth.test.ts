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

// ── GET /api/oauth/providers ─────────────────────────────────────────────────

describe('GET /api/oauth/providers', () => {
  it('returns the list of known OAuth provider definitions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    const first = body[0] as Record<string, unknown>
    expect(first).toHaveProperty('key')
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('usePKCE')
    expect(first).toHaveProperty('deviceFlow')
  })

  it('includes github, google, openrouter entries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>
    const keys = body.map(p => p['key'])
    expect(keys).toContain('github')
    expect(keys).toContain('google')
    expect(keys).toContain('openrouter')
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/providers',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── POST /api/oauth/start/:providerId ────────────────────────────────────────

describe('POST /api/oauth/start/:providerId', () => {
  it('returns 404 for unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/start/nonexistent-provider-id',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'test-client-id' }),
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['error']).toMatch(/not found/i)
  })

  it('rejects missing clientId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/start/some-provider',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing clientId with 400', async () => {
    // Schema validation runs before handler — no clientId → 400 regardless of providerId
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/start/any-provider',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ useDeviceFlow: true }), // clientId missing
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/start/anything',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'x' }),
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── POST /api/oauth/disconnect/:providerId ───────────────────────────────────

describe('DELETE /api/oauth/disconnect/:providerId', () => {
  it('returns 404 for unknown provider', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/oauth/disconnect/nonexistent-provider',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/oauth/disconnect/anything',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ── POST /api/oauth/refresh/:providerId ──────────────────────────────────────

describe('POST /api/oauth/refresh/:providerId', () => {
  it('returns 404 for unknown provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/refresh/nonexistent-provider',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'test' }),
    })
    expect(res.statusCode).toBe(404)
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/refresh/anything',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'x' }),
    })
    expect(res.statusCode).toBe(401)
  })
})
