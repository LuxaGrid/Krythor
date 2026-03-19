import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON, parseAppConfig } from '@krythor/core';
import { logger } from '../logger.js';

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export function registerConfigRoute(app: FastifyInstance, configDir: string, guard?: GuardEngine): void {
  const configPath = join(configDir, 'app-config.json');

  function read(): AppConfig {
    if (!existsSync(configPath)) return {};
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
      const { value, errors } = parseAppConfig(raw);
      if (errors.length > 0) {
        app.log.warn({ errors }, `[config] Validation warnings in ${configPath}`);
      }
      return value;
    } catch (err) {
      app.log.error({ err }, `[config] Failed to parse ${configPath} — returning empty config`);
      return {};
    }
  }

  function write(config: AppConfig): void {
    atomicWriteJSON(configPath, config);
  }

  // Apply logLevel from config at startup
  const startupCfg = read();
  if (startupCfg.logLevel) {
    logger.setLevel(startupCfg.logLevel);
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
          logLevel:           { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
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
    if ('selectedAgentId' in patch) updated.selectedAgentId = patch['selectedAgentId'] as string | undefined ?? undefined;
    if ('selectedModel' in patch) updated.selectedModel = patch['selectedModel'] as string | undefined ?? undefined;
    if ('onboardingComplete' in patch) updated.onboardingComplete = patch['onboardingComplete'] as boolean;
    if ('logLevel' in patch) {
      updated.logLevel = patch['logLevel'] as AppConfig['logLevel'];
      if (updated.logLevel) logger.setLevel(updated.logLevel);
    }
    write(updated);
    return reply.send(updated);
  });
}
