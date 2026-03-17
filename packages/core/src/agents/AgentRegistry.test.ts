import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentRegistry } from './AgentRegistry.js';

const TEST_DIR = join(tmpdir(), `krythor-test-${Date.now()}`);

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    registry = new AgentRegistry(TEST_DIR);
  });

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('starts with no agents', () => {
    expect(registry.list()).toHaveLength(0);
    expect(registry.count()).toBe(0);
  });

  it('creates an agent with default values', () => {
    const agent = registry.create({
      name: 'Test Agent',
      systemPrompt: 'You are helpful.',
    });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe('Test Agent');
    expect(agent.systemPrompt).toBe('You are helpful.');
    expect(agent.memoryScope).toBe('agent');
    expect(agent.maxTurns).toBe(10);
    expect(agent.tags).toEqual([]);
    expect(agent.createdAt).toBeGreaterThan(0);
    expect(agent.updatedAt).toBe(agent.createdAt);
  });

  it('creates agent with custom values', () => {
    const agent = registry.create({
      name: 'Custom',
      systemPrompt: 'Custom prompt',
      description: 'Desc',
      memoryScope: 'workspace',
      maxTurns: 5,
      temperature: 0.2,
      tags: ['tag1'],
      modelId: 'gpt-4o',
    });
    expect(agent.memoryScope).toBe('workspace');
    expect(agent.maxTurns).toBe(5);
    expect(agent.temperature).toBe(0.2);
    expect(agent.tags).toContain('tag1');
    expect(agent.modelId).toBe('gpt-4o');
  });

  it('getById returns the agent', () => {
    const agent = registry.create({ name: 'A', systemPrompt: 'P' });
    const found = registry.getById(agent.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(agent.id);
  });

  it('getById returns null for missing id', () => {
    expect(registry.getById('nonexistent')).toBeNull();
  });

  it('lists agents sorted by updatedAt descending', () => {
    const a1 = registry.create({ name: 'First',  systemPrompt: 'P' });
    // Force a distinct timestamp so sort order is deterministic
    const a2 = registry.create({ name: 'Second', systemPrompt: 'P' });
    // Manually set a2's updatedAt to be strictly after a1's
    registry.update(a2.id, { name: 'Second' });
    const list = registry.list();
    // a2 was updated last, so updatedAt is higher — should be first in list
    expect(list[0]?.id).toBe(a2.id);
    expect(list[1]?.id).toBe(a1.id);
  });

  it('updates agent fields', () => {
    const agent = registry.create({ name: 'Old Name', systemPrompt: 'Old prompt' });
    const updated = registry.update(agent.id, { name: 'New Name', temperature: 0.9 });
    expect(updated.name).toBe('New Name');
    expect(updated.temperature).toBe(0.9);
    expect(updated.systemPrompt).toBe('Old prompt'); // unchanged
    expect(updated.updatedAt).toBeGreaterThanOrEqual(agent.updatedAt);
  });

  it('update throws for unknown id', () => {
    expect(() => registry.update('bad-id', { name: 'X' })).toThrow();
  });

  it('deletes an agent', () => {
    const agent = registry.create({ name: 'To Delete', systemPrompt: 'P' });
    registry.delete(agent.id);
    expect(registry.getById(agent.id)).toBeNull();
    expect(registry.count()).toBe(0);
  });

  it('delete throws for unknown id', () => {
    expect(() => registry.delete('nonexistent')).toThrow();
  });

  it('persists agents to disk and reloads', () => {
    registry.create({ name: 'Persisted', systemPrompt: 'P' });
    // Create a new registry instance pointing to the same directory
    const registry2 = new AgentRegistry(TEST_DIR);
    expect(registry2.count()).toBe(1);
    expect(registry2.list()[0]?.name).toBe('Persisted');
  });

  it('count tracks correctly after create and delete', () => {
    const a = registry.create({ name: 'A', systemPrompt: 'P' });
    const b = registry.create({ name: 'B', systemPrompt: 'P' });
    expect(registry.count()).toBe(2);
    registry.delete(a.id);
    expect(registry.count()).toBe(1);
    registry.delete(b.id);
    expect(registry.count()).toBe(0);
  });

  it('trims whitespace from name and systemPrompt', () => {
    const agent = registry.create({ name: '  Padded  ', systemPrompt: '  Prompt  ' });
    expect(agent.name).toBe('Padded');
    expect(agent.systemPrompt).toBe('Prompt');
  });
});
