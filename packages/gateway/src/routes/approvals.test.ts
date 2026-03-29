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

describe('GET /api/approvals', () => {
  it('returns 200 with approvals array and count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.approvals)).toBe(true)
    expect(typeof body.count).toBe('number')
    expect(body.count).toBe(0) // no pending approvals in test environment
  })
})

describe('POST /api/approvals/:id/respond', () => {
  it('returns 404 for unknown approval id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/nonexistent-approval-xyz/respond',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { response: 'deny' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects invalid response value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/some-id/respond',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { response: 'invalid_response' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires response field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals/some-id/respond',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/approvals/session', () => {
  it('returns 200 and clears session approvals', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/approvals/session',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})
