/**
 * ITEM 5 tests: GET /api/agents/:id/run endpoint and handoff support.
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

describe('GET /api/agents/:id/run (ITEM 5)', () => {
  it('returns 404 for a nonexistent agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/does-not-exist-xyz/run?message=hello',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when message query param is missing', async () => {
    // Need any agent ID — create one
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Item5 Test Agent', systemPrompt: 'You are a test agent.' }),
    })
    expect(createRes.statusCode).toBe(201)
    const agent = JSON.parse(createRes.body) as { id: string }

    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${agent.id}/run`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('error')

    // Cleanup
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})
