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

// ── P3-4: GET /api/models — enriched model list ───────────────────────────────

describe('GET /api/models (P3-4 enrichment)', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('each entry has id, name, providerId, provider, providerType, isDefault', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const models = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const m of models) {
      expect(m).toHaveProperty('id')
      expect(m).toHaveProperty('name')
      expect(m).toHaveProperty('providerId')
      expect(m).toHaveProperty('provider')
      expect(m).toHaveProperty('providerType')
      expect(m).toHaveProperty('isDefault')
      expect(typeof m['provider']).toBe('string')
      expect(typeof m['providerType']).toBe('string')
      expect(typeof m['isDefault']).toBe('boolean')
    }
  })

  it('preserves existing fields (badges, isAvailable)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const models = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const m of models) {
      expect(m).toHaveProperty('badges')
      expect(m).toHaveProperty('isAvailable')
    }
  })
})

// ── P3-5: GET /api/agents — systemPromptPreview ──────────────────────────────

describe('GET /api/agents (P3-5 systemPromptPreview)', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })

  it('each entry has id, name, description, model, systemPromptPreview', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const a of agents) {
      expect(a).toHaveProperty('id')
      expect(a).toHaveProperty('name')
      expect(a).toHaveProperty('description')
      expect(a).toHaveProperty('systemPromptPreview')
      // systemPromptPreview must be at most 101 chars (100 + possible ellipsis)
      expect(typeof a['systemPromptPreview']).toBe('string')
      expect((a['systemPromptPreview'] as string).length).toBeLessThanOrEqual(101)
    }
  })

  it('systemPromptPreview is a truncated version of systemPrompt', async () => {
    // Create an agent with a long system prompt
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'P3-5 Test Agent',
        systemPrompt: 'A'.repeat(200),
      }),
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body) as Record<string, unknown>
    const agentId = created['id'] as string

    // List agents and check preview
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const agents = JSON.parse(listRes.body) as Array<Record<string, unknown>>
    const found = agents.find(a => a['id'] === agentId)
    expect(found).toBeDefined()
    expect(found?.['systemPromptPreview']).toBe('A'.repeat(100) + '…')
    // systemPrompt is also present (full)
    expect(found?.['systemPrompt']).toBe('A'.repeat(200))

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/agents/${agentId}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})
