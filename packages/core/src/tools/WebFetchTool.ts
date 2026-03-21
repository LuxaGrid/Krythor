// ─── WebFetchTool ─────────────────────────────────────────────────────────────
//
// Fetch a URL and return its content as plain text.
// HTML tags are stripped to reduce noise for LLM consumption.
//
// Returns: { url, content, contentLength, truncated }
// Max content: 10000 chars (truncated with note)
// Timeout: 8000ms
//
// Design:
//   - Accepts only http:// and https:// URLs (no file://, ftp://, etc.)
//   - Strips HTML tags with a simple regex (no DOM dependency)
//   - Normalizes whitespace to remove blank runs
//   - Never throws on empty content — returns empty string
//   - Throws on network failure, timeout, or disallowed scheme
//

export interface WebFetchResult {
  url:           string;
  content:       string;
  contentLength: number;
  truncated:     boolean;
}

/** Maximum plain-text content returned (in characters). */
export const WEB_FETCH_MAX_CHARS = 10_000;

/** Timeout for web fetch requests in milliseconds. */
export const WEB_FETCH_TIMEOUT_MS = 8_000;

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
   * Fetch the URL and return its plain-text content.
   *
   * @throws {Error} if the scheme is not http or https
   * @throws {Error} on network failure or timeout
   */
  async fetch(url: string): Promise<WebFetchResult> {
    if (!url || typeof url !== 'string') {
      throw new Error('url must be a non-empty string');
    }

    // Validate scheme — only http and https allowed
    const normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      throw new Error(`Unsupported URL scheme — only http:// and https:// are allowed. Got: ${normalized.slice(0, 50)}`);
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

    const truncated = plain.length > WEB_FETCH_MAX_CHARS;
    const content   = truncated
      ? plain.slice(0, WEB_FETCH_MAX_CHARS) +
        `\n\n[Content truncated at ${WEB_FETCH_MAX_CHARS} characters. Original length: ${plain.length}]`
      : plain;

    return {
      url:           normalized,
      content,
      contentLength: plain.length,
      truncated,
    };
  }
}
