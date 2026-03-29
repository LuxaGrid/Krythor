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

describe('GET /api/auth/keys', () => {
  it('returns 200 with keys array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/keys',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.keys)).toBe(true)
  })
})

describe('POST /api/auth/keys', () => {
  it('creates a key and returns plaintext once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'test-key', permissions: ['chat'] },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.key).toBe('string')
    expect((body.key as string).startsWith('kry_')).toBe(true)
    expect(body.entry).toBeDefined()
  })

  it('rejects unknown permissions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'bad-key', permissions: ['does_not_exist'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires name and permissions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'no-perms' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/auth/keys/:id', () => {
  it('revokes an existing key and returns 204', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/auth/keys',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'revoke-me', permissions: ['chat'] },
    })
    const { entry } = JSON.parse(create.body) as { entry: { id: string } }

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/auth/keys/${entry.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(del.statusCode).toBe(204)
  })

  it('returns 204 even for unknown id (idempotent revoke)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/keys/nonexistent-id-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })
})
