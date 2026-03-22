/**
 * Tests for ITEM C: PluginLoader
 *
 * Tests:
 * 1. Valid plugin loads and is registered
 * 2. Invalid shape is skipped with a warning
 * 3. Missing plugins directory is a no-op
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// We need to test PluginLoader in isolation — import after setting up the temp dir
import { PluginLoader } from './PluginLoader.js';
import { TOOL_REGISTRY } from './ToolRegistry.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `plugin-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePlugin(pluginsDir: string, filename: string, code: string): void {
  writeFileSync(join(pluginsDir, filename), code, 'utf-8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PluginLoader', () => {
  let tmpBase: string;
  let originalRegistryLength: number;

  beforeEach(() => {
    tmpBase = makeTempDir();
    // Record original registry length so we can clean up after each test
    originalRegistryLength = TOOL_REGISTRY.length;
  });

  afterEach(() => {
    // Restore TOOL_REGISTRY to its pre-test state to avoid cross-test pollution
    TOOL_REGISTRY.splice(originalRegistryLength);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('valid plugin loads and appears in list()', () => {
    const pluginsDir = join(tmpBase, 'plugins');
    mkdirSync(pluginsDir);
    writePlugin(pluginsDir, 'greet.js', `
      module.exports = {
        name: 'greet',
        description: 'Returns a greeting',
        async run(input) { return 'Hello, ' + input + '!'; }
      };
    `);

    const loader = new PluginLoader(tmpBase);
    const loaded = loader.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('greet');
    expect(loaded[0]?.description).toBe('Returns a greeting');
    expect(loaded[0]?.file).toBe('greet.js');

    // Should be findable via get()
    const found = loader.get('greet');
    expect(found).not.toBeNull();
    expect(found?.name).toBe('greet');
  });

  it('valid plugin is registered into TOOL_REGISTRY', () => {
    const pluginsDir = join(tmpBase, 'plugins');
    mkdirSync(pluginsDir);
    writePlugin(pluginsDir, 'calc.js', `
      module.exports = {
        name: 'calc_test_unique',
        description: 'Calculator plugin',
        async run(input) { return String(eval(input)); }
      };
    `);

    const loader = new PluginLoader(tmpBase);
    loader.load();

    const entry = TOOL_REGISTRY.find(t => t.name === 'calc_test_unique');
    expect(entry).toBeDefined();
    expect(entry?.description).toBe('Calculator plugin');
    expect(entry?.requiresGuard).toBe(false);
  });

  it('invalid plugin (missing name) is skipped with a warning', () => {
    const pluginsDir = join(tmpBase, 'plugins');
    mkdirSync(pluginsDir);
    writePlugin(pluginsDir, 'bad.js', `
      module.exports = {
        description: 'No name field',
        async run(input) { return input; }
      };
    `);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new PluginLoader(tmpBase);
    const loaded = loader.load();

    expect(loaded).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping invalid plugin'));
    warnSpy.mockRestore();
  });

  it('invalid plugin (missing run function) is skipped', () => {
    const pluginsDir = join(tmpBase, 'plugins');
    mkdirSync(pluginsDir);
    writePlugin(pluginsDir, 'norun.js', `
      module.exports = {
        name: 'no_run',
        description: 'Has no run function',
      };
    `);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new PluginLoader(tmpBase);
    const loaded = loader.load();

    expect(loaded).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping invalid plugin'));
    warnSpy.mockRestore();
  });

  it('missing plugins directory is a no-op — returns empty list', () => {
    // Do not create a plugins dir — just pass the tmpBase
    const loader = new PluginLoader(tmpBase);
    const loaded = loader.load();

    expect(loaded).toHaveLength(0);
    // TOOL_REGISTRY should be unchanged
    expect(TOOL_REGISTRY.length).toBe(originalRegistryLength);
  });

  it('plugin that fails to require is skipped with a warning', () => {
    const pluginsDir = join(tmpBase, 'plugins');
    mkdirSync(pluginsDir);
    writePlugin(pluginsDir, 'throws.js', `
      throw new Error('I always fail');
    `);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new PluginLoader(tmpBase);
    const loaded = loader.load();

    expect(loaded).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to require plugin'));
    warnSpy.mockRestore();
  });
});
