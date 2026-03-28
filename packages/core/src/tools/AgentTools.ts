/**
 * AgentTools — standard tool definitions available to agents.
 *
 * These definitions follow the JSON Schema format used by model providers
 * (OpenAI, Anthropic) for function/tool calling.
 *
 * Agents declare which tools they can use via allowedTools / deniedTools fields.
 * Use getAgentTools() to get the filtered list for a specific agent.
 */

// ── Type definitions ─────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ── Built-in tool definitions ─────────────────────────────────────────────────

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'file_read',
    description: 'Read the contents of a file at the given path.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path to read' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'file_write',
    description: 'Write content to a file. Creates the file if it does not exist.',
    parameters: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path:    { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'shell_exec',
    description: 'Execute a shell command and return stdout/stderr.',
    parameters: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        args:    { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
        cwd:     { type: 'string', description: 'Working directory' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_search',
    description: 'Search agent memory for relevant information.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum results (default: 5)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory_save',
    description: 'Save a piece of information to agent memory for future retrieval.',
    parameters: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Information to save' },
        title:   { type: 'string', description: 'Optional title/label' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a URL.',
    parameters: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      additionalProperties: false,
    },
  },
];

// ── Tool filtering ────────────────────────────────────────────────────────────

/**
 * Get the set of tools available to a specific agent, filtered by
 * allowedTools / deniedTools configuration.
 *
 * - If allowedTools is empty/undefined: all tools are allowed (subject to deniedTools).
 * - If allowedTools has entries: only listed tools are available.
 * - deniedTools always wins over allowedTools.
 */
export function getAgentTools(agent: {
  allowedTools?: string[];
  deniedTools?: string[];
}): ToolDefinition[] {
  return AGENT_TOOLS.filter(tool => {
    // Explicit deny always wins
    if (agent.deniedTools && agent.deniedTools.includes(tool.name)) return false;
    // If an allowlist is set, tool must be in it
    if (agent.allowedTools && agent.allowedTools.length > 0) {
      return agent.allowedTools.includes(tool.name);
    }
    return true;
  });
}
