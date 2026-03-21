// ─── ToolRegistry ─────────────────────────────────────────────────────────────
//
// Central registry of all available agent tools.
// Each tool entry describes:
//   name            — the tool identifier used in {"tool":"<name>",...} calls
//   description     — human-readable summary
//   parameters      — object describing accepted parameters
//   requiresGuard   — true if a guard check is performed before execution
//   alwaysAllowed   — true if no allowlist/guard check is needed (read-only tools)
//
// This registry is the foundation for per-agent tool enablement (future work).
// Today it drives GET /api/tools and agent tool-call routing in AgentRunner.
//

export interface ToolParameter {
  type:        string;
  description: string;
  required?:   boolean;
  minLength?:  number;
  maxLength?:  number;
}

export interface ToolEntry {
  name:          string;
  description:   string;
  parameters:    Record<string, ToolParameter>;
  requiresGuard: boolean;
  /** true for read-only tools that bypass allowlist and guard checks */
  alwaysAllowed: boolean;
}

export const TOOL_REGISTRY: ToolEntry[] = [
  {
    name: 'exec',
    description:
      'Execute a local command. The command basename must be in the exec allowlist ' +
      'and the guard engine must permit the "command:execute" operation.',
    parameters: {
      command: {
        type:        'string',
        description: 'The command to execute (e.g. "git", "node").',
        required:    true,
        minLength:   1,
        maxLength:   200,
      },
      args: {
        type:        'array',
        description: 'Arguments to pass to the command. Each element must be a string.',
      },
      cwd: {
        type:        'string',
        description: 'Working directory for the process. Must be an absolute path.',
        maxLength:   4096,
      },
      timeoutMs: {
        type:        'integer',
        description: 'Timeout in milliseconds (1000–300000). Default: 30000.',
      },
    },
    requiresGuard: true,
    alwaysAllowed: false,
  },
  {
    name: 'web_search',
    description:
      'Search the web using the DuckDuckGo Instant Answer API. ' +
      'Returns up to 10 results with title, URL, and snippet. ' +
      'Read-only — no authentication required.',
    parameters: {
      query: {
        type:        'string',
        description: 'The search query string.',
        required:    true,
        minLength:   1,
        maxLength:   500,
      },
    },
    requiresGuard: false,
    alwaysAllowed: true,
  },
  {
    name: 'web_fetch',
    description:
      'Fetch the content of a URL and return it as plain text (HTML tags stripped). ' +
      'Content is truncated to 10000 characters. Timeout: 8 seconds. ' +
      'Read-only — no authentication required.',
    parameters: {
      url: {
        type:        'string',
        description: 'The URL to fetch. Must be http:// or https://.',
        required:    true,
        minLength:   7,
        maxLength:   2048,
      },
    },
    requiresGuard: false,
    alwaysAllowed: true,
  },
];

/** Look up a tool entry by name. Returns undefined if not registered. */
export function getToolEntry(name: string): ToolEntry | undefined {
  return TOOL_REGISTRY.find(t => t.name === name);
}
