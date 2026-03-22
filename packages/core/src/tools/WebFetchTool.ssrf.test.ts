import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebFetchTool, checkSsrf, isPrivateIp, BLOCKED_HOSTNAMES } from './WebFetchTool.js'

// eslint-disable-next-line @typescript-eslint/no-unused-vars

// ─── SSRF protection unit tests ───────────────────────────────────────────────
//
// Tests for the SSRF guard added in ITEM C.
// Uses mocked DNS and fetch — no real network calls.
//

describe('SSRF — isPrivateIp', () => {
  it('returns a reason for 127.0.0.1 (loopback)', () => {
    expect(isPrivateIp('127.0.0.1')).toMatch(/loopback/)
  })

  it('returns a reason for 10.0.0.1 (private class A)', () => {
    expect(isPrivateIp('10.0.0.1')).toMatch(/private/)
  })

  it('returns a reason for 172.16.0.1 (private class B start)', () => {
    expect(isPrivateIp('172.16.0.1')).toMatch(/private/)
  })

  it('returns a reason for 172.31.255.255 (private class B end)', () => {
    expect(isPrivateIp('172.31.255.255')).toMatch(/private/)
  })

  it('returns a reason for 192.168.1.1 (private class C)', () => {
    expect(isPrivateIp('192.168.1.1')).toMatch(/private/)
  })

  it('returns a reason for 169.254.169.254 (link-local / metadata IP)', () => {
    expect(isPrivateIp('169.254.169.254')).toMatch(/link-local/)
  })

  it('returns a reason for ::1 (IPv6 loopback)', () => {
    expect(isPrivateIp('::1')).toMatch(/loopback/)
  })

  it('returns null for a public IP (1.1.1.1)', () => {
    expect(isPrivateIp('1.1.1.1')).toBeNull()
  })

  it('returns null for 8.8.8.8 (public DNS)', () => {
    expect(isPrivateIp('8.8.8.8')).toBeNull()
  })

  it('returns a reason for 172.20.0.1 (private class B middle)', () => {
    expect(isPrivateIp('172.20.0.1')).toMatch(/private/)
  })

  it('returns null for 172.15.x.x (just outside private B range)', () => {
    expect(isPrivateIp('172.15.255.255')).toBeNull()
  })

  it('returns null for 172.32.0.1 (just outside private B range end)', () => {
    expect(isPrivateIp('172.32.0.1')).toBeNull()
  })
})

describe('SSRF — BLOCKED_HOSTNAMES', () => {
  it('includes localhost', () => {
    expect(BLOCKED_HOSTNAMES.has('localhost')).toBe(true)
  })

  it('includes 0.0.0.0', () => {
    expect(BLOCKED_HOSTNAMES.has('0.0.0.0')).toBe(true)
  })

  it('includes metadata.google.internal', () => {
    expect(BLOCKED_HOSTNAMES.has('metadata.google.internal')).toBe(true)
  })

  it('includes 169.254.169.254', () => {
    expect(BLOCKED_HOSTNAMES.has('169.254.169.254')).toBe(true)
  })
})

describe('SSRF — checkSsrf', () => {
  it('blocks localhost by hostname', async () => {
    const reason = await checkSsrf('http://localhost/path')
    expect(reason).toBeTruthy()
    expect(reason).toContain('localhost')
  })

  it('blocks 169.254.169.254 directly by hostname', async () => {
    const reason = await checkSsrf('http://169.254.169.254/latest/meta-data/')
    expect(reason).toBeTruthy()
  })

  it('blocks 127.0.0.1 as a direct private IP', async () => {
    const reason = await checkSsrf('http://127.0.0.1:8080/secret')
    expect(reason).toBeTruthy()
    expect(reason).toContain('loopback')
  })

  it('blocks 10.0.0.1 as a direct private IP', async () => {
    const reason = await checkSsrf('http://10.0.0.1/admin')
    expect(reason).toBeTruthy()
    expect(reason).toContain('private')
  })

  it('blocks 192.168.1.100 as a direct private IP', async () => {
    const reason = await checkSsrf('http://192.168.1.100/api')
    expect(reason).toBeTruthy()
    expect(reason).toContain('private')
  })

  it('blocks metadata.google.internal by hostname', async () => {
    const reason = await checkSsrf('http://metadata.google.internal/')
    expect(reason).toBeTruthy()
    expect(reason).toContain('metadata.google.internal')
  })

  it('returns null for a public IP address (1.1.1.1)', async () => {
    // Direct IP address — no DNS lookup needed, tests the IP check path directly
    const reason = await checkSsrf('http://1.1.1.1/path')
    expect(reason).toBeNull()
  })
})

describe('SSRF — WebFetchTool.fetch blocks', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('blocks 127.0.0.1 and returns SsrfBlockedResult without calling fetch', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://127.0.0.1/admin')
    expect(result).toHaveProperty('error', 'SSRF_BLOCKED')
    expect((result as { url: string }).url).toBe('http://127.0.0.1/admin')
    expect((result as { reason: string }).reason).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks localhost and returns SsrfBlockedResult without calling fetch', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://localhost:3000/secrets')
    expect(result).toHaveProperty('error', 'SSRF_BLOCKED')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks 169.254.169.254 (AWS/GCP metadata endpoint) without calling fetch', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://169.254.169.254/latest/meta-data/')
    expect(result).toHaveProperty('error', 'SSRF_BLOCKED')
    expect((result as { reason: string }).reason).toBeTruthy()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks 10.0.0.1 private IP', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://10.0.0.1/api')
    expect(result).toHaveProperty('error', 'SSRF_BLOCKED')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks 192.168.1.1 private IP', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://192.168.1.1/dashboard')
    expect(result).toHaveProperty('error', 'SSRF_BLOCKED')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('allows a public IP (1.1.1.1) and calls fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'Cloudflare DNS',
      headers: { get: () => 'text/plain' },
    })

    const tool = new WebFetchTool()
    const result = await tool.fetch('http://1.1.1.1/')
    expect(result).not.toHaveProperty('error')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('includes url and reason in blocked result', async () => {
    const tool = new WebFetchTool()
    const result = await tool.fetch('http://0.0.0.0/') as { error: string; url: string; reason: string }
    expect(result.error).toBe('SSRF_BLOCKED')
    expect(typeof result.url).toBe('string')
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
