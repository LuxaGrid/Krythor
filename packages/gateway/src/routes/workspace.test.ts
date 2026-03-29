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

describe('GET /api/workspace', () => {
  it('returns 200 with workspace status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspace',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.dir).toBe('string')
    expect(typeof body.exists).toBe('boolean')
    expect(Array.isArray(body.files)).toBe(true)
    expect(typeof body.totalRawChars).toBe('number')
  })
})

describe('POST /api/workspace/init', () => {
  it('initialises the workspace and returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspace/init',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { skipBootstrap: true },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(typeof body.dir).toBe('string')
    expect(Array.isArray(body.files)).toBe(true)
  })
})
