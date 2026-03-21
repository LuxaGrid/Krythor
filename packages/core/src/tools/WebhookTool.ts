/**
 * WebhookTool — executes a user-defined webhook-backed tool.
 *
 * When an agent calls {"tool":"<custom-name>","input":"..."}, WebhookTool.run()
 * sends the input to the configured webhook URL and returns the response body.
 *
 * Configuration is stored in <configDir>/custom-tools.json.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CustomToolDefinition {
  name: string;
  description: string;
  type: 'webhook';
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  /** Optional body template — use {{input}} as a placeholder for the agent's input string. */
  bodyTemplate?: string;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

export class WebhookTool {
  /**
   * Run a user-defined webhook tool with the given input string.
   *
   * The request body is constructed from the tool's bodyTemplate (with {{input}}
   * replaced by the actual input), or defaults to a JSON object: { "input": "..." }.
   *
   * Returns the response body as a plain string.
   */
  async run(tool: CustomToolDefinition, input: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const body = tool.method !== 'GET' && tool.method !== 'DELETE'
        ? (tool.bodyTemplate
            ? tool.bodyTemplate.replace(/\{\{input\}\}/g, input)
            : JSON.stringify({ input }))
        : undefined;

      const res = await fetch(tool.url, {
        method:  tool.method,
        headers: {
          'Content-Type': 'application/json',
          ...(tool.headers ?? {}),
        },
        ...(body !== undefined && { body }),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Webhook "${tool.name}" returned HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
