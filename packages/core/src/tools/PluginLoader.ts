import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { TOOL_REGISTRY } from './ToolRegistry.js';
import type { ToolEntry } from './ToolRegistry.js';
import { PluginSandbox } from './PluginSandbox.js';
import { isPluginEntry, PluginAPI } from './PluginSDK.js';
import type { PluginEntry, PluginToolDefinition, PluginChannelDefinition, PluginServiceDefinition } from './PluginSDK.js';

// ─── PluginLoader ─────────────────────────────────────────────────────────────
//
// Loads "plugin" tools from <dataDir>/plugins/ directory.
// Each plugin is a CommonJS JS file that exports:
//   { name: string, description: string, run(input: string): Promise<string> }
//
// Valid plugins are registered into TOOL_REGISTRY as user-defined tools.
// Invalid plugins are skipped with a console.warn — they never crash the gateway.
//

export interface PluginExport {
  /** Tool name used in {"tool":"<name>",...} calls. */
  name: string;
  /** Human-readable description shown in GET /api/plugins. */
  description: string;
  /** Execute the tool with the given input, returns a result string. */
  run(input: string): Promise<string>;
}

export interface LoadedPlugin {
  name: string;
  description: string;
  file: string;
  run: (input: string) => Promise<string>;
}

/** A plugin loaded via the definePluginEntry SDK format. */
export interface LoadedPluginEntry {
  /** Plugin id from the entry definition. */
  id: string;
  /** Plugin name from the entry definition. */
  name: string;
  version?: string;
  description?: string;
  file: string;
  /** Tools registered by this plugin (already in TOOL_REGISTRY). */
  tools: PluginToolDefinition[];
  /** Channels registered by this plugin. */
  channels: PluginChannelDefinition[];
  /** Services registered by this plugin. */
  services: PluginServiceDefinition[];
}

/** Status of each plugin file scanned during a load() pass. */
export interface PluginLoadRecord {
  file: string;
  status: 'loaded' | 'error' | 'skipped';
  /** For legacy plugins: the tool name. For SDK plugins: the plugin id. */
  name?: string;
  description?: string;
  /** 'legacy' = old { name, description, run } format; 'sdk' = definePluginEntry format. */
  format?: 'legacy' | 'sdk';
  /** Human-readable reason for 'error' or 'skipped' status. */
  reason?: string;
}

/**
 * Validate that the exported value matches the required plugin shape.
 * Returns a string describing why it's invalid, or null if valid.
 */
function validatePluginExport(value: unknown, file: string): string | null {
  if (!value || typeof value !== 'object') {
    return `${file}: export is not an object`;
  }
  const v = value as Record<string, unknown>;
  if (typeof v['name'] !== 'string' || (v['name'] as string).trim().length === 0) {
    return `${file}: export.name must be a non-empty string`;
  }
  if (typeof v['description'] !== 'string' || (v['description'] as string).trim().length === 0) {
    return `${file}: export.description must be a non-empty string`;
  }
  if (typeof v['run'] !== 'function') {
    return `${file}: export.run must be a function`;
  }
  return null;
}

export class PluginLoader {
  private readonly pluginsDir: string;
  private loaded: LoadedPlugin[] = [];
  private loadedEntries: LoadedPluginEntry[] = [];
  private records: PluginLoadRecord[] = [];
  private readonly sandbox: PluginSandbox;

  constructor(dataDir: string) {
    this.pluginsDir = join(dataDir, 'plugins');
    this.sandbox = new PluginSandbox();
  }

