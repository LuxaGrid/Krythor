import { BaseProvider } from './BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk } from '../types.js';

export class OllamaProvider extends BaseProvider {

  async isAvailable(): Promise<boolean> {
    try {
      await this.httpGet(`${this.config.endpoint}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const data = await this.httpGet(`${this.config.endpoint}/api/tags`) as { models?: Array<{ name: string }> };
      return (data.models ?? []).map(m => m.name);
    } catch {
      // Return empty rather than stale config.models — caller should treat
      // an empty list as "provider unreachable" rather than "no models installed".
      return [];
    }
  }

  async infer(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`OllamaProvider "${this.config.name}": no model specified`);

    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      stream: false,
      options: {
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { num_predict: request.maxTokens }),
      },
    };

    const data = await this.httpPost(`${this.config.endpoint}/api/chat`, body, {}, signal) as {
      message?: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? '',
      model,
      providerId: this.config.id,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
      durationMs: Date.now() - start,
    };
  }

  async *inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`OllamaProvider "${this.config.name}": no model specified`);

    const res = await fetch(`${this.config.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: true,
        options: {
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.maxTokens !== undefined && { num_predict: request.maxTokens }),
        },
      }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`Ollama stream failed: HTTP ${res.status}`);

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
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          yield { delta: chunk.message?.content ?? '', done: chunk.done ?? false, model };
          if (chunk.done) return;
        } catch { /* skip malformed line */ }
      }
    }

    yield { delta: '', done: true, model };
  }
}
