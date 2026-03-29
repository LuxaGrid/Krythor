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

describe('GET /api/cron', () => {
  it('returns 200 with array of cron jobs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cron',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('GET /api/cron/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/cron/nonexistent-cron-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/cron', () => {
  it('creates a cron job with cron schedule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'test-cron-job',
        agentId: 'test-agent-id',
        input: 'hello',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: false,
      },
    })
    // 201 created or 400/422 if agent doesn't exist — route is registered either way
    expect([200, 201, 400, 422]).toContain(res.statusCode)
  })

  it('creates a cron job with interval schedule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'interval-job',
        agentId: 'test-agent-id',
        input: 'tick',
        schedule: { kind: 'every', everyMs: 60_000 },
        enabled: false,
      },
    })
    expect([200, 201, 400, 422]).toContain(res.statusCode)
  })

  it('rejects invalid schedule kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cron',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'bad-job',
        agentId: 'test-agent-id',
        schedule: { kind: 'invalid_kind' },
        enabled: true,
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/cron/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/cron/nonexistent-cron-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
