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

describe('GET /api/workflows', () => {
  it('returns 200 with array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })
})

describe('POST /api/workflows', () => {
  it('creates a workflow and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        name: 'Test Workflow',
        description: 'A test pipeline',
        steps: [{ agentId: 'agent-1', inputMode: 'initial' }],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof body.id).toBe('string')
    expect(body.name).toBe('Test Workflow')
    expect(Array.isArray(body.steps)).toBe(true)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/workflows/${body.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('accepts custom id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        id: 'my-custom-wf-id',
        name: 'Custom ID Workflow',
        steps: [{ agentId: 'agent-a' }],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.id).toBe('my-custom-wf-id')

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: '/api/workflows/my-custom-wf-id',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('rejects missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { steps: [{ agentId: 'agent-1' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing steps', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'No Steps Workflow' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/workflows/:id', () => {
  it('returns 404 for unknown workflow', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workflows/nonexistent-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns workflow by id', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Get By ID Test', steps: [{ agentId: 'x' }] },
    })
    const { id } = JSON.parse(create.body) as { id: string }

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(body.id).toBe(id)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})

describe('PUT /api/workflows/:id', () => {
  it('returns 404 for unknown workflow', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/workflows/nonexistent-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Updated' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('updates workflow name', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Old Name', steps: [{ agentId: 'x' }] },
    })
    const { id } = JSON.parse(create.body) as { id: string }

    const update = await app.inject({
      method: 'PUT',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'New Name' },
    })
    expect(update.statusCode).toBe(200)
    expect((JSON.parse(update.body) as Record<string, unknown>).name).toBe('New Name')

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})

describe('DELETE /api/workflows/:id', () => {
  it('returns 404 for unknown workflow', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/workflows/nonexistent-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('deletes a workflow', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Delete Me', steps: [{ agentId: 'x' }] },
    })
    const { id } = JSON.parse(create.body) as { id: string }

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(del.statusCode).toBe(200)
    expect((JSON.parse(del.body) as Record<string, unknown>).ok).toBe(true)
  })
})

describe('POST /api/workflows/:id/run', () => {
  it('returns 404 for unknown workflow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workflows/nonexistent-xyz/run',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { input: 'hello' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects missing input', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/workflows',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { name: 'Run Test WF', steps: [{ agentId: 'agent-x' }] },
    })
    const { id } = JSON.parse(create.body) as { id: string }

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/${id}/run`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {},
    })
    expect(res.statusCode).toBe(400)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/workflows/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})
