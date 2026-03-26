import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebFetchTool, WEB_FETCH_MAX_CHARS, WEB_FETCH_TIMEOUT_MS, type WebFetchResult } from './WebFetchTool.js'

// ─── WebFetchTool unit tests ──────────────────────────────────────────────────
//
// fetch() is mocked via globalThis.fetch — no network calls in tests.
//

describe('WebFetchTool — constants', () => {
  it('WEB_FETCH_MAX_CHARS is 10000', () => {
    expect(WEB_FETCH_MAX_CHARS).toBe(10_000)
  })

  it('WEB_FETCH_TIMEOUT_MS is 8000', () => {
    expect(WEB_FETCH_TIMEOUT_MS).toBe(8_000)
  })
})

describe('WebFetchTool — input validation', () => {
  it('throws for unsupported scheme (ftp://)', async () => {
    const tool = new WebFetchTool()
    await expect(tool.fetch('ftp://example.com')).rejects.toThrow('Unsupported URL scheme')
  })

  it('throws for file:// scheme', async () => {
    const tool = new WebFetchTool()
    await expect(tool.fetch('file:///etc/passwd')).rejects.toThrow('Unsupported URL scheme')
  })

  it('throws for empty string', async () => {
    const tool = new WebFetchTool()
    await expect(tool.fetch('')).rejects.toThrow('non-empty')
  })
})

describe('WebFetchTool — HTML stripping', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('strips HTML tags from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body><p>Hello <strong>world</strong></p></body></html>',
      headers: { get: () => 'text/html; charset=utf-8' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com') as WebFetchResult

    expect(result.content).toContain('Hello')
    expect(result.content).toContain('world')
    expect(result.content).not.toContain('<p>')
    expect(result.content).not.toContain('<strong>')
  })

  it('removes script and style blocks', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><head><script>alert("hi")</script><style>body{color:red}</style></head><body>Content</body></html>',
      headers: { get: () => 'text/html' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com') as WebFetchResult

    expect(result.content).not.toContain('alert')
    expect(result.content).not.toContain('color:red')
    expect(result.content).toContain('Content')
  })

  it('returns plain text as-is for non-HTML content type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'Hello, plain text world.',
      headers: { get: () => 'text/plain' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com/file.txt') as WebFetchResult

    expect(result.content).toBe('Hello, plain text world.')
    expect(result.truncated).toBe(false)
  })
})

describe('WebFetchTool — truncation', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('truncates content over 10000 chars and sets truncated flag', async () => {
    const longContent = 'A'.repeat(15_000)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => longContent,
      headers: { get: () => 'text/plain' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com/long.txt') as WebFetchResult

    expect(result.truncated).toBe(true)
    expect(result.content).toContain('[Content truncated at 10000 characters')
    expect(result.contentLength).toBe(15_000)
  })

  it('does not truncate content under 10000 chars', async () => {
    const shortContent = 'B'.repeat(500)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => shortContent,
      headers: { get: () => 'text/plain' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com/short.txt') as WebFetchResult

    expect(result.truncated).toBe(false)
    expect(result.content).toBe(shortContent)
  })
})

describe('WebFetchTool — error handling', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => null },
    })

    const tool = new WebFetchTool()
    await expect(tool.fetch('https://example.com/missing')).rejects.toThrow('HTTP 404')
  })

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const tool = new WebFetchTool()
    await expect(tool.fetch('https://example.com')).rejects.toThrow('ECONNREFUSED')
  })

  it('returns url in result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'Hello',
      headers: { get: () => 'text/plain' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('https://example.com/page')

    expect(result.url).toBe('https://example.com/page')
  })
})
