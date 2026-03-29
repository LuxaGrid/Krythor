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

describe('GET /api/update/check', () => {
  it('returns 200 with UpdateInfo shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/update/check',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.currentVersion).toBe('string')
    expect(body.channel).toBe('stable')
    expect(typeof body.updateAvailable).toBe('boolean')
    expect(body).toHaveProperty('latestVersion')
    expect(body).toHaveProperty('releaseNotes')
    expect(body).toHaveProperty('publishedAt')
    expect(body).toHaveProperty('releaseUrl')
  })

  it('returns beta channel when requested', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/update/check?channel=beta',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.channel).toBe('beta')
  })

  it('defaults to stable for unknown channel param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/update/check?channel=nightly',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.channel).toBe('stable')
  })

  it('currentVersion is a non-empty semver string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/update/check',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    const ver = body.currentVersion as string
    expect(ver.length).toBeGreaterThan(0)
    expect(ver).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('POST /api/update/set-channel', () => {
  it('accepts stable channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/set-channel',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { channel: 'stable' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.channel).toBe('stable')
  })

  it('accepts beta channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/set-channel',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { channel: 'beta' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('rejects invalid channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/update/set-channel',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { channel: 'nightly' },
    })
    expect(res.statusCode).toBe(400)
  })
})
