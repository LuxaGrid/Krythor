/**
 * ToolExecutor — executes tool calls on behalf of an agent.
 *
 * Routes tool calls to the appropriate handler:
 *   - file_read / file_write  → FilesystemTool
 *   - shell_exec              → ExecTool
 *   - memory_search           → MemoryEngine (passed in via opts)
 *   - memory_save             → MemoryEngine
 *   - web_search              → WebSearchTool
 *   - web_fetch               → WebFetchTool
 *
 * All execution is subject to the existing guard/profile enforcement
 * that each underlying tool already implements.
 */

import type { ToolCall, ToolResult } from './AgentTools.js';
import { FilesystemTool, type FsCall } from './FilesystemTool.js';
import { WebSearchTool } from './WebSearchTool.js';
import { WebFetchTool } from './WebFetchTool.js';
import type { ExecTool } from './ExecTool.js';

// Minimal memory interface (to avoid a hard @krythor/memory import in core).
// Callers must adapt their MemoryEngine to this simpler contract.
export interface MemoryLike {
  searchByText(query: string, limit: number): Array<{ id: string; content: string; title?: string }>;
  saveEntry?(agentId: string, content: string, title?: string): { id: string };
}

export interface ToolExecutorOptions {
  agentId: string;
  execTool?: ExecTool | null;
  memory?: MemoryLike | null;
  workspaceDir?: string;
}

export class ToolExecutor {
  private readonly filesystemTool: FilesystemTool;
  private readonly webSearchTool: WebSearchTool;
  private readonly webFetchTool: WebFetchTool;

  constructor(private readonly opts: ToolExecutorOptions) {
    this.filesystemTool = new FilesystemTool();
    this.webSearchTool  = new WebSearchTool();
    this.webFetchTool   = new WebFetchTool();
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const content = await this.dispatch(call);
      return { toolCallId: call.id, content };
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async dispatch(call: ToolCall): Promise<string> {
    switch (call.name) {
      case 'file_read': {
        const path = call.arguments['path'] as string;
        const fsCall: FsCall = { tool: 'read_file', path };
        const result = this.filesystemTool.dispatch(fsCall);
        if (!result.ok) throw new Error(result.output || 'file_read failed');
        return result.output;
      }

      case 'file_write': {
        const path    = call.arguments['path'] as string;
        const content = call.arguments['content'] as string;
        const fsCall: FsCall = { tool: 'write_file', path, content };
        const result = this.filesystemTool.dispatch(fsCall);
        if (!result.ok) throw new Error(result.output || 'file_write failed');
        return `Written ${content.length} bytes to ${path}`;
      }

      case 'shell_exec': {
        if (!this.opts.execTool) {
          throw new Error('shell_exec is not available — ExecTool not configured');
        }
        const command = call.arguments['command'] as string;
        const args    = (call.arguments['args'] as string[] | undefined) ?? [];
        const cwd     = (call.arguments['cwd'] as string | undefined) ?? this.opts.workspaceDir;
        const result  = await this.opts.execTool.run(command, args, { cwd });
        return `exit=${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`.trim();
      }

      case 'memory_search': {
        if (!this.opts.memory) return 'No memory engine available';
        const query = call.arguments['query'] as string;
        const limit = (call.arguments['limit'] as number | undefined) ?? 5;
        const results = this.opts.memory.searchByText(query, limit);
        if (results.length === 0) return 'No relevant memories found.';
        return results.map((r, i) =>
          `[${i + 1}] ${r.title ?? 'Untitled'}\n${r.content}`
        ).join('\n\n');
      }

      case 'memory_save': {
        if (!this.opts.memory?.saveEntry) return 'Memory write not available';
        const content = call.arguments['content'] as string;
        const title   = call.arguments['title'] as string | undefined;
        const result  = this.opts.memory.saveEntry(this.opts.agentId, content, title);
        return `Saved to memory (id: ${result.id})`;
      }

      case 'web_search': {
        const query = call.arguments['query'] as string;
        const result = await this.webSearchTool.search(query);
        if (result.results.length === 0) return 'No results found.';
        return result.results.map((r, i) =>
          `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet ?? ''}`
        ).join('\n\n');
      }

      case 'web_fetch': {
        const url    = call.arguments['url'] as string;
        const result = await this.webFetchTool.fetch(url);
        if ('error' in result) throw new Error(`${result.error}: ${result.reason}`);
        return result.content;
      }

      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  }
}
