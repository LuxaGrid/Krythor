/**
 * CustomToolStore — persists user-defined tools to <configDir>/custom-tools.json.
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '../config/atomicWrite.js';
import type { CustomToolDefinition } from './WebhookTool.js';

export class CustomToolStore {
  private readonly filePath: string;
  private tools: Map<string, CustomToolDefinition> = new Map();

  constructor(configDir: string) {
    this.filePath = join(configDir, 'custom-tools.json');
    mkdirSync(configDir, { recursive: true });
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const list = JSON.parse(raw) as unknown[];
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const t = item as CustomToolDefinition;
        if (typeof t.name === 'string' && t.name.length > 0) {
          this.tools.set(t.name, t);
        }
      }
    } catch {
      // Parse failure — start empty (no crash)
    }
  }

  private save(): void {
    atomicWriteJSON(this.filePath, Array.from(this.tools.values()));
  }

  list(): CustomToolDefinition[] {
    return Array.from(this.tools.values());
  }

  get(name: string): CustomToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  add(tool: CustomToolDefinition): CustomToolDefinition {
    this.tools.set(tool.name, tool);
    this.save();
    return tool;
  }

  remove(name: string): boolean {
    const existed = this.tools.has(name);
    if (existed) {
      this.tools.delete(name);
      this.save();
    }
    return existed;
  }
}
