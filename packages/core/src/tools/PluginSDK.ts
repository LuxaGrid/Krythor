/**
 * PluginSDK — structured plugin entry API.
 *
 * Plugins that want to register more than a single tool can use the
 * definePluginEntry / register(api) pattern:
 *
 *   // my-plugin.js
 *   const { definePluginEntry } = require('@krythor/core');
 *
 *   module.exports = definePluginEntry({
 *     id: 'my-plugin',
 *     name: 'My Plugin',
 *     version: '1.0.0',
 *     register(api) {
 *       api.registerTool({
 *         name: 'my_tool',
 *         description: 'Does something useful',
 *         run: async (input) => `result: ${input}`,
 *       });
 *       api.on('gateway:startup', ({ version }) => {
 *         console.log(`My plugin loaded on gateway ${version}`);
 *       });
 *     },
 *   });
 *
 * Multiple tools, hooks, channels, and services can all be registered from
 * a single plugin file.  The legacy single-tool format ({ name, description, run })
 * continues to work unchanged.
 */

// ─── Tool registration ────────────────────────────────────────────────────────

export interface PluginToolDefinition {
  /** Tool name used in tool-call JSON, e.g. "my_tool". */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Optional parameter schema (mirrors ToolEntry.parameters). */
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
  /** Whether tool calls require a guard pass before execution. */
  requiresGuard?: boolean;
  /** Execute the tool. Input is the raw string or JSON string passed by the agent. */
  run(input: string): Promise<string>;
}

// ─── Hook registration ────────────────────────────────────────────────────────

export type PluginHookName =
  | 'gateway:startup'
  | 'gateway:shutdown'
  | 'session:new'
  | 'session:compact'
  | 'command:received'
  | 'command:completed'
  | 'agent:run:started'
  | 'agent:run:completed'
  | 'agent:run:failed';

export type PluginHookHandler = (payload: Record<string, unknown>) => void | Promise<void>;

// ─── Channel registration ─────────────────────────────────────────────────────

export interface PluginChannelDefinition {
  /** Unique channel id, e.g. "my-channel". */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional description shown in the Channels tab. */
  description?: string;
  /** Called once when the channel is activated. */
  connect?(): Promise<void>;
  /** Called when the channel is deactivated or the gateway shuts down. */
  disconnect?(): Promise<void>;
  /** Called when the gateway wants to send a message through this channel. */
  send?(message: string, context?: Record<string, unknown>): Promise<void>;
}

// ─── Service registration ─────────────────────────────────────────────────────

export interface PluginServiceDefinition {
  /** Service key — accessible via api.getService(key). */
  key: string;
  /** The service instance (any value). */
  instance: unknown;
}

// ─── Collected registrations ──────────────────────────────────────────────────

export interface PluginRegistrations {
  tools: PluginToolDefinition[];
  hooks: Array<{ event: PluginHookName; handler: PluginHookHandler }>;
  channels: PluginChannelDefinition[];
  services: PluginServiceDefinition[];
}

// ─── Plugin API ───────────────────────────────────────────────────────────────

export class PluginAPI {
  readonly registrations: PluginRegistrations = {
    tools:    [],
    hooks:    [],
    channels: [],
    services: [],
  };

  /** Register a tool that agents can invoke. */
  registerTool(def: PluginToolDefinition): void {
    this.registrations.tools.push(def);
  }

  /** Register a lifecycle hook handler. */
  on(event: PluginHookName, handler: PluginHookHandler): void {
    this.registrations.hooks.push({ event, handler });
  }

  /** Register a messaging channel. */
  registerChannel(def: PluginChannelDefinition): void {
    this.registrations.channels.push(def);
  }

  /** Register a named service accessible to other parts of the system. */
  registerService(def: PluginServiceDefinition): void {
    this.registrations.services.push(def);
  }
}

// ─── Plugin entry definition ──────────────────────────────────────────────────

export interface PluginEntryDefinition {
  /** Unique plugin identifier (reverse-DNS style, e.g. "com.example.my-plugin"). */
  id: string;
  /** Human-readable plugin name. */
  name: string;
  /** Semantic version string, e.g. "1.0.0". */
  version?: string;
  /** Short description shown in plugin listings. */
  description?: string;
  /** Called once at load time to register tools, hooks, channels, and services. */
  register(api: PluginAPI): void | Promise<void>;
}

export interface PluginEntry extends PluginEntryDefinition {
  /** Marker so PluginLoader can distinguish this from the legacy format. */
  __krythorPlugin: true;
}

/**
 * Define a structured plugin entry.
 *
 * Returns the same object with a type marker so PluginLoader can detect it.
 * Use this as your module.exports in CommonJS plugins.
 */
export function definePluginEntry(def: PluginEntryDefinition): PluginEntry {
  return { ...def, __krythorPlugin: true };
}

/** Type guard — returns true if value was created with definePluginEntry(). */
export function isPluginEntry(value: unknown): value is PluginEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>)['__krythorPlugin'] === true
  );
}
