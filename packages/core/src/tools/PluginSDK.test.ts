import { describe, it, expect } from 'vitest';
import { definePluginEntry, isPluginEntry, PluginAPI } from './PluginSDK.js';

describe('definePluginEntry', () => {
  it('returns an object with __krythorPlugin marker', () => {
    const entry = definePluginEntry({
      id: 'test-plugin',
      name: 'Test Plugin',
      register: () => {},
    });
    expect((entry as unknown as Record<string, unknown>)['__krythorPlugin']).toBe(true);
  });

  it('preserves all fields from the definition', () => {
    const entry = definePluginEntry({
      id: 'my-id',
      name: 'My Name',
      version: '2.0.0',
      description: 'A description',
      register: () => {},
    });
    expect(entry.id).toBe('my-id');
    expect(entry.name).toBe('My Name');
    expect(entry.version).toBe('2.0.0');
    expect(entry.description).toBe('A description');
  });
});

describe('isPluginEntry', () => {
  it('returns true for definePluginEntry output', () => {
    const entry = definePluginEntry({ id: 'x', name: 'x', register: () => {} });
    expect(isPluginEntry(entry)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isPluginEntry(null)).toBe(false);
  });

  it('returns false for legacy plugin shape', () => {
    expect(isPluginEntry({ name: 'foo', description: 'bar', run: async () => 'ok' })).toBe(false);
  });

  it('returns false for plain object without marker', () => {
    expect(isPluginEntry({ id: 'x', name: 'x', register: () => {} })).toBe(false);
  });
});

describe('PluginAPI.registerTool', () => {
  it('accumulates tool definitions', () => {
    const api = new PluginAPI();
    api.registerTool({ name: 'tool_a', description: 'A', run: async () => 'a' });
    api.registerTool({ name: 'tool_b', description: 'B', run: async () => 'b' });
    expect(api.registrations.tools).toHaveLength(2);
    expect(api.registrations.tools[0].name).toBe('tool_a');
    expect(api.registrations.tools[1].name).toBe('tool_b');
  });
});

describe('PluginAPI.on (hooks)', () => {
  it('accumulates hook handlers', () => {
    const api = new PluginAPI();
    const h1 = () => {};
    const h2 = () => {};
    api.on('gateway:startup', h1);
    api.on('command:received', h2);
    expect(api.registrations.hooks).toHaveLength(2);
    expect(api.registrations.hooks[0].event).toBe('gateway:startup');
    expect(api.registrations.hooks[1].event).toBe('command:received');
  });
});

describe('PluginAPI.registerChannel', () => {
  it('accumulates channel definitions', () => {
    const api = new PluginAPI();
    api.registerChannel({ id: 'ch1', name: 'Channel 1' });
    expect(api.registrations.channels).toHaveLength(1);
    expect(api.registrations.channels[0].id).toBe('ch1');
  });
});

describe('PluginAPI.registerService', () => {
  it('accumulates service definitions', () => {
    const api = new PluginAPI();
    api.registerService({ key: 'myService', instance: { foo: 'bar' } });
    expect(api.registrations.services).toHaveLength(1);
    expect(api.registrations.services[0].key).toBe('myService');
  });
});

describe('definePluginEntry register() is called and api is correct type', () => {
  it('register() receives a PluginAPI instance', async () => {
    let receivedApi: PluginAPI | null = null;
    const entry = definePluginEntry({
      id: 'check-api',
      name: 'Check API',
      register(api) {
        receivedApi = api;
        api.registerTool({ name: 'check_tool', description: 'Check', run: async () => 'ok' });
      },
    });
    const api = new PluginAPI();
    await entry.register(api);
    expect(receivedApi).toBe(api);
    expect(api.registrations.tools[0].name).toBe('check_tool');
  });
});
