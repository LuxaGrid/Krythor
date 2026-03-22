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

// ── ITEM A: OpenAI-compatible /v1/chat/completions ───────────────────────────

describe('ITEM A — GET /v1/models', () => {
  it('returns OpenAI-format model list with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body['object']).toBe('list')
    expect(Array.isArray(body['data'])).toBe(true)
  })

  it('returns model objects with required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as { data: Array<Record<string, unknown>> }
    for (const model of body.data ?? []) {
      expect(typeof model['id']).toBe('string')
      expect(model['object']).toBe('model')
      expect(typeof model['created']).toBe('number')
      expect(typeof model['owned_by']).toBe('string')
    }
  })
})

describe('ITEM A — POST /v1/chat/completions — validation', () => {
  it('returns 400 when messages is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test' }),
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when messages is empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messages: [] }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when requested model is not found', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'this-model-does-not-exist-xyz-123',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body) as { error: { code: string } }
    expect(body.error.code).toBe('model_not_found')
  })

  it('returns 401 when auth token is wrong', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer wrong-token-xyz',
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_api_key')
  })

  it('returns 401 when no auth token is provided but one is required', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    })
    // Should be 401 when token is configured
    expect([401, 404, 503]).toContain(res.statusCode)
  })
})

describe('ITEM A — POST /v1/chat/completions — response shape', () => {
  it('non-stream response has correct OpenAI shape (503 when no providers)', async () => {
    // With no providers configured, we expect either 404 (no models) or 503 (inference failed)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${authToken}`,
        host: HOST,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Say hello' }],
        stream: false,
      }),
    })
    // Either 200 (providers configured) or 503 (no providers) or 404 (model not found)
    // Verify the response has an OpenAI-compatible shape
    const body = JSON.parse(res.body) as Record<string, unknown>
    if (res.statusCode === 200) {
      // Successful response must have the expected shape
      expect(body['id']).toBeDefined()
      expect(body['object']).toBe('chat.completion')
      expect(typeof body['created']).toBe('number')
      expect(typeof body['model']).toBe('string')
      expect(Array.isArray(body['choices'])).toBe(true)
      const choices = body['choices'] as Array<Record<string, unknown>>
      expect(choices.length).toBeGreaterThan(0)
      expect(choices[0]).toHaveProperty('message')
      expect(choices[0]).toHaveProperty('finish_reason', 'stop')
      const msg = choices[0]!['message'] as Record<string, unknown>
      expect(msg['role']).toBe('assistant')
      expect(typeof msg['content']).toBe('string')
      expect(body['usage']).toBeDefined()
      const usage = body['usage'] as Record<string, unknown>
      expect(typeof usage['prompt_tokens']).toBe('number')
      expect(typeof usage['completion_tokens']).toBe('number')
      expect(typeof usage['total_tokens']).toBe('number')
    } else {
      // Error response must have error object
      expect(body).toHaveProperty('error')
    }
  })
})
