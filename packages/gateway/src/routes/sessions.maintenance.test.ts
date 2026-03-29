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

describe('GET /api/sessions/list', () => {
  it('returns 200 with sessions array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(Array.isArray(body)).toBe(true)
  })

  it('respects limit param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/list?limit=5',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(body.length).toBeLessThanOrEqual(5)
  })

  it('each entry has ageMs and idleDays fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/list',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const entry of body) {
      expect(typeof entry.ageMs).toBe('number')
      expect(typeof entry.idleDays).toBe('number')
      expect(typeof entry.sessionKey).toBe('string')
    }
  })
})

describe('GET /api/sessions/stale', () => {
  it('returns 200 with dry-run preview', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/stale',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.dryRun).toBe(true)
    expect(typeof body.staleDays).toBe('number')
    expect(typeof body.totalSessions).toBe('number')
    expect(typeof body.staleSessions).toBe('number')
    expect(Array.isArray(body.wouldDelete)).toBe(true)
  })

  it('respects staleDays param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/stale?staleDays=1',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.staleDays).toBe(1)
  })
})

describe('POST /api/sessions/prune', () => {
  it('returns pruned count in dry-run mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/prune',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { staleDays: 365, dryRun: true },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.dryRun).toBe(true)
    expect(typeof body.pruned).toBe('number')
    expect(typeof body.remaining).toBe('number')
    expect(Array.isArray(body.deletedKeys)).toBe(true)
  })

  it('rejects staleDays below minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/prune',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { staleDays: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects staleDays above maximum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/prune',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { staleDays: 99999 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/sessions/delete', () => {
  it('returns 404 for unknown session key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/delete',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { sessionKey: 'nonexistent:session:key:xyz' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('requires sessionKey field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/delete',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
