/**
 * Tests for #16: Channels (outbound webhooks)
 * GET    /api/channels/events
 * GET    /api/channels
 * POST   /api/channels
 * GET    /api/channels/:id
 * PATCH  /api/channels/:id
 * DELETE /api/channels/:id
 * POST   /api/channels/:id/test
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

describe('GET /api/channels/events', () => {
  it('returns list of supported event types', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels/events',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { events: string[] }
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events).toContain('agent_run_complete')
    expect(body.events).toContain('agent_run_failed')
    expect(body.events).toContain('memory_saved')
    expect(body.events).toContain('heartbeat')
    expect(body.events).toContain('custom')
  })
})

describe('GET /api/channels', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /api/channels', () => {
  it('creates a channel and returns it without secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Webhook',
        url: 'http://127.0.0.1:9999/webhook',
        events: ['agent_run_complete'],
        secret: 'mysecret',
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['id']).toBe('string')
    expect(body['name']).toBe('Test Webhook')
    expect(body['url']).toBe('http://127.0.0.1:9999/webhook')
    expect(Array.isArray(body['events'])).toBe(true)
    expect((body['events'] as string[])).toContain('agent_run_complete')
    expect(body['hasSecret']).toBe(true)
    // Secret must NOT be returned
    expect(body['secret']).toBeUndefined()
    expect(typeof body['createdAt']).toBe('string')
  })

  it('rejects invalid URL scheme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', url: 'ftp://example.com/hook' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NoUrl' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects unknown event types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bad Events', url: 'http://127.0.0.1:9999/x', events: ['not_a_real_event'] }),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('Channel CRUD — GET/:id, PATCH/:id, DELETE/:id', () => {
  let channelId: string

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CRUD Test', url: 'http://127.0.0.1:9999/crud' }),
    })
    channelId = (JSON.parse(res.body) as { id: string }).id
  })

  it('GET /:id returns channel details', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/channels/${channelId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['id']).toBe(channelId)
    expect(body['name']).toBe('CRUD Test')
  })

  it('GET /:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/channels/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /:id updates the channel', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/channels/${channelId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name', isEnabled: false }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['name']).toBe('Updated Name')
    expect(body['isEnabled']).toBe(false)
  })

  it('DELETE /:id removes the channel', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${channelId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('DELETE /:id returns 404 after removal', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/channels/${channelId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
