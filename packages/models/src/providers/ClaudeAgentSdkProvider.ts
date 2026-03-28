import { BaseProvider } from './BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk, Message } from '../types.js';

// ─── ClaudeAgentSdkProvider ───────────────────────────────────────────────────
//
// Wraps @anthropic-ai/claude-agent-sdk's query() function as a Krythor provider.
//
// Instead of a raw inference API call, this provider spawns a Claude agent loop
// that has access to built-in agentic tools (Read, Edit, Bash, Glob, Grep,
// WebSearch, WebFetch, Agent for subagents, MCP servers, and hooks).
//
// The SDK is optionally imported — if not installed, the provider gracefully
// reports as unavailable. Install with:
//   npm install @anthropic-ai/claude-agent-sdk   (in the models package)
//
// Config fields used:
//   apiKey       — ANTHROPIC_API_KEY (encrypted at rest, decrypted at use)
//   endpoint     — ignored (SDK targets api.anthropic.com internally)
//   models       — first entry used as the model ID passed to the SDK
//
// Authentication also supports:
//   CLAUDE_CODE_USE_BEDROCK=1  — Amazon Bedrock (via AWS credentials)
//   CLAUDE_CODE_USE_VERTEX=1   — Google Vertex AI
//   CLAUDE_CODE_USE_FOUNDRY=1  — Microsoft Azure AI Foundry
//

// Dynamic import type — resolved at runtime
type QueryFn = (opts: {
  prompt: string;
  options?: {
    allowedTools?: string[];
    maxTurns?: number;
    systemPrompt?: string;
    model?: string;
  };
}) => AsyncIterable<AgentSdkMessage>;

type AgentSdkAssistantMessage = {
  type: 'assistant';
  message: { content: Array<{ type: string; text?: string }> };
};

type AgentSdkResultMessage = {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error';
  result?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type AgentSdkMessage =
  | { type: 'system'; subtype: 'init'; session_id?: string }
  | AgentSdkAssistantMessage
  | AgentSdkResultMessage
  | { type: string; [key: string]: unknown };

// Cache the dynamic import result across calls
let sdkQuery: QueryFn | null | undefined = undefined; // undefined = not yet attempted

async function loadSdk(): Promise<QueryFn | null> {
  if (sdkQuery !== undefined) return sdkQuery;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (Function('m', 'return import(m)') as (m: string) => Promise<any>)('@anthropic-ai/claude-agent-sdk');
    sdkQuery = (mod.query ?? mod.default?.query ?? null) as QueryFn | null;
  } catch {
    sdkQuery = null;
  }
  return sdkQuery;
}

export class ClaudeAgentSdkProvider extends BaseProvider {

  async isAvailable(): Promise<boolean> {
    const query = await loadSdk();
    if (!query) return false;
    const token = this.getBearerToken();
    // Bedrock/Vertex/Foundry don't need an explicit API key
    const usesBedrock  = process.env['CLAUDE_CODE_USE_BEDROCK']  === '1';
    const usesVertex   = process.env['CLAUDE_CODE_USE_VERTEX']   === '1';
    const usesFoundry  = process.env['CLAUDE_CODE_USE_FOUNDRY']  === '1';
    return !!(token || usesBedrock || usesVertex || usesFoundry);
  }

  async listModels(): Promise<string[]> {
    return this.config.models.length > 0 ? this.config.models : ['claude-sonnet-4-6'];
  }

  async infer(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const start = Date.now();
    const query = await loadSdk();
    if (!query) throw new Error('ClaudeAgentSdkProvider: @anthropic-ai/claude-agent-sdk is not installed. Run: npm install @anthropic-ai/claude-agent-sdk');

    const token = this.getBearerToken();
    if (token) process.env['ANTHROPIC_API_KEY'] = token;

    const model = request.model ?? this.config.models[0] ?? 'claude-sonnet-4-6';

    // Build prompt from messages: system prompt is passed separately, then
    // we send the last user message as the prompt. Prior turns are prepended
    // as context in the system prompt so the SDK agent has conversation history.
    const systemMsg = request.messages.find(m => m.role === 'system');
    const userMsgs  = request.messages.filter(m => m.role !== 'system');
    const lastUser  = [...userMsgs].reverse().find((m: Message) => m.role === 'user');
    const prompt    = lastUser?.content ?? '';

    // Inject prior conversation turns into system prompt for context continuity
    const priorTurns = userMsgs.slice(0, -1)
      .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n');

    const systemPrompt = [
      systemMsg?.content ?? '',
      priorTurns ? `\n\nConversation history:\n${priorTurns}` : '',
    ].filter(Boolean).join('').trim() || undefined;

    let result = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    const iterable = query({ prompt, options: { model, ...(systemPrompt && { systemPrompt }) } });

    // Respect abort signal — wrap iteration with early exit
    for await (const message of iterable) {
      if (signal?.aborted) break;

      if (message.type === 'assistant') {
        const blocks = (message as AgentSdkAssistantMessage).message.content;
        result += blocks
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text ?? '')
          .join('');
      }

      if (message.type === 'result') {
        const res = message as AgentSdkResultMessage;
        if (res.result) result = res.result;
        if (res.usage?.input_tokens)  promptTokens     = res.usage.input_tokens;
        if (res.usage?.output_tokens) completionTokens = res.usage.output_tokens;
      }
    }

    return {
      content:          result || '(no response)',
      model,
      providerId:       this.config.id,
      promptTokens,
      completionTokens,
      durationMs:       Date.now() - start,
      selectionReason:  'claude-agent-sdk',
    };
  }

  async *inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const start = Date.now();
    const query = await loadSdk();
    if (!query) throw new Error('ClaudeAgentSdkProvider: @anthropic-ai/claude-agent-sdk is not installed.');

    const token = this.getBearerToken();
    if (token) process.env['ANTHROPIC_API_KEY'] = token;

    const model = request.model ?? this.config.models[0] ?? 'claude-sonnet-4-6';

    const systemMsg = request.messages.find(m => m.role === 'system');
    const userMsgs  = request.messages.filter(m => m.role !== 'system');
    const lastUser  = [...userMsgs].reverse().find((m: Message) => m.role === 'user');
    const prompt    = lastUser?.content ?? '';

    const priorTurns = userMsgs.slice(0, -1)
      .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n');

    const systemPrompt = [
      systemMsg?.content ?? '',
      priorTurns ? `\n\nConversation history:\n${priorTurns}` : '',
    ].filter(Boolean).join('').trim() || undefined;

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for await (const message of query({ prompt, options: { model, ...(systemPrompt && { systemPrompt }) } })) {
      if (signal?.aborted) break;

      if (message.type === 'assistant') {
        const blocks = (message as AgentSdkAssistantMessage).message.content;
        const text = blocks
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text?: string }) => b.text ?? '')
          .join('');
        if (text) yield { delta: text, done: false };
      }

      if (message.type === 'result') {
        const res = message as AgentSdkResultMessage;
        if (res.usage?.input_tokens)  promptTokens     = res.usage.input_tokens;
        if (res.usage?.output_tokens) completionTokens = res.usage.output_tokens;
      }
    }

    yield {
      delta:            '',
      done:             true,
      model,
      providerId:       this.config.id,
      selectionReason:  'claude-agent-sdk',
      promptTokens,
      completionTokens,
    };
  }
}
