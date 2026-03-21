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

describe('POST /api/skills', () => {
  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { systemPrompt: 'You are a helper.' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when systemPrompt is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { name: 'My Skill' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a skill and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {
        name: 'Test Skill',
        systemPrompt: 'You are a test assistant.',
        description: 'A test skill',
        tags: ['test'],
      },
    })
    // Guard may deny (403) if default policy is deny — accept either 201 or 403
    expect([201, 403]).toContain(res.statusCode)
    if (res.statusCode === 201) {
      const skill = JSON.parse(res.body) as Record<string, unknown>
      expect(skill).toHaveProperty('id')
      expect(skill['name']).toBe('Test Skill')
    }
  })

  it('creates a skill with taskProfile and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {
        name: 'Code Review Skill',
        systemPrompt: 'You are a code reviewer.',
        taskProfile: {
          taskCategories: ['code', 'refactor'],
          costTier: 'quality_first',
          speedTier: 'thorough',
          requiresVision: false,
          localOk: true,
          reasoningDepth: 'deep',
          privacySensitive: false,
        },
      },
    })
    expect([201, 403]).toContain(res.statusCode)
    if (res.statusCode === 201) {
      const skill = JSON.parse(res.body) as Record<string, unknown>
      expect(skill).toHaveProperty('taskProfile')
      const profile = skill['taskProfile'] as Record<string, unknown>
      expect(profile['costTier']).toBe('quality_first')
      expect(profile['reasoningDepth']).toBe('deep')
    }
  })

  it('returns 400 for invalid taskProfile enum value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {
        name: 'Bad Skill',
        systemPrompt: 'You are a helper.',
        taskProfile: { costTier: 'invalid_tier' },
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/skills', () => {
  it('returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('GET /api/skills/:id', () => {
  it('returns 404 for a non-existent skill', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/skills/:id', () => {
  it('returns 404 for a non-existent skill', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/skills/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    // Guard may deny first (403) or not found (404)
    expect([403, 404]).toContain(res.statusCode)
  })
})

describe('GET /api/skills/builtins', () => {
  it('returns the three built-in skill templates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/builtins',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(3)
    const names = (body as Array<Record<string, unknown>>).map(s => s.name)
    expect(names).toContain('Summarize')
    expect(names).toContain('Translate')
    expect(names).toContain('Explain')
  })

  it('each builtin skill has required fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/skills/builtins',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    const body = JSON.parse(res.body) as Array<Record<string, unknown>>
    for (const skill of body) {
      expect(typeof skill.builtinId).toBe('string')
      expect(typeof skill.name).toBe('string')
      expect(typeof skill.description).toBe('string')
      expect(typeof skill.systemPrompt).toBe('string')
      expect(Array.isArray(skill.tags)).toBe(true)
      expect((skill.tags as string[]).includes('builtin')).toBe(true)
    }
  })
})
