import { describe, it, expect, beforeAll, vi } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

// ─── Web tools gateway route tests ────────────────────────────────────────────
//
// web_search and web_fetch gateway routes.
// Network calls are mocked via global fetch stub so tests run without internet.
//

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

describe('GET /api/tools — tool registry', () => {
  it('includes web_search in tool list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { tools: Array<{ name: string; alwaysAllowed: boolean }> }
    const webSearch = body.tools.find(t => t.name === 'web_search')
    expect(webSearch).toBeDefined()
    expect(webSearch?.alwaysAllowed).toBe(true)
  })

  it('includes web_fetch in tool list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { tools: Array<{ name: string; alwaysAllowed: boolean }> }
    const webFetch = body.tools.find(t => t.name === 'web_fetch')
    expect(webFetch).toBeDefined()
    expect(webFetch?.alwaysAllowed).toBe(true)
  })

  it('all three tools are present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tools',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { tools: Array<{ name: string }> }
    const names = body.tools.map(t => t.name)
    expect(names).toContain('exec')
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
  })
})

describe('POST /api/tools/web_search — validation', () => {
  it('returns 400 when query is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/web_search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when query is too long', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/web_search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { query: 'a'.repeat(600) },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/tools/web_search — mock response', () => {
  it('returns duckduckgo result shape on success', async () => {
    // Stub fetch to simulate DDG response
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Abstract: 'Test',
        AbstractURL: 'https://test.example.com',
        AbstractText: 'Test abstract text.',
        RelatedTopics: [],
      }),
    }) as unknown as typeof fetch

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/web_search',
        headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
        payload: { query: 'test' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body) as { query: string; source: string; results: unknown[] }
      expect(body.source).toBe('duckduckgo')
      expect(body.query).toBe('test')
      expect(Array.isArray(body.results)).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('POST /api/tools/web_fetch — validation', () => {
  it('returns 400 when url is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/web_fetch',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for non-http scheme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tools/web_fetch',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { url: 'ftp://example.com' },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as { code: string }
    expect(body.code).toBe('INVALID_URL')
  })
})

describe('POST /api/tools/web_fetch — mock response', () => {
  it('returns content shape on success', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => 'Hello world',
      headers: { get: () => 'text/plain' },
    }) as unknown as typeof fetch

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tools/web_fetch',
        headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
        payload: { url: 'https://example.com' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body) as { url: string; content: string; contentLength: number; truncated: boolean }
      expect(body.url).toBe('https://example.com')
      expect(body.content).toContain('Hello')
      expect(typeof body.contentLength).toBe('number')
      expect(typeof body.truncated).toBe('boolean')
    } finally {
      globalThis.fetch = original
    }
  })
})
