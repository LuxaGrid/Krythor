/**
 * ITEM 4 tests: GET /api/gateway/info + GET /api/gateway/peers
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

describe('GET /api/gateway/info (ITEM 4)', () => {
  it('returns 200 with all required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['version']).toBe('string')
    expect(typeof body['platform']).toBe('string')
    expect(typeof body['arch']).toBe('string')
    expect(typeof body['nodeVersion']).toBe('string')
    expect(typeof body['gatewayId']).toBe('string')
    expect(body['gatewayId']).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof body['startTime']).toBe('string')
    expect(Array.isArray(body['capabilities'])).toBe(true)
  })

  it('capabilities includes expected entries', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { capabilities: string[] }
    const expected = ['exec', 'web_search', 'web_fetch', 'memory', 'agents', 'skills', 'tools']
    for (const cap of expected) {
      expect(body.capabilities).toContain(cap)
    }
  })

  it('requires auth (returns 401 without token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/info',
      headers: { host: HOST },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /api/gateway/peers (ITEM 4)', () => {
  it('returns 200 with empty peers array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/gateway/peers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { peers: unknown[] }
    expect(Array.isArray(body.peers)).toBe(true)
    expect(body.peers).toHaveLength(0)
  })
})
