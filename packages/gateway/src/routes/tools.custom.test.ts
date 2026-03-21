/**
 * ITEM 6 tests: user-defined custom webhook tools.
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

describe('GET /api/tools/custom (ITEM 6)', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools/custom',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('POST /api/tools/custom (ITEM 6)', () => {
  it('registers a custom tool and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/custom',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'test-hook-unique-abc',
        description: 'A test webhook tool',
        type: 'webhook',
        url: 'https://example.com/hook',
        method: 'POST',
      }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['name']).toBe('test-hook-unique-abc')
    expect(body['type']).toBe('webhook')
    expect(body['method']).toBe('POST')
  })

  it('returns 400 for missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/custom',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'incomplete', description: 'missing fields' }),
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/tools/custom/:name (ITEM 6)', () => {
  it('returns 204 after deleting an existing tool', async () => {
    // Register a tool to delete
    await app.inject({
      method: 'POST',
      url: '/api/tools/custom',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'delete-test-hook-xyz',
        description: 'to be deleted',
        type: 'webhook',
        url: 'https://example.com',
        method: 'GET',
      }),
    })
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tools/custom/delete-test-hook-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })

  it('returns 404 when tool does not exist', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tools/custom/nonexistent-tool-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
