// ─── WebFetchTool ─────────────────────────────────────────────────────────────
//
// Fetch a URL and return its content as plain text.
// HTML tags are stripped to reduce noise for LLM consumption.
//
// Returns: { url, content, contentLength, truncated }
//    -or-: { error: 'SSRF_BLOCKED', url, reason }  when SSRF check fails
//
// Max content: 10000 chars by default (caller can pass maxChars; capped at 50000)
// Timeout: 8000ms
// Cache: TTL-based (15 min default); keyed by url+maxChars
//
// Design:
//   - Accepts only http:// and https:// URLs (no file://, ftp://, etc.)
//   - Rejects requests to private/loopback/metadata IP ranges (SSRF protection)
//   - Strips HTML tags with a simple regex (no DOM dependency)
//   - Normalizes whitespace to remove blank runs
//   - Never throws on empty content — returns empty string
//   - Throws on network failure, timeout, or disallowed scheme
//

import { lookup } from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(lookup);

export interface WebFetchResult {
  url:           string;
  content:       string;
  contentLength: number;
  truncated:     boolean;
}

export interface UrlBlockedResult {
  error:  'URL_NOT_ALLOWED';
  url:    string;
  reason: string;
}

export interface SsrfBlockedResult {
  error:  'SSRF_BLOCKED';
  url:    string;
  reason: string;
}

/** Default maximum plain-text content returned (in characters). */
export const WEB_FETCH_MAX_CHARS = 10_000;

/** Hard cap on the maxChars parameter — callers cannot exceed this. */
export const WEB_FETCH_MAX_CHARS_CAP = 50_000;

/** Timeout for web fetch requests in milliseconds. */
export const WEB_FETCH_TIMEOUT_MS = 8_000;

/** TTL for cached fetch results in milliseconds (15 minutes). */
export const WEB_FETCH_CACHE_TTL_MS = 15 * 60 * 1_000;

// ─── Result cache ──────────────────────────────────────────────────────────────

interface CacheEntry {
  result: WebFetchResult;
  expiresAt: number;
}

/** Module-level cache shared across all WebFetchTool instances. */
const fetchCache = new Map<string, CacheEntry>();

/** Evict expired entries. Called before every cache lookup to bound memory use. */
function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of fetchCache) {
    if (entry.expiresAt <= now) fetchCache.delete(key);
  }
}

// ─── SSRF protection ──────────────────────────────────────────────────────────

/** Hostnames that are always blocked regardless of IP resolution. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  '169.254.169.254',
]);

/**
 * Check whether a resolved IPv4 or IPv6 address is in a private/loopback range.
 * Returns a description string if blocked, null if the address is public.
 */
function isPrivateIp(ip: string): string | null {
  // IPv6 loopback
  if (ip === '::1') return 'IPv6 loopback (::1)';

  // IPv6 fc00::/7 (Unique Local Addresses — includes fd00::/8)
  if (/^f[cd]/i.test(ip)) return 'IPv6 private range (fc00::/7)';

  // IPv4 — split into octets
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) {
    // Not IPv4 — could be IPv6 in other form; allow through (conservative)
    return null;
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 127)                          return 'loopback (127.x.x.x)';
  if (a === 10)                           return 'private (10.x.x.x)';
  if (a === 172 && b >= 16 && b <= 31)   return 'private (172.16-31.x.x)';
  if (a === 192 && b === 168)             return 'private (192.168.x.x)';
  if (a === 169 && b === 254)             return 'link-local (169.254.x.x)';
  if (a === 0)                            return 'reserved (0.x.x.x)';

  return null;
}

/**
 * Perform SSRF checks on a URL.
 * Returns null if the URL is allowed, or a reason string if it is blocked.
 *
 * Checks:
 *   1. Scheme must be http or https
 *   2. Hostname must not be in the static blocklist
 *   3. Hostname must not resolve to a private IP
 */
async function checkSsrf(urlStr: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'invalid URL';
  }

  // 1. Scheme check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `unsupported scheme: ${parsed.protocol}`;
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Static blocklist
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return `hostname is blocked: ${hostname}`;
  }

  // 3. Resolve hostname to IP and check for private ranges
  // If hostname looks like an IP already, check it directly
  const ipLikeParts = hostname.split('.');
  if (ipLikeParts.length === 4 && ipLikeParts.every(p => /^\d+$/.test(p))) {
    const reason = isPrivateIp(hostname);
    if (reason) return reason;
    return null; // valid public IP
  }

  // Try DNS resolution
  try {
    const result = await dnsLookup(hostname, { family: 0 });
    const resolved = Array.isArray(result) ? result[0]?.address : result.address;
    if (resolved) {
      const reason = isPrivateIp(resolved);
      if (reason) return `resolves to private IP (${resolved}): ${reason}`;
    }
  } catch {
    // DNS failure — let the actual fetch fail naturally (may be a valid public domain
    // that is just temporarily unreachable)
  }

  return null;
}

