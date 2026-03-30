// ─── VaultRegistry ────────────────────────────────────────────────────────────
//
// Tracks which Vault skills are installed locally, including provenance metadata
// (source, version, install date, vault skill ID). Installed skills are stored
// as regular Krythor skills in SkillRegistry; VaultRegistry tracks the mapping.
//
// Persisted to: {configDir}/vault-installed.json
//
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '@krythor/core';

export type VaultSource = 'official' | 'community';
export type VaultRisk   = 'low' | 'medium' | 'high';

/** A skill entry as it appears in vault.manifest.json */
export interface VaultManifestEntry {
  id:                 string;
  name:               string;
  description:        string;
  category:           string;
  source:             VaultSource;
  version:            string;
  minKrythorVersion:  string;
  author:             string;
  permissions:        string[];
  risk:               VaultRisk;
  tags:               string[];
  path:               string;
}

export interface VaultManifest {
  manifestVersion: string;
  updatedAt:       string;
  skills:          VaultManifestEntry[];
}

/** Record of a locally installed Vault skill */
export interface InstalledVaultSkill {
  /** The vault manifest skill ID (e.g. "vault-summarize-document") */
  vaultId:      string;
  /** The SkillRegistry skill ID that was created on install */
  skillId:      string;
  name:         string;
  version:      string;
  source:       VaultSource;
  author:       string;
  category:     string;
  permissions:  string[];
  risk:         VaultRisk;
  installedAt:  number;
  /** Vault manifest version at time of install — used for update detection */
  manifestVersion: string;
}

export class VaultRegistry {
  private readonly filePath: string;
  private installed = new Map<string, InstalledVaultSkill>();

  constructor(configDir: string) {
    this.filePath = join(configDir, 'vault-installed.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!Array.isArray(raw)) return;
      for (const entry of raw) {
        if (entry && typeof entry.vaultId === 'string') {
          this.installed.set(entry.vaultId, entry as InstalledVaultSkill);
        }
      }
    } catch { /* start empty on parse error */ }
  }

  private save(): void {
    atomicWriteJSON(this.filePath, [...this.installed.values()]);
  }

  listInstalled(): InstalledVaultSkill[] {
    return [...this.installed.values()].sort((a, b) => b.installedAt - a.installedAt);
  }

  getInstalled(vaultId: string): InstalledVaultSkill | null {
    return this.installed.get(vaultId) ?? null;
  }

  isInstalled(vaultId: string): boolean {
    return this.installed.has(vaultId);
  }

  record(entry: InstalledVaultSkill): void {
    this.installed.set(entry.vaultId, entry);
    this.save();
  }

  remove(vaultId: string): boolean {
    if (!this.installed.has(vaultId)) return false;
    this.installed.delete(vaultId);
    this.save();
    return true;
  }

  /** Returns vaultIds where the installed version differs from the catalog version */
  findUpdatable(catalog: VaultManifestEntry[]): string[] {
    const updatable: string[] = [];
    for (const entry of catalog) {
      const inst = this.installed.get(entry.id);
      if (inst && inst.version !== entry.version) {
        updatable.push(entry.id);
      }
    }
    return updatable;
  }
}
