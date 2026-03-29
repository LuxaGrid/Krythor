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

describe('Canvas CRUD', () => {
  it('lists canvas pages', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.pages)).toBe(true)
  })

  it('creates and retrieves a canvas page', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/canvas',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'Test Page' },
    })
    expect(create.statusCode).toBe(201)
    const page = JSON.parse(create.body) as Record<string, unknown>
    expect(typeof page.id).toBe('string')
    expect(page.title).toBe('Test Page')

    const get = await app.inject({
      method: 'GET',
      url: `/api/canvas/${page.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(get.statusCode).toBe(200)
    expect(JSON.parse(get.body).title).toBe('Test Page')
  })

  it('returns 404 for unknown page', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/nonexistent-canvas-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('Canvas version history', () => {
  let pageId: string

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/canvas',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'History Test', html: '<p>v0</p>', css: '', js: '' },
    })
    pageId = (JSON.parse(res.body) as { id: string }).id
  })

  it('starts with empty history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { revisions: unknown[]; total: number }
    expect(body.total).toBe(0)
    expect(body.revisions).toHaveLength(0)
  })

  it('records a revision on patch', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/canvas/${pageId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { html: '<p>v1</p>', label: 'first edit' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { revisions: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    // Newest first
    expect(body.revisions[0]!.rev).toBe(1)
    expect(body.revisions[0]!.label).toBe('first edit')
    // Content omitted in list
    expect(body.revisions[0]!.html).toBeUndefined()
  })

  it('accumulates multiple revisions', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/canvas/${pageId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { html: '<p>v2</p>' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { total: number }
    expect(body.total).toBe(2)
  })

  it('retrieves full content of a specific revision', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history/1`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const rev = JSON.parse(res.body) as Record<string, unknown>
    expect(rev.rev).toBe(1)
    expect(typeof rev.html).toBe('string')
    expect(typeof rev.css).toBe('string')
    expect(typeof rev.js).toBe('string')
    expect(typeof rev.savedAt).toBe('number')
  })

  it('returns 404 for unknown revision', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history/999`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('restores a revision and snapshots current state', async () => {
    const restore = await app.inject({
      method: 'POST',
      url: `/api/canvas/${pageId}/history/1/restore`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(restore.statusCode).toBe(200)
    const page = JSON.parse(restore.body) as { html: string }
    // Restored to rev 1's html
    expect(page.html).toBe('<p>v0</p>')

    // History now has 3 entries (2 prior + the pre-restore snapshot)
    const histRes = await app.inject({
      method: 'GET',
      url: `/api/canvas/${pageId}/history`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(histRes.body) as { total: number }
    expect(body.total).toBe(3)
  })

  it('returns 404 for history of unknown page', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/canvas/nonexistent-xyz/history',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})
