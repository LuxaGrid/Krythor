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

describe('GET /api/jobs', () => {
  it('returns 200 with jobs array and pending count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.jobs)).toBe(true)
    expect(typeof body.pending).toBe('number')
  })

  it('accepts status filter without error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs?status=pending',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })

  it('accepts limit filter and respects it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs?limit=5',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { jobs: unknown[] }
    expect(body.jobs.length).toBeLessThanOrEqual(5)
  })
})

describe('GET /api/jobs/:id', () => {
  it('returns 404 for unknown job id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs/nonexistent-job-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/jobs/:id', () => {
  it('returns 204 for unknown job id (idempotent cancel)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/jobs/nonexistent-job-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })
})
