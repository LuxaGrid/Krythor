/**
 * ITEM 4 tests: session naming and pinning.
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

async function createConv(): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
    payload: JSON.stringify({}),
  })
  return JSON.parse(res.body) as { id: string }
}

describe('PATCH /api/conversations/:id — name + pinned (ITEM 4)', () => {
  it('sets a name on a conversation', async () => {
    const conv = await createConv()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'My Important Chat' }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['name']).toBe('My Important Chat')
  })

  it('sets pinned=true on a conversation', async () => {
    const conv = await createConv()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ pinned: true }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['pinned']).toBe(true)
  })

  it('returns 404 for a nonexistent conversation', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/conversations/does-not-exist-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ pinned: true }),
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for empty body', async () => {
    const conv = await createConv()
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    })
    expect(res.statusCode).toBe(400)
  })

  it('pinned conversations appear first in GET /api/conversations', async () => {
    // Create two conversations: one pinned, one not
    const unpinned = await createConv()
    const pinned = await createConv()

    // Pin the second one
    await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${pinned.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ pinned: true }),
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const list = JSON.parse(listRes.body) as Array<{ id: string; pinned: boolean }>
    const pinnedIds = list.filter(c => c.pinned).map(c => c.id)
    const unpinnedIds = list.filter(c => !c.pinned).map(c => c.id)
    // All pinned entries should appear before any unpinned ones
    if (pinnedIds.length > 0 && unpinnedIds.length > 0) {
      const lastPinnedIdx   = list.findIndex(c => c.id === pinnedIds[pinnedIds.length - 1])
      const firstUnpinnedIdx = list.findIndex(c => c.id === unpinnedIds[0])
      expect(lastPinnedIdx).toBeLessThan(firstUnpinnedIdx)
    }
    // Our specific pinned conversation must be pinned
    expect(pinnedIds).toContain(pinned.id)
    expect(unpinnedIds).not.toContain(pinned.id)
    void unpinned // referenced to avoid lint warning
  })
})
