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

describe('GET /api/agents/:agentId/auth', () => {
  it('returns 200 with profiles array for any agent id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/any-agent-id/auth',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.profiles)).toBe(true)
  })
})

describe('GET /api/agents/:agentId/auth/:name', () => {
  it('returns 404 for unknown profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/any-agent-id/auth/nonexistent-profile',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('PUT /api/agents/:agentId/auth/:name', () => {
  it('creates a profile and returns masked tokens', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agents/test-agent-auth/auth/my-service',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        accessToken: 'super-secret-access-token-12345',
        displayName: 'My Service',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
    const profile = body.profile as Record<string, unknown>
    // Token must NOT be exposed
    expect(profile['accessToken']).toBeUndefined()
    expect(profile['hasToken']).toBe(true)
    expect(profile['displayName']).toBe('My Service')
  })

  it('rejects missing accessToken', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agents/test-agent/auth/bad-profile',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { displayName: 'No token' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/agents/:agentId/auth/:name/valid', () => {
  it('returns valid boolean for any profile', async () => {
    // Create first
    await app.inject({
      method: 'PUT',
      url: '/api/agents/test-agent-valid/auth/check-svc',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { accessToken: 'valid-token-here-xyz' },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/test-agent-valid/auth/check-svc/valid',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.valid).toBe('boolean')
  })
})

describe('DELETE /api/agents/:agentId/auth/:name', () => {
  it('returns ok after deleting a profile', async () => {
    // Create first
    await app.inject({
      method: 'PUT',
      url: '/api/agents/test-agent-del/auth/to-delete',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { accessToken: 'delete-me-token-xyz' },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/test-agent-del/auth/to-delete',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})
