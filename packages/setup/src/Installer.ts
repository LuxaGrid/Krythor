import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export type AuthMethod = 'api_key' | 'oauth' | 'none';

export interface ProviderEntry {
  id: string;
  name: string;
  type: string;
  endpoint: string;          // canonical field name matching ProviderConfig
  authMethod: AuthMethod;
  apiKey?: string;
  isDefault: boolean;
  isEnabled: boolean;
  models: string[];
  /** Onboarding hint for the UI. 'oauth_available' = user skipped auth; prompt them to connect. */
  setupHint?: string;
}

export interface ProvidersFile {
  version: string;
  providers: ProviderEntry[];
}

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
}

// ─── Installer ────────────────────────────────────────────────────────────────

export class Installer {
  constructor(private readonly configDir: string) {}

  ensureDirs(dataDir: string): void {
    mkdirSync(this.configDir, { recursive: true });
    mkdirSync(join(dataDir, 'memory'), { recursive: true });
  }

  hasProviders(): boolean {
    const f = join(this.configDir, 'providers.json');
    if (!existsSync(f)) return false;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8')) as ProvidersFile;
      return d.providers.length > 0;
    } catch { return false; }
  }

  hasDefaultAgent(): boolean {
    const f = join(this.configDir, 'agents.json');
    if (!existsSync(f)) return false;
    try {
      const list = JSON.parse(readFileSync(f, 'utf8'));
      return Array.isArray(list) && list.length > 0;
    } catch { return false; }
  }

  addProvider(entry: Omit<ProviderEntry, 'id'>): ProviderEntry {
    const f = join(this.configDir, 'providers.json');
    let file: ProvidersFile = { version: '1', providers: [] };
    if (existsSync(f)) {
      try {
        const parsed = JSON.parse(readFileSync(f, 'utf8')) as ProvidersFile;
        file = { version: parsed.version ?? '1', providers: Array.isArray(parsed.providers) ? parsed.providers : [] };
      } catch {}
    }

    if (entry.isDefault) {
      file.providers.forEach(p => { p.isDefault = false; });
    }

    const provider: ProviderEntry = { ...entry, id: randomUUID() };
    file.providers.push(provider);
    writeFileSync(f, JSON.stringify(file, null, 2), 'utf8');
    return provider;
  }

  // Writes agents.json as a plain AgentDefinition[] array (what AgentRegistry.load() expects)
  writeDefaultAgent(): void {
    const f = join(this.configDir, 'agents.json');
    if (existsSync(f)) {
      try {
        const existing = JSON.parse(readFileSync(f, 'utf8'));
        if (Array.isArray(existing) && existing.length > 0) return; // already has agents
      } catch {}
    }
    const now = Date.now();
    const defaultAgent = [
      {
        id: 'krythor-default',
        name: 'Krythor',
        description: 'General-purpose AI assistant',
        systemPrompt: [
          'You are Krythor, a helpful local-first AI assistant.',
          'You are concise, accurate, and practical.',
          'When you have memory context available, use it to give more relevant responses.',
          'If you are unsure about something, say so clearly.',
        ].join(' '),
        memoryScope: 'session',
        maxTurns: 10,
        temperature: 0.7,
        tags: ['default'],
        createdAt: now,
        updatedAt: now,
      },
    ];
    writeFileSync(f, JSON.stringify(defaultAgent, null, 2), 'utf8');
  }

  writeAppConfig(config: Partial<AppConfig>): void {
    const f = join(this.configDir, 'app-config.json');
    let existing: AppConfig = {};
    if (existsSync(f)) {
      try { existing = JSON.parse(readFileSync(f, 'utf8')) as AppConfig; } catch {}
    }
    const merged = { ...existing, ...config };
    writeFileSync(f, JSON.stringify(merged, null, 2), 'utf8');
  }

  readAppConfig(): AppConfig {
    const f = join(this.configDir, 'app-config.json');
    if (!existsSync(f)) return {};
    try { return JSON.parse(readFileSync(f, 'utf8')) as AppConfig; } catch { return {}; }
  }

  /**
   * Find the most recent pre-migration backup for the given DB file.
   *
   * MigrationRunner names backups as `<dbPath>.<ISO-timestamp>.bak`.
   * This scans the directory containing the DB file and returns the
   * newest `.bak` file that corresponds to the same base name, or
   * undefined if none exist.
   */
  findLatestBackup(dbFilePath: string): string | undefined {
    const dir = join(dbFilePath, '..');
    const base = dbFilePath.split(/[\\/]/).pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }
    const backups = entries
      .filter(f => f.startsWith(base + '.') && f.endsWith('.bak'))
      .sort(); // ISO timestamps sort lexicographically = chronologically
    if (backups.length === 0) return undefined;
    return join(dir, backups[backups.length - 1]!);
  }

  /**
   * Restore a `.bak` file over the live DB file.
   *
   * The caller is responsible for ensuring the gateway process is stopped
   * before calling this method; SQLite does not detect external file replacement.
   *
   * Throws if the backup file does not exist or the copy fails.
   */
  restoreBackup(backupPath: string, dbFilePath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    copyFileSync(backupPath, dbFilePath);
  }

  /**
   * Install workspace template files (AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md)
   * to the user's data directory under a `templates/` subdirectory.
   *
   * Only copies files that do not already exist — never overwrites user edits.
   * Returns a list of files that were actually installed.
   *
   * @param dataDir   The Krythor data directory (parent of config/).
   * @param sourceDir Path to the docs/templates/ directory in the package tree.
   *                  Defaults to looking relative to this file's location.
   */
  installTemplates(dataDir: string, sourceDir?: string): string[] {
    // Locate source templates: walk up from __dirname to find docs/templates/
    const candidateSourceDirs = [
      sourceDir,
      join(__dirname, '..', '..', '..', '..', 'docs', 'templates'),
      join(__dirname, '..', '..', '..', 'docs', 'templates'),
    ].filter(Boolean) as string[];

    let resolvedSource: string | undefined;
    for (const d of candidateSourceDirs) {
      if (existsSync(d)) { resolvedSource = d; break; }
    }
    if (!resolvedSource) return []; // templates not found — non-fatal

    const destDir = join(dataDir, 'templates');
    mkdirSync(destDir, { recursive: true });

    const installed: string[] = [];
    let entries: string[];
    try { entries = readdirSync(resolvedSource); } catch { return []; }

    for (const file of entries) {
      if (!file.endsWith('.md')) continue;
      const dest = join(destDir, file);
      if (existsSync(dest)) continue; // never overwrite user edits
      try {
        copyFileSync(join(resolvedSource, file), dest);
        installed.push(file);
      } catch { /* non-fatal */ }
    }

    return installed;
  }

  writeStartScript(gatewayDistPath: string, scriptDir: string): void {
    mkdirSync(scriptDir, { recursive: true });
    if (process.platform === 'win32') {
      writeFileSync(join(scriptDir, 'krythor.bat'), `@echo off\nnode "${gatewayDistPath}" %*\n`, 'utf8');
    } else {
      const p = join(scriptDir, 'krythor.sh');
      writeFileSync(p, `#!/bin/sh\nexec node "${gatewayDistPath}" "$@"\n`, 'utf8');
      try { chmodSync(p, 0o755); } catch {}
    }
  }
}
