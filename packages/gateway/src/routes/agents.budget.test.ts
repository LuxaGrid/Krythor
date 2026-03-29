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

describe('GET /api/agents/:id/budget', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/nonexistent-agent-xyz/budget',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns usage stats for existing agent', async () => {
    // List agents to find one
    const list = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(list.body) as Array<{ id: string }>
    if (agents.length === 0) return // no agents to test against

    const agentId = agents[0]!.id
    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.sessionUsed).toBe('number')
    expect(typeof body.dailyUsed).toBe('number')
  })
})

describe('PUT /api/agents/:id/budget', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agents/nonexistent-agent-xyz/budget',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { dailyLimit: 50000 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('sets and retrieves a budget for existing agent', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(list.body) as Array<{ id: string }>
    if (agents.length === 0) return

    const agentId = agents[0]!.id

    const put = await app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { dailyLimit: 100000, sessionLimit: 50000 },
    })
    expect(put.statusCode).toBe(200)
    const body = JSON.parse(put.body) as Record<string, unknown>
    expect(body.dailyLimit).toBe(100000)
    expect(body.sessionLimit).toBe(50000)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('rejects dailyLimit below minimum', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(list.body) as Array<{ id: string }>
    if (agents.length === 0) return

    const agentId = agents[0]!.id
    const res = await app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { dailyLimit: 0 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/agents/:id/budget', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/agents/nonexistent-agent-xyz/budget',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('deletes a budget for existing agent', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(list.body) as Array<{ id: string }>
    if (agents.length === 0) return

    const agentId = agents[0]!.id

    // Set then delete
    await app.inject({
      method: 'PUT',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { dailyLimit: 1000 },
    })

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(del.statusCode).toBe(200)
    const body = JSON.parse(del.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })
})
