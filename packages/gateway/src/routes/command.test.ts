import { describe, it, expect, beforeAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

// Build once — do not close. See health.test.ts for explanation.
let app: Awaited<ReturnType<typeof buildServer>>
let authToken: string
// The Host header must match the gateway's allowed list (127.0.0.1:<port>)
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
  // Read the token directly from disk — it is no longer in the /health response.
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'))
  authToken = cfg.token ?? ''
})

describe('POST /api/command', () => {
  it('returns 400 when input is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {}
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when input is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { input: '' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('handles command with no providers configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { input: 'hello' }
    })
    // Guard may deny (403), or succeed with a no-provider message (200)
    expect([200, 403]).toContain(res.statusCode)
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body) as Record<string, unknown>
      expect(body.output ?? body.noProvider ?? body.error).toBeDefined()
    }
  })
})
