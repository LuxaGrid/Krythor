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

describe('GET /api/webchat/pair', () => {
  it('returns 200 with token list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webchat/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.tokens)).toBe(true)
  })
})

describe('POST /api/webchat/pair', () => {
  it('creates a pairing token and returns chatUrl', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webchat/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { label: 'Test pairing', oneTimeUse: true },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(typeof body.id).toBe('string')
    expect(typeof body.chatUrl).toBe('string')
    expect(typeof body.expiresAt).toBe('number')
  })

  it('rejects ttlHours below minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webchat/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { ttlHours: 0.01 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects ttlHours above maximum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webchat/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { ttlHours: 9999 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/webchat/pair/:id', () => {
  it('revokes a pairing token by id', async () => {
    // Create first
    const create = await app.inject({
      method: 'POST',
      url: '/api/webchat/pair',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { label: 'To revoke' },
    })
    const { id } = JSON.parse(create.body) as { id: string }

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/webchat/pair/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(del.statusCode).toBe(200)
    const body = JSON.parse(del.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})

describe('GET /chat/join (public pairing redemption)', () => {
  it('returns 400 when missing token param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat/join',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 403 for invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat/join?t=invalid-token-xyz',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(403)
  })
})