// ─── HTML stripping helpers ───────────────────────────────────────────────────

/** Remove HTML/XML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    // Remove <script> and <style> blocks entirely (content not useful)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    // Collapse multiple whitespace chars and trim
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── WebFetchTool ─────────────────────────────────────────────────────────────

export class WebFetchTool {
  /**
   * Optional URL allowlist. Each entry is a URL prefix (or exact URL).
   * When non-empty, only URLs that start with one of the allowed prefixes
   * are permitted. Set via setAllowedUrls() at runtime.
   *
   * Example: ['https://api.example.com/', 'https://docs.example.org/']
   */
  private allowedUrls: string[] = [];

  /**
   * Set the URL allowlist. Pass an empty array to disable (allow all).
   * Entries are matched as URL prefixes (case-insensitive).
   */
  setAllowedUrls(urls: string[]): void {
    this.allowedUrls = urls.map(u => u.toLowerCase());
  }

  /**
   * Check if a URL is permitted by the allowlist.
   * Returns null if allowed, or a reason string if blocked.
   */
  private checkAllowlist(url: string): string | null {
    if (this.allowedUrls.length === 0) return null; // allowlist disabled
    const lower = url.toLowerCase();
    const allowed = this.allowedUrls.some(prefix => lower.startsWith(prefix));
    return allowed ? null : `URL not in allowlist. Allowed prefixes: ${this.allowedUrls.slice(0, 5).join(', ')}`;
  }

  /**
   * Fetch the URL and return its plain-text content.
   *
   * @param url      The URL to fetch (http:// or https:// only).
   * @param maxChars Maximum characters to return. Clamped to [1, WEB_FETCH_MAX_CHARS_CAP].
   *                 Defaults to WEB_FETCH_MAX_CHARS (10 000).
   *
   * Returns SsrfBlockedResult when the URL is blocked by SSRF checks.
   * Returns UrlBlockedResult when the URL is not in the allowlist.
   * @throws {Error} if the scheme is not http or https (early, before SSRF check)
   * @throws {Error} on network failure or timeout
   */
  async fetch(url: string, maxChars?: number): Promise<WebFetchResult | SsrfBlockedResult | UrlBlockedResult> {
    if (!url || typeof url !== 'string') {
      throw new Error('url must be a non-empty string');
    }

    // Validate scheme — only http and https allowed
    const normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error(`Unsupported URL scheme — only http:// and https:// are allowed. Got: ${normalized.slice(0, 50)}`);
    }

    // Clamp maxChars
    const limit = Math.min(
      Math.max(1, typeof maxChars === 'number' && maxChars > 0 ? maxChars : WEB_FETCH_MAX_CHARS),
      WEB_FETCH_MAX_CHARS_CAP,
    );

    // Cache lookup (keyed by url + limit so different limits get different entries)
    const cacheKey = `${normalized}\x00${limit}`;
    evictExpired();
    const cached = fetchCache.get(cacheKey);
    if (cached) return cached.result;

    // URL allowlist check (before SSRF, to short-circuit early)
    const allowlistReason = this.checkAllowlist(normalized);
    if (allowlistReason) {
      return { error: 'URL_NOT_ALLOWED', url: normalized, reason: allowlistReason };
    }

    // SSRF protection — check before making any network request
    const ssrfReason = await checkSsrf(normalized);
    if (ssrfReason) {
      return { error: 'SSRF_BLOCKED', url: normalized, reason: ssrfReason };
    }

    const resp = await fetch(normalized, {
      signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Krythor/1.0 WebFetchTool (https://github.com/LuxaGrid/Krythor)',
        // Prefer text/html — many servers return JSON for */* requests
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    if (!resp.ok) {
      throw new Error(`Fetch failed: HTTP ${resp.status} ${resp.statusText}`);
    }

    const rawText = await resp.text();

    // Strip HTML if the response looks like HTML
    const contentType = resp.headers.get('content-type') ?? '';
    const isHtml = contentType.includes('html') || rawText.trimStart().startsWith('<');
    const plain = isHtml ? stripHtml(rawText) : rawText.trim();

    const truncated = plain.length > limit;
    const content   = truncated
      ? plain.slice(0, limit) +
        `\n\n[Content truncated at ${limit} characters. Original length: ${plain.length}]`
      : plain;

    const result: WebFetchResult = {
      url:           normalized,
      content,
      contentLength: plain.length,
      truncated,
    };

    // Cache the result
    fetchCache.set(cacheKey, { result, expiresAt: Date.now() + WEB_FETCH_CACHE_TTL_MS });

    return result;
  }
}

// ─── Exports for testing ──────────────────────────────────────────────────────
export { checkSsrf, isPrivateIp, BLOCKED_HOSTNAMES };

/** Clear the fetch result cache. Used in tests to avoid cross-test contamination. */
export function clearFetchCache(): void {
  fetchCache.clear();
}
