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

describe('GET /api/devices', () => {
  it('returns 200 with devices array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/devices',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.devices)).toBe(true)
    // No deviceToken should be exposed
    const devices = body.devices as Record<string, unknown>[]
    for (const device of devices) {
      expect(device['deviceToken']).toBeUndefined()
    }
  })
})

describe('GET /api/devices/pending', () => {
  it('returns 200 with pending devices array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/devices/pending',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.devices)).toBe(true)
  })
})

describe('GET /api/devices/:id', () => {
  it('returns 404 for unknown device', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/devices/nonexistent-device-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/devices/:id/approve', () => {
  it('returns 404 for unknown device', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/nonexistent-device-xyz/approve',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/devices/:id/deny', () => {
  it('returns 404 for unknown device', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/nonexistent-device-xyz/deny',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/devices/:id', () => {
  it('returns 200 or 404 for unknown device', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/devices/nonexistent-device-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    // Idempotent delete returns 200; throws-on-not-found returns 404
    expect([200, 204, 404]).toContain(res.statusCode)
  })
})

describe('PATCH /api/devices/:id', () => {
  it('returns 404 for unknown device', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/devices/nonexistent-device-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { label: 'New Label' },
    })
    expect(res.statusCode).toBe(404)
  })
})
