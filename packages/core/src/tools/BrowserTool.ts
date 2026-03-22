// ─── BrowserTool ──────────────────────────────────────────────────────────────
//
// Headless browser tool for agents — takes screenshots and extracts text from
// JavaScript-rendered pages.
//
// Uses Puppeteer if available (optional dependency — not bundled by default).
// Falls back gracefully to web_fetch if Puppeteer is not installed.
//
// Tool call format:
//   screenshot_page: { "tool": "screenshot_page", "url": "<url>" }
//     → Returns extracted text from the rendered page (PNG is not returned inline)
//
//   get_page_text: { "tool": "get_page_text", "url": "<url>" }
//     → Returns rendered page text (after JS execution, unlike web_fetch)
//
// Security:
//   - Same SSRF protection as WebFetchTool (loopback/private IPs blocked)
//   - Timeout: 15 seconds per page load
//   - Max text output: 8000 chars
//
// To enable: install puppeteer in the gateway or core package:
//   pnpm --filter @krythor/gateway add puppeteer
//

export const BROWSER_MAX_CHARS = 8_000;
const BROWSER_TIMEOUT_MS = 15_000;

export interface BrowserResult {
  ok: boolean;
  url: string;
  text?: string;
  error?: string;
  source: 'puppeteer' | 'fetch-fallback' | 'blocked';
}

// Private IPs and localhost — same blocklist as WebFetchTool
const BLOCKED_HOSTNAME_RE = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|fc00:|fe80:)$/i;

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTNAME_RE.test(hostname);
}

function validateUrl(raw: string): { ok: boolean; reason?: string } {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, reason: `Only http/https URLs are allowed (got ${u.protocol})` };
    }
    if (isBlockedHost(u.hostname)) {
      return { ok: false, reason: `SSRF protection: ${u.hostname} is not allowed` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
}

/**
 * Attempt to render a page using Puppeteer and extract its text content.
 * Returns null if Puppeteer is not installed.
 */
async function renderWithPuppeteer(url: string): Promise<string | null> {
  try {
    // Dynamic require so missing puppeteer doesn't crash the module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require('puppeteer') as typeof import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: BROWSER_TIMEOUT_MS,
    });
    try {
      const page = await browser.newPage();
      await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
      await page.goto(url, { waitUntil: 'networkidle2' });
      const text = await page.evaluate(() => document.body.innerText);
      return text?.slice(0, BROWSER_MAX_CHARS) ?? '';
    } finally {
      await browser.close();
    }
  } catch (err) {
    // Puppeteer not installed or launch failed
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Cannot find module') || msg.includes('MODULE_NOT_FOUND')) {
      return null; // signal: puppeteer not available
    }
    throw err;
  }
}

/**
 * Fallback: fetch page HTML with Node fetch and strip tags.
 */
async function fetchFallback(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BROWSER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KrythorBot/1.0 (compatible; fetch)' },
    });
    const html = await res.text();
    // Strip HTML tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return text.slice(0, BROWSER_MAX_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

export class BrowserTool {
  async getPageText(url: string): Promise<BrowserResult> {
    const check = validateUrl(url);
    if (!check.ok) {
      return { ok: false, url, error: check.reason, source: 'blocked' };
    }

    try {
      const puppeteerText = await renderWithPuppeteer(url);
      if (puppeteerText !== null) {
        return { ok: true, url, text: puppeteerText, source: 'puppeteer' };
      }
      // Puppeteer not available — fall back to plain fetch
      const text = await fetchFallback(url);
      return { ok: true, url, text, source: 'fetch-fallback' };
    } catch (err) {
      return {
        ok: false,
        url,
        error: err instanceof Error ? err.message : String(err),
        source: 'fetch-fallback',
      };
    }
  }
}

/** Singleton for use in AgentRunner */
export const browserTool = new BrowserTool();
