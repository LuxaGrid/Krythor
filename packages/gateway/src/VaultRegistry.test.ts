import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VaultRegistry } from './VaultRegistry.js';
import type { InstalledVaultSkill, VaultManifestEntry } from './VaultRegistry.js';

function tmpDir() { return mkdtempSync(join(tmpdir(), 'vault-test-')); }

function makeRecord(overrides: Partial<InstalledVaultSkill> = {}): InstalledVaultSkill {
  return {
    vaultId:         'vault-test-skill',
    skillId:         'skill-uuid-1',
    name:            'Test Skill',
    version:         '1.0.0',
    source:          'official',
    author:          'Krythor',
    category:        'Testing',
    permissions:     [],
    risk:            'low',
    installedAt:     Date.now(),
    manifestVersion: '1',
    ...overrides,
  };
}

describe('VaultRegistry', () => {
  let dir: string;
  let registry: VaultRegistry;

  beforeEach(() => {
    dir = tmpDir();
    registry = new VaultRegistry(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    expect(registry.listInstalled()).toHaveLength(0);
  });

  it('records and retrieves an installed skill', () => {
    const rec = makeRecord();
    registry.record(rec);
    expect(registry.isInstalled('vault-test-skill')).toBe(true);
    expect(registry.getInstalled('vault-test-skill')).toMatchObject({ vaultId: 'vault-test-skill', name: 'Test Skill' });
  });

  it('persists across instances', () => {
    registry.record(makeRecord());
    const registry2 = new VaultRegistry(dir);
    expect(registry2.isInstalled('vault-test-skill')).toBe(true);
  });

  it('removes a skill', () => {
    registry.record(makeRecord());
    expect(registry.remove('vault-test-skill')).toBe(true);
    expect(registry.isInstalled('vault-test-skill')).toBe(false);
    // Persisted
    const registry2 = new VaultRegistry(dir);
    expect(registry2.isInstalled('vault-test-skill')).toBe(false);
  });

  it('remove returns false for unknown id', () => {
    expect(registry.remove('nonexistent')).toBe(false);
  });

  it('findUpdatable returns ids where versions differ', () => {
    registry.record(makeRecord({ vaultId: 'vault-a', version: '1.0.0' }));
    registry.record(makeRecord({ vaultId: 'vault-b', version: '1.0.0' }));
    const catalog: VaultManifestEntry[] = [
      { id: 'vault-a', name: 'A', description: '', category: 'X', source: 'official', version: '1.1.0', minKrythorVersion: '0.2.0', author: 'K', permissions: [], risk: 'low', tags: [], path: '' },
      { id: 'vault-b', name: 'B', description: '', category: 'X', source: 'official', version: '1.0.0', minKrythorVersion: '0.2.0', author: 'K', permissions: [], risk: 'low', tags: [], path: '' },
    ];
    const updatable = registry.findUpdatable(catalog);
    expect(updatable).toContain('vault-a');
    expect(updatable).not.toContain('vault-b');
  });

  it('handles corrupt file gracefully', () => {
    const { writeFileSync } = require('fs');
    writeFileSync(join(dir, 'vault-installed.json'), 'not json!!!');
    const r = new VaultRegistry(dir);
    expect(r.listInstalled()).toHaveLength(0);
  });

  it('records multiple skills and lists them newest first', async () => {
    registry.record(makeRecord({ vaultId: 'vault-a', installedAt: 1000 }));
    await new Promise(r => setTimeout(r, 5));
    registry.record(makeRecord({ vaultId: 'vault-b', installedAt: 2000 }));
    const list = registry.listInstalled();
    expect(list[0].vaultId).toBe('vault-b');
    expect(list[1].vaultId).toBe('vault-a');
  });
});

// ── Risk classification logic ─────────────────────────────────────────────────
// Test the risk classification separately (pure logic)

function classifyRisk(permissions: string[]): 'low' | 'medium' | 'high' {
  if (permissions.some(p => ['shell:exec', 'file:write', 'file:delete', 'webhook:call'].includes(p))) return 'high';
  if (permissions.some(p => ['internet:read', 'memory:write', 'skill:invoke', 'file:read'].includes(p))) return 'medium';
  return 'low';
}

describe('risk classification', () => {
  it('no permissions = low', () => {
    expect(classifyRisk([])).toBe('low');
  });
  it('memory:read = low', () => {
    expect(classifyRisk(['memory:read'])).toBe('low');
  });
  it('internet:read = medium', () => {
    expect(classifyRisk(['internet:read'])).toBe('medium');
  });
  it('memory:write = medium', () => {
    expect(classifyRisk(['memory:write'])).toBe('medium');
  });
  it('shell:exec = high', () => {
    expect(classifyRisk(['shell:exec'])).toBe('high');
  });
  it('file:write = high', () => {
    expect(classifyRisk(['file:write'])).toBe('high');
  });
  it('webhook:call = high', () => {
    expect(classifyRisk(['webhook:call'])).toBe('high');
  });
  it('mixed high+low = high', () => {
    expect(classifyRisk(['memory:read', 'shell:exec'])).toBe('high');
  });
});

// ── Compatibility check ───────────────────────────────────────────────────────

function isCompatible(minVersion: string, currentVersion: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [minMaj, minMin, minPatch] = parse(minVersion);
  const [curMaj, curMin, curPatch] = parse(currentVersion);
  if (curMaj !== minMaj) return curMaj > minMaj;
  if (curMin !== minMin) return curMin > minMin;
  return curPatch >= minPatch;
}

describe('compatibility check', () => {
  it('same version is compatible', () => {
    expect(isCompatible('0.2.0', '0.2.0')).toBe(true);
  });
  it('higher patch is compatible', () => {
    expect(isCompatible('0.2.0', '0.2.1')).toBe(true);
  });
  it('higher minor is compatible', () => {
    expect(isCompatible('0.2.0', '0.3.0')).toBe(true);
  });
  it('higher major is compatible', () => {
    expect(isCompatible('0.2.0', '1.0.0')).toBe(true);
  });
  it('lower patch is incompatible', () => {
    expect(isCompatible('0.2.1', '0.2.0')).toBe(false);
  });
  it('lower minor is incompatible', () => {
    expect(isCompatible('0.3.0', '0.2.9')).toBe(false);
  });
});
