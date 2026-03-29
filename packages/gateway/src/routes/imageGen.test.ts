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

describe('GET /api/image/status', () => {
  it('returns 200 with availability info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/image/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.available).toBe('boolean')
  })
})

describe('POST /api/image/generate', () => {
  it('returns 503 when no image provider configured (expected in test env)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { prompt: 'A beautiful sunset' },
    })
    expect([200, 503]).toContain(res.statusCode)
  })

  it('rejects empty prompt', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { prompt: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects prompt over 1000 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { prompt: 'x'.repeat(1001) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid size', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/image/generate',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { prompt: 'test', size: '999x999' },
    })
    expect(res.statusCode).toBe(400)
  })
})
