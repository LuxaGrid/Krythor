/**
 * ITEM 7 tests: GET /chat — standalone web chat page
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

describe('GET /chat (ITEM 7)', () => {
  it('returns 200 and HTML content-type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat',
      // /chat is served from the static handler, not an /api route — no auth header needed
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
  })

  it('response body contains the token injection script', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/chat',
    })
    // The page must inject __KRYTHOR_TOKEN__ so the client can authenticate
    expect(res.body).toContain('__KRYTHOR_TOKEN__')
    // Must also contain the /api/command endpoint reference
    expect(res.body).toContain('/api/command')
  })
})
