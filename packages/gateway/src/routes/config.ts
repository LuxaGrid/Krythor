import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import type { AgentOrchestrator } from '@krythor/core';
import type { MemoryEngine } from '@krythor/memory';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON, parseAppConfig } from '@krythor/core';
import { logger } from '../logger.js';

// ── Config file keys exposed for in-app editing ──────────────────────────────
const EDITABLE_CONFIG_FILES: Record<string, string> = {
  'agents':    'agents.json',
  'providers': 'providers.json',
  'guard':     'guard.json',
  'app':       'app-config.json',
};

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  userTimezone?: string;
  timeFormat?: 'auto' | '12' | '24';
  bootstrapTruncationWarning?: 'off' | 'once' | 'always';
  sessionPruneAfterDays?: number;
  sessionMaxConversations?: number;
  /**
   * Shared secret for inbound webhook endpoints (POST /api/hooks/wake, /api/hooks/agent).
   * Set this to a random string to enable inbound hooks.
   * Use Authorization: Bearer <token> or X-Krythor-Hook-Token: <token>.
   */
  webhookToken?: string;
}

export function registerConfigRoute(app: FastifyInstance, configDir: string, guard?: GuardEngine, orchestrator?: AgentOrchestrator, memory?: MemoryEngine): void {
  const configPath = join(configDir, 'app-config.json');

  // Read the raw file — all fields preserved, including gatewayToken managed by auth.ts.
  // Returns {} when the file is missing; logs and returns {} when the file is unparseable.
  function readRaw(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (!missing) app.log.error({ err }, `[config] Failed to parse ${configPath} — returning empty config`);
      return {};
    }
  }

  function read(): AppConfig {
    const raw = readRaw();
    const { value, errors } = parseAppConfig(raw);
    if (errors.length > 0) {
      app.log.warn({ errors }, `[config] Validation warnings in ${configPath}`);
    }
    return value;
  }

  // Merge AppConfig fields onto the raw file so unmanaged fields (e.g. gatewayToken) survive.
  function write(config: AppConfig): void {
    atomicWriteJSON(configPath, { ...readRaw(), ...config });
  }

  // Apply settings from config at startup
  const startupCfg = read();
  if (startupCfg.logLevel) {
    logger.setLevel(startupCfg.logLevel);
  }
  if (orchestrator && (startupCfg.userTimezone || startupCfg.timeFormat)) {
    orchestrator.setUserTimezone(
      startupCfg.userTimezone ?? null,
      startupCfg.timeFormat ?? null,
    );
  }
  if (orchestrator && startupCfg.bootstrapTruncationWarning) {
    orchestrator.setBootstrapTruncationWarning(startupCfg.bootstrapTruncationWarning);
  }
  if (memory && (startupCfg.sessionPruneAfterDays !== undefined || startupCfg.sessionMaxConversations !== undefined)) {
    memory.setJanitorConfig({
      conversationRetentionDays: startupCfg.sessionPruneAfterDays,
      maxConversations: startupCfg.sessionMaxConversations,
    });
  }

  // GET /api/config
  // webhookToken is omitted from the response — it is write-only for security.
  app.get('/api/config', async (_req, reply) => {
    const { webhookToken: _omit, ...safeConfig } = read();
    return reply.send(safeConfig);
  });

  // PATCH /api/config
  app.patch('/api/config', {
    schema: {
      body: {
        type: 'object',
        properties: {
          selectedAgentId:             { type: ['string', 'null'] },
          selectedModel:               { type: ['string', 'null'] },
          onboardingComplete:          { type: 'boolean' },
          logLevel:                    { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
          userTimezone:                { type: ['string', 'null'] },
          timeFormat:                  { type: ['string', 'null'], enum: ['auto', '12', '24', null] },
          bootstrapTruncationWarning:  { type: ['string', 'null'], enum: ['off', 'once', 'always', null] },
          sessionPruneAfterDays:       { type: ['integer', 'null'], minimum: 1, maximum: 3650 },
          sessionMaxConversations:     { type: ['integer', 'null'], minimum: 1, maximum: 100000 },
          webhookToken:                { type: ['string', 'null'], maxLength: 512 },
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
    if ('userTimezone' in patch) {
      updated.userTimezone = (patch['userTimezone'] as string | null) ?? undefined;
    }
    if ('timeFormat' in patch) {
      updated.timeFormat = (patch['timeFormat'] as AppConfig['timeFormat'] | null) ?? undefined;
    }
    if ('bootstrapTruncationWarning' in patch) {
      updated.bootstrapTruncationWarning = (patch['bootstrapTruncationWarning'] as AppConfig['bootstrapTruncationWarning'] | null) ?? undefined;
    }
    // Apply runtime changes to orchestrator if provided
    if (orchestrator && ('userTimezone' in patch || 'timeFormat' in patch)) {
      orchestrator.setUserTimezone(updated.userTimezone ?? null, updated.timeFormat ?? null);
    }
    if (orchestrator && 'bootstrapTruncationWarning' in patch && updated.bootstrapTruncationWarning) {
      orchestrator.setBootstrapTruncationWarning(updated.bootstrapTruncationWarning);
    }
    if ('sessionPruneAfterDays' in patch) {
      updated.sessionPruneAfterDays = (patch['sessionPruneAfterDays'] as number | null) ?? undefined;
    }
    if ('sessionMaxConversations' in patch) {
      updated.sessionMaxConversations = (patch['sessionMaxConversations'] as number | null) ?? undefined;
    }
    if (memory && ('sessionPruneAfterDays' in patch || 'sessionMaxConversations' in patch)) {
      memory.setJanitorConfig({
        conversationRetentionDays: updated.sessionPruneAfterDays,
        maxConversations: updated.sessionMaxConversations,
      });
    }
    if ('webhookToken' in patch) {
      updated.webhookToken = (patch['webhookToken'] as string | null) ?? undefined;
    }
    write(updated);
    // Never return webhookToken in the response — treat it as write-only
    const { webhookToken: _omit, ...safeConfig } = updated;
    return reply.send(safeConfig);
  });

  // ── Config file editor routes ─────────────────────────────────────────────
  // GET  /api/config/files           — list editable config files
  // GET  /api/config/files/:key      — read a config file as raw JSON text
  // PUT  /api/config/files/:key      — overwrite a config file with validated JSON

  app.get('/api/config/files', async (_req, reply) => {
    const files = Object.entries(EDITABLE_CONFIG_FILES).map(([key, filename]) => {
      const path = join(configDir, filename);
      return { key, filename, exists: existsSync(path) };
    });
    return reply.send({ files });
  });

  app.get<{ Params: { key: string } }>('/api/config/files/:key', async (req, reply) => {
    const filename = EDITABLE_CONFIG_FILES[req.params.key];
    if (!filename) return reply.code(404).send({ error: `Unknown config key: ${req.params.key}` });
    const path = join(configDir, filename);
    if (!existsSync(path)) return reply.send({ content: '' });
    try {
      const content = readFileSync(path, 'utf-8');
      return reply.send({ content });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Read failed' });
    }
  });

  app.put<{ Params: { key: string }; Body: { content: string } }>('/api/config/files/:key', {
    schema: {
      body: {
        type: 'object',
        required: ['content'],
        properties: { content: { type: 'string', maxLength: 2_000_000 } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'config:write', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const filename = EDITABLE_CONFIG_FILES[req.params.key];
    if (!filename) return reply.code(404).send({ error: `Unknown config key: ${req.params.key}` });
    const { content } = req.body;
    // Validate that it's parseable JSON before writing
    try {
      const parsed = JSON.parse(content);
      const path = join(configDir, filename);
      atomicWriteJSON(path, parsed);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: `Invalid JSON: ${err instanceof Error ? err.message : 'Parse error'}` });
    }
  });
}
