/**
 * ITEM 8 tests: GET /api/dashboard
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

describe('GET /api/dashboard (ITEM 8)', () => {
  it('returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns all required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['uptime']).toBe('number')
    expect(typeof body['version']).toBe('string')
    expect(typeof body['providerCount']).toBe('number')
    expect(typeof body['modelCount']).toBe('number')
    expect(typeof body['agentCount']).toBe('number')
    expect(typeof body['memoryEntries']).toBe('number')
    expect(typeof body['conversationCount']).toBe('number')
    expect(typeof body['totalTokensUsed']).toBe('number')
    expect(Array.isArray(body['activeWarnings'])).toBe(true)
    // lastHeartbeat is null or an object
    expect(body['lastHeartbeat'] === null || typeof body['lastHeartbeat'] === 'object').toBe(true)
  })

  it('uptime is a positive number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { uptime: number }
    expect(body.uptime).toBeGreaterThan(0)
  })

  it('requires auth (returns 401 without token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      headers: { host: HOST },
    })
    // Auth is always required for /api/* routes
    expect(res.statusCode).toBe(401)
  })
})
