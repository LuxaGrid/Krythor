/**
 * Tests for #18: Gateway info + Peer registry routes
 * GET  /api/gateway/info
 * GET  /api/gateway/peers
 * POST /api/gateway/peers
 * GET  /api/gateway/peers/:id
 * PATCH /api/gateway/peers/:id
 * DELETE /api/gateway/peers/:id
 * POST /api/gateway/peers/:id/probe
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

describe('GET /api/gateway/info', () => {
  it('returns 200 with all required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['version']).toBe('string')
    expect(typeof body['platform']).toBe('string')
    expect(typeof body['arch']).toBe('string')
    expect(typeof body['nodeVersion']).toBe('string')
    expect(typeof body['gatewayId']).toBe('string')
    expect(body['gatewayId']).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof body['startTime']).toBe('string')
    expect(Array.isArray(body['capabilities'])).toBe(true)
  })

  it('capabilities includes channels and peers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { capabilities: string[] }
    const expected = ['exec', 'web_search', 'web_fetch', 'memory', 'agents', 'skills', 'tools', 'channels', 'peers']
    for (const cap of expected) {
      expect(body.capabilities).toContain(cap)
    }
  })

  it('requires auth (returns 401 without token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/gateway/peers', () => {
  it('returns 200 with peers array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { peers: unknown[] }
    expect(Array.isArray(body.peers)).toBe(true)
  })
})

describe('Peer CRUD — POST, GET/:id, PATCH/:id, DELETE/:id', () => {
  let peerId: string

  beforeAll(async () => {
    // Register a peer — will probe immediately and fail (no server at that address), but registration succeeds
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Peer', url: 'http://127.0.0.1:19999' }),
    })
    expect(res.statusCode).toBe(201)
    peerId = (JSON.parse(res.body) as { id: string }).id
  })

  it('POST returns created peer with expected fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Second Peer', url: 'http://127.0.0.1:19998' }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['id']).toBe('string')
    expect(body['name']).toBe('Second Peer')
    expect(body['url']).toBe('http://127.0.0.1:19998')
    expect(body['source']).toBe('manual')
    expect(body['isEnabled']).toBe(true)
    expect(typeof body['createdAt']).toBe('string')
  })

  it('POST rejects invalid URL scheme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Peer', url: 'ftp://somewhere.example.com' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /:id returns the peer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/gateway/peers/${peerId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['id']).toBe(peerId)
    expect(body['name']).toBe('Test Peer')
  })

  it('GET /:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/peers/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /:id updates peer fields', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/gateway/peers/${peerId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Peer', isEnabled: false }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['name']).toBe('Renamed Peer')
    expect(body['isEnabled']).toBe(false)
  })

  it('DELETE /:id removes the peer', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/gateway/peers/${peerId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('DELETE /:id returns 404 after removal', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/gateway/peers/${peerId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/gateway/peers/:id/probe', () => {
  let probeId: string

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Probe Peer', url: 'http://127.0.0.1:19997' }),
    })
    probeId = (JSON.parse(res.body) as { id: string }).id
  })

  it('returns probe result (healthy:false for unreachable peer)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gateway/peers/${probeId}/probe`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { healthy: boolean; latencyMs: number }
    expect(typeof body['healthy']).toBe('boolean')
    expect(typeof body['latencyMs']).toBe('number')
    expect(body['healthy']).toBe(false) // no server at 19997
  })

  it('returns 404 for unknown peer id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers/00000000-0000-0000-0000-000000000000/probe',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── authToken masking ─────────────────────────────────────────────────────────

describe('Peer authToken masking', () => {
  let maskedPeerId: string

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Token Peer', url: 'http://127.0.0.1:19996', authToken: 'mysecrettoken1234' }),
    })
    maskedPeerId = (JSON.parse(res.body) as { id: string }).id
  })

  it('GET /api/gateway/peers/:id masks authToken — shows only last 4 chars', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/gateway/peers/${maskedPeerId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['authToken']).toBe('****1234')
    expect(body['authToken']).not.toBe('mysecrettoken1234')
  })

  it('GET /api/gateway/peers list also masks authToken', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { peers: Record<string, unknown>[] }
    const peer = body.peers.find(p => p['id'] === maskedPeerId)
    expect(peer).toBeDefined()
    if (peer?.['authToken'] !== undefined) {
      expect(peer['authToken']).not.toBe('mysecrettoken1234')
      expect(String(peer['authToken']).startsWith('****')).toBe(true)
    }
  })

  it('peer without authToken returns no authToken field', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Token Peer', url: 'http://127.0.0.1:19995' }),
    })
    const noTokenId = (JSON.parse(createRes.body) as { id: string }).id
    const res = await app.inject({
      method: 'GET',
      url: `/api/gateway/peers/${noTokenId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['authToken']).toBeUndefined()
  })
})
