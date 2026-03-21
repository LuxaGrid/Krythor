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

// ── P3-3: GET /api/providers ────────────────────────────────────────────────

describe('GET /api/providers', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('each entry has required fields without secrets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const p of providers) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('name')
      expect(p).toHaveProperty('type')
      expect(p).toHaveProperty('endpoint')
      expect(p).toHaveProperty('authMethod')
      expect(p).toHaveProperty('modelCount')
      expect(p).toHaveProperty('isDefault')
      expect(p).toHaveProperty('isEnabled')
      // Must NOT include secrets
      expect(p).not.toHaveProperty('apiKey')
      expect(p).not.toHaveProperty('oauthAccount')
    }
  })

  it('modelCount is a non-negative integer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const p of providers) {
      expect(typeof p['modelCount']).toBe('number')
      expect(p['modelCount'] as number).toBeGreaterThanOrEqual(0)
    }
  })

  it('isDefault and isEnabled are booleans', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const providers = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const p of providers) {
      expect(typeof p['isDefault']).toBe('boolean')
      expect(typeof p['isEnabled']).toBe('boolean')
    }
  })
})

// ── P3-2: POST /api/providers/:id/test ──────────────────────────────────────

describe('POST /api/providers/:id/test', () => {
  it('returns 404 for a nonexistent provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/does-not-exist/test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['ok']).toBe(false)
    expect(body).toHaveProperty('error')
  })

  it('returns ok:false with error for nonexistent provider (not throw)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/fake-provider-xyz/test',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    // 404 means "not found" — body should have ok:false
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['ok']).toBe(false)
  })
})
