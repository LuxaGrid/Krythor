import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
}

export function registerConfigRoute(app: FastifyInstance, configDir: string, guard?: GuardEngine): void {
  const configPath = join(configDir, 'app-config.json');

  function read(): AppConfig {
    if (!existsSync(configPath)) return {};
    try {
      return JSON.parse(readFileSync(configPath, 'utf8')) as AppConfig;
    } catch (err) {
      console.error(`[config] Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }

  function write(config: AppConfig): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  // GET /api/config
  app.get('/api/config', async (_req, reply) => {
    return reply.send(read());
  });

  // PATCH /api/config
  app.patch('/api/config', {
    schema: {
      body: {
        type: 'object',
        properties: {
          selectedAgentId:    { type: ['string', 'null'] },
          selectedModel:      { type: ['string', 'null'] },
          onboardingComplete: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'config:write', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const current = read();
    const patch = req.body as Record<string, unknown>;
    const updated: AppConfig = { ...current };
    // null means "clear the field"
    if ('selectedAgentId' in patch) updated.selectedAgentId = patch['selectedAgentId'] as string | undefined ?? undefined;
    if ('selectedModel' in patch) updated.selectedModel = patch['selectedModel'] as string | undefined ?? undefined;
    if ('onboardingComplete' in patch) updated.onboardingComplete = patch['onboardingComplete'] as boolean;
    write(updated);
    return reply.send(updated);
  });
}
