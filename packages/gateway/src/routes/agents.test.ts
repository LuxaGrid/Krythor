import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

let app: Awaited<ReturnType<typeof buildServer>>
let authToken: string
const HOST = `127.0.0.1:${GATEWAY_PORT}`

function getDataDir(): string {
  if (process.env['KRYTHOR_DATA_DIR']) return process.env['KRYTHOR_DATA_DIR'];
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

describe('GET /api/agents', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/agents/stats', () => {
  it('returns stats object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toBeDefined()
  })
})

describe('Agent CRUD', () => {
  let createdId: string

  it('POST /api/agents — creates an agent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'Test Agent',
        systemPrompt: 'You are a test agent.',
        description: 'Created by test',
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { id: string; name: string }
    expect(typeof body.id).toBe('string')
    expect(body.name).toBe('Test Agent')
    createdId = body.id
  })

  it('POST /api/agents — rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'No prompt' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/agents/:id — retrieves the created agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string; name: string }
    expect(body.id).toBe(createdId)
    expect(body.name).toBe('Test Agent')
  })

  it('GET /api/agents/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /api/agents/:id — updates description', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { description: 'Updated description' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { description: string }
    expect(body.description).toBe('Updated description')
  })

  it('PATCH /api/agents/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agents/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { description: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /api/agents/:id — deletes the agent', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })

  it('GET /api/agents/:id — returns 404 after deletion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
