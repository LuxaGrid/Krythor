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

describe('GET /api/nodes', () => {
  it('returns 200 with nodes array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/nodes',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.nodes)).toBe(true)
  })
})

describe('POST /api/nodes/:deviceId/invoke', () => {
  it('returns 404 for unconnected node', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes/nonexistent-node-xyz/invoke',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { command: 'ping' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('requires command field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes/some-node/invoke',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects timeout below minimum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes/some-node/invoke',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { command: 'ping', timeoutMs: 100 },
    })
    expect(res.statusCode).toBe(400)
  })
})
