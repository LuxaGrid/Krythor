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

describe('POST /api/knowledge/documents', () => {
  it('ingests a document and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        title: 'Test Document',
        content: 'This is a test document with some content for knowledge base testing.',
        source: 'test',
        tags: ['test'],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as Record<string, unknown>
    expect(typeof (body.document as Record<string, unknown>).id).toBe('string')
    expect(typeof body.chunkCount).toBe('number')
    expect((body.chunkCount as number)).toBeGreaterThan(0)

    // Clean up
    const id = (body.document as Record<string, unknown>).id as string
    await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('chunks long content appropriately', async () => {
    const longContent = 'A'.repeat(2000)
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        title: 'Long Document',
        content: longContent,
        chunkSize: 512,
        chunkOverlap: 64,
      },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body) as { chunkCount: number; document: { id: string } }
    expect(body.chunkCount).toBeGreaterThan(1)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${body.document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('rejects missing title', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { content: 'No title here' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing content', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'No content here' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/knowledge/documents', () => {
  it('returns 200 with array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(res.body))).toBe(true)
  })

  it('respects limit param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/knowledge/documents?limit=2',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const docs = JSON.parse(res.body) as unknown[]
    expect(docs.length).toBeLessThanOrEqual(2)
  })
})

describe('GET /api/knowledge/documents/:id', () => {
  it('returns 404 for unknown doc', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/knowledge/documents/nonexistent-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns document by id', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'Lookup Test', content: 'Some content for lookup' },
    })
    const { document } = JSON.parse(create.body) as { document: { id: string } }

    const res = await app.inject({
      method: 'GET',
      url: `/api/knowledge/documents/${document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body) as Record<string, unknown>).id).toBe(document.id)

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})

describe('GET /api/knowledge/documents/:id/chunks', () => {
  it('returns 404 for unknown doc', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/knowledge/documents/nonexistent-xyz/chunks',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns chunks array', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'Chunks Test', content: 'Testing chunk listing for this document' },
    })
    const { document } = JSON.parse(create.body) as { document: { id: string } }

    const res = await app.inject({
      method: 'GET',
      url: `/api/knowledge/documents/${document.id}/chunks`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    const chunks = JSON.parse(res.body) as Array<Record<string, unknown>>
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
    expect(typeof chunks[0]!.content).toBe('string')

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })
})

describe('POST /api/knowledge/search', () => {
  it('searches across chunks', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: {
        title: 'Search Test Doc',
        content: 'The quick brown fox jumps over the lazy dog. Artificial intelligence is transforming the world.',
      },
    })
    const { document } = JSON.parse(create.body) as { document: { id: string } }

    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { query: 'artificial intelligence', limit: 5 },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { results: unknown[]; count: number; query: string }
    expect(typeof body.count).toBe('number')
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.query).toBe('artificial intelligence')

    // Clean up
    await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
  })

  it('rejects missing query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge/search',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { limit: 5 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /api/knowledge/documents/:id', () => {
  it('returns 404 for unknown doc', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/knowledge/documents/nonexistent-xyz',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(404)
  })

  it('deletes document and returns ok', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/knowledge/documents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
      payload: { title: 'Delete Me', content: 'Content to be deleted' },
    })
    const { document } = JSON.parse(create.body) as { document: { id: string } }

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/documents/${document.id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
    expect((JSON.parse(res.body) as Record<string, unknown>).ok).toBe(true)
  })
})
