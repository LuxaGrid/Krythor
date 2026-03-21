/**
 * ITEM 1 tests: provider priority/maxRetries in GET /api/providers,
 * and POST /api/providers/:id update endpoint.
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

describe('GET /api/providers — priority/maxRetries fields (ITEM 1)', () => {
  it('each provider entry includes priority (number)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const p of providers) {
      expect(typeof p['priority']).toBe('number')
    }
  })

  it('each provider entry includes maxRetries (number)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const p of providers) {
      expect(typeof p['maxRetries']).toBe('number')
    }
  })
})

describe('POST /api/providers/:id — update endpoint (ITEM 1)', () => {
  it('returns 404 for a nonexistent provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/does-not-exist-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ priority: 5 }),
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for empty body (minProperties:1 not met)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/some-id',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })
    // Fastify schema validation: empty object violates minProperties:1
    expect(res.statusCode).toBe(400)
  })
})
