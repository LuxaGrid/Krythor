/**
 * Tests for ITEM 10 — GET /api/heartbeat/history
 * and ITEM 7 — GET /api/memory/search (paginated search envelope)
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

describe('GET /api/heartbeat/history', () => {
  it('returns 200 with an object (auth required)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeat/history',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(typeof body).toBe('object')
    expect(body).not.toBeNull()
  })

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeat/history',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns an object (provider id → entry array) structure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeat/history',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    // Each value should be an array (possibly empty if no heartbeat has run yet)
    for (const val of Object.values(body)) {
      expect(Array.isArray(val)).toBe(true)
    }
  })
})

describe('GET /api/memory/search', () => {
  it('returns 200 with paginated envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search?q=test&page=1&limit=10',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.results)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.page).toBe('number')
    expect(typeof body.limit).toBe('number')
  })

  it('page defaults to 1, limit defaults to 20', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.page).toBe(1)
    expect(body.limit).toBe(20)
  })

  it('total >= results.length', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search?limit=5',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { results: unknown[]; total: number; limit: number }
    expect(body.total).toBeGreaterThanOrEqual(body.results.length)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/search',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})
