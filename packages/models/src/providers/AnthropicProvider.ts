import { BaseProvider } from './BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk, Message } from '../types.js';

export class AnthropicProvider extends BaseProvider {

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      // Make a lightweight GET to the models endpoint with a short timeout.
      // A 200 (success) or 401 (bad key but endpoint reachable) both confirm
      // the API is reachable. Connection refused / timeout returns false.
      const signal = AbortSignal.timeout(5000);
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': this.config.apiKey,
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

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 1024,
      messages: userMsgs.map(m => ({ role: m.role, content: m.content })),
      ...(systemMsg && { system: systemMsg.content }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
    };

    const data = await this.httpPost(
      `${this.config.endpoint}/v1/messages`,
      body,
      this.headers,
      signal,
    ) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = data.content
      ?.filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('') ?? '';

    return {
      content,
      model,
      providerId: this.config.id,
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
      durationMs: Date.now() - start,
    };
  }

  async *inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`AnthropicProvider "${this.config.name}": no model specified`);

    const systemMsg = request.messages.find((m: Message) => m.role === 'system');
    const userMsgs = request.messages.filter((m: Message) => m.role !== 'system');

    const res = await fetch(`${this.config.endpoint}/v1/messages`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 1024,
        messages: userMsgs,
        ...(systemMsg && { system: systemMsg.content }),
        stream: true,
      }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`Anthropic stream failed: HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

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
              delta?: { type?: string; text?: string };
            };
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              yield { delta: event.delta.text ?? '', done: false, model };
            }
            if (event.type === 'message_stop') {
              yield { delta: '', done: true, model };
              return;
            }
          } catch { /* skip */ }
        }
      }
    }

    yield { delta: '', done: true, model };
  }
}
