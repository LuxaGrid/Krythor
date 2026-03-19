import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TaskPreference } from './ModelRecommender.js';

// ─── PreferenceStore ──────────────────────────────────────────────────────────
//
// Persists user model-selection preferences to a JSON file in the config dir.
// Loaded once at boot; written on every change.
//
// File: <configDir>/model-preferences.json
//
// Failures to read (missing/malformed) start with an empty preference set.
// Failures to write are logged but never throw — preferences degrade to in-memory
// only for that session.
//

const FILENAME = 'model-preferences.json';

interface PreferenceFile {
  version:     1;
  preferences: TaskPreference[];
}

export class PreferenceStore {
  private readonly path: string;
  private preferences: Map<string, TaskPreference>;

  constructor(configDir: string) {
    mkdirSync(configDir, { recursive: true });
    this.path = join(configDir, FILENAME);
    this.preferences = this.load();
  }

  getAll(): TaskPreference[] {
    return Array.from(this.preferences.values());
  }

  get(taskType: string): TaskPreference | null {
    return this.preferences.get(taskType) ?? null;
  }

  set(pref: TaskPreference): void {
    this.preferences.set(pref.taskType, pref);
    this.persist();
  }

  delete(taskType: string): void {
    this.preferences.delete(taskType);
    this.persist();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private load(): Map<string, TaskPreference> {
    if (!existsSync(this.path)) return new Map();
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const data = JSON.parse(raw) as PreferenceFile;
      if (data.version !== 1 || !Array.isArray(data.preferences)) {
        console.warn('[PreferenceStore] Unexpected format — ignoring existing preferences.');
        return new Map();
      }
      const map = new Map<string, TaskPreference>();
      for (const pref of data.preferences) {
        if (pref.taskType && pref.modelId && pref.providerId && pref.preference) {
          map.set(pref.taskType, pref);
        }
      }
      console.info(`[PreferenceStore] Loaded ${map.size} preferences from ${this.path}`);
      return map;
    } catch (err) {
      console.warn('[PreferenceStore] Failed to load preferences:', err instanceof Error ? err.message : err);
      return new Map();
    }
  }

  private persist(): void {
    try {
      const data: PreferenceFile = {
        version: 1,
        preferences: Array.from(this.preferences.values()),
      };
      writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[PreferenceStore] Failed to persist preferences:', err instanceof Error ? err.message : err);
    }
  }
}
