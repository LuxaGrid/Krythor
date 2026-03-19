import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SystemIdentityProvider } from './SystemIdentityProvider.js';

describe('SystemIdentityProvider', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-test-'));
  });

  afterEach(() => {
    try { unlinkSync(join(tmpDir, 'SOUL.md')); } catch { /* ok */ }
  });

  it('uses fallback when no SOUL.md exists', () => {
    const provider = new SystemIdentityProvider([join(tmpDir, 'SOUL.md')]);
    expect(provider.isLoaded).toBe(false);
    expect(provider.content).toContain('Krythor');
    expect(provider.meta.loadedFrom).toBeNull();
    expect(provider.meta.version).toBe(0);
  });

  it('loads SOUL.md when it exists', () => {
    const soulPath = join(tmpDir, 'SOUL.md');
    writeFileSync(soulPath, '# SOUL.md\nversion: 2\nYou are a test agent.\n', 'utf-8');
    const provider = new SystemIdentityProvider([soulPath]);
    expect(provider.isLoaded).toBe(true);
    expect(provider.meta.loadedFrom).toBe(soulPath);
    expect(provider.meta.version).toBe(2);
    expect(provider.content).toContain('You are a test agent.');
  });

  it('excerpt() strips markdown headings and truncates', () => {
    const soulPath = join(tmpDir, 'SOUL.md');
    const content = '# Heading\n## Sub\nParagraph text.\n';
    writeFileSync(soulPath, content, 'utf-8');
    const provider = new SystemIdentityProvider([soulPath]);
    const ex = provider.excerpt(50);
    expect(ex).not.toContain('#');
    expect(ex.length).toBeLessThanOrEqual(60); // 50 + '[…]' room
  });

  it('excerpt() returns full content when under maxChars', () => {
    const soulPath = join(tmpDir, 'SOUL.md');
    writeFileSync(soulPath, 'Short content.\n', 'utf-8');
    const provider = new SystemIdentityProvider([soulPath]);
    const ex = provider.excerpt(2000);
    expect(ex).not.toContain('[…]');
  });

  it('does not crash if SOUL.md is unreadable (permission or encoding edge case)', () => {
    // Provide a non-existent path — should degrade to fallback without throwing
    const provider = new SystemIdentityProvider(['/nonexistent/path/SOUL.md']);
    expect(provider.isLoaded).toBe(false);
    expect(provider.content).toBeTruthy();
  });

  it('uses first valid path from search list', () => {
    const soulPath = join(tmpDir, 'SOUL.md');
    writeFileSync(soulPath, '# SOUL\nversion: 3\nValid content.\n', 'utf-8');
    const provider = new SystemIdentityProvider(['/bad/path.md', soulPath]);
    expect(provider.isLoaded).toBe(true);
    expect(provider.meta.version).toBe(3);
  });
});
