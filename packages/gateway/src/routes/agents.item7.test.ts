/**
 * ITEM 7 tests: tool permission scoping per agent (allowedTools).
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

describe('PATCH /api/agents/:id — allowedTools (ITEM 7)', () => {
  it('creates an agent with allowedTools and returns it in the response', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Item7 Allowed Tools Test',
        systemPrompt: 'You are a test.',
        allowedTools: ['web_search'],
      }),
    })
    expect(createRes.statusCode).toBe(201)
    const agent = JSON.parse(createRes.body) as Record<string, unknown>
    expect(Array.isArray(agent['allowedTools'])).toBe(true)
    expect((agent['allowedTools'] as string[])).toContain('web_search')

    // Cleanup
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent['id'] as string}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('updates allowedTools via PATCH', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Item7 PATCH allowedTools',
        systemPrompt: 'You are a test.',
      }),
    })
    const agent = JSON.parse(createRes.body) as { id: string }

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ allowedTools: ['web_fetch', 'exec'] }),
    })
    expect(patchRes.statusCode).toBe(200)
    const updated = JSON.parse(patchRes.body) as Record<string, unknown>
    expect(Array.isArray(updated['allowedTools'])).toBe(true)
    expect(updated['allowedTools'] as string[]).toContain('web_fetch')
    expect(updated['allowedTools'] as string[]).toContain('exec')

    // Cleanup
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('clears allowedTools when set to null', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Item7 Clear allowedTools',
        systemPrompt: 'You are a test.',
        allowedTools: ['web_search'],
      }),
    })
    const agent = JSON.parse(createRes.body) as { id: string }

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ allowedTools: null }),
    })
    expect(patchRes.statusCode).toBe(200)

    // Cleanup
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agent.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})
