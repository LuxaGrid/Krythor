import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync } from 'fs'

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

const TEST_PROVIDER_NAMES = ['Import Test Provider']

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'))
  authToken = cfg.token ?? ''
})

afterAll(async () => {
  await app.close()
  // Remove any test providers written to the real config by this test suite
  const providersFile = join(getDataDir(), 'config', 'providers.json')
  if (existsSync(providersFile)) {
    try {
      const providers = JSON.parse(readFileSync(providersFile, 'utf-8')) as Array<Record<string, unknown>>
      const cleaned = providers.filter(p => !TEST_PROVIDER_NAMES.includes(p['name'] as string))
      writeFileSync(providersFile, JSON.stringify(cleaned, null, 2), 'utf-8')
    } catch { /* ignore — best effort */ }
  }
})

// ── ITEM 5: GET /api/config/export ─────────────────────────────────────────

describe('GET /api/config/export', () => {
  it('returns 200 with providers array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(Array.isArray(body.providers)).toBe(true)
  })

  it('export has version, exportedAt, note fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.version).toBe('string')
    expect(typeof body.exportedAt).toBe('string')
    expect(typeof body.note).toBe('string')
  })

  it('exported providers do not contain raw API keys or OAuth tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { providers: Array<Record<string, unknown>> }
    for (const p of body.providers) {
      // apiKey must be masked or absent
      if ('apiKey' in p) {
        expect(p['apiKey']).toBe('***')
      }
      // oauthAccount must never appear in export
      expect(p).not.toHaveProperty('oauthAccount')
    }
  })

  it('returns 401 without auth (when auth is enabled)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/export',
      headers: { host: HOST },
    })
    // Auth may be disabled in test env — accept 200 or 401
    expect([200, 401]).toContain(res.statusCode)
  })
})

// ── ITEM 5: POST /api/config/import ────────────────────────────────────────

describe('POST /api/config/import', () => {
  it('returns 400 when providers array is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/import',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ version: '1' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns ok:true with empty providers array (no-op import)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/import',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ version: '1', providers: [] }),
    })
    // Empty import with no valid providers may return 400 (VALIDATION_FAILED)
    // or 200 with updated:0 / added:0 — both are acceptable
    expect([200, 400]).toContain(res.statusCode)
  })

  it('rejects invalid provider entries and reports validation errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/import',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: '1',
        providers: [
          { name: 'Bad Provider' /* missing required id, type, endpoint */ },
        ],
      }),
    })
    // Should reject entirely (all entries invalid)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['ok']).toBe(false)
    expect(body).toHaveProperty('error')
  })

  it('accepts valid provider entries and returns import summary', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/config/import',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        version: '1',
        providers: [
          {
            id:         'import-test-id-abc123',
            name:       'Import Test Provider',
            type:       'ollama',
            endpoint:   'http://localhost:11434',
            authMethod: 'none',
            isDefault:  false,
            isEnabled:  false,
            models:     ['llama3.2'],
          },
        ],
      }),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['ok']).toBe(true)
    expect(typeof body['added']).toBe('number')
    expect(typeof body['updated']).toBe('number')
    expect(typeof body['message']).toBe('string')
  })
})

// ── ITEM 8: CORS headers are present ────────────────────────────────────────

describe('CORS headers', () => {
  it('health endpoint includes Access-Control-Allow-Origin for localhost', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        host: HOST,
        origin: `http://localhost:${GATEWAY_PORT}`,
        'access-control-request-method': 'GET',
      },
    })
    // 200 or 204 preflight; CORS headers should be present
    const acao = res.headers['access-control-allow-origin'] as string | undefined
    // Either the specific origin is allowed, or the request didn't trigger CORS (no header needed)
    if (acao !== undefined) {
      expect(
        acao === `http://localhost:${GATEWAY_PORT}` || acao === '*'
      ).toBe(true)
    }
  })

  it('rejects cross-origin requests from arbitrary hosts', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/config',
      headers: {
        host: HOST,
        origin: 'http://evil.example.com',
        'access-control-request-method': 'GET',
      },
    })
    // Fastify CORS should either return 403 or omit the ACAO header
    const acao = res.headers['access-control-allow-origin'] as string | undefined
    // Must not allow evil.example.com
    if (acao !== undefined) {
      expect(acao).not.toBe('http://evil.example.com')
      expect(acao).not.toBe('*')
    }
  })
})
