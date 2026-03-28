import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { TOOL_REGISTRY } from './ToolRegistry.js';
import type { ToolEntry } from './ToolRegistry.js';
import { PluginSandbox } from './PluginSandbox.js';

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

/** Status of each plugin file scanned during a load() pass. */
export interface PluginLoadRecord {
  file: string;
  status: 'loaded' | 'error' | 'skipped';
  name?: string;
  description?: string;
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

      const filePath2 = join(this.pluginsDir, file);
      const loadedPlugin: LoadedPlugin = {
        name,
        description: plugin.description.trim(),
        file,
        // Run via sandbox: forks a child process for each invocation so plugin
        // crashes and memory leaks are isolated from the gateway process.
        run: (input: string) => this.sandbox.run(filePath2, input),
      };
      this.loaded.push(loadedPlugin);
      this.records.push({ file, status: 'loaded', name, description: loadedPlugin.description });

      console.info(`[PluginLoader] Loaded plugin "${name}" from ${file}`);
    }

    return this.loaded;
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

  /** Look up a loaded plugin by name. Returns null if not found. */
  get(name: string): LoadedPlugin | null {
    return this.loaded.find(p => p.name === name) ?? null;
  }
}
