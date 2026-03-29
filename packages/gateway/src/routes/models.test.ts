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

describe('GET /api/models', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/models', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/models/stats', () => {
  it('returns stats object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toBeDefined()
  })
})

describe('GET /api/models/capabilities', () => {
  it('returns capabilities map', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models/capabilities',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toBeDefined()
  })
})

describe('GET /api/models/providers', () => {
  it('returns array of providers with masked secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    expect(Array.isArray(providers)).toBe(true)
    // Ensure no full API key is leaked in any provider
    for (const p of providers) {
      if (p['apiKey']) {
        expect(String(p['apiKey'])).toMatch(/^\*{4}/)
      }
    }
  })
})

describe('Provider CRUD', () => {
  let createdId: string

  it('POST /api/models/providers — creates a provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/models/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'Test Provider',
        type: 'ollama',
        endpoint: 'http://localhost:11434',
        isEnabled: false,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { id: string; name: string }
    expect(typeof body.id).toBe('string')
    expect(body.name).toBe('Test Provider')
    createdId = body.id
  })

  it('POST /api/models/providers — rejects invalid endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/models/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'Bad Provider',
        type: 'ollama',
        endpoint: 'ftp://not-allowed',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH /api/models/providers/:id — updates the provider', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/models/providers/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Updated Provider' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { name: string }
    expect(body.name).toBe('Updated Provider')
  })

  it('PATCH /api/models/providers/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/models/providers/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /api/models/providers/:id — deletes the provider', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/models/providers/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })
})
