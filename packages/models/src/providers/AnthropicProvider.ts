import { BaseProvider } from './BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk, Message } from '../types.js';
import { validateStructuredOutput } from '../StructuredOutputValidator.js';

export class AnthropicProvider extends BaseProvider {

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.getBearerToken(),
      'anthropic-version': '2023-06-01',
    };
  }

  async isAvailable(): Promise<boolean> {
    const token = this.getBearerToken();
    if (!token) return false;
    try {
      // Make a lightweight GET to the models endpoint with a short timeout.
      // A 200 (success) or 401 (bad key but endpoint reachable) both confirm
      // the API is reachable. Connection refused / timeout returns false.
      const signal = AbortSignal.timeout(5000);
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': token,
          'anthropic-version': '2023-06-01',
        },
        signal,
      });
      // 200 = valid key, 401 = invalid key but server is up — both mean reachable
      return res.status === 200 || res.status === 401;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async infer(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`AnthropicProvider "${this.config.name}": no model specified`);

    const start = Date.now();

    // Anthropic requires system message separated from messages array
    const systemMsg = request.messages.find(m => m.role === 'system');
    const userMsgs = request.messages.filter(m => m.role !== 'system');

    // JSON mode: Anthropic does not have a native response_format field.
    // Append a JSON instruction to the system message instead.
    let systemText = systemMsg?.content ?? '';
    if (request.responseFormat) {
      const schemaHint = request.responseFormat.schema
        ? ` Conform to this JSON Schema: ${JSON.stringify(request.responseFormat.schema)}.`
        : '';
      const jsonInstruction = `You MUST respond with valid JSON only — no prose, no markdown fences.${schemaHint}`;
      systemText = systemText ? `${systemText}\n\n${jsonInstruction}` : jsonInstruction;
    }

    // Extended thinking: when enabled, temperature must be 1 (Anthropic requirement)
    const thinkingEnabled = request.thinking?.enabled === true;
    const thinkingBudget = request.thinking?.budgetTokens ?? 10_000;

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? (thinkingEnabled ? thinkingBudget + 1024 : 1024),
      messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
      ...(systemText && { system: systemText }),
      ...(thinkingEnabled
        ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget }, temperature: 1 }
        : request.temperature !== undefined && { temperature: request.temperature }),
    };

    const data = await this.httpPost(
      `${this.config.endpoint}/v1/messages`,
      body,
      this.headers,
      signal,
    ) as {
      content?: Array<{ type: string; text?: string; thinking?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const rawContent = data.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('') ?? '';

    const thinkingContent = thinkingEnabled
      ? data.content?.filter(b => b.type === 'thinking').map(b => b.thinking ?? '').join('') || undefined
      : undefined;

    // Validate structured output if requested
    if (request.responseFormat) {
      validateStructuredOutput(rawContent, request.responseFormat);
    }

    return {
      content: rawContent,
      model,
      providerId: this.config.id,
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
      durationMs: Date.now() - start,
      ...(thinkingContent !== undefined && { thinkingContent }),
    };
  }

  async *inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`AnthropicProvider "${this.config.name}": no model specified`);

    const systemMsg = request.messages.find((m: Message) => m.role === 'system');
    const userMsgs = request.messages.filter((m: Message) => m.role !== 'system');

    const thinkingEnabled = request.thinking?.enabled === true;
    const thinkingBudget = request.thinking?.budgetTokens ?? 10_000;

    const res = await fetch(`${this.config.endpoint}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? (thinkingEnabled ? thinkingBudget + 1024 : 1024),
        messages: userMsgs,
        ...(systemMsg && { system: systemMsg.content }),
        stream: true,
        ...(thinkingEnabled
          ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget }, temperature: 1 }
          : request.temperature !== undefined && { temperature: request.temperature }),
      }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`Anthropic stream failed: HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    // Track which block type is currently streaming
    let currentBlockType: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json) as {
              type: string;
              index?: number;
              content_block?: { type?: string };
              delta?: { type?: string; text?: string; thinking?: string };
              usage?: { input_tokens?: number; output_tokens?: number };
              message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            };
            if (event.type === 'message_start' && event.message?.usage?.input_tokens !== undefined) {
              promptTokens = event.message.usage.input_tokens;
            }
            if (event.type === 'message_delta' && event.usage?.output_tokens !== undefined) {
              completionTokens = event.usage.output_tokens;
            }
            // Track which content block type is streaming
            if (event.type === 'content_block_start' && event.content_block?.type) {
              currentBlockType = event.content_block.type;
            }
            if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield { delta: event.delta.text ?? '', done: false, model };
              } else if (event.delta?.type === 'thinking_delta' && thinkingEnabled) {
                yield { delta: '', thinkingDelta: event.delta.thinking ?? '', done: false, model };
              }
            }
            if (event.type === 'content_block_stop') {
              currentBlockType = undefined;
            }
            if (event.type === 'message_stop') {
              yield { delta: '', done: true, model, promptTokens, completionTokens };
              return;
            }
          } catch { /* skip */ }
        }
      }
    }

    // suppress unused variable warning
    void currentBlockType;
    yield { delta: '', done: true, model, promptTokens, completionTokens };
  }
}
