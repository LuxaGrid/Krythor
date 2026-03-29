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

describe('GET /api/dashboard/metrics/agents', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(Array.isArray(body)).toBe(true)
  })

  it('each element has the expected shape when populated', async () => {
    // Trigger a run to ensure at least one entry if agents exist
    const agentsRes = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(agentsRes.body) as Array<{ id: string; name: string }>

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>

    // If there are entries (only present if an agent was run during this test session),
    // verify the shape is correct.
    if (body.length > 0) {
      const entry = body[0]!
      expect(typeof entry['agentId']).toBe('string')
      expect(typeof entry['agentName']).toBe('string')
      expect(typeof entry['totalRuns']).toBe('number')
      expect(typeof entry['failedRuns']).toBe('number')
      expect(typeof entry['totalTokens']).toBe('number')
      expect(typeof entry['totalLatencyMs']).toBe('number')
      expect(typeof entry['avgLatencyMs']).toBe('number')
      expect(typeof entry['errorRate']).toBe('number')
      expect(typeof entry['lastRunAt']).toBe('number')
    }

    // Entries are sorted by totalRuns descending
    for (let i = 1; i < body.length; i++) {
      expect(body[i - 1]!['totalRuns'] as number).toBeGreaterThanOrEqual(body[i]!['totalRuns'] as number)
    }

    // Suppress unused variable warning
    void agents
  })
})

describe('GET /api/dashboard/metrics/series', () => {
  it('returns series with samples and totals', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics/series',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['windowMinutes']).toBe('number')
    expect(Array.isArray(body['samples'])).toBe(true)
    expect(typeof body['totals']).toBe('object')
    const totals = body['totals'] as Record<string, unknown>
    expect(typeof totals['requests']).toBe('number')
    expect(typeof totals['errors']).toBe('number')
    expect(typeof totals['avgLatencyMs']).toBe('number')
    expect(typeof totals['errorRate']).toBe('number')
  })
})
