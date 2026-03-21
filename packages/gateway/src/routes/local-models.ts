/**
 * GET /api/local-models — probe Ollama, LM Studio, and llama-server on default ports.
 *
 * Returns detected status and available models for each local provider.
 * Each probe has a 2-second timeout to avoid blocking the UI.
 * Auth required (wired via global auth hook in server.ts).
 *
 * ITEM 6: Local model discovery improvements.
 */

import type { FastifyInstance } from 'fastify';

interface ProbeResult {
  detected: boolean;
  baseUrl: string;
  models: string[];
}

interface LlamaServerProbeResult {
  detected: boolean;
  baseUrl: string;
}

const TIMEOUT_MS = 2000;

async function probeOllama(baseUrl: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { detected: false, baseUrl, models: [] };
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map(m => m.name).filter(Boolean);
    return { detected: true, baseUrl, models };
  } catch {
    return { detected: false, baseUrl, models: [] };
  }
}

async function probeLmStudio(baseUrl: string): Promise<ProbeResult> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { detected: false, baseUrl, models: [] };
    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map(m => m.id).filter(Boolean);
    return { detected: true, baseUrl, models };
  } catch {
    return { detected: false, baseUrl, models: [] };
  }
}

async function probeLlamaServer(baseUrl: string): Promise<LlamaServerProbeResult> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // llama-server returns 200 on /health when running
    return { detected: res.ok, baseUrl };
  } catch {
    return { detected: false, baseUrl };
  }
}

export function registerLocalModelsRoute(app: FastifyInstance): void {
  app.get('/api/local-models', async (_req, reply) => {
    // Probe all three in parallel — each has its own 2s timeout
    const [ollama, lmStudio, llamaServer] = await Promise.all([
      probeOllama('http://localhost:11434'),
      probeLmStudio('http://localhost:1234'),
      probeLlamaServer('http://localhost:8080'),
    ]);

    return reply.send({ ollama, lmStudio, llamaServer });
  });
}
