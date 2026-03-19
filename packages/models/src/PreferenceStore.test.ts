import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PreferenceStore } from './PreferenceStore.js';
import type { TaskPreference } from './ModelRecommender.js';

function makePref(overrides: Partial<TaskPreference> = {}): TaskPreference {
  return {
    taskType:   'summarize',
    modelId:    'llama3.1:8b',
    providerId: 'ollama',
    preference: 'always_use',
    ...overrides,
  };
}

describe('PreferenceStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'prefs-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', () => {
    const store = new PreferenceStore(tmpDir);
    expect(store.getAll()).toHaveLength(0);
  });

  it('persists preferences across instances', () => {
    const store1 = new PreferenceStore(tmpDir);
    store1.set(makePref({ taskType: 'code' }));
    store1.set(makePref({ taskType: 'summarize' }));

    const store2 = new PreferenceStore(tmpDir); // fresh load
    expect(store2.getAll()).toHaveLength(2);
    expect(store2.get('code')).not.toBeNull();
    expect(store2.get('summarize')).not.toBeNull();
  });

  it('overwrites existing preference for same taskType', () => {
    const store = new PreferenceStore(tmpDir);
    store.set(makePref({ preference: 'always_use' }));
    store.set(makePref({ preference: 'ask' }));
    expect(store.getAll()).toHaveLength(1);
    expect(store.get('summarize')!.preference).toBe('ask');
  });

  it('deletes preference and persists the deletion', () => {
    const store1 = new PreferenceStore(tmpDir);
    store1.set(makePref());
    store1.delete('summarize');

    const store2 = new PreferenceStore(tmpDir);
    expect(store2.get('summarize')).toBeNull();
  });

  it('get() returns null for unknown taskType', () => {
    const store = new PreferenceStore(tmpDir);
    expect(store.get('nonexistent')).toBeNull();
  });
});
