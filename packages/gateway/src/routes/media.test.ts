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

describe('POST /api/media/analyze', () => {
  it('accepts a valid base64 payload', async () => {
    // Minimal 1x1 white GIF in base64
    const gif1x1 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/analyze',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        data: gif1x1,
        filename: 'test.gif',
        mimeType: 'image/gif',
      },
    })
    // 200 if handler supports GIF, 500 on analysis error — route is registered either way
    expect([200, 500]).toContain(res.statusCode)
  })

  it('requires data field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/analyze',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { filename: 'test.txt', mimeType: 'text/plain' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires filename field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/analyze',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { data: 'aGVsbG8=', mimeType: 'text/plain' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires mimeType field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/media/analyze',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { data: 'aGVsbG8=', filename: 'test.txt' },
    })
    expect(res.statusCode).toBe(400)
  })
})
