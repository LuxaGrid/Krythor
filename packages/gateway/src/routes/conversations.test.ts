import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

afterAll(async () => {
  await app.close()
})

describe('GET /api/conversations', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/conversations/search', () => {
  it('returns 400 when q is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns results envelope for valid query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/search?q=hello',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { query: string; results: unknown[]; count: number }
    expect(body.query).toBe('hello')
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.count).toBe('number')
  })
})

describe('Conversation CRUD', () => {
  let createdId: string

  it('POST /api/conversations — creates a conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { id: string; title: string }
    expect(typeof body.id).toBe('string')
    createdId = body.id
  })

  it('GET /api/conversations/:id — retrieves the created conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string; title: string }
    expect(body.id).toBe(createdId)
  })

  it('GET /api/conversations/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /api/conversations/:id/messages — returns paginated envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdId}/messages`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { messages: unknown[]; total: number }
    expect(Array.isArray(body.messages)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('PATCH /api/conversations/:id — updates title', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'Updated Title' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { title: string }
    expect(body.title).toBe('Updated Title')
  })

  it('DELETE /api/conversations/:id — deletes the conversation', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })

  it('GET /api/conversations/:id — returns 404 after deletion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