  /**
   * Scan <dataDir>/plugins/, require each .js file, validate the export shape,
   * and register valid plugins into TOOL_REGISTRY.
   *
   * - Missing directory: no-op (not an error — plugins are optional)
   * - Invalid export shape: skipped with console.warn
   * - Duplicate name: skipped with console.warn (first loaded wins)
   *
   * Returns the list of successfully loaded plugins.
   */
  load(): LoadedPlugin[] {
    this.loaded = [];
    this.loadedEntries = [];
    this.records = [];

    if (!existsSync(this.pluginsDir)) {
      // No plugins directory — that's fine, plugins are optional
      return this.loaded;
    }

    let files: string[];
    try {
      files = readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    } catch (err) {
      console.warn(`[PluginLoader] Failed to read plugins directory: ${err instanceof Error ? err.message : String(err)}`);
      return this.loaded;
    }

    const registeredNames = new Set(TOOL_REGISTRY.map(t => t.name));

    for (const file of files) {
      const filePath = join(this.pluginsDir, file);
      let exported: unknown;

      try {
        // Clear the require cache so the file is re-evaluated on each load() call.
        // This allows reloading plugins without restarting the process.
        delete require.cache[require.resolve(filePath)];
        exported = require(filePath);
      } catch (err) {
        const reason = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(`[PluginLoader] ${reason} (${file})`);
        this.records.push({ file, status: 'error', reason });
        continue;
      }

      // ── SDK format: definePluginEntry({ id, name, register(api) }) ──────────
      if (isPluginEntry(exported)) {
        void this.loadSdkPlugin(exported as PluginEntry, file, filePath, registeredNames);
        continue;
      }

      // ── Legacy format: { name, description, run } ────────────────────────────
      const validationError = validatePluginExport(exported, file);
      if (validationError) {
        const reason = `Invalid export: ${validationError}`;
        console.warn(`[PluginLoader] Skipping invalid plugin — ${reason}`);
        this.records.push({ file, status: 'skipped', reason });
        continue;
      }

      const plugin = exported as PluginExport;
      const name = plugin.name.trim();

      if (registeredNames.has(name)) {
        const reason = `Tool name "${name}" is already registered`;
        console.warn(`[PluginLoader] Skipping plugin ${file} — ${reason}`);
        this.records.push({ file, status: 'skipped', name, reason });
        continue;
      }

      // Register in the global tool registry so the tool appears in GET /api/tools
      const entry: ToolEntry = {
        name,
        description: plugin.description.trim(),
        parameters: {
          input: {
            type:        'string',
            description: 'Input string passed to the plugin\'s run() function.',
            required:    true,
          },
        },
        requiresGuard: false,
        alwaysAllowed: false,
      };
      TOOL_REGISTRY.push(entry);
      registeredNames.add(name);

      const loadedPlugin: LoadedPlugin = {
        name,
        description: plugin.description.trim(),
        file,
        // Run via sandbox: forks a child process for each invocation so plugin
        // crashes and memory leaks are isolated from the gateway process.
        run: (input: string) => this.sandbox.run(filePath, input),
      };
      this.loaded.push(loadedPlugin);
      this.records.push({ file, status: 'loaded', name, description: loadedPlugin.description, format: 'legacy' });

      console.info(`[PluginLoader] Loaded plugin "${name}" from ${file}`);
    }

    return this.loaded;
  }

  /**
   * Load a plugin using the definePluginEntry SDK format.
   * Calls register(api), then wires all registered tools into TOOL_REGISTRY.
   * Errors in register() are caught so a bad plugin cannot crash the gateway.
   */
  private async loadSdkPlugin(
    entry: PluginEntry,
    file: string,
    filePath: string,
    registeredNames: Set<string>,
  ): Promise<void> {
    const api = new PluginAPI();
    try {
      await entry.register(api);
    } catch (err) {
      const reason = `register() threw: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[PluginLoader] SDK plugin ${file} failed — ${reason}`);
      this.records.push({ file, status: 'error', name: entry.id, reason, format: 'sdk' });
      return;
    }

    const { tools, channels, services } = api.registrations;
    let toolsRegistered = 0;

    for (const toolDef of tools) {
      const name = toolDef.name.trim();
      if (registeredNames.has(name)) {
        console.warn(`[PluginLoader] SDK plugin ${file}: tool "${name}" is already registered — skipping`);
        continue;
      }
      const toolEntry: ToolEntry = {
        name,
        description: toolDef.description.trim(),
        parameters: toolDef.parameters ?? {
          input: { type: 'string', description: 'Input string for the tool.', required: true },
        },
        requiresGuard: toolDef.requiresGuard ?? false,
        alwaysAllowed: false,
      };
      TOOL_REGISTRY.push(toolEntry);
      registeredNames.add(name);

      // Register as a legacy LoadedPlugin for backwards-compat with get(name) and list()
      this.loaded.push({
        name,
        description: toolDef.description.trim(),
        file,
        run: toolDef.run,
      });
      toolsRegistered++;
    }

    const loadedEntry: LoadedPluginEntry = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      file,
      tools,
      channels,
      services,
    };
    this.loadedEntries.push(loadedEntry);
    this.records.push({
      file,
      status: 'loaded',
      name: entry.id,
      description: entry.description,
      format: 'sdk',
    });

    console.info(`[PluginLoader] Loaded SDK plugin "${entry.id}" from ${file} (${toolsRegistered} tools, ${channels.length} channels, ${services.length} services)`);
  }

  /** Returns all currently loaded plugins (without reloading). */
  list(): LoadedPlugin[] {
    return this.loaded;
  }

  /**
   * Returns the full load record for every plugin file scanned in the last load() pass.
   * Includes successfully loaded plugins, errors, and skipped entries.
   */
  listRecords(): PluginLoadRecord[] {
    return this.records;
  }

  /**
   * Returns all plugins loaded via the definePluginEntry SDK format.
   * Includes multi-tool plugins with their full registration record.
   */
  listEntries(): LoadedPluginEntry[] {
    return this.loadedEntries;
  }

  /** Look up a loaded plugin by name. Returns null if not found. */
  get(name: string): LoadedPlugin | null {
    return this.loaded.find(p => p.name === name) ?? null;
  }
}
