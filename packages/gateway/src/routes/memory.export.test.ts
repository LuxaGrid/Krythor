/**
 * ITEM 2 + 3 tests: memory export/import and pruning controls.
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

// ── ITEM 2: Memory export ──────────────────────────────────────────────────

describe('GET /api/memory/export (ITEM 2)', () => {
  it('returns 200 with an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('each entry has required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const entries = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const e of entries) {
      expect(e).toHaveProperty('id')
      expect(e).toHaveProperty('content')
      expect(e).toHaveProperty('tags')
      expect(e).toHaveProperty('source')
      expect(e).toHaveProperty('createdAt')
      expect(e).toHaveProperty('updatedAt')
      expect(Array.isArray(e['tags'])).toBe(true)
    }
  })
})

// ── ITEM 2: Memory import ──────────────────────────────────────────────────

describe('POST /api/memory/import (ITEM 2)', () => {
  it('imports new entries and returns counts', async () => {
    const payload = [
      { content: 'test-import-unique-content-abc123', source: 'test', title: 'Test Import A' },
    ]
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { imported: number; skipped: number; total: number }
    expect(body.total).toBe(1)
    expect(typeof body.imported).toBe('number')
    expect(typeof body.skipped).toBe('number')
    expect(body.imported + body.skipped).toBe(body.total)
  })

  it('skips duplicate entries (same content hash)', async () => {
    const payload = [
      { content: 'duplicate-detection-content-xyz', source: 'test', title: 'Dup A' },
      { content: 'duplicate-detection-content-xyz', source: 'test', title: 'Dup B' },
    ]
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/memory/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify([payload[0]]),
    })
    expect(res1.statusCode).toBe(200)

    // Import the same content again — should be skipped
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/memory/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    })
    const body2 = JSON.parse(res2.body) as { imported: number; skipped: number; total: number }
    expect(body2.skipped).toBeGreaterThanOrEqual(1) // at least the duplicate is skipped
  })

  it('rejects empty content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify([{ content: '', source: 'test' }]),
    })
    expect(res.statusCode).toBe(400)
  })
})

// ── ITEM 3: Memory stats enhanced ────────────────────────────────────────

describe('GET /api/memory/stats (ITEM 3 — enhanced)', () => {
  it('returns oldest and newest dates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    // oldest/newest are null when no entries, or ISO string when entries exist
    const { oldest, newest } = body
    if (oldest !== null) expect(typeof oldest).toBe('string')
    if (newest !== null) expect(typeof newest).toBe('string')
  })

  it('returns sizeEstimateBytes as a number', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body['sizeEstimateBytes']).toBe('number')
    expect(body['sizeEstimateBytes'] as number).toBeGreaterThanOrEqual(0)
  })
})

// ── ITEM 3: Memory pruning — DELETE /api/memory ───────────────────────────

describe('DELETE /api/memory (ITEM 3 — pruning controls)', () => {
  it('returns 400 when no filter is provided', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/memory',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['error']).toBe('MISSING_FILTER')
  })

  it('returns 400 for invalid olderThan date', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/memory?olderThan=not-a-date',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['error']).toBe('INVALID_DATE')
  })

  it('returns { deleted: N } with source filter', async () => {
    // First create a test entry with a unique source
    await app.inject({
      method: 'POST',
      url: '/api/memory',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        title: 'Prune Test Entry',
        content: 'This entry is for pruning test',
        scope: 'user',
        source: 'prune-test-source-unique-abc',
      }),
    })

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/memory?source=prune-test-source-unique-abc',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { deleted: number }
    expect(typeof body.deleted).toBe('number')
    expect(body.deleted).toBeGreaterThanOrEqual(1)
  })
})
