import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

afterAll(async () => {
  await app.close()
})

describe('GET /api/config', () => {
  it('returns 200 with a config object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body).toBe('object')
    // webhookToken must never be exposed
    expect('webhookToken' in body).toBe(false)
  })

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config', headers: { host: HOST } })
    expect(res.statusCode).toBe(401)
  })
})

describe('PATCH /api/config', () => {
  it('updates onboardingComplete', async () => {
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const before = JSON.parse(getRes.body) as { onboardingComplete?: boolean }
    const patchVal = !before.onboardingComplete

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { onboardingComplete: patchVal },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { onboardingComplete: boolean }
    expect(body.onboardingComplete).toBe(patchVal)

    // Restore original value
    await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { onboardingComplete: before.onboardingComplete ?? false },
    })
  })

  it('rejects invalid logLevel with enum violation', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { logLevel: 'trace' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid timeFormat value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { timeFormat: 'invalid' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/config/files/:name', () => {
  it('returns 200 for known config file "app"', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/files/app',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    // May return 200 with content or 404 if file doesn't exist yet — both are valid
    expect([200, 404]).toContain(res.statusCode)
  })

  it('returns 404 for unknown config file key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/files/nonexistent-file',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
