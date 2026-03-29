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

describe('GET /api/tts/status', () => {
  it('returns 200 with availability info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tts/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.available).toBe('boolean')
  })
})

describe('POST /api/tts', () => {
  it('returns 503 when no TTS provider configured (expected in test env)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { text: 'Hello world' },
    })
    // 503 expected in test env (no TTS provider), 200 if provider is configured
    expect([200, 503]).toContain(res.statusCode)
  })

  it('rejects empty text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { text: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects text over 2000 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { text: 'a'.repeat(2001) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid speed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { text: 'Hello', speed: 10 },
    })
    expect(res.statusCode).toBe(400)
  })
})
