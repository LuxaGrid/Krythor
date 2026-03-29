/**
 * SkillFileLoader — discover and parse file-based skills from SKILL.md files.
 *
 * Each skill lives in its own directory containing a SKILL.md file with
 * YAML frontmatter and markdown body. This format allows workspace-local
 * skills to be created without touching the JSON config database.
 *
 * SKILL.md format:
 * ```
 * ---
 * name: my-skill
 * description: "What this skill does"
 * tags: ["code", "review"]
 * enabled: true
 * userInvocable: true
 * modelId: claude-sonnet-4-6   (optional)
 * ---
 *
 * # My Skill
 *
 * System prompt content goes here...
 * ```
 *
 * Precedence (highest wins when names conflict):
 *   workspaceDirs[0] > workspaceDirs[1] > ... > extraDirs
 *
 * File-backed skills have their `id` derived from the directory path so
 * they remain stable across reloads. They are read-only — updates and
 * deletes are not supported through the API.
 */

import { readdirSync, readFileSync, statSync, existsSync, watch as fsWatch } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import type { Skill, SkillPermission } from './types.js';

// ── Frontmatter parser ─────────────────────────────────────────────────────

interface SkillFrontmatter {
  name?: string;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  userInvocable?: boolean;
  modelId?: string;
  providerId?: string;
  timeoutMs?: number;
  permissions?: SkillPermission[];
}

/**
 * Parse YAML-like single-line frontmatter from SKILL.md.
 * Only supports simple key: value, key: "value", and key: [a, b] forms.
 * Does not support nested objects or multi-line values — keeps parsing
 * fast and dependency-free.
 */
function parseFrontmatter(raw: string): { meta: SkillFrontmatter; body: string } {
  const FENCE = '---';
  const lines = raw.split('\n');

  if (lines[0]?.trim() !== FENCE) {
    return { meta: {}, body: raw.trim() };
  }

  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FENCE) {
      closingIdx = i;
      break;
    }
  }

  if (closingIdx === -1) {
    return { meta: {}, body: raw.trim() };
  }

  const fmLines = lines.slice(1, closingIdx);
  const body = lines.slice(closingIdx + 1).join('\n').trim();
  const meta: SkillFrontmatter = {};

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (!key || !rawVal) continue;

    // Array: [a, b, c] or ["a", "b"]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1);
      const items = inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
      (meta as Record<string, unknown>)[key] = items;
      continue;
    }

    // Boolean
    if (rawVal === 'true' || rawVal === 'false') {
      (meta as Record<string, unknown>)[key] = rawVal === 'true';
      continue;
    }

    // Number
    if (/^\d+(\.\d+)?$/.test(rawVal)) {
      (meta as Record<string, unknown>)[key] = Number(rawVal);
      continue;
    }

    // String (strip surrounding quotes)
    (meta as Record<string, unknown>)[key] = rawVal.replace(/^["']|["']$/g, '');
  }

  return { meta, body };
}

// ── SkillFileLoader ────────────────────────────────────────────────────────

export interface SkillFileEntry {
  /** Full path to the SKILL.md file. */
  filePath: string;
  /** Parsed skill definition (read-only). */
  skill: Skill;
}

export class SkillFileLoader {
  private readonly scanDirs: string[];

  /**
   * @param scanDirs — directories to scan for SKILL.md files. Each directory
   *   may contain sub-directories each holding one SKILL.md. Directories are
   *   scanned in order; earlier entries shadow later ones when names conflict.
   */
  constructor(scanDirs: string[]) {
    this.scanDirs = scanDirs;
  }

  /**
   * Scan all configured directories and return discovered skills.
   * De-duplicates by name — first match (highest-precedence directory) wins.
   */
  load(): SkillFileEntry[] {
    const byName = new Map<string, SkillFileEntry>();

    for (const dir of this.scanDirs) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = join(dir, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillMdPath = join(entryPath, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        let raw: string;
        try {
          raw = readFileSync(skillMdPath, 'utf-8');
        } catch {
          continue;
        }

        const { meta, body } = parseFrontmatter(raw);
        const skillName = meta.name ?? basename(entryPath);
        if (!skillName || !body) continue;

        // Skip if a higher-precedence directory already provided this name.
        if (byName.has(skillName)) continue;

        // Stable ID derived from the canonical path so it doesn't change
        // between reloads as long as the file stays in the same place.
        const id = `file:${createHash('sha1').update(entryPath).digest('hex').slice(0, 12)}`;
        const now = Date.now();

        const skill: Skill = {
          id,
          name: skillName,
          description:   meta.description   ?? '',
          systemPrompt:  body,
          tags:          meta.tags           ?? [],
          permissions:   (meta.permissions as SkillPermission[]) ?? [],
          modelId:       meta.modelId,
          providerId:    meta.providerId,
          timeoutMs:     meta.timeoutMs,
          enabled:       meta.enabled        !== false,
          userInvocable: meta.userInvocable  !== false,
          version:       1,
          runCount:      0,
          createdAt:     now,
          updatedAt:     now,
        };

        byName.set(skillName, { filePath: skillMdPath, skill });
      }
    }

    return Array.from(byName.values());
  }

  /**
   * Return only the skill definitions (without file path metadata).
   * Convenience wrapper over load().
   */
  loadSkills(): Skill[] {
    return this.load().map(e => e.skill);
  }

  /**
   * Watch all configured scan directories for SKILL.md changes. Calls
   * `callback` (debounced by `debounceMs`) whenever any SKILL.md is added,
   * removed, or modified. Returns a stop function that closes all watchers.
   *
   * Directories that don't exist at call time are silently skipped —
   * they won't be watched even if created later.
   */
  watch(callback: () => void, debounceMs = 500): () => void {
    const watchers: ReturnType<typeof fsWatch>[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(callback, debounceMs);
    };

    for (const dir of this.scanDirs) {
      if (!existsSync(dir)) continue;
      try {
        watchers.push(
          fsWatch(dir, { recursive: true }, (_event, filename) => {
            if (filename && (filename === 'SKILL.md' || filename.endsWith('/SKILL.md') || filename.endsWith('\\SKILL.md'))) {
              trigger();
            }
          }),
        );
      } catch {
        // Directory not watchable (permissions, unsupported fs) — skip.
      }
    }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
    };
  }
}
