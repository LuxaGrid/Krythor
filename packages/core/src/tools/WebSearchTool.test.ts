import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSearchTool, WEB_SEARCH_TIMEOUT_MS, clearSearchCache } from './WebSearchTool.js'

// ─── WebSearchTool unit tests ─────────────────────────────────────────────────
//
// The DDG API is mocked via globalThis.fetch — no network calls in tests.
//

describe('WebSearchTool — constants', () => {
  it('WEB_SEARCH_TIMEOUT_MS is 5000', () => {
    expect(WEB_SEARCH_TIMEOUT_MS).toBe(5_000)
  })
})

describe('WebSearchTool — empty / invalid input', () => {
  it('returns empty results for empty query string', async () => {
    const tool = new WebSearchTool()
    const result = await tool.search('')
    expect(result.source).toBe('duckduckgo')
    expect(result.results).toEqual([])
  })

  it('returns empty results for whitespace-only query', async () => {
    const tool = new WebSearchTool()
    const result = await tool.search('   ')
    expect(result.results).toEqual([])
  })
})

describe('WebSearchTool — successful search', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    clearSearchCache()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns results from RelatedTopics', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Abstract: '',
        AbstractURL: '',
        AbstractText: '',
        RelatedTopics: [
          { Text: 'Node.js - JavaScript runtime built on V8.', FirstURL: 'https://nodejs.org' },
          { Text: 'Deno - Modern runtime for JavaScript.', FirstURL: 'https://deno.land' },
        ],
      }),
    })

    const tool = new WebSearchTool()
    const result = await tool.search('node runtime')

    expect(result.query).toBe('node runtime')
    expect(result.source).toBe('duckduckgo')
    expect(result.results.length).toBe(2)
    expect(result.results[0]!.url).toBe('https://nodejs.org')
    expect(result.results[0]!.title).toBe('Node.js')
    expect(result.results[0]!.snippet).toContain('V8')
  })

  it('includes abstract section when present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Abstract: 'TypeScript',
        AbstractURL: 'https://www.typescriptlang.org',
        AbstractText: 'TypeScript is a strongly typed programming language.',
        RelatedTopics: [],
      }),
    })

    const tool = new WebSearchTool()
    const result = await tool.search('typescript')

    expect(result.results.length).toBe(1)
    expect(result.results[0]!.url).toBe('https://www.typescriptlang.org')
    expect(result.results[0]!.snippet).toContain('strongly typed')
  })

  it('caps results at 10', async () => {
    const topics = Array.from({ length: 20 }, (_, i) => ({
      Text: `Result ${i + 1} - Description ${i + 1}.`,
      FirstURL: `https://example.com/${i + 1}`,
    }))

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ RelatedTopics: topics }),
    })

    const tool = new WebSearchTool()
    const result = await tool.search('test')

    expect(result.results.length).toBeLessThanOrEqual(10)
  })

  it('skips nested topic groups (disambiguation)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        RelatedTopics: [
          { Topics: [{ Text: 'Nested', FirstURL: 'https://nested.com' }] },
          { Text: 'Good Result - Valid entry.', FirstURL: 'https://good.com' },
        ],
      }),
    })

    const tool = new WebSearchTool()
    const result = await tool.search('test')

    // Nested group is skipped, only 'Good Result' is returned
    expect(result.results.length).toBe(1)
    expect(result.results[0]!.url).toBe('https://good.com')
  })

  it('throws on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    })

    const tool = new WebSearchTool()
    await expect(tool.search('test')).rejects.toThrow('HTTP 503')
  })

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'))

    const tool = new WebSearchTool()
    await expect(tool.search('test')).rejects.toThrow('fetch failed')
  })
})
