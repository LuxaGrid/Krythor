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

describe('GET /api/guard/policy', () => {
  it('returns 200 with policy object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/guard/policy',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toBeDefined()
    expect(typeof body.defaultAction).toBe('string')
  })
})

describe('GET /api/guard/stats', () => {
  it('returns 200 with stats object', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/guard/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toBeDefined()
  })
})

describe('GET /api/guard/rules', () => {
  it('returns 200 with rules array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/guard/rules',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown
    expect(Array.isArray(body)).toBe(true)
  })
})

describe('POST /api/guard/check', () => {
  it('evaluates a guard context and returns a verdict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/guard/check',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        operation: 'web_search',
        source: 'agent',
        sourceId: 'test-agent',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    // Verdict has an action field: allow | deny | warn | require-approval
    expect(typeof body.action).toBe('string')
  })

  it('requires operation and source fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/guard/check',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { operation: 'web_search' },
    })
    expect(res.statusCode).toBe(400)
  })
})
