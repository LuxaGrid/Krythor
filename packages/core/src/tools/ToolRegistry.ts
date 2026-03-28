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
      'Content is truncated to maxChars (default 10000, max 50000). Timeout: 8 seconds. ' +
      'Results are cached for 15 minutes. Read-only — no authentication required.',
    parameters: {
      url: {
        type:        'string',
        description: 'The URL to fetch. Must be http:// or https://.',
        required:    true,
        minLength:   7,
        maxLength:   2048,
      },
      maxChars: {
        type:        'integer',
        description: 'Maximum characters to return (1–50000). Defaults to 10000.',
      },
    },
    requiresGuard: false,
    alwaysAllowed: true,
  },
  {
    name: 'get_page_text',
    description:
      'Render a URL with a headless browser (Puppeteer if available, otherwise plain fetch) ' +
      'and return the visible text content. Use this for JavaScript-rendered pages where ' +
      'web_fetch only returns the HTML shell. Max output: 8000 chars. Timeout: 15s. ' +
      'Same SSRF protection as web_fetch — private/loopback IPs are blocked.',
    parameters: {
      url: {
        type:        'string',
        description: 'The URL to render. Must be http:// or https://.',
        required:    true,
        minLength:   7,
        maxLength:   2048,
      },
    },
    requiresGuard: false,
    alwaysAllowed: true,
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a local file. ' +
      'Path must be within the allowed root directory. ' +
      'Max file size: 512 KB. ' +
      'Add "read_file" to the agent\'s allowedTools to permit this tool.',
    parameters: {
      path: {
        type:        'string',
        description: 'Absolute or relative path to the file to read.',
        required:    true,
        minLength:   1,
        maxLength:   4096,
      },
    },
    requiresGuard: false,
    alwaysAllowed: false,
  },
  {
    name: 'write_file',
    description:
      'Write text content to a local file, creating it if it does not exist. ' +
      'Path must be within the allowed root directory. ' +
      'Max content size: 512 KB. ' +
      'Add "write_file" to the agent\'s allowedTools to permit this tool.',
    parameters: {
      path: {
        type:        'string',
        description: 'Absolute or relative path to write.',
        required:    true,
        minLength:   1,
        maxLength:   4096,
      },
      content: {
        type:        'string',
        description: 'Text content to write to the file.',
        required:    true,
      },
    },
    requiresGuard: true,
    alwaysAllowed: false,
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact occurrence of a string in a file with new text. ' +
      'The "old" string must appear exactly once in the file. ' +
      'Path must be within the allowed root directory. ' +
      'Add "edit_file" to the agent\'s allowedTools to permit this tool.',
    parameters: {
      path: {
        type:        'string',
        description: 'Absolute or relative path to the file to edit.',
        required:    true,
        minLength:   1,
        maxLength:   4096,
      },
      old: {
        type:        'string',
        description: 'The exact text to replace (must appear exactly once).',
        required:    true,
        minLength:   1,
      },
      new: {
        type:        'string',
        description: 'The replacement text.',
        required:    true,
      },
    },
    requiresGuard: true,
    alwaysAllowed: false,
  },
  {
    name: 'apply_patch',
    description:
      'Apply a unified diff patch to a local file. ' +
      'The patch must be in standard unified diff format (--- / +++ / @@ headers). ' +
      'Path must be within the allowed root directory. ' +
      'Add "apply_patch" to the agent\'s allowedTools to permit this tool.',
    parameters: {
      path: {
        type:        'string',
        description: 'Absolute or relative path to the file to patch.',
        required:    true,
        minLength:   1,
        maxLength:   4096,
      },
      patch: {
        type:        'string',
        description: 'The unified diff patch to apply.',
        required:    true,
        minLength:   1,
      },
    },
    requiresGuard: true,
    alwaysAllowed: false,
  },
  {
    name: 'spawn_agent',
    description:
      'Spawn a sub-agent by ID and send it a message. The sub-agent runs with shared memory. ' +
      'Capped at 2 spawns per top-level run to prevent runaway chains. ' +
      'Returns the spawned agent\'s output as the tool result.',
    parameters: {
      agentId: {
        type:        'string',
        description: 'The ID of the agent to spawn.',
        required:    true,
        minLength:   1,
        maxLength:   100,
      },
      message: {
        type:        'string',
        description: 'The message to send to the spawned agent.',
        required:    true,
        minLength:   1,
        maxLength:   4000,
      },
    },
    requiresGuard: false,
    alwaysAllowed: false,
  },
  {
    name: 'shell_exec',
    description:
      'Execute a shell command without allowlist restrictions. ' +
      'Requires standard or full_access access profile on the invoking agent. ' +
      'Guard engine must permit the "shell:exec" operation.',
    parameters: {
      command: {
        type:        'string',
        description: 'The command to execute (e.g. "ls", "python3").',
        required:    true,
        minLength:   1,
        maxLength:   4096,
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
    name: 'list_processes',
    description:
      'List currently running system processes. ' +
      'Requires standard or full_access access profile on the invoking agent. ' +
      'Guard engine must permit the "shell:list_processes" operation. ' +
      'Returns an array of { pid, name, cmd?, cpu?, mem? } objects.',
    parameters: {},
    requiresGuard: true,
    alwaysAllowed: false,
  },
  {
    name: 'sessions_list',
    description:
      'List recent conversations (sessions) stored in the gateway. ' +
      'Returns an array of session summaries: id, title, agentId, messageCount, updatedAt, isIdle. ' +
      'Read-only. Results are capped at 100 entries, newest first.',
    parameters: {
      limit: {
        type:        'integer',
        description: 'Maximum number of sessions to return (1–100, default 20).',
      },
      agentId: {
        type:        'string',
        description: 'Filter sessions by agent ID. Omit to return sessions for all agents.',
        maxLength:   100,
      },
      includeArchived: {
        type:        'boolean',
        description: 'When true, include archived (idle) sessions in the results. Default: false.',
      },
    },
    requiresGuard: false,
    alwaysAllowed: false,
  },
  {
    name: 'agents_list',
    description:
      'List all agents registered in this Krythor instance. ' +
      'Returns an array of agents with id, name, description, modelId, and tags. ' +
      'Read-only. Use this to discover which agents are available before calling agent_ping.',
    parameters: {},
    requiresGuard: false,
    alwaysAllowed: false,
  },
  {
    name: 'agent_ping',
    description:
      'Send a message to another agent and receive its response. ' +
      'The target agent runs a single synchronous turn and returns its output. ' +
      'Use agents_list first to discover available agent IDs. ' +
      'Add "agent_ping" to the agent\'s allowedTools to permit this tool.',
    parameters: {
      agentId: {
        type:        'string',
        description: 'The ID of the target agent to ping.',
        required:    true,
        minLength:   1,
        maxLength:   100,
      },
      message: {
        type:        'string',
        description: 'The message to send to the target agent.',
        required:    true,
        minLength:   1,
        maxLength:   4000,
      },
    },
    requiresGuard: false,
    alwaysAllowed: false,
  },
  {
    name: 'sessions_history',
    description:
      'Fetch the message history for a specific conversation (session). ' +
      'Returns up to 50 user/assistant messages (tool results excluded). ' +
      'Read-only. Pass the conversation ID from sessions_list.',
    parameters: {
      conversationId: {
        type:        'string',
        description: 'The conversation ID to fetch history for (from sessions_list).',
        required:    true,
        minLength:   1,
        maxLength:   100,
      },
      limit: {
        type:        'integer',
        description: 'Maximum number of messages to return (1–50, default 20).',
      },
    },
    requiresGuard: false,
    alwaysAllowed: false,
  },
];

/** Look up a tool entry by name. Returns undefined if not registered. */
export function getToolEntry(name: string): ToolEntry | undefined {
  return TOOL_REGISTRY.find(t => t.name === name);
}

/** Named tool profiles — pre-defined allowedTools arrays for common agent configurations. */
export const TOOL_PROFILES: Record<string, string[]> = {
  /** Minimal: web search and read only — safe for untrusted contexts */
  minimal:    ['web_search', 'web_fetch', 'read_file', 'agents_list'],
  /** Messaging: chat-oriented tools — session management, agent coordination */
  messaging:  ['web_search', 'web_fetch', 'agents_list', 'agent_ping', 'sessions_list', 'sessions_history'],
  /** Coding: full development toolset */
  coding:     ['exec', 'read_file', 'write_file', 'edit_file', 'apply_patch', 'shell_exec', 'web_search', 'web_fetch', 'agents_list'],
  /** Full: all registered tools */
  full:       [], // empty = resolved at runtime to all tool names
};

/** Resolve a profile name to a tool name array. 'full' returns all registered tool names. */
export function resolveToolProfile(profile: string): string[] | undefined {
  if (!(profile in TOOL_PROFILES)) return undefined;
  if (profile === 'full') return TOOL_REGISTRY.map(t => t.name);
  return TOOL_PROFILES[profile]!;
}
