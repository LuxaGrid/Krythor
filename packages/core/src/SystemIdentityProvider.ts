import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ─── SystemIdentityProvider ───────────────────────────────────────────────────
//
// Loads SOUL.md at boot and exposes a stable identity string for injection
// into agent/command system prompts.
//
// Load order:
//   1. Path provided by caller (e.g. repo root during dev)
//   2. CWD/SOUL.md
//   3. Built-in fallback (safe defaults, never crashes)
//
// Failures to load SOUL.md are logged but never thrown — the system operates
// on fallback defaults instead.
//

const SOUL_VERSION_PATTERN = /^version:\s*(\d+)/m;

const FALLBACK_IDENTITY = `\
You are Krythor, a local-first AI agent platform.
Operate transparently. Prefer local execution when sufficient. Respect user control.
Avoid fake confidence. Surface failures honestly. Keep memory disciplined.`;

export interface SoulMetadata {
  version: number;
  loadedFrom: string | null; // null = fallback
  loadedAt: number;          // epoch ms
}

export class SystemIdentityProvider {
  private _content: string = FALLBACK_IDENTITY;
  private _meta: SoulMetadata = { version: 0, loadedFrom: null, loadedAt: Date.now() };

  constructor(searchPaths: string[] = []) {
    this.load(searchPaths);
  }

  /** The full SOUL.md text (or fallback). Stable for the process lifetime. */
  get content(): string { return this._content; }

  /** Metadata about where and when the soul was loaded. */
  get meta(): SoulMetadata { return this._meta; }

  /**
   * Returns a concise system-prompt-safe excerpt of the identity.
   * Strips Markdown heading markers and trims to maxChars to keep prompts lean.
   */
  excerpt(maxChars = 2000): string {
    const stripped = this._content
      .replace(/^#{1,6}\s+/gm, '')   // strip headings
      .replace(/\*\*/g, '')           // strip bold
      .replace(/\n{3,}/g, '\n\n')    // collapse excess blank lines
      .trim();
    return stripped.length > maxChars ? stripped.slice(0, maxChars) + '\n[…]' : stripped;
  }

  /** True if the identity loaded from a real SOUL.md file (not fallback). */
  get isLoaded(): boolean { return this._meta.loadedFrom !== null; }

  // ── Private ──────────────────────────────────────────────────────────────

  private load(extraPaths: string[]): void {
    const candidates = [
      ...extraPaths,
      join(process.cwd(), 'SOUL.md'),
    ];

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        const raw = readFileSync(candidate, 'utf-8');
        const versionMatch = SOUL_VERSION_PATTERN.exec(raw);
        this._content = raw;
        this._meta = {
          version: versionMatch ? parseInt(versionMatch[1]!, 10) : 1,
          loadedFrom: candidate,
          loadedAt: Date.now(),
        };
        console.info(`[SystemIdentityProvider] Loaded SOUL.md v${this._meta.version} from ${candidate}`);
        return;
      } catch (err) {
        console.warn(
          `[SystemIdentityProvider] Failed to read ${candidate}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // All candidates failed — use built-in fallback
    console.warn('[SystemIdentityProvider] SOUL.md not found — using built-in fallback identity.');
  }
}
