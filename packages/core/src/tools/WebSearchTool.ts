// ─── WebSearchTool ────────────────────────────────────────────────────────────
//
// Web search via the DuckDuckGo Instant Answer API.
// No authentication required — completely read-only.
//
// API:  https://api.duckduckgo.com/?q=QUERY&format=json&no_html=1&skip_disambig=1
// Returns: { results: [{ title, url, snippet }], query, source }
//
// Design:
//   - Timeout: 5000ms (AbortSignal)
//   - Max results: 10
//   - Source: "duckduckgo"
//   - Never throws on empty results — returns empty array
//   - Throws on network failure or timeout (caller must handle)
//

export interface WebSearchResult {
  title:   string;
  url:     string;
  snippet: string;
}

export interface WebSearchResponse {
  query:   string;
  source:  'duckduckgo';
  results: WebSearchResult[];
}

/** Timeout for web search requests in milliseconds. */
export const WEB_SEARCH_TIMEOUT_MS = 5_000;

// ─── DuckDuckGo API response shape ────────────────────────────────────────────
// Only the fields we consume are typed here. The full DDG response is much
// larger, but we extract RelatedTopics[].Text and RelatedTopics[].FirstURL.

interface DdgRelatedTopic {
  Text?:     string;
  FirstURL?: string;
  // Nested groups (e.g., disambiguation) have a Topics array — we skip those.
  Topics?:   DdgRelatedTopic[];
}

interface DdgResponse {
  Abstract?:        string;
  AbstractURL?:     string;
  AbstractText?:    string;
  RelatedTopics?:   DdgRelatedTopic[];
}

// ─── WebSearchTool ────────────────────────────────────────────────────────────

export class WebSearchTool {
  /**
   * Search the web for `query` and return structured results.
   *
   * Returns an empty results array when DDG returns no useful content —
   * this is normal for obscure or ambiguous queries.
   *
   * @throws {Error} on network failure or timeout
   */
  async search(query: string): Promise<WebSearchResponse> {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { query, source: 'duckduckgo', results: [] };
    }

    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query.trim());
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');

    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
      headers: {
        // DDG ignores most UA strings but setting one is good practice
        'User-Agent': 'Krythor/1.0 WebSearchTool (https://github.com/LuxaGrid/Krythor)',
      },
    });

    if (!resp.ok) {
      throw new Error(`DuckDuckGo API returned HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as DdgResponse;

    const results: WebSearchResult[] = [];

    // Abstract section — the primary answer card if present
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title:   data.Abstract ?? query,
        url:     data.AbstractURL,
        snippet: data.AbstractText,
      });
    }

    // Related topics — the main list of results
    for (const topic of data.RelatedTopics ?? []) {
      if (results.length >= 10) break;

      // Skip nested group objects (disambiguation pages)
      if (Array.isArray(topic.Topics)) continue;

      const text = topic.Text ?? '';
      const url2 = topic.FirstURL ?? '';

      if (!text || !url2) continue;

      // DDG puts the title and snippet together in Text, separated by " - ".
      // Try to split on " - " to get a cleaner title.
      const dashIdx = text.indexOf(' - ');
      const title   = dashIdx > 0 ? text.slice(0, dashIdx).trim() : text.slice(0, 80).trim();
      const snippet = dashIdx > 0 ? text.slice(dashIdx + 3).trim() : text.trim();

      results.push({ title, url: url2, snippet });
    }

    return { query, source: 'duckduckgo', results };
  }
}
