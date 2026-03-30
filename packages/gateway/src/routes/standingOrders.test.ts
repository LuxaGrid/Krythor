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

describe('GET /api/standing-orders', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/standing-orders',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/standing-orders', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('Standing orders CRUD', () => {
  let createdId: string

  it('POST /api/standing-orders — creates a standing order', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/standing-orders',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'Test Order',
        scope: 'test',
        description: 'A test standing order',
        enabled: true,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { id: string; name: string; scope: string }
    expect(typeof body.id).toBe('string')
    expect(body.name).toBe('Test Order')
    expect(body.scope).toBe('test')
    createdId = body.id
  })

  it('POST /api/standing-orders — rejects missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/standing-orders',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'No scope' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/standing-orders/:id — retrieves the created order', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/standing-orders/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string; name: string }
    expect(body.id).toBe(createdId)
    expect(body.name).toBe('Test Order')
  })

  it('GET /api/standing-orders/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/standing-orders/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /api/standing-orders/:id — updates name and description', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/standing-orders/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Updated Order', description: 'Updated desc' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { name: string; description: string }
    expect(body.name).toBe('Updated Order')
    expect(body.description).toBe('Updated desc')
  })

  it('PATCH /api/standing-orders/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/standing-orders/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /api/standing-orders/:id/prompt — returns prompt string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/standing-orders/${createdId}/prompt`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { prompt: unknown }
    expect('prompt' in body).toBe(true)
  })

  it('DELETE /api/standing-orders/:id — deletes the order', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/standing-orders/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })

  it('GET /api/standing-orders/:id — returns 404 after deletion', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/standing-orders/${createdId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /api/standing-orders/:id — returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/standing-orders/nonexistent-xyz-999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
