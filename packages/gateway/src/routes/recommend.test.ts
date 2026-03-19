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

describe('GET /api/recommend', () => {
  it('returns 400 when task param is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/recommend',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(400)
  })

  it('classifies a task and returns recommendation shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/recommend?task=fix+the+null+pointer+exception+in+my+code',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body).toHaveProperty('classification')
    expect(body).toHaveProperty('recommendation')
    expect(body).toHaveProperty('availableModels')
    const classification = body['classification'] as Record<string, unknown>
    expect(classification).toHaveProperty('taskType')
    expect(classification).toHaveProperty('confidence')
    expect(Array.isArray(classification['signals'])).toBe(true)
  })

  it('classifies summarization tasks correctly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/recommend?task=summarize+this+long+document+into+a+few+bullet+points',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    const classification = body['classification'] as Record<string, unknown>
    expect(['summarize', 'general']).toContain(classification['taskType'])
  })
})

describe('GET /api/recommend/preferences', () => {
  it('returns an array of preferences', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/recommend/preferences',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('PUT /api/recommend/preferences/:taskType', () => {
  it('returns 404 for a model that does not exist', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recommend/preferences/code',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { modelId: 'nonexistent-model', providerId: 'nonexistent-provider', preference: 'always_use' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recommend/preferences/code',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { modelId: 'some-model' }, // missing providerId and preference
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/recommend/preferences/:taskType', () => {
  it('returns 204 for a taskType (even if not set)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/recommend/preferences/general',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(204)
  })
})

describe('POST /api/recommend/override', () => {
  it('returns 204 when override is logged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommend/override',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: {
        taskType: 'code',
        suggestedModelId: 'gpt-4',
        chosenModelId: 'llama3:8b',
      },
    })
    expect(res.statusCode).toBe(204)
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommend/override',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: { taskType: 'code' }, // missing suggestedModelId and chosenModelId
    })
    expect(res.statusCode).toBe(400)
  })
})
