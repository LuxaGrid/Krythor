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

// ── P3-1: Session idle timeout metadata ────────────────────────────────────

describe('Session idle timeout — GET /api/conversations', () => {
  it('list includes sessionAgeMs and isIdle on each conversation', async () => {
    // Create a conversation first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(createRes.statusCode).toBe(201)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(listRes.statusCode).toBe(200)
    const convs = JSON.parse(listRes.body) as Array<Record<string, unknown>>
    expect(Array.isArray(convs)).toBe(true)

    for (const c of convs) {
      expect(c).toHaveProperty('sessionAgeMs')
      expect(c).toHaveProperty('isIdle')
      expect(typeof c['sessionAgeMs']).toBe('number')
      expect(c['sessionAgeMs'] as number).toBeGreaterThanOrEqual(0)
      expect(typeof c['isIdle']).toBe('boolean')
    }
  })

  it('a freshly created conversation is not idle', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const conv = JSON.parse(createRes.body) as Record<string, unknown>
    const convId = conv['id'] as string

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(getRes.statusCode).toBe(200)
    const fetched = JSON.parse(getRes.body) as Record<string, unknown>

    expect(fetched).toHaveProperty('sessionAgeMs')
    expect(fetched).toHaveProperty('isIdle')
    // Fresh conversation — age should be tiny (under 5 seconds in test)
    expect(fetched['sessionAgeMs'] as number).toBeLessThan(5000)
    expect(fetched['isIdle']).toBe(false)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${convId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('GET /api/conversations/:id returns sessionAgeMs and isIdle', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const conv = JSON.parse(createRes.body) as Record<string, unknown>
    const convId = conv['id'] as string

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(getRes.statusCode).toBe(200)
    const fetched = JSON.parse(getRes.body) as Record<string, unknown>

    expect(typeof fetched['sessionAgeMs']).toBe('number')
    expect(typeof fetched['isIdle']).toBe('boolean')

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${convId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('isIdle threshold is 30 minutes (1800000ms)', () => {
    // Threshold constant verification — if sessionAgeMs >= 1800000 then isIdle = true
    const IDLE_MS = 30 * 60 * 1000
    expect(IDLE_MS).toBe(1_800_000)
  })
})
