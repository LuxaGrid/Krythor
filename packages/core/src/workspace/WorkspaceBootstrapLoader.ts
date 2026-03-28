// ─── WorkspaceBootstrapLoader ─────────────────────────────────────────────────
//
// Loads workspace bootstrap files and injects them into the system prompt.
//
// Bootstrap files (read from the workspace directory):
//   AGENTS.md              — operating instructions + "memory"
//   SOUL.md                — persona, boundaries, tone
//   TOOLS.md               — user-maintained tool notes
//   IDENTITY.md            — agent name/vibe/emoji
//   USER.md                — user profile + preferred address
//   MEMORY.md              — optional curated long-term notes (when present)
//   memory/YYYY-MM-DD.md   — today's daily log (optional, auto-injected)
//   memory/YYYY-MM-DD.md   — yesterday's daily log (optional, auto-injected)
//   HEARTBEAT.md           — optional tiny checklist for heartbeat runs
//   BOOTSTRAP.md           — one-time first-run ritual (deleted after completion)
//
// Injection behaviour:
//   - Files are trimmed to BOOTSTRAP_MAX_CHARS per file (default 20 000 chars)
//   - Total injection across all files is capped at BOOTSTRAP_TOTAL_MAX_CHARS (default 150 000)
//   - Missing files inject a one-line "missing" marker, EXCEPT optional files
//   - Optional files (MEMORY.md, daily logs): silently skipped when not present
//   - Blank files are skipped silently
//   - Truncated files end with a "[...truncated]" marker
//   - Sub-agent runs only receive AGENTS.md and TOOLS.md (promptMode: 'minimal')
//

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export const BOOTSTRAP_MAX_CHARS       = 20_000;
export const BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;

/** Files that are silently skipped when not present (no "missing" marker injected). */
const OPTIONAL_BOOTSTRAP_FILES = new Set(['MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md']);

/** Return YYYY-MM-DD for a given Date (local time on the gateway host). */
function dailyLogName(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `memory/${y}-${m}-${d}.md`;
}

/** Return today's and yesterday's daily log filenames. */
export function getDailyLogNames(): [string, string] {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  return [dailyLogName(today), dailyLogName(yesterday)];
}

/** Files injected on a full (non-subagent) run, in order. */
export const BOOTSTRAP_FILES_FULL = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  // Daily logs are resolved dynamically at load time (today + yesterday)
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
] as const;

/** Files injected on a minimal (sub-agent) run. */
export const BOOTSTRAP_FILES_MINIMAL = [
  'AGENTS.md',
  'TOOLS.md',
] as const;

export type PromptMode = 'full' | 'minimal' | 'none';

export interface BootstrapFileResult {
  name: string;
  status: 'ok' | 'missing' | 'blank' | 'truncated';
  rawChars: number;
  injectedChars: number;
  content: string; // final injected text (may be empty for missing/blank)
}

export interface BootstrapResult {
  files: BootstrapFileResult[];
  projectContext: string; // full assembled "## Project Context\n..." block
  totalRawChars: number;
  totalInjectedChars: number;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export class WorkspaceBootstrapLoader {
  constructor(
    private readonly workspaceDir: string,
    private readonly maxCharsPerFile   = BOOTSTRAP_MAX_CHARS,
    private readonly maxCharsTotal     = BOOTSTRAP_TOTAL_MAX_CHARS,
  ) {}

  /** Load bootstrap files for a given prompt mode and return the assembled block. */
  load(promptMode: PromptMode = 'full'): BootstrapResult {
    if (promptMode === 'none') {
      return { files: [], projectContext: '', totalRawChars: 0, totalInjectedChars: 0 };
    }

    // Ensure the memory subdirectory exists (no-op if already present)
    try {
      mkdirSync(join(this.workspaceDir, 'memory'), { recursive: true });
    } catch { /* ignore */ }

    // Build the file list — for full mode, splice in today+yesterday daily logs after MEMORY.md
    let filenames: string[];
    if (promptMode === 'minimal') {
      filenames = [...BOOTSTRAP_FILES_MINIMAL];
    } else {
      const [todayLog, yesterdayLog] = getDailyLogNames();
      const base = [...BOOTSTRAP_FILES_FULL] as string[];
      const memoryIdx = base.indexOf('MEMORY.md');
      // Insert daily logs right after MEMORY.md
      base.splice(memoryIdx + 1, 0, todayLog, yesterdayLog);
      // Daily logs are always optional (silently skipped when missing)
      OPTIONAL_BOOTSTRAP_FILES.add(todayLog);
      OPTIONAL_BOOTSTRAP_FILES.add(yesterdayLog);
      filenames = base;
    }

    const results: BootstrapFileResult[] = [];
    let totalInjected = 0;

    for (const name of filenames) {
      // Stop injecting once total cap is hit
      if (totalInjected >= this.maxCharsTotal) {
        results.push({ name, status: 'missing', rawChars: 0, injectedChars: 0, content: '' });
        continue;
      }

      const filePath = join(this.workspaceDir, name);

      if (!existsSync(filePath)) {
        // Optional files are silently skipped; required files inject a "missing" marker
        if (!OPTIONAL_BOOTSTRAP_FILES.has(name)) {
          results.push({ name, status: 'missing', rawChars: 0, injectedChars: 0, content: '' });
        }
        continue;
      }

      let raw: string;
      try {
        raw = readFileSync(filePath, 'utf-8');
      } catch {
        results.push({ name, status: 'missing', rawChars: 0, injectedChars: 0, content: '' });
        continue;
      }

      const rawChars = raw.length;

      if (raw.trim().length === 0) {
        results.push({ name, status: 'blank', rawChars, injectedChars: 0, content: '' });
        continue;
      }

      const budget = Math.min(this.maxCharsPerFile, this.maxCharsTotal - totalInjected);
      let injected: string;
      let status: BootstrapFileResult['status'];

      if (rawChars <= budget) {
        injected = raw;
        status = 'ok';
      } else {
        injected = raw.slice(0, budget) + '\n[...truncated — read the file for full content]';
        status = 'truncated';
      }

      totalInjected += injected.length;
      results.push({ name, status, rawChars, injectedChars: injected.length, content: injected });
    }

    const projectContext = buildProjectContext(results);
    const totalRawChars = results.reduce((s, r) => s + r.rawChars, 0);

    return { files: results, projectContext, totalRawChars, totalInjectedChars: totalInjected };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildProjectContext(files: BootstrapFileResult[]): string {
  const sections: string[] = [];

  for (const file of files) {
    if (file.status === 'missing') {
      sections.push(`### ${file.name}\n[missing — file not found in workspace]`);
      continue;
    }
    if (file.status === 'blank') {
      // Blank files are silently skipped
      continue;
    }
    sections.push(`### ${file.name}\n${file.content}`);
  }

  if (sections.length === 0) return '';

  return `## Project Context\n\n${sections.join('\n\n')}`;
}
