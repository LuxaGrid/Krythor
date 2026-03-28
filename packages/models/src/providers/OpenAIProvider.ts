import { BaseProvider } from './BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk } from '../types.js';
import { validateStructuredOutput } from '../StructuredOutputValidator.js';

interface OpenAIMessage { role: string; content: string; }

export class OpenAIProvider extends BaseProvider {

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getBearerToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.httpGet(`${this.config.endpoint}/models`, this.headers);
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const data = await this.httpGet(`${this.config.endpoint}/models`, this.headers) as {
        data?: Array<{ id: string }>;
      };
      return (data.data ?? []).map(m => m.id);
    } catch {
      return this.config.models;
    }
  }

  async infer(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`OpenAIProvider "${this.config.name}": no model specified`);

    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: request.messages as OpenAIMessage[],
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      // Structured output / JSON mode
      ...(request.responseFormat && {
        response_format: request.responseFormat.type === 'json_schema' && request.responseFormat.schema
          ? { type: 'json_schema', json_schema: { name: request.responseFormat.name ?? 'response', strict: true, schema: request.responseFormat.schema } }
          : { type: 'json_object' },
      }),
    };

    const data = await this.httpPost(`${this.config.endpoint}/chat/completions`, body, this.headers, signal) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const rawContent = data.choices?.[0]?.message?.content ?? '';
    // Validate structured output if requested
    if (request.responseFormat) {
      validateStructuredOutput(rawContent, request.responseFormat);
    }

    return {
      content: rawContent,
      model,
      providerId: this.config.id,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      durationMs: Date.now() - start,
    };
  }

  async *inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const model = request.model ?? this.config.models[0];
    if (!model) throw new Error(`OpenAIProvider "${this.config.name}": no model specified`);

    const res = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.temperature !== undefined && { temperature: request.temperature }),
        ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
      }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`OpenAI stream failed: HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.replace(/^data: /, '').trim();
        if (!trimmed) continue;
        if (trimmed === '[DONE]') {
          yield { delta: '', done: true, model, promptTokens, completionTokens };
          return;
        }
        try {
          const chunk = JSON.parse(trimmed) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          // usage-only chunk emitted after [DONE] when stream_options.include_usage is set
          if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
            promptTokens     = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
            continue;
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          const isDone = chunk.choices?.[0]?.finish_reason === 'stop';
          if (isDone) {
            yield { delta, done: true, model, promptTokens, completionTokens };
            return;
          }
          yield { delta, done: false, model };
        } catch { /* skip malformed line */ }
      }
    }

    yield { delta: '', done: true, model, promptTokens, completionTokens };
  }
}
