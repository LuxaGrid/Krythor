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

describe('GET /api/audit/tail', () => {
  it('returns 200 with events array and total', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/tail',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.events)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('respects ?limit param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/tail?limit=5',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { events: unknown[] }
    expect(body.events.length).toBeLessThanOrEqual(5)
  })

  it('caps limit at 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/tail?limit=9999',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { events: unknown[] }
    expect(body.events.length).toBeLessThanOrEqual(500)
  })
})

describe('GET /api/audit', () => {
  it('returns 200 with events array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.events)).toBe(true)
  })

  it('accepts agentId filter without error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit?agentId=test-agent',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts from/to time range filters', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString()
    const to   = new Date().toISOString()
    const res  = await app.inject({
      method: 'GET',
      url: `/api/audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/audit/log', () => {
  it('returns 200 with entries array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/log',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.entries)).toBe(true)
  })

  it('accepts agentId and operation filters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/log?agentId=test&operation=file_read',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })
})
