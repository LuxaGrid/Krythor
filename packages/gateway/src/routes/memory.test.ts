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

describe('GET /api/memory', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/memory/search', () => {
  it('returns paginated envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search?q=test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { results: unknown[]; total: number; page: number; limit: number }
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(body.page).toBe(1)
    expect(typeof body.limit).toBe('number')
  })
})

describe('GET /api/memory/stats', () => {
  it('returns stats object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toBeDefined()
  })
})

describe('GET /api/memory/tags', () => {
  it('returns tags array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/tags',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { tags: string[] }
    expect(Array.isArray(body.tags)).toBe(true)
  })
})

describe('Memory entry CRUD', () => {
  let createdId: string

  it('POST /api/memory — creates an entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        title: 'Test Memory',
        content: 'This is a test memory entry for unit tests.',
        scope: 'user',
        source: 'test',
        tags: ['test'],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { entry: { id: string; title: string } }
    expect(typeof body.entry.id).toBe('string')
    expect(body.entry.title).toBe('Test Memory')
    createdId = body.entry.id
  })

  it('GET /api/memory/:id — retrieves the created entry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/memory/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { entry: { id: string } }
    expect(body.entry.id).toBe(createdId)
  })

  it('GET /api/memory/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /api/memory/:id — updates content', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/memory/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { content: 'Updated content for test.' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toBeDefined()
  })

  it('DELETE /api/memory/:id — deletes the entry', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/memory/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })

  it('GET /api/memory/:id — returns 404 after deletion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/memory/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/memory/export', () => {
  it('returns a JSON array with Content-Disposition header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})
