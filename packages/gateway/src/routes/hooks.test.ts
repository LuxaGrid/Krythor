import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'
import { createHmac } from 'crypto'

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

/** Build valid hook headers (no signature — tests that don't need full HMAC). */
function freshHeaders(nonce?: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000))
  const n = nonce ?? `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    host: HOST,
    'x-krythor-timestamp': ts,
    'x-krythor-nonce': n,
  }
}

describe('POST /api/hooks/wake — schema and auth', () => {
  it('returns 400 when required "text" field is missing', async () => {
    // Schema validation fires before handler — missing required field → 400
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/wake',
      headers: { ...freshHeaders(), authorization: `Bearer ${authToken}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires gateway bearer token like all /api/* routes', async () => {
    // All /api/* routes are protected by the main auth middleware.
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/wake',
      headers: freshHeaders(),
      payload: { text: 'ping' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns non-2xx without valid timestamp/nonce', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/wake',
      headers: { host: HOST },
      payload: { text: 'ping' },
    })
    expect(res.statusCode).not.toBe(200)
  })
})

describe('POST /api/hooks/agent — auth', () => {
  it('requires gateway bearer token', async () => {
    // /api/hooks/agent is behind main gateway auth
    const res = await app.inject({
      method: 'POST',
      url: '/api/hooks/agent',
      headers: freshHeaders(),
      payload: { message: 'hello' },
    })
    expect(res.statusCode).toBe(401)
  })
})
